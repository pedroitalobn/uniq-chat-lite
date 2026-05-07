package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"github.com/uniq-chat/backend/internal/services/freqcap"
	templatesvc "github.com/uniq-chat/backend/internal/services/template"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

type campaignPipelineIface interface {
	ProcessSavedOutbound(ctx context.Context, ml *models.MessageLog) error
}

type CampaignHandler struct {
	db       *gorm.DB
	manager  *whatsapp.Manager
	pipeline campaignPipelineIface
}

func NewCampaignHandler(db *gorm.DB, manager *whatsapp.Manager) *CampaignHandler {
	h := &CampaignHandler{db: db, manager: manager}
	go h.schedulerLoop()
	return h
}

func (h *CampaignHandler) SetInboundPipeline(p campaignPipelineIface) {
	h.pipeline = p
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
	_ = currentHour // evaluateCampaign usa minuto-precisão E timezone do workspace

	var campaigns []models.Campaign
	h.db.Where("status IN ?", []models.CampaignStatus{
		models.CampaignStatusRunning,
		models.CampaignStatusScheduled,
	}).Find(&campaigns)

	if len(campaigns) > 0 {
		log.Debug().Int("count", len(campaigns)).Msg("campaign: scheduler tick — campaigns matched")
	}

	for _, c := range campaigns {
		c := c // capture
		reason := h.evaluateCampaign(&c, now, currentHour)
		if reason != "" {
			log.Debug().
				Str("campaign", c.ID.String()).
				Str("name", c.Name).
				Str("status", string(c.Status)).
				Str("reason", reason).
				Msg("campaign: skipped this tick")
			continue
		}

		// Ensure running
		if c.Status != models.CampaignStatusRunning {
			startedAt := now
			h.db.Model(&c).Updates(map[string]interface{}{
				"status":     models.CampaignStatusRunning,
				"started_at": &startedAt,
			})
			log.Info().Str("campaign", c.ID.String()).Str("name", c.Name).
				Msg("campaign: scheduled → running")
		}

		go h.processCampaign(c, today)
	}
}

// evaluateCampaign aplica os filtros de janela/horário e retorna a
// razão do skip (string vazia = OK pra rodar). Side-effect: marca
// completed quando passou da end_date.
//
// Timezone: o schedule_hours é interpretado no fuso do workspace
// (Workspace.Timezone), não em UTC. Antes o tick usava now.Hour()
// direto — em servidor UTC e workspace São Paulo (UTC-3), o user
// configurava "18-19h" (local) mas o scheduler comparava com 21h
// UTC e pulava. Agora convertemos pro TZ do workspace antes de
// comparar.
func (h *CampaignHandler) evaluateCampaign(c *models.Campaign, now time.Time, _ int) string {
	if c.StartDate != nil && now.Before(*c.StartDate) {
		return fmt.Sprintf("start_date no futuro: %s", c.StartDate.Format("2006-01-02 15:04 MST"))
	}
	if c.EndDate != nil && now.After(*c.EndDate) {
		h.db.Model(c).Update("status", models.CampaignStatusCompleted)
		return fmt.Sprintf("end_date passou: %s — marcado como completed", c.EndDate.Format("2006-01-02 15:04 MST"))
	}

	// Converte pro fuso do workspace pra avaliar schedule_hours.
	loc := h.workspaceLocation(c)
	local := now.In(loc)
	if !inScheduleNow(c.ScheduleHours, local.Hour(), local.Minute()) {
		return fmt.Sprintf("horário atual (%02d:%02d %s) fora do schedule_hours: %s",
			local.Hour(), local.Minute(), loc.String(), c.ScheduleHours)
	}
	return ""
}

// workspaceLocation devolve o time.Location do workspace dono da
// campanha. Fallback America/Sao_Paulo, depois UTC.
func (h *CampaignHandler) workspaceLocation(c *models.Campaign) *time.Location {
	tzName := ""
	if c.WorkspaceID != nil {
		var ws models.Workspace
		if err := h.db.Select("timezone").First(&ws, "id = ?", c.WorkspaceID).Error; err == nil && ws.Timezone != "" {
			tzName = ws.Timezone
		}
	}
	if tzName == "" {
		tzName = "America/Sao_Paulo"
	}
	if loc, err := time.LoadLocation(tzName); err == nil {
		return loc
	}
	return time.UTC
}

// inScheduleHours retorna true se a hora atual está dentro de algum
// slot autorizado. Suporta DOIS formatos no JSON do schedule_hours
// pra retrocompat:
//
//   1. Legacy "hours array": [9, 10, 14, 15] — granularidade de hora.
//      Match se hour ∈ array.
//   2. New "window array":   [{"from":"09:00","to":"11:30"},
//                             {"from":"14:00","to":"18:00"}]
//      Granularidade de minuto. Match se now está em qualquer janela
//      [from, to). Janela cruzando meia-noite (from > to) é tratada
//      como dois ranges (from→23:59 + 00:00→to).
//
// Empty/[] = qualquer hora (sempre true).
//
// Pra compat o caller passa só "hour" (int). Pro novo formato precisamos
// de minutos também — uma versão alternativa mais rica é
// inScheduleNow abaixo.
func inScheduleHours(hoursJSON string, hour int) bool {
	return inScheduleNow(hoursJSON, hour, 0)
}

