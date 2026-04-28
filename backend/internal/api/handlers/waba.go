package handlers

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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

type MetaBusiness struct {
	BusinessID string `json:"id"`
	Name       string `json:"name"`
}

type MetaWABAResponse struct {
	ID         string         `json:"id"`
	Businesses []MetaBusiness `json:"businesses"`
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

	extras := url.QueryEscape(`{"sessionInfoVersion":"3","version":"v4","setup":{}}`)

	authURL := fmt.Sprintf(
		"https://www.facebook.com/v18.0/dialog/oauth?client_id=%s&redirect_uri=%s&response_type=code&config_id=%s&override_default_response_type=true&extras=%s",
		config.AppConfig.MetaAppID,
		url.QueryEscape(redirectURI),
		config.AppConfig.MetaWhatsAppConfigID,
		extras,
	)

	return c.JSON(fiber.Map{"auth_url": authURL})
}

func (h *WABAHandler) Callback(c *fiber.Ctx) error {
	// Aceita code via query (legado) OU body (rota nova do frontend route handler)
	code := c.Query("code")
	var existingInstanceID string
	var clientRedirectURI string
	if code == "" {
		var body struct {
			Code        string `json:"code"`
			InstanceID  string `json:"instance_id"`
			RedirectURI string `json:"redirect_uri"`
		}
		if err := c.BodyParser(&body); err == nil {
			code = body.Code
			existingInstanceID = body.InstanceID
			clientRedirectURI = body.RedirectURI
		}
	}
	if code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "code is required"})
	}

	// redirect_uri do exchange precisa bater EXATO com o usado no auth URL.
	// Frontend pode informar via body — caso contrário cai pro FRONTEND_URL.
	redirectURI := clientRedirectURI
	if redirectURI == "" {
		redirectURI = config.AppConfig.FrontendURL + "/api/waba/callback"
	}

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

	// Se veio instance_id do state OAuth, atualiza a shell-instance criada
	// pelo modal "Criar instância" (que estava em status disconnected).
	// Caso contrário, cria nova instância (legado / fluxo direto).
	var instanceID uuid.UUID
	if existingInstanceID != "" {
		parsed, err := uuid.Parse(existingInstanceID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid instance_id"})
		}
		var existing models.Instance
		if err := h.db.Where("id = ? AND user_id = ?", parsed, userID).First(&existing).Error; err != nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instance not found"})
		}
		existing.PhoneNumber = phoneNumber.DisplayNumber
		existing.Status = models.StatusConnected
		h.db.Save(&existing)
		instanceID = existing.ID
	} else {
		instanceID = uuid.New()
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
	}

	// Upsert WABAInstance pra essa instance_id
	var wabaInstance models.WABAInstance
	wabaErr := h.db.Where("instance_id = ?", instanceID).First(&wabaInstance).Error
	wabaInstance.InstanceID = instanceID
	wabaInstance.WABABusinessID = wabaData.Businesses[0].BusinessID
	wabaInstance.PhoneNumberID = phoneNumberID
	wabaInstance.PhoneNumber = phoneNumber.DisplayNumber
	wabaInstance.AccessToken = tokenData.AccessToken
	wabaInstance.Status = "active"
	wabaInstance.VerifiedName = verifiedName
	wabaInstance.CodeVerification = "VERIFIED"
	if wabaErr != nil {
		wabaInstance.ID = uuid.New()
		h.db.Create(&wabaInstance)
	} else {
		h.db.Save(&wabaInstance)
	}

	// Tech Provider flow exige chamar /subscribed_apps no WABA pra Meta
	// começar a entregar webhooks. Best-effort: log o erro mas não falha o
	// callback (user pode re-disparar via UI).
	subscribeErr := h.autoSubscribe(&wabaInstance)

	return c.JSON(fiber.Map{
		"instance_id":   instanceID.String(),
		"waba_id":       wabaData.Businesses[0].BusinessID,
		"phone_number":  phoneNumber.DisplayNumber,
		"verified_name": verifiedName,
		"subscribed":    subscribeErr == nil,
		"subscribe_error": func() string {
			if subscribeErr != nil {
				return subscribeErr.Error()
			}
			return ""
		}(),
		"next_step": "register", // user precisa setar PIN 2FA + chamar /register
	})
}

// autoSubscribe — chama POST /v18.0/<WABA_ID>/subscribed_apps logo após
// callback. Best-effort: não falha o flow se Meta retornar erro.
func (h *WABAHandler) autoSubscribe(waba *models.WABAInstance) error {
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/subscribed_apps", waba.WABABusinessID)
	req, _ := http.NewRequest("POST", url, nil)
	req.Header.Set("Authorization", "Bearer "+waba.AccessToken)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("subscribed_apps %d: %s", resp.StatusCode, string(body))
	}
	return nil
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

