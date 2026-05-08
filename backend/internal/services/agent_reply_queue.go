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
	"strings"
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
	// Pace do agente — controla a magnitude do delay de "digitação" e
	// dos cooldowns. Valores: "instant" | "natural" | "thoughtful" |
	// "very_human". Vazio cai pra "natural".
	Pace string
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

		typingDelay := computeTypingDelay(job.Reply, job.Pace)
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
				Str("pace", job.Pace).
				Dur("typing_delay", typingDelay).
				Msg("agent-reply-queue: enviado")
		}
		_ = client.SendTyping(job.ToJID, false)

		// Cooldown entre mensagens consecutivas, escalado pelo pace.
		minCD, maxCD := cooldownRange(job.Pace)
		time.Sleep(jitterMS(minCD, maxCD))
	}
}

// paceProfile — multipliers + floors por modo. Mantido em uma função
// só pra facilitar tunar tudo no mesmo lugar.
type paceProfile struct {
	msPerChar   int           // base
	jitterPct   int           // ±N%
	minDelay    time.Duration
	maxDelay    time.Duration
	cooldownMin int // ms
	cooldownMax int // ms
}

func paceProfileFor(mode string) paceProfile {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "instant":
		return paceProfile{
			msPerChar: 40, jitterPct: 30,
			minDelay: 600 * time.Millisecond, maxDelay: 4 * time.Second,
			cooldownMin: 400, cooldownMax: 900,
		}
	case "thoughtful":
		return paceProfile{
			msPerChar: 400, jitterPct: 25,
			minDelay: 2200 * time.Millisecond, maxDelay: 18 * time.Second,
			cooldownMin: 2500, cooldownMax: 4500,
		}
	case "very_human":
		return paceProfile{
			msPerChar: 600, jitterPct: 30,
			minDelay: 3500 * time.Millisecond, maxDelay: 25 * time.Second,
			cooldownMin: 3500, cooldownMax: 7000,
		}
	}
	// "natural" / vazio / desconhecido → default humano padrão.
	return paceProfile{
		msPerChar: 220, jitterPct: 25,
		minDelay: 1200 * time.Millisecond, maxDelay: 12 * time.Second,
		cooldownMin: 1500, cooldownMax: 3000,
	}
}

func cooldownRange(pace string) (int, int) {
	p := paceProfileFor(pace)
	return p.cooldownMin, p.cooldownMax
}

// computeTypingDelay — calcula tempo de "digitação" baseado em:
//   - tamanho da resposta (caracteres)
//   - velocidade humana ajustada pelo Pace do agente
//   - jitter random pra não ser determinístico
//   - pisos/tetos por pace pra cliente não esperar eternamente nem
//     receber resposta instantânea (gatilho de banimento)
func computeTypingDelay(reply, pace string) time.Duration {
	prof := paceProfileFor(pace)
	chars := len([]rune(reply))
	baseMS := chars * prof.msPerChar
	jitterRange := baseMS * prof.jitterPct / 100
	if jitterRange < 1 {
		jitterRange = 1
	}
	jitter := mathrand.Intn(jitterRange*2) - jitterRange
	totalMS := baseMS + jitter
	minMS := int(prof.minDelay / time.Millisecond)
	maxMS := int(prof.maxDelay / time.Millisecond)
	if totalMS < minMS {
		totalMS = minMS + mathrand.Intn(800)
	}
	if totalMS > maxMS {
		totalMS = maxMS - 2000 + mathrand.Intn(2500)
	}
	if totalMS < minMS {
		totalMS = minMS
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
