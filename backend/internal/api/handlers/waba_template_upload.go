package handlers

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/storage"
)

// UploadTemplateMedia — recebe um arquivo de mídia (image/video/document)
// que vai ser usado como header em template WABA. Sobe pro MinIO e
// devolve a URL pública pronta pra usar diretamente no payload da
// Cloud API.
//
// Por que: a Meta exige um link público pra cada envio de template
// com header de mídia (a amostra da aprovação não pode ser reusada).
// Antes o user precisava ter um S3 / Cloudinary / etc. próprio — agora
// a Uniq hospeda direto.
//
// POST /v1/instances/:id/waba/upload-media (multipart/form-data)
//   • file=<binary>                        — obrigatório
//   • template_name=<string>               — opcional, salva como default
//   • template_language=<string>           — opcional, salva como default
//
// Quando template_name+template_language vêm, faz upsert na tabela de
// defaults (igual ao endpoint manual UpsertTemplateDefault).
//
// Resposta: { url, content_type, size_bytes, default_saved }
func (h *WABAHandler) UploadTemplateMedia(c *fiber.Ctx) error {
	inst := middleware.GetCurrentInstance(c)
	if inst == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "instância não encontrada"})
	}
	if !storage.IsConfigured() || storage.GlobalStorage == nil {
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
			"error": "storage não configurado — configure MinIO/S3 antes",
		})
	}

	file, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "arquivo é obrigatório"})
	}
	// Limite de 16MB — bate com o ceiling da Cloud API pra video/image.
	// Documents podem chegar a 100MB mas pra header de template raramente
	// passa de uns megas; ficamos no 16 pra ter margem sem desperdiçar
	// banda de upload.
	const maxBytes = 16 * 1024 * 1024
	if file.Size > maxBytes {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("arquivo excede o limite de %dMB", maxBytes/1024/1024),
		})
	}

	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "falha ao abrir arquivo"})
	}
	defer src.Close()
	data, err := io.ReadAll(src)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "falha ao ler arquivo"})
	}

	// Detecta MIME pela extensão como fallback — alguns clientes mandam
	// "application/octet-stream" e a Meta rejeita por mismatch de format.
	mime := strings.TrimSpace(file.Header.Get("Content-Type"))
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(file.Filename)), ".")
	if mime == "" || mime == "application/octet-stream" {
		mime = guessMimeFromExt(ext)
	}
	if !isAllowedTemplateMime(mime) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "tipo de arquivo não suportado pra header de template",
			"hint":  "use image/jpeg, image/png, image/webp, video/mp4, video/3gpp, application/pdf",
		})
	}

	// Object name único — separa por instância pra facilitar limpeza
	// e evitar colisão de nomes entre clientes diferentes.
	if ext == "" {
		ext = storage.MimeToExt(mime)
	}
	objectName := fmt.Sprintf("waba-templates/%s/%s.%s",
		inst.ID.String(), uuid.New().String(), strings.TrimPrefix(ext, "."))

	url, err := storage.GlobalStorage.UploadBytes(context.Background(), objectName, data, mime)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	// Upsert opcional do default por template — quando o front passa o
	// nome+idioma, salva direto pra evitar uma segunda request. Mesma
	// lógica do UpsertTemplateDefault mas inline.
	defaultSaved := false
	tplName := strings.TrimSpace(c.FormValue("template_name"))
	tplLang := strings.TrimSpace(c.FormValue("template_language"))
	if tplName != "" && tplLang != "" {
		if err := upsertWABATemplateDefault(h.db, inst.ID, tplName, tplLang, url); err == nil {
			defaultSaved = true
		}
	}

	return c.JSON(fiber.Map{
		"url":            url,
		"content_type":   mime,
		"size_bytes":     file.Size,
		"default_saved":  defaultSaved,
	})
}

// isAllowedTemplateMime — bate com o que a Cloud API aceita pra header
// de template (subset dos /media uploads). Lista oficial:
//   IMAGE:    image/jpeg, image/png
//   VIDEO:    video/mp4, video/3gpp
//   DOCUMENT: application/pdf
// image/webp tá fora do oficial mas costuma passar — incluímos.
func isAllowedTemplateMime(mime string) bool {
	switch mime {
	case "image/jpeg", "image/png", "image/webp",
		"video/mp4", "video/3gpp",
		"application/pdf":
		return true
	}
	return false
}

func guessMimeFromExt(ext string) string {
	switch strings.ToLower(strings.TrimPrefix(ext, ".")) {
	case "jpg", "jpeg":
		return "image/jpeg"
	case "png":
		return "image/png"
	case "webp":
		return "image/webp"
	case "mp4":
		return "video/mp4"
	case "3gp":
		return "video/3gpp"
	case "pdf":
		return "application/pdf"
	}
	return ""
}
