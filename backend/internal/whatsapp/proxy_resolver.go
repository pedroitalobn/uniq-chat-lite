package whatsapp

import (
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// ResolutionStep descreve uma etapa da cadeia de herança para diagnóstico.
type ResolutionStep struct {
	Level   string `json:"level"`   // instance | server | default_global
	Mode    string `json:"mode"`    // none | manual | residencial | global | inherit
	Source  string `json:"source"`  // instance_manual | server_manual | global_db | global_env | ...
	Applied bool   `json:"applied"` // true se esta etapa foi a escolhida
	Reason  string `json:"reason,omitempty"`
}

// ResolvedProxy representa a resolução completa de proxy para uma instância.
type ResolvedProxy struct {
	Config *ProxyConfig     `json:"-"`     // nil = sem proxy
	Chain  []ResolutionStep `json:"chain"` // cadeia de decisão (debug/UI)
	Source string           `json:"source"`
	Level  string           `json:"level"` // onde a decisão veio: instance, server, default_global, none
}

// ProxyResolver centraliza a resolução efetiva de proxy.
// Precedência (mais específica vence):
//  1. instance.proxy_mode = manual|residencial|global → proxy da instância
//  2. instance.proxy_mode = none → sem proxy (override explícito)
//  3. instance.proxy_mode = inherit → olha server
//     3a. server.proxy_mode = manual|residencial|global → proxy do server
//     3b. server.proxy_mode = none → sem proxy
//     3c. server.proxy_mode = inherit → default global
//  4. sem server OU inherit até o fim → default global do usuário
type ProxyResolver struct {
	db *gorm.DB
}

func NewProxyResolver(db *gorm.DB) *ProxyResolver {
	return &ProxyResolver{db: db}
}

// Resolve aplica a precedência completa e retorna o proxy efetivo + chain.
func (r *ProxyResolver) Resolve(instance *models.Instance) *ResolvedProxy {
	res := &ResolvedProxy{
		Chain: make([]ResolutionStep, 0, 3),
	}

	// ── Nível 1: Instance ────────────────────────────────────────────────────
	mode := instance.ProxyMode

	// Backward-compat: quando mode está vazio OU é "none" mas use_global_proxy=true
	// (padrão antigo do auto-assign em instances.Create), trata como "global".
	// Isso garante que instances criadas antes da Onda 2 continuem usando o proxy.
	if mode == "" || (mode == models.ProxyModeNone && instance.UseGlobalProxy) {
		switch {
		case instance.UseGlobalProxy:
			mode = models.ProxyModeGlobal
		case instance.ProxyEnabled && instance.ProxyHost != "":
			mode = models.ProxyModeManual
		case mode == "":
			// Sem sinalizações legacy e sem mode explícito → herda
			mode = models.ProxyModeInherit
		}
	}

	// Se a instância está explicitamente desabilitada via flag legacy, honra.
	// (proxy_mode=manual mas proxy_enabled=false → provavelmente desligado via UI antiga)
	if !instance.ProxyEnabled && (mode == models.ProxyModeManual || mode == models.ProxyModeResidencial) {
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "instance", Mode: string(mode), Applied: false,
			Reason: "proxy_enabled=false apesar de mode configurado — tratando como inherit",
		})
		mode = models.ProxyModeInherit
	}

	switch mode {
	case models.ProxyModeNone:
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "instance", Mode: "none", Applied: true,
			Reason: "instância marcada como sem proxy",
		})
		res.Level = "instance"
		res.Source = "none"
		return res

	case models.ProxyModeManual, models.ProxyModeResidencial:
		cfg, ok := r.buildFromInstanceFields(instance)
		if ok {
			res.Chain = append(res.Chain, ResolutionStep{
				Level: "instance", Mode: string(mode), Applied: true,
				Source: "instance_manual",
			})
			res.Config = cfg
			res.Level = "instance"
			res.Source = "instance_manual"
			return res
		}
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "instance", Mode: string(mode), Applied: false,
			Reason: "host/port vazios — caindo para herança",
		})

	case models.ProxyModeGlobal:
		if instance.GlobalProxyID != nil {
			cfg, src, ok := r.buildFromGlobalID(instance.GlobalProxyID.String())
			if ok {
				res.Chain = append(res.Chain, ResolutionStep{
					Level: "instance", Mode: "global", Applied: true, Source: src,
				})
				res.Config = cfg
				res.Level = "instance"
				res.Source = src
				return res
			}
			res.Chain = append(res.Chain, ResolutionStep{
				Level: "instance", Mode: "global", Applied: false,
				Reason: "global_proxy_id da instância não resolveu",
			})
		} else {
			res.Chain = append(res.Chain, ResolutionStep{
				Level: "instance", Mode: "global", Applied: false,
				Reason: "global_proxy_id nulo",
			})
		}

	case models.ProxyModeInherit:
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "instance", Mode: "inherit", Applied: false,
			Reason: "herdando do server/global",
		})
	}

	// ── Nível 2: Server ──────────────────────────────────────────────────────
	if instance.ServerID != nil {
		var server models.Server
		if err := r.db.First(&server, "id = ?", *instance.ServerID).Error; err == nil {
			sResolved := r.resolveServer(&server)
			res.Chain = append(res.Chain, sResolved.chainEntry)
			if sResolved.Config != nil {
				res.Config = sResolved.Config
				res.Level = "server"
				res.Source = sResolved.Source
				return res
			}
			if sResolved.blocked {
				// server.proxy_mode=none → sem proxy, não fazer fallback
				res.Level = "server"
				res.Source = "none"
				return res
			}
		} else if err != gorm.ErrRecordNotFound {
			log.Warn().Err(err).Str("server_id", instance.ServerID.String()).Msg("proxy: failed to load server")
		}
	}

	// ── Nível 3: Default Global (do workspace/usuário) ──────────────────────
	var gProxy models.GlobalProxyConfig
	// Prefere is_default, depois qualquer enabled+active
	err := r.db.Where("is_default = ? AND enabled = ? AND is_active = ?", true, true, true).
		Order("created_at DESC").First(&gProxy).Error
	if err != nil {
		if err := r.db.Where("enabled = ? AND is_active = ?", true, true).
			Order("created_at DESC").First(&gProxy).Error; err != nil {
			res.Chain = append(res.Chain, ResolutionStep{
				Level: "default_global", Mode: "global", Applied: false,
				Reason: "nenhum global proxy enabled disponível",
			})
			res.Level = "none"
			res.Source = "none"
			return res
		}
	}
	cfg, src, ok := r.buildFromGlobal(&gProxy)
	if !ok {
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "default_global", Mode: "global", Applied: false, Source: src,
			Reason: "global default resolveu host/port vazios",
		})
		res.Level = "none"
		res.Source = "none"
		return res
	}
	res.Chain = append(res.Chain, ResolutionStep{
		Level: "default_global", Mode: "global", Applied: true, Source: src,
	})
	res.Config = cfg
	res.Level = "default_global"
	res.Source = src
	return res
}

