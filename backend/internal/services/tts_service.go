package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/uniq-chat/backend/internal/models"
)

// TTSService converte texto em áudio usando ElevenLabs ou Qwen TTS.
type TTSService struct{}

func NewTTSService() *TTSService { return &TTSService{} }

// TTSRequest agrupa os parâmetros de síntese.
type TTSRequest struct {
	Text       string
	VoiceID    string  // external_id da voz no provider
	Stability  float64 // 0-1
	Similarity float64 // 0-1
	Style      float64 // 0-1
	Speed      float64 // 0.7-1.2
}

// Synthesize converte texto em áudio e retorna os bytes MP3/OGG + mime type.
func (s *TTSService) Synthesize(ctx context.Context, provider *models.VoiceProvider, req TTSRequest) ([]byte, string, error) {
	switch provider.Provider {
	case models.VoiceProviderElevenLabs:
		return s.elevenLabs(ctx, provider.APIKey, req)
	case models.VoiceProviderQwenTTS:
		return s.qwenTTS(ctx, provider.APIKey, req)
	case models.VoiceProviderOpenAITTS:
		return s.openAITTS(ctx, provider.APIKey, req)
	default:
		return nil, "", fmt.Errorf("provider de voz não suportado: %s", provider.Provider)
	}
}

// ListVoices busca a lista de vozes disponíveis no provider.
func (s *TTSService) ListVoices(ctx context.Context, provider *models.VoiceProvider) ([]models.WorkspaceVoice, error) {
	switch provider.Provider {
	case models.VoiceProviderElevenLabs:
		return s.elevenLabsListVoices(ctx, provider)
	case models.VoiceProviderQwenTTS:
		return s.qwenListVoices(ctx, provider)
	case models.VoiceProviderOpenAITTS:
		return s.openAIListVoices(ctx, provider)
	default:
		return nil, fmt.Errorf("provider não suportado: %s", provider.Provider)
	}
}

// ─── ElevenLabs ──────────────────────────────────────────────────────────────

