package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type WABAHandler struct {
	db *gorm.DB
}

func NewWABAHandler(db *gorm.DB) *WABAHandler {
	return &WABAHandler{db: db}
}

type WABACreateRequest struct {
	Code        string `json:"code"`
	RedirectURI string `json:"redirect_uri"`
	Name        string `json:"name"`
}

type WABAResponse struct {
	ID             uuid.UUID `json:"id"`
	InstanceID     uuid.UUID `json:"instance_id"`
	WABABusinessID string    `json:"waba_business_id"`
	PhoneNumberID  string    `json:"phone_number_id"`
	PhoneNumber    string    `json:"phone_number"`
	Status         string    `json:"status"`
	VerifiedName   string    `json:"verified_name"`
}

type MetaTokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	TokenType   string `json:"token_type"`
}

type MetaWABAResponse struct {
	ID         string `json:"id"`
	Businesses []struct {
		BusinessID string `json:"id"`
		Name       string `json:"name"`
	} `json:"businesses"`
}

type MetaPhoneNumberResponse struct {
	Data []struct {
		DisplayNumber string `json:"display_phone_number"`
		VerifiedName  string `json:"verified_name"`
		CodeVerified  bool   `json:"code_verification_status"`
		ID            string `json:"id"`
	} `json:"data"`
}

type MetaRegisterResponse struct {
	Success bool `json:"success"`
}

func (h *WABAHandler) GetAuthURL(c *fiber.Ctx) error {
	if config.AppConfig.MetaWhatsAppConfigID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Meta WABA not configured"})
	}

	frontendURL := config.AppConfig.FrontendURL
	redirectURI := frontendURL + "/api/waba/callback"

	authURL := fmt.Sprintf(
		"https://www.facebook.com/v18.0/dialog/oauth?client_id=%s&redirect_uri=%s&response_type=code&config_id=%s&override_default_response_type= true",
		config.AppConfig.MetaAppID,
		url.QueryEscape(redirectURI),
		config.AppConfig.MetaWhatsAppConfigID,
	)

	return c.JSON(fiber.Map{"auth_url": authURL})
}

func (h *WABAHandler) Callback(c *fiber.Ctx) error {
	code := c.Query("code")
	if code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "code is required"})
	}

	redirectURI := config.AppConfig.FrontendURL + "/api/waba/callback"

	tokenData, err := h.exchangeCodeForToken(code, redirectURI)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to exchange token: " + err.Error()})
	}

	wabaData, err := h.getWABAInfo(tokenData.AccessToken)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to get WABA info: " + err.Error()})
	}

	phoneData, err := h.getPhoneNumbers(tokenData.AccessToken, wabaData.Businesses[0].BusinessID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to get phone numbers: " + err.Error()})
	}

	if len(phoneData.Data) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "no phone numbers found"})
	}

	phoneNumber := phoneData.Data[0]
	verifiedName := phoneNumber.VerifiedName
	phoneNumberID := phoneNumber.ID

	userID, ok := c.Locals("user_id").(uuid.UUID)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}

	workspaceID, _ := c.Locals("workspace_id").(*uuid.UUID)

	instanceID := uuid.New()
	instance := models.Instance{
		ID:          instanceID,
		UserID:      userID,
		WorkspaceID: workspaceID,
		Name:        verifiedName + " - WABA",
		Channel:     models.ChannelWABA,
		PhoneNumber: phoneNumber.DisplayNumber,
		Status:      models.StatusConnected,
	}
	h.db.Create(&instance)

	wabaInstance := models.WABAInstance{
		ID:               uuid.New(),
		InstanceID:       instanceID,
		WABABusinessID:   wabaData.Businesses[0].BusinessID,
		PhoneNumberID:    phoneNumberID,
		PhoneNumber:      phoneNumber.DisplayNumber,
		AccessToken:      tokenData.AccessToken,
		Status:           "active",
		VerifiedName:     verifiedName,
		CodeVerification: "VERIFIED",
	}
	h.db.Create(&wabaInstance)

	return c.JSON(fiber.Map{
		"instance_id":   instanceID.String(),
		"waba_id":       wabaData.Businesses[0].BusinessID,
		"phone_number":  phoneNumber.DisplayNumber,
		"verified_name": verifiedName,
	})
}

