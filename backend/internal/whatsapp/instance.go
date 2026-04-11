package whatsapp

import (
	"context"
	"encoding/base64"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"
)

// InstanceSettings holds runtime behavior flags for an instance.
type InstanceSettings struct {
	AlwaysOnline bool
	RejectCalls  bool
	ReadMessages bool
	IgnoreGroups bool
	IgnoreStatus bool
}

// InstanceClient wraps a whatsmeow client with instance metadata.
type InstanceClient struct {
	ID         string
	client     *whatsmeow.Client
	container  *sqlstore.Container
	qrChan     chan string
	statusChan chan string
	manager    *Manager

	mu       sync.Mutex
	wsConns  []wsConn
	webhooks []webhookEntry
	settings InstanceSettings
}

type wsConn struct {
	send chan []byte
	done chan struct{}
}

type webhookEntry struct {
	Events        []string
	IgnoreGroups  bool
	IgnoreSelf    bool
	IgnoreAPISent bool
	// HTTP (primary)
	URL    string
	Secret string
	// RabbitMQ bridge
	RabbitMQEnabled bool
	AMQPURL         string
	Exchange        string
	RoutingKey      string
	// NATS bridge
	NATSEnabled bool
	NATSURL     string
	NATSSubject string
	NATSToken   string
	// WebSocket client bridge
	WSEnabled     bool
	WSClientURL   string
	WSClientToken string
}

// eventContext carries per-event filtering metadata.
type eventContext struct {
	isGroup  bool
	isFromMe bool
}

// NewInstanceClient creates a new WhatsApp client for the given instance.
func NewInstanceClient(instanceID, sessionDir string, proxyCfg *ProxyConfig, webhooks []webhookEntry, settings InstanceSettings) (*InstanceClient, error) {
	container, err := GetDeviceStore(sessionDir, instanceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get device store: %w", err)
	}

	deviceStore, err := container.GetFirstDevice(context.Background())
	if err != nil {
		return nil, fmt.Errorf("failed to get device: %w", err)
	}

	shortID := instanceID
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}
	logger := waLog.Stdout("Client-"+shortID, "WARN", true)

	// Configure full history sync - modify global DeviceProps before creating client
	// This requests up to 365 days of history from WhatsApp servers
	store.DeviceProps = &waCompanionReg.DeviceProps{
		Os:              proto.String("uniq-chat"),
		PlatformType:    waCompanionReg.DeviceProps_DESKTOP.Enum(),
		RequireFullSync: proto.Bool(true),
		HistorySyncConfig: &waCompanionReg.DeviceProps_HistorySyncConfig{
			FullSyncDaysLimit:   proto.Uint32(365),
			FullSyncSizeMbLimit: proto.Uint32(10240),
			StorageQuotaMb:      proto.Uint32(10240),
		},
	}

	waClient := whatsmeow.NewClient(deviceStore, logger)

	ic := &InstanceClient{
		ID:         instanceID,
		client:     waClient,
		container:  container,
		qrChan:     make(chan string, 10),
		statusChan: make(chan string, 10),
		webhooks:   webhooks,
		settings:   settings,
	}

	// Inject proxy
	if proxyCfg != nil && proxyCfg.Enabled {
		proxyStr := ProxyAddressString(proxyCfg)
		if proxyStr != "" {
			waClient.SetProxyAddress(proxyStr)
			log.Info().Str("instance", instanceID).Str("proxy_host", proxyCfg.Host).Msg("proxy configured")
		}
	}

	waClient.AddEventHandler(ic.handleEvent)
	return ic, nil
}

// Connect initiates the WhatsApp connection with QR code pairing.
func (ic *InstanceClient) Connect() error {
	if ic.client.Store.ID == nil {
		// Not registered yet — start QR pairing
		qrChan, err := ic.client.GetQRChannel(context.Background())
		if err != nil {
			return fmt.Errorf("failed to get QR channel: %w", err)
		}
		if err := ic.client.Connect(); err != nil {
			return fmt.Errorf("failed to connect: %w", err)
		}
		go func() {
			for evt := range qrChan {
				if evt.Event == "code" {
					select {
					case ic.qrChan <- evt.Code:
					default:
					}
					ic.broadcastWS("qr", map[string]string{"qr": evt.Code})
					ic.dispatchEvent("instance.qr", map[string]string{"qr": evt.Code}, eventContext{})
				}
			}
		}()
		return nil
	}

	if err := ic.client.Connect(); err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	return nil
}

// ConnectDirect connects to WhatsApp without starting the QR channel.
// Use this before calling RequestPairingCode.
func (ic *InstanceClient) ConnectDirect() error {
	if err := ic.client.Connect(); err != nil {
		return fmt.Errorf("failed to connect: %w", err)
	}
	return nil
}

// RequestPairingCode returns an 8-character linking code (e.g. "ABCD-1234").
// The client must be connected (ConnectDirect called) and not yet paired.
func (ic *InstanceClient) RequestPairingCode(phoneNumber string) (string, error) {
	if ic.client.Store.ID != nil {
		return "", fmt.Errorf("instância já está pareada")
	}
	if !ic.client.IsConnected() {
		return "", fmt.Errorf("aguardando conexão com o WhatsApp — tente novamente em instantes")
	}
	code, err := ic.client.PairPhone(context.Background(), phoneNumber, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		return "", fmt.Errorf("falha ao obter código de pareamento: %w", err)
	}
	return code, nil
}

// Disconnect gracefully disconnects the client.
func (ic *InstanceClient) Disconnect() {
	ic.client.Disconnect()
}

// IsConnected returns whether the client is currently connected.
func (ic *InstanceClient) IsConnected() bool {
	return ic.client.IsConnected()
}

// IsLoggedIn returns whether the session is authenticated.
func (ic *InstanceClient) IsLoggedIn() bool {
	return ic.client.IsLoggedIn()
}

// GetPhoneNumber returns the connected phone number in international format.
func (ic *InstanceClient) GetPhoneNumber() string {
	if ic.client.Store.ID == nil {
		return ""
	}
	return ic.client.Store.ID.User
}

// GetProfilePicture fetches the profile picture URL of the connected account.
func (ic *InstanceClient) GetProfilePicture() string {
	if ic.client.Store.ID == nil || !ic.client.IsConnected() {
		return ""
	}
	pic, err := ic.client.GetProfilePictureInfo(context.Background(), *ic.client.Store.ID, &whatsmeow.GetProfilePictureParams{Preview: true})
	if err != nil || pic == nil {
		return ""
	}
	return pic.URL
}

// GetContactProfilePicture fetches the profile picture URL for a contact JID.
func (ic *InstanceClient) GetContactProfilePicture(jidStr string) string {
	if !ic.client.IsConnected() {
		return ""
	}
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return ""
	}
	pic, err := ic.client.GetProfilePictureInfo(context.Background(), jid, &whatsmeow.GetProfilePictureParams{Preview: true})
	if err != nil || pic == nil {
		return ""
	}
	return pic.URL
}

