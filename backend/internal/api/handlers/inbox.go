package handlers

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type InboxHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewInboxHandler(db *gorm.DB, manager *whatsapp.Manager) *InboxHandler {
	return &InboxHandler{db: db, manager: manager}
}

type InboxChat struct {
	JID         string `json:"jid"`
	Name        string `json:"name"`
	Phone       string `json:"phone"`
	Avatar      string `json:"avatar,omitempty"`
	LastMessage string `json:"last_message"`
	LastTime    string `json:"last_time"`
	UnreadCount int    `json:"unread_count"`
	IsOnline    bool   `json:"is_online"`
	Typing      bool   `json:"typing"`
}

type InboxMessage struct {
	ID        string `json:"id"`
	Content   string `json:"content"`
	FromMe    bool   `json:"from_me"`
	Timestamp int64  `json:"timestamp"`
	Status    string `json:"status"`
	Type      string `json:"type"`
}

type InboxContact struct {
	JID         string   `json:"jid"`
	Name        string   `json:"name"`
	Phone       string   `json:"phone"`
	Avatar      string   `json:"avatar,omitempty"`
	IsBusiness  bool     `json:"is_business"`
	Description string   `json:"description,omitempty"`
	Email       string   `json:"email,omitempty"`
	Tags        []string `json:"tags"`
	Funnel      string   `json:"funnel,omitempty"`
	Stage       string   `json:"stage,omitempty"`
	Journey     string   `json:"journey,omitempty"`
}

// GetChats returns all conversations for an instance
func (h *InboxHandler) GetChats(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	search := c.Query("search", "")

	type rawChat struct {
		ToJID         string `gorm:"column:to_j_id"`
		Content       string `gorm:"column:content"`
		MaxTime       string `gorm:"column:max_time"`
		MsgCount      int64  `gorm:"column:cnt"`
		ContactName   string `gorm:"column:contact_name"`
		ContactAvatar string `gorm:"column:contact_avatar"`
	}

	var rawChatsResult []rawChat

	// Use normalized JID to avoid duplicates when instance reconnects
	h.db.Raw(`
		SELECT 
			SUBSTR(m.to_j_id, 1, CASE WHEN INSTR(m.to_j_id, '@') > 0 THEN INSTR(m.to_j_id, '@') - 1 ELSE LENGTH(m.to_j_id) END) as normalized_jid,
			m.to_j_id,
			m.content,
			m.created_at as max_time,
			cnt.cnt,
			m.contact_name,
			m.contact_avatar
		FROM message_logs m
		JOIN (
			SELECT 
				SUBSTR(to_j_id, 1, CASE WHEN INSTR(to_j_id, '@') > 0 THEN INSTR(to_j_id, '@') - 1 ELSE LENGTH(to_j_id) END) as norm_jid,
				COUNT(*) as cnt
			FROM message_logs
			WHERE instance_id = ? AND to_j_id != '' AND to_j_id NOT LIKE '%@g.us%'
			GROUP BY norm_jid
		) cnt ON SUBSTR(m.to_j_id, 1, CASE WHEN INSTR(m.to_j_id, '@') > 0 THEN INSTR(m.to_j_id, '@') - 1 ELSE LENGTH(m.to_j_id) END) = cnt.norm_jid
		JOIN (
			SELECT 
				SUBSTR(to_j_id, 1, CASE WHEN INSTR(to_j_id, '@') > 0 THEN INSTR(to_j_id, '@') - 1 ELSE LENGTH(to_j_id) END) as norm_jid,
				MAX(created_at) as max_created_at
			FROM message_logs
			WHERE instance_id = ? AND to_j_id != '' AND to_j_id NOT LIKE '%@g.us%'
			GROUP BY norm_jid
		) latest ON SUBSTR(m.to_j_id, 1, CASE WHEN INSTR(m.to_j_id, '@') > 0 THEN INSTR(m.to_j_id, '@') - 1 ELSE LENGTH(m.to_j_id) END) = latest.norm_jid AND m.created_at = latest.max_created_at
		WHERE m.instance_id = ?
	`, instance.ID, instance.ID, instance.ID).
		Where("m.to_j_id LIKE ?", "%"+search+"%").
		Order("m.created_at DESC").
		Limit(50).
		Scan(&rawChatsResult)

	// Track seen JIDs to prevent duplicates
	seenJIDs := make(map[string]bool)
	chats := make([]InboxChat, 0, len(rawChatsResult))

	for _, rc := range rawChatsResult {
		// Normalize JID - use phone number only
		phone := extractPhoneFromJID(rc.ToJID)

		// Skip if we've already seen this contact
		if seenJIDs[phone] {
			continue
		}
		seenJIDs[phone] = true

		lastMsg := rc.Content
		var msgContent string
		if err := json.Unmarshal([]byte(lastMsg), &msgContent); err == nil {
			lastMsg = msgContent
		}

		name := rc.ContactName
		avatar := rc.ContactAvatar

		// Fallback if no stored info
		if name == "" {
			name = phone
			// Try CRM
			if contact := h.findContactByPhone(phone); contact != nil {
				name = contact.Name
			}
		}

		chat := InboxChat{
			JID:         rc.ToJID,
			Name:        name,
			Phone:       phone,
			Avatar:      avatar,
			LastMessage: truncateMessage(lastMsg, 60),
			LastTime:    rc.MaxTime,
			UnreadCount: 0,
		}
		chats = append(chats, chat)
	}

	return c.JSON(fiber.Map{
		"chats":     chats,
		"total":     len(chats),
		"connected": true,
	})
}

