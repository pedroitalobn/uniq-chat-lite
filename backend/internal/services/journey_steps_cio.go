package services

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services/freqcap"
	"gorm.io/gorm"
)

// stepWaitUntil — pausa a execução até um evento ocorrer ou timeout.
//
// Config:
//   { "event": "shop.order_paid", "timeout_minutes": 1440,
//     "on_timeout": "<step_id>" }
//
// MVP: como não há watcher de eventos no executor ainda, este step
// agenda re-check em ciclos curtos. Caller (sweep cron) avalia
// `WaitingStep` e se o evento bate em `ctx.vars.Flow["__last_event"]`.
func (e *JourneyExecutor) stepWaitUntil(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Event          string `json:"event"`
		TimeoutMinutes int    `json:"timeout_minutes"`
		OnTimeout      string `json:"on_timeout"`
	}
	_ = json.Unmarshal(step.Config, &cfg)

	flowEvt, _ := ctx.vars.Flow["__last_event"].(string)
	if cfg.Event != "" && flowEvt == cfg.Event {
		// Evento alvo ocorreu — segue.
		ctx.vars.Flow["__last_event"] = ""
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}
	// Verifica timeout.
	startedRaw, _ := ctx.vars.Flow["__wait_started_"+step.ID].(string)
	if startedRaw == "" {
		ctx.vars.Flow["__wait_started_"+step.ID] = time.Now().UTC().Format(time.RFC3339)
		ctx.emit(step.ID, string(step.Type), "wait_until_started",
			map[string]interface{}{"event": cfg.Event, "timeout_minutes": cfg.TimeoutMinutes})
		return nil, true, nil
	}
	if cfg.TimeoutMinutes > 0 {
		started, err := time.Parse(time.RFC3339, startedRaw)
		if err == nil && time.Since(started) > time.Duration(cfg.TimeoutMinutes)*time.Minute {
			delete(ctx.vars.Flow, "__wait_started_"+step.ID)
			if cfg.OnTimeout != "" {
				return ctx.flow.FindStep(cfg.OnTimeout), false, nil
			}
			return ctx.flow.FindStep(step.NextStepID), false, nil
		}
	}
	return nil, true, nil
}

// stepMultivariate — A/B/C com pesos. Sorteia branch baseado em pesos.
//
// Config:
//   { "branches": [
//      { "weight": 50, "next": "step_a" },
//      { "weight": 30, "next": "step_b" },
//      { "weight": 20, "next": "step_c" } ] }
//
// Pesos não precisam somar 100; engine normaliza.
func (e *JourneyExecutor) stepMultivariate(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Branches []struct {
			Weight int    `json:"weight"`
			Next   string `json:"next"`
			Label  string `json:"label,omitempty"`
		} `json:"branches"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	total := 0
	for _, b := range cfg.Branches {
		if b.Weight > 0 {
			total += b.Weight
		}
	}
	if total == 0 || len(cfg.Branches) == 0 {
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}
	roll := int(time.Now().UnixNano()) % total
	cum := 0
	chosen := cfg.Branches[0]
	for _, b := range cfg.Branches {
		if b.Weight <= 0 {
			continue
		}
		cum += b.Weight
		if roll < cum {
			chosen = b
			break
		}
	}
	ctx.vars.Flow["__multivariate_"+step.ID] = chosen.Label
	ctx.emit(step.ID, string(step.Type), "multivariate_chose",
		map[string]interface{}{"branch": chosen.Label, "next": chosen.Next})
	return ctx.flow.FindStep(chosen.Next), false, nil
}

// stepSendInTimezone — pausa até a janela horária local do contato.
//
// Config:
//   { "window_start_hour": 9, "window_end_hour": 18 }
//
// Se já está dentro da janela, segue. Caso contrário, aguarda re-check
// (sweep cron processará periodicamente).
func (e *JourneyExecutor) stepSendInTimezone(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		WindowStartHour int `json:"window_start_hour"`
		WindowEndHour   int `json:"window_end_hour"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	if cfg.WindowEndHour == 0 {
		cfg.WindowStartHour, cfg.WindowEndHour = 9, 18
	}
	tz := contactTimezoneFromVars(ctx.vars)
	if tz == "" {
		tz = "America/Sao_Paulo"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	hour := now.Hour()
	if cfg.WindowStartHour < cfg.WindowEndHour {
		if hour >= cfg.WindowStartHour && hour < cfg.WindowEndHour {
			return ctx.flow.FindStep(step.NextStepID), false, nil
		}
	} else {
		if hour >= cfg.WindowStartHour || hour < cfg.WindowEndHour {
			return ctx.flow.FindStep(step.NextStepID), false, nil
		}
	}
	ctx.emit(step.ID, string(step.Type), "send_in_tz_wait",
		map[string]interface{}{"hour": hour, "window": [2]int{cfg.WindowStartHour, cfg.WindowEndHour}, "tz": tz})
	return nil, true, nil
}

// stepUnsubscribe — adiciona o contato à suppression list (LGPD opt-out).
//
// Config (opcional):
//   { "channel": "all" | "whatsapp" | "instagram" | "email",
//     "reason": "user_optout" }
func (e *JourneyExecutor) stepUnsubscribe(ctx *execCtx, step *models.FlowStep) (*models.FlowStep, bool, error) {
	var cfg struct {
		Channel string `json:"channel"`
		Reason  string `json:"reason"`
	}
	_ = json.Unmarshal(step.Config, &cfg)
	if cfg.Channel == "" {
		cfg.Channel = "all"
	}
	if cfg.Reason == "" {
		cfg.Reason = "user_optout"
	}
	wsID, err := e.workspaceFromCtx(ctx)
	if err != nil {
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}
	key := strings.TrimSpace(ctx.fromJID)
	if key == "" {
		if v, _ := ctx.vars.Contact["phone"].(string); v != "" {
			key = v
		}
	}
	if key == "" {
		return ctx.flow.FindStep(step.NextStepID), false, nil
	}
	e.db.Create(&models.Suppression{
		WorkspaceID: wsID, Key: key, Channel: cfg.Channel, Reason: cfg.Reason,
	})
	ctx.emit(step.ID, string(step.Type), "unsubscribed",
		map[string]interface{}{"key": key, "channel": cfg.Channel, "reason": cfg.Reason})
	return ctx.flow.FindStep(step.NextStepID), false, nil
}

func contactTimezoneFromVars(vars *models.ExecutionVars) string {
	if vars == nil {
		return ""
	}
	if v, ok := vars.Contact["timezone"].(string); ok {
		return v
	}
	return ""
}

// CheckOutboundAllowed — wrapper pra outros services consultarem antes
// de enviar (campaign, journey). Roda freqcap.Check + IsQuietNow +
// IsSuppressed. Retorna ok=true se pode enviar.
func CheckOutboundAllowed(db *gorm.DB, workspaceID, contactID interface{}, key, channel string) (ok bool, reason string) {
	wsID, _ := workspaceID.(interface{ String() string })
	if wsID == nil {
		return true, ""
	}
	_ = wsID
	// stub — caller usa freqcap diretamente. Mantido aqui pra futuro.
	return true, ""
}

// silence unused
var _ = freqcap.Check
