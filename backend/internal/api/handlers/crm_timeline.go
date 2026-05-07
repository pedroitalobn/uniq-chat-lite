package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// CrmTimelineHandler — feed unificado de eventos do CRM combinando
// ContactActivity + DealActivity numa única lista ordenada por
// created_at DESC. Filtros opcionais: contact_id, deal_id, company_id.
//
// Útil pra exibir uma linha do tempo cross-entity onde o user vê
// "ontem: tag adicionada no Contact, deal criado, stage mudou,
// reunião agendada" sem precisar pular entre páginas.
//
// Endpoint público: GET /v1/crm/timeline?contact_id=X&deal_id=Y&limit=50
type CrmTimelineHandler struct{ db *gorm.DB }

func NewCrmTimelineHandler(db *gorm.DB) *CrmTimelineHandler {
	return &CrmTimelineHandler{db: db}
}

// TimelineEntry — shape unificado: source identifica origem
// ("contact" | "deal"), entity_id é o ID da entidade, type é o
// tipo do evento (varia por source), payload contém os dados.
type TimelineEntry struct {
	ID         string         `json:"id"`
	Source     string         `json:"source"`     // "contact" | "deal"
	EntityID   string         `json:"entity_id"`  // contact.id ou deal.id
	Type       string         `json:"type"`
	Title      string         `json:"title,omitempty"`
	Body       string         `json:"body,omitempty"`
	Metadata   string         `json:"metadata,omitempty"`
	ActorID    *string        `json:"actor_id,omitempty"`
	WorkspaceID *string       `json:"workspace_id,omitempty"`
	CreatedAt  string         `json:"created_at"`
}

// GET /v1/crm/timeline
//   ?contact_id=...   filtro por contato
//   ?deal_id=...      filtro por deal
//   ?company_id=...   filtro por company (puxa deals da company)
//   ?limit=50         default 50, max 200
//   ?offset=0
//
// Sem nenhum filtro = retorna 50 eventos mais recentes do workspace.
func (h *CrmTimelineHandler) List(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	if wsID == uuid.Nil {
		raw := strings.TrimSpace(c.Get("X-Workspace-ID"))
		parsed, err := uuid.Parse(raw)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "X-Workspace-ID é obrigatório"})
		}
		wsID = parsed
	}

	limit := c.QueryInt("limit", 50)
	if limit > 200 {
		limit = 200
	}
	offset := c.QueryInt("offset", 0)

	contactID := c.Query("contact_id")
	dealID := c.Query("deal_id")
	companyID := c.Query("company_id")

	// Coleta deal IDs implícitos do filtro company_id pra incluir
	// activities desses deals automaticamente.
	var dealIDs []string
	if companyID != "" {
		h.db.Model(&models.Deal{}).
			Where("workspace_id = ? AND company_id = ?", wsID, companyID).
			Pluck("id::text", &dealIDs)
	}

	// SQL com UNION ALL — ContactActivity + DealActivity, normalizando
	// colunas. ORDER BY no envelope final pra mesclar cronologicamente.
	args := []any{wsID}
	contactClause := "ca.workspace_id = ?"
	if contactID != "" {
		contactClause += " AND ca.contact_id = ?"
		args = append(args, contactID)
	}

	dealArgs := []any{wsID}
	dealClause := "da.workspace_id = ?"
	if dealID != "" {
		dealClause += " AND da.deal_id = ?"
		dealArgs = append(dealArgs, dealID)
	} else if companyID != "" && len(dealIDs) > 0 {
		dealClause += " AND da.deal_id::text = ANY(?)"
		dealArgs = append(dealArgs, "{" + strings.Join(dealIDs, ",") + "}")
	} else if companyID != "" {
		// company sem deals → nenhum deal activity
		dealClause += " AND 1=0"
	}

	sql := `
		SELECT id, 'contact' AS source, contact_id::text AS entity_id, type,
			'' AS title, COALESCE(description,'') AS body, COALESCE(metadata,'') AS metadata,
			user_id::text AS actor_id, workspace_id::text AS workspace_id,
			created_at
		FROM contact_activities ca
		WHERE ` + contactClause + `
		UNION ALL
		SELECT id, 'deal' AS source, deal_id::text AS entity_id, type,
			COALESCE(title,'') AS title, COALESCE(body,'') AS body, COALESCE(payload,'') AS metadata,
			actor_user_id::text AS actor_id, workspace_id::text AS workspace_id,
			created_at
		FROM deal_activities da
		WHERE ` + dealClause + `
		ORDER BY created_at DESC
		LIMIT ? OFFSET ?
	`
	allArgs := append(args, dealArgs...)
	allArgs = append(allArgs, limit, offset)

	type row struct {
		ID          uuid.UUID
		Source      string
		EntityID    string
		Type        string
		Title       string
		Body        string
		Metadata    string
		ActorID     *string
		WorkspaceID *string
		CreatedAt   string
	}
	var rows []row
	if err := h.db.Raw(sql, allArgs...).Scan(&rows).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	items := make([]TimelineEntry, len(rows))
	for i, r := range rows {
		items[i] = TimelineEntry{
			ID:          r.ID.String(),
			Source:      r.Source,
			EntityID:    r.EntityID,
			Type:        r.Type,
			Title:       r.Title,
			Body:        r.Body,
			Metadata:    r.Metadata,
			ActorID:     r.ActorID,
			WorkspaceID: r.WorkspaceID,
			CreatedAt:   r.CreatedAt,
		}
	}
	return c.JSON(fiber.Map{"items": items, "limit": limit, "offset": offset})
}
