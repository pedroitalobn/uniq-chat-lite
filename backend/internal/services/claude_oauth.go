package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// ClaudeOAuth gerencia o fluxo OAuth 2.0 + PKCE para contas Claude.ai.
//
// A Anthropic expõe o endpoint público de OAuth usado pelo Claude Code e
// outras ferramentas first-party. Os endpoints e client_id ficam abaixo —
// todos são conhecidos/públicos (não há secret em clients PKCE).
//
// Fluxo:
//  1. StartAuthorization: gera PKCE verifier/challenge + state, retorna URL
//     para o usuário abrir no navegador.
//  2. ExchangeCode: troca authorization_code por access/refresh tokens.
//  3. RefreshAccessToken: renova o access token usando o refresh token.
//
// O pending state é armazenado em memória (map sync) por algumas minutos até
// o callback chegar — single-process é suficiente para esta versão.
type ClaudeOAuth struct {
	mu      sync.Mutex
	pending map[string]*pendingAuth // state → verifier + metadata
}

type pendingAuth struct {
	verifier  string
	userID    string // nosso UserID (uniq-chat) para associar ao callback
	createdAt time.Time
	// Optional: redirect URI escolhida (permite overrride por workspace)
	redirectURI string
}

// ClaudeOAuthTokenResp é a resposta canônica do token endpoint (OAuth 2.0).
type ClaudeOAuthTokenResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	Account      string `json:"account,omitempty"` // email ou ID, se disponível
}

// Configurable defaults (Anthropic's public OAuth parameters — equivalent to
// what Claude Code uses). Podem ser sobrescritos via env para self-hosted.
const (
	DefaultClaudeOAuthClientID  = "9d1c250a-e61b-44d9-88ed-5944d1962f5e" // Anthropic public OAuth client id
	DefaultClaudeOAuthAuthURL   = "https://claude.ai/oauth/authorize"
	DefaultClaudeOAuthTokenURL  = "https://console.anthropic.com/v1/oauth/token"
	DefaultClaudeOAuthRedirect  = "https://console.anthropic.com/oauth/code/callback"
	DefaultClaudeOAuthScope     = "org:create_api_key user:profile user:inference"
	DefaultClaudeOAuthGrantType = "authorization_code"
)

// NewClaudeOAuth creates a new OAuth manager.
func NewClaudeOAuth() *ClaudeOAuth {
	return &ClaudeOAuth{
		pending: make(map[string]*pendingAuth),
	}
}

// claudeClientID retorna o client_id configurado (env CLAUDE_OAUTH_CLIENT_ID) ou default.
func claudeClientID() string {
	if v := os.Getenv("CLAUDE_OAUTH_CLIENT_ID"); v != "" {
		return v
	}
	return DefaultClaudeOAuthClientID
}

func claudeAuthURL() string {
	if v := os.Getenv("CLAUDE_OAUTH_AUTHORIZE_URL"); v != "" {
		return v
	}
	return DefaultClaudeOAuthAuthURL
}

func claudeTokenURL() string {
	if v := os.Getenv("CLAUDE_OAUTH_TOKEN_URL"); v != "" {
		return v
	}
	return DefaultClaudeOAuthTokenURL
}

func claudeRedirectURI() string {
	if v := os.Getenv("CLAUDE_OAUTH_REDIRECT_URI"); v != "" {
		return v
	}
	return DefaultClaudeOAuthRedirect
}

