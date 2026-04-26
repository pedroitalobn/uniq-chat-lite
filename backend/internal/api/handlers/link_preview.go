package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/uniq-chat/backend/internal/services"
)

// LinkPreviewHandler — expõe GET /v1/link-preview?url=... pra UI consultar
// metadados OG ao renderizar uma mensagem com link. O service mantém cache
// de 7 dias. Endpoint requer auth (qualquer usuário) — não há motivo pra
// expor preview sem login (evita SSRF aberto).
type LinkPreviewHandler struct {
	svc *services.LinkPreviewService
}

func NewLinkPreviewHandler(svc *services.LinkPreviewService) *LinkPreviewHandler {
	return &LinkPreviewHandler{svc: svc}
}

func (h *LinkPreviewHandler) Get(c *fiber.Ctx) error {
	rawURL := c.Query("url")
	if rawURL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "param ?url= é obrigatório"})
	}
	preview, err := h.svc.GetOrFetch(c.UserContext(), rawURL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(preview)
}
