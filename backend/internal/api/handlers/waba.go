package handlers

import (
	"bytes"
	"context"
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
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type WABAHandler struct {
	db       *gorm.DB
	pipeline inboundPipelineIface
}

type inboundPipelineIface interface {
	ProcessSavedInbound(ctx context.Context, ml *models.MessageLog) error
	ProcessSavedOutbound(ctx context.Context, ml *models.MessageLog) error
}

func NewWABAHandler(db *gorm.DB) *WABAHandler {
	return &WABAHandler{db: db}
}

func (h *WABAHandler) SetInboundPipeline(p inboundPipelineIface) {
	h.pipeline = p
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
		// Meta retorna string ("VERIFIED" / "NOT_VERIFIED" / "EXPIRED"), não bool
		CodeVerificationStatus string `json:"code_verification_status"`
		ID                     string `json:"id"`
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
	if phoneNumber.CodeVerificationStatus != "" {
		wabaInstance.CodeVerification = phoneNumber.CodeVerificationStatus
	} else {
		wabaInstance.CodeVerification = "VERIFIED"
	}
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

	// Auto-sync: se WABAInstance está active mas Instance.status ficou em
	// disconnected (provável fluxo antigo onde o callback não persistiu o
	// status correto), corrige no read. Sem isso a lista /instances mostra
	// como desconectado mesmo com WABA ativa.
	if waba.Status == "active" && instance.Status != models.StatusConnected {
		log.Info().Str("instance_id", instance.ID.String()).
			Str("from", string(instance.Status)).
			Msg("waba: auto-sync Instance.status → connected")
		h.db.Model(&instance).Update("status", models.StatusConnected)
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
		ID                     string `json:"id"`
		DisplayNumber          string `json:"display_number"`
		VerifiedName           string `json:"verified_name"`
		CodeVerificationStatus string `json:"code_verification_status"`
	}

	numbers := make([]phoneNumber, len(phoneData.Data))
	for i, p := range phoneData.Data {
		numbers[i] = phoneNumber{
			ID:                     p.ID,
			DisplayNumber:          p.DisplayNumber,
			VerifiedName:           p.VerifiedName,
			CodeVerificationStatus: p.CodeVerificationStatus,
		}
	}

	return c.JSON(fiber.Map{"phone_numbers": numbers})
}

// Estruturas oficiais da Cloud API (object: "whatsapp_business_account").
// Cada entry contém um array de "changes"; cada change tem um value com
// "messages" (inbound) e/ou "statuses" (delivery updates pra mensagens
// que NÓS enviamos).
type WebhookValueMessage struct {
	From      string `json:"from"`
	ID        string `json:"id"`
	Timestamp string `json:"timestamp"`
	Type      string `json:"type"`
	Text      *struct {
		Body string `json:"body"`
	} `json:"text,omitempty"`
	Image    *map[string]interface{} `json:"image,omitempty"`
	Audio    *map[string]interface{} `json:"audio,omitempty"`
	Video    *map[string]interface{} `json:"video,omitempty"`
	Document *map[string]interface{} `json:"document,omitempty"`
	Sticker  *map[string]interface{} `json:"sticker,omitempty"`
	Location *map[string]interface{} `json:"location,omitempty"`
}

type WebhookValueStatus struct {
	ID           string `json:"id"`
	Status       string `json:"status"` // sent | delivered | read | failed
	Timestamp    string `json:"timestamp"`
	RecipientID  string `json:"recipient_id"`
	Conversation *struct {
		ID                  string `json:"id"`
		ExpirationTimestamp string `json:"expiration_timestamp,omitempty"`
		Origin              *struct {
			Type string `json:"type"` // marketing | utility | authentication | service
		} `json:"origin,omitempty"`
	} `json:"conversation,omitempty"`
	Pricing *struct {
		Billable     bool   `json:"billable"`
		PricingModel string `json:"pricing_model"`
		Category     string `json:"category"`
	} `json:"pricing,omitempty"`
	Errors []struct {
		Code    int    `json:"code"`
		Title   string `json:"title"`
		Message string `json:"message,omitempty"`
	} `json:"errors,omitempty"`
}

type WebhookValue struct {
	MessagingProduct string `json:"messaging_product"`
	Metadata         struct {
		DisplayPhoneNumber string `json:"display_phone_number"`
		PhoneNumberID      string `json:"phone_number_id"`
	} `json:"metadata"`
	Contacts []struct {
		Profile struct {
			Name string `json:"name"`
		} `json:"profile"`
		WaID string `json:"wa_id"`
	} `json:"contacts,omitempty"`
	Messages []WebhookValueMessage `json:"messages,omitempty"`
	Statuses []WebhookValueStatus  `json:"statuses,omitempty"`
}

type WebhookEntry struct {
	ID      string `json:"id"`
	Changes []struct {
		Value WebhookValue `json:"value"`
		Field string       `json:"field"` // "messages" | outras
	} `json:"changes"`
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
		for _, change := range entry.Changes {
			if change.Field != "messages" {
				continue
			}
			val := change.Value
			phoneNumberID := val.Metadata.PhoneNumberID

			var waba models.WABAInstance
			if err := h.db.Where("phone_number_id = ?", phoneNumberID).First(&waba).Error; err != nil {
				log.Warn().Str("phone_number_id", phoneNumberID).Msg("waba webhook: WABAInstance não encontrada")
				continue
			}

			// 1. Mensagens INBOUND
			for _, msg := range val.Messages {
				h.processInboundMessage(&waba, &msg, val.Contacts)
			}

			// 2. STATUS UPDATES (sent/delivered/read/failed) das mensagens
			//    que NÓS enviamos — atualiza CampaignRecipient + MessageLog.
			for _, st := range val.Statuses {
				h.processStatusUpdate(&waba, &st)
			}
		}
	}

	return c.JSON(fiber.Map{"success": true})
}