// StartAuthorization gera o PKCE challenge, armazena verifier+state em memória
// e retorna a URL de autorização para o usuário abrir.
//
// userID é o nosso identificador interno para correlacionar o callback.
func (o *ClaudeOAuth) StartAuthorization(userID string) (authURL, state string, err error) {
	verifier, err := generateCodeVerifier()
	if err != nil {
		return "", "", err
	}
	challenge := codeChallengeS256(verifier)
	state, err = generateState()
	if err != nil {
		return "", "", err
	}

	o.mu.Lock()
	// Cleanup stale (>15min)
	for k, v := range o.pending {
		if time.Since(v.createdAt) > 15*time.Minute {
			delete(o.pending, k)
		}
	}
	o.pending[state] = &pendingAuth{
		verifier:    verifier,
		userID:      userID,
		createdAt:   time.Now(),
		redirectURI: claudeRedirectURI(),
	}
	o.mu.Unlock()

	params := url.Values{}
	params.Set("code", "true")
	params.Set("client_id", claudeClientID())
	params.Set("response_type", "code")
	params.Set("redirect_uri", claudeRedirectURI())
	params.Set("scope", DefaultClaudeOAuthScope)
	params.Set("code_challenge", challenge)
	params.Set("code_challenge_method", "S256")
	params.Set("state", state)

	return fmt.Sprintf("%s?%s", claudeAuthURL(), params.Encode()), state, nil
}

// ExchangeCode troca o authorization_code (com state) por access/refresh tokens.
// Retorna também o userID interno associado ao state.
func (o *ClaudeOAuth) ExchangeCode(ctx context.Context, code, state string) (*ClaudeOAuthTokenResp, string, error) {
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

	// A página de callback da Anthropic exibe o código no formato "code#state"
	// para copy-paste manual. Separamos aqui para não contaminar o token endpoint.
	rawCode := strings.SplitN(code, "#", 2)[0]

	// RFC 6749 §4.1.3: token endpoint exige application/x-www-form-urlencoded.
	// `state` não faz parte do token request — só vai na autorização e no
	// lookup interno acima.
	form := url.Values{}
	form.Set("grant_type", DefaultClaudeOAuthGrantType)
	form.Set("client_id", claudeClientID())
	form.Set("code", rawCode)
	form.Set("redirect_uri", p.redirectURI)
	form.Set("code_verifier", p.verifier)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, claudeTokenURL(), strings.NewReader(form.Encode()))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("falha ao chamar token endpoint: %w", err)
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Log completo para debug — o Cloudflare apaga o body no 502 do
		// handler, então precisamos ver aqui o que a Anthropic devolveu.
		fmt.Printf("[claude-oauth] token endpoint %d | body: %s\n", resp.StatusCode, string(raw))
		return nil, "", fmt.Errorf("OAuth token endpoint retornou %d: %s", resp.StatusCode, string(raw))
	}

	var tok ClaudeOAuthTokenResp
	if err := json.Unmarshal(raw, &tok); err != nil {
		return nil, "", fmt.Errorf("resposta OAuth inválida: %w", err)
	}
	if tok.AccessToken == "" {
		return nil, "", fmt.Errorf("access_token ausente na resposta OAuth")
	}
	return &tok, p.userID, nil
}

// RefreshAccessToken renova o access token usando o refresh token.
func (o *ClaudeOAuth) RefreshAccessToken(ctx context.Context, refreshToken string) (*ClaudeOAuthTokenResp, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("client_id", claudeClientID())
	form.Set("refresh_token", refreshToken)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, claudeTokenURL(), strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("refresh retornou %d: %s", resp.StatusCode, string(raw))
	}

	var tok ClaudeOAuthTokenResp
	if err := json.Unmarshal(raw, &tok); err != nil {
		return nil, fmt.Errorf("resposta refresh inválida: %w", err)
	}
	if tok.AccessToken == "" {
		return nil, fmt.Errorf("access_token ausente na resposta de refresh")
	}
	// O endpoint pode não retornar novo refresh_token — preserva o anterior se vazio
	if tok.RefreshToken == "" {
		tok.RefreshToken = refreshToken
	}
	return &tok, nil
}

// ─── PKCE helpers ─────────────────────────────────────────────────────────────

func generateCodeVerifier() (string, error) {
	b := make([]byte, 64)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func codeChallengeS256(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func generateState() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return strings.TrimRight(base64.URLEncoding.EncodeToString(b), "="), nil
}
