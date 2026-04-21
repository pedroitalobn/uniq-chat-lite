package handlers

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// phoneKeyExpr returns a SQL expression that yields the part of to_jid
// before the '@' separator — used to group chats by phone number. The
// previous INSTR/SUBSTR form is SQLite-only; on Postgres it errored and
// the inbox came back empty because .Scan() swallowed the failure.
func phoneKeyExpr(db *gorm.DB) string {
	switch db.Dialector.Name() {
	case "postgres":
		return "SPLIT_PART(to_jid, '@', 1)"
	default:
		return "SUBSTR(to_jid, 1, CASE WHEN INSTR(to_jid, '@') > 0 THEN INSTR(to_jid, '@') - 1 ELSE LENGTH(to_jid) END)"
	}
}

type InboxHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewInboxHandler(db *gorm.DB, manager *whatsapp.Manager) *InboxHandler {
	return &InboxHandler{db: db, manager: manager}
}

type InboxChat struct {
	InstanceID  string `json:"instance_id,omitempty"`
	JID         string `json:"jid"`
	Name        string `json:"name"`
	Phone       string `json:"phone"`
	Avatar      string `json:"avatar,omitempty"`
	LastMessage string `json:"last_message"`
	LastTime    string `json:"last_time"`
	UnreadCount int    `json:"unread_count"`
	IsOnline    bool   `json:"is_online"`
	Typing      bool   `json:"typing"`
	IsGroup     bool   `json:"is_group"`
	IsFavorite  bool   `json:"is_favorite,omitempty"`
	IsArchived  bool   `json:"is_archived,omitempty"`
}

type InboxMessage struct {
	ID         string `json:"id"`
	Content    string `json:"content"`
	FromMe     bool   `json:"from_me"`
	Timestamp  int64  `json:"timestamp"`
	Status     string `json:"status"`
	Type       string `json:"type"`
	IsPinned   *bool  `json:"is_pinned,omitempty"`
	IsFavorite *bool  `json:"is_favorite,omitempty"`
	IsArchived *bool  `json:"is_archived,omitempty"`
	IsDeleted  *bool  `json:"is_deleted,omitempty"`
	SenderJID  string `json:"sender_jid,omitempty"`
	SenderName string `json:"sender_name,omitempty"`
}

type InboxContact struct {
	JID         string   `json:"jid"`
	ContactID   string   `json:"contact_id,omitempty"`
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
	Source      string   `json:"source,omitempty"`
	OwnerName   string   `json:"owner_name,omitempty"`
	Notes       string   `json:"notes,omitempty"`
}

