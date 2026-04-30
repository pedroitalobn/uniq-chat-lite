package handlers

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/storage"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

var mediaHTTPClient = &http.Client{Timeout: 30 * time.Second}

// resolveMediaBytes returns raw bytes from either a base64 string or a URL.
func resolveMediaBytes(b64, url string) ([]byte, error) {
	if b64 != "" {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			// try URL-safe variant
			data, err = base64.URLEncoding.DecodeString(b64)
		}
		return data, err
	}
	if url != "" {
		resp, err := mediaHTTPClient.Get(url)
		if err != nil {
			return nil, fmt.Errorf("download failed: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			return nil, fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
		}
		return io.ReadAll(resp.Body)
	}
	return nil, fmt.Errorf("url ou base64 são obrigatórios")
}

type MessageHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewMessageHandler(db *gorm.DB, manager *whatsapp.Manager) *MessageHandler {
	return &MessageHandler{db: db, manager: manager}
}

// defaultSendOptions returns sensible anti-ban defaults.
func defaultSendOptions() queue.SendOptions {
	return queue.SendOptions{
		DelayMs:        1200,
		SimulateTyping: true,
	}
}

// enqueueOrSend tries to enqueue a job; on failure falls back to direct send.
// Returns (messageID, queued, error).
func enqueueOrSend(job queue.SendJob, directFn func() (string, error)) (string, bool, error) {
	if queue.GlobalQueue != nil && queue.GlobalQueue.IsConnected() {
		if err := queue.GlobalQueue.Enqueue(job); err == nil {
			return "queued:" + job.ID.String(), true, nil
		}
	}
	msgID, err := directFn()
	return msgID, false, err
}

func (h *MessageHandler) getClient(c *fiber.Ctx) (*whatsapp.InstanceClient, error) {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return nil, fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}

	client := h.manager.GetInstance(instance.ID.String())
	if client == nil {
		return nil, fiber.NewError(fiber.StatusConflict, "instância não está em execução. Conecte primeiro.")
	}
	if !client.IsConnected() {
		return nil, fiber.NewError(fiber.StatusConflict, "instância não está conectada ao WhatsApp")
	}
	return client, nil
}

func (h *MessageHandler) logMessage(instanceID, direction, msgType, jid, msgID string, content interface{}) {
	contentJSON, _ := json.Marshal(content)
	status := models.MessageStatusSent
	if direction == string(models.DirectionIn) {
		status = models.MessageStatusDelivered
	}
	instID, err := uuid.Parse(instanceID)
	if err != nil {
		return
	}
	entry := models.MessageLog{
		InstanceID: instID,
		Direction:  models.MessageDirection(direction),
		Type:       msgType,
		ToJID:      jid,
		Content:    string(contentJSON),
		Status:     status,
	}
	h.db.Create(&entry)

	// Sprint billing — incrementa usage counter (msgs do dia) por user.
	// Acumulado por user_id (todas as instâncias) pra checar limite do plano.
	// Best-effort: falha aqui não impede o log da mensagem.
	if direction == string(models.DirectionOut) {
		usage := services.GetGlobalUsageService()
		if usage != nil {
			var inst models.Instance
			if err := h.db.Select("user_id, plan_id").First(&inst, "id = ?", instID).Error; err == nil {
				var plan *models.Plan
				if inst.UserID != uuid.Nil {
					var u models.User
					if err := h.db.Preload("Plan").First(&u, "id = ?", inst.UserID).Error; err == nil {
						plan = u.Plan
					}
					usage.Increment(context.Background(), inst.UserID, models.UsageTypeMessagesSent, plan)
				}
			}
		}
	}
}

// checkSendQuota retorna 402 se o user atingiu MaxMessagesPerDay do
// plano. Chamado no início dos handlers de send (text/media/etc).
//
// Por que aqui em vez de middleware: cada send tem um path diferente
// (preInst, v1inst, instance), aplicar middleware em todos é mais
// código que helper único. Plus o helper pode acessar c.Locals("instance")
// que já está populado.
func (h *MessageHandler) checkSendQuota(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return nil
	}
	usage := services.GetGlobalUsageService()
	if usage == nil {
		return nil
	}
	var user models.User
	if err := h.db.Preload("Plan").First(&user, "id = ?", instance.UserID).Error; err != nil {
		return nil // se não conseguimos carregar, não bloqueamos (fail-open)
	}
	if user.Role == models.RoleSuperAdmin {
		return nil
	}
	if user.Plan == nil || user.Plan.IsUnlimitedMessages() {
		return nil
	}
	if usage.HasReachedLimit(c.Context(), user.ID, models.UsageTypeMessagesSent, user.Plan.MaxMessagesPerDay) {
		return c.Status(fiber.StatusPaymentRequired).JSON(fiber.Map{
			"error":       "quota_exceeded",
			"message":     "Limite diário de mensagens do plano atingido. Faça upgrade pra continuar.",
			"limit":       user.Plan.MaxMessagesPerDay,
			"upgrade_url": "/settings?section=billing",
		})
	}
	return nil
}