// GetContactInfo fetches contact name from WhatsApp server.
func (ic *InstanceClient) GetContactInfo(jidStr string) (name string, pushName string) {
	if !ic.client.IsConnected() {
		return "", ""
	}
	jid, err := types.ParseJID(jidStr)
	if err != nil {
		return "", ""
	}
	// Get contact info from store
	contact, err := ic.client.Store.Contacts.GetContact(context.Background(), jid)
	if err == nil {
		pushName = contact.FullName
		if pushName == "" {
			pushName = contact.PushName
		}
	}
	return "", pushName
}

// GetQRChan returns the channel that emits QR code strings.
func (ic *InstanceClient) GetQRChan() <-chan string {
	return ic.qrChan
}

// GetStatusChan returns the channel for status updates.
func (ic *InstanceClient) GetStatusChan() <-chan string {
	return ic.statusChan
}

// normalizeJID converts a raw phone number to a WhatsApp JID.
// If the input already looks like a JID (contains @), it is returned unchanged.
func normalizeJID(input string) string {
	input = strings.TrimSpace(input)
	if strings.Contains(input, "@") {
		return input
	}
	// Strip any non-digit prefix characters (e.g. +)
	cleaned := strings.TrimLeft(input, "+")
	return cleaned + "@s.whatsapp.net"
}

// resolveRecipient resolves a phone-number JID to the canonical JID used by WhatsApp,
// and pre-populates the LID cache so SendMessage can resolve the LID without errors.
// This handles cases like Brazilian numbers with/without the 9th digit.
func (ic *InstanceClient) resolveRecipient(ctx context.Context, jid types.JID) types.JID {
	if jid.Server != types.DefaultUserServer {
		return jid // groups, LID JIDs etc — no resolution needed
	}
	// IsOnWhatsApp resolves the canonical JID (may differ due to number formatting)
	phone := "+" + jid.User
	resp, err := ic.client.IsOnWhatsApp(ctx, []string{phone})
	if err != nil || len(resp) == 0 || !resp[0].IsIn {
		return jid // can't resolve, use original
	}
	canonical := resp[0].JID
	if canonical.IsEmpty() {
		return jid
	}
	// Pre-fetch user info to populate the LID cache before SendMessage needs it
	_, _ = ic.client.GetUserInfo(ctx, []types.JID{canonical})
	return canonical
}

// sendMessage resolves the canonical JID/LID then calls SendMessage.
func (ic *InstanceClient) sendMessage(ctx context.Context, recipient types.JID, msg *waE2E.Message) (whatsmeow.SendResponse, error) {
	recipient = ic.resolveRecipient(ctx, recipient)
	return ic.client.SendMessage(ctx, recipient, msg)
}

func (ic *InstanceClient) SendTextMessage(to, text string) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	msg := &waE2E.Message{
		Conversation: proto.String(text),
	}

	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send message failed: %w", err)
	}
	return res.ID, nil
}

// SendImageMessage sends an image message with optional caption.
func (ic *InstanceClient) SendImageMessage(to string, imageData []byte, mimeType, caption string) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	upload, err := ic.client.Upload(context.Background(), imageData, whatsmeow.MediaImage)
	if err != nil {
		return "", fmt.Errorf("upload failed: %w", err)
	}

	msg := &waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mimeType),
			URL:           proto.String(upload.URL),
			DirectPath:    proto.String(upload.DirectPath),
			MediaKey:      upload.MediaKey,
			FileEncSHA256: upload.FileEncSHA256,
			FileSHA256:    upload.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(imageData))),
		},
	}

	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send image failed: %w", err)
	}
	return res.ID, nil
}

// SendDocumentMessage sends a document file.
func (ic *InstanceClient) SendDocumentMessage(to string, docData []byte, mimeType, filename string) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	upload, err := ic.client.Upload(context.Background(), docData, whatsmeow.MediaDocument)
	if err != nil {
		return "", fmt.Errorf("upload failed: %w", err)
	}

	msg := &waE2E.Message{
		DocumentMessage: &waE2E.DocumentMessage{
			URL:           proto.String(upload.URL),
			DirectPath:    proto.String(upload.DirectPath),
			Mimetype:      proto.String(mimeType),
			FileName:      proto.String(filename),
			MediaKey:      upload.MediaKey,
			FileEncSHA256: upload.FileEncSHA256,
			FileSHA256:    upload.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(docData))),
		},
	}

	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send document failed: %w", err)
	}
	return res.ID, nil
}

// SendAudioMessage sends an audio file.
func (ic *InstanceClient) SendAudioMessage(to string, audioData []byte, mimeType string, ptt bool) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	upload, err := ic.client.Upload(context.Background(), audioData, whatsmeow.MediaAudio)
	if err != nil {
		return "", fmt.Errorf("upload failed: %w", err)
	}

	msg := &waE2E.Message{
		AudioMessage: &waE2E.AudioMessage{
			URL:           proto.String(upload.URL),
			DirectPath:    proto.String(upload.DirectPath),
			Mimetype:      proto.String(mimeType),
			MediaKey:      upload.MediaKey,
			FileEncSHA256: upload.FileEncSHA256,
			FileSHA256:    upload.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(audioData))),
			PTT:           proto.Bool(ptt),
		},
	}

	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send audio failed: %w", err)
	}
	return res.ID, nil
}

// SendLocationMessage sends a GPS location.
func (ic *InstanceClient) SendLocationMessage(to string, lat, lon float64, name string) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	msg := &waE2E.Message{
		LocationMessage: &waE2E.LocationMessage{
			DegreesLatitude:  proto.Float64(lat),
			DegreesLongitude: proto.Float64(lon),
			Name:             proto.String(name),
		},
	}

	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send location failed: %w", err)
	}
	return res.ID, nil
}

// SendReaction sends a reaction emoji to a specific message.
func (ic *InstanceClient) SendReaction(to, msgID, senderJID, reaction string) (string, error) {
	jidStr := normalizeJID(to)
	recipient, err := types.ParseJID(jidStr)
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	senderParsed, err := types.ParseJID(normalizeJID(senderJID))
	if err != nil {
		return "", fmt.Errorf("invalid sender JID: %w", err)
	}

	fromMe := ic.client.Store.ID != nil && senderParsed.User == ic.client.Store.ID.User

	msg := &waE2E.Message{
		ReactionMessage: &waE2E.ReactionMessage{
			Key: &waCommon.MessageKey{
				RemoteJID: proto.String(jidStr),
				FromMe:    proto.Bool(fromMe),
				ID:        proto.String(msgID),
			},
			Text:              proto.String(reaction),
			SenderTimestampMS: proto.Int64(time.Now().UnixMilli()),
		},
	}

	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send reaction failed: %w", err)
	}
	return res.ID, nil
}

// RevokeMessage revokes/deletes a previously sent message for everyone.
func (ic *InstanceClient) RevokeMessage(chatJID, msgID, senderJID string) (string, error) {
	chat, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return "", fmt.Errorf("invalid chat JID: %w", err)
	}
	var sender types.JID
	if senderJID != "" {
		sender, err = types.ParseJID(normalizeJID(senderJID))
		if err != nil {
			return "", fmt.Errorf("invalid sender JID: %w", err)
		}
	} else if ic.client.Store.ID != nil {
		sender = *ic.client.Store.ID
	}
	revoke := ic.client.BuildRevoke(chat, sender, msgID)
	res, err := ic.sendMessage(context.Background(), chat, revoke)
	if err != nil {
		return "", fmt.Errorf("revoke failed: %w", err)
	}
	return res.ID, nil
}