// GetChats returns all conversations for an instance
func (h *InboxHandler) GetChats(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	search := c.Query("search", "")
	filter := c.Query("filter", "all") // all, unread, starred, archived

	type rawChat struct {
		ToJID         string `gorm:"column:to_jid"`
		Content       string `gorm:"column:content"`
		MaxTime       string `gorm:"column:max_time"`
		MsgCount      int64  `gorm:"column:cnt"`
		UnreadCount   int64  `gorm:"column:unread_cnt"`
		ContactName   string `gorm:"column:contact_name"`
		ContactAvatar string `gorm:"column:contact_avatar"`
		Direction     string `gorm:"column:direction"`
		IsFavorite    bool   `gorm:"column:is_favorite"`
		IsArchived    bool   `gorm:"column:is_archived"`
	}

	var rawChatsResult []rawChat

	instancePhoneNormalized := ""
	if instance.PhoneNumber != "" {
		// Normalize the instance phone number to match the format in to_jid
		phoneNum := strings.ReplaceAll(instance.PhoneNumber, "+", "")
		phoneNum = strings.ReplaceAll(phoneNum, " ", "")
		phoneNum = strings.ReplaceAll(phoneNum, "-", "")
		phoneNum = strings.ReplaceAll(phoneNum, "(", "")
		phoneNum = strings.ReplaceAll(phoneNum, ")", "")
		instancePhoneNormalized = phoneNum
	}

	phoneExpr := phoneKeyExpr(h.db)

	// Base filter to exclude the instance's own number
	excludeSelf := ""
	if instancePhoneNormalized != "" {
		excludeSelf = "AND " + phoneExpr + " != '" + instancePhoneNormalized + "'"
	}

	// Base filter: descarta newsletter, lid, broadcast e mensagens apagadas.
	// O filtro de arquivados/starred/unread é aplicado no outer SELECT pra
	// usar o unread_count agregado por chat.
	baseWhere := "instance_id = ? AND to_jid != '' " + excludeSelf + " AND to_jid NOT LIKE '%@newsletter%' AND to_jid NOT LIKE '%@lid%' AND to_jid != 'status@broadcast' AND NOT is_deleted"

	// Outer filter muda conforme a aba escolhida.
	outerWhere := "rn = 1"
	switch filter {
	case "starred":
		outerWhere += " AND is_favorite = TRUE"
	case "archived":
		outerWhere += " AND is_archived = TRUE"
	case "unread":
		outerWhere += " AND unread_cnt > 0 AND is_archived = FALSE"
	default: // "all"
		outerWhere += " AND is_archived = FALSE"
	}

	partition := "CASE WHEN to_jid LIKE '%@g.us' THEN to_jid ELSE " + phoneExpr + " END"
	// Postgres e SQLite aceitam CASE dentro de SUM() pra unread_cnt (mais
	// portátil que FILTER).
	unreadExpr := "SUM(CASE WHEN direction = 'in' AND status <> 'read' THEN 1 ELSE 0 END) OVER (PARTITION BY " + partition + ")"

	query := `
		SELECT to_jid, content, created_at as max_time, cnt, unread_cnt, contact_name, contact_avatar, direction, is_favorite, is_archived
		FROM (
			SELECT *,
				ROW_NUMBER() OVER (PARTITION BY ` + partition + ` ORDER BY created_at DESC) as rn,
				COUNT(*) OVER (PARTITION BY ` + partition + `) as cnt,
				` + unreadExpr + ` as unread_cnt
			FROM message_logs
			WHERE ` + baseWhere + `
		) sub
		WHERE ` + outerWhere + `
		ORDER BY created_at DESC
		LIMIT 50
	`

	params := []interface{}{instance.ID}

	if search != "" {
		searchWhere := baseWhere + " AND to_jid LIKE ?"
		query = `
			SELECT to_jid, content, created_at as max_time, cnt, unread_cnt, contact_name, contact_avatar, direction, is_favorite, is_archived
			FROM (
				SELECT *,
					ROW_NUMBER() OVER (PARTITION BY ` + partition + ` ORDER BY created_at DESC) as rn,
					COUNT(*) OVER (PARTITION BY ` + partition + `) as cnt,
					` + unreadExpr + ` as unread_cnt
				FROM message_logs
				WHERE ` + searchWhere + `
			) sub
			WHERE ` + outerWhere + `
			ORDER BY created_at DESC
			LIMIT 50
		`
		params = append(params, "%"+search+"%")
	}

	if err := h.db.Raw(query, params...).Scan(&rawChatsResult).Error; err != nil {
		log.Error().Err(err).Str("instance", instance.ID.String()).Msg("inbox chats query failed")
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao carregar conversas"})
	}

	// Track seen JIDs to prevent duplicates
	// For non-groups, use normalized phone; for groups, use full JID
	seenJIDs := make(map[string]bool)
	chats := make([]InboxChat, 0, len(rawChatsResult))

	for _, rc := range rawChatsResult {
		// Determine unique key based on chat type
		var chatKey string
		var phone string
		if strings.Contains(rc.ToJID, "@g.us") {
			chatKey = rc.ToJID // Groups use full JID
			phone = extractPhoneFromJID(rc.ToJID)
		} else {
			phone = extractPhoneFromJID(rc.ToJID)
			chatKey = phone // Individual chats use phone
		}

		if seenJIDs[chatKey] {
			continue
		}
		seenJIDs[chatKey] = true

		lastMsg := rc.Content
		var msgContent string
		if err := json.Unmarshal([]byte(lastMsg), &msgContent); err == nil {
			lastMsg = msgContent
		}

		name := rc.ContactName
		avatar := rc.ContactAvatar
		if name == "" || name == phone {
			name = phone
		}

		// Determine if this is a group chat and canonicalize the JID we
		// hand back. Messages can get saved with raw phone ("5585...") or
		// the full WhatsApp form ("5585...@s.whatsapp.net"); normalize
		// to the full form so the frontend doesn't end up with twin rows
		// for the same contact.
		isGroup := strings.Contains(rc.ToJID, "@g.us")
		canonicalJid := rc.ToJID
		if !isGroup && !strings.Contains(canonicalJid, "@") {
			canonicalJid = phone + "@s.whatsapp.net"
		}

		chats = append(chats, InboxChat{
			InstanceID:  instance.ID.String(),
			JID:         canonicalJid,
			Name:        name,
			Phone:       phone,
			Avatar:      avatar,
			LastMessage: truncateMessage(lastMsg, 60),
			LastTime:    rc.MaxTime,
			UnreadCount: int(rc.UnreadCount),
			IsGroup:     isGroup,
			IsFavorite:  rc.IsFavorite,
			IsArchived:  rc.IsArchived,
		})
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
	contact := h.findContactByPhone(c, phone)

	// Auto-create contact if it doesn't exist
	if contact == nil {
		userID, _ := c.Locals("user_id").(uuid.UUID)
		workspaceID, _ := c.Locals("workspace_id").(uuid.UUID)

		newContact := models.Contact{
			ID:          uuid.New(),
			UserID:      userID,
			WorkspaceID: &workspaceID,
			Name:        phone,
			Phone:       phone,
		}
		if err := h.db.Create(&newContact).Error; err == nil {
			contact = &newContact
		}
	}

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
		Where("instance_id = ? AND (to_jid LIKE ? OR to_jid LIKE ?)",
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

	// If no stored info, try WhatsApp (only if connected, with timeout)
	if contactInfo.Avatar == "" || contactInfo.Name == phone {
		client := h.manager.GetInstance(instance.ID.String())
		if client != nil && client.IsConnected() {
			queryJID := jid
			if !strings.Contains(jid, "@") {
				queryJID = jid + "@s.whatsapp.net"
			}
			if contactInfo.Avatar == "" {
				if picURL := client.GetContactProfilePicture(queryJID); picURL != "" {
					contactInfo.Avatar = picURL
					// Also update stored info for future queries
					h.db.Model(&models.MessageLog{}).
						Where("instance_id = ? AND to_jid LIKE ?", instance.ID, phone+"%").
						Update("contact_avatar", picURL)
				}
			}
			if contactInfo.Name == phone {
				if _, pushName := client.GetContactInfo(queryJID); pushName != "" {
					contactInfo.Name = pushName
					h.db.Model(&models.MessageLog{}).
						Where("instance_id = ? AND to_jid LIKE ?", instance.ID, phone+"%").
						Update("contact_name", pushName)
				}
			}
		}
	}

	// CRM data overrides/supplements WhatsApp data
	if contact != nil {
		contactInfo.ContactID = contact.ID.String()
		contactInfo.Name = contact.Name
		contactInfo.Email = contact.Email
		contactInfo.Description = contact.Notes
		contactInfo.Funnel = contact.Funnel
		contactInfo.Stage = contact.Stage
		contactInfo.Journey = contact.Journey
		contactInfo.Source = string(contact.Source)
		contactInfo.Notes = contact.Notes
		tags := make([]string, len(contact.Tags))
		for i, t := range contact.Tags {
			tags[i] = t.Name
		}
		contactInfo.Tags = tags

		// Get owner name if owner_id is set
		if contact.OwnerID != nil {
			var ownerUser models.User
			if err := h.db.Where("id = ?", *contact.OwnerID).First(&ownerUser).Error; err == nil {
				contactInfo.OwnerName = ownerUser.Name
			}
		}
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
		WHERE instance_id = ? AND to_jid = ?
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

	canonicalJID := jid
	if !strings.HasSuffix(jid, "@g.us") && !strings.HasSuffix(jid, "@newsletter") && jid != "status@broadcast" {
		canonicalJID = extractPhoneFromJID(jid) + "@s.whatsapp.net"
	}

	limit := c.QueryInt("limit", 50)
	offset := c.QueryInt("offset", 0)
	before := c.Query("before", "")

	var logs []models.MessageLog
	// Filter by canonical to_jid and exclude deleted messages
	query := h.db.Where("instance_id = ? AND (to_jid = ? OR to_jid = ?) AND is_deleted = ?", instance.ID, jid, canonicalJID, false).
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
			ID:         log.ID.String(),
			Content:    content,
			FromMe:     log.Direction == models.DirectionOut,
			Timestamp:  timestamp,
			Status:     string(log.Status),
			Type:       log.Type,
			IsPinned:   boolPtr(log.IsPinned),
			IsFavorite: boolPtr(log.IsFavorite),
			IsArchived: boolPtr(log.IsArchived),
			IsDeleted:  boolPtr(log.IsDeleted),
			SenderJID:  log.SenderJID,
			SenderName: log.SenderName,
		})
	}

	reverseMessages(messages)

	var total int64
	h.db.Model(&models.MessageLog{}).Where("instance_id = ? AND (to_jid = ? OR to_jid = ?)", instance.ID, jid, canonicalJID).Count(&total)

	return c.JSON(fiber.Map{
		"messages": messages,
		"total":    total,
		"has_more": offset+len(logs) < int(total),
	})
}

