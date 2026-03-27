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
}

// SendText godoc
// POST /instances/:id/messages/text
func (h *MessageHandler) SendText(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To      string            `json:"to"`
		Text    string            `json:"text"`
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
		Vcard       string `json:"vcard"`
		Phone       string `json:"phone"`
		Email       string `json:"email"`
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
		To      string                    `json:"to"`
		Body    string                    `json:"body"`
		Footer  string                    `json:"footer"`
		Buttons []whatsapp.ButtonItem     `json:"buttons"`
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

// SendList godoc
// POST /instances/:id/messages/list
func (h *MessageHandler) SendList(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	instance := c.Locals("instance").(*models.Instance)

	var req struct {
		To          string                     `json:"to"`
		Title       string                     `json:"title"`
		Description string                     `json:"description"`
		ButtonText  string                     `json:"button_text"`
		Footer      string                     `json:"footer"`
		Sections    []whatsapp.ListSection     `json:"sections"`
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

	return c.JSON(fiber.Map{
		"url":         url,
		"object_name": objectName,
		"mime_type":   mime,
		"size":        file.Size,
		"filename":    file.Filename,
	})
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
		To      string `json:"to"`
		Typing  bool   `json:"typing"`
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
