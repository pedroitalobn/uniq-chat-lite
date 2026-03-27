package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

type APIKeyHandler struct {
	db *gorm.DB
}

func NewAPIKeyHandler(db *gorm.DB) *APIKeyHandler {
	return &APIKeyHandler{db: db}
}

// List godoc
// GET /api-keys
func (h *APIKeyHandler) List(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	var keys []models.APIKey
	if err := h.db.Where("user_id = ?", user.ID).Order("created_at DESC").Find(&keys).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao buscar API keys"})
	}

	// Return masked versions
	result := make([]fiber.Map, 0, len(keys))
	for _, k := range keys {
		result = append(result, fiber.Map{
			"id":           k.ID,
			"name":         k.Name,
			"key_prefix":   k.KeyPrefix,
			"masked_key":   k.MaskKey(),
			"is_active":    k.IsActive,
			"last_used_at": k.LastUsedAt,
			"created_at":   k.CreatedAt,
		})
	}

	return c.JSON(result)
}

// Create godoc
// POST /api-keys
func (h *APIKeyHandler) Create(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	var req struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}

	plaintext, hash, prefix, err := models.GenerateAPIKey()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao gerar API key"})
	}

	apiKey := models.APIKey{
		UserID:    user.ID,
		Name:      req.Name,
		KeyHash:   hash,
		KeyPrefix: prefix,
		IsActive:  true,
	}

	if err := h.db.Create(&apiKey).Error; err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao salvar API key"})
	}

	// Return plaintext ONCE
	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"id":         apiKey.ID,
		"name":       apiKey.Name,
		"key":        plaintext, // shown only once
		"key_prefix": apiKey.KeyPrefix,
		"created_at": apiKey.CreatedAt,
		"warning":    "Guarde esta chave agora — ela não será exibida novamente.",
	})
}

// Delete godoc
// DELETE /api-keys/:id
func (h *APIKeyHandler) Delete(c *fiber.Ctx) error {
	user := middleware.GetCurrentUser(c)

	keyID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ID inválido"})
	}

	result := h.db.Where("id = ? AND user_id = ?", keyID, user.ID).Delete(&models.APIKey{})
	if result.Error != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao deletar API key"})
	}
	if result.RowsAffected == 0 {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "API key não encontrada"})
	}

	return c.JSON(fiber.Map{"message": "API key removida"})
}
