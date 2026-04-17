package services

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/config"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

// ProxyManager manages the residential proxy pool.
type ProxyManager struct {
	db           *gorm.DB
	brightDataBD BrightDataConfig
}

// BrightDataConfig holds Bright Data connection parameters.
type BrightDataConfig struct {
	CustomerID string
	Zone       string
	Password   string
	Host       string
	Port       int
	Country    string
}

func NewProxyManager(db *gorm.DB) *ProxyManager {
	cfg := config.AppConfig
	return &ProxyManager{
		db: db,
		brightDataBD: BrightDataConfig{
			CustomerID: cfg.BrightDataCustomerID,
			Zone:       cfg.BrightDataZone,
			Password:   cfg.BrightDataPassword,
			Host:       cfg.BrightDataHost,
			Port:       cfg.BrightDataPort,
			Country:    "br",
		},
	}
}

// EnsurePoolHasCapacity creates a new proxy pool entry if needed.
// Called when a user subscribes to a plan with proxy residencial.
func (pm *ProxyManager) EnsurePoolHasCapacity(userID uuid.UUID, plan *models.Plan) error {
	if !plan.AllowProxyResidencial {
		return nil
	}

	// Count user's active proxy assignments
	var activeAssignments int64
	pm.db.Model(&models.InstanceProxyAssignment{}).
		Joins("JOIN instances ON instances.id = instance_proxy_assignments.instance_id").
		Where("instances.user_id = ? AND instance_proxy_assignments.released_at IS NULL", userID).
		Count(&activeAssignments)

	// Check if pool needs more proxies
	if plan.MaxProxyPool > 0 {
		var userPoolCount int64
		pm.db.Model(&models.InstanceProxyAssignment{}).
			Joins("JOIN instances ON instances.id = instance_proxy_assignments.instance_id").
			Where("instances.user_id = ? AND instance_proxy_assignments.released_at IS NULL", userID).
			Count(&userPoolCount)

		if int(userPoolCount) >= plan.MaxProxyPool {
			return fmt.Errorf("limite de proxies do plano atingido: %d", plan.MaxProxyPool)
		}
	}

	// Find or create an available proxy
	_, err := pm.GetAvailableProxy(plan.MaxInstancesPerProxy)
	return err
}

// GetAvailableProxy finds the proxy with least load or creates a new one.
func (pm *ProxyManager) GetAvailableProxy(maxPerProxy int) (*models.ProxyPool, error) {
	if maxPerProxy <= 0 {
		maxPerProxy = 5
	}

	// Find proxy with capacity (ordered by current load)
	var proxy models.ProxyPool
	err := pm.db.Where("status = ? AND current_instances < ?",
		models.ProxyPoolActive, maxPerProxy).
		Order("current_instances ASC").
		First(&proxy).Error

	if err == nil {
		return &proxy, nil
	}

	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	// No available proxy — create a new one
	return pm.CreateProxy(maxPerProxy)
}

// CreateProxy provisions a new residential proxy session via Bright Data.
func (pm *ProxyManager) CreateProxy(maxInstances int) (*models.ProxyPool, error) {
	sessionID := generateSessionID()

	// Build Bright Data username format:
	// brd-customer-<customer>-zone-<zone>-session-<session>-country-<country>
	username := fmt.Sprintf("brd-customer-%s-zone-%s-session-%s-country-%s",
		pm.brightDataBD.CustomerID,
		pm.brightDataBD.Zone,
		sessionID,
		pm.brightDataBD.Country,
	)

	// Encrypt password
	encryptedPassword, err := whatsapp.EncryptProxyPassword(pm.brightDataBD.Password)
	if err != nil {
		return nil, fmt.Errorf("failed to encrypt proxy password: %w", err)
	}

	proxy := &models.ProxyPool{
		Provider:          models.ProxyProviderBrightData,
		SessionID:         sessionID,
		Country:           pm.brightDataBD.Country,
		Host:              pm.brightDataBD.Host,
		Port:              pm.brightDataBD.Port,
		Username:          username,
		PasswordEncrypted: encryptedPassword,
		MaxInstances:      maxInstances,
		CurrentInstances:  0,
		Status:            models.ProxyPoolActive,
	}

	if err := pm.db.Create(proxy).Error; err != nil {
		return nil, fmt.Errorf("failed to create proxy pool entry: %w", err)
	}

	log.Info().
		Str("proxy_id", proxy.ID.String()).
		Str("session_id", sessionID).
		Int("max_instances", maxInstances).
		Msg("New residential proxy created")

	return proxy, nil
}

