package handlers

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"gorm.io/gorm"
)

type VoiceHandler struct {
	db  *gorm.DB
	tts *services.TTSService
}

func NewVoiceHandler(db *gorm.DB, tts *services.TTSService) *VoiceHandler {
	return &VoiceHandler{db: db, tts: tts}
}

// ─── Providers ────────────────────────────────────────────────────────────────

// ListProviders GET /v1/voices/providers
func (h *VoiceHandler) ListProviders(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var providers []models.VoiceProvider
	h.db.Where("workspace_id = ?", ws).Order("created_at ASC").Find(&providers)
	for i := range providers {
		providers[i].MaskedKey = maskKey(providers[i].APIKey)
	}
	return c.JSON(providers)
}

// CreateProvider POST /v1/voices/providers
// Body: { provider, name, api_key }
func (h *VoiceHandler) CreateProvider(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var body struct {
		Provider string `json:"provider"`
		Name     string `json:"name"`
		APIKey   string `json:"api_key"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	p := models.VoiceProviderType(body.Provider)
	if p != models.VoiceProviderElevenLabs && p != models.VoiceProviderQwenTTS && p != models.VoiceProviderOpenAITTS {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "provider deve ser elevenlabs, qwen_tts ou openai_tts"})
	}
	if strings.TrimSpace(body.APIKey) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "api_key obrigatória"})
	}
	name := body.Name
	if name == "" {
		name = string(p)
	}
	provider := models.VoiceProvider{
		WorkspaceID: ws,
		Provider:    p,
		Name:        name,
		APIKey:      strings.TrimSpace(body.APIKey),
		IsActive:    true,
	}
	if err := h.db.Create(&provider).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha ao criar provider"})
	}
	provider.MaskedKey = maskKey(provider.APIKey)
	return c.Status(fiber.StatusCreated).JSON(provider)
}

// DeleteProvider DELETE /v1/voices/providers/:id
func (h *VoiceHandler) DeleteProvider(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.db.Where("id = ? AND workspace_id = ?", id, ws).Delete(&models.VoiceProvider{}).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "provider não encontrado"})
	}
	// Cascade: remove voices deste provider
	h.db.Where("voice_provider_id = ? AND workspace_id = ?", id, ws).Delete(&models.WorkspaceVoice{})
	return c.JSON(fiber.Map{"ok": true})
}

// SyncVoices POST /v1/voices/providers/:id/sync
// Busca a lista de vozes do provider e sincroniza no banco.
func (h *VoiceHandler) SyncVoices(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var provider models.VoiceProvider
	if err := h.db.Where("id = ? AND workspace_id = ?", id, ws).First(&provider).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "provider não encontrado"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
	defer cancel()

	fetched, err := h.tts.ListVoices(ctx, &provider)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha ao buscar vozes: " + err.Error()})
	}

	// Upsert: atualiza se external_id já existe, senão cria
	for i := range fetched {
		fetched[i].WorkspaceID = ws
		fetched[i].VoiceProviderID = provider.ID
		var existing models.WorkspaceVoice
		if h.db.Where("workspace_id = ? AND voice_provider_id = ? AND external_id = ?", ws, provider.ID, fetched[i].ExternalID).First(&existing).Error == nil {
			h.db.Model(&existing).Updates(map[string]any{
				"name":        fetched[i].Name,
				"preview_url": fetched[i].PreviewURL,
				"category":    fetched[i].Category,
				"language":    fetched[i].Language,
				"gender":      fetched[i].Gender,
				"description": fetched[i].Description,
			})
			fetched[i].ID = existing.ID
		} else {
			h.db.Create(&fetched[i])
		}
	}

	return c.JSON(fiber.Map{"ok": true, "synced": len(fetched), "voices": fetched})
}

// ─── Voices ───────────────────────────────────────────────────────────────────

// ListVoices GET /v1/voices
// Query: provider_id, category, language, active
func (h *VoiceHandler) ListVoices(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	q := h.db.Preload("Provider").Where("workspace_voices.workspace_id = ?", ws)
	if pid := c.Query("provider_id"); pid != "" {
		q = q.Where("voice_provider_id = ?", pid)
	}
	if cat := c.Query("category"); cat != "" {
		q = q.Where("category = ?", cat)
	}
	if lang := c.Query("language"); lang != "" {
		q = q.Where("language LIKE ?", lang+"%")
	}
	if c.Query("active") != "false" {
		q = q.Where("workspace_voices.is_active = ?", true)
	}
	var voices []models.WorkspaceVoice
	q.Order("name ASC").Find(&voices)
	return c.JSON(voices)
}

// ToggleVoice PATCH /v1/voices/:id
// Body: { is_active: bool }
func (h *VoiceHandler) ToggleVoice(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct {
		IsActive bool `json:"is_active"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if err := h.db.Model(&models.WorkspaceVoice{}).
		Where("id = ? AND workspace_id = ?", id, ws).
		Update("is_active", body.IsActive).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "voz não encontrada"})
	}
	return c.JSON(fiber.Map{"ok": true, "is_active": body.IsActive})
}

