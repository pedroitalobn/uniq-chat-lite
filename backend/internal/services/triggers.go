package services

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// TriggerService avalia mensagens inbound contra triggers configurados
// e executa a ação correspondente. Single-fire por padrão (cooldown
// previne loops). É chamado pelo InboundPipeline.Process logo após
// persistir a mensagem.
type TriggerService struct {
	db      *gorm.DB
	manager *whatsapp.Manager // pra enviar respostas

	regexCacheMu sync.RWMutex
	regexCache   map[string]*regexp.Regexp
}

func NewTriggerService(db *gorm.DB, manager *whatsapp.Manager) *TriggerService {
	return &TriggerService{
		db:         db,
		manager:    manager,
		regexCache: map[string]*regexp.Regexp{},
	}
}

// Evaluate roda os triggers ativos do workspace contra a mensagem. Se
// algum bate, dispara a Action e (a não ser que MultiMatch seja true)
// retorna no primeiro match. Falhas são logadas mas não propagam — não
// queremos quebrar o pipeline inbound por causa de trigger maluco.
func (s *TriggerService) Evaluate(ctx context.Context, in InboundMessage, msg *models.MessageLog) {
	if s == nil || s.db == nil {
		return
	}
	// Só avalia text-like — pra mídia/documento o cliente provavelmente
	// não digitou keyword. Reaction/revoke também não.
	if in.Type != "text" && in.Type != "" {
		return
	}
	text := strings.TrimSpace(extractInboundText(in))
	if text == "" {
		return
	}
	// Grupos: pula se trigger está com OnlyDirect=true.
	isGroup := strings.HasSuffix(in.ChannelKey, "@g.us")

	var triggers []models.Trigger
	q := s.db.WithContext(ctx).
		Where("workspace_id = ? AND is_active = ?", in.WorkspaceID, true).
		Where("instance_id = ? OR instance_id IS NULL", in.InstanceID).
		Order("priority asc, created_at desc")
	if err := q.Find(&triggers).Error; err != nil {
		log.Warn().Err(err).Msg("trigger: list failed")
		return
	}

	for i := range triggers {
		t := &triggers[i]
		if isGroup && t.OnlyDirect {
			continue
		}
		if !s.match(t, text) {
			continue
		}
		// Cooldown: se mesmo contato disparou esse trigger há menos
		// de N segundos, ignora pra não loop.
		if t.CooldownSec > 0 {
			var recent models.TriggerFire
			cutoff := time.Now().Add(-time.Duration(t.CooldownSec) * time.Second)
			err := s.db.WithContext(ctx).
				Where("trigger_id = ? AND contact_jid = ? AND fired_at > ?", t.ID, in.ChannelKey, cutoff).
				Order("fired_at desc").
				First(&recent).Error
			if err == nil {
				continue // cooldown ativo
			}
		}

		s.fire(ctx, t, in, msg)

		if !t.MultiMatch {
			break
		}
	}
}

// match aplica a regra MatchMode/CaseSensitive.
func (s *TriggerService) match(t *models.Trigger, text string) bool {
	keyword := t.Keyword
	target := text
	if !t.CaseSensitive {
		keyword = strings.ToLower(keyword)
		target = strings.ToLower(target)
	}
	switch t.MatchMode {
	case models.TriggerMatchExact:
		return strings.TrimSpace(target) == strings.TrimSpace(keyword)
	case models.TriggerMatchStartWith:
		return strings.HasPrefix(strings.TrimSpace(target), keyword)
	case models.TriggerMatchRegex:
		re, err := s.compile(keyword)
		if err != nil || re == nil {
			return false
		}
		return re.MatchString(target)
	default:
		return strings.Contains(target, keyword)
	}
}

func (s *TriggerService) compile(pattern string) (*regexp.Regexp, error) {
	s.regexCacheMu.RLock()
	re, ok := s.regexCache[pattern]
	s.regexCacheMu.RUnlock()
	if ok {
		return re, nil
	}
	compiled, err := regexp.Compile(pattern)
	if err != nil {
		return nil, err
	}
	s.regexCacheMu.Lock()
	s.regexCache[pattern] = compiled
	s.regexCacheMu.Unlock()
	return compiled, nil
}

