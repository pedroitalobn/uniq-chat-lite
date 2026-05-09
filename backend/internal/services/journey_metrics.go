package services

import (
	"math/rand"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/uniq-chat/backend/internal/models"
)

// incStepMetric — increment atômico de counter (entered/completed/
// errored) pra um step. Usa upsert ON CONFLICT pra criar a linha
// na primeira passagem ou atualizar in-place. Sem race com select-
// then-update.
//
// Performance: 1 query por chamada. Em flow com 10 steps × 5 events
// (enter+complete) = 100 queries por execução. Aceitável; se virar
// gargalo, batch async via channel.
func (e *JourneyExecutor) incStepMetric(journeyID, stepID, stepType, label, counter string) {
	if e.db == nil || journeyID == "" || stepID == "" {
		return
	}
	if counter != "entered" && counter != "completed" && counter != "errored" && counter != "skipped" {
		return
	}
	// Trunca label pra evitar varchar overflow.
	if len(label) > 250 {
		label = label[:250]
	}
	// UPSERT — cria linha se não existe; senão increment do counter.
	now := time.Now().UTC()
	row := models.JourneyStepMetric{
		ID:        uuid.New(),
		JourneyID: journeyID,
		StepID:    stepID,
		StepType:  stepType,
		StepLabel: label,
		CreatedAt: now,
		UpdatedAt: now,
	}
	switch counter {
	case "entered":
		row.Entered = 1
	case "completed":
		row.Completed = 1
	case "errored":
		row.Errored = 1
	case "skipped":
		row.Skipped = 1
	}
	err := e.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "journey_id"}, {Name: "step_id"}},
		DoUpdates: clause.Assignments(map[string]any{
			counter:    gorm.Expr(counter+" + ?", 1),
			"step_type": stepType,
			"step_label": label,
			"updated_at": now,
		}),
	}).Create(&row).Error
	if err != nil {
		log.Debug().Err(err).Str("journey", journeyID).Str("step", stepID).
			Str("counter", counter).Msg("step metric upsert failed (non-fatal)")
	}
}

// recordStepError — armazena última mensagem de erro pra debug.
// Trunca em 500 chars pra evitar text bloat.
func (e *JourneyExecutor) recordStepError(journeyID, stepID, errMsg string) {
	if errMsg == "" {
		return
	}
	if len(errMsg) > 500 {
		errMsg = errMsg[:500]
	}
	e.db.Model(&models.JourneyStepMetric{}).
		Where("journey_id = ? AND step_id = ?", journeyID, stepID).
		Update("last_error_message", errMsg)
}

// shouldHoldout — sorteia se contato vai pro grupo de controle.
// HoldoutPercent é capeado em 50 pra evitar holdout > tratamento.
// Sem CSPRNG porque distribuição estatística não precisa ser
// criptográfica (rand standard library é suficiente).
func shouldHoldout(holdoutPercent int) bool {
	if holdoutPercent <= 0 {
		return false
	}
	if holdoutPercent > 50 {
		holdoutPercent = 50
	}
	return rand.Intn(100) < holdoutPercent
}
