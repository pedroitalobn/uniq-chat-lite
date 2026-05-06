// Package crmtasks executa CrmTasks com assignee_type=agent.
// Vive em pacote separado pra não criar import cycle (services
// é importado por outbound — então o runner, que depende de
// ambos, precisa morar fora).
package crmtasks

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/outbound"
	"github.com/uniq-chat/backend/internal/services"
	"gorm.io/gorm"
)

// CrmTaskRunner é o worker que executa CrmTasks com assignee_type=agent.
// Polla periodicamente tarefas com due_at <= now() e status=pending,
// monta um prompt a partir das instructions + contexto do contato/deal,
// chama o LLM e — se a tarefa for do tipo "message" — dispara via
// outbound.Registry. O resultado vai pra agent_result/agent_error.
//
// Idempotência: marca status=in_progress antes de processar, completed
// (ou cancelled em erro fatal) ao terminar — re-runs não duplicam.
//
// Esse runner é minimalista: só faz mensagens whatsapp/genéricas via
// LLM. Tipos novos (call automatizado, email send) plugam aqui.
type CrmTaskRunner struct {
	db        *gorm.DB
	llm       *services.LLMService
	registry  *outbound.Registry
	tickEvery time.Duration
}

func NewCrmTaskRunner(db *gorm.DB, llm *services.LLMService, registry *outbound.Registry) *CrmTaskRunner {
	return &CrmTaskRunner{
		db:        db,
		llm:       llm,
		registry:  registry,
		tickEvery: 30 * time.Second,
	}
}

// Start lança o loop em goroutine. Chama uma vez na boot do servidor.
func (r *CrmTaskRunner) Start(ctx context.Context) {
	go func() {
		t := time.NewTicker(r.tickEvery)
		defer t.Stop()
		log.Info().Dur("tick", r.tickEvery).Msg("crm_task_runner: started")
		for {
			select {
			case <-ctx.Done():
				log.Info().Msg("crm_task_runner: stopped")
				return
			case <-t.C:
				r.tick(ctx)
			}
		}
	}()
}

func (r *CrmTaskRunner) tick(ctx context.Context) {
	defer func() {
		if rec := recover(); rec != nil {
			log.Error().Interface("panic", rec).Msg("crm_task_runner: panic recovered")
		}
	}()

	// Pega tarefas pendentes com prazo já vencido. Limit baixo pra não
	// segurar conexões em rajadas — voltamos no próximo tick se sobrar.
	var tasks []models.CrmTask
	now := time.Now()
	err := r.db.Where("status = ? AND assignee_type = ? AND due_at IS NOT NULL AND due_at <= ?",
		models.TaskStatusPending, models.TaskAssigneeAgent, now).
		Order("due_at ASC").
		Limit(20).
		Find(&tasks).Error
	if err != nil {
		log.Error().Err(err).Msg("crm_task_runner: query failed")
		return
	}
	for i := range tasks {
		r.runTask(ctx, &tasks[i])
	}
}

func (r *CrmTaskRunner) runTask(ctx context.Context, t *models.CrmTask) {
	// Lock otimista: in_progress só se ainda estiver pending. Se outro
	// worker (ou retry) já pegou, RowsAffected=0 e saímos.
	res := r.db.Model(&models.CrmTask{}).
		Where("id = ? AND status = ?", t.ID, models.TaskStatusPending).
		Updates(map[string]any{"status": models.TaskStatusInProgress})
	if res.Error != nil || res.RowsAffected == 0 {
		return
	}

	finish := func(success bool, result, errMsg string) {
		patch := map[string]any{
			"agent_executed_at": time.Now(),
			"agent_result":      result,
			"agent_error":       errMsg,
		}
		if success {
			patch["status"] = models.TaskStatusCompleted
			patch["completed_at"] = time.Now()
		} else {
			// Falha não fatal — volta pra pending pro próximo tick
			// tentar de novo. Só marca cancelled em erros estruturais.
			patch["status"] = models.TaskStatusPending
		}
		r.db.Model(&models.CrmTask{}).Where("id = ?", t.ID).Updates(patch)
	}

	contextStr := r.buildContext(t)
	prompt := r.buildPrompt(t, contextStr)

	llmResp, err := r.llm.CallChat(ctx, nil, prompt, false)
	if err != nil {
		log.Error().Err(err).Str("task_id", t.ID.String()).Msg("crm_task_runner: llm failed")
		finish(false, "", "LLM error: "+err.Error())
		return
	}
	llmResp = strings.TrimSpace(llmResp)

	// Tipos que precisam disparar mensagem via outbound. Outros
	// (follow_up/custom/etc) só registram a resposta gerada como
	// "preview" — humano decide se manda.
	if t.Type == models.TaskTypeMessage && t.ContactID != nil {
		if err := r.dispatchMessage(ctx, t, llmResp); err != nil {
			log.Error().Err(err).Str("task_id", t.ID.String()).Msg("crm_task_runner: dispatch failed")
			finish(false, llmResp, "Falha ao enviar: "+err.Error())
			return
		}
	}
	finish(true, llmResp, "")
}

