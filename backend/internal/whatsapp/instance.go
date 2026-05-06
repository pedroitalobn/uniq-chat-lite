package whatsapp

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/audioconvert"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/queue"
	"github.com/uniq-chat/backend/internal/storage"
	"go.mau.fi/whatsmeow"
	waBinary "go.mau.fi/whatsmeow/binary"
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

// mediaFetchClient é o cliente usado pra baixar imagens/vídeos de URLs
// externas (ex.: header de cartão de carrossel) antes do upload pro
// WhatsApp. Timeout total de 15s — sem isso, uma URL lenta podia
// segurar o handler por minutos (default Go = sem timeout).
var mediaFetchClient = &http.Client{Timeout: 15 * time.Second}

// buildButtonsBizNodes — biz nodes do native_flow.  Configuração que está
// funcionando em prod pra Buttons + Template (via reroute).
// NÃO mexer sem teste explícito.
func buildButtonsBizNodes(_ bool) []waBinary.Node {
	return []waBinary.Node{
		{
			Tag: "biz",
			Content: []waBinary.Node{{
				Tag: "interactive",
				Attrs: waBinary.Attrs{
					"type": "native_flow",
					"v":    "1",
				},
				Content: []waBinary.Node{{
					Tag:   "native_flow",
					Attrs: waBinary.Attrs{"v": "9", "name": "mixed"},
				}},
			}},
		},
	}
}

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

	// Cache de resolução de destinatário (phone JID → LID ou canonical
	// @s.whatsapp.net) pra evitar rate-limit 429 do usync do WhatsApp.
	recipientCacheMu sync.RWMutex
	recipientCache   map[string]types.JID

	// Cache negativo de LID: quando o usync devolveu erro/sem LID pra um
	// PN, evitamos hammering por 60s. Resolve o caso onde o destinatário
	// não está no índice LID (raro, mas existe).
	lidNegMu sync.Mutex
	lidNeg   map[string]time.Time

	// Track de chamadas aceitas: quando CallTerminate chega e o call_id NÃO
	// está aqui, consideramos "missed call" (ligou e ninguém atendeu). Chave:
	// call_id → timestamp da aceitação. GC simples: deleta no CallTerminate.
	acceptedCalls sync.Map
}

type ContactLookup struct {
	Query     string `json:"query"`
	Exists    bool   `json:"exists"`
	JID       string `json:"jid,omitempty"`
	Phone     string `json:"phone,omitempty"`
	Name      string `json:"name,omitempty"`
	PushName  string `json:"push_name,omitempty"`
	AvatarURL string `json:"avatar_url,omitempty"`
}

type wsConn struct {
	send chan []byte
	done chan struct{}
}

type webhookEntry struct {
	ID            string // UUID do Webhook (vazio se não vier do DB) — usado pra log de delivery
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

	// Auto-reconnect do whatsmeow: CRÍTICO pra UX. Sem isso, qualquer flap
	// de rede (keepalive timeout, stream replaced transitório, CAT
	// refresh) emite events.Disconnected e fica esperando nosso poller
	// de 30s reabrir o socket. Com Enable=true, a lib reconecta em
	// 0-18s usando exponential backoff interno (2s * errors), zerando
	// no primeiro sucesso.
	//
	// InitialAutoReconnect=true = aplicado já na primeira conexão.
	// AutoReconnectHook retorna false quando o backoff ultrapassa 5
	// tentativas — avisa que tem algo errado e deixa o nosso poller
	// externo assumir (manager.go startReconnectionChecker).
	waClient.EnableAutoReconnect = true
	waClient.InitialAutoReconnect = true
	waClient.AutoReconnectHook = func(err error) bool {
		if waClient.AutoReconnectErrors > 5 {
			log.Error().
				Str("instance", instanceID).
				Int("errors", waClient.AutoReconnectErrors).
				Err(err).
				Msg("whatsmeow: auto-reconnect esgotou backoff — caindo pro poller externo")
			return false
		}
		return true
	}

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

// ResolvePNForLID looks up the phone-form JID string for a raw LID JID string
// using the persisted LID↔PN map. Returns the input unchanged if the lookup
// fails or the input isn't an @lid JID. Safe for handlers to call without
// worrying about client-is-nil.
func (ic *InstanceClient) ResolvePNForLID(raw string) string {
	if ic == nil || ic.client == nil || ic.client.Store == nil || ic.client.Store.LIDs == nil {
		return raw
	}
	jid, err := types.ParseJID(raw)
	if err != nil || jid.Server != types.HiddenUserServer {
		return raw
	}
	pn, err := ic.client.Store.LIDs.GetPNForLID(context.Background(), jid)
	if err != nil || pn.IsEmpty() {
		return raw
	}
	return pn.String()
}

// resolveChatPNJID returns the chat JID in phone-number form (@s.whatsapp.net)
// whenever possible. Contacts that migrated to LID addressing arrive with
// Chat.Server == "lid"; if we save that unchanged, the inbox ends up with a
// second row separate from the phone-JID row used by outgoing sends. We prefer
// the alt JID that whatsmeow already resolved for us (RecipientAlt for
// outgoing DMs, SenderAlt for incoming DMs) and fall back to the persisted
// LID↔PN map. Groups and broadcast chats are returned as-is.
func (ic *InstanceClient) resolveChatPNJID(info types.MessageInfo) types.JID {
	chat := info.Chat
	if chat.Server != types.HiddenUserServer {
		return chat
	}
	if info.IsFromMe && !info.RecipientAlt.IsEmpty() && info.RecipientAlt.Server == types.DefaultUserServer {
		return info.RecipientAlt
	}
	if !info.SenderAlt.IsEmpty() && info.SenderAlt.Server == types.DefaultUserServer {
		return info.SenderAlt
	}
	if !info.RecipientAlt.IsEmpty() && info.RecipientAlt.Server == types.DefaultUserServer {
		return info.RecipientAlt
	}
	if ic.client != nil && ic.client.Store != nil && ic.client.Store.LIDs != nil {
		if pn, err := ic.client.Store.LIDs.GetPNForLID(context.Background(), chat); err == nil && !pn.IsEmpty() {
			return pn
		}
	}
	return chat
}

// resolveRecipient turns a phone-number JID into the destination whatsmeow expects
// for SendMessage. Strategy: only consult caches that are already populated (our
// in-memory map + whatsmeow's persisted LID↔PN store). We do NOT call usync
// endpoints (IsOnWhatsApp / GetUserInfo) here — whatsmeow.SendMessage already
// runs GetUserInfo as a fallback when LIDMigrationTimestamp > 0 and the store
// misses. Running an additional usync query on our side meant two round-trips per
// first-time send, which regularly tripped the server's rate-overlimit (429) and
// aborted the send (non-retriable). Incoming messages auto-populate Store.LIDs
// via SenderAlt/RecipientAlt, so contacts who've messaged the instance resolve
// without any network call.
func (ic *InstanceClient) resolveRecipient(ctx context.Context, jid types.JID) types.JID {
	if jid.Server != types.DefaultUserServer {
		return jid
	}

	ic.recipientCacheMu.RLock()
	cached, ok := ic.recipientCache[jid.String()]
	ic.recipientCacheMu.RUnlock()
	if ok && !cached.IsEmpty() {
		return cached
	}

	if ic.client.Store != nil && ic.client.Store.LIDs != nil {
		if lid, err := ic.client.Store.LIDs.GetLIDForPN(ctx, jid); err == nil && !lid.IsEmpty() {
			ic.cacheRecipient(jid, lid)
			return lid
		}
	}

	// Fallback BR: o "9" móvel foi adicionado em 2012, mas o WhatsApp
	// pode ter contatos com JID de 12 dígitos (sem 9, formato antigo) OU
	// 13 dígitos (com 9, formato novo). Independente do que o frontend
	// mande, tentamos a variante alternativa via cache local + LIDs store.
	variants := brazilianMobileVariants(jid)
	for _, alt := range variants {
		ic.recipientCacheMu.RLock()
		altCached, altOK := ic.recipientCache[alt.String()]
		ic.recipientCacheMu.RUnlock()
		if altOK && !altCached.IsEmpty() {
			ic.cacheRecipient(jid, altCached)
			return altCached
		}
		if ic.client.Store != nil && ic.client.Store.LIDs != nil {
			if lid, err := ic.client.Store.LIDs.GetLIDForPN(ctx, alt); err == nil && !lid.IsEmpty() {
				ic.cacheRecipient(jid, lid)
				return lid
			}
		}
	}

	// BR mobile sem cache hit ou LID — pergunta ao servidor qual variante
	// (com 9 / sem 9) é a real via IsOnWhatsApp. UMA query usync por
	// destinatário novo, depois cache hit. Sem isso, mensagens enviadas
	// pra número com 9 quando o WhatsApp tem o contato como sem 9 (ou
	// vice-versa) ficam em "queued" e nunca chegam.
	if len(variants) > 0 {
		all := append([]types.JID{jid}, variants...)
		phones := make([]string, 0, len(all))
		for _, j := range all {
			phones = append(phones, "+"+j.User)
		}
		isOnCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if results, err := ic.client.IsOnWhatsApp(isOnCtx, phones); err == nil {
			for _, r := range results {
				if r.IsIn && !r.JID.IsEmpty() {
					ic.cacheRecipient(jid, r.JID)
					// Também guarda mapping reverso no cache pras outras variantes.
					for _, j := range all {
						if j.String() != r.JID.String() {
							ic.cacheRecipient(j, r.JID)
						}
					}
					return r.JID
				}
			}
		} else {
			log.Debug().Str("instance", ic.ID).Err(err).Msg("IsOnWhatsApp fallback failed; using original JID")
		}
	}

	return jid
}

// resolveBRPhone faz APENAS a normalização BR-9 (com/sem nono dígito) sem
// consultar Store.LIDs. Usado em mensagens interativas (buttons/pix/list/
// carousel) onde o servidor WhatsApp rejeita LID com 405 — precisamos
// manter o JID em PN, mas ainda assim descobrir qual variante (12 ou 13
// dig) é a que existe na conta. Lógica:
//
//  1. Se já está no cache de recipients e o resolved é PN, usa.
//  2. Se brazilianMobileVariants retorna alternativas, pergunta ao
//     servidor via IsOnWhatsApp qual está cadastrada.
//  3. Cacheia o resultado pra próximo envio ser instantâneo.
//
// Nunca converte PN→LID, mesmo que Store.LIDs tenha mapping. Se nada
// funciona, retorna o JID original (whatsmeow tenta enviar e o pior caso
// é 200 OK + silent drop, que é o comportamento atual sem normalização).
func (ic *InstanceClient) resolveBRPhone(ctx context.Context, jid types.JID) types.JID {
	if jid.Server != types.DefaultUserServer {
		return jid
	}
	variants := brazilianMobileVariants(jid)
	if len(variants) == 0 {
		return jid
	}

	// Cache hit pro JID original (apenas se cached é PN, não LID).
	ic.recipientCacheMu.RLock()
	cached, ok := ic.recipientCache[jid.String()]
	ic.recipientCacheMu.RUnlock()
	if ok && !cached.IsEmpty() && cached.Server == types.DefaultUserServer {
		return cached
	}
	// Cache hit por uma das variantes (alguém já enviou pra variante e
	// o servidor confirmou qual era a real).
	for _, alt := range variants {
		ic.recipientCacheMu.RLock()
		altCached, altOK := ic.recipientCache[alt.String()]
		ic.recipientCacheMu.RUnlock()
		if altOK && !altCached.IsEmpty() && altCached.Server == types.DefaultUserServer {
			ic.cacheRecipient(jid, altCached)
			return altCached
		}
	}

	// Pergunta ao servidor qual variante existe. UMA query usync por
	// destinatário novo, depois cache hit.
	all := append([]types.JID{jid}, variants...)
	phones := make([]string, 0, len(all))
	for _, j := range all {
		phones = append(phones, "+"+j.User)
	}
	isOnCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	results, err := ic.client.IsOnWhatsApp(isOnCtx, phones)
	if err != nil {
		log.Debug().Str("instance", ic.ID).Err(err).Msg("BR-9 IsOnWhatsApp failed; using original JID")
		return jid
	}
	for _, r := range results {
		if r.IsIn && !r.JID.IsEmpty() && r.JID.Server == types.DefaultUserServer {
			ic.cacheRecipient(jid, r.JID)
			for _, j := range all {
				if j.String() != r.JID.String() {
					ic.cacheRecipient(j, r.JID)
				}
			}
			return r.JID
		}
	}
	return jid
}

// brazilianMobileVariants retorna as variantes BR (com 9 / sem 9) que
// devem ser testadas como alternativas ao JID original. Cobre os 2 casos:
//
//   - Input 13 dig "55 + DDD + 9 + 8" (com 9, formato novo) →
//     variante "55 + DDD + 8" (sem 9, formato antigo)
//   - Input 12 dig "55 + DDD + 8" (sem 9, formato antigo) →
//     variante "55 + DDD + 9 + 8" (com 9, formato novo)
//
// Só retorna variantes pra DDDs móveis (>=10). Inputs não-BR ou de
// formatos diferentes retornam slice vazia.
func brazilianMobileVariants(jid types.JID) []types.JID {
	if jid.Server != types.DefaultUserServer {
		return nil
	}
	user := jid.User
	if !strings.HasPrefix(user, "55") {
		return nil
	}
	switch len(user) {
	case 13:
		// 5585 + 9 + 92502010 — tira o '9' do índice 4
		if user[4] != '9' {
			return nil
		}
		return []types.JID{{
			User:   user[:4] + user[5:],
			Server: types.DefaultUserServer,
		}}
	case 12:
		// 5585 + 92502010 — adiciona '9' no índice 4 (entre DDD e número)
		return []types.JID{{
			User:   user[:4] + "9" + user[4:],
			Server: types.DefaultUserServer,
		}}
	}
	return nil
}

func (ic *InstanceClient) cacheRecipient(phoneJID, resolved types.JID) {
	ic.recipientCacheMu.Lock()
	defer ic.recipientCacheMu.Unlock()
	if ic.recipientCache == nil {
		ic.recipientCache = make(map[string]types.JID)
	}
	ic.recipientCache[phoneJID.String()] = resolved
}

// sendMessage resolves the canonical JID/LID then calls SendMessage.
//
// IMPORTANTE: NÃO chamamos ensureLID aqui. Forçar usync em todo send
// (text/image/video/...) saturava o rate-limit do WhatsApp em prod —
// 429 "rate-overlimit" cascateava e até mensagens de texto comuns
// começavam a falhar com "no LID found for X from server".
//
// Pra mensagens normais, o próprio whatsmeow faz lookup de LID quando
// precisa (via cache ou usync interno). Só forçamos via ensureLID em
// caminhos interativos (buttons/pix/template/list) onde o protocolo
// exige LID resolvido ANTES da encrypt e o whatsmeow não faz lookup
// preventivo.
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

// SendTextMessageReply envia uma mensagem de texto citando outra. O recipiente
// vê o quote (preview) acima do texto. quotedID é o stanza_id da msg original;
// quotedParticipant é o JID do remetente da msg citada (necessário em grupos);
// quotedText é o conteúdo real da msg citada — sem isso, o WhatsApp mobile
// renderiza como mensagem nova em vez de quote.
func (ic *InstanceClient) SendTextMessageReply(to, text, quotedID, quotedParticipant, quotedText string) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	// QuotedMessage PRECISA carregar o conteúdo real (mesmo que truncado)
	// pra mobile/desktop renderizarem o bubble de quote corretamente.
	// Placeholder vazio fazia mobile mostrar como msg nova sem o quote.
	if quotedText == "" {
		quotedText = "..." // fallback mínimo: mantém o quote mesmo sem conteúdo
	}
	ci := &waE2E.ContextInfo{
		StanzaID:      proto.String(quotedID),
		QuotedMessage: &waE2E.Message{Conversation: proto.String(quotedText)},
	}
	if quotedParticipant != "" {
		ci.Participant = proto.String(normalizeJID(quotedParticipant))
	}
	msg := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text:        proto.String(text),
			ContextInfo: ci,
		},
	}
	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", fmt.Errorf("send reply failed: %w", err)
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