// SendText godoc
// POST /instances/:id/messages/text
func (h *MessageHandler) SendText(c *fiber.Ctx) error {
	if err := h.checkSendQuota(c); err != nil {
		return err
	}
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To      string             `json:"to"`
		Text    string             `json:"text"`
		Options *queue.SendOptions `json:"options"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.Text == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'text' são obrigatórios"})
	}

	opts := defaultSendOptions()
	if req.Options != nil {
		opts = *req.Options
	}

	job := queue.SendJob{
		ID:         uuid.New(),
		InstanceID: instance.ID.String(),
		Type:       queue.TypeText,
		Payload:    queue.SendPayload{To: req.To, Text: req.Text},
		Options:    opts,
	}

	msgID, queued, err := enqueueOrSend(job, func() (string, error) {
		return client.SendTextMessage(req.To, req.Text)
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	status := "sent"
	if queued {
		status = "queued"
	}
	go h.logMessage(instance.ID.String(), "out", "text", req.To, msgID, map[string]string{"text": req.Text})
	return c.JSON(fiber.Map{"message_id": msgID, "status": status})
}

// SendImage godoc
// POST /instances/:id/messages/image
func (h *MessageHandler) SendImage(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To      string             `json:"to"`
		URL     string             `json:"url"`
		Base64  string             `json:"base64"`
		Caption string             `json:"caption"`
		Options *queue.SendOptions `json:"options"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || (req.URL == "" && req.Base64 == "") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'url' ou 'base64' são obrigatórios"})
	}

	opts := defaultSendOptions()
	if req.Options != nil {
		opts = *req.Options
	}

	job := queue.SendJob{
		ID:         uuid.New(),
		InstanceID: instance.ID.String(),
		Type:       queue.TypeImage,
		Payload:    queue.SendPayload{To: req.To, MediaB64: req.Base64, MediaURL: req.URL, MimeType: "image/jpeg", Caption: req.Caption},
		Options:    opts,
	}

	msgID, queued, err := enqueueOrSend(job, func() (string, error) {
		data, err := resolveMediaBytes(req.Base64, req.URL)
		if err != nil {
			return "", err
		}
		mime := http.DetectContentType(data)
		return client.SendImageMessage(req.To, data, mime, req.Caption)
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	status := "sent"
	if queued {
		status = "queued"
	}
	go h.logMessage(instance.ID.String(), "out", "image", req.To, msgID, map[string]string{"caption": req.Caption})
	return c.JSON(fiber.Map{"message_id": msgID, "status": status})
}

// SendDocument godoc
// POST /instances/:id/messages/document
func (h *MessageHandler) SendDocument(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To       string `json:"to"`
		URL      string `json:"url"`
		Base64   string `json:"base64"`
		Filename string `json:"filename"`
		Caption  string `json:"caption"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || (req.URL == "" && req.Base64 == "") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'url' ou 'base64' são obrigatórios"})
	}

	docData, err := resolveMediaBytes(req.Base64, req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	filename := req.Filename
	if filename == "" && req.URL != "" {
		filename = filepath.Base(req.URL)
	}
	if filename == "" {
		filename = "file"
	}

	msgID, err := client.SendDocumentMessage(req.To, docData, http.DetectContentType(docData), filename)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "document", req.To, msgID, map[string]string{"filename": filename})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendAudio godoc
// POST /instances/:id/messages/audio
func (h *MessageHandler) SendAudio(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To     string `json:"to"`
		URL    string `json:"url"`
		Base64 string `json:"base64"`
		PTT    bool   `json:"ptt"` // push-to-talk (voice note)
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || (req.URL == "" && req.Base64 == "") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'url' ou 'base64' são obrigatórios"})
	}

	audioData, err := resolveMediaBytes(req.Base64, req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	mime := http.DetectContentType(audioData)
	if !strings.HasPrefix(mime, "audio/") {
		mime = "audio/ogg; codecs=opus"
	}

	msgID, err := client.SendAudioMessage(req.To, audioData, mime, req.PTT)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "audio", req.To, msgID, fiber.Map{"ptt": req.PTT})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendVideo godoc
// POST /instances/:id/messages/video
func (h *MessageHandler) SendVideo(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To      string `json:"to"`
		URL     string `json:"url"`
		Base64  string `json:"base64"`
		Caption string `json:"caption"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || (req.URL == "" && req.Base64 == "") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'url' ou 'base64' são obrigatórios"})
	}

	videoData, err := resolveMediaBytes(req.Base64, req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	mime := http.DetectContentType(videoData)
	if !strings.HasPrefix(mime, "video/") {
		mime = "video/mp4"
	}

	msgID, err := client.SendVideoMessage(req.To, videoData, mime, req.Caption)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "video", req.To, msgID, map[string]string{"caption": req.Caption})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendLocation godoc
// POST /instances/:id/messages/location
func (h *MessageHandler) SendLocation(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To        string  `json:"to"`
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
		Name      string  `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to', 'latitude' e 'longitude' são obrigatórios"})
	}

	msgID, err := client.SendLocationMessage(req.To, req.Latitude, req.Longitude, req.Name)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "location", req.To, msgID, req)

	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendContact godoc
// POST /instances/:id/messages/contact
func (h *MessageHandler) SendContact(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To          string `json:"to"`
		DisplayName string `json:"display_name"`
		// Provide either a full vcard string OR individual fields
		Vcard        string `json:"vcard"`
		Phone        string `json:"phone"`
		Email        string `json:"email"`
		Organization string `json:"organization"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.DisplayName == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'display_name' são obrigatórios"})
	}

	vcard := req.Vcard
	if vcard == "" {
		// Build a minimal vCard 3.0
		vcard = "BEGIN:VCARD\r\nVERSION:3.0\r\n"
		vcard += "FN:" + req.DisplayName + "\r\n"
		vcard += "N:" + req.DisplayName + ";;;;\r\n"
		if req.Phone != "" {
			vcard += "TEL;TYPE=CELL,VOICE:" + req.Phone + "\r\n"
		}
		if req.Email != "" {
			vcard += "EMAIL:" + req.Email + "\r\n"
		}
		if req.Organization != "" {
			vcard += "ORG:" + req.Organization + "\r\n"
		}
		vcard += "END:VCARD"
	}

	msgID, err := client.SendContactMessage(req.To, req.DisplayName, vcard)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "contact", req.To, msgID, map[string]string{"display_name": req.DisplayName})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendReaction godoc
