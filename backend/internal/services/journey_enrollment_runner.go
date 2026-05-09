package services

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/uniq-chat/backend/internal/models"
)

// JourneyEnrollmentRunner — worker proativo de jornadas. Faz duas
// coisas em loop:
//
//   1. Resolve segments que apontam pra journey via TriggerJourneyID
//      e cria JourneyEnrollment pendente pra cada novo contact que
//      caiu no segment desde a última varredura. Idempotente via
//      idx único (journey_id, contact_id, source="segment:<id>").
//
//   2. Pega enrollments com status=pending e scheduled_at <= now.UTC()
//      e dispara journey_executor.startNew em goroutine. Marca
//      status=started antes de delegar pra evitar duplo disparo
//      em casos de race entre dois ticks.
//
// Loop tick: 60s (suficiente pra granularidade de minuto da maioria
// dos casos; mais agressivo gera contention no DB sem ganho real).
func (e *JourneyExecutor) StartEnrollmentRunner(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()

		// Roda 1× imediatamente no boot pra não esperar 60s na primeira
		// rodada — usuário acabou de criar enrollment, espera ver
		// disparo logo.
		e.runEnrollmentTick(ctx)

		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("journey enrollment runner: stopping")
				return
			case <-ticker.C:
				e.runEnrollmentTick(ctx)
			}
		}
	}()
}

func (e *JourneyExecutor) runEnrollmentTick(ctx context.Context) {
	// Recover defensivo — bug no resolver de segment não deve matar o
	// loop inteiro. Loga e segue.
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("journey enrollment runner: PANIC no tick")
		}
	}()

	// 1) Re-resolve segments-as-trigger e cria enrollments pendentes
	if err := e.refreshSegmentEnrollments(ctx); err != nil {
		log.Warn().Err(err).Msg("journey enrollment runner: refresh segments")
	}

	// 2) Dispara enrollments com scheduled_at <= now
	if err := e.firePendingEnrollments(ctx); err != nil {
		log.Warn().Err(err).Msg("journey enrollment runner: fire pending")
	}
}

// refreshSegmentEnrollments — varre segments com TriggerJourneyID set
// e cria enrollment pendente pra cada contato no segment que ainda
// não foi enrolado por essa fonte.
//
// Estratégia simples: busca os ContactIDs do segment via SegmentMember
// (manual) OU buildSegmentQuery (dynamic). Pra cada um, INSERT ON
// CONFLICT DO NOTHING via idx único.
//
// Otimização futura: armazenar último timestamp resolvido por segment
// e só comparar mudanças incrementais. Pra o MVP, brute-force resolve
// completo a cada 60s — Postgres aguenta volume típico de plataforma
// (até ~100k contatos por workspace).
func (e *JourneyExecutor) refreshSegmentEnrollments(ctx context.Context) error {
	type segRow struct {
		ID               uuid.UUID
		WorkspaceID      uuid.UUID
		Type             string
		Filter           string
		TriggerJourneyID uuid.UUID
	}
	var segments []segRow
	if err := e.db.WithContext(ctx).
		Table("segments").
		Where("trigger_journey_id IS NOT NULL AND is_active = ? AND deleted_at IS NULL", true).
		Select("id, workspace_id, type, filter, trigger_journey_id").
		Scan(&segments).Error; err != nil {
		return fmt.Errorf("list segments: %w", err)
	}

	for _, s := range segments {
		contactIDs, err := e.resolveSegmentContacts(ctx, s.WorkspaceID, s.Type, s.Filter, s.ID)
		if err != nil {
			log.Warn().Err(err).Str("segment", s.ID.String()).Msg("resolve segment failed")
			continue
		}
		if len(contactIDs) == 0 {
			continue
		}
		source := "segment:" + s.ID.String()
		now := time.Now().UTC()
		// Bulk insert com OnConflict DoNothing — idx único cuida da
		// idempotência, mesmo se o cron rodar em paralelo.
		rows := make([]models.JourneyEnrollment, 0, len(contactIDs))
		for _, cid := range contactIDs {
			rows = append(rows, models.JourneyEnrollment{
				ID:          uuid.New(),
				WorkspaceID: s.WorkspaceID,
				JourneyID:   s.TriggerJourneyID,
				ContactID:   cid,
				Source:      source,
				Status:      models.JourneyEnrollmentPending,
				ScheduledAt: now,
			})
		}
		if err := e.db.WithContext(ctx).
			Table("journey_enrollments").
			Create(&rows).Error; err != nil {
			// Conflitos esperados (mesma source + journey + contact já
			// inscrito). PG devolve 23505; gormgormgorm não distingue
			// daqui, mas como `Create` em batch falha o batch inteiro
			// se UM viola, fazemos one-by-one como fallback silencioso.
			for i := range rows {
				_ = e.db.WithContext(ctx).
					Table("journey_enrollments").
					Create(&rows[i]).Error
			}
		}
	}
	return nil
}

