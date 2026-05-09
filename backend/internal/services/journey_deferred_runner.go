package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/uniq-chat/backend/internal/models"
)

// StartDeferredStepRunner — worker que retoma execuções de jornada
// que estavam dormindo num wait longo (>60s).
//
// Tick de 30s. A cada tick:
//   1. Pega lote de 50 JourneyDeferredStep com status=pending e
//      fire_at <= now, marca status=processing em transação atômica
//      (evita race entre múltiplos pods).
//   2. Pra cada um, chama resumeDeferred() em goroutine: carrega
//      execution + journey + flow, reconstrói execCtx com vars
//      persistidas, e roda run() a partir de NextStepID.
//   3. resumeDeferred marca o defer como completed/failed/skipped.
//
// Se o flow continuação bater em outro wait longo, novo
// JourneyDeferredStep é criado pelo stepWait — ciclo se repete.
//
// Crash safety: defers ficam em status=processing se o pod cair no
// meio. Cleanup periódico marca como pending de novo se ficaram
// stuck por mais que 5min (defensive — flow normalmente leva ms).
func (e *JourneyExecutor) StartDeferredStepRunner(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()

		// Recover stuck no boot — defers que ficaram em "processing"
		// quando o pod anterior morreu são re-armados.
		e.recoverStuckDeferred()

		// Tick inicial imediato pra não esperar 30s na primeira passada.
		e.runDeferredTick(ctx)

		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("journey deferred runner: stopping")
				return
			case <-ticker.C:
				e.runDeferredTick(ctx)
			}
		}
	}()
}

func (e *JourneyExecutor) runDeferredTick(ctx context.Context) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("journey deferred runner: PANIC no tick")
		}
	}()

	now := time.Now().UTC()
	var toProcess []models.JourneyDeferredStep

	if err := e.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Where("status = ? AND fire_at <= ?", models.JourneyDeferredPending, now).
			Order("fire_at ASC").
			Limit(50).
			Find(&toProcess).Error; err != nil {
			return err
		}
		if len(toProcess) == 0 {
			return nil
		}
		ids := make([]uuid.UUID, len(toProcess))
		for i, d := range toProcess {
			ids[i] = d.ID
		}
		return tx.Model(&models.JourneyDeferredStep{}).
			Where("id IN ? AND status = ?", ids, models.JourneyDeferredPending).
			Updates(map[string]any{
				"status":     models.JourneyDeferredProcessing,
				"updated_at": now,
			}).Error
	}); err != nil {
		log.Warn().Err(err).Msg("journey deferred runner: erro ao reservar lote")
		return
	}

	for _, d := range toProcess {
		go e.resumeDeferred(ctx, d)
	}
}

// recoverStuckDeferred — devolve pendings que ficaram em "processing"
// por mais de 5min ao status pending. Cobre cenário de crash do pod
// no meio do resume. Roda 1× no boot (chamado por StartDeferredStepRunner).
func (e *JourneyExecutor) recoverStuckDeferred() {
	cutoff := time.Now().UTC().Add(-5 * time.Minute)
	var n int64
	r := e.db.Model(&models.JourneyDeferredStep{}).
		Where("status = ? AND updated_at < ?", models.JourneyDeferredProcessing, cutoff).
		Updates(map[string]any{"status": models.JourneyDeferredPending})
	if r.Error != nil {
		log.Warn().Err(r.Error).Msg("journey deferred runner: recover stuck failed")
		return
	}
	n = r.RowsAffected
	if n > 0 {
		log.Info().Int64("count", n).Msg("journey deferred runner: re-armou defers stuck no boot")
	}
}

