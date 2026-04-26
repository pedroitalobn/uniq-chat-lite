package models

import (
	"time"

	"github.com/google/uuid"
)

// LinkPreview armazena metadados OG/Twitter cards de URLs extraídas de
// mensagens. Cache por URL (hash) com TTL de 7 dias — depois disso re-fetch.
//
// Backend extrai URL no save da mensagem, busca async (não bloqueia o save),
// e popula esta tabela. Frontend faz lookup por URL ao renderizar.
type LinkPreview struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	URL         string    `gorm:"type:text;not null;uniqueIndex:idx_linkprev_url,length:191" json:"url"`
	Title       string    `gorm:"type:text" json:"title,omitempty"`
	Description string    `gorm:"type:text" json:"description,omitempty"`
	ImageURL    string    `gorm:"type:text" json:"image_url,omitempty"`
	SiteName    string    `gorm:"type:varchar(120)" json:"site_name,omitempty"`
	FaviconURL  string    `gorm:"type:text" json:"favicon_url,omitempty"`
	// FetchedAt — quando o backend buscou o OG. Reutiliza enquanto < TTL.
	FetchedAt time.Time `json:"fetched_at"`
	// FetchErr — se o fetch falhou, guarda o motivo (404, timeout, parse).
	// Cache negativo curto pra não retentar sem parar.
	FetchErr  string    `gorm:"type:varchar(255)" json:"fetch_err,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (LinkPreview) TableName() string { return "link_previews" }
