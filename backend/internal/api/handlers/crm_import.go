package handlers

import (
	"encoding/csv"
	"errors"
	"io"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/api/middleware"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

// CRMImportHandler — bulk import via CSV de Contatos / Empresas / Deals.
// Inspirado em Close + HubSpot import wizard. Idempotente por
// chave natural: phone p/ contact, name p/ company, title p/ deal.
type CRMImportHandler struct {
	db *gorm.DB
}

func NewCRMImportHandler(db *gorm.DB) *CRMImportHandler {
	return &CRMImportHandler{db: db}
}

type importStat struct {
	Created int      `json:"created"`
	Updated int      `json:"updated"`
	Skipped int      `json:"skipped"`
	Errors  []string `json:"errors,omitempty"`
}

// ImportContacts POST /v1/crm/contacts/import (multipart "file")
//
// CSV cols (case-insensitive):
//   phone (req), name, email, funnel, stage, tags (vírgula), company, owner_email
func (h *CRMImportHandler) ImportContacts(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(401).JSON(fiber.Map{"error": "auth"})
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "arquivo CSV obrigatório"})
	}
	f, err := fh.Open()
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer f.Close()
	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "CSV vazio"})
	}
	idx := indexCols(header)
	if _, ok := idx["phone"]; !ok {
		return c.Status(400).JSON(fiber.Map{"error": "coluna 'phone' obrigatória"})
	}

	stats := importStat{}
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			stats.Skipped++
			continue
		}
		phone := getCol(row, idx, "phone")
		if phone == "" {
			stats.Skipped++
			continue
		}
		name := getCol(row, idx, "name")
		email := strings.ToLower(getCol(row, idx, "email"))
		funnel := getCol(row, idx, "funnel")
		stage := getCol(row, idx, "stage")
		companyName := getCol(row, idx, "company")
		tagsRaw := getCol(row, idx, "tags")

		// Resolve company se especificada (cria se não existir).
		var companyID *uuid.UUID
		if companyName != "" {
			var company models.Company
			if h.db.Where("workspace_id = ? AND LOWER(name) = ?", wsID, strings.ToLower(companyName)).First(&company).Error != nil {
				company = models.Company{WorkspaceID: wsID, UserID: user.ID, Name: companyName}
				if err := h.db.Create(&company).Error; err == nil {
					companyID = &company.ID
				}
			} else {
				companyID = &company.ID
			}
		}

		var contact models.Contact
		err = h.db.Where("(workspace_id = ? OR user_id = ?) AND phone = ?", wsID, user.ID, phone).First(&contact).Error
		if err != nil {
			contact = models.Contact{
				WorkspaceID: &wsID, UserID: user.ID,
				Phone: phone, Name: firstNonEmpty(name, phone), Email: email,
				Funnel: funnel, Stage: stage, CompanyID: companyID,
				Source: models.SourceManual,
			}
			if err := h.db.Create(&contact).Error; err != nil {
				stats.Errors = append(stats.Errors, "linha falhou: "+phone)
				continue
			}
			stats.Created++
		} else {
			updates := map[string]any{}
			if name != "" {
				updates["name"] = name
			}
			if email != "" {
				updates["email"] = email
			}
			if funnel != "" {
				updates["funnel"] = funnel
			}
			if stage != "" {
				updates["stage"] = stage
			}
			if companyID != nil {
				updates["company_id"] = companyID
			}
			if len(updates) > 0 {
				h.db.Model(&contact).Updates(updates)
			}
			stats.Updated++
		}

		// Tags: cria se não existir, associa.
		if tagsRaw != "" {
			for _, tname := range strings.Split(tagsRaw, ",") {
				tname = strings.TrimSpace(tname)
				if tname == "" {
					continue
				}
				var tag models.Tag
				if h.db.Where("workspace_id = ? AND LOWER(name) = ?", wsID, strings.ToLower(tname)).First(&tag).Error != nil {
					tag = models.Tag{WorkspaceID: wsID, UserID: user.ID, Name: tname}
					if h.db.Create(&tag).Error != nil {
						continue
					}
				}
				h.db.Exec(`INSERT INTO contact_tags (contact_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
					contact.ID, tag.ID)
			}
		}
	}
	return c.JSON(stats)
}

// ImportCompanies POST /v1/crm/companies/import (multipart "file")
//
// CSV cols: name (req), website, phone, email, industry, size, address, city, state, country
func (h *CRMImportHandler) ImportCompanies(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(401).JSON(fiber.Map{"error": "auth"})
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "arquivo CSV obrigatório"})
	}
	f, _ := fh.Open()
	defer f.Close()
	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "CSV vazio"})
	}
	idx := indexCols(header)
	if _, ok := idx["name"]; !ok {
		return c.Status(400).JSON(fiber.Map{"error": "coluna 'name' obrigatória"})
	}
	stats := importStat{}
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			stats.Skipped++
			continue
		}
		name := getCol(row, idx, "name")
		if name == "" {
			stats.Skipped++
			continue
		}
		var company models.Company
		if h.db.Where("workspace_id = ? AND LOWER(name) = ?", wsID, strings.ToLower(name)).First(&company).Error == nil {
			updateCompanyFromRow(h.db, &company, row, idx)
			stats.Updated++
			continue
		}
		company = models.Company{WorkspaceID: wsID, UserID: user.ID, Name: name}
		setCompanyFieldsFromRow(&company, row, idx)
		if err := h.db.Create(&company).Error; err != nil {
			stats.Errors = append(stats.Errors, "falhou: "+name)
			continue
		}
		stats.Created++
	}
	return c.JSON(stats)
}

// ImportDeals POST /v1/crm/deals/import (multipart "file")
//
// CSV cols: title (req), contact_phone (req), value, currency, funnel,
// stage, expected_close_date (YYYY-MM-DD), description
func (h *CRMImportHandler) ImportDeals(c *fiber.Ctx) error {
	wsID := middleware.GetWorkspaceID(c)
	user := middleware.GetCurrentUser(c)
	if user == nil {
		return c.Status(401).JSON(fiber.Map{"error": "auth"})
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "arquivo CSV obrigatório"})
	}
	f, _ := fh.Open()
	defer f.Close()
	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "CSV vazio"})
	}
	idx := indexCols(header)
	if _, ok := idx["title"]; !ok {
		return c.Status(400).JSON(fiber.Map{"error": "coluna 'title' obrigatória"})
	}
	if _, ok := idx["contact_phone"]; !ok {
		return c.Status(400).JSON(fiber.Map{"error": "coluna 'contact_phone' obrigatória"})
	}
	stats := importStat{}
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			stats.Skipped++
			continue
		}
		title := getCol(row, idx, "title")
		phone := getCol(row, idx, "contact_phone")
		if title == "" || phone == "" {
			stats.Skipped++
			continue
		}
		// Resolve contact por phone (cria se não existir).
		var contact models.Contact
		if h.db.Where("(workspace_id = ? OR user_id = ?) AND phone = ?", wsID, user.ID, phone).First(&contact).Error != nil {
			contact = models.Contact{
				WorkspaceID: &wsID, UserID: user.ID,
				Phone: phone, Name: phone, Source: models.SourceManual,
			}
			if err := h.db.Create(&contact).Error; err != nil {
				stats.Skipped++
				continue
			}
		}
		valueStr := getCol(row, idx, "value")
		valueMinor := int64(0)
		if v, err := strconv.ParseFloat(strings.ReplaceAll(valueStr, ",", "."), 64); err == nil {
			valueMinor = int64(v * 100)
		}
		currency := getCol(row, idx, "currency")
		if currency == "" {
			currency = "BRL"
		}
		desc := getCol(row, idx, "description")
		// Cria deal sem checar duplicata (CSV import pode trazer múltiplos
		// deals pro mesmo contato — caso comum em renovação anual).
		deal := map[string]any{
			"workspace_id": wsID,
			"user_id":      user.ID,
			"contact_id":   contact.ID,
			"title":        title,
			"value":        valueMinor,
			"currency":     currency,
			"description":  desc,
			"status":       "open",
		}
		if err := h.db.Table("deals").Create(deal).Error; err != nil {
			stats.Errors = append(stats.Errors, "deal falhou: "+title)
			continue
		}
		stats.Created++
	}
	return c.JSON(stats)
}

// ─── helpers ──────────────────────────────────────────────────────────

func indexCols(header []string) map[string]int {
	m := map[string]int{}
	for i, h := range header {
		m[strings.ToLower(strings.TrimSpace(h))] = i
	}
	return m
}

func getCol(row []string, idx map[string]int, name string) string {
	i, ok := idx[name]
	if !ok || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

func setCompanyFieldsFromRow(c *models.Company, row []string, idx map[string]int) {
	if v := getCol(row, idx, "website"); v != "" {
		c.Website = v
	}
	if v := getCol(row, idx, "phone"); v != "" {
		c.Phone = v
	}
	if v := getCol(row, idx, "email"); v != "" {
		c.Email = v
	}
	if v := getCol(row, idx, "industry"); v != "" {
		c.Industry = v
	}
	if v := getCol(row, idx, "size"); v != "" {
		c.Size = v
	}
}

func updateCompanyFromRow(db *gorm.DB, c *models.Company, row []string, idx map[string]int) {
	updates := map[string]any{}
	if v := getCol(row, idx, "website"); v != "" {
		updates["website"] = v
	}
	if v := getCol(row, idx, "phone"); v != "" {
		updates["phone"] = v
	}
	if v := getCol(row, idx, "email"); v != "" {
		updates["email"] = v
	}
	if v := getCol(row, idx, "industry"); v != "" {
		updates["industry"] = v
	}
	if v := getCol(row, idx, "size"); v != "" {
		updates["size"] = v
	}
	if len(updates) > 0 {
		db.Model(c).Updates(updates)
	}
}

var _ = errors.New
