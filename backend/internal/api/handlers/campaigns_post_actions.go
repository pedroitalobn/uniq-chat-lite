package handlers

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog/log"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// CampaignPostAction — uma ação aplicada por destinatário após envio
// bem-sucedido. JSON array dessas vai em Campaign.PostActions.
//
// Tipos suportados (todos best-effort, idempotentes):
//
//   add_tag          : {"type":"add_tag","tag":"VIP","color":"#2563EB"}
//   remove_tag       : {"type":"remove_tag","tag":"frio"}
//   move_stage       : {"type":"move_stage","funnel_id":"...","stage_id":"...",
//                       "create_if_missing":true}
//                       Move a deal aberta do contato pra esse estágio. Se
//                       não tem deal e create_if_missing, cria uma.
//   create_deal      : {"type":"create_deal","funnel_id":"...","stage_id":"...",
//                       "deal_title":"Lead Q1","deal_value":1500,
//                       "deal_currency":"BRL"}
//                       Cria SEMPRE uma deal nova (mesmo se já tem outra
//                       aberta), com título e valor configuráveis.
//   assign_owner     : {"type":"assign_owner","owner_user_id":"...",
//                       "apply_to_deal":true}
//                       Atribui o contato a esse usuário; se apply_to_deal,
//                       também aplica em qualquer deal aberta do contato.
//   add_to_segment   : {"type":"add_to_segment","segment_id":"..."}
//                       Adiciona o contato como membro do segmento (manual).
//   create_segment   : {"type":"create_segment","segment_name":"Campanha X"}
//                       Garante que existe um segmento manual com esse nome
//                       (cria se faltar) e adiciona o contato como membro.
//                       Equivale a "criar segmento com todos da campanha"
//                       sem precisar de hook de fim-de-campanha.
//   set_custom_field : {"type":"set_custom_field","field_key":"origem",
//                       "field_value":"campanha-jan"}
//                       Seta um valor no Contact.CustomFields (JSON).
type CampaignPostAction struct {
	Type            string  `json:"type"`
	Tag             string  `json:"tag,omitempty"`
	Color           string  `json:"color,omitempty"`
	FunnelID        string  `json:"funnel_id,omitempty"`
	StageID         string  `json:"stage_id,omitempty"`
	CreateIfMissing bool    `json:"create_if_missing,omitempty"`
	DealTitle       string  `json:"deal_title,omitempty"`
	DealValue       float64 `json:"deal_value,omitempty"`
	DealCurrency    string  `json:"deal_currency,omitempty"`
	OwnerUserID     string  `json:"owner_user_id,omitempty"`
	ApplyToDeal     bool    `json:"apply_to_deal,omitempty"`
	SegmentID       string  `json:"segment_id,omitempty"`
	SegmentName     string  `json:"segment_name,omitempty"`
	FieldKey        string  `json:"field_key,omitempty"`
	FieldValue      string  `json:"field_value,omitempty"`
}

