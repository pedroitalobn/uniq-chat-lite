package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
)

// Diagnostics — endpoint pra ajudar o user a debugar o cenário "API
// retorna sent mas a mensagem não chega".
//
// Causas comuns que esse diagnóstico cobre:
//   1. Webhook do app não está subscrito no WABA → nunca recebemos status
//      delivered/failed, então o status fica eternamente "sent" mesmo se
//      Meta tiver entregado (ou rejeitado).
//   2. Webhook URL não foi configurado no Meta App Settings → idem.
//   3. Phone number sem messaging_limit suficiente (tier baixo).
//   4. Status do phone number ≠ CONNECTED (PENDING/FLAGGED/RESTRICTED).
//   5. Quality rating GREEN/YELLOW/RED — RED suprime entrega.
//
// Resposta inclui o webhook URL público que o user precisa colar no Meta
// App Settings + verify token, pra ele poder copiar/pegar e configurar.
//
// GET /v1/instances/:id/waba/diagnostics
func (h *WABAHandler) GetDiagnostics(c *fiber.Ctx) error {
	instanceID := c.Params("id")
	var waba models.WABAInstance
	if err := h.db.Where("instance_id = ?", instanceID).First(&waba).Error; err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "WABA instance not found"})
	}
	if waba.AccessToken == "" || waba.WABABusinessID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "waba sem credenciais"})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// 1. Subscribed apps — quem está ouvindo eventos desse WABA. Se nosso
	//    app não está aqui, NUNCA receberemos status updates.
	subscribed := h.fetchSubscribedApps(ctx, &waba)

	// 2. Phone number health — limite, status, quality rating.
	phoneHealth := h.fetchPhoneHealth(ctx, &waba)

	// 3. Stats locais — quantas mensagens estão "presas" em sent e nunca
	//    avançaram pra delivered/read/failed. Sintoma forte de webhook off.
	stuckStats := h.fetchStuckStats(&waba)

	// Webhook URL público que o user precisa colar no Meta App Dashboard.
	webhookURL := strings.TrimRight(config.AppConfig.APIURL, "/") + "/waba/webhook"
	verifyToken := config.AppConfig.MetaWebhookVerifyToken

	// Severidade: se houver stuck > 0 e nenhum app subscrito, é RED.
	severity := "ok"
	hints := []string{}
	if !subscribed.HasOurApp && len(subscribed.Apps) == 0 {
		severity = "critical"
		hints = append(hints, "Nenhum app subscrito no WABA — Meta NÃO envia status updates pra gente. Configure o webhook no painel da Meta (App → WhatsApp → Configuration) usando a URL e verify token abaixo.")
	}
	if stuckStats.SentNotDelivered > 5 && severity == "ok" {
		severity = "warn"
		hints = append(hints, fmt.Sprintf("%d mensagens estão paradas em 'sent' há mais de 5 min sem evoluir pra delivered/failed — sintoma típico de webhook não configurado ou queda do callback.", stuckStats.SentNotDelivered))
	}
	if phoneHealth.QualityRating == "RED" {
		severity = "critical"
		hints = append(hints, "Quality rating RED no phone number — Meta está suprimindo a entrega. Reduza disparos, melhore conteúdo, e aguarde retorno pra GREEN.")
	}
	if phoneHealth.NameStatus != "" && phoneHealth.NameStatus != "APPROVED" {
		hints = append(hints, fmt.Sprintf("Display name não aprovado (status=%s) — verifique no Meta Business Manager.", phoneHealth.NameStatus))
	}

	return c.JSON(fiber.Map{
		"severity":          severity,
		"hints":             hints,
		"webhook_url":       webhookURL,
		"verify_token":      verifyToken,
		"subscribed_apps":   subscribed,
		"phone_health":      phoneHealth,
		"stuck_messages":    stuckStats,
	})
}

type subscribedAppsView struct {
	HasOurApp bool                     `json:"has_our_app"` // detectar pelo app_id se conhecido
	Apps      []map[string]interface{} `json:"apps"`
	Error     string                   `json:"error,omitempty"`
}

