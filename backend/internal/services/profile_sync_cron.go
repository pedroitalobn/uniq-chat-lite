package services

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
)

// ProfileSyncCron — cron que preenche avatar_url e push_name de contatos
// retroativamente. Antes a captura era 100% reativa (só rodava em event de
// inbound msg ou push_name), o que deixava conversas antigas sem avatar e
// nomes ainda como "+5511..." mesmo quando o WhatsApp já tinha o nome em
// cache da Store.
//
// Estratégia:
//   1. Tick a cada 20 minutos.
//   2. Pega até 150 conversas em (channel_type=whatsapp, instance ativa,
//      avatar_url vazio OU push_name vazio).
//   3. Pra cada uma, consulta:
//        client.GetContactProfilePicture(jid)  → preenche avatar_url
//        client.GetContactInfo(jid)            → preenche push_name
//      Cache de avatar (1h) é compartilhado com o pipeline de mensagens —
//      reaproveita lookups recentes sem queimar IQ.
//   4. Também refaz avatar de até 50 conversas com avatar_url SET mas
//      updated_at > 6h atrás, pra refrescar URLs assinadas que podem ter
//      expirado (Meta rotaciona o signed URL após algumas horas).
//
// Limites conservadores (200 lookups por tick) protegem do rate-limit do
// WhatsApp. Em workspace com muitas conversas atrasadas, o cron leva
// algumas iterações pra chegar ao zero — aceitável.
type ProfileSyncCron struct {
	db      *gorm.DB
	manager *whatsapp.Manager
	stop    chan struct{}
}

func NewProfileSyncCron(db *gorm.DB, manager *whatsapp.Manager) *ProfileSyncCron {
	return &ProfileSyncCron{db: db, manager: manager, stop: make(chan struct{})}
}

func (c *ProfileSyncCron) Start() {
	go c.loop()
	log.Info().Msg("profile sync cron: started (20min interval)")
}

func (c *ProfileSyncCron) Stop() { close(c.stop) }

func (c *ProfileSyncCron) loop() {
	// Espera 90s na primeira iteração pra dar tempo do manager carregar
	// instâncias e abrir socket — sem isso o primeiro tick acha "0 instances
	// connected" e desperdiça uma janela de 20min.
	time.Sleep(90 * time.Second)
	c.tick()
	t := time.NewTicker(20 * time.Minute)
	defer t.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-t.C:
			c.tick()
		}
	}
}

func (c *ProfileSyncCron) tick() {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("profile sync tick: panic recovered")
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	if c.manager == nil {
		return
	}
	missing := c.RunOnce(ctx, 150, 50)
	log.Info().Int("processed", missing).Msg("profile sync tick complete")
}

// RunOnce — executa o sync de uma vez. Retorna quantas conversas tiveram
// avatar/nome atualizados. Exposto pro endpoint admin que dispara manual.
func (c *ProfileSyncCron) RunOnce(ctx context.Context, missingLimit, staleLimit int) int {
	updated := 0
	updated += c.fillMissing(ctx, missingLimit)
	updated += c.refreshStale(ctx, staleLimit)
	return updated
}

