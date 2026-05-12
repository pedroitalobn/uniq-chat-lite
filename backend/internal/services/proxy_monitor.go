package services

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/whatsapp"
	"gorm.io/gorm"
)

const (
	proxyCheckEvery   = 5 * time.Minute
	proxyCheckTimeout = 15 * time.Second
	proxyCheckURL     = "https://www.google.com"
)

// ProxyMonitor testa periodicamente os proxies da plataforma e, quando um proxy
// se recupera de uma falha, reinicia automaticamente todas as instâncias que o usam.
type ProxyMonitor struct {
	db      *gorm.DB
	manager *whatsapp.Manager
	done    chan struct{}

	mu        sync.Mutex
	lastState map[uuid.UUID]bool // proxyID → última saúde conhecida (true=ok)
}

func NewProxyMonitor(db *gorm.DB, manager *whatsapp.Manager) *ProxyMonitor {
	return &ProxyMonitor{
		db:        db,
		manager:   manager,
		done:      make(chan struct{}),
		lastState: make(map[uuid.UUID]bool),
	}
}

func (m *ProxyMonitor) Start() {
	go m.loop()
	log.Info().Msg("proxy monitor: iniciado (intervalo=5min)")
}

func (m *ProxyMonitor) Stop() { close(m.done) }

func (m *ProxyMonitor) loop() {
	ticker := time.NewTicker(proxyCheckEvery)
	defer ticker.Stop()
	// Aguarda 1min após bootstrap antes da primeira verificação
	select {
	case <-time.After(1 * time.Minute):
	case <-m.done:
		return
	}
	m.run(context.Background())
	for {
		select {
		case <-ticker.C:
			m.run(context.Background())
		case <-m.done:
			return
		}
	}
}

func (m *ProxyMonitor) run(ctx context.Context) {
	var proxies []models.Proxy
	if err := m.db.WithContext(ctx).Where("is_platform = ? AND is_active = ?", true, true).Find(&proxies).Error; err != nil {
		log.Error().Err(err).Msg("proxy monitor: erro ao listar proxies da plataforma")
		return
	}
	for i := range proxies {
		p := &proxies[i]
		ok := m.testProxy(p)
		m.handleResult(p.ID, p.Name, ok)
	}
}

func (m *ProxyMonitor) testProxy(p *models.Proxy) bool {
	cfg, _, resolved := whatsapp.BuildProxyConfigExported(p)
	if !resolved {
		return false
	}
	client, err := whatsapp.BuildHTTPClient(cfg)
	if err != nil {
		return false
	}
	client.Timeout = proxyCheckTimeout
	req, err := http.NewRequest(http.MethodHead, proxyCheckURL, nil)
	if err != nil {
		return false
	}
	resp, err := client.Do(req)
	if err != nil {
		log.Warn().Err(err).Str("proxy", p.Name).Msg("proxy monitor: falha no teste")
		return false
	}
	resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		log.Warn().Str("proxy", p.Name).Int("status", resp.StatusCode).Msg("proxy monitor: proxy respondeu status inválido")
		return false
	}
	return true
}

func (m *ProxyMonitor) handleResult(proxyID uuid.UUID, name string, healthy bool) {
	m.mu.Lock()
	prev, known := m.lastState[proxyID]
	m.lastState[proxyID] = healthy
	m.mu.Unlock()

	if !healthy {
		if !known || prev {
			log.Warn().Str("proxy", name).Str("proxy_id", proxyID.String()).
				Msg("proxy monitor: proxy indisponível — instâncias afetadas permanecerão desconectadas até recovery")
		}
		return
	}

	// Proxy voltou após falha conhecida → reiniciar instâncias afetadas
	if known && !prev {
		log.Info().Str("proxy", name).Str("proxy_id", proxyID.String()).
			Msg("proxy monitor: proxy recuperado — iniciando restart das instâncias")
		go m.restartInstancesForProxy(proxyID)
	}
}

func (m *ProxyMonitor) restartInstancesForProxy(proxyID uuid.UUID) {
	if m.manager == nil {
		return
	}
	var serverIDs []uuid.UUID
	m.db.Model(&models.Server{}).Where("proxy_id = ?", proxyID).Pluck("id", &serverIDs)
	if len(serverIDs) == 0 {
		return
	}
	var instances []models.Instance
	m.db.Where("server_id IN ? AND status IN ?", serverIDs,
		[]string{"connected", "disconnected"},
	).Find(&instances)

	restarted := 0
	for i := range instances {
		inst := &instances[i]
		if err := m.manager.RestartWithProxy(inst); err != nil {
			log.Warn().Err(err).Str("instance", inst.ID.String()).Msg("proxy monitor: falha ao reiniciar instância")
		} else {
			restarted++
		}
	}
	log.Info().Str("proxy_id", proxyID.String()).Int("restarted", restarted).
		Msg("proxy monitor: recovery concluído")
}