// resolveServer retorna o proxy do server + chainEntry + blocked flag.
type serverResolution struct {
	Config     *ProxyConfig
	Source     string
	chainEntry ResolutionStep
	blocked    bool // true se server.mode=none (bloqueia fallback)
}

func (r *ProxyResolver) resolveServer(server *models.Server) serverResolution {
	mode := server.ProxyMode
	if mode == "" {
		mode = models.ProxyModeInherit
	}

	switch mode {
	case models.ProxyModeNone:
		return serverResolution{
			blocked:    true,
			chainEntry: ResolutionStep{Level: "server", Mode: "none", Applied: true, Reason: "server bloqueia proxy"},
		}
	case models.ProxyModeManual, models.ProxyModeResidencial:
		if server.ProxyHost != "" && server.ProxyPort > 0 {
			pass := ""
			if server.ProxyPassword != "" {
				if dec, err := DecryptProxyPassword(server.ProxyPassword); err == nil {
					pass = dec
				}
			}
			return serverResolution{
				Config: &ProxyConfig{
					Enabled:  true,
					Type:     string(server.ProxyType),
					Host:     server.ProxyHost,
					Port:     server.ProxyPort,
					Username: server.ProxyUsername,
					Password: pass,
				},
				Source:     "server_manual",
				chainEntry: ResolutionStep{Level: "server", Mode: string(mode), Applied: true, Source: "server_manual"},
			}
		}
		return serverResolution{
			chainEntry: ResolutionStep{
				Level: "server", Mode: string(mode), Applied: false,
				Reason: "server sem host/port configurados — caindo para default global",
			},
		}
	case models.ProxyModeGlobal:
		if server.GlobalProxyID != nil {
			cfg, src, ok := r.buildFromGlobalID(*server.GlobalProxyID)
			if ok {
				return serverResolution{
					Config:     cfg,
					Source:     src,
					chainEntry: ResolutionStep{Level: "server", Mode: "global", Applied: true, Source: src},
				}
			}
		}
		return serverResolution{
			chainEntry: ResolutionStep{
				Level: "server", Mode: "global", Applied: false,
				Reason: "server aponta para global inválido",
			},
		}
	default: // inherit
		return serverResolution{
			chainEntry: ResolutionStep{
				Level: "server", Mode: "inherit", Applied: false,
				Reason: "server herda do default global",
			},
		}
	}
}

