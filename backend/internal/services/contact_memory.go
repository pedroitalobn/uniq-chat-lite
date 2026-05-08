package services

// contact_memory.go — long-term memory por contato. Carregado no system
// prompt do agente em cada conversa, permite que ele "lembre" de
// preferências, dados e contexto comercial entre interações sem precisar
// reler todo o histórico cada vez.
//
// Fluxo:
//   1. Conversa fecha (status → resolved/closed) → SummarizeContactConversation
//      é disparado async.
//   2. Worker pega último N mensagens, roda LLM com meta-prompt PT-BR,
//      gera Summary curto + Facts estruturados.
//   3. Merge com ContactMemory existente (Summary substitui, Facts
//      deduplicados por key).
//   4. Próxima conversa: agent_runtime carrega via LoadContactMemoryPrompt
//      e injeta no system prompt.

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

const (
	// Mínimo de novas mensagens desde a última sumarização pra justificar
	// rodar LLM de novo (evita gastar token por nada).
	memorySummarizeMinNewMsgs = 4
)

// LoadContactMemoryPrompt — devolve a seção que vai pro system prompt
// quando o agente está respondendo. String vazia se não há memória.
func LoadContactMemoryPrompt(db *gorm.DB, contactID uuid.UUID) string {
	if db == nil || contactID == uuid.Nil {
		return ""
	}
	var mem models.ContactMemory
	if err := db.Where("contact_id = ?", contactID).First(&mem).Error; err != nil {
		return ""
	}
	if strings.TrimSpace(mem.Summary) == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString("MEMÓRIA DO CLIENTE (acumulada de conversas anteriores)\n")
	b.WriteString("Use estes dados pra continuar a conversa naturalmente — NÃO peça info que já está aqui.\n\n")
	b.WriteString(mem.Summary)
	// Facts em bullet pra o LLM citar com mais facilidade.
	var facts []map[string]any
	if err := json.Unmarshal([]byte(mem.Facts), &facts); err == nil && len(facts) > 0 {
		b.WriteString("\n\nDados conhecidos:")
		for _, f := range facts {
			k, _ := f["key"].(string)
			v, _ := f["value"].(string)
			if k != "" && v != "" {
				b.WriteString("\n- " + k + ": " + v)
			}
		}
	}
	return b.String()
}

