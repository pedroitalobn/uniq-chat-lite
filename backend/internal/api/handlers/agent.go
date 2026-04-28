package handlers

import (
	"sync"
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
	wsMu    sync.RWMutex
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

	// Filtra por workspace quando o frontend envia ?workspace_id — sem isso
	// o dashboard mostrava agregados de TODOS workspaces do user (vazamento
	// entre tenants). Cascade aplicada em todas queries abaixo via journeyIDQ.
	wsParam := c.Query("workspace_id")

	// Subquery base: journeys do user, filtradas por workspace via instance.
	journeyIDQ := h.db.Model(&models.Journey{}).Where("user_id = ?", userID.String())
	instanceIDQ := h.db.Model(&models.Instance{}).Where("user_id = ?", userID.String())
	if wsParam != "" {
		if wsID, err := uuid.Parse(wsParam); err == nil {
			// Journey: aceita instance_id vazio (jornada global) ou pertencente
			// a uma instância do workspace.
			journeyIDQ = journeyIDQ.Where(
				"instance_id = '' OR instance_id IS NULL OR instance_id IN (SELECT id::text FROM instances WHERE workspace_id = ?)",
				wsID,
			)
			instanceIDQ = instanceIDQ.Where("workspace_id = ?", wsID)
		}
	}

	var totalJourneys, activeJourneys, pausedJourneys int64
	var totalExecs, activeExecs, completedExecs, failedExecs, todayExecs, totalMessages int64

	journeyIDQ.Session(&gorm.Session{}).Count(&totalJourneys)
	journeyIDQ.Session(&gorm.Session{}).Where("status = 'active'").Count(&activeJourneys)
	journeyIDQ.Session(&gorm.Session{}).Where("status = 'paused'").Count(&pausedJourneys)

	// Execuções: limita aos journey_ids resolvidos pelo filtro acima.
	var journeyIDs []string
	journeyIDQ.Session(&gorm.Session{}).Pluck("id", &journeyIDs)

	execQ := h.db.Model(&models.JourneyExecution{})
	if len(journeyIDs) > 0 {
		execQ = execQ.Where("journey_id IN ?", journeyIDs)
	} else {
		// Sem jornadas: zero tudo
		execQ = execQ.Where("1 = 0")
	}
	execQ.Session(&gorm.Session{}).Count(&totalExecs)
	execQ.Session(&gorm.Session{}).Where("status = 'active'").Count(&activeExecs)
	execQ.Session(&gorm.Session{}).Where("status = 'completed'").Count(&completedExecs)
	execQ.Session(&gorm.Session{}).Where("status = 'failed'").Count(&failedExecs)

	startOfDay := time.Now().Truncate(24 * time.Hour)
	execQ.Session(&gorm.Session{}).Where("started_at >= ?", startOfDay).Count(&todayExecs)

	// Total de mensagens geradas pelas execuções (agregado via COUNT das invocações)
	journeyIDQ.Session(&gorm.Session{}).
		Select("COALESCE(SUM(invocations),0)").
		Row().Scan(&totalMessages)

	// Instâncias ativas (do workspace filtrado)
	var instancesActive int64
	instanceIDQ.Session(&gorm.Session{}).Where("status = 'connected'").Count(&instancesActive)

	// Atividade recente (última hora)
	var recentActivity int64
	if len(journeyIDs) > 0 {
		h.db.Model(&models.JourneyExecution{}).
			Where("journey_id IN ? AND started_at >= ?", journeyIDs, time.Now().Add(-time.Hour)).
			Count(&recentActivity)
	}

	execRate := 0.0
	if totalExecs > 0 {
		execRate = float64(completedExecs) / float64(totalExecs) * 100
	}

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
			"total_messages":       totalMessages,
		},
		"instances_active":          instancesActive,
		"executions_today":          todayExecs,
		"execution_rate":            execRate,
		"recent_activity_last_hour": recentActivity,
	})
}

// GetActivity GET /api/agent/activity
func (h *AgentHandler) GetActivity(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	limit := c.QueryInt("limit", 50)
	if limit > 200 {
		limit = 200
	}

	var executions []models.JourneyExecution
	h.db.
		Where("journey_id IN (SELECT id FROM journeys WHERE user_id = ?)", userID.String()).
		Order("started_at DESC").
		Limit(limit).
		Find(&executions)

	// Enriquecer com nome da jornada
	type Enriched struct {
		models.JourneyExecution
		JourneyName string `json:"journey_name"`
	}
	result := make([]Enriched, 0, len(executions))
	journeyNames := make(map[string]string)
	for _, e := range executions {
		name, ok := journeyNames[e.JourneyID]
		if !ok {
			var j models.Journey
			if h.db.Select("name").Where("id = ?", e.JourneyID).First(&j).Error == nil {
				name = j.Name
				journeyNames[e.JourneyID] = name
			}
		}
		result = append(result, Enriched{JourneyExecution: e, JourneyName: name})
	}

	return c.JSON(fiber.Map{
		"items": result,
		"count": len(result),
	})
}

// GetExecutionsByJourney GET /api/journeys/:id/executions
func (h *AgentHandler) GetExecutionsByJourney(c *fiber.Ctx) error {
	userID, err := h.currentUserID(c)
	if err != nil {
		return err
	}

	journeyID := c.Params("id")
	if journeyID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de jornada inválido"})
	}

	// Verificar ownership
	var journey models.Journey
	if err := h.db.Where("id = ? AND user_id = ?", journeyID, userID.String()).First(&journey).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "jornada não encontrada"})
	}

	limit := c.QueryInt("limit", 20)
	offset := c.QueryInt("offset", 0)
	if limit > 200 {
		limit = 200
	}

	var total int64
	h.db.Model(&models.JourneyExecution{}).Where("journey_id = ?", journeyID).Count(&total)

	var executions []models.JourneyExecution
	h.db.Where("journey_id = ?", journeyID).
		Order("started_at DESC").
		Limit(limit).Offset(offset).
		Find(&executions)

	return c.JSON(fiber.Map{
		"executions": executions,
		"total":      total,
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

	executionID := c.Params("id")
	if executionID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID de execução inválido"})
	}

	// Verificar se a execução pertence ao usuário
	var execution models.JourneyExecution
	if err := h.db.
		Where("id = ? AND journey_id IN (SELECT id FROM journeys WHERE user_id = ?)", executionID, userID.String()).
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
	h.wsMu.Lock()
	h.wsConns[connID] = c
	h.wsMu.Unlock()

	log.Info().Str("connID", connID).Msg("cliente conectado ao WebSocket de agentes")

	defer func() {
		h.wsMu.Lock()
		delete(h.wsConns, connID)
		h.wsMu.Unlock()
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
	h.wsMu.RLock()
	targets := make([]*websocket.Conn, 0)
	targetIDs := make([]string, 0)
	for connID, conn := range h.wsConns {
		if len(connID) >= 36 && connID[:36] == userID.String() {
			targets = append(targets, conn)
			targetIDs = append(targetIDs, connID)
		}
	}
	h.wsMu.RUnlock()

	msg := map[string]interface{}{
		"event":     event,
		"data":      data,
		"timestamp": time.Now(),
	}

	for i, conn := range targets {
		if err := conn.WriteJSON(msg); err != nil {
			log.Error().Err(err).Str("connID", targetIDs[i]).Msg("falha ao enviar broadcast")
			h.wsMu.Lock()
			delete(h.wsConns, targetIDs[i])
			h.wsMu.Unlock()
			conn.Close()
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
