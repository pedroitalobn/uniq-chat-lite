package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/websocket/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// AgentHandler gerencia o centro de agentes
type AgentHandler struct {
	db      *gorm.DB
	wsConns map[string]*websocket.Conn
}

// NewAgentHandler cria um novo handler de agentes
func NewAgentHandler(db *gorm.DB) *AgentHandler {
	return &AgentHandler{
		db:      db,
		wsConns: make(map[string]*websocket.Conn),
	}
}

// GetStats GET /api/agent/stats
func (h *AgentHandler) GetStats(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	var totalJourneys, activeJourneys, pausedJourneys, totalExecs, activeExecs, completedExecs, failedExecs, todayExecs int64

	h.db.Model(&models.Journey{}).Where("user_id = ?", userID).Count(&totalJourneys)
	h.db.Model(&models.Journey{}).Where("user_id = ? AND status = 'active'", userID).Count(&activeJourneys)
	h.db.Model(&models.Journey{}).Where("user_id = ? AND status = 'paused'", userID).Count(&pausedJourneys)

	var instancesActive int64
	h.db.Model(&models.Instance{}).Where("user_id = ? AND status = 'connected'", userID).Count(&instancesActive)

	return c.JSON(fiber.Map{
		"journeys": fiber.Map{
			"total_journeys":       totalJourneys,
			"active_journeys":      activeJourneys,
			"paused_journeys":      pausedJourneys,
			"total_executions":     totalExecs,
			"active_executions":    activeExecs,
			"completed_executions": completedExecs,
			"failed_executions":    failedExecs,
			"today_executions":     todayExecs,
		},
		"instances_active": instancesActive,
	})
}

// GetActivity GET /api/agent/activity
func (h *AgentHandler) GetActivity(c *fiber.Ctx) error {
	_, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	limit := c.QueryInt("limit", 50)
	if limit > 200 {
		limit = 200
	}

	var executions []models.JourneyExecution
	h.db.Preload("Journey").Order("started_at DESC").Limit(limit).Find(&executions)

	return c.JSON(fiber.Map{
		"items": executions,
		"count": len(executions),
	})
}

// GetExecutionsByJourney GET /api/agent/journeys/:id/executions
func (h *AgentHandler) GetExecutionsByJourney(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	journeyID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de jornada inválido"})
	}

	// Verificar se a jornada pertence ao usuário
	var journey models.Journey
	if err := h.db.Where("id = ? AND user_id = ?", journeyID, userID).First(&journey).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "jornada não encontrada"})
	}

	limit := c.QueryInt("limit", 20)
	offset := c.QueryInt("offset", 0)

	return c.JSON(fiber.Map{
		"executions": []interface{}{},
		"total":      0,
		"limit":      limit,
		"offset":     offset,
	})
}

// GetInstances GET /api/agent/instances
func (h *AgentHandler) GetInstances(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	var instances []models.Instance
	if err := h.db.Where("user_id = ?", userID).Order("name ASC").Find(&instances).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao buscar instâncias"})
	}

	type InstanceInfo struct {
		ID          uuid.UUID          `json:"id"`
		Name        string             `json:"name"`
		Status      string             `json:"status"`
		Channel     models.ChannelType `json:"channel"`
		ConnectedAt *time.Time         `json:"connected_at,omitempty"`
	}

	result := make([]InstanceInfo, len(instances))
	for i, inst := range instances {
		result[i] = InstanceInfo{
			ID:          inst.ID,
			Name:        inst.Name,
			Status:      string(inst.Status),
			Channel:     inst.Channel,
			ConnectedAt: inst.ConnectedAt,
		}
	}

	return c.JSON(result)
}

// GetJourneyExecutions GET /api/journeys/:id/executions (alias)
func (h *AgentHandler) GetJourneyExecutions(c *fiber.Ctx) error {
	return h.GetExecutionsByJourney(c)
}

// StopExecution POST /api/agent/executions/:id/stop
func (h *AgentHandler) StopExecution(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	executionID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de execução inválido"})
	}

	// Verificar se a execução pertence ao usuário
	var execution models.JourneyExecution
	if err := h.db.
		Where("id = ? AND journey_id IN (SELECT id FROM journeys WHERE user_id = ?)", executionID, userID).
		First(&execution).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "execução não encontrada"})
	}

	now := time.Now()
	h.db.Model(&execution).Updates(map[string]interface{}{
		"status":       models.ExecutionPaused,
		"completed_at": now,
		"updated_at":   now,
	})

	return c.JSON(fiber.Map{"status": "stopped"})
}

// ActivityWS WebSocket /ws/agent-activity
func (h *AgentHandler) ActivityWS(c *websocket.Conn) {
	userIDStr := c.Query("user_id")
	userID, err := uuid.Parse(userIDStr)
	if err != nil {
		c.Close()
		return
	}

	connID := userID.String() + "-" + uuid.New().String()[:8]
	h.wsConns[connID] = c

	log.Info().Str("connID", connID).Msg("cliente conectado ao WebSocket de agentes")

	defer func() {
		delete(h.wsConns, connID)
		c.Close()
		log.Info().Str("connID", connID).Msg("cliente desconectado do WebSocket de agentes")
	}()

	for {
		mt, message, err := c.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Error().Err(err).Str("connID", connID).Msg("erro no WebSocket")
			}
			break
		}

		// Echo back for now - pode ser expandido para comandos
		if mt == websocket.TextMessage {
			if err := c.WriteMessage(websocket.TextMessage, message); err != nil {
				break
			}
		}
	}
}

// BroadcastActivity envia atualização de atividade para todos os clientes conectados
func (h *AgentHandler) BroadcastActivity(userID uuid.UUID, event string, data interface{}) {
	for connID, conn := range h.wsConns {
		// Verificar se o connID pertence ao userID
		if len(connID) >= 36 && connID[:36] == userID.String() {
			msg := map[string]interface{}{
				"event":     event,
				"data":      data,
				"timestamp": time.Now(),
			}
			if err := conn.WriteJSON(msg); err != nil {
				log.Error().Err(err).Str("connID", connID).Msg("falha ao enviar broadcast")
				delete(h.wsConns, connID)
				conn.Close()
			}
		}
	}
}

func (h *AgentHandler) currentUserID(c *fiber.Ctx) (uuid.UUID, error) {
	raw := c.Locals("user_id")
	if raw == nil {
		return uuid.Nil, fiber.NewError(fiber.StatusUnauthorized, "não autenticado")
	}
	id, ok := raw.(uuid.UUID)
	if !ok {
		return uuid.Nil, fiber.NewError(fiber.StatusUnauthorized, "ID de usuário inválido")
	}
	return id, nil
}