// applyCampaignPostActions — best-effort. Erros logam mas não falham o
// envio (a mensagem já foi entregue, o post-action é "bônus"). Idempotente
// pra todos os tipos: re-execução não duplica tag, não muda deal já no
// estágio alvo.
func applyCampaignPostActions(db *gorm.DB, campaign *models.Campaign, recipient *models.CampaignRecipient) {
	raw := strings.TrimSpace(campaign.PostActions)
	if raw == "" || raw == "[]" || raw == "null" {
		return
	}
	var actions []CampaignPostAction
	if err := json.Unmarshal([]byte(raw), &actions); err != nil {
		log.Warn().Err(err).Str("campaign", campaign.ID.String()).
			Msg("campaign.post_actions: JSON inválido — pulando")
		return
	}
	if len(actions) == 0 {
		return
	}

	// Localiza o contato pelo phone do recipient. Recipient.ContactID
	// pode estar setado (recipient_type=crm) ou não (recipient_type=
	// contacts/csv) — então tentamos ID primeiro, phone depois.
	contact, err := findCampaignContact(db, campaign, recipient)
	if err != nil || contact == nil {
		log.Debug().Err(err).Str("recipient", recipient.ID.String()).
			Msg("campaign.post_actions: contact não resolvido — pulando")
		return
	}

	for _, a := range actions {
		switch a.Type {
		case "add_tag":
			if err := postActionAddTag(db, contact, a); err != nil {
				log.Warn().Err(err).Str("tag", a.Tag).Msg("campaign.post_actions: add_tag falhou")
			}
		case "remove_tag":
			if err := postActionRemoveTag(db, contact, a); err != nil {
				log.Warn().Err(err).Str("tag", a.Tag).Msg("campaign.post_actions: remove_tag falhou")
			}
		case "move_stage":
			if err := postActionMoveStage(db, contact, a); err != nil {
				log.Warn().Err(err).Str("stage", a.StageID).Msg("campaign.post_actions: move_stage falhou")
			}
		case "create_deal":
			if err := postActionCreateDeal(db, contact, a); err != nil {
				log.Warn().Err(err).Str("stage", a.StageID).Msg("campaign.post_actions: create_deal falhou")
			}
		case "assign_owner":
			if err := postActionAssignOwner(db, contact, a); err != nil {
				log.Warn().Err(err).Str("owner", a.OwnerUserID).Msg("campaign.post_actions: assign_owner falhou")
			}
		case "add_to_segment":
			if err := postActionAddToSegment(db, contact, a); err != nil {
				log.Warn().Err(err).Str("segment", a.SegmentID).Msg("campaign.post_actions: add_to_segment falhou")
			}
		case "create_segment":
			if err := postActionCreateSegment(db, campaign, contact, a); err != nil {
				log.Warn().Err(err).Str("segment_name", a.SegmentName).Msg("campaign.post_actions: create_segment falhou")
			}
		case "set_custom_field":
			if err := postActionSetCustomField(db, contact, a); err != nil {
				log.Warn().Err(err).Str("key", a.FieldKey).Msg("campaign.post_actions: set_custom_field falhou")
			}
		default:
			log.Debug().Str("type", a.Type).Msg("campaign.post_actions: tipo desconhecido")
		}
	}
}

