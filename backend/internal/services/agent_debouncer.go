package services

import (
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
)

// MessageDebouncer agrupa mensagens sequenciais de um mesmo cliente antes de
// acionar o LLM. Padrão de chat humano: quando alguém manda 2-3 frases em
// rajada, a gente LÊ tudo e responde uma vez, em vez de réplica linha-por-
// linha (que entrega "bot" na cara). Aqui implementamos o equivalente: cada
// mensagem entrando reseta um timer; quando o silêncio dura mais que a
// janela configurada, o batch é flushado de uma vez só.
//
// Thread-safety: um mutex global protegendo o map é suficiente — operações
// são O(1) e a contenção é baixa (cada conversa só toca seu bucket).
type MessageDebouncer struct {
	mu      sync.Mutex
	buckets map[string]*debounceBucket
	flush   FlushFn
}

// FlushFn é o callback que processa o batch acumulado. Recebe o último
// messageID (pra dedup downstream), o texto agregado e os metadados
// herdados da primeira/última mensagem do batch.
type FlushFn func(payload BatchPayload)

type BatchPayload struct {
	InstanceID  string
	MessageID   string
	FromJID     string
	FromName    string
	GroupJID    string
	Text        string
	MessageType string
	IsGroup     bool
	Count       int
}

type debounceBucket struct {
	msgs        []bufferedMsg
	timer       *time.Timer
	instanceID  string
	fromJID     string
	fromName    string
	groupJID    string
	messageType string
	isGroup     bool
}

type bufferedMsg struct {
	id   string
	text string
	at   time.Time
}

// NewMessageDebouncer cria o agrupador. O caller injeta o flushFn que será
// chamado quando a janela fechar (tipicamente AgentRuntime.HandleBatched).
func NewMessageDebouncer(flush FlushFn) *MessageDebouncer {
	return &MessageDebouncer{
		buckets: make(map[string]*debounceBucket),
		flush:   flush,
	}
}

// Enqueue adiciona uma mensagem ao bucket e (re)programa o flush pra
// window à frente. Retorna a chave do bucket pra logging/observabilidade.
func (d *MessageDebouncer) Enqueue(p BatchPayload, window time.Duration) {
	if d == nil {
		return
	}
	key := bucketKey(p.InstanceID, p.FromJID)
	d.mu.Lock()
	b, ok := d.buckets[key]
	if !ok {
		b = &debounceBucket{
			instanceID:  p.InstanceID,
			fromJID:     p.FromJID,
			fromName:    p.FromName,
			groupJID:    p.GroupJID,
			messageType: p.MessageType,
			isGroup:     p.IsGroup,
		}
		d.buckets[key] = b
	}
	// fromName/messageType podem evoluir entre mensagens — usamos sempre o
	// mais recente porque é o que reflete o "estado atual" da conversa.
	if strings.TrimSpace(p.FromName) != "" {
		b.fromName = p.FromName
	}
	b.messageType = p.MessageType
	b.msgs = append(b.msgs, bufferedMsg{id: p.MessageID, text: p.Text, at: time.Now()})
	if b.timer != nil {
		b.timer.Stop()
	}
	// time.AfterFunc roda em goroutine própria — flush() não bloqueia o
	// Enqueue da próxima mensagem. Importante porque o LLM pode demorar.
	b.timer = time.AfterFunc(window, func() { d.fire(key) })
	d.mu.Unlock()
	log.Debug().
		Str("instance", p.InstanceID).
		Str("from", p.FromJID).
		Int("buffered", len(b.msgs)).
		Dur("window", window).
		Msg("agent-debouncer: mensagem em batch")
}

// fire é o callback do timer. Retira o bucket do map sob lock pra evitar
// race com Enqueue paralelo (mensagem que chegou no microssegundo entre
// o timer disparar e o flush executar) e chama flush() fora do lock.
func (d *MessageDebouncer) fire(key string) {
	d.mu.Lock()
	b, ok := d.buckets[key]
	if !ok || len(b.msgs) == 0 {
		d.mu.Unlock()
		return
	}
	msgs := b.msgs
	payload := BatchPayload{
		InstanceID:  b.instanceID,
		MessageID:   msgs[len(msgs)-1].id,
		FromJID:     b.fromJID,
		FromName:    b.fromName,
		GroupJID:    b.groupJID,
		MessageType: b.messageType,
		IsGroup:     b.isGroup,
		Count:       len(msgs),
	}
	delete(d.buckets, key)
	d.mu.Unlock()

	parts := make([]string, 0, len(msgs))
	for _, m := range msgs {
		t := strings.TrimSpace(m.text)
		if t == "" {
			continue
		}
		parts = append(parts, t)
	}
	payload.Text = strings.Join(parts, "\n")
	if payload.Text == "" {
		return
	}
	log.Debug().
		Str("instance", payload.InstanceID).
		Str("from", payload.FromJID).
		Int("count", payload.Count).
		Msg("agent-debouncer: flush do batch")
	if d.flush != nil {
		d.flush(payload)
	}
}

// Cancel descarta o bucket pendente sem disparar o flush. Usado quando
// humano assume a conversa (ConversationAgentState.Mode=disabled) e
// queremos abortar respostas que ainda estavam pra sair.
func (d *MessageDebouncer) Cancel(instanceID, fromJID string) {
	if d == nil {
		return
	}
	key := bucketKey(instanceID, fromJID)
	d.mu.Lock()
	if b, ok := d.buckets[key]; ok {
		if b.timer != nil {
			b.timer.Stop()
		}
		delete(d.buckets, key)
	}
	d.mu.Unlock()
}

// BatchingWindow mapeia o enum salvo no agente pra duração concreta.
// "off" devolve 0 — caller deve checar antes de chamar Enqueue.
// String vazia trata como "off" também: agentes pre-existentes ficaram
// com a coluna vazia depois do AutoMigrate (DDL default só vale pra
// INSERT) e queremos que eles continuem respondendo na hora — opt-in
// explícito em "smart"/"patient" via UI.
func BatchingWindow(mode string) time.Duration {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "patient":
		return 15 * time.Second
	case "smart":
		return 6 * time.Second
	case "off", "":
		return 0
	}
	return 0
}

func bucketKey(instanceID, fromJID string) string {
	return instanceID + "|" + fromJID
}
