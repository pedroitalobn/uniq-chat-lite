package handlers

import (
	"encoding/json"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type CampaignHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewCampaignHandler(db *gorm.DB, manager *whatsapp.Manager) *CampaignHandler {
	h := &CampaignHandler{db: db, manager: manager}
	go h.schedulerLoop()
	return h
}

// ── Scheduler ──────────────────────────────────────────────────────────────────

// schedulerLoop ticks every 60 s and sends messages for active campaigns
// that are within their date window and scheduled hours.
func (h *CampaignHandler) schedulerLoop() {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		h.tick()
	}
}

func (h *CampaignHandler) tick() {
	now := time.Now()
	today := now.Format("2006-01-02")
	currentHour := now.Hour()

	var campaigns []models.Campaign
	h.db.Where("status IN ?", []models.CampaignStatus{
		models.CampaignStatusRunning,
		models.CampaignStatusScheduled,
	}).Find(&campaigns)

	for _, c := range campaigns {
		c := c // capture

		// Check date window
		if c.StartDate != nil && now.Before(*c.StartDate) {
			continue
		}
		if c.EndDate != nil && now.After(*c.EndDate) {
			h.db.Model(&c).Update("status", models.CampaignStatusCompleted)
			continue
		}

		// Check schedule hours
		if !inScheduleHours(c.ScheduleHours, currentHour) {
			continue
		}

		// Ensure running
		if c.Status != models.CampaignStatusRunning {
			startedAt := now
			h.db.Model(&c).Updates(map[string]interface{}{
				"status":     models.CampaignStatusRunning,
				"started_at": &startedAt,
			})
		}

		go h.processCampaign(c, today)
	}
}

// inScheduleHours returns true if hour is in the JSON int array, or if array is empty (= any hour).
func inScheduleHours(hoursJSON string, hour int) bool {
	if hoursJSON == "" || hoursJSON == "[]" {
		return true
	}
	var hours []int
	if err := json.Unmarshal([]byte(hoursJSON), &hours); err != nil || len(hours) == 0 {
		return true
	}
	for _, h := range hours {
		if h == hour {
			return true
		}
	}
	return false
}

// processCampaign sends one batch for this tick — up to timesPerDay for each recipient.
func (h *CampaignHandler) processCampaign(c models.Campaign, today string) {
	client := h.manager.GetInstance(c.InstanceID.String())
	if client == nil || !client.IsConnected() {
		log.Warn().Str("campaign", c.ID.String()).Msg("campaign: instance not connected, skipping tick")
		return
	}

	var recipients []models.CampaignRecipient
	h.db.Where("campaign_id = ? AND status = ?", c.ID, models.RecipientStatusPending).Find(&recipients)

	if len(recipients) == 0 {
		// All done
		completedAt := time.Now()
		h.db.Model(&c).Updates(map[string]interface{}{
			"status":       models.CampaignStatusCompleted,
			"completed_at": &completedAt,
		})
		return
	}

	delayMs := c.DelaySeconds * 1000
	if delayMs < 1000 {
		delayMs = 1000
	}
	opts := queue.SendOptions{
		DelayMs:        delayMs,
		SimulateTyping: c.MessageType == "text",
	}

	useQueue := queue.GlobalQueue != nil && queue.GlobalQueue.IsConnected()

	for i := range recipients {
		r := &recipients[i]

		// Check campaign still running
		var fresh models.Campaign
		h.db.Select("status").First(&fresh, c.ID)
		if fresh.Status == models.CampaignStatusPaused || fresh.Status == models.CampaignStatusFailed {
			return
		}

		// Reset daily counter if day changed
		if r.LastSentDate != today {
			r.SentToday = 0
			r.LastSentDate = today
		}

		// Skip if daily limit reached
		if r.SentToday >= c.TimesPerDay {
			continue
		}

		// Build job
		payload := queue.SendPayload{To: r.Phone}
		var msgType queue.MessageType
		switch c.MessageType {
		case "image":
			msgType = queue.TypeImage
			payload.MediaB64 = c.MediaB64
			payload.MimeType = c.MediaMime
			payload.Caption = c.Caption
			if payload.Caption == "" {
				payload.Caption = c.MessageText
			}
		case "audio":
			msgType = queue.TypeAudio
			payload.MediaB64 = c.MediaB64
			payload.MimeType = c.MediaMime
			payload.PTT = true
		case "document":
			msgType = queue.TypeDocument
			payload.MediaB64 = c.MediaB64
			payload.MimeType = c.MediaMime
			payload.Filename = c.MediaName
		default:
			msgType = queue.TypeText
			payload.Text = c.MessageText
		}

		job := queue.SendJob{
			ID:         uuid.New(),
			InstanceID: c.InstanceID.String(),
			Type:       msgType,
			Payload:    payload,
			Options:    opts,
		}

		var sendErr error
		var msgID string

		if useQueue {
			if err := queue.GlobalQueue.Enqueue(job); err != nil {
				log.Warn().Err(err).Str("campaign", c.ID.String()).Msg("queue enqueue failed, falling back")
				msgID, sendErr = client.SendWithFallback(job)
			}
		} else {
			msgID, sendErr = client.SendWithFallback(job)
		}

		now := time.Now()
		if sendErr != nil {
			r.Error = sendErr.Error()
			h.db.Model(r).Updates(map[string]interface{}{
				"error":          sendErr.Error(),
				"last_sent_date": today,
				"sent_today":     gorm.Expr("sent_today + 1"),
			})
			h.db.Model(&c).UpdateColumn("failed_count", gorm.Expr("failed_count + 1"))
		} else {
			newSendCount := r.SendCount + 1
			updates := map[string]interface{}{
				"send_count":     newSendCount,
				"sent_today":     gorm.Expr("sent_today + 1"),
				"last_sent_date": today,
				"message_id":     msgID,
				"sent_at":        &now,
				"error":          "",
			}
			if newSendCount >= c.TimesTotal {
				updates["status"] = models.RecipientStatusSent
				h.db.Model(&c).UpdateColumn("sent_count", gorm.Expr("sent_count + 1"))
			}
			h.db.Model(r).Updates(updates)
		}

		time.Sleep(time.Duration(delayMs) * time.Millisecond)
	}
}

