package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
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
		providerID := provider.ID
		fetched[i].WorkspaceID = ws
		fetched[i].VoiceProviderID = &providerID
		fetched[i].Source = "workspace_provider"
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
	q := h.db.Preload("Provider").Preload("PlatformVoice").Where("workspace_voices.workspace_id = ?", ws)
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
	if err := h.db.Preload("Provider").Preload("PlatformVoice").
		Where("id = ? AND workspace_id = ?", id, ws).
		First(&voice).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "voz não encontrada"})
	}
	provider := voice.Provider
	if provider == nil && voice.PlatformVoice != nil {
		provider = platformVoiceAsProvider(voice.PlatformVoice)
	}
	if provider == nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": "provider não encontrado"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 60*time.Second)
	defer cancel()

	audioData, mime, err := h.tts.Synthesize(ctx, provider, services.TTSRequest{
		Text:      text,
		VoiceID:   voice.ExternalID,
		Stability: 0.5, Similarity: 0.75, Style: 0.5, Speed: 1.0,
	})
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha no TTS: " + err.Error()})
	}

	c.Set("Content-Type", mime)
	c.Set("Content-Disposition", `inline; filename="preview.mp3"`)
	return c.Send(audioData)
}

// TestProvider POST /v1/voices/providers/:id/test
// Bate na API do provider pra confirmar que a key funciona.
func (h *VoiceHandler) TestProvider(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var p models.VoiceProvider
	if err := h.db.Where("id = ? AND workspace_id = ?", id, ws).First(&p).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "provider não encontrado"})
	}
	ctx, cancel := context.WithTimeout(c.Context(), 15*time.Second)
	defer cancel()
	if err := h.tts.TestProvider(ctx, &p); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"ok": false, "error": err.Error()})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// GetUsage GET /v1/voices/providers/:id/usage
// Devolve quota / consumo atual do provider (ElevenLabs subscription).
func (h *VoiceHandler) GetUsage(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var p models.VoiceProvider
	if err := h.db.Where("id = ? AND workspace_id = ?", id, ws).First(&p).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "provider não encontrado"})
	}
	if p.Provider != models.VoiceProviderElevenLabs {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "usage só está disponível para ElevenLabs por enquanto"})
	}
	ctx, cancel := context.WithTimeout(c.Context(), 15*time.Second)
	defer cancel()
	u, err := h.tts.GetElevenLabsUsage(ctx, p.APIKey)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(u)
}

// CloneVoice POST /v1/voices/providers/:id/clone (multipart)
// Form fields: name, description, labels (json), files[] (1+ samples)
// Cria a voz no ElevenLabs via IVC e persiste como WorkspaceVoice.
func (h *VoiceHandler) CloneVoice(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var p models.VoiceProvider
	if err := h.db.Where("id = ? AND workspace_id = ?", id, ws).First(&p).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "provider não encontrado"})
	}
	if p.Provider != models.VoiceProviderElevenLabs {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "clonagem só suportada para ElevenLabs"})
	}

	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "esperado multipart/form-data"})
	}
	name := strings.TrimSpace(c.FormValue("name"))
	if name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name obrigatório"})
	}
	description := c.FormValue("description")
	files := form.File["files"]
	if len(files) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ao menos 1 arquivo de áudio (campo 'files') é necessário"})
	}

	var samples []services.CloneVoiceSample
	for _, fh := range files {
		if fh.Size > 25*1024*1024 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "cada arquivo deve ter até 25MB"})
		}
		fr, err := fh.Open()
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "falha ao ler arquivo: " + fh.Filename})
		}
		buf := make([]byte, fh.Size)
		_, _ = fr.Read(buf)
		fr.Close()
		samples = append(samples, services.CloneVoiceSample{Filename: fh.Filename, Data: buf})
	}

	labels := map[string]string{}
	if raw := c.FormValue("labels"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &labels)
	}

	ctx, cancel := context.WithTimeout(c.Context(), 5*time.Minute)
	defer cancel()
	voiceID, voiceName, err := h.tts.CloneElevenLabsVoice(ctx, p.APIKey, services.CloneVoiceInput{
		Name:        name,
		Description: description,
		Samples:     samples,
		Labels:      labels,
	})
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha na clonagem: " + err.Error()})
	}

	wv := models.WorkspaceVoice{
		WorkspaceID:     ws,
		VoiceProviderID: &p.ID,
		Source:          "workspace_provider",
		ExternalID:      voiceID,
		Name:            voiceName,
		Category:        "clone",
		Description:     description,
		IsActive:        true,
	}
	if err := h.db.Create(&wv).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "voz clonada no provider mas falhou ao persistir local"})
	}
	return c.Status(fiber.StatusCreated).JSON(wv)
}

// CloneUniqVoice POST /v1/voices/uniq/clone (multipart)
// Usa o provider global da plataforma (Uniq Voice) para clonar uma voz e
// persiste o resultado no workspace, sem exigir API key própria do cliente.
func (h *VoiceHandler) CloneUniqVoice(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	if !h.userCanUseUniqVoice(c) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Uniq Voice não disponível no plano atual"})
	}

	var pv models.PlatformVoice
	if err := h.db.Where("is_active = ?", true).Order("created_at ASC").First(&pv).Error; err != nil {
		return c.Status(fiber.StatusUnprocessableEntity).JSON(fiber.Map{"error": "Uniq Voice não está configurada"})
	}
	provider := platformVoiceAsProvider(&pv)
	if provider == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "provider Uniq Voice não suporta clonagem"})
	}
	if provider.Provider != models.VoiceProviderElevenLabs {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "clonagem via Uniq Voice está disponível quando o provider global é ElevenLabs"})
	}

	input, err := parseCloneVoiceInput(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	if input.Labels == nil {
		input.Labels = map[string]string{}
	}
	input.Labels["source"] = "uniq_voice"
	input.Labels["workspace_id"] = ws.String()

	ctx, cancel := context.WithTimeout(c.Context(), 5*time.Minute)
	defer cancel()
	voiceID, voiceName, err := h.tts.CloneElevenLabsVoice(ctx, provider.APIKey, input)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "falha na clonagem: " + err.Error()})
	}

	wv := models.WorkspaceVoice{
		WorkspaceID:     ws,
		VoiceProviderID: &pv.ID, // compat: DBs antigas ainda exigem NOT NULL; Source define o runtime real.
		PlatformVoiceID: &pv.ID,
		Source:          "uniq_voice",
		ExternalID:      voiceID,
		Name:            voiceName,
		Category:        "clone",
		Description:     input.Description,
		IsActive:        true,
	}
	if err := h.db.Create(&wv).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "voz clonada na Uniq Voice mas falhou ao persistir local"})
	}
	return c.Status(fiber.StatusCreated).JSON(wv)
}