// fillMissing — pega conversas com avatar OU push_name vazios, tenta
// preencher os dois numa só passada por conversa.
func (c *ProfileSyncCron) fillMissing(ctx context.Context, limit int) int {
	type row struct {
		ID         uuid.UUID
		InstanceID uuid.UUID
		ChannelKey string
		AvatarURL  string
		PushName   string
		ContactID  *uuid.UUID
	}
	var rows []row
	if err := c.db.WithContext(ctx).
		Table("conversations").
		Select("id, instance_id, channel_key, avatar_url, push_name, contact_id").
		Where("channel_type = ?", "whatsapp").
		Where("channel_key IS NOT NULL AND channel_key <> ''").
		Where("(avatar_url IS NULL OR avatar_url = '') OR (push_name IS NULL OR push_name = '')").
		// Skip grupos — avatar do grupo já é tratado pelo applyGroupName.
		Where("channel_key NOT LIKE ?", "%@g.us").
		Where("channel_key NOT LIKE ?", "%@broadcast").
		Where("channel_key NOT LIKE ?", "%@newsletter").
		Order("updated_at DESC"). // prioriza conversas recentes
		Limit(limit).
		Scan(&rows).Error; err != nil {
		log.Warn().Err(err).Msg("profile sync: query missing failed")
		return 0
	}
	updated := 0
	for _, r := range rows {
		client := c.manager.GetInstance(r.InstanceID.String())
		if client == nil || !client.IsConnected() {
			continue
		}
		newAvatar := r.AvatarURL
		if newAvatar == "" {
			if pic := client.GetContactProfilePicture(r.ChannelKey); pic != "" {
				// Baixa do CDN da Meta e sobe pro nosso storage — sem isso
				// a URL signed expira em horas e o avatar some.
				newAvatar = whatsapp.PersistAvatar(ctx, r.ChannelKey, pic)
			}
		}
		newPushName := r.PushName
		if newPushName == "" {
			if _, push := client.GetContactInfo(r.ChannelKey); push != "" {
				newPushName = push
			}
		}
		patch := map[string]interface{}{}
		if newAvatar != r.AvatarURL && newAvatar != "" {
			patch["avatar_url"] = newAvatar
		}
		if newPushName != r.PushName && newPushName != "" {
			patch["push_name"] = newPushName
		}
		if len(patch) == 0 {
			continue
		}
		if err := c.db.WithContext(ctx).
			Model(&models.Conversation{}).
			Where("id = ?", r.ID).
			Updates(patch).Error; err != nil {
			log.Warn().Err(err).Str("conv_id", r.ID.String()).Msg("profile sync: update conversation failed")
			continue
		}
		// Propaga pro Contact se vinculado e ele também estiver vazio/com
		// telefone como nome. Não sobrescreve nome editado manualmente.
		if r.ContactID != nil {
			contactPatch := map[string]interface{}{}
			if v, ok := patch["avatar_url"]; ok {
				c.db.WithContext(ctx).
					Model(&models.Contact{}).
					Where("id = ? AND (avatar_url IS NULL OR avatar_url = '')", *r.ContactID).
					Update("avatar_url", v)
			}
			if v, ok := patch["push_name"]; ok {
				phone := extractPhoneFromKey(r.ChannelKey)
				c.db.WithContext(ctx).
					Model(&models.Contact{}).
					Where("id = ? AND (name IS NULL OR name = '' OR name = ? OR name = ?)",
						*r.ContactID, phone, "+"+phone).
					Update("name", v)
			}
			_ = contactPatch
		}
		updated++
	}
	return updated
}

// refreshStale — migra avatar_urls antigas (signed URLs do CDN da Meta
// que expiram) pra nosso storage permanente. Filtra por URLs que NÃO são
// do nosso domínio — uma vez migrado pro MinIO/S3, a URL é estável e a
// gente nunca refaz fetch (se o user trocar a foto, evento Picture do
// whatsmeow pode invalidar — TODO).
func (c *ProfileSyncCron) refreshStale(ctx context.Context, limit int) int {
	type row struct {
		ID         uuid.UUID
		InstanceID uuid.UUID
		ChannelKey string
		AvatarURL  string
	}
	var rows []row
	q := c.db.WithContext(ctx).
		Table("conversations").
		Select("id, instance_id, channel_key, avatar_url").
		Where("channel_type = ?", "whatsapp").
		Where("channel_key IS NOT NULL AND channel_key <> ''").
		Where("avatar_url IS NOT NULL AND avatar_url <> ''").
		Where("channel_key NOT LIKE ?", "%@g.us")
	// Só URLs externas (signed do CDN da Meta) — as nossas (que já estão
	// no MinIO) ficam de fora porque são permanentes.
	q = q.Where("(avatar_url LIKE ? OR avatar_url LIKE ? OR avatar_url LIKE ?)",
		"%whatsapp.net%", "%fbcdn.net%", "%whatsapp.com%")
	if err := q.
		Order("updated_at ASC").
		Limit(limit).
		Scan(&rows).Error; err != nil {
		return 0
	}
	updated := 0
	for _, r := range rows {
		client := c.manager.GetInstance(r.InstanceID.String())
		if client == nil || !client.IsConnected() {
			continue
		}
		pic := client.GetContactProfilePicture(r.ChannelKey)
		if pic == "" {
			continue
		}
		permPic := whatsapp.PersistAvatar(ctx, r.ChannelKey, pic)
		if permPic == "" {
			continue
		}
		if err := c.db.WithContext(ctx).
			Model(&models.Conversation{}).
			Where("id = ?", r.ID).
			Update("avatar_url", permPic).Error; err == nil {
			updated++
		}
	}
	return updated
}

// extractPhoneFromKey — espelha a heurística de extractPhoneFromJID do
// manager pra não importar pacote whatsapp inteiro só por um helper. Pega
// "5511999999999@s.whatsapp.net" → "5511999999999".
func extractPhoneFromKey(jid string) string {
	if jid == "" {
		return ""
	}
	if i := strings.Index(jid, "@"); i > 0 {
		return jid[:i]
	}
	return jid
}