// ── REST handlers ──────────────────────────────────────────────────────────────

// List godoc
// GET /campaigns
func (h *CampaignHandler) List(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	var campaigns []models.Campaign
	h.db.Where("user_id = ?", user.ID).Order("created_at DESC").Find(&campaigns)
	return c.JSON(fiber.Map{"data": campaigns, "total": len(campaigns)})
}

// Create godoc
// POST /campaigns
func (h *CampaignHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	var req struct {
		InstanceID    string     `json:"instance_id"`
		Name          string     `json:"name"`
		RecipientType string     `json:"recipient_type"` // "contacts" | "groups" | "crm" | "segment"
		MessageType   string     `json:"message_type"`   // "text" | "image" | "audio" | "document"
		MessageText   string     `json:"message_text"`
		Caption       string     `json:"caption"`
		MediaB64      string     `json:"media_base64"`
		MediaMime     string     `json:"media_mime"`
		MediaName     string     `json:"media_name"`
		StartDate     *time.Time `json:"start_date"`
		EndDate       *time.Time `json:"end_date"`
		TimesTotal    int        `json:"times_total"`
		TimesPerDay   int        `json:"times_per_day"`
		ScheduleHours string     `json:"schedule_hours"` // JSON: "[9,14,18]"
		DelaySeconds  int        `json:"delay_seconds"`
		Recipients    []struct {
			Phone string `json:"phone"` // phone number or group JID
			Name  string `json:"name"`
		} `json:"recipients"`
		// CRM segmentation filters
		SegmentFilter struct {
			Funnel  string   `json:"funnel,omitempty"`
			Stage   string   `json:"stage,omitempty"`
			Journey string   `json:"journey,omitempty"`
			Tags    []string `json:"tags,omitempty"`
			Owner   string   `json:"owner,omitempty"`
		} `json:"segment_filter"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if req.Name == "" || req.InstanceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name e instance_id são obrigatórios"})
	}
	instanceID, err := uuid.Parse(req.InstanceID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instance_id inválido"})
	}

	msgType := req.MessageType
	if msgType == "" {
		msgType = "text"
	}
	recipientType := req.RecipientType
	if recipientType == "" {
		recipientType = "contacts"
	}
	delay := req.DelaySeconds
	if delay < 1 {
		delay = 3
	}
	timesTotal := req.TimesTotal
	if timesTotal < 1 {
		timesTotal = 1
	}
	timesPerDay := req.TimesPerDay
	if timesPerDay < 1 {
		timesPerDay = 1
	}
	schedHours := req.ScheduleHours
	if schedHours == "" {
		schedHours = "[]"
	}

	status := models.CampaignStatusDraft
	if req.StartDate != nil && !req.StartDate.After(time.Now()) {
		status = models.CampaignStatusScheduled
	}

	// Serialize segment filter
	segmentJSON := "{}"
	if req.SegmentFilter.Funnel != "" || req.SegmentFilter.Stage != "" || len(req.SegmentFilter.Tags) > 0 {
		b, _ := json.Marshal(req.SegmentFilter)
		segmentJSON = string(b)
	}

	campaign := models.Campaign{
		UserID:        user.ID,
		InstanceID:    instanceID,
		Name:          req.Name,
		RecipientType: recipientType,
		SegmentFilter: segmentJSON,
		MessageType:   msgType,
		MessageText:   req.MessageText,
		Caption:       req.Caption,
		MediaB64:      req.MediaB64,
		MediaMime:     req.MediaMime,
		MediaName:     req.MediaName,
		StartDate:     req.StartDate,
		EndDate:       req.EndDate,
		TimesTotal:    timesTotal,
		TimesPerDay:   timesPerDay,
		ScheduleHours: schedHours,
		DelaySeconds:  delay,
		Status:        status,
	}
	if err := h.db.Create(&campaign).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar campanha"})
	}

	// Resolve recipients based on type
	switch recipientType {
	case "segment", "crm":
		// Resolve contacts from CRM based on segmentation filter
		resolved := h.resolveSegmentedContacts(user.ID, req.SegmentFilter)
		for _, contact := range resolved {
			h.db.Create(&models.CampaignRecipient{
				CampaignID: campaign.ID,
				Phone:      contact.Phone,
				Name:       contact.Name,
			})
		}
		h.db.Model(&campaign).Update("total_count", len(resolved))
	default:
		// Manual recipients list
		for _, r := range req.Recipients {
			h.db.Create(&models.CampaignRecipient{
				CampaignID: campaign.ID,
				Phone:      r.Phone,
				Name:       r.Name,
			})
		}
		h.db.Model(&campaign).Update("total_count", len(req.Recipients))
	}

	return c.Status(fiber.StatusCreated).JSON(campaign)
}

// resolveSegmentedContacts queries contacts matching the segment filter
func (h *CampaignHandler) resolveSegmentedContacts(userID uuid.UUID, filter struct {
	Funnel  string   `json:"funnel,omitempty"`
	Stage   string   `json:"stage,omitempty"`
	Journey string   `json:"journey,omitempty"`
	Tags    []string `json:"tags,omitempty"`
	Owner   string   `json:"owner,omitempty"`
}) []models.Contact {
	query := h.db.Where("user_id = ?", userID)

	if filter.Funnel != "" {
		query = query.Where("funnel = ?", filter.Funnel)
	}
	if filter.Stage != "" {
		query = query.Where("stage = ?", filter.Stage)
	}
	if filter.Journey != "" {
		query = query.Where("journey = ?", filter.Journey)
	}
	if filter.Owner != "" {
		query = query.Where("owner = ?", filter.Owner)
	}
	if len(filter.Tags) > 0 {
		query = query.Joins("INNER JOIN contact_tags ON contact_tags.contact_id = contacts.id").
			Joins("INNER JOIN tags ON tags.id = contact_tags.tag_id").
			Where("tags.name IN ?", filter.Tags)
	}

	var contacts []models.Contact
	query.Distinct().Find(&contacts)
	return contacts
}

// Get godoc
// GET /campaigns/:id
func (h *CampaignHandler) Get(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	campaignID := c.Params("id")
	var campaign models.Campaign
	if err := h.db.Preload("Recipients").
		Where("id = ? AND user_id = ?", campaignID, user.ID).
		First(&campaign).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campanha não encontrada"})
	}
	return c.JSON(campaign)
}

// Start godoc
// POST /campaigns/:id/start
func (h *CampaignHandler) Start(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	campaignID := c.Params("id")
	var campaign models.Campaign
	if err := h.db.Where("id = ? AND user_id = ?", campaignID, user.ID).First(&campaign).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campanha não encontrada"})
	}
	if campaign.Status == models.CampaignStatusCompleted {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "campanha já concluída"})
	}

	now := time.Now()
	today := now.Format("2006-01-02")

	h.db.Model(&campaign).Updates(map[string]interface{}{
		"status":     models.CampaignStatusRunning,
		"started_at": &now,
	})

	// Run immediately if within time window
	if inScheduleHours(campaign.ScheduleHours, now.Hour()) {
		go h.processCampaign(campaign, today)
	}
	return c.JSON(fiber.Map{"status": "started"})
}

// Pause godoc
// POST /campaigns/:id/pause
func (h *CampaignHandler) Pause(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	campaignID := c.Params("id")
	result := h.db.Model(&models.Campaign{}).
		Where("id = ? AND user_id = ? AND status = ?", campaignID, user.ID, models.CampaignStatusRunning).
		Update("status", models.CampaignStatusPaused)
	if result.RowsAffected == 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "campanha não está em execução"})
	}
	return c.JSON(fiber.Map{"status": "paused"})
}

// Cancel godoc
// POST /campaigns/:id/cancel
func (h *CampaignHandler) Cancel(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	campaignID := c.Params("id")
	result := h.db.Model(&models.Campaign{}).
		Where("id = ? AND user_id = ? AND status IN ?", campaignID, user.ID,
			[]models.CampaignStatus{
				models.CampaignStatusDraft, models.CampaignStatusScheduled,
				models.CampaignStatusRunning, models.CampaignStatusPaused,
			}).
		Update("status", models.CampaignStatusFailed)
	if result.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campanha não encontrada ou não pode ser cancelada"})
	}
	return c.JSON(fiber.Map{"status": "cancelled"})
}

// Delete godoc
// DELETE /campaigns/:id
func (h *CampaignHandler) Delete(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	campaignID := c.Params("id")
	var campaign models.Campaign
	if err := h.db.Where("id = ? AND user_id = ?", campaignID, user.ID).First(&campaign).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campanha não encontrada"})
	}
	h.db.Where("campaign_id = ?", campaign.ID).Delete(&models.CampaignRecipient{})
	h.db.Delete(&campaign)
	return c.SendStatus(fiber.StatusNoContent)
}

// SegmentOptions returns available CRM segmentation options for campaigns
// GET /campaigns/segment-options
func (h *CampaignHandler) SegmentOptions(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	var funnels []string
	var stages []string
	var journeys []string
	var owners []string
	var tags []models.Tag

	h.db.Model(&models.Contact{}).Distinct("funnel").Where("user_id = ? AND funnel != ''", user.ID).Pluck("funnel", &funnels)
	h.db.Model(&models.Contact{}).Distinct("stage").Where("user_id = ? AND stage != ''", user.ID).Pluck("stage", &stages)
	h.db.Model(&models.Contact{}).Distinct("journey").Where("user_id = ? AND journey != ''", user.ID).Pluck("journey", &journeys)
	h.db.Model(&models.Contact{}).Distinct("owner").Where("user_id = ? AND owner != ''", user.ID).Pluck("owner", &owners)
	h.db.Where("user_id = ?", user.ID).Find(&tags)

	return c.JSON(fiber.Map{
		"funnels":  funnels,
		"stages":   stages,
		"journeys": journeys,
		"owners":   owners,
		"tags":     tags,
	})
}

// SegmentPreview returns the count and sample contacts for a given filter
// POST /campaigns/segment-preview
func (h *CampaignHandler) SegmentPreview(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	var filter struct {
		Funnel  string   `json:"funnel,omitempty"`
		Stage   string   `json:"stage,omitempty"`
		Journey string   `json:"journey,omitempty"`
		Tags    []string `json:"tags,omitempty"`
		Owner   string   `json:"owner,omitempty"`
	}
	if err := c.BodyParser(&filter); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}

	query := h.db.Model(&models.Contact{}).Where("user_id = ?", user.ID)
	if filter.Funnel != "" {
		query = query.Where("funnel = ?", filter.Funnel)
	}
	if filter.Stage != "" {
		query = query.Where("stage = ?", filter.Stage)
	}
	if filter.Journey != "" {
		query = query.Where("journey = ?", filter.Journey)
	}
	if filter.Owner != "" {
		query = query.Where("owner = ?", filter.Owner)
	}
	if len(filter.Tags) > 0 {
		query = query.Joins("INNER JOIN contact_tags ON contact_tags.contact_id = contacts.id").
			Joins("INNER JOIN tags ON tags.id = contact_tags.tag_id").
			Where("tags.name IN ?", filter.Tags).
			Distinct()
	}

	var count int64
	query.Count(&count)

	var sample []models.Contact
	query.Limit(5).Find(&sample)

	return c.JSON(fiber.Map{
		"total":  count,
		"sample": sample,
	})
}