// GetChat returns details about a specific chat
func (h *InboxHandler) GetChat(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	jid := c.Params("jid")
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "jid é obrigatório"})
	}

	phone := extractPhoneFromJID(jid)
	contact := h.findContactByPhone(phone)

	contactInfo := InboxContact{
		JID:   jid,
		Phone: phone,
		Name:  phone,
	}

	// First, try to get stored contact info from message_logs (normalize JID for search)
	var storedInfo struct {
		ContactName   string
		ContactAvatar string
	}
	// Search by normalized phone number to handle different JID formats
	h.db.Model(&models.MessageLog{}).
		Select("contact_name, contact_avatar").
		Where("instance_id = ? AND (to_j_id LIKE ? OR to_j_id LIKE ?)",
			instance.ID,
			phone+"@%",
			"%"+phone+"%").
		Where("contact_name != '' OR contact_avatar != ''").
		Order("created_at DESC").
		Limit(1).
		Scan(&storedInfo)

	if storedInfo.ContactName != "" {
		contactInfo.Name = storedInfo.ContactName
	}
	if storedInfo.ContactAvatar != "" {
		contactInfo.Avatar = storedInfo.ContactAvatar
	}

	// If no stored info, try WhatsApp
	client := h.manager.GetInstance(instance.ID.String())
	if client != nil && client.IsConnected() {
		// Ensure JID has proper format for WhatsApp
		queryJID := jid
		if !strings.Contains(jid, "@") {
			queryJID = jid + "@s.whatsapp.net"
		}
		if contactInfo.Avatar == "" {
			if picURL := client.GetContactProfilePicture(queryJID); picURL != "" {
				contactInfo.Avatar = picURL
			}
		}
		if contactInfo.Name == phone {
			if _, pushName := client.GetContactInfo(queryJID); pushName != "" {
				contactInfo.Name = pushName
			}
		}
	}

	// CRM data overrides/supplements WhatsApp data
	if contact != nil {
		contactInfo.Name = contact.Name
		contactInfo.Email = contact.Email
		contactInfo.Description = contact.Notes
		contactInfo.Funnel = contact.Funnel
		contactInfo.Stage = contact.Stage
		contactInfo.Journey = contact.Journey
		tags := make([]string, len(contact.Tags))
		for i, t := range contact.Tags {
			tags[i] = t.Name
		}
		contactInfo.Tags = tags
	}

	type statsResult struct {
		TotalSent     int64 `json:"total_sent"`
		TotalReceived int64 `json:"total_received"`
		UnreadCount   int64 `json:"unread_count"`
	}
	var stats statsResult
	h.db.Raw(`
		SELECT 
			COALESCE(SUM(CASE WHEN direction = 'out' THEN 1 ELSE 0 END), 0) as total_sent,
			COALESCE(SUM(CASE WHEN direction = 'in' THEN 1 ELSE 0 END), 0) as total_received,
			0 as unread_count
		FROM message_logs 
		WHERE instance_id = ? AND to_j_id = ?
	`, instance.ID, jid).Scan(&stats)

	return c.JSON(fiber.Map{
		"contact": contactInfo,
		"stats": fiber.Map{
			"total_sent":     stats.TotalSent,
			"total_received": stats.TotalReceived,
			"last_seen":      "online",
		},
	})
}

// GetMessages returns messages for a specific chat
func (h *InboxHandler) GetMessages(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	jid := c.Params("jid")
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "jid é obrigatório"})
	}

	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)
	before := c.Query("before", "")

	var logs []models.MessageLog
	query := h.db.Where("instance_id = ? AND to_j_id = ?", instance.ID, jid).
		Order("created_at DESC")

	if before != "" {
		t, _ := time.Parse(time.RFC3339, before)
		if !t.IsZero() {
			query = query.Where("created_at < ?", t)
		}
	}

	if err := query.Limit(limit).Offset(offset).Find(&logs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar mensagens"})
	}

	messages := make([]InboxMessage, 0, len(logs))
	for _, log := range logs {
		content := log.Content
		var msgContent string
		if err := json.Unmarshal([]byte(content), &msgContent); err == nil {
			content = msgContent
		}

		timestamp := log.CreatedAt.Unix()
		if log.ID != uuid.Nil {
			timestamp = log.CreatedAt.Unix()
		}

		messages = append(messages, InboxMessage{
			ID:        log.ID.String(),
			Content:   content,
			FromMe:    log.Direction == models.DirectionOut,
			Timestamp: timestamp,
			Status:    string(log.Status),
			Type:      log.Type,
		})
	}

	reverseMessages(messages)

	var total int64
	h.db.Model(&models.MessageLog{}).Where("instance_id = ? AND to_j_id = ?", instance.ID, jid).Count(&total)

	return c.JSON(fiber.Map{
		"messages": messages,
		"total":    total,
		"has_more": offset+len(logs) < int(total),
	})
}

