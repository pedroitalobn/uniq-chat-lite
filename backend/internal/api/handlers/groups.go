package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

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