// SendTyping sends a chat presence (typing indicator) to a chat.
func (ic *InstanceClient) SendTyping(chatJID string, isTyping bool) error {
	jid, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	state := types.ChatPresenceComposing
	if !isTyping {
		state = types.ChatPresencePaused
	}
	return ic.client.SendChatPresence(context.Background(), jid, state, types.ChatPresenceMediaText)
}

// MarkChatRead marks a list of messages in a chat as read.
func (ic *InstanceClient) MarkChatRead(chatJID string, msgIDs []string) error {
	jid, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.MarkRead(context.Background(), msgIDs, time.Now(), jid, jid)
}

// BulkCheckNumbers checks multiple phone numbers on WhatsApp at once.
func (ic *InstanceClient) BulkCheckNumbers(phones []string) ([]map[string]interface{}, error) {
	resp, err := ic.client.IsOnWhatsApp(context.Background(), phones)
	if err != nil {
		return nil, fmt.Errorf("bulk check failed: %w", err)
	}
	results := make([]map[string]interface{}, 0, len(resp))
	for _, r := range resp {
		item := map[string]interface{}{
			"phone":  r.Query,
			"exists": r.IsIn,
			"jid":    "",
		}
		if r.IsIn {
			item["jid"] = r.JID.String()
		}
		results = append(results, item)
	}
	return results, nil
}

// ── Group management ─────────────────────────────────────────────────────────

// CreateGroup creates a new WhatsApp group and returns its JID.
func (ic *InstanceClient) CreateGroup(name string, participants []string) (map[string]interface{}, error) {
	var pJIDs []types.JID
	for _, p := range participants {
		jid, err := types.ParseJID(normalizeJID(p))
		if err != nil {
			continue
		}
		pJIDs = append(pJIDs, jid)
	}
	req := whatsmeow.ReqCreateGroup{
		Name:         name,
		Participants: pJIDs,
	}
	info, err := ic.client.CreateGroup(context.Background(), req)
	if err != nil {
		return nil, fmt.Errorf("create group failed: %w", err)
	}
	return map[string]interface{}{
		"jid":  info.JID.String(),
		"name": info.Name,
	}, nil
}

// GetGroupInfo returns metadata of a group by JID.
func (ic *InstanceClient) GetGroupInfo(groupJID string) (map[string]interface{}, error) {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return nil, fmt.Errorf("invalid group JID: %w", err)
	}
	info, err := ic.client.GetGroupInfo(context.Background(), jid)
	if err != nil {
		return nil, fmt.Errorf("get group info failed: %w", err)
	}
	participants := make([]map[string]interface{}, len(info.Participants))
	for i, p := range info.Participants {
		participants[i] = map[string]interface{}{
			"jid":           p.JID.String(),
			"is_admin":      p.IsAdmin,
			"is_superadmin": p.IsSuperAdmin,
		}
	}
	return map[string]interface{}{
		"jid":          info.JID.String(),
		"name":         info.Name,
		"description":  info.Topic,
		"created_at":   info.GroupCreated,
		"participants": participants,
		"is_announce":  info.IsAnnounce,
		"is_locked":    info.IsLocked,
	}, nil
}

// GetJoinedGroups returns all groups the connected number is part of.
func (ic *InstanceClient) GetJoinedGroups() ([]map[string]interface{}, error) {
	groups, err := ic.client.GetJoinedGroups(context.Background())
	if err != nil {
		return nil, fmt.Errorf("get joined groups failed: %w", err)
	}
	ownUser := ""
	if ic.client.Store.ID != nil {
		ownUser = ic.client.Store.ID.User
	}
	result := make([]map[string]interface{}, 0, len(groups))
	for _, g := range groups {
		isAdmin := false
		for _, p := range g.Participants {
			if p.JID.User == ownUser && (p.IsAdmin || p.IsSuperAdmin) {
				isAdmin = true
				break
			}
		}
		result = append(result, map[string]interface{}{
			"jid":               g.JID.String(),
			"name":              g.Name,
			"description":       g.Topic,
			"participant_count": len(g.Participants),
			"is_announce":       g.IsAnnounce,
			"is_locked":         g.IsLocked,
			"is_admin":          isAdmin,
		})
	}
	return result, nil
}

// UpdateGroupName changes the name of a group.
func (ic *InstanceClient) UpdateGroupName(groupJID, name string) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return fmt.Errorf("invalid group JID: %w", err)
	}
	return ic.client.SetGroupName(context.Background(), jid, name)
}

// UpdateGroupDescription changes the description/topic of a group.
func (ic *InstanceClient) UpdateGroupDescription(groupJID, description string) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return fmt.Errorf("invalid group JID: %w", err)
	}
	info, err := ic.client.GetGroupInfo(context.Background(), jid)
	if err != nil {
		return fmt.Errorf("failed to get group info: %w", err)
	}
	return ic.client.SetGroupTopic(context.Background(), jid, info.TopicID, "", description)
}

// UpdateGroupParticipants adds, removes, promotes, or demotes participants.
// action: "add" | "remove" | "promote" | "demote"
func (ic *InstanceClient) UpdateGroupParticipants(groupJID, action string, participants []string) ([]map[string]interface{}, error) {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return nil, fmt.Errorf("invalid group JID: %w", err)
	}
	var pJIDs []types.JID
	for _, p := range participants {
		pjid, err := types.ParseJID(normalizeJID(p))
		if err != nil {
			continue
		}
		pJIDs = append(pJIDs, pjid)
	}
	var wAction whatsmeow.ParticipantChange
	switch action {
	case "add":
		wAction = whatsmeow.ParticipantChangeAdd
	case "remove":
		wAction = whatsmeow.ParticipantChangeRemove
	case "promote":
		wAction = whatsmeow.ParticipantChangePromote
	case "demote":
		wAction = whatsmeow.ParticipantChangeDemote
	default:
		return nil, fmt.Errorf("invalid action: %s", action)
	}
	resp, err := ic.client.UpdateGroupParticipants(context.Background(), jid, pJIDs, wAction)
	if err != nil {
		return nil, fmt.Errorf("update participants failed: %w", err)
	}
	results := make([]map[string]interface{}, 0, len(resp))
	for _, r := range resp {
		results = append(results, map[string]interface{}{
			"jid":   r.JID.String(),
			"error": r.Error,
		})
	}
	return results, nil
}

// GetGroupInviteLink returns the invite link for a group.
func (ic *InstanceClient) GetGroupInviteLink(groupJID string, reset bool) (string, error) {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return "", fmt.Errorf("invalid group JID: %w", err)
	}
	link, err := ic.client.GetGroupInviteLink(context.Background(), jid, reset)
	if err != nil {
		return "", fmt.Errorf("get invite link failed: %w", err)
	}
	return link, nil
}

// ClearSession logs out (best-effort) and deletes the local device store,
// allowing the instance to be re-paired with a new phone number.
func (ic *InstanceClient) ClearSession() error {
	// Logout gracefully — may fail if the number is already banned, ignore error.
	_ = ic.client.Logout(context.Background())
	// Delete the device entry from the SQLite store.
	// Next StartInstance call will create a fresh session.
	return ic.client.Store.Delete(context.Background())
}