// buildFromInstanceFields constrói ProxyConfig a partir dos campos proxy_host/port/type/...
// da própria instância. Retorna (cfg, true) se válido, (nil, false) caso contrário.
func (r *ProxyResolver) buildFromInstanceFields(instance *models.Instance) (*ProxyConfig, bool) {
	if instance.ProxyHost == "" || instance.ProxyPort <= 0 {
		return nil, false
	}
	pass := ""
	if instance.ProxyPassword != "" {
		if dec, err := DecryptProxyPassword(instance.ProxyPassword); err == nil {
			pass = dec
		}
	}
	return &ProxyConfig{
		Enabled:  true,
		Type:     string(instance.ProxyType),
		Host:     instance.ProxyHost,
		Port:     instance.ProxyPort,
		Username: instance.ProxyUsername,
		Password: pass,
	}, true
}

// buildFromGlobal constrói ProxyConfig a partir de GlobalProxyConfig,
// honrando UseEnv via resolveGlobalProxyFields.
func (r *ProxyResolver) buildFromGlobal(g *models.GlobalProxyConfig) (*ProxyConfig, string, bool) {
	host, port, user, pass, pType, source := resolveGlobalProxyFields(g)
	if host == "" || port <= 0 {
		return nil, source, false
	}
	return &ProxyConfig{
		Enabled:  true,
		Type:     pType,
		Host:     host,
		Port:     port,
		Username: user,
		Password: pass,
	}, source, true
}

func (r *ProxyResolver) buildFromGlobalID(id string) (*ProxyConfig, string, bool) {
	var g models.GlobalProxyConfig
	if err := r.db.Where("id = ? AND enabled = ? AND is_active = ?", id, true, true).First(&g).Error; err != nil {
		return nil, "", false
	}
	return r.buildFromGlobal(&g)
}

// FormatProxyURL monta uma URL completa com a senha mascarada — útil para logs.
func FormatProxyURL(cfg *ProxyConfig, maskPassword bool) string {
	if cfg == nil || !cfg.Enabled {
		return ""
	}
	auth := ""
	if cfg.Username != "" {
		pass := cfg.Password
		if maskPassword && pass != "" {
			pass = "***"
		}
		if pass != "" {
			auth = fmt.Sprintf("%s:%s@", cfg.Username, pass)
		} else {
			auth = fmt.Sprintf("%s@", cfg.Username)
		}
	}
	return fmt.Sprintf("%s://%s%s:%d", cfg.Type, auth, cfg.Host, cfg.Port)
}
