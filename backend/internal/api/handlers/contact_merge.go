package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// ContactMerge — Identity Resolution. Funde contatos duplicados
// (mesmo número WhatsApp + IG + email) em um único record.
//
// Estratégia:
//   - Survivor recebe TUDO; loosers viram aliases (ContactAlias) e
//     aparecem na timeline do survivor mas não como contatos próprios.
//   - Conversations, deals, messages, tags são re-apontados via UPDATE.
//   - Loosers são deletados após migração.
//
// POST /v1/contacts/merge { survivor_id, looser_ids: [uuid...] }
func (h *ConversationHandler) MergeContacts(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	var req struct {
		SurvivorID string   `json:"survivor_id"`
		LooserIDs  []string `json:"looser_ids"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}
	survivor, err := uuid.Parse(req.SurvivorID)
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "survivor_id inválido"})
	}
	if len(req.LooserIDs) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "looser_ids vazio"})
	}
	loosers := make([]uuid.UUID, 0, len(req.LooserIDs))
	for _, s := range req.LooserIDs {
		if id, err := uuid.Parse(s); err == nil && id != survivor {
			loosers = append(loosers, id)
		}
	}
	if len(loosers) == 0 {
		return c.Status(400).JSON(fiber.Map{"error": "nenhum looser válido"})
	}

	merged := map[string]int64{}
	err = h.db.Transaction(func(tx *gorm.DB) error {
		// 1. Cria aliases pra cada looser.
		var loosersData []models.Contact
		if err := tx.Where("id IN ? AND (workspace_id = ? OR workspace_id IS NULL)", loosers, wsID).Find(&loosersData).Error; err != nil {
			return err
		}
		for _, l := range loosersData {
			if l.Phone != "" {
				tx.Create(&models.ContactAlias{
					WorkspaceID: wsID, ContactID: survivor,
					Kind: "phone", Value: l.Phone,
				})
			}
			if l.Email != "" {
				tx.Create(&models.ContactAlias{
					WorkspaceID: wsID, ContactID: survivor,
					Kind: "email", Value: l.Email,
				})
			}
		}
		// 2. Re-aponta relacionamentos (UPDATE em vez de DELETE+CREATE).
		tables := []struct {
			table  string
			column string
		}{
			{"conversations", "contact_id"},
			{"orders", "contact_id"},
			{"deals", "contact_id"},
			{"contact_tags", "contact_id"},
			{"contact_subscriptions", "contact_id"},
			{"segment_members", "contact_id"},
		}
		for _, t := range tables {
			res := tx.Exec(`UPDATE "`+t.table+`" SET "`+t.column+`" = ? WHERE "`+t.column+`" = ANY(?)`,
				survivor, loosers)
			merged[t.table] = res.RowsAffected
		}
		// 3. Deleta loosers.
		res := tx.Where("id = ANY(?)", loosers).Delete(&models.Contact{})
		merged["contacts_deleted"] = res.RowsAffected
		return nil
	})
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	// Atualiza counters do survivor.
	h.db.Exec(`
UPDATE contacts SET
  deals_open  = COALESCE((SELECT COUNT(*) FROM deals WHERE contact_id = ? AND status = 'open'), 0),
  deals_won   = COALESCE((SELECT COUNT(*) FROM deals WHERE contact_id = ? AND status = 'won'), 0)
WHERE id = ?`, survivor, survivor, survivor)

	return c.JSON(fiber.Map{
		"survivor_id": survivor,
		"merged_into": loosers,
		"affected":    merged,
	})
}

// FindDuplicates GET /v1/contacts/duplicates?by=phone|email
// Lista grupos de duplicatas (mesma chave) pra UI sugerir merge.
func (h *ConversationHandler) FindDuplicates(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	by := c.Query("by", "phone")
	col := "phone"
	if by == "email" {
		col = "email"
	}
	type group struct {
		Key   string `json:"key"`
		Count int    `json:"count"`
		IDs   string `json:"ids"`
	}
	var rows []group
	q := `
SELECT ` + col + ` AS key, COUNT(*)::int as count, string_agg(id::text, ',') as ids
FROM contacts
WHERE (workspace_id = ? OR workspace_id IS NULL)
  AND ` + col + ` IS NOT NULL AND ` + col + ` != ''
GROUP BY ` + col + `
HAVING COUNT(*) > 1
ORDER BY COUNT(*) DESC LIMIT 100
`
	h.db.Raw(q, wsID).Scan(&rows)
	return c.JSON(fiber.Map{"by": by, "groups": rows})
}