// SummarizeContactConversation — atualiza ContactMemory pra um contato
// usando as últimas mensagens da conversa que acabou de fechar. Async-friendly:
// retorna error mas não trava nada se falhar.
func SummarizeContactConversation(ctx context.Context, db *gorm.DB, llm *LLMService, contactID, conversationID uuid.UUID) error {
	if db == nil || llm == nil || contactID == uuid.Nil {
		return fmt.Errorf("argumentos inválidos")
	}

	var contact models.Contact
	if err := db.First(&contact, "id = ?", contactID).Error; err != nil {
		return fmt.Errorf("contato não encontrado")
	}
	wsID := uuid.Nil
	if contact.WorkspaceID != nil {
		wsID = *contact.WorkspaceID
	}

	// Throttle: não roda se memória recente e poucas msgs novas.
	var existing models.ContactMemory
	hasMemory := db.Where("contact_id = ?", contactID).First(&existing).Error == nil

	var totalMsgs int64
	if conversationID != uuid.Nil {
		db.Model(&models.MessageLog{}).Where("conversation_id = ?", conversationID).Count(&totalMsgs)
	}
	if hasMemory && existing.LastSummarizedAt != nil &&
		int(totalMsgs)-existing.MessageCountAtLastSummary < memorySummarizeMinNewMsgs {
		return nil // nada material novo
	}

	// Pega as últimas 50 mensagens da conversa pra dar contexto rico ao LLM.
	var msgs []models.MessageLog
	if conversationID != uuid.Nil {
		db.Where("conversation_id = ?", conversationID).
			Order("created_at ASC").
			Limit(50).
			Find(&msgs)
	}
	if len(msgs) == 0 {
		return nil
	}

	transcript := buildTranscriptForMemory(msgs)
	prevSummary := ""
	if hasMemory {
		prevSummary = existing.Summary
	}
	prompt := buildMemoryMetaPrompt(contact.Name, prevSummary, existing.Facts, transcript)

	// Resolve LLM via cascata padrão (custom integration > PlatformAI).
	integration := llm.resolveIntegration(nil)
	if integration == nil {
		return fmt.Errorf("nenhuma LLM disponível pra sumarizar memória")
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	raw, err := llm.CallChatWithSystem(timeoutCtx, integration,
		"Você é um assistente que mantém memória útil sobre clientes pra agentes de atendimento. Responda APENAS com JSON válido.",
		prompt, true)
	if err != nil {
		return fmt.Errorf("LLM falhou: %w", err)
	}

	parsed := parseMemoryResponse(raw)
	if parsed.Summary == "" {
		return nil // LLM não devolveu nada útil
	}

	now := time.Now()
	mem := models.ContactMemory{
		ContactID:                 contactID,
		WorkspaceID:               wsID,
		Summary:                   parsed.Summary,
		Facts:                     mergeFactsJSON(existing.Facts, parsed.Facts),
		LastSummarizedAt:          &now,
		MessageCountAtLastSummary: int(totalMsgs),
	}
	if hasMemory {
		mem.ID = existing.ID
		mem.CreatedAt = existing.CreatedAt
		db.Save(&mem)
	} else {
		db.Create(&mem)
	}

	log.Info().
		Str("contact", contactID.String()).
		Int("transcript_msgs", len(msgs)).
		Int("summary_chars", len(parsed.Summary)).
		Msg("contact-memory: atualizada")
	return nil
}

func buildTranscriptForMemory(msgs []models.MessageLog) string {
	var b strings.Builder
	for _, m := range msgs {
		role := "Cliente"
		if m.Direction == models.DirectionOut {
			role = "Agente"
		}
		content := strings.TrimSpace(logContent(m.Content))
		if content == "" {
			continue
		}
		// Trunca msgs longas individualmente pra não estourar context window.
		if len([]rune(content)) > 600 {
			content = string([]rune(content)[:600]) + "…"
		}
		b.WriteString(role + ": " + content + "\n")
	}
	return b.String()
}

func buildMemoryMetaPrompt(name, prevSummary, prevFactsJSON, transcript string) string {
	var b strings.Builder
	b.WriteString("Seu trabalho é atualizar a MEMÓRIA DE LONGO PRAZO sobre o cliente abaixo, baseando-se no transcript da conversa que acabou de acontecer.\n\n")
	b.WriteString("Cliente: " + name + "\n\n")
	if strings.TrimSpace(prevSummary) != "" {
		b.WriteString("MEMÓRIA ANTERIOR (mantenha o que ainda for relevante e ATUALIZE com novidades):\n")
		b.WriteString(prevSummary + "\n\n")
	}
	if strings.TrimSpace(prevFactsJSON) != "" && prevFactsJSON != "[]" {
		b.WriteString("FATOS ANTERIORES (lista JSON):\n" + prevFactsJSON + "\n\n")
	}
	b.WriteString("TRANSCRIPT DA ÚLTIMA CONVERSA:\n")
	b.WriteString(transcript)
	b.WriteString(`

Responda em JSON com 2 campos:

{
  "summary": "Resumo em 3-6 linhas em PT-BR sobre quem é esse cliente, contexto comercial atual, preferências, próximos passos. Foque no que SERVIRÁ pra próxima conversa. Sem markdown, sem cabeçalhos.",
  "facts": [
    {"key": "empresa", "value": "Clínica Odonto SP"},
    {"key": "cargo", "value": "Sócia diretora"},
    {"key": "interesse", "value": "Plano Pro pra 5 atendentes"}
  ]
}

Regras pra facts:
- Inclua APENAS dados estruturados úteis pra próximas conversas (não opiniões, não eventos passados)
- Use chaves em snake_case minúsculo
- Mantenha facts antigos relevantes; substitua quando houver atualização (ex: cargo mudou)
- Máximo 10 facts no total
- Se nada útil foi aprendido, devolva facts: []
`)
	return b.String()
}

type memoryParsed struct {
	Summary string                   `json:"summary"`
	Facts   []map[string]interface{} `json:"facts"`
}

func parseMemoryResponse(raw string) memoryParsed {
	clean := strings.TrimSpace(raw)
	// Tira fences ```json ... ```
	if strings.HasPrefix(clean, "```") {
		clean = strings.TrimPrefix(clean, "```json")
		clean = strings.TrimPrefix(clean, "```")
		if i := strings.LastIndex(clean, "```"); i >= 0 {
			clean = clean[:i]
		}
	}
	if i := strings.Index(clean, "{"); i >= 0 {
		if j := strings.LastIndex(clean, "}"); j > i {
			clean = clean[i : j+1]
		}
	}
	var out memoryParsed
	_ = json.Unmarshal([]byte(clean), &out)
	out.Summary = strings.TrimSpace(out.Summary)
	return out
}

// mergeFactsJSON — funde lista nova de facts com existente, dedupando por
// key (lowercase). Novos overwrite antigos. Cap em 15 itens pra não
// inflar.
func mergeFactsJSON(prevJSON string, next []map[string]interface{}) string {
	merged := map[string]map[string]interface{}{}
	var prev []map[string]interface{}
	_ = json.Unmarshal([]byte(prevJSON), &prev)
	for _, f := range prev {
		if k, ok := f["key"].(string); ok {
			merged[strings.ToLower(strings.TrimSpace(k))] = f
		}
	}
	for _, f := range next {
		if k, ok := f["key"].(string); ok {
			f["learned_at"] = time.Now().Format("2006-01-02")
			merged[strings.ToLower(strings.TrimSpace(k))] = f
		}
	}
	out := make([]map[string]interface{}, 0, len(merged))
	for _, v := range merged {
		out = append(out, v)
	}
	if len(out) > 15 {
		out = out[:15]
	}
	b, _ := json.Marshal(out)
	return string(b)
}
