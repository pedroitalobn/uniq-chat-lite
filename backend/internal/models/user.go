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
	StripeCustomerID         string     `gorm:"type:varchar(255)" json:"stripe_customer_id,omitempty"`
	StripeSubscriptionID     string     `gorm:"type:varchar(255)" json:"stripe_subscription_id,omitempty"`
	StripeSubscriptionStatus string     `gorm:"type:varchar(50)" json:"stripe_subscription_status,omitempty"`

	// Asaas
	AsaasCustomerID         string `gorm:"type:varchar(255)" json:"asaas_customer_id,omitempty"`
	AsaasSubscriptionID     string `gorm:"type:varchar(255)" json:"asaas_subscription_id,omitempty"`
	AsaasSubscriptionStatus string `gorm:"type:varchar(50)" json:"asaas_subscription_status,omitempty"`

	Workspaces []UserWorkspace `gorm:"foreignKey:UserID" json:"workspaces,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
	UpdatedAt  time.Time       `json:"updated_at"`
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
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return err
	}
	u.PasswordHash = string(hash)
	return nil
}

func (u *User) CheckPassword(password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password))
	return err == nil
}
