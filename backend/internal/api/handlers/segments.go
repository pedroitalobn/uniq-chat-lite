package handlers

import (
	"encoding/json"
	"strings"

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
	// Antes: c.BodyParser(&req) com Segment.Filter sendo string falhava
	// quando o frontend manda "filter" como objeto JSON. O erro do parser
	// caía no `||` do check e devolvia "name obrigatório" mesmo com nome
	// presente — confundia o user. Agora aceita filter como objeto E
	// re-serializa pra string que vai pro DB.
	var raw struct {
		Name   string          `json:"name"`
		Type   string          `json:"type"`
		Filter json.RawMessage `json:"filter"`
	}
	if err := c.BodyParser(&raw); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "body inválido: " + err.Error()})
	}
	if strings.TrimSpace(raw.Name) == "" {
		return c.Status(400).JSON(fiber.Map{"error": "name obrigatório"})
	}
	filterStr := string(raw.Filter)
	if filterStr == "" || filterStr == "null" {
		filterStr = "{}"
	}
	req := models.Segment{
		Name:        raw.Name,
		Type:        raw.Type,
		Filter:      filterStr,
		WorkspaceID: wsID,
		OwnerUserID: user.ID,
	}
	if req.Type == "" {
		req.Type = "dynamic"
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
// Suporta filtros flat (legados) e groups-based AND/OR.
func buildSegmentQuery(db *gorm.DB, wsID uuid.UUID, filter map[string]any) *gorm.DB {
	q := db.Model(&models.Contact{}).Where("contacts.workspace_id = ? OR contacts.user_id IN (SELECT user_id FROM user_workspaces WHERE workspace_id = ?)", wsID, wsID)

	// ── Legado: filtros flat (sem groups) ────────────────────────────
	if _, hasGroups := filter["groups"]; !hasGroups {
		if v, ok := filter["funnel"].(string); ok && v != "" {
			q = q.Where("contacts.funnel = ?", v)
		}
		if v, ok := filter["stage"].(string); ok && v != "" {
			q = q.Where("contacts.stage = ?", v)
		}
		if v, ok := filter["journey"].(string); ok && v != "" {
			q = q.Where("contacts.journey = ?", v)
		}
		if v, ok := filter["owner"].(string); ok && v != "" {
			q = q.Where("contacts.owner_id = ?", v)
		}
		if v, ok := filter["external_id"].(string); ok && v != "" {
			q = q.Where("contacts.external_id = ?", v)
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

	// ── Novo: group-based AND/OR ──────────────────────────────────────
	groupsRaw, _ := filter["groups"].([]any)
	groupsMatch, _ := filter["groups_match"].(string)
	if groupsMatch == "" {
		groupsMatch = "all"
	}

	var groupClauses []string
	var groupArgs []interface{}

	for _, gRaw := range groupsRaw {
		g, ok := gRaw.(map[string]any)
		if !ok {
			continue
		}
		clause, args := buildGroupWhereSQL(wsID, g)
		if clause == "" {
			continue
		}
		groupClauses = append(groupClauses, clause)
		groupArgs = append(groupArgs, args...)
	}

	if len(groupClauses) > 0 {
		sep := " AND "
		if groupsMatch == "any" {
			sep = " OR "
		}
		q = q.Where("("+strings.Join(groupClauses, sep)+")", groupArgs...)
	}

	return q
}

// buildGroupWhereSQL constrói um fragmento SQL para um grupo de condições.
func buildGroupWhereSQL(wsID uuid.UUID, group map[string]any) (string, []interface{}) {
	match, _ := group["match"].(string)
	if match == "" {
		match = "all"
	}
	condsRaw, _ := group["conditions"].([]any)

	var clauses []string
	var args []interface{}

	for _, condRaw := range condsRaw {
		cond, ok := condRaw.(map[string]any)
		if !ok {
			continue
		}
		field, _ := cond["field"].(string)
		value := cond["value"]

		clause, condArgs := buildConditionClause(wsID, field, value)
		if clause == "" {
			continue
		}
		clauses = append(clauses, "("+clause+")")
		args = append(args, condArgs...)
	}

	if len(clauses) == 0 {
		return "", nil
	}

	sep := " AND "
	if match == "any" {
		sep = " OR "
	}
	return "(" + strings.Join(clauses, sep) + ")", args
}

// buildConditionClause retorna SQL e args para uma condição individual.
func buildConditionClause(wsID uuid.UUID, field string, value any) (string, []interface{}) {
	str, _ := value.(string)
	num, _ := value.(float64)

	switch field {
	case "funnel":
		if str == "" {
			return "", nil
		}
		return "contacts.funnel = ?", []interface{}{str}
	case "stage":
		if str == "" {
			return "", nil
		}
		return "contacts.stage = ?", []interface{}{str}
	case "journey":
		if str == "" {
			return "", nil
		}
		return "contacts.journey = ?", []interface{}{str}
	case "owner":
		if str == "" {
			return "", nil
		}
		return "contacts.owner_id = ?", []interface{}{str}
	case "external_id":
		if str == "" {
			return "", nil
		}
		return "contacts.external_id = ?", []interface{}{str}
	case "channel":
		if str == "" {
			return "", nil
		}
		return "contacts.channel = ?", []interface{}{str}
	case "tag":
		if str == "" {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM contact_tags ct INNER JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = contacts.id AND t.name = ?)", []interface{}{str}
	case "never_purchased":
		return "NOT EXISTS (SELECT 1 FROM orders WHERE orders.contact_id = contacts.id)", nil
	case "min_ltv":
		if num == 0 {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM contact_computed cc WHERE cc.contact_id = contacts.id AND cc.lifetime_value >= ?)", []interface{}{num}
	case "min_orders":
		if num == 0 {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM contact_computed cc WHERE cc.contact_id = contacts.id AND cc.orders_total >= ?)", []interface{}{int(num)}
	case "signup_after":
		if str == "" {
			return "", nil
		}
		return "contacts.created_at >= ?", []interface{}{str}
	case "signup_before":
		if str == "" {
			return "", nil
		}
		return "contacts.created_at <= ?", []interface{}{str}
	// ── Inbox behavior ───────────────────────────────────────────────
	case "inbox_assigned_to":
		if str == "" {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ? AND conversations.assigned_user_id = ?)", []interface{}{wsID, str}
	case "inbox_department":
		if str == "" {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ? AND conversations.department_id = ?)", []interface{}{wsID, str}
	case "inbox_team":
		if str == "" {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ? AND conversations.team_id = ?)", []interface{}{wsID, str}
	case "inbox_queue":
		if str == "" {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ? AND conversations.queue_id = ?)", []interface{}{wsID, str}
	case "inbox_response_time_max":
		if num == 0 {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ? AND conversations.first_response_at IS NOT NULL AND EXTRACT(EPOCH FROM (conversations.first_response_at - conversations.created_at)) <= ?)", []interface{}{wsID, num}
	case "inbox_conversation_count_min":
		if num == 0 {
			return "", nil
		}
		return "(SELECT COUNT(*) FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ?) >= ?", []interface{}{wsID, int(num)}
	case "inbox_last_contact_after":
		if str == "" {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ? AND conversations.created_at >= ?)", []interface{}{wsID, str}
	case "inbox_first_contact_after":
		if str == "" {
			return "", nil
		}
		return "(SELECT MIN(created_at) FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ?) >= ?", []interface{}{wsID, str}
	case "inbox_entered_after":
		if str == "" {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ? AND conversations.created_at >= ?)", []interface{}{wsID, str}
	// ── Campanhas ───────────────────────────────────────────────────
	case "participated_campaign":
		if str == "" {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM campaign_recipients cr WHERE cr.phone = contacts.phone AND cr.campaign_id = ?)", []interface{}{str}
	case "passed_agent":
		if str == "" {
			return "", nil
		}
		return "EXISTS (SELECT 1 FROM conversations WHERE conversations.contact_id = contacts.id AND conversations.workspace_id = ? AND conversations.assigned_user_id = ?)", []interface{}{wsID, str}
	}
	return "", nil
}

// jsonDecode helper
func jsonDecode(raw string, dst any) error {
	if raw == "" || raw == "null" {
		return nil
	}
	return jsonUnmarshal([]byte(raw), dst)
}
