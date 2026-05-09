package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// WABATemplateDefault — armazena valores default pra header de mídia
// dos templates aprovados. Meta exige um link/handle fresco em CADA
// envio (a aprovação só carrega uma amostra), então o usuário teria
// que digitar a URL toda vez. Aqui o usuário define a URL UMA vez
// por template+idioma e o front auto-preenche em chamadas futuras.
//
// Escopo: por instância (não por workspace), porque cada instância
// WABA tem seu próprio conjunto de templates aprovados — embora o
// nome possa coincidir, a aprovação é única.
type WABATemplateDefault struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey" json:"id"`
	InstanceID uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_waba_tpl_def_unique" json:"instance_id"`

	// Identificação do template — name+language identificam o template
	// dentro da instância. Templates de mesmo nome em idiomas
	// diferentes são entradas separadas (cada uma pode ter URL diferente).
	TemplateName     string `gorm:"type:varchar(120);not null;uniqueIndex:idx_waba_tpl_def_unique" json:"template_name"`
	TemplateLanguage string `gorm:"type:varchar(20);not null;uniqueIndex:idx_waba_tpl_def_unique" json:"template_language"`

	// Header de mídia — preenchido conforme o formato do template:
	//   IMAGE/VIDEO/DOCUMENT → HeaderMediaURL (link público)
	//   DOCUMENT             → HeaderFilename adicional (opcional)
	//   LOCATION             → Latitude/Longitude/Name/Address
	HeaderMediaURL    string  `gorm:"type:text" json:"header_media_url,omitempty"`
	HeaderFilename    string  `gorm:"type:varchar(255)" json:"header_filename,omitempty"`
	HeaderLatitude    float64 `gorm:"type:double precision" json:"header_latitude,omitempty"`
	HeaderLongitude   float64 `gorm:"type:double precision" json:"header_longitude,omitempty"`
	HeaderLocationName string `gorm:"type:varchar(255)" json:"header_location_name,omitempty"`
	HeaderLocationAddr string `gorm:"type:varchar(255)" json:"header_location_address,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (w *WABATemplateDefault) BeforeCreate(tx *gorm.DB) error {
	if w.ID == uuid.Nil {
		w.ID = uuid.New()
	}
	return nil
}

func (w *WABATemplateDefault) TableName() string {
	return "waba_template_defaults"
}