// SendAudioMessage sends an audio file. seconds é a duração em segundos —
// 0 omite o campo Seconds do proto. Voice notes (ptt=true) sem Seconds
// fazem alguns clientes mostrarem "áudio indisponível" mesmo antes de
// baixar o blob — a UI espera pintar a barra de duração.
func (ic *InstanceClient) SendAudioMessage(to string, audioData []byte, mimeType string, ptt bool, seconds uint32) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}

	upload, err := ic.client.Upload(context.Background(), audioData, whatsmeow.MediaAudio)
	if err != nil {
		return "", fmt.Errorf("upload failed: %w", err)
	}

	// MediaKeyTimestamp continua de fora — esse foi o campo que regrediu
	// no envio quando tentamos antes (alguns recipients rejeitam quando
	// o timestamp não bate com a hora atual do server, ex.: clock skew).
	//
	// Seconds: AGORA é setado quando vier > 0 do caller (ffmpeg detectou
	// a duração real do OGG transcodado). Antes deixávamos vazio,
	// confiando que o recipient parsearia o OGG header — mas alguns
	// clientes (iOS, Android antigos) mostram "áudio indisponível"
	// se Seconds estiver ausente, mesmo com o blob válido. Setar aqui
	// resolve o caso reportado: mics que produzem container ligeiramente
	// diferente (ex.: USB Fifine vs mic embutido) onde o cliente
	// recipient não consegue inferir duração sozinho.
	audio := &waE2E.AudioMessage{
		URL:           proto.String(upload.URL),
		DirectPath:    proto.String(upload.DirectPath),
		Mimetype:      proto.String(mimeType),
		MediaKey:      upload.MediaKey,
		FileEncSHA256: upload.FileEncSHA256,
		FileSHA256:    upload.FileSHA256,
		FileLength:    proto.Uint64(uint64(len(audioData))),
		PTT:           proto.Bool(ptt),
	}
	if seconds > 0 {
		audio.Seconds = proto.Uint32(seconds)
	}
	msg := &waE2E.Message{AudioMessage: audio}

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

// EditMessage edita o texto de uma msg outbound já enviada. WhatsApp só
// aceita edit dentro da janela de 15min (lado do cliente); fora disso o
// envio falha silenciosamente, mas atualizamos no DB de qualquer forma.
func (ic *InstanceClient) EditMessage(chatJID, msgID, newText string) (string, error) {
	chat, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return "", fmt.Errorf("invalid chat JID: %w", err)
	}
	newMsg := &waE2E.Message{
		Conversation: proto.String(newText),
	}
	edit := ic.client.BuildEdit(chat, msgID, newMsg)
	res, err := ic.sendMessage(context.Background(), chat, edit)
	if err != nil {
		return "", fmt.Errorf("edit failed: %w", err)
	}
	return res.ID, nil
}