// DeleteVoice DELETE /v1/voices/:id
// Remove a voz local + chama provider pra liberar o slot (apenas
// vozes clonadas — vozes preset ficam só desativadas localmente).
func (h *VoiceHandler) DeleteVoice(c *fiber.Ctx) error {
	ws := middleware.GetWorkspaceID(c)
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "id inválido"})
	}
	var v models.WorkspaceVoice
	if err := h.db.Preload("Provider").Preload("PlatformVoice").Where("id = ? AND workspace_id = ?", id, ws).First(&v).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "voz não encontrada"})
	}
	// Só apaga no provider quando é uma voz clonada (preset é compartilhado).
	if v.Category == "clone" && v.Provider != nil && v.Provider.Provider == models.VoiceProviderElevenLabs {
		ctx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
		defer cancel()
		if err := h.tts.DeleteElevenLabsVoice(ctx, v.Provider.APIKey, v.ExternalID); err != nil {
			// Loga mas segue — soft delete local mesmo com falha remota
			// (user pode ter já removido manualmente no painel ElevenLabs).
			c.Set("X-Provider-Delete-Error", err.Error())
		}
	}
	if v.Category == "clone" && v.Provider == nil && v.PlatformVoice != nil {
		provider := platformVoiceAsProvider(v.PlatformVoice)
		if provider != nil && provider.Provider == models.VoiceProviderElevenLabs {
			ctx, cancel := context.WithTimeout(c.Context(), 30*time.Second)
			defer cancel()
			if err := h.tts.DeleteElevenLabsVoice(ctx, provider.APIKey, v.ExternalID); err != nil {
				c.Set("X-Provider-Delete-Error", err.Error())
			}
		}
	}
	h.db.Delete(&v)
	return c.JSON(fiber.Map{"ok": true})
}

// ─── Helper ───────────────────────────────────────────────────────────────────

func parseCloneVoiceInput(c *fiber.Ctx) (services.CloneVoiceInput, error) {
	form, err := c.MultipartForm()
	if err != nil {
		return services.CloneVoiceInput{}, fmt.Errorf("esperado multipart/form-data")
	}
	name := strings.TrimSpace(c.FormValue("name"))
	if name == "" {
		return services.CloneVoiceInput{}, fmt.Errorf("name obrigatório")
	}
	files := form.File["files"]
	if len(files) == 0 {
		return services.CloneVoiceInput{}, fmt.Errorf("ao menos 1 arquivo de áudio (campo 'files') é necessário")
	}

	samples := make([]services.CloneVoiceSample, 0, len(files))
	for _, fh := range files {
		if fh.Size > 25*1024*1024 {
			return services.CloneVoiceInput{}, fmt.Errorf("cada arquivo deve ter até 25MB")
		}
		fr, err := fh.Open()
		if err != nil {
			return services.CloneVoiceInput{}, fmt.Errorf("falha ao ler arquivo: %s", fh.Filename)
		}
		data, readErr := io.ReadAll(fr)
		fr.Close()
		if readErr != nil {
			return services.CloneVoiceInput{}, fmt.Errorf("falha ao ler arquivo: %s", fh.Filename)
		}
		samples = append(samples, services.CloneVoiceSample{Filename: fh.Filename, Data: data})
	}

	labels := map[string]string{}
	if raw := c.FormValue("labels"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &labels)
	}
	return services.CloneVoiceInput{
		Name:        name,
		Description: c.FormValue("description"),
		Samples:     samples,
		Labels:      labels,
	}, nil
}

func platformVoiceAsProvider(pv *models.PlatformVoice) *models.VoiceProvider {
	if pv == nil || !pv.IsActive || strings.TrimSpace(pv.APIKey) == "" {
		return nil
	}
	provider := models.VoiceProviderType("")
	switch strings.ToLower(strings.TrimSpace(pv.Provider)) {
	case "elevenlabs":
		provider = models.VoiceProviderElevenLabs
	case "qwen_tts", "qwen":
		provider = models.VoiceProviderQwenTTS
	case "openai_tts", "openai":
		provider = models.VoiceProviderOpenAITTS
	default:
		return nil
	}
	return &models.VoiceProvider{
		ID:       pv.ID,
		Provider: provider,
		Name:     pv.Name,
		APIKey:   pv.APIKey,
		IsActive: true,
	}
}

func (h *VoiceHandler) userCanUseUniqVoice(c *fiber.Ctx) bool {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return false
	}
	if user.Role == models.RoleSuperAdmin {
		return true
	}
	var fresh models.User
	if err := h.db.Preload("Plan").First(&fresh, "id = ?", user.ID).Error; err != nil {
		return false
	}
	return fresh.Plan != nil && fresh.Plan.HasFeature(models.FeatureVoice)
}

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