// LeaveGroup leaves a WhatsApp group.
func (ic *InstanceClient) LeaveGroup(groupJID string) error {
	jid, err := types.ParseJID(groupJID)
	if err != nil {
		return fmt.Errorf("invalid group JID: %w", err)
	}
	return ic.client.LeaveGroup(context.Background(), jid)
}

// SendVideoMessage sends a proper video message.
func (ic *InstanceClient) SendVideoMessage(to string, videoData []byte, mimeType, caption string) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	upload, err := ic.client.Upload(context.Background(), videoData, whatsmeow.MediaVideo)
	if err != nil {
		return "", fmt.Errorf("upload failed: %w", err)
	}
	msg := &waE2E.Message{
		VideoMessage: &waE2E.VideoMessage{
			Caption:       proto.String(caption),
			Mimetype:      proto.String(mimeType),
			URL:           proto.String(upload.URL),
			DirectPath:    proto.String(upload.DirectPath),
			MediaKey:      upload.MediaKey,
			FileEncSHA256: upload.FileEncSHA256,
			FileSHA256:    upload.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(videoData))),
		},
	}
	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send video failed: %w", err)
	}
	return res.ID, nil
}

// SendContactMessage sends a vCard contact.
func (ic *InstanceClient) SendContactMessage(to, displayName, vcard string) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	msg := &waE2E.Message{
		ContactMessage: &waE2E.ContactMessage{
			DisplayName: proto.String(displayName),
			Vcard:       proto.String(vcard),
		},
	}
	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send contact failed: %w", err)
	}
	return res.ID, nil
}

// SendPollMessage sends a poll with multiple options.
// selectableCount=0 means single-select (1); set >1 to allow multi-select.
func (ic *InstanceClient) SendPollMessage(to, question string, options []string, selectableCount int) (string, error) {
	ctx := context.Background()
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	// Resolve canonical JID (handles Brazilian 9th-digit variants etc.)
	recipient = ic.resolveRecipient(ctx, recipient)

	if selectableCount <= 0 {
		selectableCount = 1
	}
	// BuildPollCreation generates the required MessageSecret for E2E poll encryption.
	msg := ic.client.BuildPollCreation(question, options, selectableCount)

	// Send directly without resolveRecipient (already resolved above) to avoid
	// double LID lookup that can corrupt the E2E encryption context.
	res, err := ic.client.SendMessage(ctx, recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send poll failed: %w", err)
	}
	return res.ID, nil
}

// ButtonItem represents a quick-reply button.
type ButtonItem struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// buttonEmojis maps index 0-9 to emoji number indicators.
var buttonEmojis = []string{"1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"}

// buildButtonsTextFallback formats buttons as a numbered text message.
func buildButtonsTextFallback(body, footer string, buttons []ButtonItem) string {
	var sb strings.Builder
	sb.WriteString(body)
	sb.WriteString("\n")
	for i, b := range buttons {
		if i < len(buttonEmojis) {
			sb.WriteString(fmt.Sprintf("\n%s %s", buttonEmojis[i], b.Text))
		} else {
			sb.WriteString(fmt.Sprintf("\n%d. %s", i+1, b.Text))
		}
	}
	if footer != "" {
		sb.WriteString("\n\n_")
		sb.WriteString(footer)
		sb.WriteString("_")
	}
	return sb.String()
}

// SendButtonsMessage sends a button message.
// First attempts ButtonsMessage wrapped in ViewOnceMessage (wuzapi/wuzapi approach).
// If WhatsApp returns 405 (deprecated on some accounts), falls back to a
// formatted text message with emoji-numbered options.
func (ic *InstanceClient) SendButtonsMessage(to, body, footer string, buttons []ButtonItem) (string, error) {
	ctx := context.Background()
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	recipient = ic.resolveRecipient(ctx, recipient)

	if len(buttons) > 3 {
		buttons = buttons[:3]
	}

	// Build ButtonsMessage proto
	waButtons := make([]*waE2E.ButtonsMessage_Button, len(buttons))
	for i, b := range buttons {
		id := b.ID
		if id == "" {
			id = fmt.Sprintf("btn_%d", i)
		}
		waButtons[i] = &waE2E.ButtonsMessage_Button{
			ButtonID: proto.String(id),
			ButtonText: &waE2E.ButtonsMessage_Button_ButtonText{
				DisplayText: proto.String(b.Text),
			},
			Type:           waE2E.ButtonsMessage_Button_RESPONSE.Enum(),
			NativeFlowInfo: &waE2E.ButtonsMessage_Button_NativeFlowInfo{},
		}
	}
	headerType := waE2E.ButtonsMessage_EMPTY
	msg := &waE2E.Message{
		ViewOnceMessage: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				ButtonsMessage: &waE2E.ButtonsMessage{
					ContentText: proto.String(body),
					FooterText:  proto.String(footer),
					HeaderType:  &headerType,
					Buttons:     waButtons,
				},
				MessageContextInfo: &waE2E.MessageContextInfo{
					DeviceListMetadata:        &waE2E.DeviceListMetadata{},
					DeviceListMetadataVersion: proto.Int32(2),
				},
			},
		},
	}

	res, err := ic.client.SendMessage(ctx, recipient, msg)
	if err != nil {
		// Fall back to text simulation when ButtonsMessage is rejected (405/deprecated)
		log.Warn().Str("instance", ic.ID).Err(err).Msg("ButtonsMessage failed, falling back to text")
		fallback := &waE2E.Message{
			Conversation: proto.String(buildButtonsTextFallback(body, footer, buttons)),
		}
		res, err = ic.client.SendMessage(ctx, recipient, fallback)
		if err != nil {
			return "", fmt.Errorf("send buttons failed: %w", err)
		}
	}
	return res.ID, nil
}

// ListRow represents a row inside a list section.
type ListRow struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// ListSection represents a section of a list message.
type ListSection struct {
	Title string    `json:"title"`
	Rows  []ListRow `json:"rows"`
}

// SendListMessage sends a list/menu message with selectable sections.
// Wraps ListMessage inside ViewOnceMessage > FutureProofMessage — the pattern
// confirmed to deliver to the recipient on personal accounts (whatsmeow #305).
func (ic *InstanceClient) SendListMessage(to, title, description, buttonText, footer string, sections []ListSection) (string, error) {
	ctx := context.Background()
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	// Resolve canonical JID once; send directly to avoid double-resolution issues.
	recipient = ic.resolveRecipient(ctx, recipient)

	sects := make([]*waE2E.ListMessage_Section, len(sections))
	for i, s := range sections {
		rows := make([]*waE2E.ListMessage_Row, len(s.Rows))
		for j, r := range s.Rows {
			id := r.ID
			if id == "" {
				id = fmt.Sprintf("row_%d_%d", i, j)
			}
			rows[j] = &waE2E.ListMessage_Row{
				RowID:       proto.String(id),
				Title:       proto.String(r.Title),
				Description: proto.String(r.Description),
			}
		}
		sects[i] = &waE2E.ListMessage_Section{
			Title: proto.String(s.Title),
			Rows:  rows,
		}
	}

	listType := waE2E.ListMessage_SINGLE_SELECT
	inner := &waE2E.ListMessage{
		Title:       proto.String(title),
		Description: proto.String(description),
		ButtonText:  proto.String(buttonText),
		FooterText:  proto.String(footer),
		ListType:    &listType,
		Sections:    sects,
	}

	// ViewOnceMessage > FutureProofMessage wrapping required — without it the
	// message is only echoed back to the sender, never delivered to recipient.
	msg := &waE2E.Message{
		ViewOnceMessage: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				ListMessage: inner,
			},
		},
	}

	res, err := ic.client.SendMessage(ctx, recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send list failed: %w", err)
	}
	return res.ID, nil
}

