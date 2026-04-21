package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"
)

// OpenRouterOAuth implementa o fluxo OAuth PKCE do OpenRouter.
//
// Diferente do Claude, o OpenRouter não devolve access_token/refresh_token:
// a troca do authorization_code devolve uma API key persistente
// (sk-or-v1-...) vinculada à conta do usuário. Ou seja, após o fluxo
// armazenamos a key no campo APIKey normal e marcamos AuthType=oauth só
// pra UX — não há refresh ou expiração.
//
// Docs oficiais: https://openrouter.ai/docs/use-cases/oauth-pkce
type OpenRouterOAuth struct {
	mu      sync.Mutex
	pending map[string]*openRouterPending // state → verifier + metadata
}

type openRouterPending struct {
	verifier    string
	userID      string
	createdAt   time.Time
	callbackURL string
}

// OpenRouterKeyResp é a resposta do POST /api/v1/auth/keys.
type OpenRouterKeyResp struct {
	Key        string `json:"key"`
	UserID     string `json:"user_id,omitempty"`
	UserName   string `json:"user_name,omitempty"`
	LabelLimit int    `json:"label_limit,omitempty"`
}

const (
	DefaultOpenRouterAuthURL  = "https://openrouter.ai/auth"
	DefaultOpenRouterTokenURL = "https://openrouter.ai/api/v1/auth/keys"
)

func NewOpenRouterOAuth() *OpenRouterOAuth {
	return &OpenRouterOAuth{
		pending: make(map[string]*openRouterPending),
	}
}

func openRouterAuthURL() string {
	if v := os.Getenv("OPENROUTER_OAUTH_AUTHORIZE_URL"); v != "" {
		return v
	}
	return DefaultOpenRouterAuthURL
}

func openRouterTokenURL() string {
	if v := os.Getenv("OPENROUTER_OAUTH_TOKEN_URL"); v != "" {
		return v
	}
	return DefaultOpenRouterTokenURL
}

// DefaultOpenRouterCallbackURL calcula a URL de callback para onde o OpenRouter
// vai redirecionar o usuário após autorizar. Prioridade:
//  1. env OPENROUTER_OAUTH_CALLBACK_URL (override explícito)
//  2. env APP_URL + "/integrations/openrouter/callback" (produção)
//  3. localhost:3000 fallback (dev)
func DefaultOpenRouterCallbackURL() string {
	if v := os.Getenv("OPENROUTER_OAUTH_CALLBACK_URL"); v != "" {
		return v
	}
	if v := os.Getenv("APP_URL"); v != "" {
		return v + "/integrations/openrouter/callback"
	}
	return "http://localhost:3000/integrations/openrouter/callback"
}

// StartAuthorization gera PKCE challenge, guarda verifier+state em memória
// e devolve a URL para o usuário abrir no navegador.
func (o *OpenRouterOAuth) StartAuthorization(userID, callbackOverride string) (authURL, state, callbackURL string, err error) {
	verifier, err := generateCodeVerifier()
	if err != nil {
		return "", "", "", err
	}
	challenge := codeChallengeS256(verifier)
	state, err = generateState()
	if err != nil {
		return "", "", "", err
	}

	callbackURL = callbackOverride
	if callbackURL == "" {
		callbackURL = DefaultOpenRouterCallbackURL()
	}

	o.mu.Lock()
	for k, v := range o.pending {
		if time.Since(v.createdAt) > 15*time.Minute {
			delete(o.pending, k)
		}
	}
	o.pending[state] = &openRouterPending{
		verifier:    verifier,
		userID:      userID,
		createdAt:   time.Now(),
		callbackURL: callbackURL,
	}
	o.mu.Unlock()

	params := url.Values{}
	params.Set("callback_url", callbackURL)
	params.Set("code_challenge", challenge)
	params.Set("code_challenge_method", "S256")
	// OpenRouter propaga state via query string no redirect — usamos pra
	// correlacionar o callback com o userID sem precisar de cookie.
	params.Set("state", state)

	return fmt.Sprintf("%s?%s", openRouterAuthURL(), params.Encode()), state, callbackURL, nil
}

// ExchangeCode troca o authorization_code pela API key persistente.
// Retorna a key + userID interno associado ao state.
func (o *OpenRouterOAuth) ExchangeCode(ctx context.Context, code, state string) (*OpenRouterKeyResp, string, error) {
	o.mu.Lock()
	p, ok := o.pending[state]
	if ok {
		delete(o.pending, state)
	}
	o.mu.Unlock()
	if !ok {
		return nil, "", fmt.Errorf("state inválido ou expirado")
	}
	if time.Since(p.createdAt) > 15*time.Minute {
		return nil, "", fmt.Errorf("autorização expirada, tente de novo")
	}

	body := map[string]string{
		"code":                  code,
		"code_verifier":         p.verifier,
		"code_challenge_method": "S256",
	}
	payload, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, openRouterTokenURL(), bytes.NewReader(payload))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("falha ao chamar auth/keys: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("OpenRouter auth/keys retornou %d: %s", resp.StatusCode, string(raw))
	}

	var tok OpenRouterKeyResp
	if err := json.Unmarshal(raw, &tok); err != nil {
		return nil, "", fmt.Errorf("resposta OAuth inválida: %w", err)
	}
	if tok.Key == "" {
		return nil, "", fmt.Errorf("key ausente na resposta do OpenRouter")
	}
	return &tok, p.userID, nil
}
