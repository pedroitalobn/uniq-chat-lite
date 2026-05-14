package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"gorm.io/gorm"

	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
)

// AsaasPixAutoCron — gera as cobranças mensais do fluxo PIX Automático.
//
// Por que existe: depois que o cliente paga o immediateQrCode da
// autorização (que cobre o 1º mês e captura o consentimento), o Asaas
// NÃO debita os meses seguintes sozinho. O merchant tem que criar
// cada cobrança via POST /api/v3/payments incluindo o campo
// pixAutomaticAuthorizationId no body, entre 2 e 10 dias úteis ANTES
// da dueDate. O Asaas então executa o débito automático na dueDate.
//
// Este cron:
//   1. Roda a cada hora (busca quem está dentro da janela de criação)
//   2. Pra cada user com asaas_flow=pix_automatic + asaas_next_charge_at
//      <= now, cria o /payments via Asaas
//   3. Avança asaas_next_charge_at +1 mês
//
// Idempotência: usa externalReference do tipo "<userID>|<planID>|<YYYY-MM>"
// que permite identificar a cobrança do mês. Quando o Asaas devolve erro
// de duplicate (Asaas rejeita externalReference repetido), tratamos como
// sucesso e avançamos a data.
type AsaasPixAutoCron struct {
	db   *gorm.DB
	stop chan struct{}
}

func NewAsaasPixAutoCron(db *gorm.DB) *AsaasPixAutoCron {
	return &AsaasPixAutoCron{db: db, stop: make(chan struct{})}
}

func (c *AsaasPixAutoCron) Start() {
	go c.loop()
	log.Info().Msg("asaas pix-auto cron: started (1h interval)")
}

func (c *AsaasPixAutoCron) Stop() { close(c.stop) }

func (c *AsaasPixAutoCron) loop() {
	c.tick()
	t := time.NewTicker(1 * time.Hour)
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

func (c *AsaasPixAutoCron) tick() {
	defer func() {
		if r := recover(); r != nil {
			log.Error().Interface("panic", r).Msg("asaas pix-auto cron tick: panic recovered")
		}
	}()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	now := time.Now()
	var users []models.User
	if err := c.db.WithContext(ctx).
		Where("asaas_flow = ? AND asaas_subscription_status = ? AND asaas_subscription_id <> ?",
			"pix_automatic", "active", "").
		Where("asaas_next_charge_at IS NOT NULL AND asaas_next_charge_at <= ?", now).
		Limit(200).
		Find(&users).Error; err != nil {
		log.Warn().Err(err).Msg("asaas pix-auto cron: query failed")
		return
	}
	if len(users) == 0 {
		return
	}
	log.Info().Int("count", len(users)).Msg("asaas pix-auto cron: processing recurring charges")
	for i := range users {
		c.charge(ctx, &users[i])
	}
}

// charge — cria a cobrança mensal pra um user via /api/v3/payments e
// avança a próxima data. Erros logam mas não interrompem o loop.
func (c *AsaasPixAutoCron) charge(ctx context.Context, user *models.User) {
	if user.PlanID == nil {
		return
	}
	var plan models.Plan
	if err := c.db.WithContext(ctx).First(&plan, "id = ?", *user.PlanID).Error; err != nil {
		log.Warn().Err(err).Str("user", user.ID.String()).Msg("asaas pix-auto cron: plano não encontrado")
		return
	}
	dueDate := time.Now().AddDate(0, 0, 7) // ~5 dias úteis à frente, dentro da janela 2-10
	period := dueDate.Format("2006-01")
	body := map[string]any{
		"customer":                     user.AsaasCustomerID,
		"billingType":                  "PIX",
		"value":                        plan.Price,
		"dueDate":                      dueDate.Format("2006-01-02"),
		"pixAutomaticAuthorizationId":  user.AsaasSubscriptionID, // armazenamos o auth_id aqui
		"externalReference":            user.ID.String() + "|" + plan.ID.String() + "|" + period,
		"description":                  "Assinatura " + plan.Name + " — Uniq Chat (" + period + ")",
	}
	rawBody, _ := json.Marshal(body)

	apiKey := getAsaasAPIKey(c.db)
	if apiKey == "" {
		log.Warn().Msg("asaas pix-auto cron: sem api key configurada — pulando ciclo")
		return
	}
	url := getAsaasAPIBaseURL(c.db) + "/api/v3/payments"
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(rawBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("access_token", apiKey)

	httpClient := &http.Client{Timeout: 30 * time.Second}
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Warn().Err(err).Str("user", user.ID.String()).Msg("asaas pix-auto cron: falha de rede")
		return
	}
	defer resp.Body.Close()
	respBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		// Duplicate (mesmo externalReference) é benigno — outra execução já
		// cobrou esse mês. Avança a data normalmente.
		if !strings.Contains(strings.ToLower(string(respBytes)), "external") {
			log.Warn().Int("status", resp.StatusCode).Str("user", user.ID.String()).
				Str("body", string(respBytes)).Msg("asaas pix-auto cron: criação de payment falhou")
			return
		}
	}

	// Avança próxima data +1 mês a partir do dueDate gerado, ajustado pra
	// criar nova cobrança ~7 dias antes da próxima dueDate.
	nextDue := dueDate.AddDate(0, 1, 0)
	nextCreateAt := nextDue.AddDate(0, 0, -7)
	if err := c.db.WithContext(ctx).Model(user).Updates(map[string]any{
		"asaas_next_charge_at": nextCreateAt,
	}).Error; err != nil {
		log.Warn().Err(err).Str("user", user.ID.String()).Msg("asaas pix-auto cron: update next_charge_at falhou")
		return
	}
	log.Info().Str("user", user.ID.String()).Str("due", dueDate.Format("2006-01-02")).
		Msg("asaas pix-auto cron: cobrança mensal criada")
}

// getAsaasAPIBaseURL — host novo do Asaas (api[-sandbox].asaas.com).
// Igual ao do handler mas duplicado pra não criar dependency cycle no
// pacote services.
func getAsaasAPIBaseURL(db *gorm.DB) string {
	var settings models.PaymentSettings
	env := config.AppConfig.AsaasEnvironment
	if err := db.First(&settings).Error; err == nil && settings.AsaasEnvironment != "" {
		env = settings.AsaasEnvironment
	}
	if env == "production" {
		return "https://api.asaas.com"
	}
	return "https://api-sandbox.asaas.com"
}

func getAsaasAPIKey(db *gorm.DB) string {
	var settings models.PaymentSettings
	if err := db.First(&settings).Error; err == nil && strings.TrimSpace(settings.AsaasAPIKey) != "" {
		return settings.AsaasAPIKey
	}
	return config.AppConfig.AsaasAPIKey
}

// Compile-time guard pra fmt import (usado se virmos a precisar)
var _ = fmt.Sprintf
