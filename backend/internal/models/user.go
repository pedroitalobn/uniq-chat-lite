package models

import (
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type UserRole string

const (
	RoleSuperAdmin UserRole = "super_admin"
	RoleCustomer   UserRole = "customer"
	RoleLead       UserRole = "lead"
	// RoleValidate — role bypass pra validação Meta. Só pode criar/ver
	// instâncias WABA (Cloud API). Outros canais (WhatsApp QR, Instagram,
	// TikTok, etc) ficam ocultos no front e bloqueados no backend. Usado
	// pra contas que precisam só do fluxo WABA validado pela Meta.
	RoleValidate UserRole = "validate"
)

type User struct {
	ID                       uuid.UUID  `gorm:"type:uuid;primaryKey" json:"id"`
	Name                     string     `gorm:"not null" json:"name"`
	Email                    string     `gorm:"uniqueIndex;not null" json:"email"`
	Username                 *string    `gorm:"uniqueIndex" json:"username,omitempty"`
	PasswordHash             string     `gorm:"not null" json:"-"`
	Role                     UserRole   `gorm:"type:varchar(15);default:'customer'" json:"role"`
	IsBeta                   bool       `gorm:"default:false" json:"is_beta"`
	PlanID                   *uuid.UUID `gorm:"type:uuid" json:"plan_id"`
	Plan                     *Plan      `gorm:"foreignKey:PlanID" json:"plan,omitempty"`
	IsActive                 bool       `gorm:"default:true" json:"is_active"`
	BlockedUntil             *time.Time `json:"blocked_until,omitempty"`
	LastLoginAt              *time.Time `json:"last_login_at,omitempty"`
	// Email verification (anti-bot signup). Quando EmailVerifiedAt é nil,
	// o usuário só consegue logar se REQUIRE_EMAIL_VERIFICATION=false.
	EmailVerifiedAt          *time.Time `json:"email_verified_at,omitempty"`
	EmailVerificationToken   string     `gorm:"type:varchar(64);index" json:"-"`
	EmailVerificationSentAt  *time.Time `json:"-"`
	// Audit do signup pra rastreio de ataque/abuso.
	SignupIP                 string     `gorm:"type:varchar(64)" json:"-"`
	SignupUserAgent          string     `gorm:"type:varchar(512)" json:"-"`
	// 2FA TOTP — segredo armazenado em texto puro (DB já é criptografado at-rest;
	// o segredo precisa ser legível pra gerar códigos a cada 30s). Backup codes
	// guardados como JSON array de hashes bcrypt (nunca em plain).
	TOTPSecret               string     `gorm:"type:varchar(64)" json:"-"`
	TOTPEnabledAt            *time.Time `json:"totp_enabled_at,omitempty"`
	TOTPBackupCodesHash      string     `gorm:"type:text" json:"-"` // JSON array de bcrypt hashes
	Timezone                 string     `gorm:"type:varchar(50);default:'America/Sao_Paulo'" json:"timezone,omitempty"`
	// Customer/Subscription IDs ficam fora do JSON exposto pra cliente
	// (`json:"-"`). Esses identificadores valem ouro pra atacante
	// (consultar Stripe/Asaas direto, fazer phishing direcionado, etc).
	// Status (active/past_due/canceled) continua público pra UI mostrar
	// estado da assinatura sem expor o ID.
	StripeCustomerID         string     `gorm:"type:varchar(255)" json:"-"`
	StripeSubscriptionID     string     `gorm:"type:varchar(255)" json:"-"`
	StripeSubscriptionStatus string     `gorm:"type:varchar(50)" json:"stripe_subscription_status,omitempty"`

	// Asaas — mesmo tratamento: IDs internos ocultos, status público.
	AsaasCustomerID         string `gorm:"type:varchar(255)" json:"-"`
	AsaasSubscriptionID     string `gorm:"type:varchar(255)" json:"-"`
	AsaasSubscriptionStatus string `gorm:"type:varchar(50)" json:"asaas_subscription_status,omitempty"`
	// Asaas não suporta cancel-at-period-end nativo. Quando user pede pra
	// cancelar mas manter acesso até o fim do ciclo, gravamos o timestamp
	// aqui. Cron de billing checa diariamente e deleta a subscription
	// no servidor Asaas quando bate.
	AsaasCancelAt *time.Time `json:"asaas_cancel_at,omitempty"`

	// AbacatePay — mesmo tratamento: IDs internos ocultos, status público.
	AbacatepayCheckoutID        string `gorm:"type:varchar(255)" json:"-"`
	AbacatepaySubscriptionID     string `gorm:"type:varchar(255)" json:"-"`
	AbacatepaySubscriptionStatus string `gorm:"type:varchar(50)" json:"abacatepay_subscription_status,omitempty"`

	Workspaces []UserWorkspace `gorm:"foreignKey:UserID" json:"workspaces,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
	DeletedAt  gorm.DeletedAt  `gorm:"index" json:"-"`
}

// IsBlocked returns true if the user is either permanently inactive or temporarily blocked.
func (u *User) IsBlocked() bool {
	if !u.IsActive {
		return true
	}
	if u.BlockedUntil != nil && time.Now().Before(*u.BlockedUntil) {
		return true
	}
	return false
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == uuid.Nil {
		u.ID = uuid.New()
	}
	return nil
}

func (u *User) SetPassword(password string) error {
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	u.PasswordHash = hash
	return nil
}

// HashPassword retorna o bcrypt hash de uma senha em texto puro,
// útil quando precisamos persistir o hash em outro lugar (ex.: no
// PendingRegistration enquanto o pagamento não confirma).
func HashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

func (u *User) CheckPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
	return err == nil
}
