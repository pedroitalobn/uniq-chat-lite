package handlers

import (
	"bytes"
	"context"
	"crypto/tls"
	"net/http"
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
