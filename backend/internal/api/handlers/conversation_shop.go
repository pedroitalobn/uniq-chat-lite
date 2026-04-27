package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
)

// ShopContext GET /v1/conversations/:id/shop-context
// Retorna o contexto comercial do contato dessa conversa:
//   - last_orders: até 10 pedidos mais recentes
//   - totals: total comprado, ticket médio, qtde pedidos, último pedido
//   - lifetime_value: alias de totals.spent (compatibilidade com analytics)
//
// Usado pelo painel lateral do inbox + tools de IA pra contexto rico.
func (h *ConversationHandler) ShopContext(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var conv models.Conversation
	if err := h.db.Where("workspace_id = ? AND id = ?", ws, id).First(&conv).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "atendimento não encontrado"})
	}
	if conv.ContactID == nil {
		return c.JSON(fiber.Map{
			"last_orders":    []any{},
			"totals":         orderTotals{},
			"lifetime_value": 0,
		})
	}

	var orders []models.Order
	h.db.Where("workspace_id = ? AND contact_id = ?", ws, *conv.ContactID).
		Order("created_at DESC").Limit(10).Find(&orders)

	var totals orderTotals
	h.db.Model(&models.Order{}).
		Where("workspace_id = ? AND contact_id = ?", ws, *conv.ContactID).
		Select("COALESCE(SUM(total),0) as spent, COUNT(*) as count, COALESCE(AVG(total),0) as avg_ticket, MAX(created_at) as last_order_at").
		Scan(&totals)

	return c.JSON(fiber.Map{
		"contact_id":     conv.ContactID,
		"last_orders":    orders,
		"totals":         totals,
		"lifetime_value": totals.Spent,
	})
}

type orderTotals struct {
	Spent       float64 `json:"spent"`
	Count       int     `json:"count"`
	AvgTicket   float64 `json:"avg_ticket"`
	LastOrderAt *string `json:"last_order_at,omitempty"`
}

// ContactOrders GET /v1/contacts/:id/orders
// Listagem direta dos pedidos de um contato (paginada).
func (h *ConversationHandler) ContactOrders(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	contactID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	limit := c.QueryInt("limit", 20)
	if limit > 100 {
		limit = 100
	}
	offset := c.QueryInt("offset", 0)

	var orders []models.Order
	h.db.Where("workspace_id = ? AND contact_id = ?", ws, contactID).
		Order("created_at DESC").Limit(limit).Offset(offset).Find(&orders)

	var total int64
	h.db.Model(&models.Order{}).Where("workspace_id = ? AND contact_id = ?", ws, contactID).Count(&total)

	return c.JSON(fiber.Map{
		"data":   orders,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}
