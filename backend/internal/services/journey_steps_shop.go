package services

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
)

// stepProductSearch — busca produtos do Shop no workspace e salva o resultado
// numa variável da execução. Não envia mensagem.
//
// Config:
//   { "query": "tênis", "category": "<id>", "limit": 5,
//     "save_to_var": "products" }
//
// O array salvo é JSON-marshalable: [{id, name, price, sku, image, in_stock}].
// Use depois com {{products}} num product_carousel ou ai_response.
func (e *JourneyExecutor) stepProductSearch(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Query      string `json:"query"`
		CategoryID string `json:"category"`
		ShopID     string `json:"shop_id"`
		Limit      int    `json:"limit"`
		SaveToVar  string `json:"save_to_var"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	if cfg.Limit <= 0 || cfg.Limit > 50 {
		cfg.Limit = 5
	}
	if cfg.SaveToVar == "" {
		cfg.SaveToVar = "products"
	}

	wsID, err := e.workspaceFromCtx(ctx)
	if err != nil {
		return nil, false, err
	}

	q := e.db.Model(&models.Product{}).
		Where("workspace_id = ? AND is_active = TRUE", wsID)
	if cfg.ShopID != "" {
		if sid, err := uuid.Parse(cfg.ShopID); err == nil {
			q = q.Where("shop_id = ?", sid)
		}
	}
	if cfg.CategoryID != "" {
		if cid, err := uuid.Parse(cfg.CategoryID); err == nil {
			q = q.Where("category_id = ?", cid)
		}
	}
	if query := e.interpolate(cfg.Query, ctx.vars); query != "" {
		like := "%" + strings.ToLower(query) + "%"
		q = q.Where("LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(sku) LIKE ?", like, like, like)
	}

	var rows []models.Product
	if err := q.Order("stock_quantity DESC, name ASC").Limit(cfg.Limit).Find(&rows).Error; err != nil {
		return nil, false, err
	}

	out := make([]map[string]any, 0, len(rows))
	for _, p := range rows {
		out = append(out, map[string]any{
			"id":       p.ID.String(),
			"name":     p.Name,
			"price":    p.Price,
			"currency": p.Currency,
			"sku":      p.SKU,
			"image":    p.MainImage,
			"in_stock": p.StockQuantity > 0 || !p.TrackStock,
			"stock":    p.StockQuantity,
		})
	}
	ctx.vars.Flow[cfg.SaveToVar] = out
	ctx.vars.Flow[cfg.SaveToVar+"_count"] = len(out)

	ctx.emit(step.ID, string(step.Type), "product_search",
		map[string]any{"query": cfg.Query, "count": len(out), "var": cfg.SaveToVar})
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

// stepProductCarousel — envia uma WhatsApp List Message com produtos.
// Usa por padrão a variável "products" (output do product_search).
//
// Config:
//   { "header": "Produtos pra você",
//     "message": "Confira:",
//     "button_text": "Ver opções",
//     "products_var": "products",
//     "mode": "private" }
func (e *JourneyExecutor) stepProductCarousel(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Header      string `json:"header"`
		Message     string `json:"message"`
		ButtonText  string `json:"button_text"`
		ProductsVar string `json:"products_var"`
		Mode        string `json:"mode"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	if cfg.ProductsVar == "" {
		cfg.ProductsVar = "products"
	}
	raw, ok := ctx.vars.Flow[cfg.ProductsVar]
	if !ok {
		ctx.emit(step.ID, string(step.Type), "skip_no_products", map[string]any{"var": cfg.ProductsVar})
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}
	products, _ := raw.([]map[string]any)
	if len(products) == 0 {
		// Pode ter sido salvo como []any em vez de []map; tenta normalizar.
		if anyArr, ok := raw.([]any); ok {
			for _, item := range anyArr {
				if m, ok := item.(map[string]any); ok {
					products = append(products, m)
				}
			}
		}
	}
	if len(products) == 0 {
		ctx.emit(step.ID, string(step.Type), "skip_empty", nil)
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}

	rows := make([]ListRow, 0, len(products))
	for _, p := range products {
		title, _ := p["name"].(string)
		id, _ := p["id"].(string)
		desc := ""
		if price, ok := p["price"].(float64); ok && price > 0 {
			cur, _ := p["currency"].(string)
			if cur == "" {
				cur = "BRL"
			}
			desc = fmt.Sprintf("%.2f %s", price, cur)
		}
		if sku, ok := p["sku"].(string); ok && sku != "" {
			if desc != "" {
				desc += " · "
			}
			desc += "SKU " + sku
		}
		rows = append(rows, ListRow{
			ID:          "product:" + id,
			Title:       firstN(title, 24),
			Description: firstN(desc, 72),
		})
	}
	header := e.interpolate(cfg.Header, ctx.vars)
	if header == "" {
		header = "Produtos"
	}
	sections := []ListSection{{Title: header, Rows: rows}}

	text := e.interpolate(cfg.Message, ctx.vars)
	if text == "" {
		text = "Selecione um produto:"
	}
	btn := cfg.ButtonText
	if btn == "" {
		btn = "Ver produtos"
	}
	jid := e.resolveRecipient(ctx, cfg.Mode)

	ctx.emit(step.ID, string(step.Type), "send_product_list",
		map[string]any{"to": jid, "count": len(rows)})
	if !ctx.simulate {
		if err := e.sender.SendList(ctx.instanceID, jid, text, btn, sections); err != nil {
			return nil, false, err
		}
		ctx.execution.AddMessage("outbound", text, step.ID)
	}
	return nil, true, nil
}

// workspaceFromCtx resolve o WorkspaceID via Instance (Journey não tem
// WorkspaceID direto — vem por instance).
func (e *JourneyExecutor) workspaceFromCtx(ctx *execCtx) (uuid.UUID, error) {
	if ctx.journey == nil || ctx.journey.InstanceID == "" {
		return uuid.Nil, fmt.Errorf("journey sem instance")
	}
	var inst struct {
		WorkspaceID *uuid.UUID
	}
	if err := e.db.Table("instances").Select("workspace_id").
		Where("id = ?", ctx.journey.InstanceID).Scan(&inst).Error; err != nil {
		return uuid.Nil, err
	}
	if inst.WorkspaceID == nil {
		return uuid.Nil, fmt.Errorf("instance sem workspace")
	}
	return *inst.WorkspaceID, nil
}
