package models

import (
	"time"

	"github.com/google/uuid"
	"encoding/json"

	"gorm.io/gorm"
)

type CrmMeetingStatus string
type CrmMeetingProvider string

const (
	MeetingStatusScheduled CrmMeetingStatus = "scheduled"
	MeetingStatusCompleted CrmMeetingStatus = "completed"
	MeetingStatusCancelled CrmMeetingStatus = "cancelled"
	MeetingStatusNoShow    CrmMeetingStatus = "no_show"

	// Provider externo de calendário pra sync. "manual" = só registrado
	// no Uniq, sem espelhar em Google/Outlook.
	MeetingProviderManual  CrmMeetingProvider = "manual"
	MeetingProviderGoogle  CrmMeetingProvider = "google"
	MeetingProviderOutlook CrmMeetingProvider = "outlook"
)

// CrmMeeting representa uma reunião agendada vinculada a Deal/Contact.
// Suporta integração com Google Calendar / Outlook via External*: o
// trabalho de sync (push/pull) fica num service à parte, e os campos
// aqui guardam o estado conhecido pelo Uniq.
type CrmMeeting struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	WorkspaceID uuid.UUID `gorm:"type:uuid;not null;index" json:"workspace_id"`
	CreatedByID uuid.UUID `gorm:"type:uuid;not null;index" json:"created_by_id"`

	Title       string           `gorm:"type:varchar(200);not null" json:"title"`
	Description string           `gorm:"type:text" json:"description,omitempty"`
	Location    string           `gorm:"type:varchar(255)" json:"location,omitempty"`
	Status      CrmMeetingStatus `gorm:"type:varchar(20);default:'scheduled';index" json:"status"`

	StartAt  time.Time `gorm:"not null;index" json:"start_at"`
	EndAt    time.Time `gorm:"not null" json:"end_at"`
	Timezone string    `gorm:"type:varchar(50);default:'America/Sao_Paulo'" json:"timezone"`

	// Vínculos CRM — todos opcionais.
	DealID    *uuid.UUID `gorm:"type:uuid;index" json:"deal_id,omitempty"`
	ContactID *uuid.UUID `gorm:"type:uuid;index" json:"contact_id,omitempty"`
	CompanyID *uuid.UUID `gorm:"type:uuid;index" json:"company_id,omitempty"`

	// Participantes — JSON array de objetos
	// {user_id?, contact_id?, email, name, status, is_organizer}.
	// Mantemos em JSON pra evitar tabela join inicial — quando virar
	// crítico migramos pra meeting_attendees.
	Attendees json.RawMessage `gorm:"type:jsonb" json:"attendees,omitempty"`

	// Conferência online — link de Zoom/Meet/Jitsi/etc. Provider só
	// rotula ("google_meet" / "zoom") pra UI mostrar ícone certo.
	MeetingURL          string `gorm:"type:text" json:"meeting_url,omitempty"`
	MeetingProviderName string `gorm:"type:varchar(40)" json:"meeting_provider_name,omitempty"`

	// Sync com calendário externo. Quando ExternalEventID está vazio é
	// uma reunião "só do Uniq". Service de sync popula esses campos
	// quando consegue espelhar pro provider.
	Provider          CrmMeetingProvider `gorm:"type:varchar(15);default:'manual';index" json:"provider"`
	ExternalCalendar  string             `gorm:"type:varchar(255)" json:"external_calendar,omitempty"`
	ExternalEventID   string             `gorm:"type:varchar(255);index" json:"external_event_id,omitempty"`
	ExternalEventLink string             `gorm:"type:text" json:"external_event_link,omitempty"`
	LastSyncedAt      *time.Time         `json:"last_synced_at,omitempty"`

	// Lembretes — minutos antes do start_at; cron dispara as
	// notificações. Vazio/0 = sem lembrete.
	ReminderMinutes json.RawMessage `gorm:"type:jsonb" json:"reminder_minutes,omitempty"`

	Metadata json.RawMessage `gorm:"type:jsonb" json:"metadata,omitempty"`

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (m *CrmMeeting) BeforeCreate(_ *gorm.DB) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.Status == "" {
		m.Status = MeetingStatusScheduled
	}
	if m.Provider == "" {
		m.Provider = MeetingProviderManual
	}
	if m.Timezone == "" {
		m.Timezone = "America/Sao_Paulo"
	}
	return nil
}

func (CrmMeeting) TableName() string { return "crm_meetings" }
