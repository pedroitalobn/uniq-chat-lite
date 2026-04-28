package services

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// JourneyEventDispatcher — propaga eventos externos (Shop, CRM, Tags)
// pras execuções de jornada ativas pra:
//   1. Goal tracking — incrementa GoalCount + marca conversão
//   2. Exit conditions — encerra execuções que batem condição
//
// Inspirado em Customer.io exit conditions + goals.
//
// Uso (chame de outros services após mutações relevantes):
//
//   journey.DispatchEvent(db, "shop.order_paid",
//     contactID, map[string]any{"shop_id": "...", "total": 1000})
type JourneyEventDispatcher struct {
	db *gorm.DB
}

// global singleton — outros services chamam DispatchJourneyEvent direto.
var globalDispatcher *JourneyEventDispatcher

func NewJourneyEventDispatcher(db *gorm.DB) *JourneyEventDispatcher {
	d := &JourneyEventDispatcher{db: db}
	globalDispatcher = d
	return d
}

// DispatchJourneyEvent — atalho global pra outros packages chamarem
// sem injetar dependência.
func DispatchJourneyEvent(eventType, contactJID string, payload map[string]any) {
	if globalDispatcher == nil {
		return
	}
	globalDispatcher.Dispatch(eventType, contactJID, payload)
}

// Dispatch processa um evento. Não bloqueia: best-effort com logs.
//
// eventType: ex "shop.order_paid", "deal.won", "tag.added:vip".
// contactJID: jid do contato no execução (formato whatsapp:5511...). Vazio = broadcast.
// payload: dado livre serializado em ConversationEvent + matching de exit.
func (d *JourneyEventDispatcher) Dispatch(eventType, contactJID string, payload map[string]any) {
	if eventType == "" {
		return
	}
	d.trackGoals(eventType, contactJID, payload)
	d.applyExitConditions(eventType, contactJID, payload)
}

func (d *JourneyEventDispatcher) trackGoals(eventType, contactJID string, payload map[string]any) {
	if contactJID == "" {
		return
	}
	var journeys []models.Journey
	if err := d.db.Where("goal_event = ?", eventType).Find(&journeys).Error; err != nil {
		return
	}
	for _, j := range journeys {
		var count int64
		d.db.Model(&models.JourneyExecution{}).
			Where("journey_id = ? AND contact_jid = ? AND status IN ?",
				j.ID, contactJID,
				[]models.JourneyExecutionStatus{models.ExecutionActive, models.JourneyExecutionStatus("waiting_input")}).
			Count(&count)
		if count == 0 {
			continue
		}
		d.db.Model(&models.Journey{}).Where("id = ?", j.ID).
			UpdateColumn("goal_count", gorm.Expr("goal_count + 1"))
		log.Info().
			Str("journey", j.ID).
			Str("event", eventType).
			Str("contact_jid", contactJID).
			Msg("journey: goal achieved")
	}
}

func (d *JourneyEventDispatcher) applyExitConditions(eventType, contactJID string, payload map[string]any) {
	if contactJID == "" {
		return
	}
	var execs []models.JourneyExecution
	d.db.Where("contact_jid = ? AND status IN ?", contactJID,
		[]models.JourneyExecutionStatus{models.ExecutionActive, models.JourneyExecutionStatus("waiting_input")}).
		Find(&execs)
	if len(execs) == 0 {
		return
	}
	// Pra cada execução, lê ExitConditions do journey e bate com o evento.
	for _, ex := range execs {
		var j models.Journey
		if d.db.First(&j, "id = ?", ex.JourneyID).Error != nil {
			continue
		}
		if j.ExitConditions == "" || j.ExitConditions == "[]" {
			continue
		}
		var conds []map[string]any
		if err := json.Unmarshal([]byte(j.ExitConditions), &conds); err != nil {
			continue
		}
		matched := false
		for _, c := range conds {
			if matchExitCondition(c, eventType, payload) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		now := time.Now()
		d.db.Model(&models.JourneyExecution{}).
			Where("id = ?", ex.ID).
			Updates(map[string]any{
				"status":       "completed",
				"completed_at": &now,
			})
		log.Info().
			Str("execution", ex.ID).
			Str("journey", j.ID).
			Str("event", eventType).
			Msg("journey: exit condition triggered")
	}
}

// matchExitCondition retorna true se o evento bate com a regra.
//
// Forma das regras (em ExitConditions JSON array):
//   { "event": "shop.order_paid" }
//   { "event": "tag.added", "tag": "cliente" }
//   { "event_prefix": "deal." }
func matchExitCondition(cond map[string]any, eventType string, payload map[string]any) bool {
	if v, ok := cond["event"].(string); ok && v == eventType {
		// Match exato; se a regra tem campos extras, valida payload.
		for k, expected := range cond {
			if k == "event" {
				continue
			}
			if got, has := payload[k]; !has || got != expected {
				return false
			}
		}
		return true
	}
	if v, ok := cond["event_prefix"].(string); ok && strings.HasPrefix(eventType, v) {
		return true
	}
	return false
}