// OwnerJID retorna o JID da conta da própria instância (Store.ID).
// Vazio se a instância não está autenticada.
func (ic *InstanceClient) OwnerJID() string {
	if ic.client == nil || ic.client.Store == nil || ic.client.Store.ID == nil {
		return ""
	}
	return ic.client.Store.ID.String()
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

// ButtonItem representa um botão interativo do WhatsApp.
//
// Tipos suportados (Type):
//   - "reply" (default) — quick reply, retorna o ID quando clicado
//   - "url"             — abre URL externa (campo URL)
//   - "call"            — disca número (campo Phone)
//   - "copy"            — copia código pra área de transferência (campo CopyCode)
type ButtonItem struct {
	ID       string `json:"id"`
	Text     string `json:"text"`
	Type     string `json:"type"`
	URL      string `json:"url"`
	Phone    string `json:"phone"`
	CopyCode string `json:"copy_code"`
}

type TemplateButtonItem struct {
	DisplayText string `json:"display_text"`
	Type        string `json:"type"`
	ID          string `json:"id"`
	URL         string `json:"url"`
	PhoneNumber string `json:"phone_number"`
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

func buildListTextFallback(title, description, buttonText, footer string, sections []ListSection) string {
	var sb strings.Builder

	appendLine := func(line string) {
		line = strings.TrimSpace(line)
		if line == "" {
			return
		}
		if sb.Len() > 0 {
			sb.WriteString("\n")
		}
		sb.WriteString(line)
	}

	if title != "" {
		appendLine(title)
	}
	if description != "" {
		appendLine(description)
	}
	if buttonText != "" {
		appendLine("")
		appendLine("[" + buttonText + "]")
	}

	for _, section := range sections {
		if len(section.Rows) == 0 {
			continue
		}
		appendLine("")
		if section.Title != "" {
			appendLine("*" + section.Title + "*")
		}
		for idx, row := range section.Rows {
			label := row.Title
			if row.Description != "" {
				label += " - " + row.Description
			}
			appendLine(fmt.Sprintf("%d. %s", idx+1, label))
		}
	}

	if footer != "" {
		appendLine("")
		appendLine("_" + footer + "_")
	}

	return strings.TrimSpace(sb.String())
}

func (ic *InstanceClient) SendButtonsFallbackMessage(to, body, footer string, buttons []ButtonItem) (string, error) {
	return ic.SendTextMessage(to, buildButtonsTextFallback(body, footer, buttons))
}

func (ic *InstanceClient) SendListFallbackMessage(to, title, description, buttonText, footer string, sections []ListSection) (string, error) {
	return ic.SendTextMessage(to, buildListTextFallback(title, description, buttonText, footer, sections))
}

// SendButtonsMessage envia uma mensagem com botões interativos.
//
// Implementação alinhada com Evolution-Go (main, não o PR #40):
// usa InteractiveMessage direto, SEM DocumentWithCaptionMessage wrapper
// e SEM AdditionalNodes biz. Esses dois estavam causando "error 405"
// do server WhatsApp em contas pessoais — o protocolo atual aceita
// InteractiveMessage simples diretamente.
//
// Tipos de botão suportados: quick_reply (text-only), cta_url, cta_call,
// cta_copy. Fallback pra texto formatado em caso de erro.
func (ic *InstanceClient) SendButtonsMessage(to, body, footer string, buttons []ButtonItem) (string, error) {
	if len(buttons) == 0 {
		return "", fmt.Errorf("no buttons provided")
	}
	if len(buttons) > 3 {
		buttons = buttons[:3]
	}

	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	// NÃO chamamos resolveRecipient aqui: ele converteria PN→LID, e o
	// servidor WhatsApp rejeita interactive em LID com 405. Mas
	// normalizamos BR-9 (com/sem nono dígito) via resolveBRPhone — sem
	// isso, mensagens enviadas pra "5585992502010" quando o contato é
	// "558592502010" (ou vice-versa) ficam em pending/timeout.
	recipient = ic.resolveBRPhone(context.Background(), recipient)

	nfButtons := buildNativeFlowButtons(buttons)
	if len(nfButtons) == 0 {
		return "", fmt.Errorf("no valid buttons after parsing")
	}

	// Estrutura que confirmadamente funciona em prod (button reply +
	// template renderizam): wrap em DocumentWithCaptionMessage +
	// AdditionalNodes biz native_flow + MessageSecret + messageParamsJSON
	// from+templateId. NÃO mexer.
	templateID := fmt.Sprintf("%d", time.Now().UnixNano()/1_000_000)
	messageParamsJSON := fmt.Sprintf(`{"from":"api","templateId":"%s"}`, templateID)

	secret := make([]byte, 32)
	_, _ = cryptorand.Read(secret)

	interactive := &waE2E.InteractiveMessage{
		Body: &waE2E.InteractiveMessage_Body{Text: proto.String(body)},
		InteractiveMessage: &waE2E.InteractiveMessage_NativeFlowMessage_{
			NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
				Buttons:           nfButtons,
				MessageParamsJSON: proto.String(messageParamsJSON),
				MessageVersion:    proto.Int32(1),
			},
		},
		ContextInfo: &waE2E.ContextInfo{},
	}
	if footer != "" {
		interactive.Footer = &waE2E.InteractiveMessage_Footer{Text: proto.String(footer)}
	}

	msg := &waE2E.Message{
		DocumentWithCaptionMessage: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				InteractiveMessage: interactive,
				MessageContextInfo: &waE2E.MessageContextInfo{
					MessageSecret: secret,
				},
			},
		},
	}
	bizNodes := buildButtonsBizNodes(true)

	res, err := ic.client.SendMessage(context.Background(), recipient, msg, whatsmeow.SendRequestExtra{
		AdditionalNodes: &bizNodes,
	})
	if err != nil {
		log.Warn().
			Str("instance", ic.ID).
			Str("to", recipient.String()).
			Err(err).
			Msg("interactive button send failed, falling back to text")
		return ic.SendButtonsFallbackMessage(to, body, footer, buttons)
	}
	return res.ID, nil
}

// buildNativeFlowButtons extrai a parte que monta os botões NativeFlow
// de uma lista de ButtonItem — reusada por SendButtonsMessage e funções
// que querem reaproveitar o mesmo formato.
func buildNativeFlowButtons(buttons []ButtonItem) []*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton {
	out := make([]*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton, 0, len(buttons))
	for i, b := range buttons {
		text := strings.TrimSpace(b.Text)
		if text == "" {
			continue
		}
		typ := strings.ToLower(strings.TrimSpace(b.Type))
		if typ == "" {
			switch {
			case strings.TrimSpace(b.URL) != "":
				typ = "url"
			case strings.TrimSpace(b.Phone) != "":
				typ = "call"
			case strings.TrimSpace(b.CopyCode) != "":
				typ = "copy"
			default:
				typ = "reply"
			}
		}
		var name *string
		var paramsJSON *string
		switch typ {
		case "url":
			url := strings.TrimSpace(b.URL)
			if url == "" {
				continue
			}
			name = proto.String("cta_url")
			j, _ := json.Marshal(map[string]string{"display_text": text, "url": url, "merchant_url": url})
			paramsJSON = proto.String(string(j))
		case "call":
			phone := strings.TrimSpace(b.Phone)
			if phone == "" {
				continue
			}
			name = proto.String("cta_call")
			j, _ := json.Marshal(map[string]string{"display_text": text, "phone_number": phone})
			paramsJSON = proto.String(string(j))
		case "copy":
			code := strings.TrimSpace(b.CopyCode)
			if code == "" {
				code = strings.TrimSpace(b.ID)
			}
			id := strings.TrimSpace(b.ID)
			if id == "" {
				id = fmt.Sprintf("copy_%d", i)
			}
			name = proto.String("cta_copy")
			j, _ := json.Marshal(map[string]string{"display_text": text, "id": id, "copy_code": code})
			paramsJSON = proto.String(string(j))
		default: // reply / quick_reply
			id := strings.TrimSpace(b.ID)
			if id == "" {
				id = fmt.Sprintf("btn_%d", i)
			}
			name = proto.String("quick_reply")
			j, _ := json.Marshal(map[string]string{"display_text": text, "id": id})
			paramsJSON = proto.String(string(j))
		}
		out = append(out, &waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton{
			Name:             name,
			ButtonParamsJSON: paramsJSON,
		})
	}
	return out
}


