package services

// WindowKeeperService monitors WABA conversations that have window_keeper_enabled=true
// and automatically sends a pre-programmed message when the 24h window is about to close
// (between 20h and 23h30m after the last customer message), keeping the conversation
// active while the agent is still engaged.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)


const (
	windowKeeperInterval = 20 * time.Minute
	windowTriggerAfter   = 20 * time.Hour   // send keeper if window opened > 20h ago
	windowExpiresBefore  = 23*time.Hour + 30*time.Minute // but not after 23h30 (too late)
	defaultKeeperMsg     = "Olá! Só passando para confirmar que ainda estamos à disposição 😊 Pode responder quando quiser."
)

type windowPipelineIface interface {
	ProcessSavedOutbound(ctx context.Context, ml *models.MessageLog) error
}

type WindowKeeperService struct {
	db       *gorm.DB
	pipeline windowPipelineIface
}

func NewWindowKeeperService(db *gorm.DB, pipeline windowPipelineIface) *WindowKeeperService {
	return &WindowKeeperService{db: db, pipeline: pipeline}
}

func (s *WindowKeeperService) Start(ctx context.Context) {
	ticker := time.NewTicker(windowKeeperInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *WindowKeeperService) tick(ctx context.Context) {
	cutoffStart := time.Now().Add(-windowExpiresBefore)
	cutoffEnd := time.Now().Add(-windowTriggerAfter)

	// Find WABA conversations with window keeper enabled and last customer message
	// in the trigger window (between 20h and 23h30m ago).
	var convs []models.Conversation
	if err := s.db.WithContext(ctx).
		Where("window_keeper_enabled = ? AND channel_type = ?", true, "waba").
		Where("last_customer_msg_at BETWEEN ? AND ?", cutoffStart, cutoffEnd).
		Where("status IN ?", []models.ConversationStatus{
			models.ConversationStatusOpen,
			models.ConversationStatusPending,
		}).
		Find(&convs).Error; err != nil {
		log.Warn().Err(err).Msg("window-keeper: query failed")
		return
	}

	for _, conv := range convs {
		// Don't send if we've already sent a keeper message recently
		// (check if last_agent_msg_at is after the trigger start)
		if conv.LastAgentMsgAt != nil && conv.LastAgentMsgAt.After(cutoffEnd) {
			continue
		}
		s.sendKeeperMessage(ctx, conv)
	}
}

func (s *WindowKeeperService) sendKeeperMessage(ctx context.Context, conv models.Conversation) {
	msg := strings.TrimSpace(conv.WindowKeeperMessage)
	if msg == "" {
		msg = defaultKeeperMsg
	}

	// Load instance + WABA credentials
	var inst models.Instance
	if err := s.db.WithContext(ctx).First(&inst, "id = ?", conv.InstanceID).Error; err != nil {
		return
	}

	var waba models.WABAInstance
	if err := s.db.WithContext(ctx).Where("instance_id = ?", conv.InstanceID).First(&waba).Error; err != nil {
		log.Warn().Str("conv_id", conv.ID.String()).Msg("window-keeper: no WABA instance")
		return
	}

	payload := map[string]any{
		"messaging_product": "whatsapp",
		"to":                conv.ChannelKey,
		"type":              "text",
		"text":              map[string]string{"body": msg},
	}
	body, _ := json.Marshal(payload)

	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/messages", waba.PhoneNumberID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+waba.AccessToken)

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		log.Warn().Err(err).Str("conv_id", conv.ID.String()).Msg("window-keeper: HTTP failed")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Warn().Int("status", resp.StatusCode).Str("conv_id", conv.ID.String()).Msg("window-keeper: Meta rejected")
		return
	}

	// Parse wamid
	var metaResp struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	json.NewDecoder(resp.Body).Decode(&metaResp)
	wamid := ""
	if len(metaResp.Messages) > 0 {
		wamid = metaResp.Messages[0].ID
	}

	// Persist as MessageLog and wire into conversation
	contentJSON, _ := json.Marshal(msg)
	ws := conv.WorkspaceID
	convID := conv.ID
	ml := models.MessageLog{
		InstanceID:        conv.InstanceID,
		WorkspaceID:       &ws,
		ConversationID:    &convID,
		Direction:         models.DirectionOut,
		Type:              "text",
		ToJID:             conv.ChannelKey,
		Content:           string(contentJSON),
		Status:            models.MessageStatusSent,
		ExternalMessageID: wamid,
	}
	s.db.WithContext(ctx).Create(&ml)

	// Update denorm
	now := time.Now()
	s.db.WithContext(ctx).Model(&conv).Updates(map[string]any{
		"last_agent_msg_at":    now,
		"last_message_at":      now,
		"last_message_preview": "🔔 " + truncateStr(msg, 80),
		"last_message_type":    "text",
		"last_message_from_me": true,
	})

	if s.pipeline != nil {
		go func(m models.MessageLog) {
			_ = s.pipeline.ProcessSavedOutbound(context.Background(), &m) //nolint
		}(ml)
	}

	log.Info().Str("conv_id", conv.ID.String()).Str("to", conv.ChannelKey).Msg("window-keeper: mensagem enviada")
}

func truncateStr(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}
