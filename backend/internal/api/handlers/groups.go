package handlers

import (
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

var groupJoinLocks sync.Map

type GroupHandler struct {
	db      *gorm.DB
	manager *whatsapp.Manager
}

func NewGroupHandler(db *gorm.DB, manager *whatsapp.Manager) *GroupHandler {
	return &GroupHandler{db: db, manager: manager}
}

func (h *GroupHandler) getClient(c *fiber.Ctx) (*whatsapp.InstanceClient, error) {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return nil, fiber.NewError(fiber.StatusNotFound, "instância não encontrada")
	}
	client := h.manager.GetInstance(instance.ID.String())
	if client == nil {
		return nil, fiber.NewError(fiber.StatusConflict, "instância não está em execução")
	}
	if !client.IsConnected() {
		return nil, fiber.NewError(fiber.StatusConflict, "instância não está conectada ao WhatsApp")
	}
	return client, nil
}

// List godoc
// GET /instances/:id/groups
func (h *GroupHandler) List(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	groups, err := client.GetJoinedGroups()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	// Diagnóstico extra: groups vazio em conta logada via QR é
	// comum pq whatsmeow lê do device store local e o history
	// sync ainda não puxou a lista. UI precisa entender a diferença
	// entre "0 grupos" e "ainda sincronizando" — devolvemos hint.
	hint := ""
	if len(groups) == 0 {
		hint = "Lista de grupos vazia. Se você acabou de conectar, aguarde alguns minutos pelo sync do WhatsApp ou abra alguma conversa de grupo no celular pra forçar a sincronização."
	}
	return c.JSON(fiber.Map{"groups": groups, "total": len(groups), "hint": hint})
}

// Create godoc
// POST /instances/:id/groups
func (h *GroupHandler) Create(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		Name         string   `json:"name"`
		Participants []string `json:"participants"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}
	info, err := client.CreateGroup(req.Name, req.Participants)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.Status(fiber.StatusCreated).JSON(info)
}

// Get godoc
// GET /instances/:id/groups/:jid
func (h *GroupHandler) Get(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	groupJID := c.Params("jid")
	info, err := client.GetGroupInfo(groupJID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(info)
}

// Update godoc
// PUT /instances/:id/groups/:jid
func (h *GroupHandler) Update(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	groupJID := c.Params("jid")
	var req struct {
		Name        *string `json:"name"`
		Description *string `json:"description"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if req.Name != nil {
		if err := client.UpdateGroupName(groupJID, *req.Name); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
	}
	if req.Description != nil {
		if err := client.UpdateGroupDescription(groupJID, *req.Description); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
	}
	return c.JSON(fiber.Map{"status": "updated"})
}

// UpdateParticipants godoc
// POST /instances/:id/groups/:jid/participants
func (h *GroupHandler) UpdateParticipants(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	groupJID := c.Params("jid")
	var req struct {
		Action       string   `json:"action"`
		Participants []string `json:"participants"`
	}
	if err := c.BodyParser(&req); err != nil || req.Action == "" || len(req.Participants) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'action' e 'participants' são obrigatórios"})
	}
	results, err := client.UpdateGroupParticipants(groupJID, req.Action, req.Participants)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"results": results})
}

// InviteLink godoc
// GET /instances/:id/groups/:jid/invite
func (h *GroupHandler) InviteLink(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	groupJID := c.Params("jid")
	reset := c.QueryBool("reset", false)
	link, err := client.GetGroupInviteLink(groupJID, reset)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"invite_link": link})
}

// Leave godoc
// POST /instances/:id/groups/:jid/leave
func (h *GroupHandler) Leave(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	groupJID := c.Params("jid")
	if err := client.LeaveGroup(groupJID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "left"})
}

// ListJoinJobs godoc
// GET /instances/:id/groups/join-jobs
func (h *GroupHandler) ListJoinJobs(c *fiber.Ctx) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	var jobs []models.GroupJoinJob
	if err := h.db.Where("instance_id = ?", instance.ID).
		Order("scheduled_at DESC, created_at DESC").
		Limit(100).
		Find(&jobs).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if jobs == nil {
		jobs = []models.GroupJoinJob{}
	}
	return c.JSON(fiber.Map{"data": jobs, "total": len(jobs)})
}

// JoinLink queues a single group invite link.
// POST /instances/:id/groups/join-link
func (h *GroupHandler) JoinLink(c *fiber.Ctx) error {
	var req struct {
		Link            string `json:"link"`
		Code            string `json:"code"`
		IntervalSeconds int    `json:"interval_seconds"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	link := req.Link
	if link == "" {
		link = req.Code
	}
	return h.enqueueJoinLinks(c, []string{link}, req.IntervalSeconds)
}

// JoinLinks queues several invite links, normally pasted from CSV/newlines.
// POST /instances/:id/groups/join-links
func (h *GroupHandler) JoinLinks(c *fiber.Ctx) error {
	var req struct {
		Links           []string `json:"links"`
		CSV             string   `json:"csv"`
		IntervalSeconds int      `json:"interval_seconds"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "corpo inválido"})
	}
	links := append([]string{}, req.Links...)
	if req.CSV != "" {
		links = append(links, splitInviteCSV(req.CSV)...)
	}
	return h.enqueueJoinLinks(c, links, req.IntervalSeconds)
}

