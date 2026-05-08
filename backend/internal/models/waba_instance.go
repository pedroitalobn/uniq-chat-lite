package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type WABAInstance struct {
	ID               uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID       uuid.UUID `gorm:"type:uuid;not null;index" json:"instance_id"`
	WABABusinessID   string    `gorm:"type:varchar(50)" json:"waba_business_id"`
	PhoneNumberID    string    `gorm:"type:varchar(50)" json:"phone_number_id"`
	PhoneNumber      string    `gorm:"type:varchar(30)" json:"phone_number"`
	AccessToken      string    `gorm:"type:text" json:"-"`
	WebhookURL       string    `gorm:"type:text" json:"webhook_url"`
	Status           string    `gorm:"type:varchar(20);default:'active'" json:"status"`
	VerifiedName     string    `gorm:"type:varchar(100)" json:"verified_name"`
	CodeVerification string    `gorm:"type:varchar(20)" json:"code_verification,omitempty"`
	// RegistrationPIN — PIN de 6 dígitos do 2FA do WABA. Capturado no
	// /register e mantido aqui pra exibir no header da instância como
	// lembrete (com copy-to-clipboard fácil). Sem isso o user esquecia
	// e tinha que zerar 2FA na Meta toda vez que migrava de telefone /
	// re-registrava o número. Não é segredo crítico (é só um PIN do
	// 2FA do WABA, separado do AccessToken), mas mantemos com :"pin"
	// só pra UI ler ao clicar "ver PIN" — não vaza em listagens grandes
	// até pedir explicitamente.
	RegistrationPIN  string    `gorm:"column:registration_pin;type:varchar(8)" json:"pin,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

func (w *WABAInstance) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	return nil
}

func (w *WABAInstance) TableName() string {
	return "waba_instances"
}
