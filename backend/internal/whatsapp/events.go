package whatsapp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"
	amqp "github.com/rabbitmq/amqp091-go"
	natsgo "github.com/nats-io/nats.go"
)

// WebhookPayload is the body sent to any integration target.
type WebhookPayload struct {
	Event      string      `json:"event"`
	InstanceID string      `json:"instance_id"`
	Timestamp  time.Time   `json:"timestamp"`
	Data       interface{} `json:"data"`
}

// ─── HTTP dispatch ────────────────────────────────────────────────────────────

// DispatchWebhook é o wrapper fire-and-forget mantido pra retrocompat
// (RabbitMQ/NATS dispatchers ainda usam). Nova lógica deve chamar
// DispatchWebhookSync (em delivery.go) e gravar via RecordDelivery.
func DispatchWebhook(webhookURL, secret string, payload WebhookPayload) {
	res := DispatchWebhookSync(webhookURL, secret, payload)
	if res.Error != "" {
		log.Warn().Str("url", webhookURL).Str("err", res.Error).Msg("webhook delivery failed")
	} else if res.StatusCode >= 400 {
		log.Warn().Str("url", webhookURL).Int("status", res.StatusCode).Msg("webhook returned error")
	}
}

// ─── RabbitMQ dispatch ────────────────────────────────────────────────────────

// DispatchRabbitMQ publishes the payload to a RabbitMQ exchange.
func DispatchRabbitMQ(amqpURL, exchange, routingKey string, payload WebhookPayload) {
	body, err := json.Marshal(payload)
	if err != nil {
		log.Error().Err(err).Msg("rabbitmq: failed to marshal payload")
		return
	}

	conn, err := amqp.Dial(amqpURL)
	if err != nil {
		log.Warn().Err(err).Str("url", amqpURL).Msg("rabbitmq: connection failed")
		return
	}
	defer conn.Close()

	ch, err := conn.Channel()
	if err != nil {
		log.Warn().Err(err).Msg("rabbitmq: failed to open channel")
		return
	}
	defer ch.Close()

	// Use default exchange if none specified
	if exchange == "" {
		exchange = "uniqchat"
	}
	if routingKey == "" {
		routingKey = payload.Event
	}

	// Declare exchange (idempotent)
	if err := ch.ExchangeDeclare(exchange, "topic", true, false, false, false, nil); err != nil {
		log.Warn().Err(err).Str("exchange", exchange).Msg("rabbitmq: exchange declare failed")
		return
	}

	err = ch.Publish(exchange, routingKey, false, false, amqp.Publishing{
		ContentType:  "application/json",
		Body:         body,
		DeliveryMode: amqp.Persistent,
		Timestamp:    payload.Timestamp,
		Headers: amqp.Table{
			"X-Instance-ID": payload.InstanceID,
			"X-Event":       payload.Event,
		},
	})
	if err != nil {
		log.Warn().Err(err).Str("exchange", exchange).Msg("rabbitmq: publish failed")
	}
}

// ─── NATS dispatch ────────────────────────────────────────────────────────────

// DispatchNATS publishes the payload to a NATS subject.
func DispatchNATS(natsURL, subject, token string, payload WebhookPayload) {
	body, err := json.Marshal(payload)
	if err != nil {
		log.Error().Err(err).Msg("nats: failed to marshal payload")
		return
	}

	opts := []natsgo.Option{
		natsgo.Name("UniqChatPublisher"),
		natsgo.Timeout(5 * time.Second),
	}
	if token != "" {
		opts = append(opts, natsgo.Token(token))
	}

	nc, err := natsgo.Connect(natsURL, opts...)
	if err != nil {
		log.Warn().Err(err).Str("url", natsURL).Msg("nats: connection failed")
		return
	}
	defer nc.Close()

	if subject == "" {
		subject = fmt.Sprintf("uniqchat.%s.%s", payload.InstanceID, payload.Event)
	}

	if err := nc.Publish(subject, body); err != nil {
		log.Warn().Err(err).Str("subject", subject).Msg("nats: publish failed")
	}
	nc.Flush()
}

// ─── WebSocket client dispatch ───────────────────────────────────────────────

// DispatchWSClient sends the payload to an external WebSocket server.
func DispatchWSClient(wsURL, token string, payload WebhookPayload) {
	body, err := json.Marshal(payload)
	if err != nil {
		log.Error().Err(err).Msg("ws-client: failed to marshal payload")
		return
	}

	header := http.Header{}
	header.Set("User-Agent", "UniqChatWebhook/1.0")
	if token != "" {
		header.Set("Authorization", "Bearer "+token)
	}

	req, err := http.NewRequest(http.MethodPost, wsURL, bytes.NewReader(body))
	if err != nil {
		log.Warn().Err(err).Str("url", wsURL).Msg("ws-client: request failed")
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Warn().Err(err).Str("url", wsURL).Msg("ws-client: delivery failed")
		return
	}
	defer resp.Body.Close()
}

// ─── Unified dispatch ─────────────────────────────────────────────────────────

// dispatchToEntry sends a payload to all enabled targets of a webhook
// entry. Pra HTTP, agora roda síncrono pra capturar status/latência e
// gravar WebhookDelivery — em goroutine separada pra não bloquear o
// caller (já estamos num goroutine spawned por dispatchEvent).
func dispatchToEntry(hook webhookEntry, payload WebhookPayload) {
	if hook.URL != "" {
		go func(url, secret, id string) {
			result := DispatchWebhookSync(url, secret, payload)
			if result.Error != "" {
				log.Warn().Str("url", url).Str("err", result.Error).Msg("webhook delivery failed")
			} else if result.StatusCode >= 400 {
				log.Warn().Str("url", url).Int("status", result.StatusCode).Msg("webhook returned error")
			}
			RecordDelivery(id, "", payload.Event, url, payload, result, 0)
		}(hook.URL, hook.Secret, hook.ID)
	}
	if hook.RabbitMQEnabled && hook.AMQPURL != "" {
		go DispatchRabbitMQ(hook.AMQPURL, hook.Exchange, hook.RoutingKey, payload)
	}
	if hook.NATSEnabled && hook.NATSURL != "" {
		go DispatchNATS(hook.NATSURL, hook.NATSSubject, hook.NATSToken, payload)
	}
	if hook.WSEnabled && hook.WSClientURL != "" {
		go DispatchWSClient(hook.WSClientURL, hook.WSClientToken, payload)
	}
}

// ─── WebSocket server messages ────────────────────────────────────────────────

// WSMessage is sent over WebSocket connections to the frontend.
type WSMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

func newWSMessage(msgType string, data interface{}) []byte {
	msg := WSMessage{Type: msgType, Data: data}
	b, err := json.Marshal(msg)
	if err != nil {
		return []byte(fmt.Sprintf(`{"type":"error","data":"%v"}`, err))
	}
	return b
}