// POST /instances/:id/messages/reaction
func (h *MessageHandler) SendReaction(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To        string `json:"to"`
		MessageID string `json:"message_id"`
		SenderJID string `json:"sender_jid"`
		Reaction  string `json:"reaction"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.MessageID == "" || req.Reaction == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to', 'message_id' e 'reaction' são obrigatórios"})
	}

	if req.SenderJID == "" {
		req.SenderJID = req.To
	}

	msgID, err := client.SendReaction(req.To, req.MessageID, req.SenderJID, req.Reaction)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "reaction", req.To, msgID, req)

	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendPoll godoc
// POST /instances/:id/messages/poll
func (h *MessageHandler) SendPoll(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To              string   `json:"to"`
		Question        string   `json:"question"`
		Options         []string `json:"options"`
		SelectableCount int      `json:"selectable_count"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.Question == "" || len(req.Options) < 2 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to', 'question' e pelo menos 2 'options' são obrigatórios"})
	}
	if len(req.Options) > 12 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "máximo de 12 opções por enquete"})
	}

	msgID, err := client.SendPollMessage(req.To, req.Question, req.Options, req.SelectableCount)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "poll", req.To, msgID, map[string]interface{}{"question": req.Question, "options": req.Options})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendButtons godoc
// POST /instances/:id/messages/buttons
func (h *MessageHandler) SendButtons(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To      string                `json:"to"`
		Body    string                `json:"body"`
		Footer  string                `json:"footer"`
		Buttons []whatsapp.ButtonItem `json:"buttons"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.Body == "" || len(req.Buttons) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to', 'body' e 'buttons' são obrigatórios"})
	}
	if len(req.Buttons) > 3 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "máximo de 3 botões por mensagem"})
	}

	msgID, err := client.SendButtonsMessage(req.To, req.Body, req.Footer, req.Buttons)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "buttons", req.To, msgID, map[string]interface{}{"body": req.Body})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendCarousel godoc
// POST /instances/:id/messages/carousel
//
// Envia um carrossel horizontal de cards interativos (HSCROLL_CARDS).
// Cada card tem cabeçalho (com mídia opcional), corpo e até 3 botões.
func (h *MessageHandler) SendCarousel(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To    string `json:"to"`
		Cards []struct {
			Header struct {
				Title    string `json:"title"`
				ImageURL string `json:"image_url"`
				VideoURL string `json:"video_url"`
			} `json:"header"`
			Body    string                `json:"body"`
			Buttons []whatsapp.ButtonItem `json:"buttons"`
		} `json:"cards"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || len(req.Cards) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'cards' são obrigatórios"})
	}

	cards := make([]whatsapp.CarouselCard, 0, len(req.Cards))
	for _, c := range req.Cards {
		cards = append(cards, whatsapp.CarouselCard{
			Header: whatsapp.CarouselCardHeader{
				Title:    c.Header.Title,
				ImageURL: c.Header.ImageURL,
				VideoURL: c.Header.VideoURL,
			},
			Body:    c.Body,
			Buttons: c.Buttons,
		})
	}

	msgID, err := client.SendCarouselMessage(req.To, cards)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "carousel", req.To, msgID, map[string]interface{}{
		"cards": len(req.Cards),
	})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendPix godoc