// ensureLID garante que o LID (Linked Identity) do destinatário esteja
// no store local do whatsmeow antes do envio. Sem isso, accounts modernas
// falham com "no LID found for X@s.whatsapp.net from server" no encrypt
// — afeta tanto interactive quanto, em alguns clientes, mensagens normais.
//
// Estratégia em 2 níveis pra não saturar o usync (rate-limit 429):
//
//  1. Consulta o store local primeiro (GetLIDForPN). Cache hit é grátis
//     e cobre 99% dos casos depois da primeira mensagem.
//  2. Cache MISS → cache negativo de 60s na memória do processo pra evitar
//     spam de usync quando o destinatário não está em "lid index" (raro
//     mas existe — ex: número novo). Decorrido 60s, tenta de novo.
//  3. Cache MISS sem TTL ativo → faz client.GetUserInfo([jid]) — usync
//     retorna LID e whatsmeow popula o store. Se 429 vier, retorna nil
//     pra deixar o send tentar (whatsmeow vai falhar com "no LID found"
//     mas a queue vai re-tentar com backoff).
func (ic *InstanceClient) ensureLID(jid types.JID) error {
	if jid.Server != types.DefaultUserServer {
		return nil // grupos/broadcast não usam LID
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	// 1) Cache hit no store local
	lid, _ := ic.client.Store.LIDs.GetLIDForPN(ctx, jid)
	if !lid.IsEmpty() {
		return nil
	}

	// 2) Cache negativo recente — não vale spammar usync
	if ic.lidNegCacheRecent(jid) {
		return nil
	}

	// 3) USync
	if _, err := ic.client.GetUserInfo(ctx, []types.JID{jid}); err != nil {
		ic.lidNegCacheStore(jid)
		// 429 explícito: log baixo (debug) — backoff vem da queue
		if strings.Contains(err.Error(), "429") || strings.Contains(err.Error(), "rate-overlimit") {
			log.Debug().Str("instance", ic.ID).Str("jid", jid.String()).Msg("LID lookup rate-limited, send will likely fail and retry")
		}
		return nil // não bloqueia o envio — deixa o whatsmeow tentar/falhar normal
	}
	return nil
}

// lidNegCache* — cache negativo simples por instância pra evitar disparar
// 100 usync queries por segundo quando o LID realmente não existe pra um
// número (cenário raro). TTL 60s, in-memory only.
const lidNegTTL = 60 * time.Second

func (ic *InstanceClient) lidNegCacheRecent(jid types.JID) bool {
	ic.lidNegMu.Lock()
	defer ic.lidNegMu.Unlock()
	if ic.lidNeg == nil {
		return false
	}
	t, ok := ic.lidNeg[jid.String()]
	if !ok {
		return false
	}
	if time.Since(t) > lidNegTTL {
		delete(ic.lidNeg, jid.String())
		return false
	}
	return true
}
func (ic *InstanceClient) lidNegCacheStore(jid types.JID) {
	ic.lidNegMu.Lock()
	defer ic.lidNegMu.Unlock()
	if ic.lidNeg == nil {
		ic.lidNeg = make(map[string]time.Time)
	}
	ic.lidNeg[jid.String()] = time.Now()
}

// PixData carrega os campos pra montar uma mensagem de cobrança PIX
// (review_and_pay) — botão interativo com chave PIX que o cliente vê
// como um card "Pagar" no WhatsApp e confirma direto no app.
//
// KeyType aceita: CPF, CNPJ, EMAIL, PHONE, EVP (case-insensitive).
type PixData struct {
	HeaderTitle  string // Título do card (ex: "Pagamento")
	BodyText     string // Texto descritivo
	FooterText   string // Rodapé opcional
	MerchantName string // Nome do beneficiário
	PixKey       string // Chave PIX
	KeyType      string // Tipo da chave
}

// SendPixMessage envia uma cobrança PIX interativa via mensagem
// review_and_pay. Replica o protocolo descoberto no PR
// EvolutionAPI/evolution-go#40 (Apr/26): NativeFlowMessage com
// payment_info button + biz/bot AdditionalNodes + DeviceListMetadata v2.
//
// Em caso de erro envia um fallback texto com a chave PIX legível
// (mantém UX coerente em accounts onde o card não renderiza).
func (ic *InstanceClient) SendPixMessage(to string, data PixData) (string, error) {
	if strings.TrimSpace(data.MerchantName) == "" {
		return "", fmt.Errorf("merchantName is required")
	}
	if strings.TrimSpace(data.PixKey) == "" {
		return "", fmt.Errorf("pixKey is required")
	}
	keyType := strings.ToUpper(strings.TrimSpace(data.KeyType))
	switch keyType {
	case "CPF", "CNPJ", "EMAIL", "PHONE", "EVP":
	default:
		return "", fmt.Errorf("keyType inválido (use CPF, CNPJ, EMAIL, PHONE, EVP)")
	}

	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	// BR-9: descobre se contato existe com/sem nono dígito sem
	// converter pra LID (LID é rejeitado em interactive com 405).
	recipient = ic.resolveBRPhone(context.Background(), recipient)

	// Payload review_and_pay — formato esperado pelo WhatsApp 2.x.
	// Valor default é 1 centavo (offset=100 → "0,01") porque o protocolo
	// exige um valor não-zero pra processar a stanza. O recipient confirma
	// o valor real ao finalizar o pagamento no app.
	defaultAmount := map[string]int{"value": 100, "offset": 100}
	referenceID := fmt.Sprintf("%011d", time.Now().UnixNano()%1e11)
	payload := map[string]any{
		"currency":     "BRL",
		"reference_id": referenceID,
		"type":         "physical-goods",
		"total_amount": defaultAmount,
		"order": map[string]any{
			"status":     "pending",
			"order_type": "ORDER",
			"subtotal":   defaultAmount,
			"items": []map[string]any{
				{
					"name":        "Pix",
					"amount":      defaultAmount,
					"quantity":    1,
					"sale_amount": defaultAmount,
				},
			},
		},
		"payment_settings": []map[string]any{
			{
				"type": "pix_static_code",
				"pix_static_code": map[string]string{
					"merchant_name": data.MerchantName,
					"key":           data.PixKey,
					"key_type":      keyType,
				},
			},
		},
	}

	paymentJSON, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("falha ao serializar payload pix: %w", err)
	}

	// Estrutura paritária com PR EvolutionAPI/evolution-go#40 PIX:
	// - InteractiveMessage com Header(Title) + Body + Footer + NativeFlow
	// - MessageContextInfo com DeviceListMetadata (sem MessageSecret)
	// - SEM DocumentWithCaption wrap
	// - biz nodes: <biz><interactive type=native_flow v=1><native_flow name=payment_info/>
	// - + <bot biz_bot="1"/> separado (pra 1:1 chats, não grupos)
	interactive := &waE2E.InteractiveMessage{
		Header: &waE2E.InteractiveMessage_Header{
			Title:              proto.String(data.HeaderTitle),
			HasMediaAttachment: proto.Bool(false),
		},
		Body: &waE2E.InteractiveMessage_Body{Text: proto.String(data.BodyText)},
		InteractiveMessage: &waE2E.InteractiveMessage_NativeFlowMessage_{
			NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
				Buttons: []*waE2E.InteractiveMessage_NativeFlowMessage_NativeFlowButton{{
					Name:             proto.String("payment_info"),
					ButtonParamsJSON: proto.String(string(paymentJSON)),
				}},
				MessageParamsJSON: proto.String(""),
				MessageVersion:    proto.Int32(1),
			},
		},
	}
	if footer := strings.TrimSpace(data.FooterText); footer != "" {
		interactive.Footer = &waE2E.InteractiveMessage_Footer{Text: proto.String(footer)}
	}

	msg := &waE2E.Message{
		InteractiveMessage: interactive,
		MessageContextInfo: &waE2E.MessageContextInfo{
			DeviceListMetadataVersion: proto.Int32(2),
			DeviceListMetadata:        &waE2E.DeviceListMetadata{},
		},
	}

	pixNodes := []waBinary.Node{
		{
			Tag: "biz",
			Content: []waBinary.Node{{
				Tag: "interactive",
				Attrs: waBinary.Attrs{
					"type": "native_flow",
					"v":    "1",
				},
				Content: []waBinary.Node{{
					Tag: "native_flow",
					Attrs: waBinary.Attrs{
						"name": "payment_info",
					},
				}},
			}},
		},
	}
	// Bot node pra 1:1 chats (não grupos). Recipient é PN ou LID, não @g.us.
	if recipient.Server != types.GroupServer {
		pixNodes = append(pixNodes, waBinary.Node{
			Tag: "bot",
			Attrs: waBinary.Attrs{
				"biz_bot": "1",
			},
		})
	}

	res, err := ic.client.SendMessage(context.Background(), recipient, msg, whatsmeow.SendRequestExtra{
		AdditionalNodes: &pixNodes,
	})
	if err != nil {
		log.Warn().Str("instance", ic.ID).Err(err).Msg("PIX send failed, falling back to text")
		fallback := fmt.Sprintf("*%s*\n\n%s\n\n💳 *Pagamento PIX*\nFavor: %s\nChave (%s): `%s`",
			data.HeaderTitle, data.BodyText, data.MerchantName, keyType, data.PixKey)
		if footer := strings.TrimSpace(data.FooterText); footer != "" {
			fallback += "\n\n_" + footer + "_"
		}
		return ic.SendTextMessage(to, fallback)
	}
	return res.ID, nil
}

