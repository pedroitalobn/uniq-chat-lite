package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
)

// GetAnalytics — GET /v1/journeys/:id/analytics
//
// Devolve as métricas agregadas pra o dashboard de analytics:
//
//   • funnel        — array de steps com entered/completed/errored
//                     ordenado por flow start. Frontend desenha barras
//                     decrescentes pra visualizar drop-off.
//   • totals        — total enrollments / executions / completed /
//                     active / failed
//   • holdout       — { control_count, treatment_count, control_completed,
//                       treatment_completed, lift_pct }
//                     lift = (treatment_rate - control_rate) /
//                            control_rate × 100
//                     se control_rate==0 → lift=null (impossível medir)
//
// Cálculos rodam em SQL agregado pra performance — sem N+1 nem
// scan in-memory.
func (h *JourneyHandler) GetAnalytics(c *fiber.Ctx) error {
	id := c.Params("id")
	if id == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id ausente"})
	}
	wsID := middleware.GetWorkspaceID(c)

	// Confere ownership do journey antes de devolver dados.
	var journey models.Journey
	q := h.db.Where("id = ?", id)
	if wsID.String() != "00000000-0000-0000-0000-000000000000" {
		q = q.Where("workspace_id = ?", wsID)
	}
	if err := q.First(&journey).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "jornada não encontrada"})
	}

	// Funnel — agregação por step. Ordenamos pela ordem do flow se
	// possível (parsing do Journey.Flow), senão por entered desc.
	var funnel []models.JourneyStepMetric
	h.db.Where("journey_id = ?", id).
		Order("entered DESC, step_id ASC").
		Limit(100).
		Find(&funnel)

	// Re-ordena pelo flow real pra mostrar drop-off na sequência
	// natural (não em ordem de hit count).
	if flow := journey.GetFlow(); flow != nil && len(flow.Steps) > 0 {
		order := map[string]int{}
		for i, s := range flow.Steps {
			order[s.ID] = i
		}
		// stable sort
		for i := 1; i < len(funnel); i++ {
			j := i
			for j > 0 {
				ai := order[funnel[j-1].StepID]
				aj := order[funnel[j].StepID]
				// Steps sem ordem conhecida ficam no fim.
				if _, ok := order[funnel[j-1].StepID]; !ok {
					ai = 1 << 30
				}
				if _, ok := order[funnel[j].StepID]; !ok {
					aj = 1 << 30
				}
				if ai > aj {
					funnel[j-1], funnel[j] = funnel[j], funnel[j-1]
					j--
				} else {
					break
				}
			}
		}
	}

	// Totals — conta status diretamente da journey_executions.
	type totalsRow struct {
		Status string
		Count  int64
	}
	var rawTotals []totalsRow
	h.db.Table("journey_executions").
		Select("status, COUNT(*) as count").
		Where("journey_id = ?", id).
		Group("status").
		Scan(&rawTotals)

	totals := map[string]int64{
		"all":            0,
		"active":         0,
		"completed":      0,
		"failed":         0,
		"waiting":        0,
		"waiting_input":  0,
	}
	for _, r := range rawTotals {
		totals["all"] += r.Count
		totals[r.Status] = r.Count
	}

	// Holdout breakdown — só relevante se HoldoutPercent > 0 OU se
	// existe alguma execution is_holdout=true (cobre histórico).
	type holdoutRow struct {
		IsHoldout bool
		Status    string
		Count     int64
	}
	var holdoutRows []holdoutRow
	h.db.Table("journey_executions").
		Select("is_holdout, status, COUNT(*) as count").
		Where("journey_id = ?", id).
		Group("is_holdout, status").
		Scan(&holdoutRows)

	var controlAll, controlCompleted, treatmentAll, treatmentCompleted int64
	for _, r := range holdoutRows {
		if r.IsHoldout {
			controlAll += r.Count
			if r.Status == "completed" {
				controlCompleted += r.Count
			}
		} else {
			treatmentAll += r.Count
			if r.Status == "completed" {
				treatmentCompleted += r.Count
			}
		}
	}
	holdout := fiber.Map{
		"control_count":        controlAll,
		"treatment_count":      treatmentAll,
		"control_completed":    controlCompleted,
		"treatment_completed":  treatmentCompleted,
		"holdout_percent":      journey.HoldoutPercent,
	}
	// Lift = (taxa_tratamento − taxa_controle) ÷ taxa_controle × 100.
	// Só calcula se temos amostra mínima e taxa_controle > 0 (senão
	// devolve null pro front mostrar "amostra insuficiente").
	if controlAll > 10 && treatmentAll > 10 && controlCompleted > 0 {
		treatmentRate := float64(treatmentCompleted) / float64(treatmentAll)
		controlRate := float64(controlCompleted) / float64(controlAll)
		lift := (treatmentRate - controlRate) / controlRate * 100
		holdout["lift_pct"] = lift
	}

	// Goal — quando journey tem GoalEvent, conta executions que
	// atingiram (Journey.GoalCount já é incrementado externamente).
	if journey.GoalEvent != "" {
		holdout["goal_event"] = journey.GoalEvent
		holdout["goal_count"] = journey.GoalCount
	}

	return c.JSON(fiber.Map{
		"journey_id":  journey.ID,
		"name":        journey.Name,
		"funnel":      funnel,
		"totals":      totals,
		"holdout":     holdout,
	})
}