// POST /instances/:id/messages/pix
//
// Envia uma cobrança PIX interativa (review_and_pay) — card "Pagar"
// no WhatsApp com chave PIX que o cliente pode confirmar direto.
func (h *MessageHandler) SendPix(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To           string `json:"to"`
		HeaderTitle  string `json:"header_title"`
		BodyText     string `json:"body_text"`
		FooterText   string `json:"footer_text"`
		MerchantName string `json:"merchant_name"`
		PixKey       string `json:"pix_key"`
		KeyType      string `json:"key_type"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'to' é obrigatório"})
	}
	if req.HeaderTitle == "" || req.BodyText == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "header_title e body_text são obrigatórios"})
	}
	if req.MerchantName == "" || req.PixKey == "" || req.KeyType == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "merchant_name, pix_key e key_type são obrigatórios"})
	}

	msgID, err := client.SendPixMessage(req.To, whatsapp.PixData{
		HeaderTitle:  req.HeaderTitle,
		BodyText:     req.BodyText,
		FooterText:   req.FooterText,
		MerchantName: req.MerchantName,
		PixKey:       req.PixKey,
		KeyType:      req.KeyType,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "pix", req.To, msgID, map[string]interface{}{
		"merchant_name": req.MerchantName,
		"key_type":      req.KeyType,
	})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendPixButton godoc
// POST /instances/:id/messages/pix-button
//
// Alias minimalista do /pix — só pix_key + key_type + (opcional)
// merchant_name. Header/body/footer são gerados automaticamente.
// Inspirado no /send/pix-button do UazAPI: uma chamada e UX brasileira
// pronta sem precisar pensar no copy.
func (h *MessageHandler) SendPixButton(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To           string `json:"to"`
		PixKey       string `json:"pix_key"`
		KeyType      string `json:"key_type"`
		MerchantName string `json:"merchant_name"`
		BodyText     string `json:"body_text"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.PixKey == "" || req.KeyType == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to', 'pix_key' e 'key_type' são obrigatórios"})
	}
	merchant := req.MerchantName
	if merchant == "" {
		merchant = "Pagamento PIX"
	}
	body := req.BodyText
	if body == "" {
		body = "Toque em 'Pagar' para confirmar a transferência via PIX."
	}

	msgID, err := client.SendPixMessage(req.To, whatsapp.PixData{
		HeaderTitle:  "Pagamento",
		BodyText:     body,
		FooterText:   "Pagamento seguro via PIX",
		MerchantName: merchant,
		PixKey:       req.PixKey,
		KeyType:      req.KeyType,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "pix", req.To, msgID, map[string]interface{}{
		"merchant_name": merchant,
		"key_type":      req.KeyType,
	})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendTemplate godoc
// POST /instances/:id/messages/template
func (h *MessageHandler) SendTemplate(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To      string                        `json:"to"`
		Content string                        `json:"content"`
		Footer  string                        `json:"footer"`
		Buttons []whatsapp.TemplateButtonItem `json:"buttons"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.Content == "" || len(req.Buttons) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to', 'content' e 'buttons' sao obrigatorios"})
	}

	msgID, err := client.SendTemplateMessage(req.To, req.Content, req.Footer, req.Buttons)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "template", req.To, msgID, map[string]interface{}{
		"content": req.Content,
		"footer":  req.Footer,
		"buttons": req.Buttons,
	})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendList godoc
// POST /instances/:id/messages/list
func (h *MessageHandler) SendList(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To          string                 `json:"to"`
		Title       string                 `json:"title"`
		Description string                 `json:"description"`
		ButtonText  string                 `json:"button_text"`
		Footer      string                 `json:"footer"`
		Sections    []whatsapp.ListSection `json:"sections"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.ButtonText == "" || len(req.Sections) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to', 'button_text' e 'sections' são obrigatórios"})
	}

	msgID, err := client.SendListMessage(req.To, req.Title, req.Description, req.ButtonText, req.Footer, req.Sections)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "list", req.To, msgID, map[string]interface{}{"title": req.Title})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

