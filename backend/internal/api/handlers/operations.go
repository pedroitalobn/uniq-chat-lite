package handlers

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"go.mau.fi/whatsmeow/types"
)

// Handlers de paridade Evolution-Go + extras whatsmeow.
// Todos seguem o mesmo padrão: getClient → parse body → chamar
// método em InstanceClient → JSON resposta.
//
// Não logamos no MessageLog porque não são envios diretos (são
// mutações de estado). Quando vira app state, o WhatsApp propaga
// pra demais devices automaticamente.

// ─── Chat operations ──────────────────────────────────────────────

func (h *MessageHandler) PinChat(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID    string `json:"jid"`
		Pinned *bool  `json:"pinned"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" || req.Pinned == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'jid' e 'pinned' são obrigatórios"})
	}
	if err := client.PinChat(req.JID, *req.Pinned); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "pinned": *req.Pinned})
}

func (h *MessageHandler) ArchiveChat(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID      string `json:"jid"`
		Archived *bool  `json:"archived"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" || req.Archived == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'jid' e 'archived' são obrigatórios"})
	}
	if err := client.ArchiveChat(req.JID, *req.Archived); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "archived": *req.Archived})
}

func (h *MessageHandler) MuteChat(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID        string `json:"jid"`
		Mute       *bool  `json:"mute"`
		DurationMs int64  `json:"duration_ms"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" || req.Mute == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'jid' e 'mute' são obrigatórios"})
	}
	dur := time.Duration(req.DurationMs) * time.Millisecond
	if err := client.MuteChat(req.JID, *req.Mute, dur); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "mute": *req.Mute})
}

// ─── Send link preview ────────────────────────────────────────────

func (h *MessageHandler) SendLink(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		To   string `json:"to"`
		Text string `json:"text"`
	}
	if err := c.BodyParser(&req); err != nil || req.To == "" || req.Text == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'to' e 'text' são obrigatórios"})
	}
	id, err := client.SendLinkPreviewMessage(req.To, req.Text)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message_id": id, "status": "sent"})
}

// ─── Edit message ─────────────────────────────────────────────────

func (h *MessageHandler) EditMessage(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		ChatJID   string `json:"chat_jid"`
		MessageID string `json:"message_id"`
		NewText   string `json:"new_text"`
	}
	if err := c.BodyParser(&req); err != nil || req.ChatJID == "" || req.MessageID == "" || req.NewText == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'chat_jid', 'message_id' e 'new_text' são obrigatórios"})
	}
	id, err := client.EditMessage(req.ChatJID, req.MessageID, req.NewText)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"message_id": id, "status": "edited"})
}

// ─── Block / Unblock ──────────────────────────────────────────────

func (h *MessageHandler) BlockUser(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID string `json:"jid"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'jid' é obrigatório"})
	}
	if err := client.BlockUser(req.JID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "blocked"})
}

func (h *MessageHandler) UnblockUser(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID string `json:"jid"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'jid' é obrigatório"})
	}
	if err := client.UnblockUser(req.JID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "unblocked"})
}

func (h *MessageHandler) GetBlocklist(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jids, err := client.GetBlocklist()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"blocked": jids})
}

// ─── Self profile ─────────────────────────────────────────────────

func (h *MessageHandler) UpdateProfileStatus(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		Status string `json:"status"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if err := client.SetSelfStatus(req.Status); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

func (h *MessageHandler) UpdateProfileName(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}
	if err := client.SetSelfName(req.Name); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

func (h *MessageHandler) UpdateProfilePicture(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		URL    string `json:"url"`
		Base64 string `json:"base64"`
		Remove bool   `json:"remove"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	if req.Remove {
		if err := client.RemoveSelfPicture(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "removed"})
	}
	bytes, err := resolveMediaBytes(req.Base64, req.URL)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	pictureID, err := client.SetSelfPicture(bytes)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "picture_id": pictureID})
}

// ─── Group attributes ─────────────────────────────────────────────

func (h *MessageHandler) SetGroupPhoto(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID    string `json:"jid"`
		URL    string `json:"url"`
		Base64 string `json:"base64"`
		Remove bool   `json:"remove"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'jid' é obrigatório"})
	}
	var bytes []byte
	if !req.Remove {
		bytes, err = resolveMediaBytes(req.Base64, req.URL)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
	}
	pictureID, err := client.SetGroupPhoto(req.JID, bytes)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "picture_id": pictureID})
}