func (h *GroupHandler) enqueueJoinLinks(c *fiber.Ctx, rawLinks []string, intervalSeconds int) error {
	instance, ok := c.Locals("instance").(*models.Instance)
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	if len(rawLinks) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "informe ao menos um link de grupo"})
	}
	if intervalSeconds <= 0 {
		intervalSeconds = 300
	}
	if intervalSeconds < 60 {
		intervalSeconds = 60
	}
	if intervalSeconds > 86400 {
		intervalSeconds = 86400
	}

	seen := map[string]bool{}
	jobs := make([]models.GroupJoinJob, 0, len(rawLinks))
	now := time.Now()
	for _, raw := range rawLinks {
		code, normalized, err := parseWhatsAppInviteCode(raw)
		if err != nil || code == "" || seen[code] {
			continue
		}
		seen[code] = true
		jobs = append(jobs, models.GroupJoinJob{
			InstanceID:  instance.ID,
			InviteLink:  normalized,
			InviteCode:  code,
			Status:      models.GroupJoinStatusPending,
			ScheduledAt: now.Add(time.Duration(len(jobs)*intervalSeconds) * time.Second),
		})
	}
	if len(jobs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "nenhum link válido encontrado"})
	}
	if len(jobs) > 100 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "limite de 100 links por envio"})
	}
	for i := range jobs {
		if err := h.db.Create(&jobs[i]).Error; err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao criar fila: " + err.Error()})
		}
	}
	if h.manager != nil {
		h.manager.LogInstanceEvent(instance.ID.String(), "info", "groups", "join_jobs_enqueued", "Links de grupos adicionados à fila gradual", fiber.Map{
			"jobs":             len(jobs),
			"interval_seconds": intervalSeconds,
		})
	}
	go h.processJoinQueue(instance.ID)
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{
		"message":          "links adicionados à fila gradual",
		"count":            len(jobs),
		"interval_seconds": intervalSeconds,
		"data":             jobs,
	})
}

func (h *GroupHandler) processJoinQueue(instanceID uuid.UUID) {
	lockIface, _ := groupJoinLocks.LoadOrStore(instanceID.String(), &sync.Mutex{})
	lock := lockIface.(*sync.Mutex)
	if !lock.TryLock() {
		return
	}
	defer lock.Unlock()

	for {
		var job models.GroupJoinJob
		err := h.db.Where("instance_id = ? AND status = ?", instanceID, models.GroupJoinStatusPending).
			Order("scheduled_at ASC, created_at ASC").
			First(&job).Error
		if err != nil {
			return
		}
		if wait := time.Until(job.ScheduledAt); wait > 0 {
			time.Sleep(wait)
		}

		client := h.manager.GetInstance(instanceID.String())
		if client == nil || !client.IsConnected() {
			finished := time.Now()
			h.db.Model(&job).Updates(map[string]interface{}{
				"status":      models.GroupJoinStatusFailed,
				"error":       "instância não conectada",
				"finished_at": finished,
				"attempts":    job.Attempts + 1,
			})
			h.manager.LogInstanceEvent(instanceID.String(), "warn", "groups", "join_job_failed", "Entrada em grupo falhou: instância não conectada", map[string]interface{}{"job_id": job.ID, "invite_code": job.InviteCode})
			continue
		}

		started := time.Now()
		h.db.Model(&job).Updates(map[string]interface{}{
			"status":     models.GroupJoinStatusRunning,
			"started_at": started,
			"attempts":   job.Attempts + 1,
		})

		groupJID, err := client.JoinGroupWithLink(job.InviteCode)
		finished := time.Now()
		if err != nil {
			h.db.Model(&job).Updates(map[string]interface{}{
				"status":      models.GroupJoinStatusFailed,
				"error":       err.Error(),
				"finished_at": finished,
			})
			h.manager.LogInstanceEvent(instanceID.String(), "error", "groups", "join_job_failed", "Entrada em grupo falhou", map[string]interface{}{"job_id": job.ID, "invite_code": job.InviteCode, "error": err.Error()})
			continue
		}

		h.db.Model(&job).Updates(map[string]interface{}{
			"status":      models.GroupJoinStatusJoined,
			"group_jid":   groupJID,
			"finished_at": finished,
		})
		h.manager.LogInstanceEvent(instanceID.String(), "info", "groups", "join_job_joined", "Instância entrou em grupo por link", map[string]interface{}{"job_id": job.ID, "group_jid": groupJID})
	}
}

func splitInviteCSV(input string) []string {
	return strings.FieldsFunc(input, func(r rune) bool {
		return r == '\n' || r == '\r' || r == ',' || r == ';' || r == '\t'
	})
}

func parseWhatsAppInviteCode(raw string) (string, string, error) {
	raw = strings.TrimSpace(strings.Trim(raw, `"'`))
	if raw == "" {
		return "", "", fiber.NewError(fiber.StatusBadRequest, "link vazio")
	}
	if header := strings.ToLower(raw); header == "invite_link" || header == "link" || header == "url" || header == "group_link" || header == "grupo" {
		return "", "", fiber.NewError(fiber.StatusBadRequest, "cabeçalho CSV ignorado")
	}
	if strings.Contains(raw, "chat.whatsapp.com/") {
		u, err := url.Parse(raw)
		if err != nil {
			return "", "", err
		}
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		code := parts[len(parts)-1]
		code = strings.TrimSpace(code)
		if code == "" {
			return "", "", fiber.NewError(fiber.StatusBadRequest, "código vazio")
		}
		return code, "https://chat.whatsapp.com/" + code, nil
	}
	raw = strings.TrimPrefix(raw, "https://")
	raw = strings.TrimPrefix(raw, "http://")
	raw = strings.TrimPrefix(raw, "chat.whatsapp.com/")
	raw = strings.Trim(raw, "/ ")
	return raw, "https://chat.whatsapp.com/" + raw, nil
}