func (h *WABAHandler) exchangeCodeForToken(code, redirectURI string) (*MetaTokenResponse, error) {
	if config.AppConfig.MetaAppID == "" || config.AppConfig.MetaAppSecret == "" {
		return nil, fmt.Errorf("Meta app credentials not configured")
	}

	reqURL := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/oauth/access_token?client_id=%s&client_secret=%s&code=%s&redirect_uri=%s",
		config.AppConfig.MetaAppID,
		config.AppConfig.MetaAppSecret,
		code,
		url.QueryEscape(redirectURI),
	)

	resp, err := http.Get(reqURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("token exchange failed: %s", string(body))
	}

	var tokenData MetaTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenData); err != nil {
		return nil, err
	}

	return &tokenData, nil
}

func (h *WABAHandler) getWABAInfo(accessToken string) (*MetaWABAResponse, error) {
	reqURL := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/me?fields=businesses&access_token=%s",
		accessToken,
	)

	resp, err := http.Get(reqURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get WABA info: %s", string(body))
	}

	var wabaData MetaWABAResponse
	if err := json.NewDecoder(resp.Body).Decode(&wabaData); err != nil {
		return nil, err
	}

	if len(wabaData.Businesses) == 0 {
		return nil, fmt.Errorf("no business found")
	}

	return &wabaData, nil
}

func (h *WABAHandler) getPhoneNumbers(accessToken, businessID string) (*MetaPhoneNumberResponse, error) {
	reqURL := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/%s/phone_numbers?access_token=%s",
		businessID,
		accessToken,
	)

	resp, err := http.Get(reqURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to get phone numbers: %s", string(body))
	}

	var phoneData MetaPhoneNumberResponse
	if err := json.NewDecoder(resp.Body).Decode(&phoneData); err != nil {
		return nil, err
	}

	return &phoneData, nil
}

func (h *WABAHandler) GetWABA(c *fiber.Ctx) error {
	instanceID := c.Params("id")

	var instance models.Instance
	if err := h.db.Where("id = ?", instanceID).First(&instance).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instance not found"})
	}

	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA instance not found"})
	}

	return c.JSON(WABAResponse{
		ID:             waba.ID,
		InstanceID:     waba.InstanceID,
		WABABusinessID: waba.WABABusinessID,
		PhoneNumberID:  waba.PhoneNumberID,
		PhoneNumber:    waba.PhoneNumber,
		Status:         waba.Status,
		VerifiedName:   waba.VerifiedName,
	})
}

func (h *WABAHandler) DeleteWABA(c *fiber.Ctx) error {
	instanceID := c.Params("id")

	var instance models.Instance
	if err := h.db.Where("id = ?", instanceID).First(&instance).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instance not found"})
	}

	h.db.Where("instance_id = ?", instanceID).Delete(&models.WABAInstance{})
	h.db.Delete(&instance)

	return c.JSON(fiber.Map{"success": true})
}

func (h *WABAHandler) ListPhoneNumbers(c *fiber.Ctx) error {
	instanceID := c.Params("id")

	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA instance not found"})
	}

	phoneData, err := h.getPhoneNumbers(waba.AccessToken, waba.WABABusinessID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	type phoneNumber struct {
		ID            string `json:"id"`
		DisplayNumber string `json:"display_number"`
		VerifiedName  string `json:"verified_name"`
		CodeVerified  bool   `json:"code_verified"`
	}

	numbers := make([]phoneNumber, len(phoneData.Data))
	for i, p := range phoneData.Data {
		numbers[i] = phoneNumber{
			ID:            p.ID,
			DisplayNumber: p.DisplayNumber,
			VerifiedName:  p.VerifiedName,
			CodeVerified:  p.CodeVerified,
		}
	}

	return c.JSON(fiber.Map{"phone_numbers": numbers})
}

