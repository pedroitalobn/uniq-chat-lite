package whatsapp

import (
	"fmt"
	"os"
	"strconv"

	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// ResolutionStep descreve uma etapa da cadeia de herança para diagnóstico.
// Mantemos a shape antiga pra não quebrar a UI, mas a cadeia agora é curta
// (server → proxy do catálogo, ou "sem proxy").
type ResolutionStep struct {
	Level   string `json:"level"`
	Mode    string `json:"mode"`
	Source  string `json:"source"`
	Applied bool   `json:"applied"`
	Reason  string `json:"reason,omitempty"`
}

// ResolvedProxy representa o proxy efetivo pra uma instância.
type ResolvedProxy struct {
	Config *ProxyConfig     `json:"-"`
	Chain  []ResolutionStep `json:"chain"`
	Source string           `json:"source"`
	Level  string           `json:"level"` // server | none
}

// ProxyResolver resolve o proxy de uma instância com base no server dela.
// Instâncias não têm mais proxy próprio — sempre herdam do server.
type ProxyResolver struct {
	db *gorm.DB
}

func NewProxyResolver(db *gorm.DB) *ProxyResolver {
	return &ProxyResolver{db: db}
}

// Resolve retorna o proxy efetivo pra uma instância.
// Regra: se o server da instância tem um Proxy associado e ativo, usa esse
// proxy. Caso contrário, conexão direta (sem proxy).
func (r *ProxyResolver) Resolve(instance *models.Instance) *ResolvedProxy {
	res := &ResolvedProxy{
		Chain: make([]ResolutionStep, 0, 2),
		Level: "none",
	}

	if instance.ServerID == nil {
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "instance", Applied: false,
			Reason: "instância sem server — sem proxy",
		})
		return res
	}

	var server models.Server
	if err := r.db.Preload("Proxy").First(&server, "id = ?", *instance.ServerID).Error; err != nil {
		if err != gorm.ErrRecordNotFound {
			log.Warn().Err(err).Str("server_id", instance.ServerID.String()).Msg("proxy: failed to load server")
		}
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "instance", Applied: false,
			Reason: "server não encontrado",
		})
		return res
	}

	if server.ProxyID == nil || server.Proxy == nil {
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "server", Applied: true, Mode: "none",
			Reason: "server sem proxy configurado",
		})
		return res
	}

	if !server.Proxy.IsActive {
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "server", Applied: false, Mode: "disabled",
			Reason: "proxy do server está inativo",
		})
		return res
	}

	cfg, source, ok := buildProxyConfig(server.Proxy)
	if !ok {
		res.Chain = append(res.Chain, ResolutionStep{
			Level: "server", Applied: false, Mode: "misconfigured",
			Source: source,
			Reason: "proxy do server sem host/porta",
		})
		return res
	}

	mode := "platform"
	if !server.Proxy.IsPlatform {
		mode = "custom"
	}
	res.Chain = append(res.Chain, ResolutionStep{
		Level: "server", Applied: true, Mode: mode, Source: source,
	})
	res.Config = cfg
	res.Level = "server"
	res.Source = source
	return res
}

// BuildProxyConfigExported expõe buildProxyConfig pra handlers que precisam
// resolver proxy pra testes/debug sem passar por uma instância.
func BuildProxyConfigExported(p *models.Proxy) (*ProxyConfig, string, bool) {
	return buildProxyConfig(p)
}

// buildProxyConfig monta um ProxyConfig a partir de um Proxy do catálogo.
// Honra UseEnv (proxies de plataforma com credenciais rotativas via env).
func buildProxyConfig(p *models.Proxy) (*ProxyConfig, string, bool) {
	host := p.Host
	port := p.Port
	user := p.Username
	passEnc := p.Password
	pType := p.ProxyType
	source := "platform"
	if !p.IsPlatform {
		source = "custom"
	}

	if p.UseEnv {
		if envHost := os.Getenv("BRIGHTDATA_HOST"); envHost != "" {
			host = envHost
		}
		if envPort := os.Getenv("BRIGHTDATA_PORT"); envPort != "" {
			if v, err := strconv.Atoi(envPort); err == nil && v > 0 {
				port = v
			}
		}
		if envUser := os.Getenv("BRIGHTDATA_USER"); envUser != "" {
			user = envUser
		}
		if envPass := os.Getenv("BRIGHTDATA_PASS"); envPass != "" {
			if enc, err := EncryptProxyPassword(envPass); err == nil {
				passEnc = enc
			}
		}
		source += "_env"
	}

	if host == "" || port <= 0 {
		return nil, source, false
	}
	pass := ""
	if passEnc != "" {
		if dec, err := DecryptProxyPassword(passEnc); err == nil {
			pass = dec
		}
	}
	if pType == "" {
		pType = "http"
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

// FormatProxyURL monta uma URL completa com senha opcionalmente mascarada.
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