// getWABAInfo extrai o WABA ID via /debug_token. Esse endpoint retorna os
// "granular_scopes" associados ao token, e dentro de whatsapp_business_management
// vêm os target_ids — IDs das WABAs autorizadas no Embedded Signup.
//
// Não usamos /me/businesses porque exige business_management, que NÃO faz
// parte do escopo do Tech Provider Embedded Signup (whatsapp_business_*).
func (h *WABAHandler) getWABAInfo(accessToken string) (*MetaWABAResponse, error) {
	appAccessToken := config.AppConfig.MetaAppID + "|" + config.AppConfig.MetaAppSecret

	reqURL := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/debug_token?input_token=%s&access_token=%s",
		accessToken, appAccessToken,
	)

	resp, err := http.Get(reqURL)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to debug_token: %s", string(body))
	}

	var debug struct {
		Data struct {
			GranularScopes []struct {
				Scope     string   `json:"scope"`
				TargetIDs []string `json:"target_ids"`
			} `json:"granular_scopes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &debug); err != nil {
		return nil, fmt.Errorf("failed to parse debug_token: %w", err)
	}

	var wabaIDs []string
	for _, gs := range debug.Data.GranularScopes {
		if gs.Scope == "whatsapp_business_management" || gs.Scope == "whatsapp_business_messaging" {
			wabaIDs = append(wabaIDs, gs.TargetIDs...)
		}
	}

	if len(wabaIDs) == 0 {
		return nil, fmt.Errorf("no WABA found in token granular_scopes — verifique se o user concluiu o Embedded Signup")
	}

	// Dedup
	seen := map[string]bool{}
	var unique []string
	for _, id := range wabaIDs {
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}

	// MetaWABAResponse foi modelado pra /me/businesses — adapta usando o
	// primeiro WABA ID como business_id (no Tech Provider flow, são equivalentes).
	wabaData := &MetaWABAResponse{
		Businesses: []MetaBusiness{{BusinessID: unique[0]}},
	}
	return wabaData, nil
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
		// Retorna 200 com connected=false em vez de 404 — frontend usa isso
		// pra decidir mostrar Connect button (sem retry-loop do react-query).
		return c.JSON(fiber.Map{
			"connected":   false,
			"instance_id": instanceID,
		})
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

	// HMAC SHA256 validation — Meta envia X-Hub-Signature-256 com hash
	// HMAC do BODY usando MetaAppSecret. Sem isso, qualquer um pode forjar
	// eventos. Skip se MetaAppSecret está vazio (dev local).
	if secret := config.AppConfig.MetaAppSecret; secret != "" {
		sig := c.Get("X-Hub-Signature-256")
		body := c.Body()
		if !verifyMetaSignature(sig, body, secret) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "invalid signature"})
		}
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
		To       string                 `json:"to"`
		Type     string                 `json:"type"`
		Body     string                 `json:"body,omitempty"`     // legacy flat
		Text     map[string]interface{} `json:"text,omitempty"`     // {body: "..."}
		Template map[string]interface{} `json:"template,omitempty"` // {name, language, components}
		Image    map[string]interface{} `json:"image,omitempty"`
		Document map[string]interface{} `json:"document,omitempty"`
		Audio    map[string]interface{} `json:"audio,omitempty"`
		Video    map[string]interface{} `json:"video,omitempty"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request"})
	}

	if req.To == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "to is required"})
	}

	if req.Type == "" {
		req.Type = "text"
	}

	messageData := map[string]interface{}{
		"messaging_product": "whatsapp",
		"to":                req.To,
		"type":              req.Type,
	}

	switch req.Type {
	case "text":
		if req.Text != nil {
			messageData["text"] = req.Text
		} else if req.Body != "" {
			messageData["text"] = map[string]string{"body": req.Body}
		} else {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "text.body is required"})
		}
	case "template":
		if req.Template == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "template object is required"})
		}
		messageData["template"] = req.Template
	case "image":
		messageData["image"] = req.Image
	case "document":
		messageData["document"] = req.Document
	case "audio":
		messageData["audio"] = req.Audio
	case "video":
		messageData["video"] = req.Video
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

// ListTemplates GET /v1/instances/:id/waba/templates
// Retorna os templates aprovados pelo Meta pro WABA dessa instance.
// A Meta API retorna { data: [{ name, language, status, category,
// components: [{ type, text, buttons, example, ... }] }] }.
// Aqui propagamos o payload bruto — o front já sabe interpretar.
func (h *WABAHandler) ListTemplates(c *fiber.Ctx) error {
	instanceID := c.Params("id")
	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA instance not found"})
	}
	if waba.AccessToken == "" || waba.WABABusinessID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "waba sem credenciais"})
	}

	graphURL := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/%s/message_templates?limit=100&access_token=%s",
		waba.WABABusinessID, url.QueryEscape(waba.AccessToken),
	)
	req, _ := http.NewRequest("GET", graphURL, nil)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":  "Meta API error",
			"status": resp.StatusCode,
			"body":   string(body),
		})
	}
	var meta struct {
		Data []map[string]any `json:"data"`
	}
	_ = json.Unmarshal(body, &meta)
	// Só expomos APPROVED — evita UI oferecer template que Meta vai rejeitar.
	approved := make([]map[string]any, 0, len(meta.Data))
	for _, t := range meta.Data {
		status, _ := t["status"].(string)
		if strings.EqualFold(status, "APPROVED") {
			approved = append(approved, t)
		}
	}
	return c.JSON(fiber.Map{"items": approved})
}

