package services

import (
	"context"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/uniq-chat/backend/internal/models"
)

// recordLLMUsageEstimate — atalho pros call sites do LLMService.
// Estima tokens via chars/4 e grava 1 evento ai.tokens via UsageRecorder
// global. Idempotente em relação a falhas (no-op se recorder não setado).
//
// Estimativa é grosseira mas suficiente pra Phase 1 — refinar quando
// LLMService for refatorado pra devolver Usage real do provider.
//
// Layout do Resource: "<provider>:<model>" pra ComputeCredits resolver
// preço via LLMCostMatrix da PricingConfig.
func recordLLMUsageEstimate(ctx context.Context, db *gorm.DB, instanceID uuid.UUID, integ *models.UserIntegration, fullPrompt, reply string) {
	rec := GetGlobalUsageRecorder()
	if rec == nil {
		return
	}
	// Resolve user/workspace via instance (cache-friendly: 1 SELECT).
	var inst models.Instance
	if err := db.WithContext(ctx).
		Select("user_id, workspace_id").
		First(&inst, "id = ?", instanceID).Error; err != nil {
		return
	}

	// Estimativa: ~4 chars / token pra português. Levemente conservadora
	// pra inputs com markdown/JSON (mais densos).
	inTokens := int64(len(fullPrompt)) / 4
	outTokens := int64(len(reply)) / 4
	if inTokens == 0 {
		inTokens = 1
	}
	if outTokens == 0 {
		outTokens = 1
	}

	model := ""
	provider := ""
	if integ != nil {
		provider = string(integ.Provider)
		model = integ.GetFirstModel()
	}
	resource := provider
	if model != "" {
		resource = provider + ":" + model
	}

	rec.Record(ctx, RecordRequest{
		UserID:       inst.UserID,
		WorkspaceID:  inst.WorkspaceID,
		EventType:    models.EventAITokens,
		Quantity:     inTokens + outTokens,
		Resource:     resource,
		InputTokens:  inTokens,
		OutputTokens: outTokens,
		Metadata: map[string]any{
			"instance_id": instanceID.String(),
			"estimated":   true,
		},
	})
}

// recordTTSUsage — chamado após Synthesize bem-sucedida no agent_runtime.
// Grava 1 evento voice.tts_chars com chars sintetizados.
func recordTTSUsage(ctx context.Context, db *gorm.DB, instanceID uuid.UUID, providerName, voiceID, text string) {
	rec := GetGlobalUsageRecorder()
	if rec == nil {
		return
	}
	var inst models.Instance
	if err := db.WithContext(ctx).
		Select("user_id, workspace_id").
		First(&inst, "id = ?", instanceID).Error; err != nil {
		return
	}
	chars := int64(len(text))
	if chars == 0 {
		return
	}
	resource := providerName
	if voiceID != "" {
		resource = providerName + ":" + voiceID
	}
	rec.Record(ctx, RecordRequest{
		UserID:      inst.UserID,
		WorkspaceID: inst.WorkspaceID,
		EventType:   models.EventVoiceTTSChars,
		Quantity:    chars,
		Resource:    resource,
	})
}

// recordSTTUsage — chamado após Transcribe bem-sucedida (transcrição de
// áudios do inbox). Categoria voice (mesmo bucket de TTS).
func recordSTTUsage(ctx context.Context, db *gorm.DB, instanceID uuid.UUID, providerName string, audioSeconds int64) {
	rec := GetGlobalUsageRecorder()
	if rec == nil {
		return
	}
	var inst models.Instance
	if err := db.WithContext(ctx).
		Select("user_id, workspace_id").
		First(&inst, "id = ?", instanceID).Error; err != nil {
		return
	}
	if audioSeconds <= 0 {
		audioSeconds = 1
	}
	rec.Record(ctx, RecordRequest{
		UserID:      inst.UserID,
		WorkspaceID: inst.WorkspaceID,
		EventType:   models.EventVoiceSTTSeconds,
		Quantity:    audioSeconds,
		Resource:    providerName,
	})
}

// recordMessageOutbound — chamado após mensagem enviada com sucesso.
// channelType ∈ {whatsapp_qr, waba_utility, waba_marketing, ...}
// (precisa bater com strings em rawCostMicros pra resolver preço certo).
func recordMessageOutbound(ctx context.Context, userID uuid.UUID, workspaceID *uuid.UUID, channelKind string) {
	rec := GetGlobalUsageRecorder()
	if rec == nil {
		return
	}
	rec.Record(ctx, RecordRequest{
		UserID:      userID,
		WorkspaceID: workspaceID,
		EventType:   models.EventMessageOutbound,
		Quantity:    1,
		Resource:    channelKind,
	})
}