// TestTTS POST /v1/voices/test
// Gera um trecho de áudio de teste com a voz e provider indicados.
// Body: { voice_id (workspace voice UUID), text }
// Response: audio/mpeg binary
func (h *VoiceHandler) TestTTS(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	var body struct {
		VoiceID string `json:"voice_id"`
		Text    string `json:"text"`
	}
	if err := c.BodyParser(&body); err != nil || body.VoiceID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "voice_id obrigatório"})
	}
	text := body.Text
	if text == "" {
		text = "Olá! Esta é uma demonstração da voz configurada no agente."
	}

	id, err := uuid.Parse(body.VoiceID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "voice_id inválido"})
	}
	var voice models.WorkspaceVoice
	if err := h.db.Preload("Provider").
		Where("id = ? AND workspace_id = ?", id, ws).
		First(&voice).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "voz não encontrada"})
	}
	if voice.Provider == nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": "provider não encontrado"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 60*time.Second)
	defer cancel()

	audioData, mime, err := h.tts.Synthesize(ctx, voice.Provider, services.TTSRequest{
		Text:    text,
		VoiceID: voice.ExternalID,
		Stability: 0.5, Similarity: 0.75, Style: 0.5, Speed: 1.0,
	})
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha no TTS: " + err.Error()})
	}

	c.Set("Content-Type", mime)
	c.Set("Content-Disposition", `inline; filename="preview.mp3"`)
	return c.Send(audioData)
}

// ─── Helper ───────────────────────────────────────────────────────────────────

func maskKey(key string) string {
	if len(key) <= 8 {
		return "••••••••"
	}
	return key[:4] + strings.Repeat("•", 20) + key[len(key)-4:]
}

// ─── Agent voice config helper (used by integrations handler) ────────────────

// AgentVoiceConfig é o JSON armazenado no campo InstanceAgent.Voice.
type AgentVoiceConfig struct {
	WorkspaceVoiceID string  `json:"workspace_voice_id,omitempty"` // UUID da WorkspaceVoice
	Provider         string  `json:"provider,omitempty"`
	VoiceExternalID  string  `json:"voice,omitempty"`
	Stability        float64 `json:"stability"`
	Similarity       float64 `json:"similarity"`
	Style            float64 `json:"style"`
	Speed            float64 `json:"speed"`
	AudioEnabled     bool    `json:"audio_enabled"` // se true, agent responde em áudio
}

// ParseAgentVoiceConfig desserializa o campo Voice do InstanceAgent.
func ParseAgentVoiceConfig(raw string) (*AgentVoiceConfig, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" || raw == "null" {
		return nil, false
	}
	var cfg AgentVoiceConfig
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return nil, false
	}
	return &cfg, cfg.AudioEnabled && (cfg.WorkspaceVoiceID != "" || cfg.VoiceExternalID != "")
}