// inScheduleNow é a versão completa que recebe hora E minuto. Use ela
// quando precisar precisão minuto-a-minuto. Acima, inScheduleHours
// chama com minuto=0 mantendo o comportamento legado.
func inScheduleNow(hoursJSON string, hour, minute int) bool {
	if hoursJSON == "" || hoursJSON == "[]" {
		return true
	}

	// Tenta primeiro o formato novo (windows). Se falha, cai no legacy.
	type window struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	var windows []window
	if err := json.Unmarshal([]byte(hoursJSON), &windows); err == nil && len(windows) > 0 && windows[0].From != "" {
		nowMin := hour*60 + minute
		for _, w := range windows {
			fh, fm, fok := parseHHMM(w.From)
			th, tm, tok := parseHHMM(w.To)
			if !fok || !tok {
				continue
			}
			fromMin := fh*60 + fm
			toMin := th*60 + tm
			if fromMin <= toMin {
				if nowMin >= fromMin && nowMin < toMin {
					return true
				}
			} else {
				// Janela cruzando meia-noite (ex.: 22:00 → 02:00).
				if nowMin >= fromMin || nowMin < toMin {
					return true
				}
			}
		}
		return false
	}

	// Legacy: int array de horas.
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

// parseHHMM aceita "9:30", "09:30", "9", "23:00". Retorna (h, m, ok).
func parseHHMM(s string) (int, int, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return 0, 0, false
	}
	parts := strings.Split(s, ":")
	h, err := strconv.Atoi(parts[0])
	if err != nil || h < 0 || h > 23 {
		return 0, 0, false
	}
	m := 0
	if len(parts) > 1 {
		m, err = strconv.Atoi(parts[1])
		if err != nil || m < 0 || m > 59 {
			return 0, 0, false
		}
	}
	return h, m, true
}