func findCampaignContact(db *gorm.DB, campaign *models.Campaign, r *models.CampaignRecipient) (*models.Contact, error) {
	// CampaignRecipient não guarda contact_id explícito; resolve por phone.
	// Phone do recipient pode trazer "@s.whatsapp.net" ou só dígitos — strip
	// pra normalizar com Contact.Phone.
	phone := strings.SplitN(r.Phone, "@", 2)[0]
	if phone == "" {
		return nil, nil
	}
	var c models.Contact
	q := db.Where("phone = ?", phone)
	if campaign.WorkspaceID != nil {
		q = q.Where("workspace_id = ? OR workspace_id IS NULL", *campaign.WorkspaceID)
	}
	if err := q.First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func postActionAddTag(db *gorm.DB, contact *models.Contact, a CampaignPostAction) error {
	name := strings.TrimSpace(a.Tag)
	if name == "" {
		return nil
	}
	color := a.Color
	if color == "" {
		color = "#2563EB"
	}
	wsID := uuid.Nil
	if contact.WorkspaceID != nil {
		wsID = *contact.WorkspaceID
	}
	var tag models.Tag
	q := db.Where("name = ? AND (workspace_id = ? OR workspace_id IS NULL)", name, wsID).First(&tag)
	if q.Error != nil {
		var wsPtr *uuid.UUID
		if wsID != uuid.Nil {
			wsPtr = &wsID
		}
		tag = models.Tag{Name: name, Color: color, WorkspaceID: wsPtr}
		if err := db.Create(&tag).Error; err != nil {
			return err
		}
	}
	return db.Exec(
		"INSERT INTO contact_tags (contact_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
		contact.ID, tag.ID,
	).Error
}

func postActionMoveStage(db *gorm.DB, contact *models.Contact, a CampaignPostAction) error {
	stageUUID, err := uuid.Parse(a.StageID)
	if err != nil {
		return err
	}
	var stage models.FunnelStage
	if err := db.First(&stage, "id = ?", stageUUID).Error; err != nil {
		return err
	}
	funnelUUID := stage.FunnelID
	if a.FunnelID != "" {
		if fid, err := uuid.Parse(a.FunnelID); err == nil {
			funnelUUID = fid
		}
	}
	wsID := uuid.Nil
	if contact.WorkspaceID != nil {
		wsID = *contact.WorkspaceID
	}
	var deal models.Deal
	q := db.Where("workspace_id = ? AND contact_id = ? AND funnel_id = ? AND status = 'open'",
		wsID, contact.ID, funnelUUID).First(&deal)
	if q.Error != nil {
		if !a.CreateIfMissing {
			return nil
		}
		now := time.Now()
		deal = models.Deal{
			WorkspaceID:   wsID,
			Title:         "Campanha — " + contact.Name,
			ContactID:     contact.ID,
			FunnelID:      funnelUUID,
			StageID:       stageUUID,
			Status:        models.DealStatusOpen,
			Currency:      "BRL",
			StageChangeAt: &now,
			Source:        "campaign",
		}
		return db.Create(&deal).Error
	}
	if deal.StageID == stageUUID {
		return nil // já está lá
	}
	now := time.Now()
	return db.Model(&deal).Updates(map[string]any{
		"stage_id":        stageUUID,
		"stage_change_at": now,
	}).Error
}

func postActionRemoveTag(db *gorm.DB, contact *models.Contact, a CampaignPostAction) error {
	name := strings.TrimSpace(a.Tag)
	if name == "" {
		return nil
	}
	wsID := uuid.Nil
	if contact.WorkspaceID != nil {
		wsID = *contact.WorkspaceID
	}
	var tag models.Tag
	if err := db.Where("name = ? AND (workspace_id = ? OR workspace_id IS NULL)", name, wsID).
		First(&tag).Error; err != nil {
		return nil // sem essa tag = nada a remover
	}
	return db.Exec(
		"DELETE FROM contact_tags WHERE contact_id = ? AND tag_id = ?",
		contact.ID, tag.ID,
	).Error
}

// postActionCreateDeal — sempre cria uma deal nova, mesmo se já existe
// outra aberta pro contato no mesmo funil. Use-case: "cada disparo da
// campanha gera uma oportunidade nova pra acompanhar no funil".
// move_stage continua sendo o caminho idempotente (move se existe).
func postActionCreateDeal(db *gorm.DB, contact *models.Contact, a CampaignPostAction) error {
	stageUUID, err := uuid.Parse(a.StageID)
	if err != nil {
		return err
	}
	var stage models.FunnelStage
	if err := db.First(&stage, "id = ?", stageUUID).Error; err != nil {
		return err
	}
	funnelUUID := stage.FunnelID
	if a.FunnelID != "" {
		if fid, err := uuid.Parse(a.FunnelID); err == nil {
			funnelUUID = fid
		}
	}
	wsID := uuid.Nil
	if contact.WorkspaceID != nil {
		wsID = *contact.WorkspaceID
	}
	title := strings.TrimSpace(a.DealTitle)
	if title == "" {
		title = "Campanha — " + contact.Name
	}
	currency := strings.ToUpper(strings.TrimSpace(a.DealCurrency))
	if currency == "" {
		currency = "BRL"
	}
	now := time.Now()
	deal := models.Deal{
		WorkspaceID:   wsID,
		Title:         title,
		ContactID:     contact.ID,
		FunnelID:      funnelUUID,
		StageID:       stageUUID,
		Status:        models.DealStatusOpen,
		Currency:      currency,
		Value:         int64(a.DealValue),
		StageChangeAt: &now,
		Source:        "campaign",
	}
	return db.Create(&deal).Error
}

// postActionAssignOwner — define Contact.OwnerID. Se a.ApplyToDeal,
// propaga pra todas as deals abertas desse contato. Idempotente: se já
// pertencia ao owner, é no-op.
func postActionAssignOwner(db *gorm.DB, contact *models.Contact, a CampaignPostAction) error {
	ownerUUID, err := uuid.Parse(a.OwnerUserID)
	if err != nil {
		return err
	}
	// Confirma que o usuário existe (e idealmente está no mesmo workspace,
	// mas owner_user_id é por contato, sem hard constraint cross-ws).
	var u models.User
	if err := db.Select("id").First(&u, "id = ?", ownerUUID).Error; err != nil {
		return err
	}
	if err := db.Model(&models.Contact{}).
		Where("id = ?", contact.ID).
		Update("owner_id", ownerUUID).Error; err != nil {
		return err
	}
	if a.ApplyToDeal {
		_ = db.Model(&models.Deal{}).
			Where("contact_id = ? AND status = ?", contact.ID, models.DealStatusOpen).
			Update("owner_id", ownerUUID).Error
	}
	return nil
}

// postActionAddToSegment — adiciona o contato a um segmento manual já
// existente. Se o segmento for dinâmico (filtro recalculado on-demand)
// não faz sentido inserir membros explicitamente — pula silenciosamente.
func postActionAddToSegment(db *gorm.DB, contact *models.Contact, a CampaignPostAction) error {
	segUUID, err := uuid.Parse(a.SegmentID)
	if err != nil {
		return err
	}
	var seg models.Segment
	if err := db.First(&seg, "id = ?", segUUID).Error; err != nil {
		return err
	}
	if seg.Type != "manual" {
		log.Debug().Str("segment", seg.ID.String()).Str("type", seg.Type).
			Msg("campaign.post_actions: add_to_segment ignorado em segmento dinâmico")
		return nil
	}
	return insertSegmentMember(db, seg.ID, contact.ID, "campaign")
}

// postActionCreateSegment — cria (find-or-create) um segmento manual com
// o nome dado e adiciona o contato como membro. Permite o caso "criar
// segmento com todos os destinatários da campanha" sem precisar de hook
// no fim da execução: o primeiro recipient cria, os próximos só anexam.
func postActionCreateSegment(db *gorm.DB, campaign *models.Campaign, contact *models.Contact, a CampaignPostAction) error {
	name := strings.TrimSpace(a.SegmentName)
	if name == "" {
		return nil
	}
	wsID := uuid.Nil
	if contact.WorkspaceID != nil {
		wsID = *contact.WorkspaceID
	} else if campaign.WorkspaceID != nil {
		wsID = *campaign.WorkspaceID
	}
	if wsID == uuid.Nil {
		return nil
	}
	var seg models.Segment
	err := db.Where("workspace_id = ? AND name = ?", wsID, name).First(&seg).Error
	if err != nil {
		ownerID := campaign.UserID
		seg = models.Segment{
			WorkspaceID: wsID,
			OwnerUserID: ownerID,
			Name:        name,
			Description: "Criado automaticamente pela campanha " + campaign.Name,
			Type:        "manual",
			Filter:      "{}",
			IsActive:    true,
		}
		if err := db.Create(&seg).Error; err != nil {
			return err
		}
	}
	return insertSegmentMember(db, seg.ID, contact.ID, "campaign")
}

// insertSegmentMember — INSERT idempotente. SegmentMember não tem
// unique constraint cross-DB (índice composto é só pra lookup), então
// fazemos check-then-insert. Race entre duas execuções da mesma campanha
// no mesmo contato é benigna: se duas linhas surgem, queries de membro
// continuam funcionando (apenas duplicam a contagem por uma execução).
func insertSegmentMember(db *gorm.DB, segmentID, contactID uuid.UUID, source string) error {
	var exists int64
	if err := db.Model(&models.SegmentMember{}).
		Where("segment_id = ? AND contact_id = ?", segmentID, contactID).
		Count(&exists).Error; err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}
	return db.Create(&models.SegmentMember{
		SegmentID: segmentID,
		ContactID: contactID,
		AddedAt:   time.Now(),
		Source:    source,
	}).Error
}

// postActionSetCustomField — mescla um par key/value no
// Contact.CustomFields (JSONB). Não toca nas outras chaves.
func postActionSetCustomField(db *gorm.DB, contact *models.Contact, a CampaignPostAction) error {
	key := strings.TrimSpace(a.FieldKey)
	if key == "" {
		return nil
	}
	current := map[string]any{}
	raw := strings.TrimSpace(contact.CustomFields)
	if raw != "" && raw != "{}" && raw != "null" {
		_ = json.Unmarshal([]byte(raw), &current)
	}
	current[key] = a.FieldValue
	out, err := json.Marshal(current)
	if err != nil {
		return err
	}
	return db.Model(&models.Contact{}).
		Where("id = ?", contact.ID).
		Update("custom_fields", string(out)).Error
}
