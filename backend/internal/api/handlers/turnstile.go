package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// verifyTurnstile valida o token do Cloudflare Turnstile recebido do frontend.
//
// Configurar via env:
//   TURNSTILE_SECRET_KEY  = secret do site (Cloudflare dashboard)
//   TURNSTILE_REQUIRED    = "true" pra exigir; vazio/false libera (dev)
//
// Quando TURNSTILE_SECRET_KEY está vazio, retorna nil (bypass) pra não
// quebrar dev local. Em produção, defina obrigatoriamente.
func verifyTurnstile(ctx context.Context, token, remoteIP string) error {
	secret := strings.TrimSpace(os.Getenv("TURNSTILE_SECRET_KEY"))
	required := strings.EqualFold(os.Getenv("TURNSTILE_REQUIRED"), "true")
	if secret == "" {
		if required {
			return errTurnstileMissing
		}
		return nil
	}
	if token == "" {
		return errTurnstileMissing
	}

	form := url.Values{}
	form.Set("secret", secret)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}

	req, _ := http.NewRequestWithContext(ctx, "POST",
		"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var r struct {
		Success    bool     `json:"success"`
		ErrorCodes []string `json:"error-codes"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return err
	}
	if !r.Success {
		return errTurnstileFailed
	}
	return nil
}

type turnstileError string

func (e turnstileError) Error() string { return string(e) }

const (
	errTurnstileMissing turnstileError = "captcha obrigatório"
	errTurnstileFailed  turnstileError = "captcha inválido"
)
