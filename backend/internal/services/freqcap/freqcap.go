// Package freqcap — controle de frequência de mensagens outbound.
// Inspirado em Customer.io frequency caps.
//
// Aplica regras do workspace (per_hour / per_day / per_week) por
// contato. Falha aberta: erro de check NÃO bloqueia envio (mejor enviar
// que perder mensagem por bug no contador).
package freqcap

import (
	"time"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// Check retorna ok=true se o envio respeita os caps do workspace.
// reason vazio quando ok; preenchido quando bloqueia ("frequency_cap_hour", etc.)
func Check(db *gorm.DB, workspaceID, contactID uuid.UUID) (ok bool, reason string) {
	var ws models.Workspace
	if err := db.First(&ws, "id = ?", workspaceID).Error; err != nil {
		return true, "" // sem workspace conhecido → não bloqueia
	}
	if ws.FreqCapPerHour == 0 && ws.FreqCapPerDay == 0 && ws.FreqCapPerWeek == 0 {
		return true, ""
	}
	now := time.Now()

	type windowSpec struct {
		cap   int
		since time.Time
		name  string
	}
	windows := []windowSpec{
		{ws.FreqCapPerHour, now.Add(-1 * time.Hour), "frequency_cap_hour"},
		{ws.FreqCapPerDay, now.Add(-24 * time.Hour), "frequency_cap_day"},
		{ws.FreqCapPerWeek, now.Add(-7 * 24 * time.Hour), "frequency_cap_week"},
	}
	for _, w := range windows {
		if w.cap <= 0 {
			continue
		}
		var count int64
		// Conta mensagens outbound (de agente/sistema → contato) na janela.
		// Usa conversation_messages.direction='outbound'.
		db.Table("conversation_messages cm").
			Joins("JOIN conversations c ON c.id = cm.conversation_id").
			Where("c.workspace_id = ? AND c.contact_id = ? AND cm.direction = ? AND cm.created_at >= ?",
				workspaceID, contactID, "outbound", w.since).
			Count(&count)
		if count >= int64(w.cap) {
			return false, w.name
		}
	}
	return true, ""
}

// IsQuietNow retorna true se o horário atual está dentro do janelamento
// silencioso do workspace, considerando o timezone do contato. Se contato
// não tem TZ, usa workspace.timezone, depois America/Sao_Paulo.
func IsQuietNow(workspaceID, contactID uuid.UUID, db *gorm.DB) bool {
	var ws models.Workspace
	if err := db.First(&ws, "id = ?", workspaceID).Error; err != nil {
		return false
	}
	if ws.QuietHours == "" {
		return false
	}
	tz := contactTimezone(db, contactID)
	if tz == "" {
		tz = ws.Timezone
	}
	if tz == "" {
		tz = "America/Sao_Paulo"
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)

	startH, startM, endH, endM, ok := parseQuietHours(ws.QuietHours)
	if !ok {
		return false
	}
	cur := now.Hour()*60 + now.Minute()
	start := startH*60 + startM
	end := endH*60 + endM
	if start == end {
		return false
	}
	if start < end {
		return cur >= start && cur < end
	}
	// Janela cruza meia-noite (ex: 20:00-08:00).
	return cur >= start || cur < end
}

func contactTimezone(db *gorm.DB, contactID uuid.UUID) string {
	if contactID == uuid.Nil {
		return ""
	}
	var tz string
	db.Table("contacts").Select("timezone").Where("id = ?", contactID).Scan(&tz)
	return tz
}

func parseQuietHours(s string) (sH, sM, eH, eM int, ok bool) {
	// formato esperado: "HH:MM-HH:MM"
	if len(s) != 11 || s[2] != ':' || s[5] != '-' || s[8] != ':' {
		return
	}
	parseInt := func(c1, c2 byte) (int, bool) {
		if c1 < '0' || c1 > '9' || c2 < '0' || c2 > '9' {
			return 0, false
		}
		return int(c1-'0')*10 + int(c2-'0'), true
	}
	var ok1, ok2, ok3, ok4 bool
	sH, ok1 = parseInt(s[0], s[1])
	sM, ok2 = parseInt(s[3], s[4])
	eH, ok3 = parseInt(s[6], s[7])
	eM, ok4 = parseInt(s[9], s[10])
	ok = ok1 && ok2 && ok3 && ok4 && sH < 24 && sM < 60 && eH < 24 && eM < 60
	return
}