type WebhookEntry struct {
	ID        string `json:"id"`
	Messaging []struct {
		Sender struct {
			ID string `json:"id"`
		} `json:"sender"`
		Recipient struct {
			ID string `json:"id"`
		} `json:"recipient"`
		Message struct {
			ID   string `json:"id"`
			Text string `json:"text"`
		} `json:"message"`
	} `json:"messaging"`
}

type WebhookRequest struct {
	Object string         `json:"object"`
	Entry  []WebhookEntry `json:"entry"`
}

func (h *WABAHandler) Webhook(c *fiber.Ctx) error {
	if c.Method() == "GET" {
		mode := c.Query("hub.mode")
		token := c.Query("hub.verify_token")
		challenge := c.Query("hub.challenge")

		if mode != "subscribe" {
			return c.Status(fiber.StatusBadRequest).SendString("invalid mode")
		}

		if token != config.AppConfig.MetaWebhookVerifyToken {
			return c.Status(fiber.StatusForbidden).SendString("invalid token")
		}

		return c.SendString(challenge)
	}

	var webhookReq WebhookRequest
	if err := c.BodyParser(&webhookReq); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request"})
	}

	for _, entry := range webhookReq.Entry {
		for _, msg := range entry.Messaging {
			if msg.Message.Text == "" {
				continue
			}

			phoneNumberID := msg.Recipient.ID

			var waba models.WABAInstance
			if err := h.db.Where("phone_number_id = ?", phoneNumberID).First(&waba).Error; err != nil {
				continue
			}

			contactPhone := strings.ReplaceAll(msg.Sender.ID, "+", "")

			messageLog := models.MessageLog{
				ID:          uuid.New(),
				InstanceID:  waba.InstanceID,
				Direction:   models.DirectionIn,
				Type:        "text",
				ToJID:       phoneNumberID + "@waba",
				ContactName: contactPhone,
				Content:     msg.Message.Text,
				Status:      models.MessageStatusDelivered,
			}
			h.db.Create(&messageLog)
		}
	}

	return c.JSON(fiber.Map{"success": true})
}

func (h *WABAHandler) SendMessage(c *fiber.Ctx) error {
	instanceID := c.Params("id")

	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA instance not found"})
	}

	var req struct {
		To   string `json:"to"`
		Body string `json:"body"`
		Type string `json:"type"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request"})
	}

	if req.To == "" || req.Body == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "to and body are required"})
	}

	if req.Type == "" {
		req.Type = "text"
	}

	messageData := map[string]interface{}{
		"messaging_product": "whatsapp",
		"to":                req.To,
		"type":              req.Type,
	}

	if req.Type == "text" {
		messageData["text"] = map[string]string{"body": req.Body}
	}

	jsonData, _ := json.Marshal(messageData)

	graphURL := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/%s/messages",
		waba.PhoneNumberID,
	)

	httpReq, _ := http.NewRequest("POST", graphURL, bytes.NewBuffer(jsonData))
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+waba.AccessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Meta API error: " + string(body)})
	}

	var metaResp map[string]interface{}
	json.NewDecoder(resp.Body).Decode(&metaResp)

	msgID := uuid.New()
	messageLog := models.MessageLog{
		ID:         msgID,
		InstanceID: waba.InstanceID,
		Direction:  models.DirectionOut,
		Type:       req.Type,
		ToJID:      req.To,
		Content:    req.Body,
		Status:     models.MessageStatusSent,
	}
	h.db.Create(&messageLog)

	return c.JSON(fiber.Map{
		"id":         msgID.String(),
		"message_id": metaResp["message_id"],
		"status":     "sent",
	})
}

func init() {
	// Note: Cannot access config.AppConfig here as it's not initialized yet
}
