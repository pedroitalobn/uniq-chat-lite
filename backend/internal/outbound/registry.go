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
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/audioconvert"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/storage"
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
	Filename  string // document only

	// Reply context — quando o agente está respondendo (citando) uma msg
	// anterior. ReplyToExternalID é o stanza_id (whatsmeow) ou message_id
	// (WABA/IG) da msg original. ReplyToParticipant só é usado em grupos
	// pra montar ContextInfo corretamente. ReplyToText é o conteúdo real
	// da msg citada — sem isso o WhatsApp mobile não renderiza o quote.
	ReplyToExternalID  string
	ReplyToParticipant string
	ReplyToText        string

	// Template (WABA somente): Meta exige nome do template aprovado,
	// linguagem (ex.: pt_BR) e componentes opcionais com variáveis.
	TemplateName       string
	TemplateLanguage   string
	TemplateComponents []map[string]any
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
		return r.sendWhatsApp(ctx, inst, msg)
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

func (r *Registry) sendWhatsApp(ctx context.Context, inst *models.Instance, msg OutboundMessage) (*SendResult, error) {
	if r.waManager == nil {
		return nil, errors.New("whatsapp manager unavailable")
	}
	client := r.waManager.GetInstance(inst.ID.String())
	if client == nil || !client.IsConnected() {
		return nil, errors.New("instância desconectada")
	}

	switch msg.Type {
	case "", "text":
		var id string
		var err error
		if msg.ReplyToExternalID != "" {
			id, err = client.SendTextMessageReply(msg.To, msg.Body, msg.ReplyToExternalID, msg.ReplyToParticipant, msg.ReplyToText)
		} else {
			id, err = client.SendTextMessage(msg.To, msg.Body)
		}
		if err != nil {
			return nil, err
		}
		return &SendResult{ExternalID: id, Status: models.MessageStatusSent}, nil

	case "image", "audio", "video", "document":
		if msg.MediaURL == "" {
			return nil, fmt.Errorf("%s requer media_url", msg.Type)
		}
		data, mime, err := r.fetchMedia(msg.MediaURL, msg.MediaMime)
		if err != nil {
			return nil, err
		}
		caption := msg.Caption
		if caption == "" {
			caption = msg.Body
		}
		switch msg.Type {
		case "image":
			id, err := client.SendImageMessage(msg.To, data, mime, caption)
			if err != nil {
				return nil, err
			}
			return &SendResult{ExternalID: id, Status: models.MessageStatusSent}, nil
		case "audio":
			// WhatsApp aceita áudio como voice note (PTT) APENAS quando o
			// container é OGG carregando Opus. Mesmo se a mensagem proto
			// declarar Mimetype="audio/ogg; codecs=opus", se os bytes forem
			// WebM (Matroska), MP4/AAC ou MP3, o cliente do destinatário
			// parseia o header, encontra container errado e mostra "áudio
			// indisponível". Por isso transcodamos via ffmpeg pra OGG/Opus
			// SEMPRE que o input não for OGG nativo. Quando o usuário envia
			// MP3/M4A como anexo (não voice note), mandamos PTT=false e o
			// mime original.
			outBytes := data
			outMime := mime
			isPTT := false
			var seconds uint32
			isOgg := isOggBytes(data)
			isOpusContainer := isOgg || isWebMBytes(data) || mimeIsOpus(mime)
			if isOpusContainer {
				// Voice note path — transcoda pra OGG/Opus mono 16k.
				// ffmpeg ausente → cai no fallback (sem transcoding) com
				// warn, melhor que crashar o envio.
				converted, dur, terr := audioconvert.TranscodeToOggOpus(ctx, data)
				if terr == nil {
					outBytes = converted
					seconds = dur
				} else if !errors.Is(terr, audioconvert.ErrFfmpegMissing) {
					log.Warn().Err(terr).Int("bytes", len(data)).Msg("outbound: transcoding pra OGG/Opus falhou — enviando bytes originais (provável 'áudio indisponível' no destinatário)")
				} else {
					log.Warn().Msg("outbound: ffmpeg indisponível — voice note enviada sem transcoding (instale o pacote ffmpeg na imagem)")
				}
				outMime = "audio/ogg; codecs=opus"
				isPTT = true
			}
			id, err := client.SendAudioMessage(msg.To, outBytes, outMime, isPTT, seconds)
			if err != nil {
				return nil, err
			}
			return &SendResult{ExternalID: id, Status: models.MessageStatusSent}, nil
		case "video":
			id, err := client.SendVideoMessage(msg.To, data, mime, caption)
			if err != nil {
				return nil, err
			}
			return &SendResult{ExternalID: id, Status: models.MessageStatusSent}, nil
		case "document":
			filename := msg.Filename
			if filename == "" {
				filename = filenameFromURL(msg.MediaURL)
			}
			id, err := client.SendDocumentMessage(msg.To, data, mime, filename)
			if err != nil {
				return nil, err
			}
			return &SendResult{ExternalID: id, Status: models.MessageStatusSent}, nil
		}
	}

	// Fallback — tipos ainda não mapeados caem como texto para não perder
	// a mensagem inteira; o agente recebe warn e pode reenviar manualmente.
	id, err := client.SendTextMessage(msg.To, msg.Body)
	if err != nil {
		return nil, err
	}
	return &SendResult{ExternalID: id, Status: models.MessageStatusSent}, nil
}

