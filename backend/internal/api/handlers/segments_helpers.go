package handlers

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"strings"

	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"gorm.io/gorm"
)

func jsonUnmarshal(b []byte, v any) error {
	return json.Unmarshal(b, v)
}

// importCSVtoSegment lê CSV (cols: phone, email opcionais, name opcional)
// upserta Contact por phone, e cria SegmentMember pra cada linha.
// Retorna quantos foram inseridos no segment.
func importCSVtoSegment(db *gorm.DB, wsID, userID, segmentID uuid.UUID, fh *multipart.FileHeader) (int, error) {
	f, err := fh.Open()
	if err != nil {
		return 0, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1 // tolerante
	header, err := r.Read()
	if err != nil {
		return 0, errors.New("CSV vazio ou inválido")
	}
	colMap := map[string]int{}
	for i, h := range header {
		colMap[strings.ToLower(strings.TrimSpace(h))] = i
	}
	phoneIdx, hasPhone := colMap["phone"]
	emailIdx, hasEmail := colMap["email"]
	nameIdx, hasName := colMap["name"]
	if !hasPhone && !hasEmail {
		return 0, errors.New("CSV precisa de coluna 'phone' ou 'email'")
	}

	imported := 0
	for {
		row, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}
		var phone, email, name string
		if hasPhone && phoneIdx < len(row) {
			phone = strings.TrimSpace(row[phoneIdx])
		}
		if hasEmail && emailIdx < len(row) {
			email = strings.ToLower(strings.TrimSpace(row[emailIdx]))
		}
		if hasName && nameIdx < len(row) {
			name = strings.TrimSpace(row[nameIdx])
		}
		if phone == "" && email == "" {
			continue
		}
		// Upsert contact por phone primeiro, fallback email.
		var contact models.Contact
		q := db.Where("workspace_id = ?", wsID)
		if phone != "" {
			q = q.Where("phone = ?", phone)
		} else {
			q = q.Where("email = ?", email)
		}
		if err := q.First(&contact).Error; err != nil {
			contact = models.Contact{
				WorkspaceID: &wsID,
				UserID:      userID,
				Name:        firstNonEmpty(name, phone, email),
				Phone:       phone,
				Email:       email,
				Source:      models.SourceManual,
			}
			if err := db.Create(&contact).Error; err != nil {
				continue
			}
		}
		// Adiciona ao segment (idempotente).
		var existing models.SegmentMember
		if db.Where("segment_id = ? AND contact_id = ?", segmentID, contact.ID).First(&existing).Error == nil {
			continue
		}
		db.Create(&models.SegmentMember{
			SegmentID: segmentID, ContactID: contact.ID, Source: "csv",
		})
		imported++
	}
	return imported, nil
}

func firstNonEmpty(vs ...string) string {
	for _, v := range vs {
		if v != "" {
			return v
		}
	}
	return ""
}