func (h *MessageHandler) SetGroupAnnounceMode(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID      string `json:"jid"`
		Announce *bool  `json:"announce"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" || req.Announce == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'jid' e 'announce' são obrigatórios"})
	}
	if err := client.SetGroupAnnounceMode(req.JID, *req.Announce); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "announce": *req.Announce})
}

func (h *MessageHandler) SetGroupLockedMode(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID    string `json:"jid"`
		Locked *bool  `json:"locked"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" || req.Locked == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'jid' e 'locked' são obrigatórios"})
	}
	if err := client.SetGroupLockedMode(req.JID, *req.Locked); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "locked": *req.Locked})
}

// ─── Labels ───────────────────────────────────────────────────────

func (h *MessageHandler) LabelChat(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID     string `json:"jid"`
		LabelID string `json:"label_id"`
		Labeled *bool  `json:"labeled"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" || req.LabelID == "" || req.Labeled == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'jid', 'label_id' e 'labeled' são obrigatórios"})
	}
	if err := client.LabelChat(req.JID, req.LabelID, *req.Labeled); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "labeled": *req.Labeled})
}

func (h *MessageHandler) LabelMessage(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID       string `json:"jid"`
		LabelID   string `json:"label_id"`
		MessageID string `json:"message_id"`
		Labeled   *bool  `json:"labeled"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" || req.LabelID == "" || req.MessageID == "" || req.Labeled == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'jid', 'label_id', 'message_id' e 'labeled' são obrigatórios"})
	}
	if err := client.LabelMessage(req.JID, req.LabelID, req.MessageID, *req.Labeled); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "labeled": *req.Labeled})
}

func (h *MessageHandler) EditLabel(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		LabelID string `json:"label_id"`
		Name    string `json:"name"`
		Color   int32  `json:"color"`
		Deleted bool   `json:"deleted"`
	}
	if err := c.BodyParser(&req); err != nil || req.LabelID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'label_id' é obrigatório"})
	}
	if err := client.EditLabel(req.LabelID, req.Name, req.Color, req.Deleted); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "label_id": req.LabelID})
}

// ─── Privacy ──────────────────────────────────────────────────────

func (h *MessageHandler) GetPrivacy(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	settings, err := client.GetPrivacySettings()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(settings)
}

func (h *MessageHandler) SetPrivacy(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		Setting string `json:"setting"`
		Value   string `json:"value"`
	}
	if err := c.BodyParser(&req); err != nil || req.Setting == "" || req.Value == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'setting' e 'value' são obrigatórios"})
	}
	settings, err := client.SetPrivacySetting(req.Setting, req.Value)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(settings)
}

// ─── Reconnect / history sync ─────────────────────────────────────

func (h *MessageHandler) ForceReconnect(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	if err := client.ForceReconnect(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "reconnecting"})
}

func (h *MessageHandler) HistorySync(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		ChatJID   string `json:"chat_jid"`
		SenderJID string `json:"sender_jid"`
		MessageID string `json:"message_id"`
		Count     int    `json:"count"`
	}
	if err := c.BodyParser(&req); err != nil || req.ChatJID == "" || req.MessageID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'chat_jid' e 'message_id' são obrigatórios"})
	}
	if err := client.RequestHistorySync(req.ChatJID, req.MessageID, req.SenderJID, req.Count); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "requested"})
}

// ─── Community ────────────────────────────────────────────────────

func (h *MessageHandler) CreateCommunity(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}
	info, err := client.CreateCommunity(req.Name, req.Description)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(info)
}

func (h *MessageHandler) LinkCommunityGroup(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		ParentJID string `json:"parent_jid"`
		ChildJID  string `json:"child_jid"`
	}
	if err := c.BodyParser(&req); err != nil || req.ParentJID == "" || req.ChildJID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'parent_jid' e 'child_jid' são obrigatórios"})
	}
	if err := client.LinkGroupToCommunity(req.ParentJID, req.ChildJID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "linked"})
}

func (h *MessageHandler) UnlinkCommunityGroup(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		ParentJID string `json:"parent_jid"`
		ChildJID  string `json:"child_jid"`
	}
	if err := c.BodyParser(&req); err != nil || req.ParentJID == "" || req.ChildJID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'parent_jid' e 'child_jid' são obrigatórios"})
	}
	if err := client.UnlinkGroupFromCommunity(req.ParentJID, req.ChildJID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "unlinked"})
}

func (h *MessageHandler) ListCommunityGroups(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro 'jid' é obrigatório na URL"})
	}
	subs, err := client.GetCommunitySubGroups(jid)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"groups": subs})
}

// ─── Newsletter ───────────────────────────────────────────────────

