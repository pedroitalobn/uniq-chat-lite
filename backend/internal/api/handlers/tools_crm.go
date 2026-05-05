package handlers

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
)

// ─── CRM: Contacts ────────────────────────────────────────────────────────────

func (h *ToolsHandler) toolListContacts(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	limit := 20
	if v, ok := args["limit"].(float64); ok && v > 0 && v <= 100 {
		limit = int(v)
	}

	q := h.db.Model(&models.Contact{}).Where("workspace_id = ?", wsID)

	if search, ok := args["search"].(string); ok && search != "" {
		like := "%" + strings.ToLower(search) + "%"
		q = q.Where("LOWER(name) LIKE ? OR phone LIKE ? OR LOWER(email) LIKE ?", like, like, like)
	}
	if stage, ok := args["stage"].(string); ok && stage != "" {
		q = q.Where("stage = ?", stage)
	}

	var rows []models.Contact
	q.Order("created_at DESC").Limit(limit).Find(&rows)

	out := make([]map[string]any, 0, len(rows))
	for _, c := range rows {
		out = append(out, map[string]any{
			"id":         c.ID.String(),
			"name":       c.Name,
			"phone":      c.Phone,
			"email":      c.Email,
			"source":     c.Source,
			"stage":      c.Stage,
			"funnel":     c.Funnel,
			"deals_open": c.DealsOpen,
			"deals_won":  c.DealsWon,
			"created_at": c.CreatedAt.Format("2006-01-02 15:04"),
		})
	}

	return map[string]any{
		"count":    len(out),
		"contacts": out,
	}
}

func (h *ToolsHandler) toolGetContact(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	idStr, _ := args["contact_id"].(string)
	cid, err := uuid.Parse(idStr)
	if err != nil {
		return map[string]any{"error": "contact_id inválido"}
	}

	var c models.Contact
	if err := h.db.Where("id = ? AND workspace_id = ?", cid, wsID).First(&c).Error; err != nil {
		return map[string]any{"error": "contato não encontrado"}
	}

	return map[string]any{
		"id":              c.ID.String(),
		"name":            c.Name,
		"phone":           c.Phone,
		"email":           c.Email,
		"source":          c.Source,
		"stage":           c.Stage,
		"funnel":          c.Funnel,
		"notes":           c.Notes,
		"job_title":       c.JobTitle,
		"city":            c.City,
		"state":           c.State,
		"country":         c.Country,
		"deals_open":      c.DealsOpen,
		"deals_won":       c.DealsWon,
		"linkedin_url":    c.LinkedInURL,
		"instagram":       c.InstagramHandle,
		"last_contact_at": c.LastContactAt,
		"created_at":      c.CreatedAt.Format("2006-01-02 15:04"),
	}
}

func (h *ToolsHandler) toolCreateContact(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	name, _ := args["name"].(string)
	phone, _ := args["phone"].(string)
	if name == "" || phone == "" {
		return map[string]any{"error": "name e phone são obrigatórios"}
	}

	c := models.Contact{
		UserID:      userID,
		WorkspaceID: &wsID,
		Name:        name,
		Phone:       phone,
		Source:      models.SourceManual,
	}
	if email, ok := args["email"].(string); ok {
		c.Email = email
	}
	if notes, ok := args["notes"].(string); ok {
		c.Notes = notes
	}
	if stage, ok := args["stage"].(string); ok {
		c.Stage = stage
	}
	if funnel, ok := args["funnel"].(string); ok {
		c.Funnel = funnel
	}

	if err := h.db.Create(&c).Error; err != nil {
		if strings.Contains(err.Error(), "duplicate") || strings.Contains(err.Error(), "UNIQUE") {
			return map[string]any{"error": "contato com esse telefone já existe"}
		}
		return map[string]any{"error": fmt.Sprintf("erro ao criar contato: %v", err)}
	}

	return map[string]any{
		"success":    true,
		"contact_id": c.ID.String(),
		"message":    fmt.Sprintf("Contato '%s' criado com sucesso", c.Name),
	}
}