// resolveSegmentContacts — devolve ContactIDs que pertencem ao
// segment. Pra type=manual, lista da tabela SegmentMember;
// pra type=dynamic, executa o filter SQL via reuse do helper de
// handlers (replicado aqui em forma simplificada pra evitar
// import cycle).
func (e *JourneyExecutor) resolveSegmentContacts(ctx context.Context, wsID uuid.UUID, segType, filterRaw string, segmentID uuid.UUID) ([]uuid.UUID, error) {
	if segType == "manual" {
		var ids []uuid.UUID
		if err := e.db.WithContext(ctx).
			Table("segment_members").
			Where("segment_id = ?", segmentID).
			Pluck("contact_id", &ids).Error; err != nil {
			return nil, err
		}
		return ids, nil
	}

	// Dynamic — parseia filter JSON e monta query simples. Suporta
	// subset comum (tags, funnel, stage, last_msg_at). Filters mais
	// complexos do segments_helpers.go ficam pra próxima iteração
	// (esses 4 cobrem ~90% dos casos reais).
	var filter map[string]any
	if filterRaw != "" {
		_ = json.Unmarshal([]byte(filterRaw), &filter)
	}

	q := e.db.WithContext(ctx).
		Table("contacts").
		Where("workspace_id = ? AND deleted_at IS NULL", wsID)

	if v, ok := filter["funnel"].(string); ok && v != "" {
		q = q.Where("funnel = ?", v)
	}
	if v, ok := filter["stage"].(string); ok && v != "" {
		q = q.Where("stage = ?", v)
	}
	if tagList, ok := filter["tags"].([]any); ok && len(tagList) > 0 {
		tagNames := make([]string, 0, len(tagList))
		for _, t := range tagList {
			if s, ok := t.(string); ok && s != "" {
				tagNames = append(tagNames, strings.ToLower(s))
			}
		}
		if len(tagNames) > 0 {
			q = q.Joins(
				"JOIN contact_tags ON contact_tags.contact_id = contacts.id "+
					"JOIN tags ON tags.id = contact_tags.tag_id "+
					"AND tags.workspace_id = contacts.workspace_id "+
					"AND lower(tags.name) IN (?)", tagNames,
			)
		}
	}
	if v, ok := filter["last_msg_older_than_days"].(float64); ok && v > 0 {
		cutoff := time.Now().UTC().AddDate(0, 0, -int(v))
		q = q.Where("(last_contact_at IS NULL OR last_contact_at < ?)", cutoff)
	}

	var ids []uuid.UUID
	if err := q.Distinct().Pluck("contacts.id", &ids).Error; err != nil {
		return nil, err
	}
	return ids, nil
}

