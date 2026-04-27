// Package shop concentra o framework de integrações de e-commerce.
//
// Convenção: cada provider (shopify, mercado_livre, vtex, ...) é um
// arquivo separado nesse pacote que implementa a interface Provider e
// se registra via init() chamando RegisterProvider(...). O handler HTTP
// e o cron usam o registry pra resolver providers por nome — sem
// switch/case espalhado.
//
// Fase 2 entrega só o framework. Fase 3+ traz cada provider concreto.
package shop

import (
	"context"
	"fmt"
	"sync"

	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// Provider é a interface comum a TODOS os providers de e-commerce
// suportados. Cada operação recebe a Integration completa pra que o
// provider tenha acesso a credentials/config sem o caller saber o
// shape específico.
//
// Idempotência: SyncProducts deve ser idempotente (chamar 2x não cria
// duplicatas — usa external_id como chave).
//
// Concorrência: implementações devem ser stateless (não guardar dados
// em fields struct). Locks/cache ficam em ShopProvider local ou DB.
type Provider interface {
	// ID retorna o slug canônico (corresponde a models.ShopIntegrationProvider).
	// Ex: "shopify", "mercado_livre", "vtex".
	ID() string

	// DisplayName é o label pra UI ("Shopify", "Mercado Livre").
	DisplayName() string

	// AuthMode indica como o provider autentica. UI muda o flow.
	//   - AuthOAuth2:  redirect → callback → access_token
	//   - AuthAPIKey:  user cola token na UI
	//   - AuthCustom:  outro fluxo (VTEX usa AppKey+AppToken par)
	AuthMode() AuthMode

	// AuthorizeURL gera a URL de autorização OAuth (só pra AuthOAuth2).
	// state é o token aleatório armazenado pra validar callback.
	// redirectURI é montado pelo backend (uma rota canônica).
	// Pra providers não-OAuth, retorna ("", ErrNotApplicable).
	AuthorizeURL(ctx context.Context, integration *models.ShopIntegration, state string, redirectURI string) (string, error)

	// HandleCallback troca o code OAuth por access_token e popula a
	// Integration com credenciais (encriptadas via credentials.go).
	// Retorna a Integration atualizada (caller persiste).
	HandleCallback(ctx context.Context, integration *models.ShopIntegration, code string, redirectURI string) error

	// TestConnection valida as credenciais atuais (ping no provider).
	// Usado pelo botão "Testar" da UI antes de ativar.
	TestConnection(ctx context.Context, integration *models.ShopIntegration) error

	// SyncProducts puxa produtos do provider e UPSERTa em models.Product
	// usando external_provider+external_id como chave única. Atualiza
	// integration.LastSyncAt + SyncedCount + LastSyncStatus.
	//
	// since: timestamp opcional pra incremental sync (nil = full).
	SyncProducts(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, since *string) (SyncStats, error)

	// HandleWebhook processa um webhook recebido do provider. Cada
	// provider tem schema próprio — o handler genérico em router só
	// roteia pelo path /v1/shops/webhooks/:provider e delega aqui.
	HandleWebhook(ctx context.Context, db *gorm.DB, integration *models.ShopIntegration, headers map[string]string, body []byte) error
}

// AuthMode discrimina o tipo de autenticação do provider.
type AuthMode string

const (
	AuthOAuth2 AuthMode = "oauth2"
	AuthAPIKey AuthMode = "api_key"
	AuthCustom AuthMode = "custom"
)

// SyncStats é retornado por SyncProducts pra reportar o que aconteceu.
type SyncStats struct {
	Pulled   int    // total recebido do provider
	Created  int    // criados no DB
	Updated  int    // atualizados (já existiam)
	Skipped  int    // ignorados (sem mudança / inválido)
	Failed   int    // erros durante save
	Cursor   string // pra continuação em sync paginada
}

// ErrNotApplicable é retornado quando uma operação não faz sentido
// pro provider (ex: AuthorizeURL num provider de API key).
type ProviderError struct {
	Provider string
	Op       string
	Err      error
}

func (e *ProviderError) Error() string {
	return fmt.Sprintf("shop/%s: %s: %v", e.Provider, e.Op, e.Err)
}

func (e *ProviderError) Unwrap() error { return e.Err }

// ─── Registry ─────────────────────────────────────────────────────────

var (
	registryMu sync.RWMutex
	registry   = map[string]Provider{}
)

// RegisterProvider chama-se de init() em cada arquivo do provider.
// Sobrescreve registro anterior do mesmo ID (último vence — útil em testes).
func RegisterProvider(p Provider) {
	registryMu.Lock()
	registry[p.ID()] = p
	registryMu.Unlock()
}

// GetProvider resolve o impl pelo ID. Retorna nil se não registrado
// (provider está "coming_soon").
func GetProvider(id string) Provider {
	registryMu.RLock()
	defer registryMu.RUnlock()
	return registry[id]
}

// ListProviders retorna todos providers registrados (ordem indeterminada).
func ListProviders() []Provider {
	registryMu.RLock()
	defer registryMu.RUnlock()
	out := make([]Provider, 0, len(registry))
	for _, p := range registry {
		out = append(out, p)
	}
	return out
}

// IsRegistered indica se há um Provider concreto pra o ID. UI usa pra
// filtrar "ready" vs "coming_soon" no catálogo público.
func IsRegistered(id string) bool {
	registryMu.RLock()
	defer registryMu.RUnlock()
	_, ok := registry[id]
	return ok
}