func (h *ToolsHandler) toolUpdateContact(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	idStr, _ := args["contact_id"].(string)
	cid, err := uuid.Parse(idStr)
	if err != nil {
		return map[string]any{"error": "contact_id inválido"}
	}

	var c models.Contact
	if err := h.db.Where("id = ? AND workspace_id = ?", cid, wsID).First(&c).Error; err != nil {
		return map[string]any{"error": "contato não encontrado"}
	}

	updates := map[string]any{}
	if v, ok := args["name"].(string); ok && v != "" {
		updates["name"] = v
	}
	if v, ok := args["email"].(string); ok {
		updates["email"] = v
	}
	if v, ok := args["notes"].(string); ok {
		updates["notes"] = v
	}
	if v, ok := args["stage"].(string); ok {
		updates["stage"] = v
	}
	if v, ok := args["funnel"].(string); ok {
		updates["funnel"] = v
	}
	if v, ok := args["job_title"].(string); ok {
		updates["job_title"] = v
	}

	if len(updates) == 0 {
		return map[string]any{"error": "nenhum campo para atualizar"}
	}

	if err := h.db.Model(&c).Updates(updates).Error; err != nil {
		return map[string]any{"error": "erro ao atualizar contato"}
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Contato '%s' atualizado", c.Name),
	}
}

// ─── CRM: Companies ───────────────────────────────────────────────────────────

func (h *ToolsHandler) toolListCompanies(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	limit := 20
	if v, ok := args["limit"].(float64); ok && v > 0 && v <= 100 {
		limit = int(v)
	}

	q := h.db.Model(&models.Company{}).Where("workspace_id = ?", wsID)
	if search, ok := args["search"].(string); ok && search != "" {
		like := "%" + strings.ToLower(search) + "%"
		q = q.Where("LOWER(name) LIKE ? OR LOWER(domain) LIKE ?", like, like)
	}

	var rows []models.Company
	q.Order("name ASC").Limit(limit).Find(&rows)

	out := make([]map[string]any, 0, len(rows))
	for _, c := range rows {
		out = append(out, map[string]any{
			"id":            c.ID.String(),
			"name":          c.Name,
			"domain":        c.Domain,
			"industry":      c.Industry,
			"size":          c.Size,
			"contact_count": c.ContactCount,
			"deal_count":    c.DealCount,
			"open_deal_sum": c.OpenDealSum,
		})
	}

	return map[string]any{"count": len(out), "companies": out}
}

func (h *ToolsHandler) toolCreateCompany(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	name, _ := args["name"].(string)
	if name == "" {
		return map[string]any{"error": "name é obrigatório"}
	}

	c := models.Company{
		WorkspaceID: wsID,
		Name:        name,
		OwnerID:     &userID,
	}
	if v, ok := args["domain"].(string); ok {
		c.Domain = v
	}
	if v, ok := args["industry"].(string); ok {
		c.Industry = v
	}
	if v, ok := args["phone"].(string); ok {
		c.Phone = v
	}
	if v, ok := args["email"].(string); ok {
		c.Email = v
	}

	if err := h.db.Create(&c).Error; err != nil {
		return map[string]any{"error": fmt.Sprintf("erro ao criar empresa: %v", err)}
	}

	return map[string]any{
		"success":    true,
		"company_id": c.ID.String(),
		"message":    fmt.Sprintf("Empresa '%s' criada com sucesso", c.Name),
	}
}

// ─── CRM: Deals ───────────────────────────────────────────────────────────────

func (h *ToolsHandler) toolListDeals(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	limit := 20
	if v, ok := args["limit"].(float64); ok && v > 0 && v <= 100 {
		limit = int(v)
	}

	q := h.db.Model(&models.Deal{}).Where("workspace_id = ?", wsID)
	if status, ok := args["status"].(string); ok && status != "" {
		q = q.Where("status = ?", status)
	}
	if funnelID, ok := args["funnel_id"].(string); ok && funnelID != "" {
		if fid, err := uuid.Parse(funnelID); err == nil {
			q = q.Where("funnel_id = ?", fid)
		}
	}

	var rows []models.Deal
	q.Order("created_at DESC").Limit(limit).Find(&rows)

	out := make([]map[string]any, 0, len(rows))
	for _, d := range rows {
		out = append(out, map[string]any{
			"id":         d.ID.String(),
			"title":      d.Title,
			"status":     d.Status,
			"value":      d.Value,
			"currency":   d.Currency,
			"funnel_id":  d.FunnelID.String(),
			"stage_id":   d.StageID.String(),
			"contact_id": d.ContactID.String(),
			"priority":   d.Priority,
			"created_at": d.CreatedAt.Format("2006-01-02 15:04"),
		})
	}

	return map[string]any{"count": len(out), "deals": out}
}