// fire executa a Action. Roda em goroutine separada pra não segurar o
// pipeline inbound em respostas lentas.
func (s *TriggerService) fire(ctx context.Context, t *models.Trigger, in InboundMessage, _ *models.MessageLog) {
	// Registra disparo (síncrono, é DB local)
	now := time.Now()
	s.db.WithContext(ctx).Create(&models.TriggerFire{
		TriggerID:  t.ID,
		ContactJID: in.ChannelKey,
		FiredAt:    now,
	})
	s.db.WithContext(ctx).Model(t).Updates(map[string]any{
		"hit_count":   gorm.Expr("hit_count + 1"),
		"last_hit_at": &now,
	})

	go s.executeAction(t, in)
}

func (s *TriggerService) executeAction(t *models.Trigger, in InboundMessage) {
	switch t.Action {
	case models.TriggerActionReply:
		s.actionReply(t, in)
	case models.TriggerActionForwardAI:
		// AgentRuntime já é chamado naturalmente pelo inbound pipeline
		// no caminho default. Forward_ai com payload (override agent
		// id) seria caso especial — por enquanto o trigger é só um
		// flag pra "garantir que a IA responda esta mensagem mesmo
		// que ela esteja desabilitada no chat". Implementação
		// completa fica pra quando o AgentRuntime virar service.
		log.Info().Str("trigger", t.Name).Msg("trigger: forward_ai (no-op por enquanto)")
	case models.TriggerActionTag:
		s.actionTag(t, in)
	case models.TriggerActionStartJourney:
		// idem — JourneyService precisa virar interface aqui.
		log.Info().Str("trigger", t.Name).Str("journey", t.Payload).Msg("trigger: start_journey (no-op por enquanto)")
	}
}

func (s *TriggerService) actionReply(t *models.Trigger, in InboundMessage) {
	text := strings.TrimSpace(t.Payload)
	if text == "" {
		return
	}
	if s.manager == nil {
		return
	}
	client := s.manager.GetInstance(in.InstanceID.String())
	if client == nil || !client.IsConnected() {
		return
	}
	if _, err := client.SendTextMessage(in.ChannelKey, text); err != nil {
		log.Warn().Str("trigger", t.Name).Err(err).Msg("trigger: reply send failed")
	}
}

func (s *TriggerService) actionTag(t *models.Trigger, in InboundMessage) {
	tagName := strings.TrimSpace(t.Payload)
	if tagName == "" {
		return
	}
	// Localiza o contact (por phone — nosso schema persiste como
	// phone+instance_id) pra ter UserID correto.
	phone := jidToPhone(in.ChannelKey)
	var contact models.Contact
	q := s.db.Where("phone = ? AND workspace_id = ?", phone, in.WorkspaceID)
	if err := q.First(&contact).Error; err != nil {
		log.Debug().Str("trigger", t.Name).Str("phone", phone).Msg("trigger: contact não encontrado pra tag")
		return
	}

	// Busca/cria a tag.
	var tag models.Tag
	err := s.db.Where("workspace_id = ? AND name = ?", in.WorkspaceID, tagName).First(&tag).Error
	if err != nil {
		if err != gorm.ErrRecordNotFound {
			log.Warn().Err(err).Msg("trigger: tag lookup failed")
			return
		}
		tag = models.Tag{
			UserID:      contact.UserID,
			WorkspaceID: &in.WorkspaceID,
			Name:        tagName,
		}
		if err := s.db.Create(&tag).Error; err != nil {
			log.Warn().Err(err).Msg("trigger: failed creating tag")
			return
		}
	}
	if err := s.db.Model(&contact).Association("Tags").Append(&tag); err != nil {
		log.Warn().Err(err).Msg("trigger: failed appending tag to contact")
	}
}

// jidToPhone extrai a parte de telefone de um JID do WhatsApp.
// "5511999999999@s.whatsapp.net" → "5511999999999".
// Pra outros canais (instagram username, etc.) retorna o input cru.
func jidToPhone(jid string) string {
	if at := strings.IndexByte(jid, '@'); at > 0 {
		return jid[:at]
	}
	return jid
}

// extractInboundText puxa o texto cru da InboundMessage. Content pode
// ser JSON {"text":"..."} ou texto puro dependendo do canal.
func extractInboundText(in InboundMessage) string {
	if in.Content == "" {
		return ""
	}
	c := strings.TrimSpace(in.Content)
	if strings.HasPrefix(c, "{") {
		var m map[string]any
		if err := json.Unmarshal([]byte(c), &m); err == nil {
			if t, ok := m["text"].(string); ok {
				return t
			}
			if t, ok := m["body"].(string); ok {
				return t
			}
			if t, ok := m["caption"].(string); ok {
				return t
			}
		}
	}
	return c
}
