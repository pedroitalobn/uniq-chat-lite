package services

// agent_reply_queue.go — fila de respostas do agente com worker dedicado
// por instância e jitter randomico que mimetiza tempo humano de digitação.
// Objetivo: reduzir risco de banimento por padrão "robótico":
//   - respostas instantâneas demais (<500ms)
//   - respostas exatamente iguais em cadência
//   - múltiplas respostas paralelas pra contatos diferentes na mesma
//     instância (WhatsApp detecta como bot facilmente)
//
// Cada instância tem seu próprio worker — chats diferentes na mesma
// instância são SERIALIZADOS (digitando + sleep + send) pra parecer
// um humano único atendendo. Chats em instâncias diferentes seguem
// paralelos (cada instância = "uma pessoa").

import (
	mathrand "math/rand"
	"sync"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/whatsapp"
)

// AgentReplyJob — payload colocado na fila por instância. Caller já
// validou agent/conv/reply — aqui é só simular humanidade e mandar.
type AgentReplyJob struct {
	InstanceID string
	ToJID      string
	Reply      string
	AgentName  string // só pra log
}

// AgentReplyQueue — gerencia uma fila por instância. Singleton no boot;
// agent_runtime e (futuramente) outras paths chamam Enqueue.
type AgentReplyQueue struct {
	manager *whatsapp.Manager

	mu     sync.Mutex
	queues map[string]chan AgentReplyJob // key = instance_id
}

func NewAgentReplyQueue(manager *whatsapp.Manager) *AgentReplyQueue {
	return &AgentReplyQueue{
		manager: manager,
		queues:  make(map[string]chan AgentReplyJob),
	}
}

// Enqueue — adiciona o job na fila da instância. Não-bloqueante: se o
// buffer encher (ex: 64 jobs pendentes), DESCARTA com warn — proteção
// contra runaway. Em uso normal a fila esvazia em segundos.
func (q *AgentReplyQueue) Enqueue(job AgentReplyJob) {
	ch := q.getOrCreateQueue(job.InstanceID)
	select {
	case ch <- job:
		// enfileirado
	default:
		log.Warn().
			Str("instance", job.InstanceID).
			Str("agent", job.AgentName).
			Msg("agent-reply-queue: fila cheia (64 jobs) — descartando msg")
	}
}

func (q *AgentReplyQueue) getOrCreateQueue(instanceID string) chan AgentReplyJob {
	q.mu.Lock()
	defer q.mu.Unlock()
	if ch, ok := q.queues[instanceID]; ok {
		return ch
	}
	ch := make(chan AgentReplyJob, 64)
	q.queues[instanceID] = ch
	go q.worker(instanceID, ch)
	return ch
}

// worker — consome jobs serialmente. Pra cada job:
//   1. Liga "digitando…" (presence)
//   2. Sleep com jitter proporcional ao tamanho da resposta (mimetiza
//      velocidade de digitação humana ~ 200-400 chars/min).
//   3. Envia a mensagem via SendTextMessage.
//   4. Desliga "digitando…".
//   5. Cooldown final de 1.5s a 3s antes de aceitar próximo job (evita
//      rajada de mensagens consecutivas).
func (q *AgentReplyQueue) worker(instanceID string, ch chan AgentReplyJob) {
	for job := range ch {
		client := q.manager.GetInstance(instanceID)
		if client == nil || !client.IsConnected() {
			log.Warn().Str("instance", instanceID).Msg("agent-reply-queue: instância desconectada, descartando job")
			continue
		}

		typingDelay := computeTypingDelay(job.Reply)
		_ = client.SendTyping(job.ToJID, true)
		time.Sleep(typingDelay)

		if _, err := client.SendTextMessage(job.ToJID, job.Reply); err != nil {
			log.Error().Err(err).
				Str("instance", instanceID).
				Str("to", job.ToJID).
				Msg("agent-reply-queue: send falhou")
		} else {
			log.Info().
				Str("instance", instanceID).
				Str("to", job.ToJID).
				Str("agent", job.AgentName).
				Dur("typing_delay", typingDelay).
				Msg("agent-reply-queue: enviado")
		}
		_ = client.SendTyping(job.ToJID, false)

		// Cooldown entre mensagens consecutivas no mesmo número/instância.
		time.Sleep(jitterMS(1500, 3000))
	}
}

// computeTypingDelay — calcula tempo de "digitação" baseado em:
//   - tamanho da resposta (caracteres)
//   - velocidade humana média (~250 chars/min em mobile = 4.16 chars/seg)
//   - jitter ±25% pra não ser determinístico
//   - pisos: mínimo 1.2s, máximo 12s (respostas longas continuam respondendo
//     em tempo razoável; cliente espera mas não desiste)
func computeTypingDelay(reply string) time.Duration {
	chars := len([]rune(reply))
	// 4 chars/seg = 250ms por char.
	baseMS := chars * 220
	// Jitter ±25%.
	jitter := mathrand.Intn(baseMS/2 + 1) - (baseMS / 4)
	totalMS := baseMS + jitter
	if totalMS < 1200 {
		totalMS = 1200 + mathrand.Intn(800)
	}
	if totalMS > 12000 {
		totalMS = 10000 + mathrand.Intn(2500)
	}
	return time.Duration(totalMS) * time.Millisecond
}

// jitterMS — devolve duration random entre minMS e maxMS.
func jitterMS(minMS, maxMS int) time.Duration {
	if maxMS <= minMS {
		return time.Duration(minMS) * time.Millisecond
	}
	return time.Duration(minMS+mathrand.Intn(maxMS-minMS)) * time.Millisecond
}
