package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
)

// ─── PlatformVoice — admin CRUD ────────────────────────────────────────
//
// Espelha 1:1 o pattern de PlatformAI: o super admin configura providers
// globais de TTS (OpenAI TTS, ElevenLabs, etc) que viram a "Uniq Voice"
// pra users finais. Workspaces sem VoiceProvider próprio caem nessa config
// SE o plano deles tiver AllowVoice=true.

// ListPlatformVoice GET /v1/admin/platform-voice
func (h *AdminHandler) ListPlatformVoice(c *fiber.Ctx) error {
	var cfgs []models.PlatformVoice
	if err := h.db.Order("created_at ASC").Find(&cfgs).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro ao buscar configs"})
	}
	out := make([]fiber.Map, 0, len(cfgs))
	for _, cfg := range cfgs {
		out = append(out, fiber.Map{
			"id":             cfg.ID,
			"provider":       cfg.Provider,
			"name":           cfg.Name,
			"base_url":       cfg.BaseURL,
			"voices":         cfg.Voices,
			"config":         cfg.Config,
			"is_active":      cfg.IsActive,
			"test_status":    cfg.TestStatus,
			"last_tested_at": cfg.LastTestedAt,
			"has_api_key":    cfg.APIKey != "",
		})
	}
	return c.JSON(out)
}

// CreatePlatformVoice POST /v1/admin/platform-voice
func (h *AdminHandler) CreatePlatformVoice(c *fiber.Ctx) error {
	var body struct {
		Provider string `json:"provider"`
		Name     string `json:"name"`
		APIKey   string `json:"api_key"`
		BaseURL  string `json:"base_url"`
		Voices   string `json:"voices"`
		Config   string `json:"config"`
		IsActive *bool  `json:"is_active"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "corpo inválido"})
	}
	if body.Provider == "" {
		return c.Status(400).JSON(fiber.Map{"error": "provider é obrigatório"})
	}
	cfg := models.PlatformVoice{
		Provider: body.Provider,
		Name:     body.Name,
		APIKey:   body.APIKey,
		BaseURL:  body.BaseURL,
		Voices:   body.Voices,
		Config:   body.Config,
		IsActive: true,
	}
	if cfg.Name == "" {
		cfg.Name = "Uniq Voice"
	}
	if body.IsActive != nil {
		cfg.IsActive = *body.IsActive
	}
	if err := h.db.Create(&cfg).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro ao criar config"})
	}
	return c.Status(201).JSON(fiber.Map{"ok": true, "id": cfg.ID})
}

// UpdatePlatformVoiceByID PUT /v1/admin/platform-voice/:id
func (h *AdminHandler) UpdatePlatformVoiceByID(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	var body struct {
		Provider string `json:"provider"`
		Name     string `json:"name"`
		APIKey   string `json:"api_key"`
		BaseURL  string `json:"base_url"`
		Voices   string `json:"voices"`
		Config   string `json:"config"`
		IsActive *bool  `json:"is_active"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "corpo inválido"})
	}
	var cfg models.PlatformVoice
	if err := h.db.First(&cfg, "id = ?", id).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "config não encontrada"})
	}
	if body.Provider != "" {
		cfg.Provider = body.Provider
	}
	if body.Name != "" {
		cfg.Name = body.Name
	}
	// API key: vazio = mantém. Sem isso, ao editar config sem refornecer
	// a key, ela sumia (caller envia "" pra "not changed").
	if body.APIKey != "" {
		cfg.APIKey = body.APIKey
	}
	cfg.BaseURL = body.BaseURL
	if body.Voices != "" {
		cfg.Voices = body.Voices
	}
	if body.Config != "" {
		cfg.Config = body.Config
	}
	if body.IsActive != nil {
		cfg.IsActive = *body.IsActive
	}
	if err := h.db.Save(&cfg).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro ao salvar config"})
	}
	return c.JSON(fiber.Map{"ok": true, "id": cfg.ID})
}

// DeletePlatformVoice DELETE /v1/admin/platform-voice/:id
func (h *AdminHandler) DeletePlatformVoice(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	if err := h.db.Delete(&models.PlatformVoice{}, "id = ?", id).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro ao deletar config"})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// TestPlatformVoice POST /v1/admin/platform-voice/:id/test
// Faz uma chamada leve ao provider pra validar credenciais (lista vozes).
// Não consome TTS de fato — só verifica autenticação.
func (h *AdminHandler) TestPlatformVoice(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "id inválido"})
	}
	var cfg models.PlatformVoice
	if err := h.db.First(&cfg, "id = ?", id).Error; err != nil {
		return c.Status(404).JSON(fiber.Map{"error": "config não encontrada"})
	}
	if cfg.APIKey == "" {
		return c.Status(400).JSON(fiber.Map{"error": "API key não configurada"})
	}
	ok, msg := testPlatformVoiceConnection(&cfg)
	now := time.Now()
	status := "ok"
	if !ok {
		status = "failed"
	}
	h.db.Model(&cfg).Updates(map[string]any{
		"test_status":    status,
		"last_tested_at": now,
	})
	return c.JSON(fiber.Map{"ok": ok, "message": msg})
}

