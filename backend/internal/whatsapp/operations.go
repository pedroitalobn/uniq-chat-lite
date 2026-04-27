package whatsapp

import (
	"context"
	"fmt"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/appstate"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

// Este arquivo concentra wrappers de paridade com Evolution-Go +
// recursos extras da lib whatsmeow que ainda não tinham endpoint.
// Convenção: nomes públicos descritivos, retornam erro idiomático
// e parseiam JID via normalizeJID.

// ─── Chat operations (app-state mutations) ─────────────────────────

// PinChat fixa ou desafixa a conversa no topo da lista. Estado é
// sincronizado via app state — propaga pra o app oficial e demais
// devices em segundos.
func (ic *InstanceClient) PinChat(chatJID string, pinned bool) error {
	target, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.SendAppState(context.Background(), appstate.BuildPin(target, pinned))
}

// ArchiveChat arquiva ou desarquiva a conversa. Requer
// timestamp + key da última mensagem pra o servidor saber a partir
// de quando o estado vale. Passe time.Now() / nil quando não tiver.
func (ic *InstanceClient) ArchiveChat(chatJID string, archive bool) error {
	target, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	// Sem MessageKey conhecida — passamos nil. O servidor aceita e
	// usa o timestamp como ponto de corte. WhatsApp Web faz igual
	// quando arquiva manualmente.
	return ic.client.SendAppState(context.Background(), appstate.BuildArchive(target, archive, time.Now(), nil))
}

// MuteChat silencia (ou tira o silêncio) por uma duração. Passe
// duration=0 e mute=true pra silenciar "para sempre" (8 horas é o
// default do app oficial).
func (ic *InstanceClient) MuteChat(chatJID string, mute bool, duration time.Duration) error {
	target, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.SendAppState(context.Background(), appstate.BuildMute(target, mute, duration))
}

// ─── Send: link preview ────────────────────────────────────────────

// SendLinkPreviewMessage envia texto com preview de link automático
// (foto + título extraídos pelo WhatsApp). Se o texto não contém
// URL, cai no envio de texto puro.
func (ic *InstanceClient) SendLinkPreviewMessage(to, text string) (string, error) {
	recipient, err := types.ParseJID(normalizeJID(to))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	msg := &waE2E.Message{
		ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text: proto.String(text),
		},
	}
	res, err := ic.sendMessage(context.Background(), recipient, msg)
	if err != nil {
		return "", err
	}
	return res.ID, nil
}

// ─── Block / Unblock ───────────────────────────────────────────────

