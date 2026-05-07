package services

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// CrmJourneyDispatcher dispara journeys vinculadas a eventos de
// CRM (deal stage change, deal won/lost, etc.). Hookado dos
// handlers de Deal (Move/Create/Win/Lose) — quando o evento ocorre,
// procura journeys configuradas com aquele trigger_type + filtros
// e cria JourneyExecution pra cada match.
//
// Filtros suportados no journey.trigger_filter (JSON):
//   - funnel_id  (UUID): só dispara se o deal está nesse funil
//   - stage_id   (UUID): só dispara se o deal está nesse stage
//   - status     ("won" | "lost" | "open"): só dispara nesse status
//   - min_value/max_value: só dispara se valor cair no range
type CrmJourneyDispatcher struct {
	db *gorm.DB
}

func NewCrmJourneyDispatcher(db *gorm.DB) *CrmJourneyDispatcher {
	return &CrmJourneyDispatcher{db: db}
}

type dealTriggerFilter struct {
	FunnelID string `json:"funnel_id,omitempty"`
	StageID  string `json:"stage_id,omitempty"`
	Status   string `json:"status,omitempty"`
	MinValue int64  `json:"min_value,omitempty"`
	MaxValue int64  `json:"max_value,omitempty"`
}

// FireDealEvent localiza journeys ativas que escutam esse trigger
// e cria execution pra cada match — async/non-blocking pra não atrasar
// o handler que disparou.
func (d *CrmJourneyDispatcher) FireDealEvent(triggerType models.TriggerType, deal *models.Deal) {
	if d == nil || d.db == nil || deal == nil {
		return
	}
	go d.dispatch(triggerType, deal)
}

func (d *CrmJourneyDispatcher) dispatch(triggerType models.TriggerType, deal *models.Deal) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Str("trigger", string(triggerType)).
				Str("deal", deal.ID.String()).Msg("crm_dispatcher: panic recovered")
		}
	}()

	var journeys []models.Journey
	d.db.Where("trigger_type = ? AND status = ?", string(triggerType), "active").Find(&journeys)
	if len(journeys) == 0 {
		return
	}

	for i := range journeys {
		j := &journeys[i]
		if !d.matchesFilter(j, deal) {
			continue
		}
		d.startExecution(j, deal)
	}
}

func (d *CrmJourneyDispatcher) matchesFilter(j *models.Journey, deal *models.Deal) bool {
	raw := strings.TrimSpace(j.TriggerFilter)
	if raw == "" || raw == "{}" {
		return true // sem filtro = dispara sempre
	}
	var f dealTriggerFilter
	if err := json.Unmarshal([]byte(raw), &f); err != nil {
		log.Warn().Err(err).Str("journey", j.ID).Msg("crm_dispatcher: trigger_filter inválido — ignorado")
		return true
	}
	if f.FunnelID != "" {
		if fid, err := uuid.Parse(f.FunnelID); err == nil && fid != deal.FunnelID {
			return false
		}
	}
	if f.StageID != "" {
		if sid, err := uuid.Parse(f.StageID); err == nil && sid != deal.StageID {
			return false
		}
	}
	if f.Status != "" && string(deal.Status) != f.Status {
		return false
	}
	if f.MinValue > 0 && deal.Value < f.MinValue {
		return false
	}
	if f.MaxValue > 0 && deal.Value > f.MaxValue {
		return false
	}
	return true
}

func (d *CrmJourneyDispatcher) startExecution(j *models.Journey, deal *models.Deal) {
	// Carrega contato pra usar phone como ContactJID (chave do execution).
	var contact models.Contact
	if err := d.db.Select("id, phone, external_id").First(&contact, "id = ?", deal.ContactID).Error; err != nil {
		log.Warn().Err(err).Str("deal", deal.ID.String()).Msg("crm_dispatcher: contact não encontrado")
		return
	}
	jid := contact.ExternalID
	if jid == "" {
		jid = contact.Phone
	}

	// ReEntry rule: respeita "never" (só executa uma vez por contato).
	if strings.HasPrefix(j.ReEntryRule, "never") {
		var existing int64
		d.db.Model(&models.JourneyExecution{}).
			Where("journey_id = ? AND contact_jid = ?", j.ID, jid).Count(&existing)
		if existing > 0 {
			log.Debug().Str("journey", j.ID).Str("contact", jid).Msg("crm_dispatcher: skip — re-entry=never")
			return
		}
	}

	exec := models.JourneyExecution{
		JourneyID:   j.ID,
		ContactJID:  jid,
		Status:      models.ExecutionActive,
		StartedAt:   time.Now(),
	}
	// Hidrata os campos opcionais via reflection-friendly path: usar
	// o map de payload se o model aceitar. Pra compat fazemos só os
	// campos garantidos.
	d.db.Create(&exec)

	// Incrementa o counter da journey pra dashboard.
	d.db.Model(j).Update("invocations", gorm.Expr("invocations + 1"))

	log.Info().
		Str("journey", j.ID).
		Str("deal", deal.ID.String()).
		Str("contact", jid).
		Str("trigger", j.TriggerType).
		Msg("crm_dispatcher: journey execution criada")
}
