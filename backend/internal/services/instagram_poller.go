package services

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// instagramFolderName mapeia folder int → label legível (usado em thread_key).
var instagramFolderName = map[int]string{
	0: "primary",
	1: "general",
	2: "requests",
}

// InstagramPoller periodicamente faz polling de DMs de todas as instâncias
// Instagram conectadas e injeta mensagens novas no InboundPipeline.
//
// Instagram não tem webhooks nativos na instagrapi (private API), portanto o
// modelo é pull: a cada 30s percorre Primary, General e Requests de cada
// instância e processa mensagens ainda não vistas (dedup por external_message_id).
type InstagramPoller struct {
	db       *gorm.DB
	igSvc    *InstagramService
	pipeline *InboundPipeline
	interval time.Duration
	stop     chan struct{}
}

func NewInstagramPoller(db *gorm.DB, igSvc *InstagramService, pipeline *InboundPipeline) *InstagramPoller {
	return &InstagramPoller{
		db:       db,
		igSvc:    igSvc,
		pipeline: pipeline,
		interval: 30 * time.Second,
		stop:     make(chan struct{}),
	}
}

func (p *InstagramPoller) Start() {
	go p.loop()
	log.Info().Dur("interval", p.interval).Msg("instagram poller: started")
}

func (p *InstagramPoller) Stop() {
	close(p.stop)
}

func (p *InstagramPoller) loop() {
	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()
	for {
		select {
		case <-p.stop:
			return
		case <-ticker.C:
			p.poll()
		}
	}
}

func (p *InstagramPoller) poll() {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	// Busca todas as instâncias Instagram conectadas.
	var instances []models.Instance
	if err := p.db.WithContext(ctx).
		Where("channel = ? AND status = ?", models.ChannelInstagram, models.StatusConnected).
		Find(&instances).Error; err != nil {
		log.Warn().Err(err).Msg("instagram poller: falha ao buscar instâncias")
		return
	}

	for i := range instances {
		inst := &instances[i]
		// Timeout por instância para não bloquear o loop inteiro.
		iCtx, iCancel := context.WithTimeout(ctx, 20*time.Second)
		p.pollInstance(iCtx, inst)
		iCancel()
	}
}

func (p *InstagramPoller) pollInstance(ctx context.Context, inst *models.Instance) {
	// Pastas a monitorar: Primary (0), General (1), Requests (2).
	for _, folder := range []int{0, 1, 2} {
		inbox, err := p.igSvc.GetInboxFolder(ctx, inst.ID.String(), folder)
		if err != nil {
			// Não loga erro como warn em "not logged in" — é esperado pra instâncias
			// sem sessão ativa; só loga debug.
			log.Debug().Err(err).
				Str("instance", inst.ID.String()).
				Int("folder", folder).
				Msg("instagram poller: falha ao buscar inbox")
			continue
		}

		for _, thread := range inbox.Threads {
			p.processThread(ctx, inst, thread, folder)
		}
	}
}

// processThread itera sobre as mensagens de uma thread e injeta as novas no pipeline.
func (p *InstagramPoller) processThread(ctx context.Context, inst *models.Instance, thread Thread, folder int) {
	if len(thread.Users) == 0 {
		return
	}

	// channel_key = username do outro participante (não o dono da instância).
	// Se a thread tiver múltiplos participantes (grupo), usa o thread_id.
	sender := thread.Users[0]
	channelKey := sender.Username
	if channelKey == "" {
		channelKey = thread.ThreadID
	}

	// thread_key = "ig:<folder>" pra identificar a pasta no inbox.
	folderName := instagramFolderName[folder]
	threadKey := fmt.Sprintf("ig:%s", folderName)

	for _, msg := range thread.Messages {
		if msg.ItemID == "" {
			continue
		}
		// Dedup: verifica se este item_id já foi persistido.
		var count int64
		p.db.WithContext(ctx).Model(&models.MessageLog{}).
			Where("instance_id = ? AND external_message_id = ?", inst.ID, msg.ItemID).
			Count(&count)
		if count > 0 {
			continue
		}

		// Determina direção: se user_id == pk do dono da instância → outbound,
		// senão → inbound. Como não armazenamos o pk do owner, comparamos
		// com o username da sessão (approximation).
		session := p.igSvc.getSession(inst.ID.String())
		if session == nil {
			return
		}
		// Mensagens do próprio bot/instância têm user_id diferente do sender na thread.
		// Por ora tratamos todas como inbound (da outra pessoa). Mensagens enviadas
		// pelo agente via SendMessage já foram persistidas pelo handler.
		_ = session

		msgType := "text"
		content := msg.Text
		if msg.ItemType != "text" && msg.ItemType != "" {
			msgType = igItemTypeToMsgType(msg.ItemType)
			if content == "" {
				content = fmt.Sprintf(`{"type":"%s"}`, msg.ItemType)
			}
		}
		if content == "" {
			continue
		}

		// Serializa o content no formato JSON do pipeline.
		contentJSON, _ := json.Marshal(content)

		occuredAt := time.Now()
		if msg.Timestamp != "" {
			if t, err := time.Parse(time.RFC3339, msg.Timestamp); err == nil {
				occuredAt = t
			}
		}

		var wsID uuid.UUID
		if inst.WorkspaceID != nil {
			wsID = *inst.WorkspaceID
		}

		inMsg := InboundMessage{
			InstanceID:  inst.ID,
			WorkspaceID: wsID,
			ChannelType: string(models.ChannelInstagram),
			ChannelKey:  channelKey,
			ThreadKey:   threadKey,
			FromName:    sender.FullName,
			FromAvatar:  sender.ProfilePic,
			Type:        msgType,
			Content:     string(contentJSON),
			OccurredAt:  occuredAt,
		}

		if _, _, err := p.pipeline.Process(ctx, inMsg); err != nil {
			log.Warn().Err(err).
				Str("instance", inst.ID.String()).
				Str("item_id", msg.ItemID).
				Msg("instagram poller: pipeline failed")
			continue
		}

		// Marca o external_message_id na MessageLog recém-criada para dedup futuro.
		var logged models.MessageLog
		if err := p.db.WithContext(ctx).
			Where("instance_id = ? AND channel_type = ? AND to_jid = ?", inst.ID, string(models.ChannelInstagram), channelKey).
			Order("created_at DESC").
			First(&logged).Error; err == nil {
			if logged.ExternalMessageID == "" {
				p.db.WithContext(ctx).Model(&logged).Update("external_message_id", msg.ItemID)
			}
		}
	}
}

// igItemTypeToMsgType converte o item_type do Instagram para o tipo do pipeline.
func igItemTypeToMsgType(itemType string) string {
	switch itemType {
	case "clip", "felix_share", "reel_share":
		return "video"
	case "media", "media_share":
		return "image"
	case "voice_media":
		return "audio"
	case "animated_media", "xma_gif":
		return "image" // GIF → image
	case "link":
		return "text"
	default:
		return "text"
	}
}

