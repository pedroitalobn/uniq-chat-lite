package services

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
)

// MessageSyncCron — sincroniza mensagens periodicamente para instâncias
// conectadas. O WhatsApp entrega mensagens em tempo real via WebSocket, mas
// durante desconexões (rede, reboot, deploy) mensagens podem ser perdidas.
// Este cron detecta instâncias "stuck" (sem mensagens recentes) e dispara
// sync de histórico automaticamente — sem depender do operador clicar em
// "atualizar".
//
// Estratégia:
//   • Tick a cada 15 minutos.
//   • Para cada instância conectida, verifica a última mensagem recebida.
//   • Se a última msg foi há > 30 minutos, faz um history sync leve
//     (últimas 20 mensagens) nas conversas mais recentes.
//   • Também força um reconnect se a instância parece "zumbi" (conectada
//     mas sem tráfego há > 2h).
//
// Limites conservadores pra não sobrecarregar o WhatsApp.
type MessageSyncCron struct {
	db      *gorm.DB
	manager *whatsapp.Manager
	stop    chan struct{}
}

func NewMessageSyncCron(db *gorm.DB, manager *whatsapp.Manager) *MessageSyncCron {
	return &MessageSyncCron{db: db, manager: manager, stop: make(chan struct{})}
}

func (c *MessageSyncCron) Start() {
	go c.loop()
	log.Info().Msg("message sync cron: started (15min interval)")
}

func (c *MessageSyncCron) Stop() { close(c.stop) }

func (c *MessageSyncCron) loop() {
	// Espera 2min na primeira iteração pra dar tempo do manager carregar.
	time.Sleep(2 * time.Minute)
	c.tick()
	t := time.NewTicker(15 * time.Minute)
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

func (c *MessageSyncCron) tick() {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("message sync tick: panic recovered")
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if c.manager == nil {
		return
	}
	processed := c.RunOnce(ctx)
	log.Info().Int("processed", processed).Msg("message sync tick complete")
}

// RunOnce — executa o sync de uma vez. Retorna quantas instâncias foram
// processadas.
func (c *MessageSyncCron) RunOnce(ctx context.Context) int {
	var instances []models.Instance
	if err := c.db.WithContext(ctx).
		Model(&models.Instance{}).
		Where("status = ?", models.StatusConnected).
		Find(&instances).Error; err != nil {
		log.Warn().Err(err).Msg("message sync: query instances failed")
		return 0
	}

	processed := 0
	for _, inst := range instances {
		if err := c.syncInstance(ctx, inst.ID); err != nil {
			log.Warn().Err(err).Str("instance_id", inst.ID.String()).Msg("message sync: instance failed")
			continue
		}
		processed++
	}
	return processed
}

func (c *MessageSyncCron) syncInstance(ctx context.Context, instanceID uuid.UUID) error {
	client := c.manager.GetInstance(instanceID.String())
	if client == nil || !client.IsConnected() {
		return nil // skip disconnected
	}

	// Verifica última mensagem recebida por esta instância.
	var lastMsg struct {
		CreatedAt time.Time
	}
	err := c.db.WithContext(ctx).
		Model(&models.MessageLog{}).
		Select("created_at").
		Where("instance_id = ? AND direction = ?", instanceID, models.DirectionIn).
		Order("created_at DESC").
		Limit(1).
		Scan(&lastMsg).Error
	if err != nil {
		return err
	}

	// Se não há mensagens inbound (instância nova), skip.
	if lastMsg.CreatedAt.IsZero() {
		return nil
	}

	minutesSinceLastMsg := time.Since(lastMsg.CreatedAt).Minutes()

	// Se há > 30 minutos sem mensagens inbound, dispara sync leve.
	if minutesSinceLastMsg > 30 {
		// Pega as 5 conversas mais recentes com mensagens inbound.
		var convs []struct {
			ChannelKey string
		}
		err := c.db.WithContext(ctx).
			Model(&models.Conversation{}).
			Select("channel_key").
			Where("instance_id = ? AND channel_type = ?", instanceID, "whatsapp").
			Where("channel_key IS NOT NULL AND channel_key <> ''").
			Where("channel_key NOT LIKE ?", "%@g.us").
			Order("last_message_at DESC").
			Limit(5).
			Scan(&convs).Error
		if err != nil {
			return err
		}

		for _, conv := range convs {
			// History sync: pede últimas 20 mensagens da conversa.
			_ = client.RequestHistorySync(conv.ChannelKey, "", "", 20)
		}
		log.Info().
			Str("instance_id", instanceID.String()).
			Float64("min_since_last_msg", minutesSinceLastMsg).
			Int("convs_synced", len(convs)).
			Msg("message sync: triggered history sync")
	}

	// Se há > 2h sem mensagens, força reconexão (zumbi detection).
	if minutesSinceLastMsg > 120 {
		log.Warn().
			Str("instance_id", instanceID.String()).
			Float64("min_since_last_msg", minutesSinceLastMsg).
			Msg("message sync: instance looks zombie, forcing reconnect")
		_ = client.ForceReconnect()
	}

	return nil
}