// processInboundMessage salva mensagem recebida no MessageLog.
func (h *WABAHandler) processInboundMessage(
	waba *models.WABAInstance,
	msg *WebhookValueMessage,
	contacts []struct {
		Profile struct {
			Name string `json:"name"`
		} `json:"profile"`
		WaID string `json:"wa_id"`
	},
) {
	contactName := msg.From
	for _, c := range contacts {
		if c.WaID == msg.From {
			if c.Profile.Name != "" {
				contactName = c.Profile.Name
			}
			break
		}
	}

	body := ""
	if msg.Text != nil {
		body = msg.Text.Body
	}

	// Conteúdo serializado pra ficar compatível com parseMessageContent do front.
	contentMap := map[string]any{"text": body, "type": msg.Type}
	if msg.Image != nil {
		contentMap["image"] = *msg.Image
	}
	if msg.Audio != nil {
		contentMap["audio"] = *msg.Audio
	}
	if msg.Video != nil {
		contentMap["video"] = *msg.Video
	}
	if msg.Document != nil {
		contentMap["document"] = *msg.Document
	}
	contentJSON, _ := json.Marshal(contentMap)

	ml := models.MessageLog{
		ID:                uuid.New(),
		InstanceID:        waba.InstanceID,
		Direction:         models.DirectionIn,
		Type:              msg.Type,
		ToJID:             msg.From,
		SenderJID:         msg.From,
		ContactName:       contactName,
		Content:           string(contentJSON),
		Status:            models.MessageStatusDelivered,
		ExternalMessageID: msg.ID,
	}
	h.db.Create(&ml)
	if h.pipeline != nil {
		go func(m models.MessageLog) {
			if err := h.pipeline.ProcessSavedInbound(context.Background(), &m); err != nil {
				log.Warn().Err(err).Str("msg_id", m.ID.String()).Msg("waba inbound: pipeline failed")
			}
		}(ml)
	}
}

