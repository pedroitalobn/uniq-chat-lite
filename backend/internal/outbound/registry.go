// Package outbound provides a unified, channel-agnostic entry point for
// sending messages from a Conversation. The ConversationHandler calls
// Registry.Send which dispatches to the right adapter (WhatsApp, WABA,
// Instagram, TikTok) based on the Instance's channel.
//
// Adapters do NOT persist MessageLog — that is the caller's responsibility.
// Adapters only deliver and return (external_id, error).
package outbound

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// OutboundMessage is the channel-agnostic shape for a message to send.
type OutboundMessage struct {
	To        string // channel_key (JID, username, ...)
	Type      string // text | image | audio | video | document | location | template | interactive
	Body      string
	MediaURL  string
	MediaMime string
	Caption   string
}

// SendResult is what every adapter returns on success.
type SendResult struct {
	ExternalID string
	Status     models.MessageStatus
}

// ErrChannelNotSupported is returned when no adapter claims the channel.
var ErrChannelNotSupported = errors.New("outbound: no adapter for channel")

// Registry routes outbound messages to the right adapter.
type Registry struct {
	db        *gorm.DB
	waManager *whatsapp.Manager
	igSvc     *services.InstagramService
	tkSvc     *services.TaktikService
	http      *http.Client
}

// NewRegistry builds the registry with the dependencies each adapter needs.
// Adapters are chosen at call-time by models.Instance.Channel.
func NewRegistry(db *gorm.DB, waManager *whatsapp.Manager, igSvc *services.InstagramService, tkSvc *services.TaktikService) *Registry {
	return &Registry{
		db:        db,
		waManager: waManager,
		igSvc:     igSvc,
		tkSvc:     tkSvc,
		http:      &http.Client{Timeout: 15 * time.Second},
	}
}

// Send delivers the message via the appropriate channel.
// Returns a status "sent" on success and "failed" on any adapter error.
func (r *Registry) Send(ctx context.Context, inst *models.Instance, msg OutboundMessage) (*SendResult, error) {
	switch inst.Channel {
	case models.ChannelWhatsApp:
		return r.sendWhatsApp(inst, msg)
	case models.ChannelWABA:
		return r.sendWABA(ctx, inst, msg)
	case models.ChannelInstagram:
		return r.sendInstagram(ctx, inst, msg)
	case models.ChannelTikTok:
		return r.sendTikTok(ctx, inst, msg)
	}
	return nil, ErrChannelNotSupported
}

// WindowOpen returns whether the 24h customer-service window is currently
// open for this channel. WhatsApp non-official is always open; WABA/IG are
// time-limited unless a template is used.
func (r *Registry) WindowOpen(inst *models.Instance, lastCustomerMsgAt *time.Time) bool {
	switch inst.Channel {
	case models.ChannelWhatsApp, models.ChannelTikTok:
		return true
	case models.ChannelWABA, models.ChannelInstagram:
		if lastCustomerMsgAt == nil {
			return false
		}
		return time.Since(*lastCustomerMsgAt) < 24*time.Hour
	}
	return true
}

// -- WhatsApp (whatsmeow) ---------------------------------------------------

func (r *Registry) sendWhatsApp(inst *models.Instance, msg OutboundMessage) (*SendResult, error) {
	if r.waManager == nil {
		return nil, errors.New("whatsapp manager unavailable")
	}
	client := r.waManager.GetInstance(inst.ID.String())
	if client == nil || !client.IsConnected() {
		return nil, errors.New("instância desconectada")
	}
	switch msg.Type {
	case "", "text":
		id, err := client.SendTextMessage(msg.To, msg.Body)
		if err != nil {
			return nil, err
		}
		return &SendResult{ExternalID: id, Status: models.MessageStatusSent}, nil
	}
	// Fallback for types not wired up on this path: send as text.
	id, err := client.SendTextMessage(msg.To, msg.Body)
	if err != nil {
		return nil, err
	}
	return &SendResult{ExternalID: id, Status: models.MessageStatusSent}, nil
}

// -- WABA (Meta Graph API) -------------------------------------------------

func (r *Registry) sendWABA(ctx context.Context, inst *models.Instance, msg OutboundMessage) (*SendResult, error) {
	var waba models.WABAInstance
	if err := r.db.WithContext(ctx).Where("instance_id = ?", inst.ID).First(&waba).Error; err != nil {
		return nil, fmt.Errorf("waba instance config not found: %w", err)
	}
	msgType := msg.Type
	if msgType == "" {
		msgType = "text"
	}
	payload := map[string]any{
		"messaging_product": "whatsapp",
		"to":                msg.To,
		"type":              msgType,
	}
	if msgType == "text" {
		payload["text"] = map[string]string{"body": msg.Body}
	}
	body, _ := json.Marshal(payload)

	url := fmt.Sprintf("https://graph.facebook.com/v18.0/%s/messages", waba.PhoneNumberID)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+waba.AccessToken)

	resp, err := r.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("meta api error %d: %s", resp.StatusCode, string(b))
	}
	var meta struct {
		Messages []struct {
			ID string `json:"id"`
		} `json:"messages"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&meta)
	ext := ""
	if len(meta.Messages) > 0 {
		ext = meta.Messages[0].ID
	}
	return &SendResult{ExternalID: ext, Status: models.MessageStatusSent}, nil
}

// -- Instagram (private API via InstagramService) --------------------------

func (r *Registry) sendInstagram(ctx context.Context, inst *models.Instance, msg OutboundMessage) (*SendResult, error) {
	if r.igSvc == nil {
		return nil, errors.New("instagram service unavailable")
	}
	// Use the private-API path by default; graph_api accounts are handled by
	// the same SendDM which branches internally.
	resp, err := r.igSvc.SendDM(ctx, inst.ID.String(), msg.To, msg.Body)
	if err != nil {
		return nil, err
	}
	ext := ""
	if resp != nil && resp.MessageID != 0 {
		ext = fmt.Sprintf("%d", resp.MessageID)
	}
	return &SendResult{ExternalID: ext, Status: models.MessageStatusSent}, nil
}

// -- TikTok (Taktik bridge) ------------------------------------------------

func (r *Registry) sendTikTok(_ context.Context, inst *models.Instance, msg OutboundMessage) (*SendResult, error) {
	if r.tkSvc == nil {
		return nil, errors.New("tiktok service unavailable")
	}
	// The Taktik service keys by username; we read it from a TikTokAccount row
	// linked to this Instance (by slug or username).
	var acct models.TikTokAccount
	if err := r.db.Where("user_id = ? AND username <> ''", inst.UserID).First(&acct).Error; err != nil {
		return nil, errors.New("tiktok account not linked to instance")
	}
	_, err := r.tkSvc.TikTokSendDM(acct.Username, msg.To, msg.Body)
	if err != nil {
		return nil, err
	}
	return &SendResult{Status: models.MessageStatusSent}, nil
}