// isOggBytes detecta o container OGG via assinatura "OggS" (RFC 3533) nos
// primeiros 4 bytes. Áudio em OGG/Opus já é o formato nativo de voice note
// do WhatsApp, então pode pular o transcoding.
func isOggBytes(data []byte) bool {
	return len(data) >= 4 && data[0] == 'O' && data[1] == 'g' && data[2] == 'g' && data[3] == 'S'
}

// isWebMBytes detecta WebM/Matroska via assinatura EBML 0x1A 0x45 0xDF 0xA3.
// Browser MediaRecorder em Chrome/Firefox produz WebM/Opus — mesmos pacotes
// Opus do OGG mas em container Matroska, que o WhatsApp NÃO aceita como
// voice note. Precisa transcodar antes do envio.
func isWebMBytes(data []byte) bool {
	return len(data) >= 4 && data[0] == 0x1A && data[1] == 0x45 && data[2] == 0xDF && data[3] == 0xA3
}

// isOpusBytes mantido por compat — true tanto pra OGG quanto WebM (ambos
// podem carregar Opus). Não use no dispatch novo: prefira a discriminação
// isOggBytes vs isWebMBytes pra decidir se precisa transcodar.
func isOpusBytes(data []byte) bool {
	return isOggBytes(data) || isWebMBytes(data)
}

// mimeIsOpus testa o MIME declarado de forma case-insensitive. Aceita as
// variações que o frontend pode produzir e que o storage pode mutilar:
// "audio/webm;codecs=opus", "audio/ogg", "audio/opus", "audio/webm" etc.
func mimeIsOpus(mime string) bool {
	low := strings.ToLower(mime)
	return strings.Contains(low, "opus") ||
		strings.Contains(low, "ogg") ||
		strings.Contains(low, "webm")
}

// fetchMedia baixa o bytes do storage (MinIO) e devolve o mime real quando
// o content-type do response for mais confiável que o que veio do request.
// Se a URL pertencer ao bucket privado, gera presigned URL antes do GET.
func (r *Registry) fetchMedia(rawURL, declaredMime string) ([]byte, string, error) {
	url := rawURL
	if storage.IsConfigured() {
		if key := storage.GlobalStorage.KeyFromURL(rawURL); key != "" {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if signed, err := storage.GlobalStorage.PresignURL(ctx, key, 10*time.Minute); err == nil {
				url = signed
			}
		}
	}
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := r.http.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("download %s: %w", rawURL, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("download %s: HTTP %d", rawURL, resp.StatusCode)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", err
	}
	mime := declaredMime
	if mime == "" {
		mime = resp.Header.Get("Content-Type")
	}
	if mime == "" {
		mime = "application/octet-stream"
	}
	return data, mime, nil
}

// filenameFromURL extrai o "arquivo.ext" do final da URL quando o client
// não mandou um filename explícito.
func filenameFromURL(url string) string {
	idx := strings.LastIndex(url, "/")
	if idx < 0 || idx == len(url)-1 {
		return "documento"
	}
	name := url[idx+1:]
	// strip query/fragment
	if q := strings.IndexAny(name, "?#"); q > 0 {
		name = name[:q]
	}
	if name == "" {
		return "documento"
	}
	return name
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
	switch msgType {
	case "text":
		payload["text"] = map[string]string{"body": msg.Body}
	case "image":
		img := map[string]string{"link": msg.MediaURL}
		if msg.Caption != "" || msg.Body != "" {
			if msg.Caption != "" {
				img["caption"] = msg.Caption
			} else {
				img["caption"] = msg.Body
			}
		}
		payload["image"] = img
	case "video":
		vid := map[string]string{"link": msg.MediaURL}
		if msg.Caption != "" {
			vid["caption"] = msg.Caption
		} else if msg.Body != "" {
			vid["caption"] = msg.Body
		}
		payload["video"] = vid
	case "audio":
		payload["audio"] = map[string]string{"link": msg.MediaURL}
	case "document":
		doc := map[string]string{"link": msg.MediaURL}
		if msg.Filename != "" {
			doc["filename"] = msg.Filename
		}
		if msg.Caption != "" {
			doc["caption"] = msg.Caption
		}
		payload["document"] = doc
	case "template":
		if msg.TemplateName == "" {
			return nil, errors.New("template requer template_name")
		}
		lang := msg.TemplateLanguage
		if lang == "" {
			lang = "pt_BR"
		}
		tpl := map[string]any{
			"name":     msg.TemplateName,
			"language": map[string]string{"code": lang},
		}
		if len(msg.TemplateComponents) > 0 {
			tpl["components"] = msg.TemplateComponents
		}
		payload["template"] = tpl
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

	var resp *services.SendDMResponse
	var err error

	switch msg.Type {
	case "image", "video", "audio":
		if msg.MediaURL == "" {
			return nil, fmt.Errorf("instagram %s requer media_url", msg.Type)
		}
		resp, err = r.igSvc.SendDMMedia(ctx, inst.ID.String(), msg.To, msg.Type, msg.MediaURL)
	default:
		// text e qualquer tipo não reconhecido → texto
		body := msg.Body
		if body == "" && msg.Caption != "" {
			body = msg.Caption
		}
		resp, err = r.igSvc.SendDM(ctx, inst.ID.String(), msg.To, body)
	}

	if err != nil {
		return nil, err
	}
	ext := ""
	if resp != nil && resp.ThreadID != "" {
		ext = resp.ThreadID
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