// buildContext monta uma string com contato/deal/empresa pra alimentar
// o LLM com info concreta. Tudo opcional — vazios saem omitidos.
func (r *CrmTaskRunner) buildContext(t *models.CrmTask) string {
	var b strings.Builder
	if t.ContactID != nil {
		var c models.Contact
		if r.db.First(&c, "id = ?", t.ContactID).Error == nil {
			fmt.Fprintf(&b, "Contato: %s (%s)\n", c.Name, c.Phone)
			if c.JobTitle != "" {
				fmt.Fprintf(&b, "Cargo: %s\n", c.JobTitle)
			}
		}
	}
	if t.DealID != nil {
		var d models.Deal
		if r.db.First(&d, "id = ?", t.DealID).Error == nil {
			fmt.Fprintf(&b, "Negócio: %s (R$ %.2f)\n", d.Title, d.Value)
		}
	}
	if t.MeetingID != nil {
		var m models.CrmMeeting
		if r.db.First(&m, "id = ?", t.MeetingID).Error == nil {
			fmt.Fprintf(&b, "Reunião: %s em %s\n", m.Title, m.StartAt.Format("02/01 15:04"))
		}
	}
	return b.String()
}

func (r *CrmTaskRunner) buildPrompt(t *models.CrmTask, ctxStr string) string {
	var b strings.Builder
	b.WriteString("Você é um agente de CRM executando uma tarefa pra um time de vendas.\n\n")
	if ctxStr != "" {
		b.WriteString("Contexto:\n")
		b.WriteString(ctxStr)
		b.WriteString("\n")
	}
	if t.Description != "" {
		b.WriteString("Descrição da tarefa: ")
		b.WriteString(t.Description)
		b.WriteString("\n")
	}
	b.WriteString("\nInstruções específicas:\n")
	b.WriteString(t.AgentInstructions)
	if t.Type == models.TaskTypeMessage {
		b.WriteString("\n\nResponda APENAS com o texto da mensagem que deve ser enviada — sem comentários, sem aspas, sem prefixos. Use português brasileiro, tom profissional mas amigável.")
	}
	return b.String()
}

func (r *CrmTaskRunner) dispatchMessage(ctx context.Context, t *models.CrmTask, body string) error {
	if r.registry == nil {
		return fmt.Errorf("outbound registry indisponível")
	}
	if t.AgentInstanceID == nil {
		return fmt.Errorf("agent_instance_id obrigatório pra dispatch automático")
	}
	var inst models.Instance
	if err := r.db.First(&inst, "id = ?", *t.AgentInstanceID).Error; err != nil {
		return fmt.Errorf("instância %s não encontrada", t.AgentInstanceID)
	}
	var contact models.Contact
	if err := r.db.First(&contact, "id = ?", *t.ContactID).Error; err != nil {
		return fmt.Errorf("contato não encontrado")
	}
	to := strings.TrimSpace(contact.ExternalID)
	if to == "" {
		to = strings.TrimSpace(contact.Phone)
	}
	if to == "" {
		return fmt.Errorf("contato sem JID/phone")
	}
	_, err := r.registry.Send(ctx, &inst, outbound.OutboundMessage{
		To:   to,
		Type: "text",
		Body: body,
	})
	return err
}
