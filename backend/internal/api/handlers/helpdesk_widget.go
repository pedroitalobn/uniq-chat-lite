package handlers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// ─── Help Desk Widget ────────────────────────────────────────────────────────
//
// O widget é a interface embarcável (botão flutuante) que vive no site/app
// do cliente. Ele é vinculado ao Help Desk (1 widget por workspace) e a
// criação/edição acontece dentro de /help-desk → aba Widget.
//
// Por baixo dos panos o widget é uma Instance(channel=webchat) auto-
// provisionada na primeira vez. Essa instância é escondida da listagem
// de Instâncias (filtro em instances.go:List) — o user nunca precisa
// criar/configurar uma "instância webchat" manualmente.
//
// DestinationType na WebChatConfig controla pra onde a mensagem vai:
//   - "inbox" (default): cria conversation webchat na inbox (modo padrão)
//   - "redirect_instance": widget vira CTA "Continuar no WhatsApp",
//     redirecionando pra wa.me/<numero da instância destino>
//
// Endpoints:
//   GET  /v1/helpdesk/widget   — config + token + snippet (auto-provisiona)
//   PUT  /v1/helpdesk/widget   — atualiza config (cores, destino, etc)

// generateWidgetToken cria um token público pro widget. Não é JWT — é só
// um identificador estável (32 bytes hex) usado pelas rotas /v1/public/webchat/:token.
func generateWidgetToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return "wdg_" + hex.EncodeToString(b)
}

// ensureWidgetInstance garante que existe uma Instance(channel=webchat)
// vinculada ao HelpDeskConfig. Auto-provisiona na primeira chamada.
// Idempotente — chamadas subsequentes retornam a instância existente.
func (h *HelpDeskHandler) ensureWidgetInstance(wsID uuid.UUID, userID uuid.UUID) (*models.Instance, *models.HelpDeskConfig, error) {
	var ws models.Workspace
	if err := h.db.Where("id = ?", wsID).First(&ws).Error; err != nil {
		return nil, nil, fmt.Errorf("workspace não encontrado")
	}

	var cfg models.HelpDeskConfig
	if err := h.db.Where("workspace_id = ?", wsID).First(&cfg).Error; err != nil {
		// Cria config padrão — mesmo flow do GetConfig.
		cfg = models.HelpDeskConfig{
			WorkspaceID:   wsID,
			Title:         ws.Name + " · Central de Ajuda",
			PrimaryColor:  "#00d46a",
			WidgetEnabled: true,
			CustomSlug:    ws.Slug,
		}
		if err := h.db.Create(&cfg).Error; err != nil {
			return nil, nil, fmt.Errorf("falha ao criar HelpDeskConfig: %w", err)
		}
	}

	// Já tem instância vinculada? Verifica que ainda existe.
	if cfg.WebchatInstanceID != nil {
		var inst models.Instance
		if err := h.db.Where("id = ?", cfg.WebchatInstanceID).First(&inst).Error; err == nil {
			return &inst, &cfg, nil
		}
		// Instância foi deletada — desvincula e re-cria abaixo.
		log.Warn().Str("workspace_id", wsID.String()).Str("orphan_instance_id", cfg.WebchatInstanceID.String()).Msg("helpdesk widget: instance referenciada não existe mais, recriando")
	}

	// Provisiona nova Instance(channel=webchat).
	wsUUID := wsID
	inst := models.Instance{
		ID:          uuid.New(),
		UserID:      userID,
		WorkspaceID: &wsUUID,
		Name:        ws.Name + " · Widget",
		Slug:        "widget-" + strings.Split(uuid.New().String(), "-")[0],
		Token:       generateWidgetToken(),
		Channel:     models.ChannelWebChat,
		Status:      models.InstanceStatus("connected"), // webchat não tem QR — sempre "online"
	}
	if err := h.db.Create(&inst).Error; err != nil {
		return nil, nil, fmt.Errorf("falha ao criar instância webchat: %w", err)
	}

	// Cria WebChatConfig padrão.
	wcc := models.WebChatConfig{
		InstanceID:      inst.ID,
		WorkspaceID:     wsID,
		DisplayName:     ws.Name,
		Greeting:        "Olá! Como posso ajudar?",
		PrimaryColor:    "#00d46a",
		Position:        "bottom-right",
		DestinationType: "inbox",
		HelpDeskEnabled: true,
	}
	if err := h.db.Create(&wcc).Error; err != nil {
		// Não-fatal: a instância existe, a config pega defaults nos lookups.
		log.Warn().Err(err).Msg("helpdesk widget: criação de WebChatConfig falhou — usando defaults")
	}

	// Linka na HelpDeskConfig.
	if err := h.db.Model(&cfg).Update("webchat_instance_id", inst.ID).Error; err != nil {
		log.Warn().Err(err).Msg("helpdesk widget: falha ao linkar instance_id em HelpDeskConfig")
	}
	cfg.WebchatInstanceID = &inst.ID

	return &inst, &cfg, nil
}