// processCampaign sends one batch for this tick — up to timesPerDay for each recipient.
func (h *CampaignHandler) processCampaign(c models.Campaign, today string) {
	// Resolve canal da instância antes de tentar engajar manager.
	var inst models.Instance
	if err := h.db.Select("id, channel").First(&inst, c.InstanceID).Error; err != nil {
		log.Warn().Err(err).Str("campaign", c.ID.String()).Msg("campaign: instance not found")
		return
	}

	// WABA usa Meta Cloud API, não passa pelo whatsmeow manager.
	if inst.Channel == models.ChannelWABA {
		h.processCampaignWABA(c, today)
		return
	}

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

		// Safety checks: suppression list + freq cap + quiet hours.
		// Falham fechado em ws_id ausente (broadcast legado) — não checa.
		if c.WorkspaceID != nil {
			ws := *c.WorkspaceID
			// 1. Suppression: contato pediu pra não receber.
			if models.IsSuppressed(h.db, ws, r.Phone, "whatsapp") {
				h.db.Model(r).Updates(map[string]any{
					"status": models.RecipientStatusFailed,
					"error":  "suppressed",
				})
				continue
			}
			// 2. Resolve contact pra TZ + freq cap.
			var contact models.Contact
			h.db.Select("id").Where("(workspace_id = ? OR user_id = ?) AND phone = ?",
				ws, c.UserID, r.Phone).First(&contact)
			if contact.ID != uuid.Nil {
				if freqcap.IsQuietNow(ws, contact.ID, h.db) {
					continue // tenta de novo no próximo tick
				}
				if okFC, reason := freqcap.Check(h.db, ws, contact.ID); !okFC {
					log.Debug().Str("phone", r.Phone).Str("reason", reason).Msg("campaign: freq cap")
					continue
				}
			}
		}

		// Liquid render no texto + caption (suporta {{contact.name}}, {% if %})
		liquidVars := map[string]any{"contact": map[string]any{"phone": r.Phone, "name": r.Name}}
		if c.MessageText != "" {
			c.MessageText = templatesvc.MustRender(c.MessageText, liquidVars)
		}
		if c.Caption != "" {
			c.Caption = templatesvc.MustRender(c.Caption, liquidVars)
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
	workspaceID := c.Query("workspace_id")
	query := h.db.Where("user_id = ?", user.ID)
	if workspaceID != "" {
		if wid, err := uuid.Parse(workspaceID); err == nil {
			query = query.Where("workspace_id = ?", wid)
		}
	}
	var campaigns []models.Campaign
	query.Order("created_at DESC").Find(&campaigns)
	return c.JSON(fiber.Map{"data": campaigns, "total": len(campaigns)})
}

// Create godoc
// POST /campaigns
func (h *CampaignHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	var req struct {
		WorkspaceID   string `json:"workspace_id"`
		InstanceID    string `json:"instance_id"`
		Name          string `json:"name"`
		ActionType    string `json:"action_type"`    // "send_message"|"follow"|"unfollow"|"like"|"comment"
		RecipientType string `json:"recipient_type"` // "contacts"|"groups"|"crm"|"segment"|"followers"|"following"
		ChannelConfig string `json:"channel_config"` // JSON blob
		MessageType   string `json:"message_type"`   // "text"|"image"|"audio"|"document"|"template"
		MessageText   string `json:"message_text"`
		Caption       string `json:"caption"`
		MediaB64      string `json:"media_base64"`
		MediaMime     string `json:"media_mime"`
		MediaName     string `json:"media_name"`
		// WABA template fields
		TemplateName      string            `json:"template_name"`
		TemplateLanguage  string            `json:"template_language"`
		TemplateVariables map[string]string `json:"template_variables"`
		TemplateHeaderURL string            `json:"template_header_url"`
		StartDate     *time.Time `json:"start_date"`
		EndDate       *time.Time `json:"end_date"`
		TimesTotal    int        `json:"times_total"`
		TimesPerDay   int        `json:"times_per_day"`
		ScheduleHours string     `json:"schedule_hours"`
		// Safety / rate limiting
		DelaySeconds         int `json:"delay_seconds"`
		DelayMinSeconds      int `json:"delay_min_seconds"`
		DelayMaxSeconds      int `json:"delay_max_seconds"`
		DailyLimitPerAccount int `json:"daily_limit_per_account"`
		Recipients []struct {
			Phone string `json:"phone"`
			Name  string `json:"name"`
		} `json:"recipients"`
		SegmentFilter struct {
			Funnel     string   `json:"funnel,omitempty"`
			Stage      string   `json:"stage,omitempty"`
			// CRM v2: filtros via FK (cross-entity)
			FunnelID     string `json:"funnel_id,omitempty"`
			StageID      string `json:"stage_id,omitempty"`
			DealStatus   string `json:"deal_status,omitempty"`
			CompanyID    string `json:"company_id,omitempty"`
			MinDealValue int64  `json:"min_deal_value,omitempty"`
			MaxDealValue int64  `json:"max_deal_value,omitempty"`
			Journey    string   `json:"journey,omitempty"`
			Tags       []string `json:"tags,omitempty"`
			Owner      string   `json:"owner,omitempty"`
			ExternalID string   `json:"external_id,omitempty"`
			SegmentID  string   `json:"segment_id,omitempty"`
			// Shop / purchase history filters
			PurchasedShopID    string  `json:"purchased_shop_id,omitempty"`
			PurchasedSinceDays int     `json:"purchased_since_days,omitempty"`
			PurchasedMinTotal  float64 `json:"purchased_min_total,omitempty"`
			PurchasedStatus    string  `json:"purchased_status,omitempty"`
			NeverPurchased     bool    `json:"never_purchased,omitempty"`
			PassedAgentID      string  `json:"passed_agent_id,omitempty"`
			// Inbox behavior filters
			InboxAssignedTo           string `json:"inbox_assigned_to,omitempty"`
			InboxDepartment           string `json:"inbox_department,omitempty"`
			InboxTeam                 string `json:"inbox_team,omitempty"`
			InboxQueue                string `json:"inbox_queue,omitempty"`
			InboxResponseTimeMax      int    `json:"inbox_response_time_max,omitempty"`
			InboxConversationCountMin int    `json:"inbox_conversation_count_min,omitempty"`
			InboxLastContactAfter     string `json:"inbox_last_contact_after,omitempty"`
			ParticipatedCampaignID    string `json:"participated_campaign_id,omitempty"`
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
	actionType := models.CampaignAction(req.ActionType)
	if actionType == "" {
		actionType = models.CampaignActionSendMessage
	}
	delay := req.DelaySeconds
	if delay < 1 {
		delay = 3
	}
	delayMin := req.DelayMinSeconds
	if delayMin < 1 {
		delayMin = delay
	}
	delayMax := req.DelayMaxSeconds
	if delayMax < delayMin {
		delayMax = delayMin + 7
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
	channelConfig := req.ChannelConfig
	if channelConfig == "" {
		channelConfig = "{}"
	}

	status := models.CampaignStatusDraft
	if req.StartDate != nil && !req.StartDate.After(time.Now()) {
		status = models.CampaignStatusScheduled
	}

	// Resolve channel from instance
	var inst models.Instance
	var channel string
	if err := h.db.Select("channel").Where("id = ?", instanceID).First(&inst).Error; err == nil {
		channel = string(inst.Channel)
	}

	// Serialize segment filter
	segmentJSON := "{}"
	if req.SegmentFilter.Funnel != "" || req.SegmentFilter.Stage != "" ||
		len(req.SegmentFilter.Tags) > 0 || req.SegmentFilter.SegmentID != "" {
		b, _ := json.Marshal(req.SegmentFilter)
		segmentJSON = string(b)
	}

	// Serializa template_variables como JSON
	tplVarsJSON := "{}"
	if len(req.TemplateVariables) > 0 {
		if b, err := json.Marshal(req.TemplateVariables); err == nil {
			tplVarsJSON = string(b)
		}
	}

	campaign := models.Campaign{
		UserID:               user.ID,
		InstanceID:           instanceID,
		Name:                 req.Name,
		Channel:              channel,
		ActionType:           actionType,
		ChannelConfig:        channelConfig,
		RecipientType:        recipientType,
		SegmentFilter:        segmentJSON,
		MessageType:          msgType,
		MessageText:          req.MessageText,
		Caption:              req.Caption,
		MediaB64:             req.MediaB64,
		MediaMime:            req.MediaMime,
		MediaName:            req.MediaName,
		TemplateName:         req.TemplateName,
		TemplateLanguage:     req.TemplateLanguage,
		TemplateVariables:    tplVarsJSON,
		TemplateHeaderURL:    req.TemplateHeaderURL,
		StartDate:            req.StartDate,
		EndDate:              req.EndDate,
		TimesTotal:           timesTotal,
		TimesPerDay:          timesPerDay,
		ScheduleHours:        schedHours,
		DelaySeconds:         delay,
		DelayMinSeconds:      delayMin,
		DelayMaxSeconds:      delayMax,
		DailyLimitPerAccount: req.DailyLimitPerAccount,
		Status:               status,
	}
	if req.WorkspaceID != "" {
		if wid, err := uuid.Parse(req.WorkspaceID); err == nil {
			campaign.WorkspaceID = &wid
		}
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

// resolveSegmentedContacts queries contacts matching the segment filter.
// CRM v2: aceita filtros cross-entity (funnel_id, stage_id, deal_status,
// company_id, min/max_deal_value) — contato é resolvido via JOIN com
// deals, então um filtro por stage_id retorna todos os contatos que
// têm deal naquele stage.
func (h *CampaignHandler) resolveSegmentedContacts(userID uuid.UUID, filter struct {
	Funnel                   string   `json:"funnel,omitempty"`
	Stage                    string   `json:"stage,omitempty"`
	// CRM v2: FKs preferidas (cross-entity via JOIN com deals)
	FunnelID                 string   `json:"funnel_id,omitempty"`
	StageID                  string   `json:"stage_id,omitempty"`
	DealStatus               string   `json:"deal_status,omitempty"`     // open/won/lost/all
	CompanyID                string   `json:"company_id,omitempty"`
	MinDealValue             int64    `json:"min_deal_value,omitempty"`
	MaxDealValue             int64    `json:"max_deal_value,omitempty"`
	Journey                  string   `json:"journey,omitempty"`
	Tags                     []string `json:"tags,omitempty"`
	Owner                    string   `json:"owner,omitempty"`
	ExternalID               string   `json:"external_id,omitempty"`
	SegmentID                string   `json:"segment_id,omitempty"`
	PurchasedShopID          string   `json:"purchased_shop_id,omitempty"`
	PurchasedSinceDays       int      `json:"purchased_since_days,omitempty"`
	PurchasedMinTotal        float64  `json:"purchased_min_total,omitempty"`
	PurchasedStatus          string   `json:"purchased_status,omitempty"`
	NeverPurchased           bool     `json:"never_purchased,omitempty"`
	PassedAgentID            string   `json:"passed_agent_id,omitempty"`
	InboxAssignedTo          string   `json:"inbox_assigned_to,omitempty"`
	InboxDepartment          string   `json:"inbox_department,omitempty"`
	InboxTeam                string   `json:"inbox_team,omitempty"`
	InboxQueue               string   `json:"inbox_queue,omitempty"`
	InboxResponseTimeMax     int      `json:"inbox_response_time_max,omitempty"`
	InboxConversationCountMin int     `json:"inbox_conversation_count_min,omitempty"`
	InboxLastContactAfter    string   `json:"inbox_last_contact_after,omitempty"`
	ParticipatedCampaignID   string   `json:"participated_campaign_id,omitempty"`
}) []models.Contact {
	query := h.db.Where("contacts.user_id = ?", userID)

	// Segment membership filter (manual or dynamic segment)
	if filter.SegmentID != "" {
		if sid, err := uuid.Parse(filter.SegmentID); err == nil {
			query = query.Joins("INNER JOIN segment_members ON segment_members.contact_id = contacts.id").
				Where("segment_members.segment_id = ?", sid)
		}
	}

	if filter.Funnel != "" {
		query = query.Where("contacts.funnel = ?", filter.Funnel)
	}
	if filter.Stage != "" {
		query = query.Where("contacts.stage = ?", filter.Stage)
	}

	// CRM v2: filtros cross-entity via JOIN com deals.
	// Acopla contact → deal: o contato é incluído se tiver deal que
	// bate o filtro. DISTINCT no final garante que cada contato
	// apareça uma vez mesmo com múltiplos deals.
	hasDealFilter := filter.FunnelID != "" || filter.StageID != "" ||
		filter.DealStatus != "" || filter.CompanyID != "" ||
		filter.MinDealValue > 0 || filter.MaxDealValue > 0
	if hasDealFilter {
		query = query.Joins("INNER JOIN deals ON deals.contact_id = contacts.id AND deals.deleted_at IS NULL").
			Distinct("contacts.*")
		if filter.FunnelID != "" {
			if fid, err := uuid.Parse(filter.FunnelID); err == nil {
				query = query.Where("deals.funnel_id = ?", fid)
			}
		}
		if filter.StageID != "" {
			if sid, err := uuid.Parse(filter.StageID); err == nil {
				query = query.Where("deals.stage_id = ?", sid)
			}
		}
		if filter.DealStatus != "" && filter.DealStatus != "all" {
			query = query.Where("deals.status = ?", filter.DealStatus)
		}
		if filter.CompanyID != "" {
			if cid, err := uuid.Parse(filter.CompanyID); err == nil {
				query = query.Where("deals.company_id = ?", cid)
			}
		}
		if filter.MinDealValue > 0 {
			query = query.Where("deals.value >= ?", filter.MinDealValue)
		}
		if filter.MaxDealValue > 0 {
			query = query.Where("deals.value <= ?", filter.MaxDealValue)
		}
	}
	if filter.Journey != "" {
		query = query.Where("contacts.journey = ?", filter.Journey)
	}
	if filter.Owner != "" {
		query = query.Where("contacts.owner = ?", filter.Owner)
	}
	if filter.ExternalID != "" {
		query = query.Where("contacts.external_id = ?", filter.ExternalID)
	}
	if len(filter.Tags) > 0 {
		query = query.Joins("INNER JOIN contact_tags ON contact_tags.contact_id = contacts.id").
			Joins("INNER JOIN tags ON tags.id = contact_tags.tag_id").
			Where("tags.name IN ?", filter.Tags)
	}

	// Purchase history segmentation
	hasPurchaseFilter := filter.PurchasedShopID != "" || filter.PurchasedSinceDays > 0 ||
		filter.PurchasedMinTotal > 0 || filter.PurchasedStatus != ""
	if hasPurchaseFilter {
		query = query.Joins("INNER JOIN orders ON orders.contact_id = contacts.id")
		if filter.PurchasedShopID != "" {
			if sid, err := uuid.Parse(filter.PurchasedShopID); err == nil {
				query = query.Where("orders.shop_id = ?", sid)
			}
		}
		if filter.PurchasedSinceDays > 0 {
			cutoff := time.Now().AddDate(0, 0, -filter.PurchasedSinceDays)
			query = query.Where("orders.created_at >= ?", cutoff)
		}
		if filter.PurchasedMinTotal > 0 {
			query = query.Where("orders.total >= ?", filter.PurchasedMinTotal)
		}
		if filter.PurchasedStatus != "" {
			query = query.Where("orders.status = ?", filter.PurchasedStatus)
		}
	}
	if filter.NeverPurchased {
		query = query.Joins("LEFT JOIN orders ON orders.contact_id = contacts.id").
			Where("orders.id IS NULL")
	}

	// Contatos que interagiram com agente de IA específico
	if filter.PassedAgentID != "" {
		if aid, err := uuid.Parse(filter.PassedAgentID); err == nil {
			query = query.Where("EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.assigned_user_id = ?)", aid)
		}
	}

	// Inbox behavior filters
	if filter.InboxAssignedTo != "" {
		query = query.Where("EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.assigned_user_id = ?)", filter.InboxAssignedTo)
	}
	if filter.InboxDepartment != "" {
		query = query.Where("EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.department_id = ?)", filter.InboxDepartment)
	}
	if filter.InboxTeam != "" {
		query = query.Where("EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.team_id = ?)", filter.InboxTeam)
	}
	if filter.InboxQueue != "" {
		query = query.Where("EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.queue_id = ?)", filter.InboxQueue)
	}
	if filter.InboxResponseTimeMax > 0 {
		query = query.Where("EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.first_response_at IS NOT NULL AND EXTRACT(EPOCH FROM (conversations.first_response_at - conversations.created_at)) <= ?)", filter.InboxResponseTimeMax)
	}
	if filter.InboxConversationCountMin > 0 {
		query = query.Where("(SELECT COUNT(*) FROM conversations WHERE conversations.contact_id = contacts.id) >= ?", filter.InboxConversationCountMin)
	}
	if filter.InboxLastContactAfter != "" {
		query = query.Where("EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.created_at >= ?)", filter.InboxLastContactAfter)
	}

	// Campaign participation
	if filter.ParticipatedCampaignID != "" {
		query = query.Where("EXISTS (SELECT 1 FROM campaign_recipients cr WHERE cr.phone = contacts.phone AND cr.campaign_id = ?)", filter.ParticipatedCampaignID)
	}

	var contacts []models.Contact
	query.Distinct("contacts.*").Find(&contacts)
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

// Resume godoc
// POST /campaigns/:id/resume — retoma uma campanha pausada.
func (h *CampaignHandler) Resume(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	campaignID := c.Params("id")
	result := h.db.Model(&models.Campaign{}).
		Where("id = ? AND user_id = ? AND status = ?", campaignID, user.ID, models.CampaignStatusPaused).
		Update("status", models.CampaignStatusRunning)
	if result.RowsAffected == 0 {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "campanha não está pausada"})
	}
	return c.JSON(fiber.Map{"status": "running"})
}

// ClearSent godoc
// POST /campaigns/:id/clear-sent — apaga recipients já enviados pra
// poder reusar a campanha (gap UazAPI: limpar fila enviada).
func (h *CampaignHandler) ClearSent(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	campaignID := c.Params("id")
	var campaign models.Campaign
	if err := h.db.Where("id = ? AND user_id = ?", campaignID, user.ID).First(&campaign).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campanha não encontrada"})
	}
	res := h.db.Where("campaign_id = ? AND status = ?", campaign.ID, models.RecipientStatusSent).
		Delete(&models.CampaignRecipient{})
	// reset counters denormalizados
	h.db.Model(&campaign).Updates(map[string]any{
		"sent_count":   0,
		"failed_count": 0,
		"total_count":  campaign.TotalCount - int(res.RowsAffected),
	})
	return c.JSON(fiber.Map{"status": "ok", "removed": res.RowsAffected})
}

// ListMessageStatus godoc
// GET /campaigns/:id/messages — status por recipient (delivered/sent/
// failed/pending), com paginação. Replica /sender/listMessages do
// UazAPI.
func (h *CampaignHandler) ListMessageStatus(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)
	campaignID := c.Params("id")
	var campaign models.Campaign
	if err := h.db.Where("id = ? AND user_id = ?", campaignID, user.ID).First(&campaign).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campanha não encontrada"})
	}
	limit := c.QueryInt("limit", 100)
	if limit < 1 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}
	offset := c.QueryInt("offset", 0)

	q := h.db.Where("campaign_id = ?", campaign.ID)
	if status := strings.TrimSpace(c.Query("status")); status != "" {
		q = q.Where("status = ?", status)
	}

	var total int64
	q.Model(&models.CampaignRecipient{}).Count(&total)

	var recipients []models.CampaignRecipient
	q.Order("created_at desc").Limit(limit).Offset(offset).Find(&recipients)

	return c.JSON(fiber.Map{
		"data":   recipients,
		"total":  total,
		"limit":  limit,
		"offset": offset,
		"summary": fiber.Map{
			"total_count":  campaign.TotalCount,
			"sent_count":   campaign.SentCount,
			"failed_count": campaign.FailedCount,
		},
	})
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
	var externalIDs []string
	var tags []models.Tag
	var segments []models.Segment

	h.db.Model(&models.Contact{}).Distinct("funnel").Where("user_id = ? AND funnel != ''", user.ID).Pluck("funnel", &funnels)
	h.db.Model(&models.Contact{}).Distinct("stage").Where("user_id = ? AND stage != ''", user.ID).Pluck("stage", &stages)
	h.db.Model(&models.Contact{}).Distinct("journey").Where("user_id = ? AND journey != ''", user.ID).Pluck("journey", &journeys)
	h.db.Model(&models.Contact{}).Distinct("owner").Where("user_id = ? AND owner != ''", user.ID).Pluck("owner", &owners)
	h.db.Model(&models.Contact{}).Distinct("external_id").Where("user_id = ? AND external_id != ''", user.ID).Pluck("external_id", &externalIDs)
	h.db.Where("user_id = ?", user.ID).Find(&tags)
	h.db.Select("id, name").Where("workspace_id IN (SELECT id FROM workspaces WHERE user_id = ?)", user.ID).Find(&segments)

	return c.JSON(fiber.Map{
		"funnels":      funnels,
		"stages":       stages,
		"journeys":     journeys,
		"owners":       owners,
		"external_ids": externalIDs,
		"tags":         tags,
		"segments":     segments,
	})
}

// SegmentPreview returns the count and sample contacts for a given filter
// POST /campaigns/segment-preview
func (h *CampaignHandler) SegmentPreview(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	var filter struct {
		Funnel     string   `json:"funnel,omitempty"`
		Stage      string   `json:"stage,omitempty"`
		Journey    string   `json:"journey,omitempty"`
		Tags       []string `json:"tags,omitempty"`
		Owner      string   `json:"owner,omitempty"`
		ExternalID string   `json:"external_id,omitempty"`
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
	if filter.ExternalID != "" {
		query = query.Where("external_id = ?", filter.ExternalID)
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

// processCampaignWABA — caminho de envio dedicado pra instâncias WABA.
//
// Diferenças vs whatsmeow:
//   - Sempre usa template aprovado (Meta exige fora da janela 24h)
//   - HTTP direto pra Meta Cloud API, sem queue/whatsmeow
//   - Variáveis renderizadas via Liquid pra cada destinatário (suporta
//     {{contact.name}}, custom fields, etc)
//   - Header de mídia opcional (template tem que ter HEADER format=IMAGE/VIDEO/DOCUMENT)
//   - Respeita opt-out, freq cap e horário tranquilo igual whatsmeow
func (h *CampaignHandler) processCampaignWABA(c models.Campaign, today string) {
	if c.TemplateName == "" || c.TemplateLanguage == "" {
		log.Warn().Str("campaign", c.ID.String()).Msg("campaign WABA: template não configurado")
		h.db.Model(&c).Updates(map[string]any{
			"status": models.CampaignStatusFailed,
		})
		return
	}

	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", c.InstanceID).First(&waba).Error; err != nil {
		log.Warn().Err(err).Str("campaign", c.ID.String()).Msg("campaign WABA: WABAInstance não encontrada")
		return
	}
	if waba.AccessToken == "" || waba.PhoneNumberID == "" {
		log.Warn().Str("campaign", c.ID.String()).Msg("campaign WABA: credenciais ausentes (re-conecte a instância)")
		return
	}

	var recipients []models.CampaignRecipient
	h.db.Where("campaign_id = ? AND status = ?", c.ID, models.RecipientStatusPending).Find(&recipients)

	if len(recipients) == 0 {
		completedAt := time.Now()
		h.db.Model(&c).Updates(map[string]any{
			"status":       models.CampaignStatusCompleted,
			"completed_at": &completedAt,
		})
		return
	}

	// Parse template_variables: { "1": "{{contact.name}}", "2": "PROMO20", ... }
	var varMap map[string]string
	_ = json.Unmarshal([]byte(c.TemplateVariables), &varMap)

	// Delay entre envios (rate limit Meta — começa baixo, sobe com quality)
	delay := time.Duration(c.DelaySeconds) * time.Second
	if delay < 1*time.Second {
		delay = 1 * time.Second
	}

	for i := range recipients {
		r := &recipients[i]

		// Status check (campanha pode ter sido pausada)
		var fresh models.Campaign
		h.db.Select("status").First(&fresh, c.ID)
		if fresh.Status == models.CampaignStatusPaused || fresh.Status == models.CampaignStatusFailed {
			return
		}

		// Reset diário
		if r.LastSentDate != today {
			r.SentToday = 0
			r.LastSentDate = today
		}
		if r.SentToday >= c.TimesPerDay {
			continue
		}

		// Compliance checks (mesmas regras whatsmeow)
		if c.WorkspaceID != nil {
			ws := *c.WorkspaceID
			if models.IsSuppressed(h.db, ws, r.Phone, "whatsapp") {
				h.db.Model(r).Updates(map[string]any{
					"status": models.RecipientStatusFailed,
					"error":  "suppressed",
				})
				continue
			}
			var contact models.Contact
			h.db.Select("id").Where("(workspace_id = ? OR user_id = ?) AND phone = ?",
				ws, c.UserID, r.Phone).First(&contact)
			if contact.ID != uuid.Nil {
				if freqcap.IsQuietNow(ws, contact.ID, h.db) {
					continue
				}
				if okFC, reason := freqcap.Check(h.db, ws, contact.ID); !okFC {
					log.Debug().Str("phone", r.Phone).Str("reason", reason).Msg("campaign WABA: freq cap")
					continue
				}
			}
		}

		// Renderiza variáveis com Liquid pra esse destinatário
		liquidVars := map[string]any{
			"contact": map[string]any{
				"phone": r.Phone,
				"name":  r.Name,
			},
		}

		// Monta components do template
		components := []map[string]any{}
		if c.TemplateHeaderURL != "" {
			headerURL := templatesvc.MustRender(c.TemplateHeaderURL, liquidVars)
			// Detecta tipo de header pela extensão da URL (heurística simples)
			headerType := "image"
			low := strings.ToLower(headerURL)
			switch {
			case strings.HasSuffix(low, ".mp4"), strings.HasSuffix(low, ".3gp"):
				headerType = "video"
			case strings.HasSuffix(low, ".pdf"):
				headerType = "document"
			}
			components = append(components, map[string]any{
				"type": "header",
				"parameters": []map[string]any{
					{
						"type":     headerType,
						headerType: map[string]any{"link": headerURL},
					},
				},
			})
		}

		// Body parameters em ordem (Meta espera array posicional mesmo pra
		// templates com variáveis nomeadas — backend Cloud API converte).
		bodyParams := []map[string]any{}
		// Itera em ordem 1, 2, 3... pra posicionais OU pelas keys nomeadas.
		// Se tiver chaves numéricas usa ordem; senão ordem de inserção do JSON
		// (Go maps são unordered → ordenamos por chave).
		keys := make([]string, 0, len(varMap))
		for k := range varMap {
			keys = append(keys, k)
		}
		// Ordena: numéricas primeiro por valor inteiro, depois nomeadas alfabético
		sortStringsNumeric(keys)
		for _, k := range keys {
			rendered := templatesvc.MustRender(varMap[k], liquidVars)
			bodyParams = append(bodyParams, map[string]any{
				"type": "text",
				"text": rendered,
			})
		}
		if len(bodyParams) > 0 {
			components = append(components, map[string]any{
				"type":       "body",
				"parameters": bodyParams,
			})
		}

		payload := map[string]any{
			"messaging_product": "whatsapp",
			"to":                r.Phone,
			"type":              "template",
			"template": map[string]any{
				"name":     c.TemplateName,
				"language": map[string]any{"code": c.TemplateLanguage},
				"components": components,
			},
		}
		body, _ := json.Marshal(payload)

		url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/messages", waba.PhoneNumberID)
		req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+waba.AccessToken)
		req.Header.Set("Content-Type", "application/json")
		resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)

		if err != nil {
			log.Warn().Err(err).Str("phone", r.Phone).Msg("campaign WABA: HTTP failed")
			h.db.Model(r).Updates(map[string]any{
				"status": models.RecipientStatusFailed,
				"error":  err.Error(),
			})
			h.db.Model(&c).Update("failed_count", gorm.Expr("failed_count + 1"))
			continue
		}
		respBody, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		if resp.StatusCode >= 400 {
			errMsg := string(respBody)
			if len(errMsg) > 300 {
				errMsg = errMsg[:300]
			}
			log.Warn().Int("status", resp.StatusCode).Str("phone", r.Phone).
				Str("body", errMsg).Msg("campaign WABA: Meta retornou erro")
			h.db.Model(r).Updates(map[string]any{
				"status": models.RecipientStatusFailed,
				"error":  errMsg,
			})
			h.db.Model(&c).Update("failed_count", gorm.Expr("failed_count + 1"))
			continue
		}

		// Sucesso
		var metaResp struct {
			Messages []struct {
				ID string `json:"id"`
			} `json:"messages"`
		}
		_ = json.Unmarshal(respBody, &metaResp)
		messageID := ""
		if len(metaResp.Messages) > 0 {
			messageID = metaResp.Messages[0].ID
		}

		h.db.Model(r).Updates(map[string]any{
			"status":         models.RecipientStatusSent,
			"sent_at":        time.Now(),
			"sent_today":     r.SentToday + 1,
			"last_sent_date": today,
			"message_id":     messageID,
		})
		h.db.Model(&c).Update("sent_count", gorm.Expr("sent_count + 1"))

		// Create/link conversation in inbox so agents see the campaign outbound
		if h.pipeline != nil && c.InstanceID != uuid.Nil {
			ml := models.MessageLog{
				ID:                uuid.New(),
				InstanceID:        c.InstanceID,
				Direction:         models.DirectionOut,
				Type:              "template",
				ToJID:             r.Phone,
				Content:           string(body),
				Status:            models.MessageStatusSent,
				ExternalMessageID: messageID,
			}
			if c.WorkspaceID != nil {
				ml.WorkspaceID = c.WorkspaceID
			}
			go func(m models.MessageLog) {
				if err := h.pipeline.ProcessSavedOutbound(context.Background(), &m); err != nil {
					log.Warn().Err(err).Str("phone", m.ToJID).Msg("campaign WABA: pipeline failed")
				}
			}(ml)
		}

		// Spread between sends
		time.Sleep(delay)
	}

	// Verifica fim
	var pending int64
	h.db.Model(&models.CampaignRecipient{}).
		Where("campaign_id = ? AND status = ?", c.ID, models.RecipientStatusPending).
		Count(&pending)
	if pending == 0 {
		completedAt := time.Now()
		h.db.Model(&c).Updates(map[string]any{
			"status":       models.CampaignStatusCompleted,
			"completed_at": &completedAt,
		})
	}
}

// sortStringsNumeric ordena strings: numéricas primeiro por valor numérico
// (1, 2, 10 não 1, 10, 2), depois nomeadas alfabético.
func sortStringsNumeric(keys []string) {
	// quicksort manual pra evitar import sort
	if len(keys) < 2 {
		return
	}
	cmp := func(a, b string) bool {
		var ai, bi int
		_, errA := fmt.Sscanf(a, "%d", &ai)
		_, errB := fmt.Sscanf(b, "%d", &bi)
		if errA == nil && errB == nil {
			return ai < bi
		}
		if errA == nil {
			return true
		}
		if errB == nil {
			return false
		}
		return a < b
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && cmp(keys[j], keys[j-1]); j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
}

// Diagnose GET /v1/campaigns/:id/diagnose
// Retorna por que a campanha não está rodando agora — útil pra
// debug quando user vê "scheduled" mas nada dispara.
func (h *CampaignHandler) Diagnose(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var camp models.Campaign
	if err := h.db.First(&camp, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campanha não encontrada"})
	}

	now := time.Now()
	loc := h.workspaceLocation(&camp)
	local := now.In(loc)
	currentHour := local.Hour()

	checks := []map[string]any{}
	add := func(label string, ok bool, detail string) {
		checks = append(checks, map[string]any{"check": label, "ok": ok, "detail": detail})
	}
	add("timezone", true, fmt.Sprintf("workspace = %s · agora local = %s", loc.String(), local.Format("2006-01-02 15:04 MST")))

	// 1. Status
	statusOK := camp.Status == models.CampaignStatusRunning || camp.Status == models.CampaignStatusScheduled
	add("status", statusOK, fmt.Sprintf("status atual = %q (scheduler só pega running|scheduled)", camp.Status))

	// 2. Date window
	if camp.StartDate != nil {
		ok := !now.Before(*camp.StartDate)
		add("start_date", ok, fmt.Sprintf("start_date = %s · agora = %s", camp.StartDate.Format(time.RFC3339), now.Format(time.RFC3339)))
	} else {
		add("start_date", true, "sem start_date — pode iniciar a qualquer momento")
	}
	if camp.EndDate != nil {
		ok := !now.After(*camp.EndDate)
		add("end_date", ok, fmt.Sprintf("end_date = %s", camp.EndDate.Format(time.RFC3339)))
	} else {
		add("end_date", true, "sem end_date")
	}

	// 3. Schedule hours
	add("schedule_hours", inScheduleNow(camp.ScheduleHours, currentHour, local.Minute()),
		fmt.Sprintf("agora local = %02d:%02d (%s) · schedule_hours = %s ([] = qualquer horário; aceita janelas HH:MM)",
			currentHour, local.Minute(), loc.String(), camp.ScheduleHours))

	// 4. Instance reachability
	var inst models.Instance
	if err := h.db.First(&inst, "id = ?", camp.InstanceID).Error; err != nil {
		add("instance", false, "instância não encontrada no DB")
	} else {
		add("instance_db", true, fmt.Sprintf("%s · canal=%s · status=%s", inst.Name, inst.Channel, inst.Status))
		if inst.Channel != models.ChannelWABA {
			client := h.manager.GetInstance(inst.ID.String())
			if client == nil {
				add("instance_client", false, "instância não está em memória (manager.GetInstance==nil) — reconecte")
			} else if !client.IsConnected() {
				add("instance_client", false, "client existe mas IsConnected()==false — reconecte")
			} else {
				add("instance_client", true, "instância conectada e em memória")
			}
		}
	}

	// 5. Recipients
	var totalRcpt, pending, sent, failed int64
	h.db.Model(&models.CampaignRecipient{}).Where("campaign_id = ?", camp.ID).Count(&totalRcpt)
	h.db.Model(&models.CampaignRecipient{}).Where("campaign_id = ? AND status = ?", camp.ID, models.RecipientStatusPending).Count(&pending)
	h.db.Model(&models.CampaignRecipient{}).Where("campaign_id = ? AND status = ?", camp.ID, models.RecipientStatusSent).Count(&sent)
	h.db.Model(&models.CampaignRecipient{}).Where("campaign_id = ? AND status = ?", camp.ID, models.RecipientStatusFailed).Count(&failed)
	add("recipients", pending > 0,
		fmt.Sprintf("total=%d · pending=%d · sent=%d · failed=%d", totalRcpt, pending, sent, failed))

	// Final verdict
	wouldRun := true
	for _, ck := range checks {
		if ok, _ := ck["ok"].(bool); !ok {
			wouldRun = false
			break
		}
	}

	return c.JSON(fiber.Map{
		"campaign_id":  camp.ID,
		"name":         camp.Name,
		"would_run":    wouldRun,
		"now":          now.Format(time.RFC3339),
		"checks":       checks,
		"server_time":  now.Format(time.RFC3339),
	})
}

// RunNow POST /v1/campaigns/:id/run-now
// Força um tick imediato pra essa campanha, ignorando o ciclo de 60s
// do scheduler. Respeita os filtros (status, janela, hora).
func (h *CampaignHandler) RunNow(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var camp models.Campaign
	if err := h.db.First(&camp, "id = ?", id).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campanha não encontrada"})
	}

	now := time.Now()
	if reason := h.evaluateCampaign(&camp, now, now.Hour()); reason != "" {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{
			"error":  "campanha não pode rodar agora",
			"reason": reason,
		})
	}

	if camp.Status != models.CampaignStatusRunning {
		startedAt := now
		h.db.Model(&camp).Updates(map[string]interface{}{
			"status":     models.CampaignStatusRunning,
			"started_at": &startedAt,
		})
	}
	go h.processCampaign(camp, now.Format("2006-01-02"))

	return c.JSON(fiber.Map{"ok": true, "message": "tick disparado"})
}