func (h *WABAHandler) fetchSubscribedApps(ctx context.Context, waba *models.WABAInstance) subscribedAppsView {
	graphURL := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/%s/subscribed_apps?access_token=%s",
		waba.WABABusinessID, url.QueryEscape(waba.AccessToken),
	)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, graphURL, nil)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return subscribedAppsView{Error: err.Error()}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return subscribedAppsView{Error: fmt.Sprintf("status %d: %s", resp.StatusCode, truncateBody(string(body), 200))}
	}
	var meta struct {
		Data []map[string]interface{} `json:"data"`
	}
	_ = json.Unmarshal(body, &meta)
	view := subscribedAppsView{Apps: meta.Data}
	if appID := config.AppConfig.MetaAppID; appID != "" {
		for _, app := range meta.Data {
			id, _ := app["id"].(string)
			whatsappAppID, _ := app["whatsapp_business_api_data"].(map[string]interface{})
			if whatsappAppID != nil {
				if wid, _ := whatsappAppID["id"].(string); wid == appID {
					view.HasOurApp = true
					break
				}
			}
			if id == appID {
				view.HasOurApp = true
				break
			}
		}
	}
	return view
}

type phoneHealthView struct {
	DisplayNumber  string `json:"display_number"`
	VerifiedName   string `json:"verified_name"`
	QualityRating  string `json:"quality_rating"`   // GREEN | YELLOW | RED | UNKNOWN
	MessagingLimit string `json:"messaging_limit"`  // TIER_50 | TIER_250 | TIER_1K | TIER_10K | ...
	NameStatus     string `json:"name_status"`      // APPROVED | PENDING | DECLINED
	Status         string `json:"status"`           // CONNECTED | DISCONNECTED | ...
	Error          string `json:"error,omitempty"`
}

func (h *WABAHandler) fetchPhoneHealth(ctx context.Context, waba *models.WABAInstance) phoneHealthView {
	if waba.PhoneNumberID == "" {
		return phoneHealthView{Error: "phone_number_id ausente"}
	}
	fields := "display_phone_number,verified_name,quality_rating,messaging_limit_tier,name_status,status,throughput"
	graphURL := fmt.Sprintf(
		"https://graph.facebook.com/v18.0/%s?fields=%s&access_token=%s",
		waba.PhoneNumberID, fields, url.QueryEscape(waba.AccessToken),
	)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, graphURL, nil)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return phoneHealthView{Error: err.Error()}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return phoneHealthView{Error: fmt.Sprintf("status %d: %s", resp.StatusCode, truncateBody(string(body), 200))}
	}
	var meta struct {
		DisplayPhoneNumber string `json:"display_phone_number"`
		VerifiedName       string `json:"verified_name"`
		QualityRating      string `json:"quality_rating"`
		MessagingLimitTier string `json:"messaging_limit_tier"`
		NameStatus         string `json:"name_status"`
		Status             string `json:"status"`
	}
	_ = json.Unmarshal(body, &meta)
	return phoneHealthView{
		DisplayNumber:  meta.DisplayPhoneNumber,
		VerifiedName:   meta.VerifiedName,
		QualityRating:  meta.QualityRating,
		MessagingLimit: meta.MessagingLimitTier,
		NameStatus:     meta.NameStatus,
		Status:         meta.Status,
	}
}

type stuckStatsView struct {
	SentNotDelivered int `json:"sent_not_delivered"` // outbound em "sent" há >5min
	Last24h          int `json:"sent_last_24h"`      // total enviado nas últimas 24h
	Delivered24h     int `json:"delivered_last_24h"` // entregues últimas 24h
}

func (h *WABAHandler) fetchStuckStats(waba *models.WABAInstance) stuckStatsView {
	view := stuckStatsView{}
	cutoff := time.Now().Add(-5 * time.Minute)
	day := time.Now().Add(-24 * time.Hour)
	var stuck int64
	h.db.Model(&models.MessageLog{}).
		Where("instance_id = ? AND direction = ? AND status = ? AND created_at < ?",
			waba.InstanceID, models.DirectionOut, models.MessageStatusSent, cutoff).
		Count(&stuck)
	view.SentNotDelivered = int(stuck)

	var sent, delivered int64
	h.db.Model(&models.MessageLog{}).
		Where("instance_id = ? AND direction = ? AND created_at >= ?",
			waba.InstanceID, models.DirectionOut, day).
		Count(&sent)
	view.Last24h = int(sent)

	h.db.Model(&models.MessageLog{}).
		Where("instance_id = ? AND direction = ? AND created_at >= ? AND status IN ?",
			waba.InstanceID, models.DirectionOut, day,
			[]models.MessageStatus{models.MessageStatusDelivered, models.MessageStatusRead}).
		Count(&delivered)
	view.Delivered24h = int(delivered)
	return view
}