// widgetSnippet monta o `<script>` de embed pro site do cliente.
func widgetSnippet(token string) string {
	appURL := "https://app.uniq.chat"
	if envURL := os.Getenv("APP_URL"); envURL != "" {
		appURL = envURL
	}
	return fmt.Sprintf(`<!-- Uniq Chat Widget -->
<script>
(function(){
  var t="%s",u="%s/v1/public/webchat/";
  var s=document.createElement("script");
  s.src="%s/webchat.js";s.async=true;
  s.onload=function(){if(window.UniqWebChat)window.UniqWebChat.init({token:t,apiUrl:u});};
  document.head.appendChild(s);
})();
</script>`, token, appURL, appURL)
}

// resolveDestinationPhone retorna o número que o widget deve usar quando
// destination_type = "redirect_instance". Olha PhoneNumber da instância
// destino. Vazio se não encontrar.
func (h *HelpDeskHandler) resolveDestinationPhone(instanceID *uuid.UUID) string {
	if instanceID == nil {
		return ""
	}
	var inst models.Instance
	if err := h.db.Select("phone_number").Where("id = ?", instanceID).First(&inst).Error; err != nil {
		return ""
	}
	// Normaliza — só dígitos pro wa.me/
	clean := strings.Map(func(r rune) rune {
		if r >= '0' && r <= '9' {
			return r
		}
		return -1
	}, inst.PhoneNumber)
	return clean
}

