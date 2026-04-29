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
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/storage"
	"gorm.io/gorm"
)

// MediaHealthHandler permite ao super-admin diagnosticar a config de
// storage end-to-end via GET /v1/admin/media/health. Faz upload+presign+
// fetch de um arquivo de teste e reporta cada etapa em detalhe pra
// facilitar debug de:
//   - bucket não existente
//   - credencial errada
//   - endpoint errado
//   - signed URL não funcional (CNAME custom não aceito pelo provedor)
type MediaHealthHandler struct {
	db *gorm.DB
}

func NewMediaHealthHandler(db *gorm.DB) *MediaHealthHandler { return &MediaHealthHandler{db: db} }

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
		"ok":           resp.StatusCode == 200,
		"status":       resp.StatusCode,
		"body_match":   bytes.Equal(body.Bytes(), testData),
		"body_size":    body.Len(),
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

func (h *MediaHealthHandler) GetFile(c *fiber.Ctx) error {
	media, err := h.loadMediaFile(c)
	if err != nil {
		return err
	}
	return c.JSON(mediaFileResponse(media))
}

func (h *MediaHealthHandler) FindFile(c *fiber.Ctx) error {
	key := c.Query("key", c.Query("media_key"))
	if key == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "param ?key=<media_key> é obrigatório"})
	}
	var media models.MediaFile
	if err := h.db.First(&media, "object_key = ?", key).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "mídia não encontrada"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if !h.canAccessMedia(c, &media) {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem acesso a esta mídia"})
	}
	return c.JSON(mediaFileResponse(&media))
}

func (h *MediaHealthHandler) DownloadFile(c *fiber.Ctx) error {
	return h.proxyMediaFile(c, "attachment")
}

func (h *MediaHealthHandler) StreamFile(c *fiber.Ctx) error {
	return h.proxyMediaFile(c, "inline")
}

func (h *MediaHealthHandler) PublicRedirectFile(c *fiber.Ctx) error {
	return h.publicRedirectFile(c, false)
}

func (h *MediaHealthHandler) PublicDownloadFile(c *fiber.Ctx) error {
	return h.publicRedirectFile(c, true)
}

func (h *MediaHealthHandler) publicRedirectFile(c *fiber.Ctx, download bool) error {
	media, err := h.loadPublicMediaFile(c)
	if err != nil {
		return err
	}
	if !storage.IsConfigured() {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "storage não configurado",
		})
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	signedURL, err := storage.GlobalStorage.PresignURL(ctx, media.ObjectKey, 30*time.Minute)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "mídia não encontrada no storage"})
	}
	if download {
		return h.proxyMediaKey(c, media.ObjectKey, c.Query("filename", media.Filename), "attachment")
	}
	return c.Redirect(signedURL, fiber.StatusFound)
}

func (h *MediaHealthHandler) proxyMediaFile(c *fiber.Ctx, disposition string) error {
	media, err := h.loadMediaFile(c)
	if err != nil {
		return err
	}
	filename := c.Query("filename", media.Filename)
	return h.proxyMediaKey(c, media.ObjectKey, filename, disposition)
}

func (h *MediaHealthHandler) proxyMedia(c *fiber.Ctx, disposition string) error {
	if !storage.IsConfigured() {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "storage não configurado",
		})
	}
	key := c.Query("key")
	if key == "" {
		if id := c.Query("id", c.Query("media_id")); id != "" {
			media, err := h.loadMediaFileByID(c, id)
			if err != nil {
				return err
			}
			return h.proxyMediaKey(c, media.ObjectKey, c.Query("filename", media.Filename), disposition)
		}
	}
	if key == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "param ?key=<media_key> ou ?id=<media_id> é obrigatório",
		})
	}
	return h.proxyMediaKey(c, key, c.Query("filename"), disposition)
}

func (h *MediaHealthHandler) proxyMediaKey(c *fiber.Ctx, key, filename, disposition string) error {
	if !storage.IsConfigured() {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "storage não configurado",
		})
	}
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

func (h *MediaHealthHandler) loadMediaFile(c *fiber.Ctx) (*models.MediaFile, error) {
	return h.loadMediaFileByID(c, c.Params("id"))
}

func (h *MediaHealthHandler) loadMediaFileByID(c *fiber.Ctx, rawID string) (*models.MediaFile, error) {
	if h.db == nil {
		return nil, c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "database não configurado"})
	}
	id, err := uuid.Parse(rawID)
	if err != nil {
		return nil, c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "media_id inválido"})
	}
	var media models.MediaFile
	if err := h.db.First(&media, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "mídia não encontrada"})
		}
		return nil, c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if !h.canAccessMedia(c, &media) {
		return nil, c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "sem acesso a esta mídia"})
	}
	return &media, nil
}

func (h *MediaHealthHandler) loadPublicMediaFile(c *fiber.Ctx) (*models.MediaFile, error) {
	if h.db == nil {
		return nil, c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"error": "database não configurado"})
	}
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return nil, c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "media_id inválido"})
	}
	var media models.MediaFile
	if err := h.db.First(&media, "id = ?", id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "mídia não encontrada"})
		}
		return nil, c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return &media, nil
}

func (h *MediaHealthHandler) canAccessMedia(c *fiber.Ctx, media *models.MediaFile) bool {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return false
	}
	if user.Role == models.RoleSuperAdmin {
		return true
	}
	if media.UserID != nil && *media.UserID == user.ID {
		return true
	}
	if media.WorkspaceID == nil {
		return false
	}
	var count int64
	h.db.Model(&models.UserWorkspace{}).
		Where("user_id = ? AND workspace_id = ?", user.ID, *media.WorkspaceID).
		Count(&count)
	return count > 0
}

func mediaFileResponse(media *models.MediaFile) fiber.Map {
	out := fiber.Map{
		"id":           media.ID,
		"media_id":     media.ID,
		"object_key":   media.ObjectKey,
		"media_key":    media.ObjectKey,
		"media_type":   media.MediaType,
		"mime_type":    media.MimeType,
		"filename":     media.Filename,
		"size_bytes":   media.SizeBytes,
		"status":       media.Status,
		"public_url":   "/m/" + media.ID.String(),
		"download_url": "/v1/media/files/" + media.ID.String() + "/download",
		"stream_url":   "/v1/media/files/" + media.ID.String() + "/stream",
		"created_at":   media.CreatedAt,
	}
	if media.WorkspaceID != nil {
		out["workspace_id"] = *media.WorkspaceID
	}
	if media.InstanceID != nil {
		out["instance_id"] = *media.InstanceID
	}
	if media.MessageLogID != nil {
		out["message_log_id"] = *media.MessageLogID
	}
	return out
}
