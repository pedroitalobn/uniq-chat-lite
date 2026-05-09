package handlers

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
)

// EnrollContacts — POST /v1/journeys/:id/enroll
//
// Endpoint manual pra enrolar contatos numa jornada (sem precisar do
// segment-as-trigger). Aceita lista de contact_ids OU phones, com
// scheduled_at opcional pra agendar pro futuro.
//
// Body:
//   {
//     "contact_ids": ["uuid1", "uuid2"],     // OU
//     "phones":      ["5511999...", "..."],  // resolvido pra contact_id
//     "scheduled_at": "2026-05-15T09:00:00Z" // opcional, default = now
//   }
//
// Response: { enrolled, skipped, errors }
func (h *JourneyHandler) EnrollContacts(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "não autenticado"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}

	// Confere que journey existe e pertence ao workspace. Journey.ID
	// é string (legado pré-UUID) mas armazena UUID formatado.
	var journey models.Journey
	if err := h.db.Where("id = ? AND workspace_id = ?", id.String(), wsID).First(&journey).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "jornada não encontrada"})
	}

	var req struct {
		ContactIDs  []string  `json:"contact_ids"`
		Phones      []string  `json:"phones"`
		ScheduledAt time.Time `json:"scheduled_at"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.ScheduledAt.IsZero() {
		req.ScheduledAt = time.Now().UTC()
	}

	// Resolve contact_ids — combina IDs explícitos + phones (lookup
	// por workspace+phone). Phones desconhecidos são ignorados (não
	// criamos contato fantasma — fica explícito no response.skipped).
	idSet := map[uuid.UUID]struct{}{}
	skipped := []string{}

	for _, raw := range req.ContactIDs {
		uid, err := uuid.Parse(strings.TrimSpace(raw))
		if err != nil {
			skipped = append(skipped, raw)
			continue
		}
		idSet[uid] = struct{}{}
	}

	if len(req.Phones) > 0 {
		phones := make([]string, 0, len(req.Phones))
		for _, p := range req.Phones {
			p = strings.TrimSpace(p)
			if p != "" {
				phones = append(phones, p)
			}
		}
		var matches []models.Contact
		h.db.Where("workspace_id = ? AND phone IN ?", wsID, phones).
			Select("id, phone").
			Find(&matches)
		matchedPhones := map[string]bool{}
		for _, m := range matches {
			idSet[m.ID] = struct{}{}
			matchedPhones[m.Phone] = true
		}
		for _, p := range phones {
			if !matchedPhones[p] {
				skipped = append(skipped, p)
			}
		}
	}

	if len(idSet) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":   "nenhum contato resolvido",
			"skipped": skipped,
		})
	}

	source := "manual:" + user.ID.String()
	enrolled := 0
	dups := 0
	for cid := range idSet {
		row := models.JourneyEnrollment{
			ID:          uuid.New(),
			WorkspaceID: wsID,
			JourneyID:   id, // já parseado pra uuid.UUID acima
			ContactID:   cid,
			Source:      source,
			Status:      models.JourneyEnrollmentPending,
			ScheduledAt: req.ScheduledAt.UTC(),
		}
		if err := h.db.Create(&row).Error; err != nil {
			// Idx único viola = já existe enrollment desse contato pelo
			// mesmo source. Conta como duplicata, não como erro.
			dups++
			continue
		}
		enrolled++
	}

	return c.JSON(fiber.Map{
		"enrolled":   enrolled,
		"duplicates": dups,
		"skipped":    skipped,
		"scheduled_at": req.ScheduledAt.UTC().Format(time.RFC3339),
	})
}

// ListEnrollments — GET /v1/journeys/:id/enrollments
// Pagina os enrollments do journey ordenados por scheduled_at desc.
// Suporta filtro por status (?status=pending|started|completed|...).
func (h *JourneyHandler) ListEnrollments(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}

	q := h.db.Model(&models.JourneyEnrollment{}).
		Where("journey_id = ? AND workspace_id = ?", id, wsID)

	if s := c.Query("status"); s != "" {
		q = q.Where("status = ?", s)
	}

	var total int64
	q.Count(&total)

	var items []models.JourneyEnrollment
	if err := q.Order("scheduled_at DESC").
		Limit(100).
		Find(&items).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	return c.JSON(fiber.Map{
		"items": items,
		"total": total,
	})
}
