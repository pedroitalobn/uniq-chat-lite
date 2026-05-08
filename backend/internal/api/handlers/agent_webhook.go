package handlers

// Webhook trigger pra agentes — endpoint público (mas autenticado por
// slug + opcional HMAC) que dispara um agente fora do fluxo normal de
// inbound. Útil pra integrações externas: form do site recebe lead → POST
// pro webhook → agente abre conversa no WhatsApp.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"gorm.io/gorm"
)

type AgentWebhookHandler struct {
	db      *gorm.DB
	runtime *services.AgentRuntime
}

func NewAgentWebhookHandler(db *gorm.DB, runtime *services.AgentRuntime) *AgentWebhookHandler {
	return &AgentWebhookHandler{db: db, runtime: runtime}
}

// Trigger — POST /v1/webhooks/agent-trigger/:slug
//
// Body JSON: { to, message, from_name?, variables?, metadata? }
//
// Header opcional: X-Uniq-Signature = hex(HMAC-SHA256(body, agent.TriggerWebhookSecret))
// Quando o agente tem TriggerWebhookSecret preenchido, o header é
// obrigatório. Sem secret: aceita sem assinatura (slug por si só já é
// um segredo razoável de 32 bytes).
func (h *AgentWebhookHandler) Trigger(c *fiber.Ctx) error {
	slug := strings.TrimSpace(c.Params("slug"))
	if slug == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug obrigatório"})
	}

	var agent models.InstanceAgent
	if err := h.db.Preload("Integration").Preload("Assets", func(tx *gorm.DB) *gorm.DB {
		return tx.Where("is_active = ?", true)
	}).Where("trigger_webhook_slug = ?", slug).First(&agent).Error; err != nil {
		// 404 sem detalhe — slug é segredo, não vaza existência.
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "webhook não encontrado"})
	}

	// Lê body cru pra HMAC + reuse no parse.
	body := c.Body()

	// Verifica HMAC se configurado.
	if secret := strings.TrimSpace(agent.TriggerWebhookSecret); secret != "" {
		sig := c.Get("X-Uniq-Signature")
		if !verifyHMAC(body, secret, sig) {
			log.Warn().
				Str("slug", slug).
				Str("agent", agent.AgentName).
				Msg("agent-webhook: assinatura inválida")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "assinatura inválida — verifique X-Uniq-Signature",
			})
		}
	}

	var payload services.AgentWebhookPayload
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido: " + err.Error()})
	}

	if h.runtime == nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "agent runtime indisponível"})
	}
	reply, err := h.runtime.TriggerByWebhook(&agent, payload)
	if err != nil {
		log.Error().Err(err).Str("slug", slug).Msg("agent-webhook: trigger falhou")
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":   "falha ao disparar agente",
			"message": err.Error(),
			"reply":   reply, // pode estar populado se foi gerado mas envio falhou
		})
	}
	return c.JSON(fiber.Map{
		"ok":       true,
		"reply":    reply,
		"agent":    agent.AgentName,
	})
}

// verifyHMAC — compara SHA256-HMAC do body com o header em tempo
// constante pra evitar timing attack.
func verifyHMAC(body []byte, secret, sigHex string) bool {
	if sigHex == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	got, err := hex.DecodeString(strings.TrimSpace(sigHex))
	if err != nil {
		return false
	}
	expectedBytes, _ := hex.DecodeString(expected)
	return hmac.Equal(got, expectedBytes)
}

// Discard — utility no-op pra que `io` não seja "imported and not used"
// em refactors futuros que dropem c.Body() (caso troquemos pro stream).
var _ = io.Discard