func parseMenuButtons(choices []string) []whatsapp.ButtonItem {
	buttons := make([]whatsapp.ButtonItem, 0, len(choices))
	for i, raw := range choices {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		parts := strings.SplitN(line, "|", 2)
		text := strings.TrimSpace(parts[0])
		id := fmt.Sprintf("btn_%d", i)
		if len(parts) == 2 && strings.TrimSpace(parts[1]) != "" {
			id = strings.TrimSpace(parts[1])
		}
		if text == "" {
			continue
		}

		buttons = append(buttons, whatsapp.ButtonItem{ID: id, Text: text})
	}
	return buttons
}

func parseMenuSections(choices []string) []whatsapp.ListSection {
	sections := make([]whatsapp.ListSection, 0)
	current := whatsapp.ListSection{Title: "Opcoes"}

	flush := func() {
		if len(current.Rows) == 0 {
			return
		}
		sections = append(sections, current)
		current = whatsapp.ListSection{Title: "Opcoes"}
	}

	for _, raw := range choices {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			flush()
			title := strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(line, "["), "]"))
			if title == "" {
				title = "Opcoes"
			}
			current.Title = title
			continue
		}

		parts := strings.SplitN(line, "|", 3)
		title := strings.TrimSpace(parts[0])
		if title == "" {
			continue
		}

		row := whatsapp.ListRow{
			ID:    fmt.Sprintf("row_%d_%d", len(sections), len(current.Rows)),
			Title: title,
		}
		if len(parts) >= 2 && strings.TrimSpace(parts[1]) != "" {
			row.ID = strings.TrimSpace(parts[1])
		}
		if len(parts) == 3 {
			row.Description = strings.TrimSpace(parts[2])
		}
		current.Rows = append(current.Rows, row)
	}

	flush()
	return sections
}

func buildCarouselFallback(text, footer string, choices []string) string {
	var sb strings.Builder
	if strings.TrimSpace(text) != "" {
		sb.WriteString(strings.TrimSpace(text))
	}

	appendLine := func(line string) {
		line = strings.TrimSpace(line)
		if line == "" {
			return
		}
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(line)
	}

	for _, raw := range choices {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}

		switch {
		case strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]"):
			appendLine("")
			appendLine("*" + strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(line, "["), "]")) + "*")
		case strings.HasPrefix(line, "{") && strings.HasSuffix(line, "}"):
			appendLine(strings.TrimSpace(strings.TrimSuffix(strings.TrimPrefix(line, "{"), "}")))
		default:
			parts := strings.SplitN(line, "|", 2)
			label := strings.TrimSpace(parts[0])
			target := ""
			if len(parts) == 2 {
				target = strings.TrimSpace(parts[1])
			}
			if target != "" {
				appendLine(fmt.Sprintf("- %s: %s", label, target))
			} else {
				appendLine("- " + label)
			}
		}
	}

	if strings.TrimSpace(footer) != "" {
		appendLine("")
		appendLine("_" + strings.TrimSpace(footer) + "_")
	}

	return strings.TrimSpace(sb.String())
}

// SendMenu godoc
// POST /instances/:id/messages/menu
func (h *MessageHandler) SendMenu(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		Number          string   `json:"number"`
		Type            string   `json:"type"`
		Text            string   `json:"text"`
		Choices         []string `json:"choices"`
		FooterText      string   `json:"footerText"`
		ListButton      string   `json:"listButton"`
		SelectableCount int      `json:"selectableCount"`
	}
	if err := c.BodyParser(&req); err != nil || req.Number == "" || req.Type == "" || req.Text == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'number', 'type' e 'text' sao obrigatorios"})
	}

	var msgID string
	switch strings.ToLower(strings.TrimSpace(req.Type)) {
	case "button", "buttons":
		buttons := parseMenuButtons(req.Choices)
		if len(buttons) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "envie pelo menos um botao valido em 'choices'"})
		}
		if len(buttons) > 3 {
			buttons = buttons[:3]
		}
		msgID, err = client.SendButtonsMessage(req.Number, req.Text, req.FooterText, buttons)
	case "list":
		sections := parseMenuSections(req.Choices)
		if len(sections) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "envie pelo menos uma secao ou item valido em 'choices'"})
		}
		buttonText := strings.TrimSpace(req.ListButton)
		if buttonText == "" {
			buttonText = "Ver opcoes"
		}
		msgID, err = client.SendListMessage(req.Number, "", req.Text, buttonText, req.FooterText, sections)
	case "poll":
		options := make([]string, 0, len(req.Choices))
		for _, raw := range req.Choices {
			line := strings.TrimSpace(raw)
			if line != "" {
				options = append(options, line)
			}
		}
		if len(options) < 2 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "enquete precisa de pelo menos 2 opcoes"})
		}
		msgID, err = client.SendPollMessage(req.Number, req.Text, options, req.SelectableCount)
	case "carousel":
		fallbackText := buildCarouselFallback(req.Text, req.FooterText, req.Choices)
		msgID, err = client.SendTextMessage(req.Number, fallbackText)
	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "tipo de menu nao suportado"})
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "menu", req.Number, msgID, map[string]interface{}{
		"type":    req.Type,
		"text":    req.Text,
		"choices": req.Choices,
	})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendSticker godoc