// ListPlatformVoicePublic GET /v1/integrations/platform-voice
//
// Endpoint público (autenticado) usado pelo VoicesSection do user final.
// Mesma estratégia do ListPlatformAIPublic: super admin vê o real,
// usuário comum vê só "Uniq Voice" abstrato pra não vazar o provider de
// trás. Quando a config global está inativa, retorna [] — UI mostra
// hint "Uniq Voice indisponível, configure provider próprio".
func (h *AdminHandler) ListPlatformVoicePublic(c *fiber.Ctx) error {
	var cfgs []models.PlatformVoice
	if err := h.db.Where("is_active = true").Order("created_at ASC").Find(&cfgs).Error; err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "erro"})
	}
	user := middleware.GetCurrentUser(c)
	isAdmin := user != nil && user.Role == models.RoleSuperAdmin
	if !isAdmin {
		if len(cfgs) == 0 {
			return c.JSON([]fiber.Map{})
		}
		return c.JSON([]fiber.Map{{
			"id":          cfgs[0].ID,
			"provider":    "uniq",
			"name":        "Uniq Voice",
			"is_active":   true,
			"test_status": "ok",
			"voices":      cfgs[0].Voices, // já vem como JSON serializado
		}})
	}
	out := make([]fiber.Map, 0, len(cfgs))
	for _, cfg := range cfgs {
		out = append(out, fiber.Map{
			"id":          cfg.ID,
			"provider":    cfg.Provider,
			"name":        cfg.Name,
			"is_active":   cfg.IsActive,
			"test_status": cfg.TestStatus,
			"voices":      cfg.Voices,
		})
	}
	return c.JSON(out)
}

// testPlatformVoiceConnection — toca no endpoint de listagem de vozes
// do provider pra validar credenciais. Ping leve (sem síntese real).
func testPlatformVoiceConnection(cfg *models.PlatformVoice) (bool, string) {
	switch cfg.Provider {
	case "openai_tts", "openai":
		// OpenAI não tem endpoint de "list voices" — testamos auth
		// chamando /models que devolve a lista de modelos disponíveis
		// (incluindo tts-1, tts-1-hd). 200 = key válida.
		return pingProviderGet(cfg, "https://api.openai.com/v1/models", "Bearer "+cfg.APIKey)
	case "elevenlabs":
		base := cfg.BaseURL
		if base == "" {
			base = "https://api.elevenlabs.io"
		}
		return pingProviderGetHeader(cfg, base+"/v1/voices", "xi-api-key", cfg.APIKey)
	case "qwen_tts", "qwen":
		base := cfg.BaseURL
		if base == "" {
			base = "https://dashscope.aliyuncs.com/api/v1"
		}
		return pingProviderGet(cfg, base+"/services/audio/tts/voices", "Bearer "+cfg.APIKey)
	case "azure_tts", "azure":
		// Azure exige region embutido na URL — sem BaseURL não dá pra
		// testar. Validamos só a presença da key.
		if cfg.BaseURL == "" {
			return false, "BaseURL (region endpoint) é obrigatório pra Azure"
		}
		return pingProviderGetHeader(cfg, cfg.BaseURL+"/cognitiveservices/voices/list",
			"Ocp-Apim-Subscription-Key", cfg.APIKey)
	default:
		return false, fmt.Sprintf("provider %q sem teste implementado", cfg.Provider)
	}
}

func pingProviderGet(_ *models.PlatformVoice, url string, authHeader string) (bool, string) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return false, err.Error()
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	resp, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err != nil {
		return false, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return true, "conexão ok"
	}
	body, _ := io.ReadAll(resp.Body)
	return false, fmt.Sprintf("status %d: %s", resp.StatusCode, truncateBody(string(body), 200))
}

func pingProviderGetHeader(_ *models.PlatformVoice, url, headerKey, headerVal string) (bool, string) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return false, err.Error()
	}
	req.Header.Set(headerKey, headerVal)
	resp, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err != nil {
		return false, err.Error()
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return true, "conexão ok"
	}
	body, _ := io.ReadAll(resp.Body)
	return false, fmt.Sprintf("status %d: %s", resp.StatusCode, truncateBody(string(body), 200))
}

// avoid unused-import compile errors when imports adjust:
var _ = bytes.NewReader
var _ = json.Marshal