// SendTemplateMessage redireciona pra SendButtonsMessage. O HydratedTemplate
// (TemplateMessage.HydratedFourRowTemplate) é um formato deprecated do
// WhatsApp Business API antigo — accounts atuais aceitam a stanza (200 OK)
// mas descartam silenciosamente no recipient. NativeFlowMessage via
// SendButtonsMessage é o único caminho que renderiza.
//
// Mapeia TemplateButtonItem (display_text, type, id, url, phone_number)
// pro novo ButtonItem (text, type, id, url, phone). Mesmo limite de 3.
func (ic *InstanceClient) SendTemplateMessage(to, content, footer string, buttons []TemplateButtonItem) (string, error) {
	if len(buttons) == 0 {
		return "", fmt.Errorf("no template buttons provided")
	}
	mapped := make([]ButtonItem, 0, len(buttons))
	for i, b := range buttons {
		text := strings.TrimSpace(b.DisplayText)
		if text == "" {
			continue
		}
		typ := strings.ToLower(strings.TrimSpace(b.Type))
		// Aliases comuns: "quickreply" → "reply".
		if typ == "quickreply" || typ == "quick_reply" {
			typ = "reply"
		}
		id := strings.TrimSpace(b.ID)
		if id == "" {
			id = fmt.Sprintf("template_btn_%d", i)
		}
		mapped = append(mapped, ButtonItem{
			ID:    id,
			Text:  text,
			Type:  typ,
			URL:   b.URL,
			Phone: b.PhoneNumber,
		})
	}
	if len(mapped) == 0 {
		return "", fmt.Errorf("no valid template buttons after mapping")
	}
	return ic.SendButtonsMessage(to, content, footer, mapped)
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

// SendListMessage envia uma mensagem de lista/menu interativa (sections
// com items selecionáveis). Implementa o protocolo atual descoberto no
// PR EvolutionAPI/evolution-go#40: ListMessage envolto em
// DocumentWithCaptionMessage + biz AdditionalNodes "product_list".
//
// Falha → fallback texto formatado.
func (ic *InstanceClient) SendListMessage(to, title, description, buttonText, footer string, sections []ListSection) (string, error) {
	if len(sections) == 0 {
		return "", fmt.Errorf("no sections provided")
	}

	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	// BR-9: descobre se contato existe com/sem nono dígito sem
	// converter pra LID (LID é rejeitado em interactive com 405).
	recipient = ic.resolveBRPhone(context.Background(), recipient)

	// Converte ListSection do nosso formato pro proto whatsmeow.
	protoSections := make([]*waE2E.ListMessage_Section, 0, len(sections))
	for _, s := range sections {
		rows := make([]*waE2E.ListMessage_Row, 0, len(s.Rows))
		for _, r := range s.Rows {
			rows = append(rows, &waE2E.ListMessage_Row{
				RowID:       proto.String(r.ID),
				Title:       proto.String(r.Title),
				Description: proto.String(r.Description),
			})
		}
		protoSections = append(protoSections, &waE2E.ListMessage_Section{
			Title: proto.String(s.Title),
			Rows:  rows,
		})
	}

	// Mesma stack confirmada em prod (Buttons/Template renderizam): wrap +
	// AdditionalNodes biz native_flow. Lista CRUA (sem wrap) não chegava no
	// recipient, mesmo com 200 OK na stanza.
	listType := waE2E.ListMessage_SINGLE_SELECT
	listMsg := &waE2E.ListMessage{
		Title:       proto.String(title),
		Description: proto.String(description),
		ButtonText:  proto.String(buttonText),
		FooterText:  proto.String(footer),
		ListType:    &listType,
		Sections:    protoSections,
	}

	secret := make([]byte, 32)
	_, _ = cryptorand.Read(secret)

	msg := &waE2E.Message{
		DocumentWithCaptionMessage: &waE2E.FutureProofMessage{
			Message: &waE2E.Message{
				ListMessage: listMsg,
				MessageContextInfo: &waE2E.MessageContextInfo{
					MessageSecret: secret,
				},
			},
		},
	}
	// Estrutura paritária com PR EvolutionAPI#40 List: biz com <list>
	// (NÃO <interactive>!) com type=product_list v=2.
	bizNodes := []waBinary.Node{{
		Tag: "biz",
		Content: []waBinary.Node{{
			Tag: "list",
			Attrs: waBinary.Attrs{
				"type": "product_list",
				"v":    "2",
			},
		}},
	}}

	res, err := ic.client.SendMessage(context.Background(), recipient, msg, whatsmeow.SendRequestExtra{
		AdditionalNodes: &bizNodes,
	})
	if err != nil {
		log.Warn().Str("instance", ic.ID).Err(err).Msg("interactive list send failed, falling back to text")
		return ic.SendListFallbackMessage(to, title, description, buttonText, footer, sections)
	}
	return res.ID, nil
}

// CarouselCardHeader controla o cabeçalho de um cartão do carrossel.
// Title é obrigatório. ImageURL/VideoURL são opcionais (mutuamente
// exclusivos; se ambos vierem, ImageURL ganha).
type CarouselCardHeader struct {
	Title    string
	ImageURL string
	VideoURL string
}

// CarouselCard é um cartão do carrossel: cabeçalho, corpo e até 3 botões.
type CarouselCard struct {
	Header  CarouselCardHeader
	Body    string
	Buttons []ButtonItem
}

// SendCarouselMessage envia um carrossel horizontal de cards interativos.
//
// Cada card tem cabeçalho (com mídia opcional), corpo e botões próprios.
// Renderiza como HSCROLL_CARDS no WhatsApp moderno.
//
// Estrutura paritária com PR EvolutionAPI/evolution-go#40 SendCarousel:
//   - InteractiveMessage com CarouselMessage(Cards, HSCROLL_CARDS)
//   - MessageContextInfo com MessageSecret 32B (required pra iOS)
//   - SEM DocumentWithCaption wrap
//   - SEM AdditionalNodes biz nodes
//   - Cada card tem messageParamsJSON {"from":"api","templateId":...} + MessageVersion 1
func (ic *InstanceClient) SendCarouselMessage(to string, cards []CarouselCard) (string, error) {
	if len(cards) == 0 {
		return "", fmt.Errorf("no cards provided")
	}

	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	// BR-9: descobre se contato existe com/sem nono dígito sem
	// converter pra LID (LID é rejeitado em interactive com 405).
	// Esse é o motivo de envios pra número com 9 (quando contato é sem
	// 9 ou vice-versa) ficarem em pending/timeout no carrossel.
	recipient = ic.resolveBRPhone(context.Background(), recipient)

	protoCards := make([]*waE2E.InteractiveMessage, 0, len(cards))
	for _, card := range cards {
		interactiveCard := &waE2E.InteractiveMessage{
			Body: &waE2E.InteractiveMessage_Body{Text: proto.String(card.Body)},
		}

		// Header: Title obrigatório. Imagem/vídeo opcional, com upload.
		header := &waE2E.InteractiveMessage_Header{
			Title:              proto.String(card.Header.Title),
			HasMediaAttachment: proto.Bool(false),
		}
		if u := strings.TrimSpace(card.Header.ImageURL); u != "" {
			if resp, hErr := mediaFetchClient.Get(u); hErr == nil {
				fileData, rdErr := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				if rdErr == nil {
					if uploaded, upErr := ic.client.Upload(context.Background(), fileData, whatsmeow.MediaImage); upErr == nil {
						header.HasMediaAttachment = proto.Bool(true)
						header.Media = &waE2E.InteractiveMessage_Header_ImageMessage{
							ImageMessage: &waE2E.ImageMessage{
								URL:           proto.String(uploaded.URL),
								DirectPath:    proto.String(uploaded.DirectPath),
								MediaKey:      uploaded.MediaKey,
								Mimetype:      proto.String("image/jpeg"),
								FileEncSHA256: uploaded.FileEncSHA256,
								FileSHA256:    uploaded.FileSHA256,
								FileLength:    proto.Uint64(uint64(len(fileData))),
							},
						}
					}
				}
			} else {
				log.Warn().Str("instance", ic.ID).Str("url", u).Err(hErr).Msg("carousel image fetch failed; sending card without media")
			}
		} else if u := strings.TrimSpace(card.Header.VideoURL); u != "" {
			if resp, hErr := mediaFetchClient.Get(u); hErr == nil {
				fileData, rdErr := io.ReadAll(resp.Body)
				_ = resp.Body.Close()
				if rdErr == nil {
					if uploaded, upErr := ic.client.Upload(context.Background(), fileData, whatsmeow.MediaVideo); upErr == nil {
						header.HasMediaAttachment = proto.Bool(true)
						header.Media = &waE2E.InteractiveMessage_Header_VideoMessage{
							VideoMessage: &waE2E.VideoMessage{
								URL:           proto.String(uploaded.URL),
								DirectPath:    proto.String(uploaded.DirectPath),
								MediaKey:      uploaded.MediaKey,
								Mimetype:      proto.String("video/mp4"),
								FileEncSHA256: uploaded.FileEncSHA256,
								FileSHA256:    uploaded.FileSHA256,
								FileLength:    proto.Uint64(uint64(len(fileData))),
							},
						}
					}
				}
			} else {
				log.Warn().Str("instance", ic.ID).Str("url", u).Err(hErr).Msg("carousel video fetch failed; sending card without media")
			}
		}
		interactiveCard.Header = header

		// Botões do card — reusa o builder do SendButtonsMessage.
		nfButtons := buildNativeFlowButtons(card.Buttons)
		templateID := fmt.Sprintf("%d", time.Now().UnixNano()/1_000_000)
		messageParamsJSON := fmt.Sprintf(`{"from":"api","templateId":"%s"}`, templateID)
		interactiveCard.InteractiveMessage = &waE2E.InteractiveMessage_NativeFlowMessage_{
			NativeFlowMessage: &waE2E.InteractiveMessage_NativeFlowMessage{
				Buttons:           nfButtons,
				MessageParamsJSON: proto.String(messageParamsJSON),
				MessageVersion:    proto.Int32(1),
			},
		}

		protoCards = append(protoCards, interactiveCard)
	}

	// MessageSecret 32 bytes — required pra iOS renderizar o carrossel.
	secret := make([]byte, 32)
	_, _ = cryptorand.Read(secret)

	carouselType := waE2E.InteractiveMessage_CarouselMessage_HSCROLL_CARDS
	carouselVersion := int32(1)
	interactiveMsg := &waE2E.InteractiveMessage{
		InteractiveMessage: &waE2E.InteractiveMessage_CarouselMessage_{
			CarouselMessage: &waE2E.InteractiveMessage_CarouselMessage{
				Cards:            protoCards,
				MessageVersion:   &carouselVersion,
				CarouselCardType: &carouselType,
			},
		},
	}

	msg := &waE2E.Message{
		InteractiveMessage: interactiveMsg,
		MessageContextInfo: &waE2E.MessageContextInfo{
			MessageSecret: secret,
		},
	}

	res, err := ic.client.SendMessage(context.Background(), recipient, msg)
	if err != nil {
		log.Warn().Str("instance", ic.ID).Err(err).Msg("carousel send failed")
		return "", err
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
		// Mesmo tratamento dos demais call sites — quando vier áudio Opus
		// em container errado (WebM, ou bytes opacos com mime "ogg") ou o
		// job pediu PTT, transcoda pra OGG/Opus pra evitar "indisponível".
		audioOut, mimeOut, pttOut, secOut := audioData, mime, job.Payload.PTT, uint32(0)
		low := strings.ToLower(mime)
		if job.Payload.PTT || strings.Contains(low, "opus") || strings.Contains(low, "webm") || strings.Contains(low, "ogg") {
			if conv, dur, terr := audioconvert.TranscodeToOggOpus(context.Background(), audioData); terr == nil {
				audioOut = conv
				mimeOut = "audio/ogg; codecs=opus"
				pttOut = true
				secOut = dur
			}
		}
		_, sendErr = ic.SendAudioMessage(job.Payload.To, audioOut, mimeOut, pttOut, secOut)

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

// LookupContact resolves a number or JID, returning canonical contact info when available.
func (ic *InstanceClient) LookupContact(input string) (*ContactLookup, error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		return nil, fmt.Errorf("phone ou jid é obrigatório")
	}

	lookupPhone := raw
	if strings.Contains(raw, "@") {
		jid, err := types.ParseJID(raw)
		if err != nil {
			return nil, fmt.Errorf("jid inválido: %w", err)
		}
		lookupPhone = "+" + jid.User
	} else if !strings.HasPrefix(lookupPhone, "+") {
		lookupPhone = "+" + strings.TrimLeft(lookupPhone, "+")
	}

	resp, err := ic.client.IsOnWhatsApp(context.Background(), []string{lookupPhone})
	if err != nil {
		return nil, fmt.Errorf("lookup contact failed: %w", err)
	}

	result := &ContactLookup{Query: raw}
	if len(resp) == 0 || !resp[0].IsIn {
		return result, nil
	}

	canonical := resp[0].JID
	if canonical.IsEmpty() {
		return result, nil
	}

	result.Exists = true
	result.JID = canonical.String()
	result.Phone = canonical.User

	_, _ = ic.client.GetUserInfo(context.Background(), []types.JID{canonical})
	name, pushName := ic.GetContactInfo(canonical.String())
	result.Name = name
	result.PushName = pushName
	result.AvatarURL = ic.GetContactProfilePicture(canonical.String())

	return result, nil
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

// BroadcastWS is the public entry point so other packages (inbox handler) can
// push real-time events to connected clients without importing unexported
// machinery. Delegates to the unexported implementation.
func (ic *InstanceClient) BroadcastWS(msgType string, data interface{}) {
	ic.broadcastWS(msgType, data)
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

// addJIDDuality enriquece um payload de webhook com as duas formas de
// identidade (PN @s.whatsapp.net e LID @lid) a partir de um MessageSource.
//
// Why: o WhatsApp/whatsmeow alterna entre PN e LID no campo Sender/Chat
// dependendo do tipo de chat, privacidade do contato e versão do protocolo.
// Consumidores do webhook que usam `from`/`chat` como chave de identidade
// acabam duplicando contatos. Expor `*_pn` e `*_lid` resolvidos elimina
// a ambiguidade.
//
// Comportamento:
//   - `addressing_mode`: "pn" ou "lid" (qual forma o servidor usou no Sender).
//   - `from_pn` / `from_lid`: par resolvido do Sender via SenderAlt.
//   - `chat_pn` / `chat_lid`: par resolvido do Chat (apenas DMs — em grupos
//     o Chat é sempre @g.us e não tem dualidade).
func addJIDDuality(data map[string]interface{}, src types.MessageSource) {
	data["addressing_mode"] = string(src.AddressingMode)

	// Sender: a forma "principal" depende do AddressingMode; a outra está em SenderAlt.
	if src.AddressingMode == types.AddressingModeLID {
		data["from_lid"] = src.Sender.String()
		if !src.SenderAlt.IsEmpty() {
			data["from_pn"] = src.SenderAlt.String()
		}
	} else {
		data["from_pn"] = src.Sender.String()
		if !src.SenderAlt.IsEmpty() {
			data["from_lid"] = src.SenderAlt.String()
		}
	}

	// Chat: só em DMs faz sentido ter dualidade (em grupos o Chat é @g.us).
	if !src.IsGroup && !src.Chat.IsEmpty() {
		if src.Chat.Server == types.HiddenUserServer { // @lid
			data["chat_lid"] = src.Chat.String()
			if !src.RecipientAlt.IsEmpty() {
				data["chat_pn"] = src.RecipientAlt.String()
			}
		} else {
			data["chat_pn"] = src.Chat.String()
			if !src.RecipientAlt.IsEmpty() {
				data["chat_lid"] = src.RecipientAlt.String()
			}
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
		// Resposta de botão clicado (ButtonsMessage legado).
		// Vem como mensagem normal pra journey/inbox: text = display_text do botão.
		case v.Message.GetButtonsResponseMessage() != nil:
			br := v.Message.GetButtonsResponseMessage()
			text = br.GetSelectedDisplayText()
			if text == "" {
				text = br.GetSelectedButtonID()
			}
		// Resposta de botão TemplateMessage (HydratedTemplate).
		case v.Message.GetTemplateButtonReplyMessage() != nil:
			br := v.Message.GetTemplateButtonReplyMessage()
			text = br.GetSelectedDisplayText()
			if text == "" {
				text = br.GetSelectedID()
			}
		// Resposta de InteractiveMessage (NativeFlow native_reply).
		// O ButtonsResponse moderno vem aqui — quick_reply, cta_url click, etc.
		case v.Message.GetInteractiveResponseMessage() != nil:
			ir := v.Message.GetInteractiveResponseMessage()
			if body := ir.GetBody(); body != nil {
				text = body.GetText()
			}
			// NativeFlowResponseMessage tem ParamsJSON com {"id": "<button_id>"}.
			if text == "" {
				if nf := ir.GetNativeFlowResponseMessage(); nf != nil {
					text = nf.GetParamsJSON()
				}
			}
		// Resposta de ListMessage (item da lista selecionado).
		case v.Message.GetListResponseMessage() != nil:
			lr := v.Message.GetListResponseMessage()
			text = lr.GetTitle()
			if text == "" {
				if ssr := lr.GetSingleSelectReply(); ssr != nil {
					text = ssr.GetSelectedRowID()
				}
			}
		case v.Message.GetImageMessage() != nil:
			msgType = "image"
			text = v.Message.GetImageMessage().GetCaption()
		case v.Message.GetVideoMessage() != nil:
			vm := v.Message.GetVideoMessage()
			// GIFs no WhatsApp chegam como VideoMessage com gifPlayback=true.
			// Marcamos como type="gif" pra UI renderizar com autoplay+loop+muted
			// e ratio fixo (não precisa de controles).
			if vm.GetGifPlayback() {
				msgType = "gif"
			} else {
				msgType = "video"
			}
			text = vm.GetCaption()
		case v.Message.GetAudioMessage() != nil:
			msgType = "audio"
		case v.Message.GetDocumentMessage() != nil:
			msgType = "document"
			text = v.Message.GetDocumentMessage().GetFileName()
		case v.Message.GetStickerMessage() != nil:
			msgType = "sticker"
		case v.Message.GetLocationMessage() != nil:
			msgType = "location"
			loc := v.Message.GetLocationMessage()
			// Salva JSON estruturado: front renderiza mapa preview + link.
			payload := map[string]any{
				"latitude":  loc.GetDegreesLatitude(),
				"longitude": loc.GetDegreesLongitude(),
			}
			if n := loc.GetName(); n != "" {
				payload["name"] = n
			}
			if a := loc.GetAddress(); a != "" {
				payload["address"] = a
			}
			if b, err := json.Marshal(payload); err == nil {
				text = string(b)
			}
		case v.Message.GetLiveLocationMessage() != nil:
			msgType = "live_location"
			ll := v.Message.GetLiveLocationMessage()
			payload := map[string]any{
				"latitude":  ll.GetDegreesLatitude(),
				"longitude": ll.GetDegreesLongitude(),
				"is_live":   true,
			}
			if dur := ll.GetTimeOffset(); dur > 0 {
				payload["duration_sec"] = int(dur)
			}
			if cap := ll.GetCaption(); cap != "" {
				payload["caption"] = cap
			}
			if b, err := json.Marshal(payload); err == nil {
				text = string(b)
			}
		case v.Message.GetReactionMessage() != nil:
			msgType = "reaction"
			text = v.Message.GetReactionMessage().GetText()
		case v.Message.GetPollCreationMessage() != nil:
			msgType = "poll"
			poll := v.Message.GetPollCreationMessage()
			options := make([]map[string]string, 0, len(poll.GetOptions()))
			for _, opt := range poll.GetOptions() {
				options = append(options, map[string]string{"name": opt.GetOptionName()})
			}
			payload := map[string]any{
				"question": poll.GetName(),
				"options":  options,
				"multi":    poll.GetSelectableOptionsCount() != 1,
			}
			if b, err := json.Marshal(payload); err == nil {
				text = string(b)
			}
		case v.Message.GetContactMessage() != nil:
			msgType = "contact"
			ct := v.Message.GetContactMessage()
			// Parse vCard pra extrair nome + telefones (FN, TEL).
			payload := map[string]any{
				"display_name": ct.GetDisplayName(),
				"vcard":        ct.GetVcard(),
				"phones":       parseVCardPhones(ct.GetVcard()),
			}
			if b, err := json.Marshal(payload); err == nil {
				text = string(b)
			}
		case v.Message.GetContactsArrayMessage() != nil:
			msgType = "contacts"
			arr := v.Message.GetContactsArrayMessage()
			contacts := make([]map[string]any, 0, len(arr.GetContacts()))
			for _, ct := range arr.GetContacts() {
				contacts = append(contacts, map[string]any{
					"display_name": ct.GetDisplayName(),
					"phones":       parseVCardPhones(ct.GetVcard()),
				})
			}
			payload := map[string]any{
				"contacts": contacts,
				"label":    arr.GetDisplayName(),
			}
			if b, err := json.Marshal(payload); err == nil {
				text = string(b)
			}
		case v.Message.GetInteractiveMessage() != nil:
			msgType = "interactive"
			if payload := extractInteractivePayload(v.Message.GetInteractiveMessage()); payload != "" {
				text = payload
			} else {
				text = "Mensagem interativa"
			}
		case v.Message.GetListMessage() != nil:
			msgType = "list"
			if payload := extractListPayload(v.Message.GetListMessage()); payload != "" {
				text = payload
			} else {
				text = "Lista de opções"
			}
		case v.Message.GetButtonsMessage() != nil:
			msgType = "buttons"
			if payload := extractButtonsPayload(v.Message.GetButtonsMessage()); payload != "" {
				text = payload
			} else {
				text = "Mensagem com botões"
			}
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
		addJIDDuality(data, v.Info.MessageSource)
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

		// Evento dedicado por tipo de mídia — facilita webhooks filtrarem
		// sem ter que inspecionar o campo `type` do payload genérico.
		if !isFromMe && !v.IsEdit && msgType != "text" && msgType != "reaction" {
			typedEv := "message." + msgType // message.location, message.image, message.audio, …
			ic.broadcastWS(typedEv, data)
			ic.dispatchEvent(typedEv, data, ctx)
		}

		// Save message to database for inbox (including groups)
		var direction models.MessageDirection
		if isFromMe {
			direction = models.DirectionOut
		} else {
			direction = models.DirectionIn
		}

		// Mídia inbound: tentar baixar do servidor WhatsApp e subir pro
		// MinIO. Quando há mídia (image/video/audio/document/sticker), o
		// helper retorna SEMPRE um JSON: com `url` se baixou, com `error`
		// se falhou. UI usa esse JSON pra renderizar <img>/<audio>/<video>
		// (ou IconFallback no caso de erro). Tipos sem mídia (text/reaction
		// /protocol/location) ignoram e mantém msgText = text original.
		msgText := text
		isMediaType := msgType == "image" || msgType == "video" || msgType == "gif" ||
			msgType == "audio" || msgType == "document" || msgType == "sticker"
		if isMediaType && !v.IsEdit {
			// `ctx` neste escopo é eventContext, não context.Context — uso
			// background com timeout próprio dentro do helper.
			// GIF: passa "video" pro download (whatsmeow trata igual), mas
			// preserva msgType="gif" pra UI renderizar diferente.
			downloadType := msgType
			if downloadType == "gif" {
				downloadType = "video"
			}
			msgText = ic.downloadAndStoreInboundMedia(context.Background(), v, downloadType, text)
			// Re-injeta o flag is_gif no JSON resultante pra UI saber.
			if msgType == "gif" {
				msgText = injectFlag(msgText, "is_gif", true)
			}
		}
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
			case "poll":
				msgText = "📊 Enquete"
			case "reaction":
				msgText = "👍 Reação"
			case "protocol":
				msgText = "Mensagem removida"
			default:
				// Evita mostrar literalmente "text" quando o conteúdo chega vazio
				// (acontece com reações, edits silenciosos, tipos desconhecidos).
				msgText = "—"
			}
		}
		chatJID := ic.resolveChatPNJID(v.Info).String()
		pushName := v.Info.PushName
		isGroupMsg := v.Info.Chat.Server == types.GroupServer
		log.Printf("DEBUG: Saving message - chatJID=%s, pushName=%s, isGroup=%v", chatJID, pushName, isGroupMsg)
		senderJID := v.Info.Sender.String()
		if !isGroupMsg && v.Info.Sender.Server == types.HiddenUserServer && !v.Info.SenderAlt.IsEmpty() && v.Info.SenderAlt.Server == types.DefaultUserServer {
			senderJID = v.Info.SenderAlt.String()
		}
		// Captura quoted ANTES da goroutine — v.Message é shared state e a
		// goroutine pode rodar depois do whatsmeow recyclar o ponteiro.
		quotedStanzaID := extractQuotedStanzaID(v.Message)
		externalMsgID := v.Info.ID
		isEdit := v.IsEdit
		go func() {
			if GlobalManager == nil {
				return
			}
			// Edit: atualiza a MessageLog original (não cria nova).
			// Em IsEdit, quotedStanzaID aponta pra msg original.
			if isEdit && quotedStanzaID != "" {
				if GlobalManager.UpdateEditedMessage(ic.ID, quotedStanzaID, msgText) {
					return
				}
				// Se não achamos a msg original, cai pro insert (fallback)
			}
			_ = GlobalManager.SaveMessageEx(SaveMessageInput{
				InstanceID:        ic.ID,
				ToJID:             chatJID,
				Content:           msgText,
				Direction:         direction,
				Type:              msgType,
				PushName:          pushName,
				IsGroup:           isGroupMsg,
				SenderJID:         senderJID,
				ExternalMessageID: externalMsgID,
				ReplyToExternalID: quotedStanzaID,
			})
		}()

		// Check and execute journeys for incoming messages
		if evName == "message.received" && !isFromMe {
			if GlobalManager != nil {
				journeyChatJID := chatJID
				journeySenderJID := senderJID
				pushName := v.Info.PushName
				if pushName == "" {
					pushName = "Cliente"
				}
				isGroup := isGroupMsg
				messageID := v.Info.ID // usado para dedup — evita loop em history-sync
				go GlobalManager.HandleIncomingAutomation(ic.ID, messageID, journeySenderJID, pushName, journeyChatJID, text, msgType, isGroup)
			}
		}
		// isFromMe (mensagem enviada do celular/desktop direto pelo WhatsApp,
		// fora da plataforma) é tratado dentro do SaveMessage agora — ele
		// dispara o ProcessSavedOutbound automaticamente pra ligar à
		// Conversation correta. Não dispara journey (não faz sentido o owner
		// triggerar a própria automação).

	// ── Read receipts / delivery ─────────────────────────────────────────────
	case *events.Receipt:
		data := map[string]interface{}{
			"ids":       v.MessageIDs,
			"from":      v.Sender.String(),
			"chat":      v.Chat.String(),
			"type":      string(v.Type),
			"timestamp": v.Timestamp,
		}
		addJIDDuality(data, v.MessageSource)
		ic.broadcastWS("message.status", data)
		ic.dispatchEvent("message.status", data, eventContext{isGroup: v.Chat.Server == "g.us"})

		// Persiste receipt — atualiza MessageLog.Status + delivered_at/read_at.
		// Mapeamento: "" (default) e "delivery" → delivered, "read"/"read-self"
		// → read. Em grupo, registramos também a tabela message_receipts pra
		// painel "Visto por" (handled em #9).
		if GlobalManager != nil && len(v.MessageIDs) > 0 {
			isGroup := v.Chat.Server == types.GroupServer
			rt := v.Type
			senderJID := v.Sender.String()
			ts := v.Timestamp
			ids := append([]string{}, v.MessageIDs...) // copy: shared slice
			go GlobalManager.ApplyReceipt(ic.ID, ids, string(rt), senderJID, ts, isGroup)
		}

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
		addJIDDuality(data, v.MessageSource)
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
			// Persistência: o evento já carrega o nome resolvido. Antes só
			// virava webhook — agora também atualizamos cache + tabelas
			// pra que conversas que estavam com fallback "Grupo 5511..."
			// recebam o subject correto sem esperar uma nova mensagem.
			if v.Name.Name != "" && ic.manager != nil {
				groupNameCache.Store(v.JID.String(), v.Name.Name)
				applyGroupName(ic.manager, ic.ID, v.JID.String(), v.Name.Name)
			}
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
		ic.acceptedCalls.Store(v.CallID, time.Now())
		data := map[string]interface{}{
			"call_id": v.CallID,
			"from":    v.From.String(),
			"type":    "accept",
		}
		ic.broadcastWS("call.accepted", data)
		ic.dispatchEvent("call.accepted", data, eventContext{})

	case *events.CallTerminate:
		// Se NÃO houve aceite pra esse call_id, é uma chamada perdida.
		// Emitimos evento dedicado + disparamos jornada com messageType=call_missed.
		startedAtRaw, accepted := ic.acceptedCalls.LoadAndDelete(v.CallID)
		var durationSec int
		if accepted {
			if startedAt, ok := startedAtRaw.(time.Time); ok {
				durationSec = int(time.Since(startedAt).Seconds())
			}
		}
		callStatus := "missed"
		if accepted {
			callStatus = "answered"
		}
		data := map[string]interface{}{
			"call_id":  v.CallID,
			"from":     v.From.String(),
			"reason":   v.Reason,
			"accepted": accepted,
		}
		ic.broadcastWS("call.terminate", data)
		ic.dispatchEvent("call.terminate", data, eventContext{})

		// Persiste como MessageLog tipo "call" — aparece na timeline com
		// card de chamada perdida/atendida + duração.
		if GlobalManager != nil {
			callPayload := map[string]any{
				"call_type":   "voice",
				"call_status": callStatus,
			}
			if durationSec > 0 {
				callPayload["call_duration_sec"] = durationSec
			}
			if v.Reason != "" {
				callPayload["reason"] = v.Reason
			}
			if data, err := json.Marshal(callPayload); err == nil {
				go func() {
					_ = GlobalManager.SaveMessageEx(SaveMessageInput{
						InstanceID:        ic.ID,
						ToJID:             v.From.String(),
						Content:           string(data),
						Direction:         models.DirectionIn,
						Type:              "call",
						SenderJID:         v.From.String(),
						ExternalMessageID: "call:" + v.CallID,
					})
				}()
			}
		}

		if !accepted && GlobalManager != nil {
			missedData := map[string]interface{}{
				"call_id": v.CallID,
				"from":    v.From.String(),
				"reason":  v.Reason,
			}
			ic.broadcastWS("call.missed", missedData)
			ic.dispatchEvent("call.missed", missedData, eventContext{})
			go GlobalManager.CheckJourneys(
				ic.ID,
				"call:"+v.CallID, // messageID pra dedup
				v.From.String(),  // fromJID
				"",               // fromName (não temos push name aqui)
				"",               // groupJID — ligações não são de grupo
				"",               // messageText vazio
				"call_missed",    // messageType
				false,            // isGroup
			)
		}

	case *events.CallReject:
		ic.acceptedCalls.Delete(v.CallID)
		data := map[string]interface{}{
			"call_id": v.CallID,
			"from":    v.From.String(),
		}
		ic.broadcastWS("call.rejected", data)
		ic.dispatchEvent("call.rejected", data, eventContext{})

		// Persiste como MessageLog tipo "call" status=rejected
		if GlobalManager != nil {
			payload := map[string]any{
				"call_type":   "voice",
				"call_status": "rejected",
			}
			if data, err := json.Marshal(payload); err == nil {
				go func() {
					_ = GlobalManager.SaveMessageEx(SaveMessageInput{
						InstanceID:        ic.ID,
						ToJID:             v.From.String(),
						Content:           string(data),
						Direction:         models.DirectionIn,
						Type:              "call",
						SenderJID:         v.From.String(),
						ExternalMessageID: "call-rejected:" + v.CallID,
					})
				}()
			}
		}

		if GlobalManager != nil {
			go GlobalManager.CheckJourneys(
				ic.ID,
				"call-rejected:"+v.CallID,
				v.From.String(), "", "", "", "call_rejected", false,
			)
		}

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
		// Persistência: atualiza Contact e propaga em MessageLog/Conversation
		// pra mensagens que ainda mostravam o número como nome. Sem isso o
		// evento virava só webhook e o nome só aparecia depois da próxima
		// mensagem entrar no pipeline.
		if v.NewPushName != "" && ic.manager != nil {
			upsertPushName(ic.manager, ic.ID, v.JID.String(), v.NewPushName)
		}

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
		// Persistência: nome resolvido pelo whatsmeow (vem da agenda salva
		// no celular do usuário). Mesmo motivo do PushName acima.
		if v.Action != nil && v.Action.GetFullName() != "" && ic.manager != nil {
			upsertPushName(ic.manager, ic.ID, v.JID.String(), v.Action.GetFullName())
		}

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
		// events.Connected fires as soon as the WebSocket handshake
		// completes — including for a brand-new instance that is still
		// showing a QR code. Only report "connected" when the store
		// already has a paired account; otherwise pairing will emit
		// events.PairSuccess, which is where we flip the status.
		if ic.client.IsLoggedIn() && ic.client.Store.ID != nil {
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
		} else {
			log.Debug().Str("instance", ic.ID).Msg("WebSocket connected but not logged in yet — waiting for QR pairing")
		}

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

// downloadAndStoreInboundMedia baixa mídia inbound do servidor WhatsApp
// e sobe pro MinIO/S3. Retorna SEMPRE um JSON serializado pro
// MessageLog.Content — com `url` quando deu certo, com `error` quando
// falhou. A UI parseia e renderiza adequadamente. `caption` é o texto
// que vem junto da mídia (image/video têm caption, audio/sticker não).
func (ic *InstanceClient) downloadAndStoreInboundMedia(
	ctx context.Context, v *events.Message, msgType, caption string,
) string {
	out := map[string]interface{}{}
	if caption != "" {
		out["caption"] = caption
	}
	// Flags de TTL/visibilidade — view-once aparece como badge específico
	// na UI; ephemeral é mensagem com timer de auto-delete (TTL global do chat).
	if v.IsViewOnce || v.IsViewOnceV2 || v.IsViewOnceV2Extension {
		out["is_view_once"] = true
	}
	if v.IsEphemeral {
		out["is_ephemeral"] = true
	}

	// Sem MinIO configurado, retorna JSON com error pra a UI mostrar
	// IconFallback ao invés de tentar carregar URL inexistente.
	if !storage.IsConfigured() {
		out["error"] = "armazenamento de mídia não configurado"
		out["type"] = msgType
		b, _ := json.Marshal(out)
		return string(b)
	}

	if ic.client == nil {
		out["error"] = "cliente desconectado"
		out["type"] = msgType
		b, _ := json.Marshal(out)
		return string(b)
	}

	// Pega o mime type e filename do tipo específico de mensagem.
	var mime, filename string
	switch msgType {
	case "image":
		if m := v.Message.GetImageMessage(); m != nil {
			mime = m.GetMimetype()
		}
	case "video":
		if m := v.Message.GetVideoMessage(); m != nil {
			mime = m.GetMimetype()
		}
	case "audio":
		if m := v.Message.GetAudioMessage(); m != nil {
			mime = m.GetMimetype()
			if m.GetPTT() {
				out["ptt"] = true
			}
			if d := m.GetSeconds(); d > 0 {
				out["duration_sec"] = int(d)
			}
		}
	case "document":
		if m := v.Message.GetDocumentMessage(); m != nil {
			mime = m.GetMimetype()
			filename = m.GetFileName()
		}
	case "sticker":
		if m := v.Message.GetStickerMessage(); m != nil {
			mime = m.GetMimetype()
		}
	}
	if mime == "" {
		mime = "application/octet-stream"
	}

	// DownloadAny lida com qualquer tipo de mídia inbound.
	dlCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	data, err := ic.client.DownloadAny(dlCtx, v.Message)
	if err != nil {
		log.Warn().Err(err).Str("instance", ic.ID).Str("type", msgType).
			Msg("media download failed")
		out["error"] = "falha ao baixar mídia: " + err.Error()
		out["mime_type"] = mime
		if filename != "" {
			out["filename"] = filename
		}
		b, _ := json.Marshal(out)
		return string(b)
	}

	// Sobe pro MinIO/S3. UploadBytes retorna a URL pública (se bucket
	// for público) — guardamos o objectName (key) pro caso de bucket
	// private com signed URLs. Resolver de URL roda no Timeline handler.
	ext := storage.MimeToExt(mime)
	objectName := storage.MediaObjectName(ic.ID, ext)
	_, err = storage.GlobalStorage.UploadBytes(dlCtx, objectName, data, mime)
	if err != nil {
		log.Warn().Err(err).Str("instance", ic.ID).Str("type", msgType).
			Msg("media upload failed")
		out["error"] = "falha ao salvar mídia: " + err.Error()
		out["mime_type"] = mime
		if filename != "" {
			out["filename"] = filename
		}
		b, _ := json.Marshal(out)
		return string(b)
	}

	// `media_key` é a chave no bucket — Timeline handler converte pra
	// URL assinada na hora de servir pro front. `url` (pública) é só
	// fallback pra buckets configurados como public — em private retorna
	// 403, então o front nunca usa direto.
	out["media_key"] = objectName
	out["url"] = storage.GlobalStorage.PublicURL(objectName)
	out["mime_type"] = mime
	out["size_bytes"] = len(data)
	if filename != "" {
		out["filename"] = filename
	}
	out["type"] = msgType

	b, _ := json.Marshal(out)
	return string(b)
}

// injectFlag adiciona uma chave booleana no JSON content. Se content não
// é JSON válido, retorna como veio. Usado pra anexar flags como is_gif sem
// re-rodar todo o pipeline de mídia.
func injectFlag(content, key string, value bool) string {
	var obj map[string]any
	if err := json.Unmarshal([]byte(content), &obj); err != nil {
		return content
	}
	obj[key] = value
	out, err := json.Marshal(obj)
	if err != nil {
		return content
	}
	return string(out)
}

// extractQuotedStanzaID busca o stanza_id da msg citada via ContextInfo
// dos vários sub-tipos de mensagem. Retorna "" se não houver quote.
// O stanza_id é usado pelo Manager.SaveMessageEx pra correlacionar
// com a MessageLog.ExternalMessageID e popular ReplyToID.
func extractQuotedStanzaID(msg *waE2E.Message) string {
	if msg == nil {
		return ""
	}
	type ctxer interface{ GetContextInfo() *waE2E.ContextInfo }
	var ci *waE2E.ContextInfo
	switch {
	case msg.GetExtendedTextMessage() != nil:
		ci = msg.GetExtendedTextMessage().GetContextInfo()
	case msg.GetImageMessage() != nil:
		ci = msg.GetImageMessage().GetContextInfo()
	case msg.GetVideoMessage() != nil:
		ci = msg.GetVideoMessage().GetContextInfo()
	case msg.GetAudioMessage() != nil:
		ci = msg.GetAudioMessage().GetContextInfo()
	case msg.GetDocumentMessage() != nil:
		ci = msg.GetDocumentMessage().GetContextInfo()
	case msg.GetStickerMessage() != nil:
		if any := any(msg.GetStickerMessage()).(ctxer); any != nil {
			ci = any.GetContextInfo()
		}
	case msg.GetContactMessage() != nil:
		if any := any(msg.GetContactMessage()).(ctxer); any != nil {
			ci = any.GetContextInfo()
		}
	case msg.GetLocationMessage() != nil:
		if any := any(msg.GetLocationMessage()).(ctxer); any != nil {
			ci = any.GetContextInfo()
		}
	case msg.GetButtonsMessage() != nil:
		ci = msg.GetButtonsMessage().GetContextInfo()
	case msg.GetListMessage() != nil:
		ci = msg.GetListMessage().GetContextInfo()
	case msg.GetInteractiveMessage() != nil:
		ci = msg.GetInteractiveMessage().GetContextInfo()
	}
	if ci == nil {
		return ""
	}
	if ci.GetQuotedMessage() == nil && ci.GetStanzaID() == "" {
		return ""
	}
	return ci.GetStanzaID()
}

// extractButtonsPayload converte ButtonsMessage em JSON estruturado
// {body, footer, buttons: [{id,title}]} pro frontend renderizar como CTAs.
func extractButtonsPayload(b *waE2E.ButtonsMessage) string {
	if b == nil {
		return ""
	}
	out := map[string]any{}
	if t := b.GetContentText(); t != "" {
		out["body"] = t
	}
	if f := b.GetFooterText(); f != "" {
		out["footer"] = f
	}
	btns := make([]map[string]string, 0, len(b.GetButtons()))
	for _, btn := range b.GetButtons() {
		entry := map[string]string{"id": btn.GetButtonID()}
		if r := btn.GetButtonText(); r != nil {
			entry["title"] = r.GetDisplayText()
		}
		btns = append(btns, entry)
	}
	if len(btns) > 0 {
		out["buttons"] = btns
	}
	if data, err := json.Marshal(out); err == nil {
		return string(data)
	}
	return ""
}

// extractListPayload converte ListMessage em JSON estruturado
// {title, body, footer, button_text, sections:[{title, rows:[{id,title,description}]}]}.
// Title vai TANTO em list_title (mantém compat) QUANTO em header (frontend
// renderiza `parsed.listHeader` baseado em parsed.header — sem isso o
// header ficava vazio na UI).
func extractListPayload(l *waE2E.ListMessage) string {
	if l == nil {
		return ""
	}
	out := map[string]any{}
	if v := l.GetTitle(); v != "" {
		out["list_title"] = v
		out["header"] = v // duplicação intencional pro frontend listHeader
	}
	if v := l.GetDescription(); v != "" {
		out["body"] = v
	}
	if v := l.GetFooterText(); v != "" {
		out["footer"] = v
	}
	if v := l.GetButtonText(); v != "" {
		out["button_text"] = v
	}
	sections := make([]map[string]any, 0, len(l.GetSections()))
	for _, sec := range l.GetSections() {
		rows := make([]map[string]string, 0, len(sec.GetRows()))
		for _, r := range sec.GetRows() {
			rows = append(rows, map[string]string{
				"id":          r.GetRowID(),
				"title":       r.GetTitle(),
				"description": r.GetDescription(),
			})
		}
		sections = append(sections, map[string]any{
			"title": sec.GetTitle(),
			"rows":  rows,
		})
	}
	if len(sections) > 0 {
		out["sections"] = sections
	}
	if data, err := json.Marshal(out); err == nil {
		return string(data)
	}
	return ""
}

// extractInteractivePayload — InteractiveMessage tem um Body+NativeFlow
// com botões. Converte pro mesmo formato {body, buttons[]} pra unificar
// renderização no front. NativeFlow buttons trazem ButtonParamsJSON
// (string JSON com display_text/id/url) — parseamos pra extrair só o
// texto exibível em vez de mostrar o JSON cru pro agente.
func extractInteractivePayload(im *waE2E.InteractiveMessage) string {
	if im == nil {
		return ""
	}
	out := map[string]any{}
	// interactive como OBJETO (não booleano) pra casar com a tipagem do
	// front. Antes era `"interactive": true` e o ParsedContent espera
	// {header, body, footer} — viraja undefined no acesso e header/footer
	// nunca renderizavam.
	interactive := map[string]any{}
	if header := im.GetHeader(); header != nil && header.GetTitle() != "" {
		interactive["header"] = header.GetTitle()
		out["header"] = header.GetTitle() // top-level pra parser de listHeader
	}
	if body := im.GetBody(); body != nil && body.GetText() != "" {
		out["body"] = body.GetText()
		interactive["body"] = body.GetText()
	}
	if footer := im.GetFooter(); footer != nil && footer.GetText() != "" {
		out["footer"] = footer.GetText()
		interactive["footer"] = footer.GetText()
	}
	if nf := im.GetNativeFlowMessage(); nf != nil {
		btns := make([]map[string]string, 0, len(nf.GetButtons()))
		for _, b := range nf.GetButtons() {
			// ButtonParamsJSON é uma string JSON tipo
			//   {"display_text":"Click","id":"x"}        (quick_reply)
			//   {"display_text":"Visit","url":"https..."} (cta_url)
			// Extraímos display_text/id/url; sem isso o frontend mostrava
			// o JSON inteiro como rótulo do botão, ilegível.
			label := ""
			id := ""
			url := ""
			if pj := b.GetButtonParamsJSON(); pj != "" {
				var params map[string]any
				if err := json.Unmarshal([]byte(pj), &params); err == nil {
					if v, ok := params["display_text"].(string); ok {
						label = v
					}
					if v, ok := params["id"].(string); ok {
						id = v
					}
					if v, ok := params["url"].(string); ok {
						url = v
					}
				}
			}
			if label == "" {
				label = b.GetName() // "quick_reply"/"cta_url" como fallback
			}
			entry := map[string]string{"id": id, "title": label}
			if url != "" {
				entry["url"] = url
			}
			btns = append(btns, entry)
		}
		if len(btns) > 0 {
			out["buttons"] = btns
		}
	}
	out["interactive"] = interactive
	if data, err := json.Marshal(out); err == nil {
		return string(data)
	}
	return ""
}

// parseVCardPhones extrai todos os telefones de um vCard (formato RFC 6350).
// Aceita TEL com ou sem types (TYPE=CELL, TYPE=WORK, etc). Útil pra cartões
// de contato compartilhados via WhatsApp — o front renderiza cada telefone
// com seu type pra agente reconhecer pessoal/trabalho/celular.
func parseVCardPhones(vcard string) []map[string]string {
	if vcard == "" {
		return nil
	}
	var phones []map[string]string
	for _, raw := range strings.Split(vcard, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		upper := strings.ToUpper(line)
		if !strings.HasPrefix(upper, "TEL") {
			continue
		}
		colonIdx := strings.Index(line, ":")
		if colonIdx < 0 {
			continue
		}
		header := line[:colonIdx]
		number := strings.TrimSpace(line[colonIdx+1:])
		if number == "" {
			continue
		}
		// Tipo (se presente): TEL;TYPE=CELL → "cell"
		phType := ""
		for _, part := range strings.Split(header, ";") {
			if strings.HasPrefix(strings.ToUpper(part), "TYPE=") {
				phType = strings.ToLower(strings.TrimPrefix(part, "TYPE="))
				phType = strings.TrimPrefix(phType, "type=")
				break
			}
		}
		entry := map[string]string{"number": number}
		if phType != "" {
			entry["type"] = phType
		}
		phones = append(phones, entry)
	}
	return phones
}