// resumeDeferred — reconstrói o estado da execução e continua o flow
// a partir do NextStepID. Idempotente via status="processing" (o
// runDeferredTick já marcou).
func (e *JourneyExecutor) resumeDeferred(parentCtx context.Context, d models.JourneyDeferredStep) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().
				Str("deferred", d.ID.String()).
				Interface("panic", r).
				Msg("journey deferred runner: PANIC ao retomar")
			e.markDeferred(d.ID, models.JourneyDeferredFailed, fmt.Sprintf("panic: %v", r))
		}
	}()

	// Carrega execution fresh.
	var exec models.JourneyExecution
	if err := e.db.WithContext(parentCtx).First(&exec, "id = ?", d.ExecutionID).Error; err != nil {
		e.markDeferred(d.ID, models.JourneyDeferredSkipped, "execution não encontrada")
		return
	}
	// Se foi cancelada/completada por outro caminho, skip.
	if exec.Status != "waiting" && exec.Status != "active" {
		e.markDeferred(d.ID, models.JourneyDeferredSkipped, fmt.Sprintf("execution status=%s", exec.Status))
		return
	}

	var journey models.Journey
	if err := e.db.WithContext(parentCtx).First(&journey, "id = ?", d.JourneyID).Error; err != nil {
		e.markDeferred(d.ID, models.JourneyDeferredFailed, "journey não encontrada")
		return
	}
	if journey.Status != "active" {
		e.markDeferred(d.ID, models.JourneyDeferredSkipped, "journey pausada/inativa")
		return
	}

	// Parse do flow JSON do journey.
	var flow models.JourneyFlow
	if journey.Flow != "" && journey.Flow != "{}" {
		if err := json.Unmarshal([]byte(journey.Flow), &flow); err != nil {
			e.markDeferred(d.ID, models.JourneyDeferredFailed, "flow inválido: "+err.Error())
			return
		}
	}
	nextStep := flow.FindStep(d.NextStepID)
	if nextStep == nil {
		// Step não existe mais (flow editado depois do defer). Encerra
		// limpo — se o flow inteiro foi rebuilt, o step antigo já não
		// faz sentido.
		e.markDeferred(d.ID, models.JourneyDeferredSkipped, "next_step não existe mais no flow")
		// Marca execution como completed pra não ficar em "waiting"
		// pendurada pra sempre.
		now := time.Now().UTC()
		exec.Status = models.ExecutionCompleted
		exec.CompletedAt = &now
		_ = e.db.Save(&exec).Error
		return
	}

	// Reconstrói vars + execCtx.
	vars := e.loadVars(&exec)
	ctx := &execCtx{
		journey:    &journey,
		execution:  &exec,
		flow:       &flow,
		vars:       vars,
		fromJID:    d.ContactJID,
		fromName:   d.ContactName,
		groupJID:   d.GroupJID,
		instanceID: d.InstanceID,
		simulate:   false,
	}
	// Volta status pra active enquanto flow corre.
	exec.Status = models.ExecutionActive
	_ = e.db.Save(&exec).Error

	log.Info().
		Str("deferred", d.ID.String()).
		Str("exec", exec.ID).
		Str("next_step", nextStep.ID).
		Msg("journey deferred runner: retomando flow")

	// Marca o defer como completed ANTES de continuar o flow — se o
	// flow bater em outro wait, novo defer é criado; se completar,
	// completed; se falhar, fica completed mesmo (o erro é da
	// execution, não do defer original).
	e.markDeferred(d.ID, models.JourneyDeferredCompleted, "")

	// Continua o flow. Vai rodar até bater outro wait/input/end.
	e.run(ctx, nextStep)
}

func (e *JourneyExecutor) markDeferred(id uuid.UUID, status, errMsg string) {
	now := time.Now().UTC()
	updates := map[string]any{
		"status":       status,
		"processed_at": &now,
		"updated_at":   now,
	}
	if errMsg != "" {
		updates["error"] = errMsg
	}
	if err := e.db.Model(&models.JourneyDeferredStep{}).
		Where("id = ?", id).
		Updates(updates).Error; err != nil {
		log.Warn().Err(err).Str("deferred", id.String()).Msg("mark deferred failed")
	}
}