func (s *TTSService) elevenLabs(ctx context.Context, apiKey string, req TTSRequest) ([]byte, string, error) {
	if req.VoiceID == "" {
		req.VoiceID = "21m00Tcm4TlvDq8ikWAM" // Rachel — voz padrão ElevenLabs
	}

	body := map[string]interface{}{
		"text":     req.Text,
		"model_id": "eleven_multilingual_v2",
		"voice_settings": map[string]interface{}{
			"stability":         req.Stability,
			"similarity_boost":  req.Similarity,
			"style":             req.Style,
			"use_speaker_boost": true,
		},
	}
	if req.Speed != 0 && req.Speed != 1 {
		body["speed"] = req.Speed
	}

	b, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.elevenlabs.io/v1/text-to-speech/"+req.VoiceID,
		bytes.NewReader(b),
	)
	if err != nil {
		return nil, "", err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("xi-api-key", apiKey)
	httpReq.Header.Set("Accept", "audio/mpeg")

	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(httpReq)
	if err != nil {
		return nil, "", fmt.Errorf("elevenlabs: %w", err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("elevenlabs retornou %d: %s", resp.StatusCode, truncate(string(data), 300))
	}
	return data, "audio/mpeg", nil
}

func (s *TTSService) elevenLabsListVoices(ctx context.Context, provider *models.VoiceProvider) ([]models.WorkspaceVoice, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.elevenlabs.io/v1/voices", nil)
	req.Header.Set("xi-api-key", provider.APIKey)

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("elevenlabs %d: %s", resp.StatusCode, truncate(string(b), 300))
	}

	var result struct {
		Voices []struct {
			VoiceID    string `json:"voice_id"`
			Name       string `json:"name"`
			Category   string `json:"category"`
			PreviewURL string `json:"preview_url"`
			Labels     struct {
				Language string `json:"language"`
				Gender   string `json:"gender"`
				UseCase  string `json:"use_case"`
			} `json:"labels"`
			Description string `json:"description"`
		} `json:"voices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	voices := make([]models.WorkspaceVoice, 0, len(result.Voices))
	for _, v := range result.Voices {
		providerID := provider.ID
		cat := v.Category
		if cat == "" {
			cat = "preset"
		}
		voices = append(voices, models.WorkspaceVoice{
			WorkspaceID:     provider.WorkspaceID,
			VoiceProviderID: &providerID,
			Source:          "workspace_provider",
			ExternalID:      v.VoiceID,
			Name:            v.Name,
			PreviewURL:      v.PreviewURL,
			Category:        cat,
			Language:        v.Labels.Language,
			Gender:          v.Labels.Gender,
			Description:     v.Description,
			IsActive:        true,
		})
	}
	return voices, nil
}

// ─── Qwen TTS (CosyVoice via DashScope) ─────────────────────────────────────

var qwenPresetVoices = []struct{ id, name, lang, gender string }{
	{"longxiaochun", "Long Xiaochun", "zh-CN", "male"},
	{"longxiaoxia", "Long Xiaoxia", "zh-CN", "female"},
	{"longmiao", "Long Miao", "zh-CN", "female"},
	{"longfei", "Long Fei", "zh-CN", "male"},
	{"longyue", "Long Yue", "zh-CN", "female"},
	{"loongstella", "Loong Stella", "en-US", "female"},
	{"longshu", "Long Shu", "zh-CN", "female"},
	{"longcheng", "Long Cheng", "zh-CN", "male"},
}

func (s *TTSService) qwenTTS(ctx context.Context, apiKey string, req TTSRequest) ([]byte, string, error) {
	if req.VoiceID == "" {
		req.VoiceID = "longxiaoxia"
	}

	body := map[string]interface{}{
		"model": "cosyvoice-v1",
		"input": map[string]interface{}{
			"text":  req.Text,
			"voice": req.VoiceID,
		},
		"parameters": map[string]interface{}{
			"format": "mp3",
			"rate":   int(req.Speed * 100),
			"volume": 100,
			"pitch":  0,
		},
	}

	b, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/generation",
		bytes.NewReader(b),
	)
	if err != nil {
		return nil, "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-DashScope-Async", "disable")

	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(httpReq)
	if err != nil {
		return nil, "", fmt.Errorf("qwen tts: %w", err)
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "audio/") {
		data, _ := io.ReadAll(resp.Body)
		if resp.StatusCode >= 300 {
			return nil, "", fmt.Errorf("qwen tts retornou %d", resp.StatusCode)
		}
		return data, "audio/mpeg", nil
	}

	// Resposta JSON com URL
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("qwen tts retornou %d: %s", resp.StatusCode, truncate(string(raw), 300))
	}

	var result struct {
		Output struct {
			AudioURL string `json:"audio_url"`
		} `json:"output"`
	}
	if err := json.Unmarshal(raw, &result); err != nil || result.Output.AudioURL == "" {
		return nil, "", fmt.Errorf("qwen tts: resposta inesperada: %s", truncate(string(raw), 200))
	}

	// Baixar áudio da URL
	audioResp, err := http.Get(result.Output.AudioURL)
	if err != nil {
		return nil, "", fmt.Errorf("qwen tts: falha ao baixar áudio: %w", err)
	}
	defer audioResp.Body.Close()
	data, _ := io.ReadAll(audioResp.Body)
	return data, "audio/mpeg", nil
}

func (s *TTSService) qwenListVoices(ctx context.Context, provider *models.VoiceProvider) ([]models.WorkspaceVoice, error) {
	voices := make([]models.WorkspaceVoice, 0, len(qwenPresetVoices))
	for _, v := range qwenPresetVoices {
		providerID := provider.ID
		voices = append(voices, models.WorkspaceVoice{
			WorkspaceID:     provider.WorkspaceID,
			VoiceProviderID: &providerID,
			Source:          "workspace_provider",
			ExternalID:      v.id,
			Name:            v.name,
			Category:        "preset",
			Language:        v.lang,
			Gender:          v.gender,
			IsActive:        true,
		})
	}
	return voices, nil
}

// ─── OpenAI TTS ──────────────────────────────────────────────────────────────

var openAIVoices = []struct{ id, name, gender string }{
	{"alloy", "Alloy", "neutral"},
	{"echo", "Echo", "male"},
	{"fable", "Fable", "male"},
	{"onyx", "Onyx", "male"},
	{"nova", "Nova", "female"},
	{"shimmer", "Shimmer", "female"},
}

func (s *TTSService) openAITTS(ctx context.Context, apiKey string, req TTSRequest) ([]byte, string, error) {
	if req.VoiceID == "" {
		req.VoiceID = "nova"
	}
	speed := req.Speed
	if speed == 0 {
		speed = 1.0
	}

	body := map[string]interface{}{
		"model":  "tts-1",
		"input":  req.Text,
		"voice":  req.VoiceID,
		"speed":  speed,
		"format": "mp3",
	}

	b, _ := json.Marshal(body)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.openai.com/v1/audio/speech",
		bytes.NewReader(b),
	)
	if err != nil {
		return nil, "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := (&http.Client{Timeout: 60 * time.Second}).Do(httpReq)
	if err != nil {
		return nil, "", fmt.Errorf("openai tts: %w", err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("openai tts retornou %d: %s", resp.StatusCode, truncate(string(data), 300))
	}
	return data, "audio/mpeg", nil
}

func (s *TTSService) openAIListVoices(ctx context.Context, provider *models.VoiceProvider) ([]models.WorkspaceVoice, error) {
	voices := make([]models.WorkspaceVoice, 0, len(openAIVoices))
	for _, v := range openAIVoices {
		providerID := provider.ID
		voices = append(voices, models.WorkspaceVoice{
			WorkspaceID:     provider.WorkspaceID,
			VoiceProviderID: &providerID,
			Source:          "workspace_provider",
			ExternalID:      v.id,
			Name:            v.name,
			Category:        "preset",
			Language:        "multi",
			Gender:          v.gender,
			IsActive:        true,
		})
	}
	return voices, nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}

// ─── Provider connectivity test ────────────────────────────────────────────

// TestProvider valida que a API key do provider funciona — usado pra UX
// dar feedback imediato após salvar credenciais. Retorna nil se OK,
// erro com motivo se falhou (auth/network/etc).
func (s *TTSService) TestProvider(ctx context.Context, provider *models.VoiceProvider) error {
	switch provider.Provider {
	case models.VoiceProviderElevenLabs:
		// /v1/user devolve subscription info — endpoint barato e
		// que sempre exige auth válida.
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.elevenlabs.io/v1/user", nil)
		req.Header.Set("xi-api-key", provider.APIKey)
		resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
		if err != nil {
			return fmt.Errorf("falha de rede: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode == 401 || resp.StatusCode == 403 {
			return fmt.Errorf("api key inválida (HTTP %d)", resp.StatusCode)
		}
		if resp.StatusCode >= 300 {
			b, _ := io.ReadAll(resp.Body)
			return fmt.Errorf("provider retornou %d: %s", resp.StatusCode, truncate(string(b), 200))
		}
		return nil
	case models.VoiceProviderOpenAITTS:
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.openai.com/v1/models", nil)
		req.Header.Set("Authorization", "Bearer "+provider.APIKey)
		resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
		if err != nil {
			return fmt.Errorf("falha de rede: %w", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 300 {
			return fmt.Errorf("openai retornou %d", resp.StatusCode)
		}
		return nil
	case models.VoiceProviderQwenTTS:
		// DashScope não tem health endpoint barato; faz uma síntese curta.
		_, _, err := s.qwenTTS(ctx, provider.APIKey, TTSRequest{Text: "ok", VoiceID: "longxiaoxia", Speed: 1})
		return err
	}
	return fmt.Errorf("provider não suportado: %s", provider.Provider)
}

// ─── ElevenLabs: usage / subscription / clone / delete ─────────────────────

// ElevenLabsUsage representa info da subscription do usuário no ElevenLabs.
type ElevenLabsUsage struct {
	Tier               string `json:"tier"`
	CharacterCount     int    `json:"character_count"`
	CharacterLimit     int    `json:"character_limit"`
	VoiceLimit         int    `json:"voice_limit"`
	ProfessionalVoices int    `json:"professional_voice_limit"`
	NextResetAt        int64  `json:"next_character_count_reset_unix"`
	CanCloneVoice      bool   `json:"can_extend_voice_limit"`
}

// GetElevenLabsUsage devolve consumo/limite — útil pra UI mostrar
// "X / Y caracteres usados este mês" e bloquear clonagem se o tier
// não permitir.
func (s *TTSService) GetElevenLabsUsage(ctx context.Context, apiKey string) (*ElevenLabsUsage, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.elevenlabs.io/v1/user/subscription", nil)
	req.Header.Set("xi-api-key", apiKey)
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("elevenlabs %d: %s", resp.StatusCode, truncate(string(b), 200))
	}
	var u ElevenLabsUsage
	if err := json.NewDecoder(resp.Body).Decode(&u); err != nil {
		return nil, err
	}
	return &u, nil
}

// CloneVoiceInput agrupa os argumentos da clonagem (Instant Voice
// Cloning do ElevenLabs).
type CloneVoiceInput struct {
	Name        string
	Description string
	// Samples — pelo menos 1 arquivo de áudio (mp3/wav/m4a/ogg) até 10MB
	// cada. ElevenLabs recomenda 1-2min total de áudio limpo.
	Samples []CloneVoiceSample
	Labels  map[string]string
}

type CloneVoiceSample struct {
	Filename string
	Data     []byte
}

// CloneElevenLabsVoice cria uma nova voz no ElevenLabs via Instant
// Voice Cloning (POST /v1/voices/add) e devolve o voice_id resultante,
// pronto pra ser persistido como WorkspaceVoice category=clone.
//
// Tier free do ElevenLabs não permite clone — retorna erro 403 com
// mensagem clara nesse caso.
func (s *TTSService) CloneElevenLabsVoice(ctx context.Context, apiKey string, in CloneVoiceInput) (string, string, error) {
	if len(in.Samples) == 0 {
		return "", "", fmt.Errorf("pelo menos 1 sample de áudio é obrigatório")
	}
	if strings.TrimSpace(in.Name) == "" {
		return "", "", fmt.Errorf("name obrigatório")
	}

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	_ = w.WriteField("name", in.Name)
	if in.Description != "" {
		_ = w.WriteField("description", in.Description)
	}
	if len(in.Labels) > 0 {
		if b, err := json.Marshal(in.Labels); err == nil {
			_ = w.WriteField("labels", string(b))
		}
	}
	for _, sample := range in.Samples {
		fw, err := w.CreateFormFile("files", sample.Filename)
		if err != nil {
			return "", "", err
		}
		if _, err := fw.Write(sample.Data); err != nil {
			return "", "", err
		}
	}
	w.Close()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://api.elevenlabs.io/v1/voices/add", &buf)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("xi-api-key", apiKey)
	req.Header.Set("Content-Type", w.FormDataContentType())

	resp, err := (&http.Client{Timeout: 120 * time.Second}).Do(req)
	if err != nil {
		return "", "", fmt.Errorf("elevenlabs clone: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("elevenlabs clone %d: %s", resp.StatusCode, truncate(string(body), 400))
	}
	var result struct {
		VoiceID string `json:"voice_id"`
		Name    string `json:"name"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", fmt.Errorf("elevenlabs clone: resposta inválida: %s", truncate(string(body), 200))
	}
	return result.VoiceID, result.Name, nil
}

// DeleteElevenLabsVoice remove a voz do ElevenLabs (irreversível).
// Useful quando o user remove uma voz clonada do workspace — sem isso
// o slot continuaria contado contra o tier.
func (s *TTSService) DeleteElevenLabsVoice(ctx context.Context, apiKey, voiceID string) error {
	req, _ := http.NewRequestWithContext(ctx, http.MethodDelete,
		"https://api.elevenlabs.io/v1/voices/"+voiceID, nil)
	req.Header.Set("xi-api-key", apiKey)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 && resp.StatusCode != 404 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("elevenlabs delete %d: %s", resp.StatusCode, truncate(string(b), 200))
	}
	return nil
}