// ─── HMAC verification ─────────────────────────────────────────────────
// Meta envia "sha256=<hex>" no header X-Hub-Signature-256, calculado
// como HMAC-SHA256(app_secret, raw_body). Sem essa validação, qualquer
// IP poderia forjar eventos de mensagem inbound.
func verifyMetaSignature(header string, body []byte, appSecret string) bool {
	if !strings.HasPrefix(header, "sha256=") {
		return false
	}
	expectedHex := strings.TrimPrefix(header, "sha256=")
	mac := hmac.New(sha256.New, []byte(appSecret))
	mac.Write(body)
	actual := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expectedHex), []byte(actual))
}

// ─── Subscribe app to WABA webhooks ────────────────────────────────────
// Após Embedded Signup, é OBRIGATÓRIO chamar /subscribed_apps no WABA
// pra Meta começar a enviar eventos. Sem isso, webhooks ficam mudos.
//
// POST /v1/instances/:id/waba/subscribe — chamado uma vez logo depois do
// callback. Idempotente do lado da Meta.
func (h *WABAHandler) SubscribeApp(c *fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA não encontrado"})
	}

	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/subscribed_apps", waba.WABABusinessID)
	req, _ := http.NewRequest("POST", url, nil)
	req.Header.Set("Authorization", "Bearer "+waba.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "subscribe falhou: " + err.Error()})
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return c.Status(resp.StatusCode).JSON(fiber.Map{"error": "Meta: " + string(body)})
	}
	return c.JSON(fiber.Map{"success": true})
}

// ─── Register phone number (ativa pra envio) ───────────────────────────
// POST /v1/instances/:id/waba/register
// Body: { pin: "123456" }  (PIN de 6 dígitos definido no Meta)
//
// Após Embedded Signup, o número precisa ser registrado pra ativar
// envio. Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/registration
func (h *WABAHandler) RegisterPhone(c *fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct {
		PIN string `json:"pin"`
	}
	if err := c.BodyParser(&body); err != nil || len(body.PIN) != 6 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "PIN de 6 dígitos obrigatório"})
	}
	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA não encontrado"})
	}
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/register", waba.PhoneNumberID)
	payload := map[string]any{"messaging_product": "whatsapp", "pin": body.PIN}
	jsonBody, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", url, strings.NewReader(string(jsonBody)))
	req.Header.Set("Authorization", "Bearer "+waba.AccessToken)
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return c.Status(resp.StatusCode).JSON(fiber.Map{"error": "Meta: " + string(respBody)})
	}
	return c.JSON(fiber.Map{"success": true})
}

// ─── Create message template (HSM) ─────────────────────────────────────
// POST /v1/instances/:id/waba/templates
// Body: { name, language, category, components: [...] }
//
// Cria template para aprovação na Meta. Reference:
// https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates
func (h *WABAHandler) CreateTemplate(c *fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var req struct {
		Name       string         `json:"name"`
		Language   string         `json:"language"`
		Category   string         `json:"category"` // MARKETING / UTILITY / AUTHENTICATION
		Components []any          `json:"components"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" || req.Language == "" || req.Category == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name, language e category obrigatórios"})
	}
	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA não encontrado"})
	}
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/message_templates", waba.WABABusinessID)
	jsonBody, _ := json.Marshal(req)
	httpReq, _ := http.NewRequest("POST", url, strings.NewReader(string(jsonBody)))
	httpReq.Header.Set("Authorization", "Bearer "+waba.AccessToken)
	httpReq.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(httpReq)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return c.Status(resp.StatusCode).JSON(fiber.Map{"error": "Meta: " + string(respBody), "raw": string(respBody)})
	}
	var out map[string]any
	_ = json.Unmarshal(respBody, &out)
	return c.JSON(out)
}

// ─── Delete template ───────────────────────────────────────────────────
// DELETE /v1/instances/:id/waba/templates/:name
func (h *WABAHandler) DeleteTemplate(c *fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	name := c.Params("name")
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name obrigatório"})
	}
	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA não encontrado"})
	}
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/message_templates?name=%s",
		waba.WABABusinessID, name)
	req, _ := http.NewRequest("DELETE", url, nil)
	req.Header.Set("Authorization", "Bearer "+waba.AccessToken)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return c.Status(resp.StatusCode).JSON(fiber.Map{"error": "Meta: " + string(respBody)})
	}
	return c.JSON(fiber.Map{"success": true})
}

func init() {
	// Note: Cannot access config.AppConfig here as it's not initialized yet
}
