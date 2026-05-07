package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/rs/zerolog/log"
)

// SafeErr — helper pra responder erros sem vazar detalhes internos
// (paths, queries SQL, tokens em mensagens de driver) pro cliente.
//
// Padrão correto: log.Error() com contexto completo + resposta genérica
// pro cliente. err.Error() cru em respostas é um vetor de info disclosure
// — atacante prova endpoints e lê stack/SQL no JSON.
//
// Uso:
//
//	if err := h.db.Create(&x).Error; err != nil {
//	    return SafeErr(c, fiber.StatusInternalServerError, "db_create_failed",
//	                   "erro ao salvar registro", err)
//	}
//
// Errcode (machine-readable) + message (human PT-BR). Em dev (FIBER_DEBUG=1)
// expõe debug field com err.Error() pra facilitar local; em prod nunca.
func SafeErr(c *fiber.Ctx, status int, errCode, message string, internal error) error {
	if internal != nil {
		log.Error().Err(internal).
			Str("path", c.Path()).
			Str("method", c.Method()).
			Str("err_code", errCode).
			Int("status", status).
			Msg("handler error")
	}
	body := fiber.Map{
		"error":   errCode,
		"message": message,
	}
	return c.Status(status).JSON(body)
}
