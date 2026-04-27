package handlers

import (
	"strings"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
)

// resolveUserWorkspace pega a primeira workspace que o usuário pertence.
// Tools são user-scoped; produtos são workspace-scoped — usamos a workspace
// owner se houver, senão a primeira disponível.
func (h *ToolsHandler) resolveUserWorkspace(userID uuid.UUID) (uuid.UUID, error) {
	var uw models.UserWorkspace
	err := h.db.Where("user_id = ?", userID).
		Order("is_owner DESC, joined_at ASC").First(&uw).Error
	if err != nil {
		return uuid.Nil, err
	}
	return uw.WorkspaceID, nil
}

func (h *ToolsHandler) toolListProducts(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}
	limit := 10
	if v, ok := args["limit"].(float64); ok && v > 0 && v <= 50 {
		limit = int(v)
	}
	q := h.db.Model(&models.Product{}).
		Where("workspace_id = ? AND is_active = TRUE", wsID)
	if shopID, ok := args["shop_id"].(string); ok && shopID != "" {
		if sid, err := uuid.Parse(shopID); err == nil {
			q = q.Where("shop_id = ?", sid)
		}
	}
	var rows []models.Product
	q.Order("name ASC").Limit(limit).Find(&rows)
	return formatProducts(rows)
}

func (h *ToolsHandler) toolSearchProducts(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}
	query, _ := args["query"].(string)
	if query == "" {
		return map[string]any{"error": "query obrigatória"}
	}
	limit := 5
	if v, ok := args["limit"].(float64); ok && v > 0 && v <= 50 {
		limit = int(v)
	}
	q := h.db.Model(&models.Product{}).
		Where("workspace_id = ? AND is_active = TRUE", wsID)
	if shopID, ok := args["shop_id"].(string); ok && shopID != "" {
		if sid, err := uuid.Parse(shopID); err == nil {
			q = q.Where("shop_id = ?", sid)
		}
	}
	if minP, ok := args["min_price"].(float64); ok {
		q = q.Where("price >= ?", minP)
	}
	if maxP, ok := args["max_price"].(float64); ok {
		q = q.Where("price <= ?", maxP)
	}
	like := "%" + strings.ToLower(query) + "%"
	q = q.Where("LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(sku) LIKE ?",
		like, like, like)

	var rows []models.Product
	q.Order("stock_quantity DESC, name ASC").Limit(limit).Find(&rows)
	return map[string]any{
		"query":   query,
		"count":   len(rows),
		"results": formatProducts(rows),
	}
}

func (h *ToolsHandler) toolGetProductDetails(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}
	pidStr, _ := args["product_id"].(string)
	pid, err := uuid.Parse(pidStr)
	if err != nil {
		return map[string]any{"error": "product_id inválido"}
	}
	var p models.Product
	if err := h.db.Where("id = ? AND workspace_id = ?", pid, wsID).First(&p).Error; err != nil {
		return map[string]any{"error": "produto não encontrado"}
	}
	var images []models.ProductImage
	h.db.Where("product_id = ?", pid).Order("position ASC").Find(&images)
	imgURLs := make([]string, 0, len(images))
	for _, img := range images {
		imgURLs = append(imgURLs, img.URL)
	}
	return map[string]any{
		"id":               p.ID.String(),
		"name":             p.Name,
		"description":      p.Description,
		"sku":              p.SKU,
		"price":            p.Price,
		"compare_at_price": p.CompareAtPrice,
		"currency":         p.Currency,
		"stock":            p.StockQuantity,
		"track_stock":      p.TrackStock,
		"in_stock":         p.StockQuantity > 0 || !p.TrackStock,
		"is_active":        p.IsActive,
		"main_image":       p.MainImage,
		"images":           imgURLs,
		"shop_id":          p.ShopID.String(),
	}
}

func formatProducts(rows []models.Product) []map[string]any {
	out := make([]map[string]any, 0, len(rows))
	for _, p := range rows {
		out = append(out, map[string]any{
			"id":       p.ID.String(),
			"name":     p.Name,
			"price":    p.Price,
			"currency": p.Currency,
			"sku":      p.SKU,
			"stock":    p.StockQuantity,
			"in_stock": p.StockQuantity > 0 || !p.TrackStock,
			"image":    p.MainImage,
		})
	}
	return out
}