func (h *MessageHandler) CreateNewsletter(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		PictureURL  string `json:"picture_url"`
		PictureB64  string `json:"picture_base64"`
	}
	if err := c.BodyParser(&req); err != nil || req.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'name' é obrigatório"})
	}
	var picture []byte
	if req.PictureURL != "" || req.PictureB64 != "" {
		picture, err = resolveMediaBytes(req.PictureB64, req.PictureURL)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
	}
	meta, err := client.CreateNewsletter(req.Name, req.Description, picture)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(meta)
}

func (h *MessageHandler) ListNewsletters(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	list, err := client.ListSubscribedNewsletters()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"newsletters": list})
}

func (h *MessageHandler) GetNewsletterInfo(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		// fallback: aceita ?invite=<key> para resolver por convite
		invite := strings.TrimSpace(c.Query("invite"))
		if invite == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "informe 'jid' na URL ou ?invite=<chave>"})
		}
		meta, err := client.GetNewsletterByInvite(invite)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(meta)
	}
	meta, err := client.GetNewsletterInfo(jid)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(meta)
}

func (h *MessageHandler) FollowNewsletter(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro 'jid' é obrigatório"})
	}
	if err := client.FollowNewsletter(jid); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "following"})
}

func (h *MessageHandler) UnfollowNewsletter(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro 'jid' é obrigatório"})
	}
	if err := client.UnfollowNewsletter(jid); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "unfollowed"})
}

func (h *MessageHandler) GetNewsletterMessages(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro 'jid' é obrigatório"})
	}
	count := c.QueryInt("count", 50)
	beforeStr := strings.TrimSpace(c.Query("before"))
	var before types.MessageServerID
	if beforeStr != "" {
		// MessageServerID é tipo numérico — conversão simples.
		if n, perr := parseInt64(beforeStr); perr == nil {
			before = types.MessageServerID(n)
		}
	}
	msgs, err := client.GetNewsletterMessages(jid, count, before)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"messages": msgs})
}

// ─── Calls ────────────────────────────────────────────────────────

// OfferCall inicia uma chamada de voz ou vídeo para um contato.
// Body: { "jid": "<contato>", "video": false }
func (h *MessageHandler) OfferCall(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		JID   string `json:"jid"`
		Video bool   `json:"video"`
	}
	if err := c.BodyParser(&req); err != nil || req.JID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'jid' é obrigatório"})
	}
	if err := client.OfferCall(req.JID, req.Video); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "call_offered"})
}

func (h *MessageHandler) RejectCall(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		CallerJID string `json:"caller_jid"`
		CallID    string `json:"call_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.CallerJID == "" || req.CallID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'caller_jid' e 'call_id' são obrigatórios"})
	}
	if err := client.RejectCall(req.CallerJID, req.CallID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "rejected"})
}

// helper local — strconv.ParseInt sem import
func parseInt64(s string) (int64, error) {
	var n int64
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch < '0' || ch > '9' {
			return 0, fiber.ErrBadRequest
		}
		n = n*10 + int64(ch-'0')
	}
	return n, nil
}

// ─── Sprint 6: extras whatsmeow ───────────────────────────────────

func (h *MessageHandler) GetBusinessProfile(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		jid = strings.TrimSpace(c.Query("jid"))
	}
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "informe :jid no path ou ?jid=<jid>"})
	}
	profile, err := client.GetBusinessProfile(jid)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(profile)
}

func (h *MessageHandler) SetDisappearing(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		ChatJID    string `json:"chat_jid"`
		DurationMs int64  `json:"duration_ms"`
	}
	if err := c.BodyParser(&req); err != nil || req.ChatJID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'chat_jid' é obrigatório"})
	}
	dur := time.Duration(req.DurationMs) * time.Millisecond
	if err := client.SetDisappearingTimer(req.ChatJID, dur); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "duration_ms": req.DurationMs})
}

func (h *MessageHandler) SetDisappearingDefault(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		DurationMs int64 `json:"duration_ms"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body inválido"})
	}
	dur := time.Duration(req.DurationMs) * time.Millisecond
	if err := client.SetDefaultDisappearingTimer(dur); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

func (h *MessageHandler) JoinGroupViaInvite(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		GroupJID   string `json:"group_jid"`
		InviterJID string `json:"inviter_jid"`
		Code       string `json:"code"`
		Expiration int64  `json:"expiration"`
	}
	if err := c.BodyParser(&req); err != nil || req.GroupJID == "" || req.InviterJID == "" || req.Code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'group_jid', 'inviter_jid' e 'code' são obrigatórios"})
	}
	if err := client.JoinGroupWithInvite(req.GroupJID, req.InviterJID, req.Code, req.Expiration); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "joined"})
}

