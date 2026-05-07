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
// Tipos suportados:
//   - "add_tag":     {"type":"add_tag", "tag":"Contatado-2025-Q1", "color":"#00d46a"}
//   - "move_stage":  {"type":"move_stage", "funnel_id":"<uuid>", "stage_id":"<uuid>",
//                     "create_if_missing": true}
type CampaignPostAction struct {
	Type            string `json:"type"`
	Tag             string `json:"tag,omitempty"`
	Color           string `json:"color,omitempty"`
	FunnelID        string `json:"funnel_id,omitempty"`
	StageID         string `json:"stage_id,omitempty"`
	CreateIfMissing bool   `json:"create_if_missing,omitempty"`
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
		case "move_stage":
			if err := postActionMoveStage(db, contact, a); err != nil {
				log.Warn().Err(err).Str("stage", a.StageID).Msg("campaign.post_actions: move_stage falhou")
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
		color = "#00d46a"
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