// POST /instances/:id/messages/sticker
func (h *MessageHandler) SendSticker(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To         string `json:"to"`
		URL        string `json:"url"`
		Base64     string `json:"base64"`
		IsAnimated bool   `json:"is_animated"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || (req.URL == "" && req.Base64 == "") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'url' ou 'base64' são obrigatórios"})
	}

	stickerData, err := resolveMediaBytes(req.Base64, req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	msgID, err := client.SendStickerMessage(req.To, stickerData, req.IsAnimated)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "sticker", req.To, msgID, nil)
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendStatus godoc
// POST /instances/:id/messages/status
func (h *MessageHandler) SendStatus(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		Text     string `json:"text"`
		MediaB64 string `json:"media_base64"`
		MimeType string `json:"mime_type"`
		BgColor  string `json:"bg_color"`
	}
	if err := c.BodyParser(&req); err != nil || (req.Text == "" && req.MediaB64 == "") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'text' ou 'media_base64' é obrigatório"})
	}

	var mediaData []byte
	if req.MediaB64 != "" {
		mediaData, err = base64.StdEncoding.DecodeString(req.MediaB64)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "media_base64 inválido"})
		}
	}

	msgID, err := client.SendStatusMessage(req.Text, mediaData, req.MimeType, req.BgColor)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "status", "status@broadcast", msgID, map[string]string{"text": req.Text})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// SendPresence godoc
// POST /instances/:id/messages/presence
func (h *MessageHandler) SendPresence(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}

	var req struct {
		Available bool `json:"available"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo JSON inválido"})
	}

	if err := client.SendPresenceUpdate(req.Available); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	status := "unavailable"
	if req.Available {
		status = "available"
	}
	return c.JSON(fiber.Map{"status": status})
}

// RequestPayment godoc
// POST /instances/:id/messages/payment-request
func (h *MessageHandler) RequestPayment(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To       string  `json:"to"`
		Currency string  `json:"currency"`
		Amount   float64 `json:"amount"`
		Note     string  `json:"note"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.Amount <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'amount' são obrigatórios"})
	}

	currency := req.Currency
	if currency == "" {
		currency = "BRL"
	}

	msgID, err := client.RequestPayment(req.To, currency, req.Amount, req.Note)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	go h.logMessage(instance.ID.String(), "out", "payment_request", req.To, msgID, map[string]interface{}{"amount": req.Amount, "currency": currency})
	return c.JSON(fiber.Map{"message_id": msgID, "status": "sent"})
}

// UploadMedia godoc
// POST /instances/:id/media/upload
// Accepts multipart/form-data with field "file", stores in MinIO and returns the URL.
func (h *MessageHandler) UploadMedia(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	if !storage.IsConfigured() {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "armazenamento de mídia não configurado (MinIO/S3)",
		})
	}

	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'file' é obrigatório"})
	}

	if file.Size > 64*1024*1024 { // 64 MB limit
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"error": "arquivo muito grande (máx 64 MB)"})
	}

	f, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao abrir arquivo"})
	}
	defer f.Close()

	data := make([]byte, file.Size)
	if _, err := f.Read(data); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao ler arquivo"})
	}

	// Detect MIME from header or filename
	mime := file.Header.Get("Content-Type")
	if mime == "" || mime == "application/octet-stream" {
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(file.Filename), "."))
		mimes := map[string]string{
			"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
			"webp": "image/webp", "gif": "image/gif", "mp4": "video/mp4",
			"mp3": "audio/mpeg", "ogg": "audio/ogg", "pdf": "application/pdf",
		}
		if m, ok := mimes[ext]; ok {
			mime = m
		} else {
			mime = "application/octet-stream"
		}
	}

	ext := storage.MimeToExt(mime)
	objectName := storage.MediaObjectName(instance.ID.String(), ext)

	url, err := storage.GlobalStorage.UploadBytes(context.Background(), objectName, data, mime)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha no upload: " + err.Error()})
	}

	var userID *uuid.UUID
	if v, ok := c.Locals("user_id").(uuid.UUID); ok && v != uuid.Nil {
		userID = &v
	} else {
		uid := instance.UserID
		userID = &uid
	}
	media := models.MediaFile{
		WorkspaceID: instance.WorkspaceID,
		UserID:      userID,
		InstanceID:  &instance.ID,
		ObjectKey:   objectName,
		Bucket:      storage.GlobalStorage.BucketName(),
		MediaType:   mediaTypeFromMIME(mime),
		MimeType:    mime,
		Filename:    file.Filename,
		SizeBytes:   file.Size,
		PublicURL:   url,
	}
	if err := h.db.Create(&media).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao registrar mídia: " + err.Error()})
	}

	return c.JSON(fiber.Map{
		"id":           media.ID,
		"media_id":     media.ID,
		"url":          url,
		"public_url":   "/m/" + media.ID.String(),
		"download_url": "/v1/media/files/" + media.ID.String() + "/download",
		"stream_url":   "/v1/media/files/" + media.ID.String() + "/stream",
		"media_key":    objectName,
		"object_name":  objectName,
		"media_type":   media.MediaType,
		"mime_type":    mime,
		"size":         file.Size,
		"size_bytes":   file.Size,
		"filename":     file.Filename,
	})
}

func mediaTypeFromMIME(mime string) string {
	base := strings.ToLower(strings.TrimSpace(strings.Split(mime, ";")[0]))
	switch {
	case strings.HasPrefix(base, "image/"):
		return "image"
	case strings.HasPrefix(base, "audio/"):
		return "audio"
	case strings.HasPrefix(base, "video/"):
		return "video"
	case base == "application/pdf" || strings.HasPrefix(base, "application/") || strings.HasPrefix(base, "text/"):
		return "document"
	default:
		return "file"
	}
}

// RevokeMessage godoc
// POST /instances/:id/messages/revoke
func (h *MessageHandler) RevokeMessage(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		To        string `json:"to"`
		MessageID string `json:"message_id"`
		SenderJID string `json:"sender_jid"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.MessageID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'message_id' são obrigatórios"})
	}
	msgID, err := client.RevokeMessage(req.To, req.MessageID, req.SenderJID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message_id": msgID, "status": "revoked"})
}

