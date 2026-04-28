package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// SegmentHandler — CRUD de segmentos + preview de membros (count) +
// upload manual via CSV.
//
// Filter JSON usa o mesmo shape do segment_filter de campanhas — a
// resolveSegmentedContacts logic vem em iteração.
type SegmentHandler struct {
	db *gorm.DB
}

func NewSegmentHandler(db *gorm.DB) *SegmentHandler {
	return &SegmentHandler{db: db}
}

func (h *SegmentHandler) List(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	var segs []models.Segment
	h.db.Where("workspace_id = ?", wsID).Order("created_at DESC").Find(&segs)
	return c.JSON(fiber.Map{"data": segs})
}

func (h *SegmentHandler) Create(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(401).JSON(fiber.Map{"error": "auth required"})
	}
	var req models.Segment
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name obrigatório"})
	}
	req.ID = uuid.Nil
	req.WorkspaceID = wsID
	req.OwnerUserID = user.ID
	if req.Type == "" {
		req.Type = "dynamic"
	}
	if req.Filter == "" {
		req.Filter = "{}"
	}
	if err := h.db.Create(&req).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(201).JSON(req)
}

func (h *SegmentHandler) Update(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	var seg models.Segment
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&seg).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "segmento não encontrado"})
	}
	var patch map[string]any
	c.BodyParser(&patch)
	allowed := map[string]bool{
		"name": true, "description": true, "filter": true,
		"is_active": true, "trigger_journey_id": true,
	}
	updates := map[string]any{}
	for k, v := range patch {
		if allowed[k] {
			updates[k] = v
		}
	}
	h.db.Model(&seg).Updates(updates)
	h.db.First(&seg, "id = ?", seg.ID)
	return c.JSON(seg)
}

func (h *SegmentHandler) Delete(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	h.db.Where("workspace_id = ? AND id = ?", wsID, id).Delete(&models.Segment{})
	h.db.Where("segment_id = ?", id).Delete(&models.SegmentMember{})
	return c.JSON(fiber.Map{"ok": true})
}

// Preview POST /v1/segments/preview { filter: {...} }
// Conta quantos contatos batem com o filter sem persistir.
func (h *SegmentHandler) Preview(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	var req struct {
		Filter map[string]any `json:"filter"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido"})
	}
	q := buildSegmentQuery(h.db, wsID, req.Filter)
	var total int64
	q.Count(&total)
	type row struct {
		ID    string `json:"id"`
		Name  string `json:"name"`
		Phone string `json:"phone"`
	}
	var sample []row
	q.Select("id, name, phone").Order("created_at DESC").Limit(5).Scan(&sample)
	return c.JSON(fiber.Map{"total": total, "sample": sample})
}

// Overlap POST /v1/segments/overlap { ids: [uuid1, uuid2] }
// Retorna interseção entre dois segments (Venn-style).
func (h *SegmentHandler) Overlap(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.IDs) < 2 {
		return c.Status(400).JSON(fiber.Map{"error": "informe 2+ ids"})
	}
	out := fiber.Map{"segments": []fiber.Map{}}
	type cnt struct {
		SegmentID string
		Count     int64
	}
	all := make([]cnt, 0, len(req.IDs))
	for _, idStr := range req.IDs {
		id, err := uuid.Parse(idStr)
		if err != nil {
			continue
		}
		var seg models.Segment
		if h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&seg).Error != nil {
			continue
		}
		var filter map[string]any
		_ = jsonDecode(seg.Filter, &filter)
		var n int64
		buildSegmentQuery(h.db, wsID, filter).Count(&n)
		all = append(all, cnt{SegmentID: idStr, Count: n})
		out["segments"] = append(out["segments"].([]fiber.Map), fiber.Map{
			"id": seg.ID, "name": seg.Name, "count": n,
		})
	}
	// Interseção: contatos que satisfazem TODOS os filters simultaneamente.
	// Para simplicidade do MVP, retorna apenas o filtro do primeiro AND-encadeado.
	// Implementação completa é AND lógico de queries — pendente.
	return c.JSON(out)
}

// CSVImport POST /v1/segments/:id/import-csv (multipart "file")
// Adiciona contatos ao segment (type=manual) lendo CSV com coluna "phone"
// ou "email". Cria contatos novos quando não existem.
func (h *SegmentHandler) CSVImport(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	user := middleware.GetCurrentUser(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	var seg models.Segment
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&seg).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "segmento não encontrado"})
	}
	if seg.Type != "manual" {
		return c.Status(400).JSON(fiber.Map{"error": "import só pra segmento type=manual"})
	}

	fh, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "arquivo CSV obrigatório (campo 'file')"})
	}
	imported, err := importCSVtoSegment(h.db, wsID, user.ID, seg.ID, fh)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"imported": imported})
}

// ─── helpers ──────────────────────────────────────────────────────────

// buildSegmentQuery constrói gorm.DB query a partir do filter JSON.
// Subset do segment_filter de campaigns.
func buildSegmentQuery(db *gorm.DB, wsID uuid.UUID, filter map[string]any) *gorm.DB {
	q := db.Model(&models.Contact{}).Where("workspace_id = ? OR user_id IN (SELECT user_id FROM user_workspaces WHERE workspace_id = ?)", wsID, wsID)
	if v, ok := filter["funnel"].(string); ok && v != "" {
		q = q.Where("funnel = ?", v)
	}
	if v, ok := filter["stage"].(string); ok && v != "" {
		q = q.Where("stage = ?", v)
	}
	if v, ok := filter["journey"].(string); ok && v != "" {
		q = q.Where("journey = ?", v)
	}
	if v, ok := filter["owner"].(string); ok && v != "" {
		q = q.Where("owner_id = ?", v)
	}
	if v, ok := filter["external_id"].(string); ok && v != "" {
		q = q.Where("external_id = ?", v)
	}
	if v, ok := filter["tags"].([]any); ok && len(v) > 0 {
		names := make([]string, 0, len(v))
		for _, t := range v {
			if s, ok := t.(string); ok {
				names = append(names, s)
			}
		}
		if len(names) > 0 {
			q = q.Joins("INNER JOIN contact_tags ct ON ct.contact_id = contacts.id").
				Joins("INNER JOIN tags t ON t.id = ct.tag_id").
				Where("t.name IN ?", names).Distinct()
		}
	}
	// Computed attribute filters
	if v, ok := filter["min_ltv"].(float64); ok {
		q = q.Joins("LEFT JOIN contact_computed cc ON cc.contact_id = contacts.id").
			Where("cc.lifetime_value >= ?", v)
	}
	if v, ok := filter["min_orders"].(float64); ok {
		q = q.Joins("LEFT JOIN contact_computed cc ON cc.contact_id = contacts.id").
			Where("cc.orders_total >= ?", int(v))
	}
	if v, ok := filter["never_purchased"].(bool); ok && v {
		q = q.Joins("LEFT JOIN contact_computed cc ON cc.contact_id = contacts.id").
			Where("COALESCE(cc.orders_total, 0) = 0")
	}
	return q
}

// jsonDecode helper
func jsonDecode(raw string, dst any) error {
	if raw == "" || raw == "null" {
		return nil
	}
	return jsonUnmarshal([]byte(raw), dst)
}