// UpdateMessage updates message status (pin, favorite, archive, delete)
func (h *InboxHandler) UpdateMessage(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}

	messageID := c.Params("id")
	if messageID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "message ID é obrigatório"})
	}

	var req struct {
		IsPinned   *bool `json:"is_pinned,omitempty"`
		IsFavorite *bool `json:"is_favorite,omitempty"`
		IsArchived *bool `json:"is_archived,omitempty"`
		IsDeleted  *bool `json:"is_deleted,omitempty"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "requisição inválida"})
	}

	var log models.MessageLog
	if err := h.db.Where("id = ? AND instance_id = ?", messageID, instance.ID).First(&log).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "mensagem não encontrada"})
	}

	updates := map[string]interface{}{}
	if req.IsPinned != nil {
		updates["is_pinned"] = *req.IsPinned
	}
	if req.IsFavorite != nil {
		updates["is_favorite"] = *req.IsFavorite
	}
	if req.IsArchived != nil {
		updates["is_archived"] = *req.IsArchived
	}
	if req.IsDeleted != nil {
		updates["is_deleted"] = *req.IsDeleted
	}

	if len(updates) > 0 {
		if err := h.db.Model(&log).Updates(updates).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao atualizar mensagem"})
		}
	}

	return c.JSON(fiber.Map{"success": true, "message": "mensagem atualizada"})
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
	if !strings.HasSuffix(jid, "@g.us") && !strings.HasSuffix(jid, "@newsletter") && jid != "status@broadcast" {
		jid = extractPhoneFromJID(jid) + "@s.whatsapp.net"
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
		Where("instance_id = ? AND to_jid = ? AND direction = 'in' AND status != 'read'", instance.ID, jid).
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

// UpdateContact updates a contact's CRM info from inbox
func (h *InboxHandler) UpdateContact(c *fiber.Ctx) error {
	userID, ok := c.Locals("user_id").(string)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autorizado"})
	}

	contactID := c.Params("id")
	if contactID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id do contato é obrigatório"})
	}

	var contact models.Contact
	if err := h.db.Where("id = ? AND user_id = ?", contactID, userID).First(&contact).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "contato não encontrado"})
	}

	var req struct {
		Name    string   `json:"name"`
		Phone   string   `json:"phone"`
		Email   string   `json:"email"`
		Notes   string   `json:"notes"`
		Funnel  string   `json:"funnel"`
		Stage   string   `json:"stage"`
		Journey string   `json:"journey"`
		Owner   string   `json:"owner"`
		TagIDs  []string `json:"tag_ids"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Phone != "" {
		updates["phone"] = req.Phone
	}
	if req.Email != "" {
		updates["email"] = req.Email
	}
	if req.Notes != "" {
		updates["notes"] = req.Notes
	}
	if req.Funnel != "" {
		updates["funnel"] = req.Funnel
	}
	if req.Stage != "" {
		updates["stage"] = req.Stage
	}
	if req.Journey != "" {
		updates["journey"] = req.Journey
	}
	if req.Owner != "" {
		updates["owner"] = req.Owner
	}

	if len(updates) > 0 {
		h.db.Model(&contact).Updates(updates)
	}

	if len(req.TagIDs) > 0 {
		var tags []models.Tag
		h.db.Where("id IN ? AND user_id = ?", req.TagIDs, userID).Find(&tags)
		h.db.Model(&contact).Association("Tags").Replace(tags)
	}

	h.db.Preload("Tags").First(&contact)
	return c.JSON(contact)
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

func (h *InboxHandler) findContactByPhone(c *fiber.Ctx, phone string) *models.Contact {
	var contact models.Contact
	normalized := normalizePhone(phone)

	userID := c.Locals("user_id")
	workspaceID := c.Locals("workspace_id")

	query := h.db.Where("REPLACE(REPLACE(REPLACE(REPLACE(phone, '-', ''), ' ', ''), '(', ''), ')', '') LIKE ?", "%"+normalized+"%")

	// Filter by workspace if available
	if wsID, ok := workspaceID.(string); ok && wsID != "" {
		query = query.Where("workspace_id = ?", wsID)
	} else if uID, ok := userID.(uuid.UUID); ok {
		// Fallback to user's contacts
		query = query.Where("user_id = ?", uID)
	}

	if err := query.First(&contact).Error; err == nil {
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

func boolPtr(b bool) *bool {
	return &b
}

func reverseMessages(msgs []InboxMessage) {
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
}