// SendTyping godoc
// POST /instances/:id/messages/typing
func (h *MessageHandler) SendTyping(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		To     string `json:"to"`
		Typing bool   `json:"typing"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'to' é obrigatório"})
	}
	if err := client.SendTyping(req.To, req.Typing); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

// MarkRead godoc
// POST /instances/:id/messages/read
func (h *MessageHandler) MarkRead(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		Chat       string   `json:"chat"`
		MessageIDs []string `json:"message_ids"`
	}
	if err := c.BodyParser(&req); err != nil || req.Chat == "" || len(req.MessageIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'chat' e 'message_ids' são obrigatórios"})
	}
	if err := client.MarkChatRead(req.Chat, req.MessageIDs); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

// BulkCheckNumbers godoc
// POST /instances/:id/bulk-check
func (h *MessageHandler) BulkCheckNumbers(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		Phones []string `json:"phones"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.Phones) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'phones' é obrigatório"})
	}
	if len(req.Phones) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "máximo de 100 números por requisição"})
	}
	results, err := client.BulkCheckNumbers(req.Phones)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"results": results, "total": len(results)})
}

// GetMessages godoc
// GET /instances/:id/messages
func (h *MessageHandler) GetMessages(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)

	var logs []models.MessageLog
	if err := h.db.Where("instance_id = ?", instance.ID).
		Order("created_at DESC").
		Limit(limit).Offset(offset).
		Find(&logs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar mensagens"})
	}

	var total int64
	h.db.Model(&models.MessageLog{}).Where("instance_id = ?", instance.ID).Count(&total)

	return c.JSON(fiber.Map{
		"data":   logs,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

// GetMessage godoc
// GET /instances/:id/messages/:msgID
//
// Retorna UMA mensagem por ID — funciona com qualquer tipo (texto,
// imagem, áudio, sticker, location, contact, poll, button, list,
// pix, carousel, ...) sem precisar do chat_jid ou conversation_id.
//
// Aceita tanto:
//   - UUID interno (MessageLog.ID): "uuid-v4-aqui"
//   - External message ID (stanza_id do WhatsApp): "ABCD1234..."
//
// Resolve nessa ordem: tenta como UUID; se inválido OU não achou,
// busca por external_message_id. Resposta inclui o registro completo
// + parsing do content (que é JSON serializado pra mídia).
//
// Por que existe: WhatsApp/whatsmeow não tem nenhum endpoint REST
// "GET message by id" no protocolo — a única busca por id é via
// nosso storage local (MessageLog). Esse handler centraliza isso.
func (h *MessageHandler) GetMessage(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	msgID := c.Params("msgID")
	if msgID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "msgID é obrigatório"})
	}

	var ml models.MessageLog
	q := h.db.Where("instance_id = ?", instance.ID)

	// Tenta primeiro como UUID interno.
	if parsed, err := uuid.Parse(msgID); err == nil {
		if err := q.Where("id = ?", parsed).First(&ml).Error; err == nil {
			return c.JSON(decorateMessage(&ml))
		}
	}
	// Fallback 1: external_message_id (wamid / stanza id WhatsApp).
	if err := q.Where("external_message_id = ?", msgID).First(&ml).Error; err == nil {
		return c.JSON(decorateMessage(&ml))
	}
	// Fallback 2: meta_media_id — WABA media object ID (campo no content JSON).
	// Necessário porque n8n/webhooks frequentemente recebem o media object ID
	// (messages[0].image.id) em vez do wamid (messages[0].id).
	if err := q.Where("content::jsonb->>'meta_media_id' = ?", msgID).First(&ml).Error; err == nil {
		return c.JSON(decorateMessage(&ml))
	}
	return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
		"error":   "mensagem não encontrada",
		"hint":    "msgID aceito: UUID interno, wamid (external_message_id) ou meta_media_id (media object ID da Meta)",
		"queried": msgID,
	})
}