// GetWidget GET /v1/helpdesk/widget
// Retorna config completa + token + snippet. Auto-provisiona na 1ª chamada.
func (h *HelpDeskHandler) GetWidget(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}
	userID := middleware.GetCurrentUserID(c)
	if userID == uuid.Nil {
		return fiber.NewError(fiber.StatusUnauthorized, "user_id obrigatório")
	}

	inst, cfg, err := h.ensureWidgetInstance(wsID, userID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	var wcc models.WebChatConfig
	if err := h.db.Where("instance_id = ?", inst.ID).First(&wcc).Error; err != nil && err != gorm.ErrRecordNotFound {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	resp := fiber.Map{
		"enabled":                 cfg.WidgetEnabled,
		"token":                   inst.Token,
		"instance_id":             inst.ID,
		"display_name":            wcc.DisplayName,
		"greeting":                wcc.Greeting,
		"primary_color":           wcc.PrimaryColor,
		"position":                wcc.Position,
		"avatar_url":              wcc.AvatarURL,
		"destination_type":        firstNonEmpty(wcc.DestinationType, "inbox"),
		"destination_instance_id": wcc.DestinationInstanceID,
		"help_desk_enabled":       wcc.HelpDeskEnabled,
		"snippet":                 widgetSnippet(inst.Token),
		// badge appearance
		"badge_style":       wcc.BadgeStyle,
		"badge_icon":        wcc.BadgeIcon,
		"badge_color":       firstNonEmpty(wcc.BadgeColor, wcc.PrimaryColor),
		"offset_x":          wcc.OffsetX,
		"offset_y":          wcc.OffsetY,
		"border_radius":     wcc.BorderRadius,
		"shadow_intensity":  wcc.ShadowIntensity,
	}
	if wcc.DestinationInstanceID != nil {
		resp["destination_phone"] = h.resolveDestinationPhone(wcc.DestinationInstanceID)
	}
	return c.JSON(resp)
}

// UpdateWidget PUT /v1/helpdesk/widget
// Body aceita: enabled, display_name, greeting, primary_color, position,
// avatar_url, destination_type, destination_instance_id.
func (h *HelpDeskHandler) UpdateWidget(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}
	userID := middleware.GetCurrentUserID(c)
	if userID == uuid.Nil {
		return fiber.NewError(fiber.StatusUnauthorized, "user_id obrigatório")
	}

	inst, cfg, err := h.ensureWidgetInstance(wsID, userID)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	var body struct {
		Enabled               *bool      `json:"enabled,omitempty"`
		DisplayName           *string    `json:"display_name,omitempty"`
		Greeting              *string    `json:"greeting,omitempty"`
		PrimaryColor          *string    `json:"primary_color,omitempty"`
		Position              *string    `json:"position,omitempty"`
		AvatarURL             *string    `json:"avatar_url,omitempty"`
		DestinationType       *string    `json:"destination_type,omitempty"`
		DestinationInstanceID *uuid.UUID `json:"destination_instance_id,omitempty"`
		HelpDeskEnabled       *bool      `json:"help_desk_enabled,omitempty"`
		// badge appearance
		BadgeStyle      *string `json:"badge_style,omitempty"`
		BadgeIcon       *string `json:"badge_icon,omitempty"`
		BadgeColor      *string `json:"badge_color,omitempty"`
		OffsetX         *int    `json:"offset_x,omitempty"`
		OffsetY         *int    `json:"offset_y,omitempty"`
		BorderRadius    *int    `json:"border_radius,omitempty"`
		ShadowIntensity *string `json:"shadow_intensity,omitempty"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}

	// Atualiza HelpDeskConfig.WidgetEnabled (toggle global do widget).
	if body.Enabled != nil {
		h.db.Model(cfg).Update("widget_enabled", *body.Enabled)
	}

	// Valida destination — se redirect_instance, precisa apontar pra
	// instance do mesmo workspace e que NÃO seja ela própria.
	if body.DestinationType != nil && *body.DestinationType == "redirect_instance" {
		if body.DestinationInstanceID == nil {
			return fiber.NewError(fiber.StatusBadRequest, "destination_instance_id obrigatório quando destination_type=redirect_instance")
		}
		if *body.DestinationInstanceID == inst.ID {
			return fiber.NewError(fiber.StatusBadRequest, "destination_instance_id não pode apontar pro próprio widget")
		}
		var dest models.Instance
		if err := h.db.Where("id = ?", body.DestinationInstanceID).First(&dest).Error; err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "instância destino não encontrada")
		}
		if dest.WorkspaceID == nil || *dest.WorkspaceID != wsID {
			return fiber.NewError(fiber.StatusForbidden, "instância destino não pertence ao seu workspace")
		}
		// Avisa se instância destino não tem telefone — wa.me não vai funcionar.
		if strings.TrimSpace(dest.PhoneNumber) == "" {
			log.Warn().Str("dest_instance_id", dest.ID.String()).Msg("helpdesk widget: instância destino sem phone_number — wa.me vai falhar")
		}
	}

	// Aplica updates na WebChatConfig (upsert).
	updates := map[string]interface{}{}
	if body.DisplayName != nil {
		updates["display_name"] = *body.DisplayName
	}
	if body.Greeting != nil {
		updates["greeting"] = *body.Greeting
	}
	if body.PrimaryColor != nil {
		updates["primary_color"] = *body.PrimaryColor
	}
	if body.Position != nil {
		updates["position"] = *body.Position
	}
	if body.AvatarURL != nil {
		updates["avatar_url"] = *body.AvatarURL
	}
	if body.DestinationType != nil {
		updates["destination_type"] = *body.DestinationType
	}
	if body.DestinationInstanceID != nil {
		updates["destination_instance_id"] = *body.DestinationInstanceID
	}
	if body.HelpDeskEnabled != nil {
		updates["help_desk_enabled"] = *body.HelpDeskEnabled
	}
	// badge appearance
	if body.BadgeStyle != nil {
		updates["badge_style"] = *body.BadgeStyle
	}
	if body.BadgeIcon != nil {
		updates["badge_icon"] = *body.BadgeIcon
	}
	if body.BadgeColor != nil {
		updates["badge_color"] = *body.BadgeColor
	}
	if body.OffsetX != nil {
		updates["offset_x"] = *body.OffsetX
	}
	if body.OffsetY != nil {
		updates["offset_y"] = *body.OffsetY
	}
	if body.BorderRadius != nil {
		updates["border_radius"] = *body.BorderRadius
	}
	if body.ShadowIntensity != nil {
		updates["shadow_intensity"] = *body.ShadowIntensity
	}

	// Limpa destination_instance_id se voltou pra inbox — evita estado
	// confuso (config diz "inbox" mas tem instance_id de relay sobrando).
	if body.DestinationType != nil && *body.DestinationType == "inbox" {
		updates["destination_instance_id"] = nil
	}

	if len(updates) > 0 {
		var wcc models.WebChatConfig
		if err := h.db.Where("instance_id = ?", inst.ID).First(&wcc).Error; err != nil {
			// Cria do zero se não existe — caso raro (ensureWidgetInstance
			// já cria, mas defensivo).
			newCfg := models.WebChatConfig{
				InstanceID:  inst.ID,
				WorkspaceID: wsID,
			}
			for k, v := range updates {
				switch k {
				case "display_name":
					newCfg.DisplayName = v.(string)
				case "greeting":
					newCfg.Greeting = v.(string)
				case "primary_color":
					newCfg.PrimaryColor = v.(string)
				case "position":
					newCfg.Position = v.(string)
				case "avatar_url":
					newCfg.AvatarURL = v.(string)
				case "destination_type":
					newCfg.DestinationType = v.(string)
				case "destination_instance_id":
					if v != nil {
						id := v.(uuid.UUID)
						newCfg.DestinationInstanceID = &id
					}
				case "help_desk_enabled":
					newCfg.HelpDeskEnabled = v.(bool)
				case "badge_style":
					newCfg.BadgeStyle = v.(string)
				case "badge_icon":
					newCfg.BadgeIcon = v.(string)
				case "badge_color":
					newCfg.BadgeColor = v.(string)
				case "offset_x":
					newCfg.OffsetX = v.(int)
				case "offset_y":
					newCfg.OffsetY = v.(int)
				case "border_radius":
					newCfg.BorderRadius = v.(int)
				case "shadow_intensity":
					newCfg.ShadowIntensity = v.(string)
				}
			}
			h.db.Create(&newCfg)
		} else {
			h.db.Model(&wcc).Updates(updates)
		}
	}

	// Devolve estado atualizado (reusa GetWidget).
	return h.GetWidget(c)
}