// SendMessage sends a message to a contact
func (h *InboxHandler) SendMessage(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	jid := c.Params("jid")
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "jid é obrigatório"})
	}

	var req struct {
		Content string `json:"content"`
		Type    string `json:"type"`
	}
	if err := c.BodyParser(&req); err != nil || req.Content == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "conteúdo é obrigatório"})
	}

	if req.Type == "" {
		req.Type = "text"
	}

	client := h.manager.GetInstance(instance.ID.String())
	if client == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cliente não conectado"})
	}

	msgID := uuid.New()

	contentJSON, _ := json.Marshal(req.Content)
	log := models.MessageLog{
		ID:         msgID,
		InstanceID: instance.ID,
		Direction:  models.DirectionOut,
		Type:       req.Type,
		ToJID:      jid,
		Content:    string(contentJSON),
		Status:     models.MessageStatusPending,
	}
	h.db.Create(&log)

	go func() {
		var msgIDStr string
		var err error

		switch req.Type {
		case "text":
			msgIDStr, err = client.SendTextMessage(jid, req.Content)
		default:
			// For media types, treat content as text for now
			// Media sending should use separate endpoint with file upload
			msgIDStr, err = client.SendTextMessage(jid, req.Content)
		}

		status := models.MessageStatusSent
		if err != nil {
			status = models.MessageStatusFailed
		}

		h.db.Model(&log).Updates(map[string]interface{}{
			"status": status,
		})
		_ = msgIDStr
	}()

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":        msgID.String(),
		"status":    "sending",
		"timestamp": time.Now().Unix(),
	})
}

// SendMedia sends a media message
func (h *InboxHandler) SendMedia(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	jid := c.Params("jid")
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "jid é obrigatório"})
	}

	var req struct {
		URL      string `json:"url"`
		Caption  string `json:"caption"`
		MimeType string `json:"mime_type"`
	}
	if err := c.BodyParser(&req); err != nil || req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "url é obrigatório"})
	}

	client := h.manager.GetInstance(instance.ID.String())
	if client == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cliente não conectado"})
	}

	msgID := uuid.New()
	contentJSON, _ := json.Marshal(map[string]string{"url": req.URL, "caption": req.Caption})
	log := models.MessageLog{
		ID:         msgID,
		InstanceID: instance.ID,
		Direction:  models.DirectionOut,
		Type:       "image",
		ToJID:      jid,
		Content:    string(contentJSON),
		Status:     models.MessageStatusPending,
	}
	h.db.Create(&log)

	go func() {
		_, err := client.SendTextMessage(jid, req.Caption)
		status := models.MessageStatusSent
		if err != nil {
			status = models.MessageStatusFailed
		}
		h.db.Model(&log).Updates(map[string]interface{}{"status": status})
	}()

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":        msgID.String(),
		"status":    "sending",
		"timestamp": time.Now().Unix(),
	})
}

// MarkRead marks messages as read
func (h *InboxHandler) MarkRead(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	jid := c.Params("jid")
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "jid é obrigatório"})
	}

	h.db.Model(&models.MessageLog{}).
		Where("instance_id = ? AND to_j_id = ? AND direction = 'in' AND status != 'read'", instance.ID, jid).
		Update("status", models.MessageStatusRead)

	return c.JSON(fiber.Map{"success": true})
}

// Typing sends a typing indicator
func (h *InboxHandler) Typing(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	jid := c.Params("jid")
	var req struct {
		Typing bool `json:"typing"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	client := h.manager.GetInstance(instance.ID.String())
	if client != nil {
		client.SendTyping(jid, req.Typing)
	}

	return c.JSON(fiber.Map{"success": true})
}

// Helper functions

func extractPhoneFromJID(jid string) string {
	if idx := strings.Index(jid, "@"); idx > 0 {
		return jid[:idx]
	}
	return jid
}

func truncateMessage(msg string, maxLen int) string {
	if len(msg) <= maxLen {
		return msg
	}
	return msg[:maxLen-3] + "..."
}

func (h *InboxHandler) findContactByPhone(phone string) *models.Contact {
	var contact models.Contact
	normalized := normalizePhone(phone)

	if err := h.db.Where("REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?", "%"+normalized+"%").
		First(&contact).Error; err == nil {
		return &contact
	}
	return nil
}

func normalizePhone(phone string) string {
	result := ""
	for _, c := range phone {
		if c >= '0' && c <= '9' {
			result += string(c)
		}
	}
	return result
}

func reverseMessages(msgs []InboxMessage) {
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
}