// decorateMessage enriquece o MessageLog antes de devolver: parseia
// content JSON pra um campo `content_parsed` quando aplicável (mídia,
// location, etc.), e expõe alias amigável `message_id` = ID externo.
func decorateMessage(ml *models.MessageLog) fiber.Map {
	out := fiber.Map{
		"id":                  ml.ID,
		"message_id":          ml.ExternalMessageID,
		"instance_id":         ml.InstanceID,
		"workspace_id":        ml.WorkspaceID,
		"conversation_id":     ml.ConversationID,
		"direction":           ml.Direction,
		"type":                ml.Type,
		"to_jid":              ml.ToJID,
		"sender_jid":          ml.SenderJID,
		"sender_name":         ml.SenderName,
		"contact_name":        ml.ContactName,
		"contact_avatar":      ml.ContactAvatar,
		"content":             ml.Content,
		"status":              ml.Status,
		"is_pinned":           ml.IsPinned,
		"is_favorite":         ml.IsFavorite,
		"is_archived":         ml.IsArchived,
		"is_deleted":          ml.IsDeleted,
		"is_internal_note":    ml.IsInternalNote,
		"is_edited":           ml.IsEdited,
		"reply_to_id":         ml.ReplyToID,
		"external_message_id": ml.ExternalMessageID,
		"delivered_at":        ml.DeliveredAt,
		"read_at":             ml.ReadAt,
		"created_at":          ml.CreatedAt,
	}
	// Se content é JSON, parseia e expõe — facilita pro cliente não ter
	// que dar JSON.parse() em cima de uma string.
	if ml.Content != "" && (strings.HasPrefix(ml.Content, "{") || strings.HasPrefix(ml.Content, "[")) {
		var parsed interface{}
		if err := json.Unmarshal([]byte(ml.Content), &parsed); err == nil {
			out["content_parsed"] = parsed
		}
	}
	return out
}

// GetChats godoc
// GET /instances/:id/chats
func (h *MessageHandler) GetChats(c *fiber.Ctx) error {
	_, err := h.getClient(c)
	if err != nil {
		return err
	}
	// whatsmeow doesn't expose a direct chat list — return distinct JIDs from logs
	instance := c.Locals("instance").(*models.Instance)

	var chats []struct {
		JID      string `json:"jid"`
		LastMsg  string `json:"last_message"`
		LastTime string `json:"last_time"`
	}
	h.db.Raw(`
		SELECT to_jid as jid, content as last_message, created_at as last_time
		FROM message_logs
		WHERE instance_id = ? AND to_jid != ''
		GROUP BY to_jid
		ORDER BY MAX(created_at) DESC
		LIMIT 100
	`, instance.ID).Scan(&chats)

	return c.JSON(chats)
}

// GetContacts godoc
// GET /instances/:id/contacts
func (h *MessageHandler) GetContacts(c *fiber.Ctx) error {
	_, err := h.getClient(c)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"contacts": []interface{}{}, "message": "use webhooks para capturar contatos em tempo real"})
}

// CheckNumber godoc
// POST /instances/:id/check-number
func (h *MessageHandler) CheckNumber(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}

	var req struct {
		Phone string `json:"phone"`
	}
	if err := c.BodyParser(&req); err != nil || req.Phone == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'phone' é obrigatório"})
	}

	exists, jid, err := client.CheckNumber(req.Phone)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"phone":  req.Phone,
		"exists": exists,
		"jid":    jid,
	})
}