// SendStickerMessage sends a WebP sticker.
func (ic *InstanceClient) SendStickerMessage(to string, stickerData []byte, isAnimated bool) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	upload, err := ic.client.Upload(context.Background(), stickerData, whatsmeow.MediaImage)
	if err != nil {
		return "", fmt.Errorf("upload failed: %w", err)
	}
	msg := &waE2E.Message{
		StickerMessage: &waE2E.StickerMessage{
			URL:           proto.String(upload.URL),
			DirectPath:    proto.String(upload.DirectPath),
			MediaKey:      upload.MediaKey,
			FileEncSHA256: upload.FileEncSHA256,
			FileSHA256:    upload.FileSHA256,
			FileLength:    proto.Uint64(uint64(len(stickerData))),
			Mimetype:      proto.String("image/webp"),
			IsAnimated:    proto.Bool(isAnimated),
		},
	}
	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send sticker failed: %w", err)
	}
	return res.ID, nil
}

// SendStatusMessage sends a WhatsApp Status/Story update (visible to all contacts).
// mediaData nil = text status. For image/video pass data + mimeType.
func (ic *InstanceClient) SendStatusMessage(text string, mediaData []byte, mimeType, bgColor string) (string, error) {
	var msg *waE2E.Message
	if len(mediaData) > 0 && strings.HasPrefix(mimeType, "image/") {
		upload, err := ic.client.Upload(context.Background(), mediaData, whatsmeow.MediaImage)
		if err != nil {
			return "", fmt.Errorf("upload failed: %w", err)
		}
		msg = &waE2E.Message{
			ImageMessage: &waE2E.ImageMessage{
				Caption:       proto.String(text),
				Mimetype:      proto.String(mimeType),
				URL:           proto.String(upload.URL),
				DirectPath:    proto.String(upload.DirectPath),
				MediaKey:      upload.MediaKey,
				FileEncSHA256: upload.FileEncSHA256,
				FileSHA256:    upload.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(mediaData))),
			},
		}
	} else if len(mediaData) > 0 && strings.HasPrefix(mimeType, "video/") {
		upload, err := ic.client.Upload(context.Background(), mediaData, whatsmeow.MediaVideo)
		if err != nil {
			return "", fmt.Errorf("upload failed: %w", err)
		}
		msg = &waE2E.Message{
			VideoMessage: &waE2E.VideoMessage{
				Caption:       proto.String(text),
				Mimetype:      proto.String(mimeType),
				URL:           proto.String(upload.URL),
				DirectPath:    proto.String(upload.DirectPath),
				MediaKey:      upload.MediaKey,
				FileEncSHA256: upload.FileEncSHA256,
				FileSHA256:    upload.FileSHA256,
				FileLength:    proto.Uint64(uint64(len(mediaData))),
			},
		}
	} else {
		// Text status
		extendedText := &waE2E.ExtendedTextMessage{
			Text: proto.String(text),
		}
		if bgColor != "" {
			// bgColor as hex "#RRGGBB" → uint32 (ARGB)
			extendedText.BackgroundArgb = proto.Uint32(0)
		}
		msg = &waE2E.Message{
			ExtendedTextMessage: extendedText,
		}
	}
	res, err := ic.client.SendMessage(context.Background(), types.StatusBroadcastJID, msg)
	if err != nil {
		return "", fmt.Errorf("send status failed: %w", err)
	}
	return res.ID, nil
}

// SendPresenceUpdate sends the online/offline presence status.
// available=true means "online", false means "unavailable".
func (ic *InstanceClient) SendPresenceUpdate(available bool) error {
	state := types.PresenceAvailable
	if !available {
		state = types.PresenceUnavailable
	}
	return ic.client.SendPresence(context.Background(), state)
}

// RequestPayment sends a payment request to a recipient.
func (ic *InstanceClient) RequestPayment(to, currency string, amount float64, note string) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	// amount1000 = amount * 1000 (WhatsApp stores as integer thousandths)
	amount1000 := uint64(amount * 1000)
	var noteMsg *waE2E.Message
	if note != "" {
		noteMsg = &waE2E.Message{Conversation: proto.String(note)}
	}
	msg := &waE2E.Message{
		RequestPaymentMessage: &waE2E.RequestPaymentMessage{
			CurrencyCodeIso4217: proto.String(currency),
			Amount1000:          proto.Uint64(amount1000),
			RequestFrom:         proto.String(to),
			NoteMessage:         noteMsg,
		},
	}
	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("request payment failed: %w", err)
	}
	return res.ID, nil
}

// SendWithFallback is a direct (non-queued) send that still applies typing simulation.
// Used as fallback when RabbitMQ is unavailable.
func (ic *InstanceClient) SendWithFallback(job queue.SendJob) (string, error) {
	if !ic.client.IsConnected() {
		return "", fmt.Errorf("instance not connected")
	}
	if job.Options.SimulateTyping {
		ic.simulateTyping(job.Payload.To, job.Payload.Text, job.Options.TypingDurationMs)
	}
	switch job.Type {
	case queue.TypeText:
		return ic.SendTextMessage(job.Payload.To, job.Payload.Text)
	case queue.TypeImage:
		data, err := ic.resolveMedia(job.Payload)
		if err != nil {
			return "", err
		}
		mime := job.Payload.MimeType
		if mime == "" {
			mime = "image/jpeg"
		}
		return ic.SendImageMessage(job.Payload.To, data, mime, job.Payload.Caption)
	case queue.TypeDocument:
		data, err := ic.resolveMedia(job.Payload)
		if err != nil {
			return "", err
		}
		return ic.SendDocumentMessage(job.Payload.To, data, job.Payload.MimeType, job.Payload.Filename)
	default:
		return ic.SendTextMessage(job.Payload.To, job.Payload.Text)
	}
}

// ── Anti-ban send engine ──────────────────────────────────────────────────────