func (h *MessageHandler) PreviewGroupInvite(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		GroupJID   string `json:"group_jid"`
		InviterJID string `json:"inviter_jid"`
		Code       string `json:"code"`
		Expiration int64  `json:"expiration"`
	}
	if err := c.BodyParser(&req); err != nil || req.GroupJID == "" || req.InviterJID == "" || req.Code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'group_jid', 'inviter_jid' e 'code' são obrigatórios"})
	}
	info, err := client.GetGroupInfoFromInvite(req.GroupJID, req.InviterJID, req.Code, req.Expiration)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(info)
}

func (h *MessageHandler) PreviewGroupLink(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	code := strings.TrimSpace(c.Query("code"))
	if code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "?code=<código do link> é obrigatório"})
	}
	info, err := client.GetGroupInfoFromLink(code)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(info)
}

func (h *MessageHandler) ListGroupRequests(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro :jid é obrigatório"})
	}
	reqs, err := client.GetGroupRequestParticipants(jid)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"requests": reqs})
}

func (h *MessageHandler) UpdateGroupRequests(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro :jid é obrigatório"})
	}
	var req struct {
		Participants []string `json:"participants"`
		Action       string   `json:"action"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.Participants) == 0 || req.Action == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'participants' (array) e 'action' (approve|reject) são obrigatórios"})
	}
	parts, err := client.UpdateGroupRequestParticipants(jid, req.Participants, req.Action)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"updated": parts})
}

func (h *MessageHandler) ListCommunityParticipants(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro :jid é obrigatório"})
	}
	jids, err := client.GetLinkedGroupsParticipants(jid)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"participants": jids})
}

func (h *MessageHandler) NewsletterMarkViewed(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro :jid é obrigatório"})
	}
	var req struct {
		ServerIDs []int64 `json:"server_ids"`
	}
	if err := c.BodyParser(&req); err != nil || len(req.ServerIDs) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'server_ids' (array de int) é obrigatório"})
	}
	if err := client.NewsletterMarkViewed(jid, req.ServerIDs); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

func (h *MessageHandler) NewsletterReact(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro :jid é obrigatório"})
	}
	var req struct {
		ServerID  int64  `json:"server_id"`
		Reaction  string `json:"reaction"`
		MessageID string `json:"message_id"`
	}
	if err := c.BodyParser(&req); err != nil || req.MessageID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campos 'server_id', 'message_id' e 'reaction' (vazio remove) são obrigatórios"})
	}
	if err := client.NewsletterSendReaction(jid, req.ServerID, req.Reaction, req.MessageID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok"})
}

func (h *MessageHandler) NewsletterMute(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	jid := strings.TrimSpace(c.Params("jid"))
	if jid == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "parâmetro :jid é obrigatório"})
	}
	var req struct {
		Mute *bool `json:"mute"`
	}
	if err := c.BodyParser(&req); err != nil || req.Mute == nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'mute' (bool) é obrigatório"})
	}
	if err := client.NewsletterToggleMute(jid, *req.Mute); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "ok", "mute": *req.Mute})
}

func (h *MessageHandler) AcceptTOS(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	var req struct {
		NoticeID string `json:"notice_id"`
		Stage    string `json:"stage"`
	}
	if err := c.BodyParser(&req); err != nil || req.NoticeID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'notice_id' é obrigatório"})
	}
	if err := client.AcceptTOSNotice(req.NoticeID, req.Stage); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status": "accepted"})
}

func (h *MessageHandler) GetStatusPrivacy(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	settings, err := client.GetStatusPrivacy()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"status_privacy": settings})
}

func (h *MessageHandler) ResolveBusinessLink(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	code := strings.TrimSpace(c.Query("code"))
	if code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "?code=<código do link wa.me/message/...> é obrigatório"})
	}
	target, err := client.ResolveBusinessMessageLink(code)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(target)
}

func (h *MessageHandler) ResolveContactQR(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	code := strings.TrimSpace(c.Query("code"))
	if code == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "?code=<código do link wa.me/qr/...> é obrigatório"})
	}
	target, err := client.ResolveContactQRLink(code)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(target)
}

func (h *MessageHandler) GetSelfQRLink(c *fiber.Ctx) error {
	client, err := h.getClient(c)
	if err != nil {
		return err
	}
	revoke := c.QueryBool("revoke", false)
	link, err := client.GetContactQRLink(revoke)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	return c.JSON(fiber.Map{"link": link, "revoked": revoke})
}


