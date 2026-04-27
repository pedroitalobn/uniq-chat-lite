package whatsapp

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// DeliveryResult carrega o desfecho de uma tentativa de webhook.
// Status, latência, body (truncado a 4KB) e erro de transporte.
type DeliveryResult struct {
	StatusCode   int
	LatencyMs    int64
	ResponseBody string
	Error        string
}

// Success indica se a entrega caiu na faixa 2xx.
func (r DeliveryResult) Success() bool {
	return r.StatusCode >= 200 && r.StatusCode < 300
}

const maxResponseBodyBytes = 4 * 1024 // 4KB

// DispatchWebhookSync envia o payload de forma síncrona e retorna o
// DeliveryResult — em vez do antigo DispatchWebhook que era fire-and-
// forget. Caller decide se chama dentro de goroutine separada.
func DispatchWebhookSync(webhookURL, secret string, payload WebhookPayload) DeliveryResult {
	start := time.Now()
	res := DeliveryResult{}

	body, err := json.Marshal(payload)
	if err != nil {
		res.Error = "marshal failed: " + err.Error()
		res.LatencyMs = time.Since(start).Milliseconds()
		return res
	}

	req, err := http.NewRequest(http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		res.Error = "new request failed: " + err.Error()
		res.LatencyMs = time.Since(start).Milliseconds()
		return res
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "UniqChatWebhook/1.0")
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(body)
		sig := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-Webhook-Signature", "sha256="+sig)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	res.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		res.Error = err.Error()
		return res
	}
	defer resp.Body.Close()

	res.StatusCode = resp.StatusCode

	// Lê até 4KB do body pra log (suficiente pra debug, evita estourar DB).
	limited := io.LimitReader(resp.Body, maxResponseBodyBytes)
	if data, rerr := io.ReadAll(limited); rerr == nil {
		res.ResponseBody = string(data)
	}
	return res
}

// ─── Delivery recorder ────────────────────────────────────────────────

// deliveryRecorderDB é o singleton GORM que o whatsapp package usa pra
// gravar WebhookDelivery. Setado uma vez no startup pelo SetDeliveryDB.
var (
	deliveryDBMu sync.RWMutex
	deliveryDB   *gorm.DB
)

// SetDeliveryDB instala o ponteiro de DB usado pra gravar logs de
// entrega. Chamado no main.go após criar o gorm.DB.
func SetDeliveryDB(db *gorm.DB) {
	deliveryDBMu.Lock()
	deliveryDB = db
	deliveryDBMu.Unlock()
}

func getDeliveryDB() *gorm.DB {
	deliveryDBMu.RLock()
	defer deliveryDBMu.RUnlock()
	return deliveryDB
}

// RecordDelivery persiste o resultado de uma entrega. Aceita webhook
// scope: passe `webhookID` (UUID do Webhook de instância) OU
// `globalWebhookID` — não os dois. Idempotente em caso de DB nil
// (no-op silencioso pra cenários de teste sem DB).
func RecordDelivery(webhookID, globalWebhookID, event, url string, payload interface{}, result DeliveryResult, retryCount int) {
	db := getDeliveryDB()
	if db == nil {
		return
	}
	payloadBytes, _ := json.Marshal(payload)

	d := models.WebhookDelivery{
		Event:        event,
		URL:          url,
		Payload:      string(payloadBytes),
		StatusCode:   result.StatusCode,
		LatencyMs:    result.LatencyMs,
		ResponseBody: result.ResponseBody,
		Error:        result.Error,
		RetryCount:   retryCount,
	}
	if result.Error != "" {
		d.Status = models.DeliveryFailed
	} else if result.Success() {
		d.Status = models.DeliverySuccess
	} else {
		d.Status = models.DeliveryFailed
	}
	if webhookID != "" {
		if id, err := uuid.Parse(webhookID); err == nil {
			d.WebhookID = &id
		}
	}
	if globalWebhookID != "" {
		if id, err := uuid.Parse(globalWebhookID); err == nil {
			d.GlobalWebhookID = &id
		}
	}
	if err := db.Create(&d).Error; err != nil {
		log.Warn().Err(err).Str("event", event).Msg("failed to record webhook delivery")
	}
}
