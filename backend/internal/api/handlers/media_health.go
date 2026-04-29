package handlers

import (
	"bytes"
	"context"
	"crypto/tls"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/storage"
)

// MediaHealthHandler permite ao super-admin diagnosticar a config de
// storage end-to-end via GET /v1/admin/media/health. Faz upload+presign+
// fetch de um arquivo de teste e reporta cada etapa em detalhe pra
// facilitar debug de:
//   - bucket não existente
//   - credencial errada
//   - endpoint errado
//   - signed URL não funcional (CNAME custom não aceito pelo provedor)
type MediaHealthHandler struct{}

func NewMediaHealthHandler() *MediaHealthHandler { return &MediaHealthHandler{} }

func (h *MediaHealthHandler) Check(c *fiber.Ctx) error {
	out := fiber.Map{
		"configured": storage.IsConfigured(),
	}
	if !storage.IsConfigured() {
		out["error"] = "storage não configurado — set MINIO_* envs"
		return c.JSON(out)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// 1) Upload de teste
	testKey := "media/_health/uniq-test.txt"
	testData := []byte("uniq-chat media health check " + time.Now().Format(time.RFC3339))
	publicURL, err := storage.GlobalStorage.UploadBytes(ctx, testKey, testData, "text/plain")
	if err != nil {
		out["upload"] = fiber.Map{"ok": false, "error": err.Error()}
		return c.JSON(out)
	}
	out["upload"] = fiber.Map{"ok": true, "public_url": publicURL}

	// 2) Presign
	signedURL, err := storage.GlobalStorage.PresignURL(ctx, testKey, 5*time.Minute)
	if err != nil {
		out["presign"] = fiber.Map{"ok": false, "error": err.Error()}
		return c.JSON(out)
	}
	out["presign"] = fiber.Map{"ok": true, "signed_url": signedURL}

	// 3) Fetch da signed URL — confirma que o objeto está acessível
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: false},
		},
	}
	resp, err := client.Get(signedURL)
	if err != nil {
		out["fetch_signed"] = fiber.Map{"ok": false, "error": err.Error()}
		return c.JSON(out)
	}
	defer resp.Body.Close()
	body := new(bytes.Buffer)
	body.ReadFrom(resp.Body)
	out["fetch_signed"] = fiber.Map{
		"ok":          resp.StatusCode == 200,
		"status":      resp.StatusCode,
		"body_match":  bytes.Equal(body.Bytes(), testData),
		"body_size":   body.Len(),
		"content_type": resp.Header.Get("Content-Type"),
	}

	// 4) Fetch da public URL — confirma se bucket está public ou não
	respPub, err := client.Get(publicURL)
	if err != nil {
		out["fetch_public"] = fiber.Map{"ok": false, "error": err.Error()}
	} else {
		defer respPub.Body.Close()
		out["fetch_public"] = fiber.Map{
			"ok":     respPub.StatusCode == 200,
			"status": respPub.StatusCode,
			"hint":   "se status=403, bucket é private (esperado em produção); use signed URL",
		}
	}

	return c.JSON(out)
}

// MediaProxyDownload — força download de mídia via backend (em vez do front
// fazer fetch direto pra Hetzner que esbarra em CORS). Stream do bucket
// pro browser com Content-Disposition: attachment + filename original.
//
// GET /v1/media/download?key=<media_key>&filename=<filename-opcional>
// Auth: requireAuth (qualquer usuário logado pode baixar — assume que ele
// já tem permissão pra ver a conversa onde a mídia foi linkada).
func (h *MediaHealthHandler) Download(c *fiber.Ctx) error {
	return h.proxyMedia(c, "attachment")
}

// MediaProxyStream — mesma proxy do Download, mas com
// Content-Disposition: inline pra o browser tocar/exibir a mídia direto
// (player de áudio/vídeo, <img>, <embed>) em vez de baixar.
//
// GET /v1/media/stream?key=<media_key>&filename=<filename-opcional>
// Auth: requireAuth.
func (h *MediaHealthHandler) Stream(c *fiber.Ctx) error {
	return h.proxyMedia(c, "inline")
}

func (h *MediaHealthHandler) proxyMedia(c *fiber.Ctx, disposition string) error {
	if !storage.IsConfigured() {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "storage não configurado",
		})
	}
	key := c.Query("key")
	if key == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "param ?key=<media_key> é obrigatório",
		})
	}
	filename := c.Query("filename")
	if filename == "" {
		if idx := strings.LastIndex(key, "/"); idx >= 0 {
			filename = key[idx+1:]
		} else {
			filename = key
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	signedURL, err := storage.GlobalStorage.PresignURL(ctx, key, 5*time.Minute)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "falha ao assinar URL: " + err.Error(),
		})
	}

	client := &http.Client{
		Timeout: 60 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: false},
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, signedURL, nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	// Range pra suportar seek em <audio>/<video> (HTTP 206)
	if rng := c.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}
	resp, err := client.Do(req)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error": "falha ao buscar do storage: " + err.Error(),
		})
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 && resp.StatusCode != 206 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{
			"error":           "storage retornou erro",
			"upstream_status": resp.StatusCode,
			"body_excerpt":    string(body),
		})
	}

	c.Set("Content-Disposition", disposition+`; filename="`+filename+`"`)
	if ct := resp.Header.Get("Content-Type"); ct != "" {
		c.Set("Content-Type", ct)
	} else {
		c.Set("Content-Type", "application/octet-stream")
	}
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		c.Set("Content-Length", cl)
	}
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		c.Set("Content-Range", cr)
	}
	c.Set("Accept-Ranges", "bytes")

	c.Status(resp.StatusCode)
	return c.SendStream(resp.Body)
}