// ProcessQueueJob is the queue consumer handler. It applies anti-ban measures
// (typing simulation, random jitter) before dispatching the actual send.
func (ic *InstanceClient) ProcessQueueJob(job queue.SendJob) error {
	if !ic.client.IsConnected() {
		return fmt.Errorf("instance not connected")
	}

	// 1. Typing simulation — only for text/image/document/audio
	if job.Options.SimulateTyping {
		switch job.Type {
		case queue.TypeText, queue.TypeImage, queue.TypeDocument, queue.TypeAudio:
			ic.simulateTyping(job.Payload.To, job.Payload.Text, job.Options.TypingDurationMs)
		}
	}

	// 2. Send the message
	var sendErr error
	switch job.Type {
	case queue.TypeText:
		_, sendErr = ic.SendTextMessage(job.Payload.To, job.Payload.Text)

	case queue.TypeImage:
		imageData, err := ic.resolveMedia(job.Payload)
		if err != nil {
			return fmt.Errorf("image data: %w", err)
		}
		mime := job.Payload.MimeType
		if mime == "" {
			mime = "image/jpeg"
		}
		_, sendErr = ic.SendImageMessage(job.Payload.To, imageData, mime, job.Payload.Caption)

	case queue.TypeDocument:
		docData, err := ic.resolveMedia(job.Payload)
		if err != nil {
			return fmt.Errorf("document data: %w", err)
		}
		mime := job.Payload.MimeType
		if mime == "" {
			mime = "application/octet-stream"
		}
		fname := job.Payload.Filename
		if fname == "" {
			fname = "file"
		}
		_, sendErr = ic.SendDocumentMessage(job.Payload.To, docData, mime, fname)

	case queue.TypeAudio:
		audioData, err := ic.resolveMedia(job.Payload)
		if err != nil {
			return fmt.Errorf("audio data: %w", err)
		}
		mime := job.Payload.MimeType
		if mime == "" {
			mime = "audio/ogg; codecs=opus"
		}
		_, sendErr = ic.SendAudioMessage(job.Payload.To, audioData, mime, job.Payload.PTT)

	case queue.TypeLocation:
		_, sendErr = ic.SendLocationMessage(job.Payload.To,
			job.Payload.Latitude, job.Payload.Longitude, job.Payload.LocationName)

	case queue.TypeReaction:
		_, sendErr = ic.SendReaction(job.Payload.To, job.Payload.MessageID,
			job.Payload.SenderJID, job.Payload.Reaction)

	case queue.TypeRevoke:
		_, sendErr = ic.RevokeMessage(job.Payload.To, job.Payload.MessageID, job.Payload.SenderJID)

	default:
		return fmt.Errorf("unknown job type: %s", job.Type)
	}

	if sendErr != nil {
		return sendErr
	}

	// 3. Post-send delay + random jitter (anti-ban)
	delayMs := job.Options.DelayMs
	if delayMs <= 0 {
		delayMs = 1200 // default 1.2s
	}
	jitter := rand.Intn(500) // 0–500 ms
	time.Sleep(time.Duration(delayMs+jitter) * time.Millisecond)

	return nil
}

// simulateTyping sends a typing presence indicator for a natural duration.
func (ic *InstanceClient) simulateTyping(to, text string, durationMs int) {
	jid, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return
	}
	if durationMs <= 0 {
		// Auto: 60ms per rune, min 800ms, max 5000ms
		durationMs = len([]rune(text)) * 60
		if durationMs < 800 {
			durationMs = 800
		}
		if durationMs > 5000 {
			durationMs = 5000
		}
	}
	_ = ic.client.SendChatPresence(context.Background(), jid, types.ChatPresenceComposing, types.ChatPresenceMediaText)
	time.Sleep(time.Duration(durationMs) * time.Millisecond)
	_ = ic.client.SendChatPresence(context.Background(), jid, types.ChatPresencePaused, types.ChatPresenceMediaText)
}

// resolveMedia returns raw bytes from either a base64 field or a URL.
func (ic *InstanceClient) resolveMedia(p queue.SendPayload) ([]byte, error) {
	if p.MediaB64 != "" {
		return base64.StdEncoding.DecodeString(p.MediaB64)
	}
	if p.MediaURL != "" {
		return downloadURL(p.MediaURL)
	}
	return nil, fmt.Errorf("no media provided")
}

// CheckNumber verifies if a phone number exists on WhatsApp.
func (ic *InstanceClient) CheckNumber(phone string) (bool, string, error) {
	resp, err := ic.client.IsOnWhatsApp(context.Background(), []string{phone})
	if err != nil {
		return false, "", fmt.Errorf("check number failed: %w", err)
	}
	if len(resp) == 0 {
		return false, "", nil
	}
	r := resp[0]
	jid := ""
	if r.IsIn {
		jid = r.JID.String()
	}
	return r.IsIn, jid, nil
}

// downloadURL fetches raw bytes from an HTTP/HTTPS URL (used for media_url resolution).
func downloadURL(rawURL string) ([]byte, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(rawURL)
	if err != nil {
		return nil, fmt.Errorf("download %s: %w", rawURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("download %s: status %d", rawURL, resp.StatusCode)
	}
	buf := make([]byte, 0, resp.ContentLength)
	b := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(b)
		if n > 0 {
			buf = append(buf, b[:n]...)
		}
		if err != nil {
			break
		}
	}
	return buf, nil
}

// GetQRBase64 returns the most recently received QR code as a base64 data URL.
func (ic *InstanceClient) GetQRBase64() string {
	select {
	case code := <-ic.qrChan:
		// Re-queue so subsequent callers can also read it
		select {
		case ic.qrChan <- code:
		default:
		}
		return "data:text/plain;base64," + base64.StdEncoding.EncodeToString([]byte(code))
	default:
		return ""
	}
}

// RegisterWSConn registers a WebSocket connection to receive real-time events.
func (ic *InstanceClient) RegisterWSConn(send chan []byte, done chan struct{}) {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	ic.wsConns = append(ic.wsConns, wsConn{send: send, done: done})
}

// UpdateWebhooks atomically replaces the webhook list for this instance.
func (ic *InstanceClient) UpdateWebhooks(webhooks []webhookEntry) {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	ic.webhooks = webhooks
}

// UpdateSettings atomically replaces the instance settings.
func (ic *InstanceClient) UpdateSettings(s InstanceSettings) {
	ic.mu.Lock()
	ic.settings = s
	ic.mu.Unlock()
}

// getSettings safely reads current settings.
func (ic *InstanceClient) getSettings() InstanceSettings {
	ic.mu.Lock()
	defer ic.mu.Unlock()
	return ic.settings
}

func (ic *InstanceClient) broadcastWS(msgType string, data interface{}) {
	msg := newWSMessage(msgType, data)
	ic.mu.Lock()
	defer ic.mu.Unlock()

	var active []wsConn
	for _, conn := range ic.wsConns {
		select {
		case <-conn.done:
		default:
			select {
			case conn.send <- msg:
			default:
			}
			active = append(active, conn)
		}
	}
	ic.wsConns = active

	if hub := GetHub(); hub != nil {
		hub.Broadcast(&Event{
			Type:     msgType,
			Instance: ic.ID,
			Payload:  data,
		})
	}
}

func (ic *InstanceClient) dispatchEvent(event string, data interface{}, ctx eventContext) {
	payload := WebhookPayload{
		Event:      event,
		InstanceID: ic.ID,
		Timestamp:  time.Now(),
		Data:       data,
	}
	ic.mu.Lock()
	hooks := make([]webhookEntry, len(ic.webhooks))
	copy(hooks, ic.webhooks)
	ic.mu.Unlock()

	for _, hook := range hooks {
		if hook.IgnoreGroups && ctx.isGroup {
			continue
		}
		if hook.IgnoreSelf && ctx.isFromMe {
			continue
		}
		if hook.IgnoreAPISent && ctx.isFromMe {
			continue
		}

		shouldSend := false
		for _, ev := range hook.Events {
			if ev == event || ev == "*" {
				shouldSend = true
				break
			}
		}
		if shouldSend {
			go dispatchToEntry(hook, payload)
		}
	}
}