// BlockUser adiciona o JID à lista de bloqueio. Mensagens dele
// ficam silenciadas e ele não vê presença/perfil.
func (ic *InstanceClient) BlockUser(userJID string) error {
	jid, err := types.ParseJID(normalizeJID(userJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	_, err = ic.client.UpdateBlocklist(context.Background(), jid, events.BlocklistChangeActionBlock)
	return err
}

// UnblockUser remove o JID da lista de bloqueio.
func (ic *InstanceClient) UnblockUser(userJID string) error {
	jid, err := types.ParseJID(normalizeJID(userJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	_, err = ic.client.UpdateBlocklist(context.Background(), jid, events.BlocklistChangeActionUnblock)
	return err
}

// GetBlocklist retorna a lista de JIDs bloqueados.
func (ic *InstanceClient) GetBlocklist() ([]string, error) {
	bl, err := ic.client.GetBlocklist(context.Background())
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(bl.JIDs))
	for _, j := range bl.JIDs {
		out = append(out, j.String())
	}
	return out, nil
}

// ─── Self profile ──────────────────────────────────────────────────

// SetSelfStatus atualiza o status/recado da conta conectada
// (texto curto que aparece no perfil — "Disponível", etc.).
func (ic *InstanceClient) SetSelfStatus(text string) error {
	return ic.client.SetStatusMessage(context.Background(), text)
}

// SetSelfName atualiza o nome de exibição (push name) da conta.
// Usa app state — propaga pra demais devices.
func (ic *InstanceClient) SetSelfName(name string) error {
	return ic.client.SendAppState(context.Background(), appstate.BuildSettingPushName(name))
}

// SetSelfPicture troca a foto de perfil da conta. Avatar=nil remove.
// Retorna o novo picture ID. Aceita JPEG; outros formatos podem dar
// ErrInvalidImageFormat.
func (ic *InstanceClient) SetSelfPicture(avatar []byte) (string, error) {
	if ic.client.Store == nil || ic.client.Store.ID == nil {
		return "", fmt.Errorf("instância não autenticada")
	}
	// SetGroupPhoto da whatsmeow é genérico — aceita Target=qualquer
	// JID. O server roteia pelo namespace w:profile:picture, então
	// passar o próprio JID atualiza o perfil pessoal.
	return ic.client.SetGroupPhoto(context.Background(), ic.client.Store.ID.ToNonAD(), avatar)
}

// RemoveSelfPicture remove a foto de perfil.
func (ic *InstanceClient) RemoveSelfPicture() error {
	_, err := ic.SetSelfPicture(nil)
	return err
}

// ─── Group attributes ──────────────────────────────────────────────

// SetGroupPhoto troca o ícone do grupo. Bytes nil removem.
// Retorna o novo picture ID.
func (ic *InstanceClient) SetGroupPhoto(groupJID string, avatar []byte) (string, error) {
	jid, err := types.ParseJID(normalizeJID(groupJID))
	if err != nil {
		return "", fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.SetGroupPhoto(context.Background(), jid, avatar)
}

// SetGroupAnnounceMode liga/desliga o modo "só admins enviam mensagens"
// (announce). Útil pra grupos broadcast.
func (ic *InstanceClient) SetGroupAnnounceMode(groupJID string, announce bool) error {
	jid, err := types.ParseJID(normalizeJID(groupJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.SetGroupAnnounce(context.Background(), jid, announce)
}

// SetGroupLockedMode liga/desliga o modo "só admins editam grupo"
// (locked). Quando locked=true, só admins podem alterar nome/foto/desc.
func (ic *InstanceClient) SetGroupLockedMode(groupJID string, locked bool) error {
	jid, err := types.ParseJID(normalizeJID(groupJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.SetGroupLocked(context.Background(), jid, locked)
}

// ─── Labels (estrelinhas/cores do WhatsApp) ────────────────────────

// LabelChat associa ou desassocia uma label a uma conversa inteira.
func (ic *InstanceClient) LabelChat(chatJID, labelID string, labeled bool) error {
	target, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.SendAppState(context.Background(), appstate.BuildLabelChat(target, labelID, labeled))
}

// LabelMessage associa ou desassocia uma label a uma mensagem específica
// dentro de um chat.
func (ic *InstanceClient) LabelMessage(chatJID, labelID, messageID string, labeled bool) error {
	target, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.SendAppState(context.Background(), appstate.BuildLabelMessage(target, labelID, messageID, labeled))
}

// EditLabel cria, renomeia, recolore ou apaga uma label. labelID é
// uma string numérica curta (ex.: "1", "2"). Color = índice da
// paleta de cores (0..19). deleted=true apaga.
func (ic *InstanceClient) EditLabel(labelID, name string, color int32, deleted bool) error {
	return ic.client.SendAppState(context.Background(), appstate.BuildLabelEdit(labelID, name, color, deleted))
}

// ─── Privacy settings ──────────────────────────────────────────────

// GetPrivacySettings retorna o snapshot atual das configurações de
// privacidade da conta (lastSeen, profile, status, readReceipts, etc.).
func (ic *InstanceClient) GetPrivacySettings() (*types.PrivacySettings, error) {
	return ic.client.TryFetchPrivacySettings(context.Background(), false)
}

// SetPrivacySetting altera UMA configuração de privacidade.
// name aceita: "lastseen", "profile", "status", "readreceipts",
// "groupadd", "calladd", "online".
// value aceita: "all", "contacts", "contact_blacklist", "match_last_seen",
// "known", "none".
func (ic *InstanceClient) SetPrivacySetting(name, value string) (*types.PrivacySettings, error) {
	pName := types.PrivacySettingType(strings.ToLower(strings.TrimSpace(name)))
	pVal := types.PrivacySetting(strings.ToLower(strings.TrimSpace(value)))
	settings, err := ic.client.SetPrivacySetting(context.Background(), pName, pVal)
	if err != nil {
		return nil, err
	}
	return &settings, nil
}

// ─── Reconnect / history sync ──────────────────────────────────────

// ForceReconnect derruba o socket e abre uma nova conexão. Útil
// quando a instância parece "viva" mas mensagens não chegam.
func (ic *InstanceClient) ForceReconnect() error {
	ic.client.Disconnect()
	return ic.client.Connect()
}

// RequestHistorySync pede ao servidor um lote de mensagens antigas
// a partir de uma key conhecida. Útil pra reidratar o inbox depois
// de re-conectar uma instância antiga.
func (ic *InstanceClient) RequestHistorySync(chatJID, msgID, senderJID string, count int) error {
	chat, err := types.ParseJID(normalizeJID(chatJID))
	if err != nil {
		return fmt.Errorf("invalid chat JID: %w", err)
	}
	sender := chat
	if senderJID != "" {
		sender, err = types.ParseJID(normalizeJID(senderJID))
		if err != nil {
			return fmt.Errorf("invalid sender JID: %w", err)
		}
	}
	if count <= 0 {
		count = 50
	}
	info := &types.MessageInfo{
		MessageSource: types.MessageSource{
			Chat:   chat,
			Sender: sender,
		},
		ID: msgID,
	}
	msg := ic.client.BuildHistorySyncRequest(info, count)
	_, err = ic.client.SendMessage(context.Background(), chat, msg)
	return err
}

// ─── Community ─────────────────────────────────────────────────────

// CreateCommunity cria uma nova comunidade. O grupo de avisos
// (announce) é criado automaticamente pelo servidor.
func (ic *InstanceClient) CreateCommunity(name, description string) (*types.GroupInfo, error) {
	return ic.client.CreateGroup(context.Background(), whatsmeow.ReqCreateGroup{
		Name: name,
		GroupParent: types.GroupParent{
			IsParent:                      true,
			DefaultMembershipApprovalMode: "request_required",
		},
	})
}

// LinkGroupToCommunity adiciona um grupo existente como subgrupo
// de uma comunidade.
func (ic *InstanceClient) LinkGroupToCommunity(parentJID, childJID string) error {
	parent, err := types.ParseJID(normalizeJID(parentJID))
	if err != nil {
		return fmt.Errorf("invalid parent JID: %w", err)
	}
	child, err := types.ParseJID(normalizeJID(childJID))
	if err != nil {
		return fmt.Errorf("invalid child JID: %w", err)
	}
	return ic.client.LinkGroup(context.Background(), parent, child)
}

// UnlinkGroupFromCommunity remove um subgrupo da comunidade-pai.
func (ic *InstanceClient) UnlinkGroupFromCommunity(parentJID, childJID string) error {
	parent, err := types.ParseJID(normalizeJID(parentJID))
	if err != nil {
		return fmt.Errorf("invalid parent JID: %w", err)
	}
	child, err := types.ParseJID(normalizeJID(childJID))
	if err != nil {
		return fmt.Errorf("invalid child JID: %w", err)
	}
	return ic.client.UnlinkGroup(context.Background(), parent, child)
}

// GetCommunitySubGroups lista os subgrupos de uma comunidade.
func (ic *InstanceClient) GetCommunitySubGroups(communityJID string) ([]*types.GroupLinkTarget, error) {
	jid, err := types.ParseJID(normalizeJID(communityJID))
	if err != nil {
		return nil, fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.GetSubGroups(context.Background(), jid)
}

// ─── Newsletter (Channels) ─────────────────────────────────────────

// CreateNewsletter cria um canal/newsletter.
func (ic *InstanceClient) CreateNewsletter(name, description string, picture []byte) (*types.NewsletterMetadata, error) {
	return ic.client.CreateNewsletter(context.Background(), whatsmeow.CreateNewsletterParams{
		Name:        name,
		Description: description,
		Picture:     picture,
	})
}

// ListSubscribedNewsletters lista os canais que a conta segue.
func (ic *InstanceClient) ListSubscribedNewsletters() ([]*types.NewsletterMetadata, error) {
	return ic.client.GetSubscribedNewsletters(context.Background())
}

// GetNewsletterInfo retorna metadados de um canal por JID.
func (ic *InstanceClient) GetNewsletterInfo(newsletterJID string) (*types.NewsletterMetadata, error) {
	jid, err := types.ParseJID(normalizeJID(newsletterJID))
	if err != nil {
		return nil, fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.GetNewsletterInfo(context.Background(), jid)
}

// GetNewsletterByInvite resolve metadados a partir do link convite
// "https://whatsapp.com/channel/<invite-key>".
func (ic *InstanceClient) GetNewsletterByInvite(inviteKey string) (*types.NewsletterMetadata, error) {
	return ic.client.GetNewsletterInfoWithInvite(context.Background(), inviteKey)
}

// FollowNewsletter inscreve a conta no canal.
func (ic *InstanceClient) FollowNewsletter(newsletterJID string) error {
	jid, err := types.ParseJID(normalizeJID(newsletterJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.FollowNewsletter(context.Background(), jid)
}

// UnfollowNewsletter desinscreve a conta do canal.
func (ic *InstanceClient) UnfollowNewsletter(newsletterJID string) error {
	jid, err := types.ParseJID(normalizeJID(newsletterJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.UnfollowNewsletter(context.Background(), jid)
}

// GetNewsletterMessages busca mensagens recentes de um canal.
// count default = 50 quando <= 0.
func (ic *InstanceClient) GetNewsletterMessages(newsletterJID string, count int, before types.MessageServerID) ([]*types.NewsletterMessage, error) {
	jid, err := types.ParseJID(normalizeJID(newsletterJID))
	if err != nil {
		return nil, fmt.Errorf("invalid JID: %w", err)
	}
	if count <= 0 {
		count = 50
	}
	return ic.client.GetNewsletterMessages(context.Background(), jid, &whatsmeow.GetNewsletterMessagesParams{
		Count:  count,
		Before: before,
	})
}

// ─── Calls ─────────────────────────────────────────────────────────

// RejectCall rejeita uma chamada recebida. callerJID é quem ligou
// (vem no evento events.CallOffer.CallCreator) e callID é o id da
// chamada.
func (ic *InstanceClient) RejectCall(callerJID, callID string) error {
	jid, err := types.ParseJID(normalizeJID(callerJID))
	if err != nil {
		return fmt.Errorf("invalid JID: %w", err)
	}
	return ic.client.RejectCall(context.Background(), jid, callID)
}