// AssignProxy assigns an instance to a proxy pool entry.
func (pm *ProxyManager) AssignProxy(instanceID uuid.UUID, plan *models.Plan) (*models.ProxyPool, error) {
	if plan == nil || !plan.AllowProxyResidencial {
		return nil, fmt.Errorf("plano não permite proxy residencial")
	}

	maxPerProxy := plan.MaxInstancesPerProxy
	if maxPerProxy <= 0 {
		maxPerProxy = 5
	}

	// Check existing assignment
	var existingAssignment models.InstanceProxyAssignment
	if err := pm.db.Where("instance_id = ? AND released_at IS NULL", instanceID).First(&existingAssignment).Error; err == nil {
		// Already assigned, return the proxy
		var proxy models.ProxyPool
		if err := pm.db.First(&proxy, existingAssignment.ProxyPoolID).Error; err == nil {
			return &proxy, nil
		}
	}

	// Check pool limits for the user
	if plan.MaxProxyPool > 0 {
		var userAssignments int64
		pm.db.Model(&models.InstanceProxyAssignment{}).
			Joins("JOIN instances ON instances.id = instance_proxy_assignments.instance_id").
			Where("instances.user_id = (SELECT user_id FROM instances WHERE id = ?) AND instance_proxy_assignments.released_at IS NULL", instanceID).
			Count(&userAssignments)

		if int(userAssignments) >= plan.MaxProxyPool {
			return nil, fmt.Errorf("limite de proxies do plano atingido: %d", plan.MaxProxyPool)
		}
	}

	// Get or create proxy
	proxy, err := pm.GetAvailableProxy(maxPerProxy)
	if err != nil {
		return nil, err
	}

	// Create assignment
	assignment := &models.InstanceProxyAssignment{
		InstanceID:  instanceID,
		ProxyPoolID: proxy.ID,
		AssignedAt:  time.Now(),
	}
	if err := pm.db.Create(assignment).Error; err != nil {
		return nil, fmt.Errorf("failed to create proxy assignment: %w", err)
	}

	// Update counters
	pm.db.Model(proxy).Update("current_instances", proxy.CurrentInstances+1)

	// Update instance proxy config
	now := time.Now().Format(time.RFC3339)
	pm.db.Model(&models.Instance{}).Where("id = ?", instanceID).Updates(map[string]interface{}{
		"proxy_mode":        models.ProxyModeResidencial,
		"proxy_enabled":     true,
		"proxy_pool_id":     proxy.ID,
		"proxy_type":        "socks5",
		"proxy_host":        proxy.Host,
		"proxy_port":        proxy.Port,
		"proxy_username":    proxy.Username,
		"proxy_password":    proxy.PasswordEncrypted,
		"proxy_status":      models.ProxyStatusOK,
		"proxy_last_tested": &now,
		// Residencial vence sobre global — limpa herança para o resolver usar estes campos
		"use_global_proxy": false,
		"global_proxy_id":  nil,
	})

	log.Info().
		Str("instance_id", instanceID.String()).
		Str("proxy_pool_id", proxy.ID.String()).
		Msg("Instance assigned to residential proxy")

	return proxy, nil
}