// handleEvent is the main whatsmeow event dispatcher.
func (ic *InstanceClient) handleEvent(evt interface{}) {
	switch v := evt.(type) {

	// ── Messages ────────────────────────────────────────────────────────────
	case *events.Message:
		isGroup := v.Info.Chat.Server == "g.us"
		isFromMe := v.Info.IsFromMe
		ctx := eventContext{isGroup: isGroup, isFromMe: isFromMe}
		cfg := ic.getSettings()

		// Instance-level group filter
		if cfg.IgnoreGroups && isGroup {
			return
		}

		// Auto read messages
		if cfg.ReadMessages && !isFromMe {
			go func() {
				_ = ic.client.MarkRead(context.Background(), []string{v.Info.ID}, time.Now(), v.Info.Chat, v.Info.Sender)
			}()
		}

		msgType := "text"
		text := ""
		switch {
		case v.Message.GetConversation() != "":
			text = v.Message.GetConversation()
		case v.Message.GetExtendedTextMessage() != nil:
			text = v.Message.GetExtendedTextMessage().GetText()
		case v.Message.GetImageMessage() != nil:
			msgType = "image"
			text = v.Message.GetImageMessage().GetCaption()
		case v.Message.GetVideoMessage() != nil:
			msgType = "video"
			text = v.Message.GetVideoMessage().GetCaption()
		case v.Message.GetAudioMessage() != nil:
			msgType = "audio"
		case v.Message.GetDocumentMessage() != nil:
			msgType = "document"
			text = v.Message.GetDocumentMessage().GetFileName()
		case v.Message.GetStickerMessage() != nil:
			msgType = "sticker"
		case v.Message.GetLocationMessage() != nil:
			msgType = "location"
		case v.Message.GetReactionMessage() != nil:
			msgType = "reaction"
			text = v.Message.GetReactionMessage().GetText()
		case v.Message.GetPollCreationMessage() != nil:
			msgType = "poll"
			text = v.Message.GetPollCreationMessage().GetName()
		case v.Message.GetContactMessage() != nil:
			msgType = "contact"
			text = v.Message.GetContactMessage().GetDisplayName()
		case v.Message.GetInteractiveMessage() != nil:
			msgType = "interactive"
			text = "Mensagem interativa"
		case v.Message.GetListMessage() != nil:
			msgType = "list"
			text = "Lista de opções"
		case v.Message.GetButtonsMessage() != nil:
			msgType = "buttons"
			text = "Mensagem com botões"
		case v.Message.GetEphemeralMessage() != nil:
			msgType = "ephemeral"
			text = "Mensagem efêmera"
		case v.Message.GetProtocolMessage() != nil:
			msgType = "protocol"
			text = "Mensagem removida"
		default:
			log.Printf("DEBUG: Unknown message type: %T", v.Message)
			msgType = "text"
		}

		data := map[string]interface{}{
			"id":        v.Info.ID,
			"from":      v.Info.Sender.String(),
			"chat":      v.Info.Chat.String(),
			"timestamp": v.Info.Timestamp,
			"type":      msgType,
			"is_group":  isGroup,
			"from_me":   isFromMe,
			"push_name": v.Info.PushName,
		}
		if text != "" {
			data["text"] = text
		}

		var evName string
		switch {
		case msgType == "reaction":
			evName = "message.reaction"
		case v.IsEdit:
			evName = "message.edited"
		case isFromMe:
			evName = "message.sent"
		default:
			evName = "message.received"
		}
		ic.broadcastWS(evName, data)
		ic.dispatchEvent(evName, data, ctx)

		// Save message to database for inbox (including groups)
		var direction models.MessageDirection
		if isFromMe {
			direction = models.DirectionOut
		} else {
			direction = models.DirectionIn
		}
		msgText := text
		if msgText == "" {
			switch msgType {
			case "audio":
				msgText = "🔊 Áudio"
			case "sticker":
				msgText = "😊 Sticker"
			case "image":
				msgText = "📷 Imagem"
			case "video":
				msgText = "🎬 Vídeo"
			case "document":
				msgText = "📄 Documento"
			case "location":
				msgText = "📍 Localização"
			case "contact":
				msgText = "👤 Contato"
			default:
				msgText = msgType
			}
		}
		chatJID := v.Info.Chat.String()
		pushName := v.Info.PushName
		isGroupMsg := v.Info.Chat.Server == "g.us"
		log.Printf("DEBUG: Saving message - chatJID=%s, pushName=%s, isGroup=%v", chatJID, pushName, isGroupMsg)
		senderJID := v.Info.Sender.String()
		go func() {
			if GlobalManager != nil {
				_ = GlobalManager.SaveMessage(ic.ID, chatJID, msgText, direction, msgType, pushName, isGroupMsg, senderJID)
			}
		}()

		// Check and execute journeys for incoming messages
		if evName == "message.received" && !isFromMe {
			if GlobalManager != nil {
				chatJID := v.Info.Chat.String()
				senderJID := v.Info.Sender.String()
				pushName := v.Info.PushName
				if pushName == "" {
					pushName = "Cliente"
				}
				isGroup := v.Info.Chat.Server == "g.us"
				// Check journeys for both text and media messages
				go GlobalManager.CheckJourneys(ic.ID, senderJID, pushName, chatJID, text, msgType, isGroup)
			}
		}

	// ── Read receipts / delivery ─────────────────────────────────────────────
	case *events.Receipt:
		data := map[string]interface{}{
			"ids":       v.MessageIDs,
			"from":      v.Sender.String(),
			"chat":      v.Chat.String(),
			"type":      string(v.Type),
			"timestamp": v.Timestamp,
		}
		ic.broadcastWS("message.status", data)
		ic.dispatchEvent("message.status", data, eventContext{isGroup: v.Chat.Server == "g.us"})

	// ── Presence ─────────────────────────────────────────────────────────────
	case *events.Presence:
		if ic.getSettings().IgnoreStatus {
			return
		}
		data := map[string]interface{}{
			"from":        v.From.String(),
			"unavailable": v.Unavailable,
			"last_seen":   v.LastSeen,
		}
		ic.broadcastWS("presence.update", data)
		ic.dispatchEvent("presence.update", data, eventContext{})

	case *events.ChatPresence:
		if ic.getSettings().IgnoreStatus {
			return
		}
		data := map[string]interface{}{
			"from":  v.Sender.String(),
			"chat":  v.Chat.String(),
			"state": string(v.State),
			"media": string(v.Media),
		}
		ic.broadcastWS("chat.presence", data)
		ic.dispatchEvent("chat.presence", data, eventContext{isGroup: v.Chat.Server == "g.us"})

	// ── Groups ────────────────────────────────────────────────────────────────
	case *events.GroupInfo:
		data := map[string]interface{}{
			"jid":       v.JID.String(),
			"timestamp": v.Timestamp,
		}
		if v.Sender != nil {
			data["sender"] = v.Sender.String()
		}
		if v.Name != nil {
			data["name"] = v.Name.Name
		}
		if len(v.Join) > 0 {
			jids := make([]string, len(v.Join))
			for i, j := range v.Join {
				jids[i] = j.String()
			}
			data["join"] = jids
		}
		if len(v.Leave) > 0 {
			jids := make([]string, len(v.Leave))
			for i, j := range v.Leave {
				jids[i] = j.String()
			}
			data["leave"] = jids
		}
		ic.broadcastWS("group.update", data)
		ic.dispatchEvent("group.update", data, eventContext{isGroup: true})

	case *events.JoinedGroup:
		data := map[string]interface{}{
			"jid":    v.GroupInfo.JID.String(),
			"name":   v.GroupInfo.Name,
			"reason": v.Reason,
			"type":   v.Type,
		}
		ic.broadcastWS("group.join", data)
		ic.dispatchEvent("group.join", data, eventContext{isGroup: true})

	// ── Calls ─────────────────────────────────────────────────────────────────
	case *events.CallOffer:
		if ic.getSettings().RejectCalls {
			go func() {
				_ = ic.client.RejectCall(context.Background(), v.From, v.CallID)
			}()
		}
		data := map[string]interface{}{
			"call_id": v.CallID,
			"from":    v.From.String(),
			"type":    "offer",
		}
		ic.broadcastWS("call.incoming", data)
		ic.dispatchEvent("call.incoming", data, eventContext{})

	case *events.CallAccept:
		data := map[string]interface{}{
			"call_id": v.CallID,
			"from":    v.From.String(),
			"type":    "accept",
		}
		ic.broadcastWS("call.accepted", data)
		ic.dispatchEvent("call.accepted", data, eventContext{})

	case *events.CallTerminate:
		data := map[string]interface{}{
			"call_id": v.CallID,
			"from":    v.From.String(),
			"reason":  v.Reason,
		}
		ic.broadcastWS("call.terminate", data)
		ic.dispatchEvent("call.terminate", data, eventContext{})

	case *events.CallReject:
		data := map[string]interface{}{
			"call_id": v.CallID,
			"from":    v.From.String(),
		}
		ic.broadcastWS("call.rejected", data)
		ic.dispatchEvent("call.rejected", data, eventContext{})

	case *events.CallOfferNotice:
		data := map[string]interface{}{
			"call_id": v.CallID,
			"from":    v.From.String(),
			"media":   v.Media,
			"type":    v.Type,
		}
		ic.broadcastWS("call.incoming", data)
		ic.dispatchEvent("call.incoming", data, eventContext{})

	// ── Contacts / Profile ────────────────────────────────────────────────────
	case *events.PushName:
		data := map[string]interface{}{
			"jid":          v.JID.String(),
			"old_pushname": v.OldPushName,
			"new_pushname": v.NewPushName,
		}
		ic.broadcastWS("contact.pushname", data)
		ic.dispatchEvent("contact.pushname", data, eventContext{})

	case *events.Picture:
		data := map[string]interface{}{
			"jid":        v.JID.String(),
			"author":     v.Author.String(),
			"timestamp":  v.Timestamp,
			"removed":    v.Remove,
			"picture_id": v.PictureID,
		}
		ic.broadcastWS("picture.update", data)
		ic.dispatchEvent("picture.update", data, eventContext{})

	case *events.Contact:
		data := map[string]interface{}{
			"jid":       v.JID.String(),
			"timestamp": v.Timestamp,
		}
		if v.Action != nil && v.Action.GetFullName() != "" {
			data["name"] = v.Action.GetFullName()
		}
		ic.broadcastWS("contact.update", data)
		ic.dispatchEvent("contact.update", data, eventContext{})

	// ── Newsletters ───────────────────────────────────────────────────────────
	case *events.NewsletterJoin:
		data := map[string]interface{}{
			"id": v.ID.String(),
		}
		ic.broadcastWS("newsletter.join", data)
		ic.dispatchEvent("newsletter.join", data, eventContext{})

	case *events.NewsletterLeave:
		data := map[string]interface{}{
			"id":   v.ID.String(),
			"role": string(v.Role),
		}
		ic.broadcastWS("newsletter.leave", data)
		ic.dispatchEvent("newsletter.leave", data, eventContext{})

	case *events.NewsletterLiveUpdate:
		data := map[string]interface{}{
			"jid":      v.JID.String(),
			"messages": len(v.Messages),
		}
		ic.broadcastWS("newsletter.update", data)
		ic.dispatchEvent("newsletter.update", data, eventContext{})

	// ── History sync ──────────────────────────────────────────────────────────
	case *events.HistorySync:
		if v.Data == nil {
			return
		}
		data := map[string]interface{}{
			"type":          v.Data.GetSyncType().String(),
			"chunk_order":   v.Data.GetChunkOrder(),
			"conversations": len(v.Data.GetConversations()),
		}
		ic.broadcastWS("history.sync", data)
		ic.dispatchEvent("history.sync", data, eventContext{})

	// ── Connection ────────────────────────────────────────────────────────────
	case *events.PairSuccess:
		data := map[string]interface{}{
			"id":            v.ID.String(),
			"business_name": v.BusinessName,
			"platform":      v.Platform,
		}
		select {
		case ic.statusChan <- "connected":
		default:
		}
		ic.broadcastWS("instance.paired", data)
		ic.dispatchEvent("instance.paired", data, eventContext{})
		log.Info().Str("instance", ic.ID).Str("id", v.ID.String()).Msg("WhatsApp paired successfully")

	case *events.Connected:
		select {
		case ic.statusChan <- "connected":
		default:
		}
		if ic.getSettings().AlwaysOnline {
			go func() {
				_ = ic.client.SendPresence(context.Background(), types.PresenceAvailable)
			}()
		}
		ic.broadcastWS("status", map[string]string{"status": "connected"})
		ic.dispatchEvent("instance.connected", map[string]string{"status": "connected"}, eventContext{})
		log.Info().Str("instance", ic.ID).Msg("WhatsApp connected")

	case *events.Disconnected:
		select {
		case ic.statusChan <- "disconnected":
		default:
		}
		ic.broadcastWS("status", map[string]string{"status": "disconnected"})
		ic.dispatchEvent("instance.disconnected", map[string]string{"status": "disconnected"}, eventContext{})
		log.Info().Str("instance", ic.ID).Msg("WhatsApp disconnected")

	case *events.LoggedOut:
		select {
		case ic.statusChan <- "disconnected":
		default:
		}
		ic.broadcastWS("status", map[string]string{"status": "logged_out"})
		ic.dispatchEvent("instance.disconnected", map[string]string{"status": "logged_out"}, eventContext{})
		log.Warn().Str("instance", ic.ID).Msg("WhatsApp logged out")

	case *events.TemporaryBan:
		data := map[string]interface{}{
			"code":   int(v.Code),
			"reason": v.Code.String(),
			"expire": v.Expire.String(),
		}
		select {
		case ic.statusChan <- "disconnected":
		default:
		}
		ic.broadcastWS("instance.banned", data)
		ic.dispatchEvent("instance.banned", data, eventContext{})
		log.Warn().Str("instance", ic.ID).Str("reason", v.Code.String()).Msg("WhatsApp temporarily banned")

	case *events.KeepAliveTimeout:
		log.Warn().Str("instance", ic.ID).Int("error_count", v.ErrorCount).Msg("WhatsApp keep-alive timeout")
	}
}
