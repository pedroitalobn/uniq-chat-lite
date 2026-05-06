// Package services — STTService transcreve áudio (voice notes do
// WhatsApp etc.) em texto usando o provider de IA configurado globalmente
// na Uniq AI (PlatformAI). Hoje suporta OpenAI Whisper; outros providers
// caem em ErrUnsupportedProvider — o caller marca a MessageLog com
// transcription_status="unsupported".
//
// Por que platform-ai e não user-integration: a transcrição precisa rodar
// pra QUALQUER áudio recebido, em QUALQUER conversa, sem depender do
// agent ter integration ativa. Usar a credencial global da plataforma
// é o único caminho que funciona pra todos os workspaces sem requerer
// configuração extra do user.
package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// ErrUnsupportedProvider — provider configurado não tem endpoint de STT
// implementado aqui. Caller deve gravar status="unsupported" e seguir.
var ErrUnsupportedProvider = errors.New("stt: provider não suportado pra transcrição de áudio")

// ErrNoPlatformAI — admin não configurou nenhuma PlatformAI ativa, então
// não há credencial pra chamar a API de transcrição.
var ErrNoPlatformAI = errors.New("stt: PlatformAI ativa não encontrada (admin precisa configurar em /admin/platform-ai)")

// STTService transcreve bytes de áudio em texto usando o provider global
// (PlatformAI singleton). Ele NÃO baixa o blob — caller passa os bytes
// já decodificados (pós-encriptação WhatsApp).
type STTService struct {
	db   *gorm.DB
	http *http.Client
}

func NewSTTService(db *gorm.DB) *STTService {
	return &STTService{
		db: db,
		// Whisper costuma processar em 5-15s pra áudios curtos; timeout
		// generoso pra cobrir voice notes de 1-2 min.
		http: &http.Client{Timeout: 90 * time.Second},
	}
}

// Transcribe transcreve `audio` no idioma `language` (BCP-47, ex: "pt", "en").
// Vazio = auto-detect. mime e filename são opcionais — Whisper inspeciona
// os bytes e o nome só ajuda quando não dá pra detectar pelo header.
func (s *STTService) Transcribe(ctx context.Context, audio []byte, mime, filename, language string) (string, error) {
	if len(audio) == 0 {
		return "", errors.New("stt: input vazio")
	}
	pai, err := s.activePlatformAI(ctx)
	if err != nil {
		return "", err
	}
	switch pai.Provider {
	case models.ProviderOpenAI:
		return s.openAIWhisper(ctx, pai, audio, mime, filename, language)
	default:
		return "", fmt.Errorf("%w: %s", ErrUnsupportedProvider, pai.Provider)
	}
}

func (s *STTService) activePlatformAI(ctx context.Context) (*models.PlatformAI, error) {
	var pai models.PlatformAI
	err := s.db.WithContext(ctx).
		Where("is_active = true AND api_key <> ''").
		Order("created_at ASC").
		First(&pai).Error
	if err != nil {
		return nil, ErrNoPlatformAI
	}
	return &pai, nil
}

// openAIWhisper chama POST /v1/audio/transcriptions (modelo whisper-1).
// O endpoint é multipart: field "file" com os bytes + "model" + opcional
// "language". Resposta JSON simples {"text": "..."}.
func (s *STTService) openAIWhisper(ctx context.Context, pai *models.PlatformAI, audio []byte, mime, filename, language string) (string, error) {
	baseURL := strings.TrimRight(pai.BaseURL, "/")
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	endpoint := baseURL + "/v1/audio/transcriptions"

	if filename == "" {
		filename = bestFilenameForMime(mime)
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return "", fmt.Errorf("stt: criar form file: %w", err)
	}
	if _, err := io.Copy(part, bytes.NewReader(audio)); err != nil {
		return "", fmt.Errorf("stt: copy audio: %w", err)
	}
	// Modelo: whisper-1 é o estável; gpt-4o-transcribe é o mais novo, mas
	// nem toda key tem acesso. whisper-1 é universal e custa menos.
	if err := writer.WriteField("model", "whisper-1"); err != nil {
		return "", err
	}
	// Resposta json simples — economiza tokens vs verbose_json.
	if err := writer.WriteField("response_format", "json"); err != nil {
		return "", err
	}
	if language != "" {
		if err := writer.WriteField("language", language); err != nil {
			return "", err
		}
	}
	if err := writer.Close(); err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+pai.APIKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := s.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("stt: request falhou: %w", err)
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		// Whisper devolve {"error":{"message":"..."}} em erro.
		var errEnv struct {
			Error struct {
				Message string `json:"message"`
				Type    string `json:"type"`
			} `json:"error"`
		}
		_ = json.Unmarshal(respBytes, &errEnv)
		msg := errEnv.Error.Message
		if msg == "" {
			msg = string(respBytes)
		}
		return "", fmt.Errorf("stt: HTTP %d — %s", resp.StatusCode, msg)
	}
	var ok struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(respBytes, &ok); err != nil {
		return "", fmt.Errorf("stt: parse resposta: %w", err)
	}
	return strings.TrimSpace(ok.Text), nil
}

// bestFilenameForMime escolhe um nome de arquivo com extensão coerente
// — Whisper inspeciona o magic byte mas o nome com extensão correta
// reduz erros de "invalid file format" raros.
func bestFilenameForMime(mime string) string {
	low := strings.ToLower(mime)
	switch {
	case strings.Contains(low, "ogg"), strings.Contains(low, "opus"):
		return "audio.ogg"
	case strings.Contains(low, "webm"):
		return "audio.webm"
	case strings.Contains(low, "mp4"), strings.Contains(low, "m4a"), strings.Contains(low, "aac"):
		return "audio.m4a"
	case strings.Contains(low, "mp3"), strings.Contains(low, "mpeg"):
		return "audio.mp3"
	case strings.Contains(low, "wav"):
		return "audio.wav"
	}
	return "audio.ogg"
}