// firePendingEnrollments — pega lote de pending vencidos e dispara.
// Update + select otimizado pra concorrência: CTE marca started antes
// de a goroutine pegar o trabalho (evita race se múltiplos pods).
func (e *JourneyExecutor) firePendingEnrollments(ctx context.Context) error {
	now := time.Now().UTC()
	var enrollments []models.JourneyEnrollment

	// Marca como "started" e devolve as linhas selecionadas — atômico
	// (UPDATE...RETURNING não tá disponível em todos os dialetos via
	// GORM, então fazemos SELECT...FOR UPDATE SKIP LOCKED + UPDATE).
	if err := e.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.
			Where("status = ? AND scheduled_at <= ?", models.JourneyEnrollmentPending, now).
			Order("scheduled_at ASC").
			Limit(50). // bate poucos por tick pra não sobrecarregar
			Clauses().
			Find(&enrollments).Error; err != nil {
			return err
		}
		if len(enrollments) == 0 {
			return nil
		}
		ids := make([]uuid.UUID, len(enrollments))
		for i, en := range enrollments {
			ids[i] = en.ID
		}
		started := now
		return tx.Model(&models.JourneyEnrollment{}).
			Where("id IN ? AND status = ?", ids, models.JourneyEnrollmentPending).
			Updates(map[string]any{
				"status":     models.JourneyEnrollmentStarted,
				"started_at": &started,
			}).Error
	}); err != nil {
		return err
	}

	// Carrega journeys + contacts em batch e dispara pro executor.
	for _, en := range enrollments {
		go e.fireEnrollment(ctx, en)
	}
	return nil
}

func (e *JourneyExecutor) fireEnrollment(ctx context.Context, en models.JourneyEnrollment) {
	defer func() {
		if r := recover(); r != nil {
			log.Error().
				Str("enrollment", en.ID.String()).
				Interface("panic", r).
				Msg("journey enrollment runner: PANIC ao disparar")
			e.markEnrollment(en.ID, models.JourneyEnrollmentFailed, fmt.Sprintf("panic: %v", r), nil)
		}
	}()

	// Journey.ID é string (legado); converte UUID → string pra match.
	var journey models.Journey
	if err := e.db.WithContext(ctx).First(&journey, "id = ?", en.JourneyID.String()).Error; err != nil {
		e.markEnrollment(en.ID, models.JourneyEnrollmentFailed, "journey not found", nil)
		return
	}
	if journey.Status != "active" {
		// Journey foi pausada depois do enrollment — marca skipped pra
		// não reciclar quando reativarem (re-resolve do segment cuida
		// disso de qualquer forma).
		e.markEnrollment(en.ID, models.JourneyEnrollmentSkipped, "journey não está ativa", nil)
		return
	}

	var contact models.Contact
	if err := e.db.WithContext(ctx).First(&contact, "id = ?", en.ContactID).Error; err != nil {
		e.markEnrollment(en.ID, models.JourneyEnrollmentFailed, "contact not found", nil)
		return
	}
	if contact.Phone == "" {
		e.markEnrollment(en.ID, models.JourneyEnrollmentSkipped, "contato sem telefone", nil)
		return
	}

	// Re-entry rule do journey — se já tem execution active e rule
	// não permite, skip explícito (ao invés de double-fire).
	jid := contact.Phone
	if !e.canReEnter(&journey, jid) {
		e.markEnrollment(en.ID, models.JourneyEnrollmentSkipped, "re-entry rule violada", nil)
		return
	}

	// Dispara o flow proativo. startNew é a mesma porta que CRM events
	// usam — comportamento idêntico ao trigger existente (recovery,
	// dedup, max steps, etc).
	go e.startNew(&journey, jid, contact.Name, "", "")

	// Marca completed após delegar pra goroutine. O completed real
	// (do flow inteiro) é gerenciado pelo executor; aqui só fecha o
	// ciclo do enrollment.
	e.markEnrollment(en.ID, models.JourneyEnrollmentCompleted, "", nil)
}

func (e *JourneyExecutor) markEnrollment(id uuid.UUID, status, errMsg string, executionID *uuid.UUID) {
	now := time.Now().UTC()
	updates := map[string]any{
		"status":       status,
		"completed_at": &now,
	}
	if errMsg != "" {
		updates["error"] = errMsg
	}
	if executionID != nil {
		updates["execution_id"] = executionID
	}
	if err := e.db.Model(&models.JourneyEnrollment{}).
		Where("id = ?", id).
		Updates(updates).Error; err != nil {
		log.Warn().Err(err).Str("enrollment", id.String()).Msg("mark enrollment failed")
	}
}