// ReleaseProxy unlinks an instance from its proxy pool entry.
func (pm *ProxyManager) ReleaseProxy(instanceID uuid.UUID) error {
	var assignment models.InstanceProxyAssignment
	if err := pm.db.Where("instance_id = ? AND released_at IS NULL", instanceID).First(&assignment).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil // No assignment to release
		}
		return err
	}

	now := time.Now()
	assignment.ReleasedAt = &now
	pm.db.Save(&assignment)

	// Decrement counter
	var proxy models.ProxyPool
	if err := pm.db.First(&proxy, assignment.ProxyPoolID).Error; err == nil {
		newCount := proxy.CurrentInstances - 1
		if newCount < 0 {
			newCount = 0
		}
		pm.db.Model(&proxy).Update("current_instances", newCount)

		// Optionally recycle if empty
		if newCount == 0 {
			log.Info().
				Str("proxy_pool_id", proxy.ID.String()).
				Msg("Proxy pool entry is now empty, available for reuse")
		}
	}

	// Clear instance proxy fields — incluindo flags de herança do global
	pm.db.Model(&models.Instance{}).Where("id = ?", instanceID).Updates(map[string]interface{}{
		"proxy_mode":        models.ProxyModeNone,
		"proxy_enabled":     false,
		"proxy_pool_id":     nil,
		"proxy_host":        "",
		"proxy_port":        0,
		"proxy_username":    "",
		"proxy_password":    "",
		"proxy_status":      models.ProxyStatusUntested,
		"proxy_last_tested": nil,
		"proxy_error":       "",
		"proxy_external_ip": "",
		"use_global_proxy":  false,
		"global_proxy_id":   nil,
	})

	log.Info().
		Str("instance_id", instanceID.String()).
		Msg("Instance released from residential proxy")

	return nil
}

// ReleaseAllForUser releases all proxy assignments for a user.
// Called on plan downgrade or subscription cancellation.
func (pm *ProxyManager) ReleaseAllForUser(userID uuid.UUID) error {
	var instances []models.Instance
	pm.db.Where("user_id = ? AND proxy_mode = ?", userID, models.ProxyModeResidencial).Find(&instances)

	for _, inst := range instances {
		pm.ReleaseProxy(inst.ID)
	}

	log.Info().
		Str("user_id", userID.String()).
		Int("count", len(instances)).
		Msg("Released all proxies for user")

	return nil
}

// GetProxyConfig returns the proxy config for the manager to use.
func (pm *ProxyManager) GetProxyConfig(instanceID uuid.UUID) (*whatsapp.ProxyConfig, error) {
	var instance models.Instance
	if err := pm.db.First(&instance, "id = ?", instanceID).Error; err != nil {
		return nil, err
	}

	if instance.ProxyMode == models.ProxyModeNone || !instance.ProxyEnabled {
		return &whatsapp.ProxyConfig{Enabled: false}, nil
	}

	password := ""
	if instance.ProxyPassword != "" {
		dec, err := whatsapp.DecryptProxyPassword(instance.ProxyPassword)
		if err == nil {
			password = dec
		}
	}

	return &whatsapp.ProxyConfig{
		Enabled:  true,
		Type:     string(instance.ProxyType),
		Host:     instance.ProxyHost,
		Port:     instance.ProxyPort,
		Username: instance.ProxyUsername,
		Password: password,
	}, nil
}

// GetPoolStats returns pool statistics for observability.
func (pm *ProxyManager) GetPoolStats(userID uuid.UUID) map[string]interface{} {
	var totalProxies int64
	var activeProxies int64
	var totalAssignments int64

	pm.db.Model(&models.ProxyPool{}).Count(&totalProxies)
	pm.db.Model(&models.ProxyPool{}).Where("status = ?", models.ProxyPoolActive).Count(&activeProxies)
	pm.db.Model(&models.InstanceProxyAssignment{}).
		Joins("JOIN instances ON instances.id = instance_proxy_assignments.instance_id").
		Where("instances.user_id = ? AND instance_proxy_assignments.released_at IS NULL", userID).
		Count(&totalAssignments)

	return map[string]interface{}{
		"total_proxies":    totalProxies,
		"active_proxies":   activeProxies,
		"user_assignments": totalAssignments,
	}
}

func generateSessionID() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}