// processStatusUpdate aplica o status novo do Meta:
//   - Atualiza MessageLog.status pelo external_id (wamid)
//   - Atualiza CampaignRecipient.status quando o message_id bate
func (h *WABAHandler) processStatusUpdate(waba *models.WABAInstance, st *WebhookValueStatus) {
	// Mapeamento Meta → nosso enum
	var msgStatus models.MessageStatus
	switch st.Status {
	case "sent":
		msgStatus = models.MessageStatusSent
	case "delivered":
		msgStatus = models.MessageStatusDelivered
	case "read":
		msgStatus = models.MessageStatusRead
	case "failed":
		msgStatus = models.MessageStatusFailed
	default:
		return
	}

	ev := log.Debug().Str("wamid", st.ID).Str("status", st.Status).Str("recipient", st.RecipientID)
	if st.Status == "failed" && len(st.Errors) > 0 {
		ev = log.Warn().
			Str("wamid", st.ID).
			Str("recipient", st.RecipientID).
			Int("error_code", st.Errors[0].Code).
			Str("error_title", st.Errors[0].Title).
			Str("error_message", st.Errors[0].Message)
	}
	ev.Msg("waba: status update")

	// 1. MessageLog correspondente (outbound salvo com external_message_id = wamid)
	h.db.Model(&models.MessageLog{}).
		Where("external_message_id = ?", st.ID).
		Update("status", msgStatus)

	// 2. CampaignRecipient — se essa mensagem foi de uma campanha
	updates := map[string]any{}
	switch st.Status {
	case "delivered":
		updates["status"] = models.RecipientStatusSent
		now := time.Now()
		updates["delivered_at"] = &now
	case "read":
		now := time.Now()
		updates["read_at"] = &now
	case "failed":
		updates["status"] = models.RecipientStatusFailed
		if len(st.Errors) > 0 {
			updates["error"] = fmt.Sprintf("Meta %d: %s", st.Errors[0].Code, st.Errors[0].Title)
		}
	}
	if len(updates) > 0 {
		h.db.Model(&models.CampaignRecipient{}).
			Where("message_id = ?", st.ID).
			Updates(updates)
	}
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

	log.Info().
		Str("to", req.To).
		Str("type", req.Type).
		Str("phone_number_id", waba.PhoneNumberID).
		RawJSON("payload", jsonData).
		Msg("waba: sending message to Meta")

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
		log.Error().Str("to", req.To).Str("meta_response", string(body)).Msg("waba: Meta rejected message")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Meta API error: " + string(body)})
	}

	var metaResp struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	json.NewDecoder(resp.Body).Decode(&metaResp)
	wamid := ""
	if len(metaResp.Messages) > 0 {
		wamid = metaResp.Messages[0].ID
	}

	// Serialize body para content do MessageLog
	var contentStr string
	if req.Template != nil {
		b, _ := json.Marshal(req.Template)
		contentStr = string(b)
	} else if req.Body != "" {
		b, _ := json.Marshal(req.Body)
		contentStr = string(b)
	}

	ml := models.MessageLog{
		ID:                uuid.New(),
		InstanceID:        waba.InstanceID,
		Direction:         models.DirectionOut,
		Type:              req.Type,
		ToJID:             req.To,
		Content:           contentStr,
		Status:            models.MessageStatusSent,
		ExternalMessageID: wamid,
	}
	h.db.Create(&ml)

	if h.pipeline != nil {
		go func(m models.MessageLog) {
			if err := h.pipeline.ProcessSavedOutbound(context.Background(), &m); err != nil {
				log.Warn().Err(err).Str("to", m.ToJID).Msg("waba sendmessage: pipeline failed")
			}
		}(ml)
	}

	return c.JSON(fiber.Map{
		"id":         ml.ID.String(),
		"message_id": wamid,
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
	// Retorna todos os templates (APPROVED, PENDING, REJECTED, PAUSED). UI
	// mostra status pra cada um — PENDING precisa aparecer pra user saber
	// que a submissão chegou na Meta. Filtragem pra envio (só APPROVED) é
	// feita no frontend.
	return c.JSON(fiber.Map{"items": meta.Data})
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

// ─── Edit template ─────────────────────────────────────────────────────
// POST /v1/instances/:id/waba/templates/:templateId
// Atualiza os components de um template existente.
// Templates APPROVED voltam para PENDING (re-revisão pela Meta).
// Apenas components (body text e botões) podem ser alterados — name e
// language são imutáveis após aprovação.
func (h *WABAHandler) EditTemplate(c *fiber.Ctx) error {
	instanceID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	templateID := c.Params("templateId")
	if templateID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "templateId obrigatório"})
	}
	var req struct {
		Category   string `json:"category,omitempty"`
		Components []any  `json:"components"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.Components) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "components obrigatório"})
	}

	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA não encontrado"})
	}

	payload := map[string]any{"components": req.Components}
	if req.Category != "" {
		payload["category"] = req.Category
	}
	jsonBody, _ := json.Marshal(payload)
	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s", templateID)
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
