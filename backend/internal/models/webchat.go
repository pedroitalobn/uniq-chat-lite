package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// WebChatConfig holds the configuration for the embeddable chat widget
// for a specific instance.
type WebChatConfig struct {
	ID                     uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID             uuid.UUID  `gorm:"type:uuid;not null;uniqueIndex" json:"instance_id"`
	WorkspaceID            uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	DisplayName            string     `gorm:"type:varchar(120)" json:"display_name,omitempty"`
	Greeting               string     `gorm:"type:text" json:"greeting,omitempty"`
	PrimaryColor           string     `gorm:"type:varchar(20);default:'#00d46a'" json:"primary_color"`
	Position               string     `gorm:"type:varchar(30);default:'bottom-right'" json:"position"`
	AvatarURL              string     `gorm:"type:varchar(512)" json:"avatar_url,omitempty"`
	WhatsappRedirectNumber string     `gorm:"type:varchar(30)" json:"whatsapp_redirect_number,omitempty"`
	// DestinationType controla pra onde a mensagem do widget vai:
	//   - "inbox" (default): cria conversation webchat na inbox; operador
	//     responde dali. Modo "widget puro" — bidirecional dentro do site.
	//   - "redirect_instance": widget mostra CTA "Continuar no WhatsApp"
	//     que abre wa.me/<número da instância destino> com a mensagem
	//     pré-preenchida. Não cria conversation webchat — a conversa vai
	//     acontecer via WhatsApp na instância referenciada.
	// O número resolvido vem de DestinationInstanceID.PhoneJID; o legado
	// WhatsappRedirectNumber continua funcionando como fallback até as
	// configs serem migradas.
	DestinationType       string     `gorm:"type:varchar(30);default:'inbox'" json:"destination_type"`
	DestinationInstanceID *uuid.UUID `gorm:"type:uuid" json:"destination_instance_id,omitempty"`
	HelpDeskEnabled       bool       `gorm:"default:false" json:"help_desk_enabled"`

	// ── Widget badge appearance ─────────────────────────────────────────
	BadgeStyle      string `gorm:"type:varchar(20);default:'bubble'" json:"badge_style"`      // bubble | pill | square | minimal
	BadgeIcon       string `gorm:"type:varchar(60)" json:"badge_icon,omitempty"`             // emoji or lucide icon name
	BadgeColor      string `gorm:"type:varchar(20)" json:"badge_color,omitempty"`            // hex, inherits primary_color if empty
	OffsetX         int    `gorm:"default:20" json:"offset_x"`                               // px from horizontal edge
	OffsetY         int    `gorm:"default:20" json:"offset_y"`                               // px from vertical edge
	BorderRadius    int    `gorm:"default:9999" json:"border_radius"`                        // px (9999 = pill)
	ShadowIntensity string `gorm:"type:varchar(12);default:'medium'" json:"shadow_intensity"` // none | soft | medium | strong

	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

func (w *WebChatConfig) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	if w.PrimaryColor == "" {
		w.PrimaryColor = "#00d46a"
	}
	if w.Position == "" {
		w.Position = "bottom-right"
	}
	if w.DestinationType == "" {
		w.DestinationType = "inbox"
	}
	if w.BadgeStyle == "" {
		w.BadgeStyle = "bubble"
	}
	if w.ShadowIntensity == "" {
		w.ShadowIntensity = "medium"
	}
	if w.BorderRadius == 0 {
		w.BorderRadius = 9999
	}
	return nil
}

// WebChatSession tracks a browser visitor session in the webchat widget.
type WebChatSession struct {
	ID             uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID     uuid.UUID  `gorm:"type:uuid;not null;index" json:"instance_id"`
	WorkspaceID    uuid.UUID  `gorm:"type:uuid;not null;index" json:"workspace_id"`
	SessionID      string     `gorm:"type:varchar(190);index" json:"session_id"`
	ConversationID *uuid.UUID `gorm:"type:uuid;index" json:"conversation_id,omitempty"`
	VisitorName    string     `gorm:"type:varchar(120)" json:"visitor_name,omitempty"`
	VisitorEmail   string     `gorm:"type:varchar(255)" json:"visitor_email,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

func (s *WebChatSession) BeforeCreate(tx *gorm.DB) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	return nil
}