func (h *ToolsHandler) toolCreateDeal(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	title, _ := args["title"].(string)
	contactIDStr, _ := args["contact_id"].(string)
	funnelIDStr, _ := args["funnel_id"].(string)
	stageIDStr, _ := args["stage_id"].(string)

	if title == "" || contactIDStr == "" || funnelIDStr == "" || stageIDStr == "" {
		return map[string]any{"error": "title, contact_id, funnel_id e stage_id são obrigatórios"}
	}

	cid, err := uuid.Parse(contactIDStr)
	if err != nil {
		return map[string]any{"error": "contact_id inválido"}
	}
	fid, err := uuid.Parse(funnelIDStr)
	if err != nil {
		return map[string]any{"error": "funnel_id inválido"}
	}
	sid, err := uuid.Parse(stageIDStr)
	if err != nil {
		return map[string]any{"error": "stage_id inválido"}
	}

	d := models.Deal{
		WorkspaceID: wsID,
		OwnerID:     &userID,
		Title:       title,
		ContactID:   cid,
		FunnelID:    fid,
		StageID:     sid,
		Status:      models.DealStatusOpen,
	}
	if v, ok := args["value"].(float64); ok {
		d.Value = int64(v * 100) // store as cents
	}

	if err := h.db.Create(&d).Error; err != nil {
		return map[string]any{"error": fmt.Sprintf("erro ao criar deal: %v", err)}
	}

	return map[string]any{
		"success": true,
		"deal_id": d.ID.String(),
		"message": fmt.Sprintf("Deal '%s' criado com sucesso", d.Title),
	}
}

func (h *ToolsHandler) toolMoveDealStage(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	dealIDStr, _ := args["deal_id"].(string)
	stageIDStr, _ := args["stage_id"].(string)
	if dealIDStr == "" || stageIDStr == "" {
		return map[string]any{"error": "deal_id e stage_id são obrigatórios"}
	}

	did, err := uuid.Parse(dealIDStr)
	if err != nil {
		return map[string]any{"error": "deal_id inválido"}
	}
	sid, err := uuid.Parse(stageIDStr)
	if err != nil {
		return map[string]any{"error": "stage_id inválido"}
	}

	var d models.Deal
	if err := h.db.Where("id = ? AND workspace_id = ?", did, wsID).First(&d).Error; err != nil {
		return map[string]any{"error": "deal não encontrado"}
	}

	updates := map[string]any{"stage_id": sid}
	if status, ok := args["status"].(string); ok && status != "" {
		updates["status"] = status
	}

	if err := h.db.Model(&d).Updates(updates).Error; err != nil {
		return map[string]any{"error": "erro ao mover deal"}
	}

	return map[string]any{
		"success": true,
		"message": fmt.Sprintf("Deal '%s' movido para stage %s", d.Title, stageIDStr),
	}
}

// ─── CRM: Funnels ─────────────────────────────────────────────────────────────

func (h *ToolsHandler) toolListFunnels(userID uuid.UUID, args map[string]any) any {
	wsID, err := h.resolveUserWorkspace(userID)
	if err != nil {
		return map[string]any{"error": "workspace não encontrada"}
	}

	var funnels []models.Funnel
	h.db.Where("workspace_id = ?", wsID).Preload("Stages").Order("created_at ASC").Find(&funnels)

	out := make([]map[string]any, 0, len(funnels))
	for _, f := range funnels {
		stages := make([]map[string]any, 0, len(f.Stages))
		for _, s := range f.Stages {
			stages = append(stages, map[string]any{
				"id":    s.ID.String(),
				"name":  s.Name,
				"order": s.Order,
				"color": s.Color,
			})
		}
		out = append(out, map[string]any{
			"id":         f.ID.String(),
			"name":       f.Name,
			"type":       f.Type,
			"is_default": f.IsDefault,
			"stages":     stages,
		})
	}

	return map[string]any{"count": len(out), "funnels": out}
}
