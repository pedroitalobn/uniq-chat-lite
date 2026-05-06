package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/uniq-chat/backend/internal/models"
	"github.com/uniq-chat/backend/internal/services"
	"github.com/uniq-chat/backend/internal/storage"
	"gorm.io/gorm"
)

// HelpDeskHandler handles knowledge base categories and articles.
type HelpDeskHandler struct {
	db  *gorm.DB
	llm *services.LLMService
}

// NewHelpDeskHandler creates a new HelpDeskHandler.
func NewHelpDeskHandler(db *gorm.DB, llm *services.LLMService) *HelpDeskHandler {
	return &HelpDeskHandler{db: db, llm: llm}
}

// workspaceIDFromCtx extracts the workspace UUID from Fiber context.
// It first checks the X-Workspace-ID header, then c.Locals("workspace_id").
func workspaceIDFromCtx(c *fiber.Ctx) (uuid.UUID, error) {
	if h := c.Get("X-Workspace-ID"); h != "" {
		return uuid.Parse(h)
	}
	if v := c.Locals("workspace_id"); v != nil {
		switch id := v.(type) {
		case uuid.UUID:
			return id, nil
		case string:
			return uuid.Parse(id)
		}
	}
	return uuid.Nil, errors.New("workspace_id not found in context")
}

// ─── Categories ──────────────────────────────────────────────────────────────

type categoryWithCount struct {
	models.HelpDeskCategory
	ArticleCount int64 `json:"article_count"`
}

// ListCategories GET /helpdesk/categories
func (h *HelpDeskHandler) ListCategories(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	var cats []models.HelpDeskCategory
	if err := h.db.Where("workspace_id = ?", wsID).
		Order("position ASC, created_at ASC").
		Find(&cats).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}

	// Enrich with article counts.
	result := make([]categoryWithCount, len(cats))
	for i, cat := range cats {
		var cnt int64
		h.db.Model(&models.HelpDeskArticle{}).
			Where("workspace_id = ? AND category_id = ? AND deleted_at IS NULL", wsID, cat.ID).
			Count(&cnt)
		result[i] = categoryWithCount{HelpDeskCategory: cat, ArticleCount: cnt}
	}

	return c.JSON(result)
}

// CreateCategory POST /helpdesk/categories
func (h *HelpDeskHandler) CreateCategory(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	var body models.HelpDeskCategory
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	body.WorkspaceID = wsID

	if err := h.db.Create(&body).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.Status(fiber.StatusCreated).JSON(body)
}

// UpdateCategory PATCH /helpdesk/categories/:id
func (h *HelpDeskHandler) UpdateCategory(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}

	var cat models.HelpDeskCategory
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&cat).Error; err != nil {
		return fiber.NewError(fiber.StatusNotFound, "categoria não encontrada")
	}

	var body map[string]interface{}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	delete(body, "id")
	delete(body, "workspace_id")

	if err := h.db.Model(&cat).Updates(body).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(cat)
}

// DeleteCategory DELETE /helpdesk/categories/:id
func (h *HelpDeskHandler) DeleteCategory(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}

	result := h.db.Where("id = ? AND workspace_id = ?", id, wsID).Delete(&models.HelpDeskCategory{})
	if result.Error != nil {
		return fiber.NewError(fiber.StatusInternalServerError, result.Error.Error())
	}
	if result.RowsAffected == 0 {
		return fiber.NewError(fiber.StatusNotFound, "categoria não encontrada")
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// ─── Articles ─────────────────────────────────────────────────────────────────

// ListArticles GET /helpdesk/articles?category_id=&status=&q=
func (h *HelpDeskHandler) ListArticles(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	query := h.db.Model(&models.HelpDeskArticle{}).Where("workspace_id = ?", wsID)

	if cat := c.Query("category_id"); cat != "" {
		if catID, err := uuid.Parse(cat); err == nil {
			query = query.Where("category_id = ?", catID)
		}
	}
	if status := c.Query("status"); status != "" {
		query = query.Where("status = ?", status)
	}
	if q := c.Query("q"); q != "" {
		like := "%" + strings.ToLower(q) + "%"
		query = query.Where("LOWER(title) ILIKE ? OR LOWER(summary) ILIKE ?", like, like)
	}

	var articles []models.HelpDeskArticle
	if err := query.Order("updated_at DESC").Find(&articles).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(articles)
}

// CreateArticle POST /helpdesk/articles
func (h *HelpDeskHandler) CreateArticle(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	var body models.HelpDeskArticle
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	body.WorkspaceID = wsID

	if err := h.db.Create(&body).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.Status(fiber.StatusCreated).JSON(body)
}

// GetArticle GET /helpdesk/articles/:id
func (h *HelpDeskHandler) GetArticle(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}

	var article models.HelpDeskArticle
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&article).Error; err != nil {
		return fiber.NewError(fiber.StatusNotFound, "artigo não encontrado")
	}

	// Increment view count asynchronously.
	h.db.Model(&article).UpdateColumn("view_count", gorm.Expr("view_count + 1"))

	return c.JSON(article)
}

// UpdateArticle PATCH /helpdesk/articles/:id
func (h *HelpDeskHandler) UpdateArticle(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}

	var article models.HelpDeskArticle
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&article).Error; err != nil {
		return fiber.NewError(fiber.StatusNotFound, "artigo não encontrado")
	}

	var body map[string]interface{}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	delete(body, "id")
	delete(body, "workspace_id")

	if err := h.db.Model(&article).Updates(body).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(article)
}

// DeleteArticle DELETE /helpdesk/articles/:id
func (h *HelpDeskHandler) DeleteArticle(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}

	result := h.db.Where("id = ? AND workspace_id = ?", id, wsID).Delete(&models.HelpDeskArticle{})
	if result.Error != nil {
		return fiber.NewError(fiber.StatusInternalServerError, result.Error.Error())
	}
	if result.RowsAffected == 0 {
		return fiber.NewError(fiber.StatusNotFound, "artigo não encontrado")
	}
	return c.SendStatus(fiber.StatusNoContent)
}

// PublishArticle POST /helpdesk/articles/:id/publish
func (h *HelpDeskHandler) PublishArticle(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fiber.NewError(fiber.StatusBadRequest, "id inválido")
	}

	var article models.HelpDeskArticle
	if err := h.db.Where("id = ? AND workspace_id = ?", id, wsID).First(&article).Error; err != nil {
		return fiber.NewError(fiber.StatusNotFound, "artigo não encontrado")
	}

	if err := h.db.Model(&article).UpdateColumn("status", models.ArticlePublished).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	article.Status = models.ArticlePublished
	return c.JSON(article)
}

// GenerateArticle POST /helpdesk/articles/generate
func (h *HelpDeskHandler) GenerateArticle(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	var body struct {
		Prompt     string     `json:"prompt"`
		CategoryID *uuid.UUID `json:"category_id,omitempty"`
		Title      string     `json:"title,omitempty"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	if body.Prompt == "" {
		return fiber.NewError(fiber.StatusBadRequest, "prompt é obrigatório")
	}

	// Find active LLM integration for the workspace. Quando não houver,
	// passamos integration=nil pro CallChatWithSystem que cai no
	// fallback automático pra PlatformAI ativa configurada em
	// /admin/providers → Uniq AI. Antes esse early-return barrava o
	// fluxo mesmo com Uniq AI corretamente configurada.
	var integration *models.UserIntegration
	var found models.UserIntegration
	if err := h.db.
		Joins("JOIN user_workspaces uw ON uw.user_id = user_integrations.user_id").
		Where("uw.workspace_id = ? AND user_integrations.is_active = true", wsID).
		First(&found).Error; err == nil {
		integration = &found
	}

	system := `Você é um redator especializado em bases de conhecimento e help desks.
Gere um artigo completo para a base de conhecimento no formato solicitado.
Responda SOMENTE com um JSON válido com este schema:
{
  "title": "Título do artigo",
  "summary": "Resumo em uma ou duas frases",
  "content": "Conteúdo completo em markdown"
}`

	userMsg := body.Prompt
	if body.Title != "" {
		userMsg = fmt.Sprintf("Título desejado: %s\n\n%s", body.Title, body.Prompt)
	}

	raw, err := h.llm.CallChatWithSystem(context.Background(), integration, system, userMsg, true)
	if err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "falha ao gerar artigo: "+err.Error())
	}

	var result struct {
		Title   string `json:"title"`
		Summary string `json:"summary"`
		Content string `json:"content"`
	}
	if err := json.Unmarshal([]byte(raw), &result); err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, "falha ao interpretar resposta da IA")
	}

	return c.JSON(result)
}

// ─── Help Center Config ───────────────────────────────────────────────────────

func appURL() string {
	if u := os.Getenv("APP_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return ""
}

// UploadHeroImage POST /v1/helpdesk/articles/upload-hero (multipart "file")
// Sobe uma imagem de cover/hero pro bucket e devolve URL pública. UI
// usa pra setar HeroImageURL no artigo.
//
// Aceita imagens até 5MB. Sem isso o user precisava colar uma URL
// externa, sem controle de retenção/cdn.
func (h *HelpDeskHandler) UploadHeroImage(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}
	if storage.GlobalStorage == nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "storage não configurado — admin precisa setar MinIO/S3")
	}
	fh, err := c.FormFile("file")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "campo 'file' é obrigatório"})
	}
	if fh.Size > 5*1024*1024 {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{"error": "imagem deve ter até 5MB"})
	}
	mime := fh.Header.Get("Content-Type")
	if !strings.HasPrefix(mime, "image/") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "apenas imagens são permitidas"})
	}
	f, err := fh.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao abrir upload"})
	}
	defer f.Close()
	data := make([]byte, fh.Size)
	if _, err := f.Read(data); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "erro ao ler upload"})
	}

	ext := storage.MimeToExt(mime)
	if ext == "" {
		ext = "bin"
	}
	objectName := fmt.Sprintf("helpdesk/%s/heros/%s.%s", wsID.String(), uuid.New().String(), ext)
	url, err := storage.GlobalStorage.UploadBytes(c.Context(), objectName, data, mime)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "falha no upload: " + err.Error()})
	}
	return c.JSON(fiber.Map{"url": url, "object_name": objectName})
}

// GetConfig GET /v1/helpdesk/config
func (h *HelpDeskHandler) GetConfig(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	var ws models.Workspace
	if err := h.db.Where("id = ?", wsID).Select("id,slug,name").First(&ws).Error; err != nil {
		return fiber.NewError(fiber.StatusNotFound, "workspace não encontrado")
	}

	var cfg models.HelpDeskConfig
	if err := h.db.Where("workspace_id = ?", wsID).First(&cfg).Error; err != nil {
		cfg = models.HelpDeskConfig{
			WorkspaceID:   wsID,
			Title:         ws.Name + " · Central de Ajuda",
			PrimaryColor:  "#00d46a",
			WidgetEnabled: true,
		}
		h.db.Create(&cfg)
	}

	slug := firstNonEmpty(cfg.CustomSlug, ws.Slug)
	publicURL := ""
	if u := appURL(); u != "" {
		publicURL = u + "/help/" + slug
	}

	return c.JSON(fiber.Map{
		"config":         cfg,
		"workspace_slug": ws.Slug,
		"effective_slug": slug,
		"public_url":     publicURL,
	})
}

// UpdateConfig PUT /v1/helpdesk/config
func (h *HelpDeskHandler) UpdateConfig(c *fiber.Ctx) error {
	wsID, err := workspaceIDFromCtx(c)
	if err != nil {
		return fiber.NewError(fiber.StatusUnauthorized, "workspace_id obrigatório")
	}

	var cfg models.HelpDeskConfig
	if err := h.db.Where("workspace_id = ?", wsID).First(&cfg).Error; err != nil {
		cfg = models.HelpDeskConfig{WorkspaceID: wsID, PrimaryColor: "#00d46a", WidgetEnabled: true}
		h.db.Create(&cfg)
	}

	var body map[string]interface{}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	delete(body, "id")
	delete(body, "workspace_id")

	// Validate custom_slug uniqueness if changing
	if slug, ok := body["custom_slug"].(string); ok && slug != "" && slug != cfg.CustomSlug {
		var count int64
		h.db.Model(&models.HelpDeskConfig{}).
			Where("custom_slug = ? AND workspace_id != ?", slug, wsID).
			Count(&count)
		if count > 0 {
			return fiber.NewError(fiber.StatusConflict, "slug já em uso")
		}
	}

	if err := h.db.Model(&cfg).Updates(body).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(cfg)
}

// ─── Public endpoints ─────────────────────────────────────────────────────────

// lookupWorkspaceBySlug resolves by workspace.slug OR HelpDeskConfig.custom_slug.
func (h *HelpDeskHandler) lookupWorkspaceBySlug(slug string) (*models.Workspace, error) {
	var ws models.Workspace
	// Try workspace slug first
	if err := h.db.Where("slug = ?", slug).First(&ws).Error; err == nil {
		return &ws, nil
	}
	// Fallback: custom_slug in helpdesk configs
	var cfg models.HelpDeskConfig
	if err := h.db.Where("custom_slug = ?", slug).First(&cfg).Error; err != nil {
		return nil, fmt.Errorf("workspace not found for slug %q", slug)
	}
	if err := h.db.Where("id = ?", cfg.WorkspaceID).First(&ws).Error; err != nil {
		return nil, err
	}
	return &ws, nil
}

// PublicGetConfig GET /v1/public/helpdesk/:workspace_slug/config
func (h *HelpDeskHandler) PublicGetConfig(c *fiber.Ctx) error {
	ws, err := h.lookupWorkspaceBySlug(c.Params("workspace_slug"))
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "help center não encontrado")
	}

	var cfg models.HelpDeskConfig
	if err := h.db.Where("workspace_id = ?", ws.ID).First(&cfg).Error; err != nil {
		// Return default config
		return c.JSON(fiber.Map{
			"title":         ws.Name + " · Central de Ajuda",
			"description":   "",
			"primary_color": "#00d46a",
			"logo_url":      "",
			"widget_enabled": true,
		})
	}

	// Count published articles for meta
	var articleCount int64
	h.db.Model(&models.HelpDeskArticle{}).
		Where("workspace_id = ? AND status = ?", ws.ID, models.ArticlePublished).
		Count(&articleCount)

	resp := fiber.Map{
		"title":          cfg.Title,
		"description":    cfg.Description,
		"primary_color":  cfg.PrimaryColor,
		"logo_url":       cfg.LogoURL,
		"widget_enabled": cfg.WidgetEnabled,
		"article_count":  articleCount,
		"workspace_name": ws.Name,
	}

	// Resolve webchat token so the public page can embed the floating widget
	if cfg.WebchatInstanceID != nil {
		var inst models.Instance
		if err := h.db.Select("token").Where("id = ?", cfg.WebchatInstanceID).First(&inst).Error; err == nil {
			resp["webchat_token"] = inst.Token
		}
	}

	return c.JSON(resp)
}

// PublicListArticles GET /v1/public/helpdesk/:workspace_slug/articles?q=&category=
func (h *HelpDeskHandler) PublicListArticles(c *fiber.Ctx) error {
	ws, err := h.lookupWorkspaceBySlug(c.Params("workspace_slug"))
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "workspace não encontrado")
	}

	query := h.db.Model(&models.HelpDeskArticle{}).
		Where("workspace_id = ? AND status = ?", ws.ID, models.ArticlePublished)

	if q := c.Query("q"); q != "" {
		like := "%" + q + "%"
		query = query.Where("title ILIKE ? OR summary ILIKE ? OR content ILIKE ?", like, like, like)
	}
	if cat := c.Query("category"); cat != "" {
		query = query.Where("category_id = (SELECT id FROM help_desk_categories WHERE workspace_id = ? AND (slug = ? OR name ILIKE ?) LIMIT 1)", ws.ID, cat, cat)
	}

	var articles []models.HelpDeskArticle
	if err := query.Order("updated_at DESC").Find(&articles).Error; err != nil {
		return fiber.NewError(fiber.StatusInternalServerError, err.Error())
	}
	return c.JSON(articles)
}

// PublicGetArticle GET /v1/public/helpdesk/:workspace_slug/articles/:slug
//
// Tenta resolver o artigo por slug exato; se não achar, tenta por ID
// (UUID), depois fuzzy LIKE pra cobrir casos de slug renomeado. Sempre
// exige status='published' — rascunhos nunca são públicos.
func (h *HelpDeskHandler) PublicGetArticle(c *fiber.Ctx) error {
	ws, err := h.lookupWorkspaceBySlug(c.Params("workspace_slug"))
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "workspace não encontrado")
	}

	identifier := c.Params("slug")
	var article models.HelpDeskArticle

	// 1. Slug exato
	q := h.db.Where("workspace_id = ? AND status = ?", ws.ID, models.ArticlePublished)
	if err := q.Where("slug = ?", identifier).First(&article).Error; err == nil {
		h.db.Model(&article).UpdateColumn("view_count", gorm.Expr("view_count + 1"))
		return c.JSON(article)
	}

	// 2. UUID — quando o front linka pelo id (preview do editor pode
	// fazer isso antes do user setar slug).
	if id, perr := uuid.Parse(identifier); perr == nil {
		if err := h.db.Where("workspace_id = ? AND id = ? AND status = ?",
			ws.ID, id, models.ArticlePublished).First(&article).Error; err == nil {
			h.db.Model(&article).UpdateColumn("view_count", gorm.Expr("view_count + 1"))
			return c.JSON(article)
		}
	}

	// 3. Fuzzy ILIKE — slug pode ter sido renomeado depois de
	// publicar; tenta encontrar algo com o prefixo. Só pega o
	// primeiro pra evitar ambiguidade.
	if err := h.db.Where("workspace_id = ? AND status = ? AND slug ILIKE ?",
		ws.ID, models.ArticlePublished, identifier+"%").
		Order("updated_at DESC").
		First(&article).Error; err == nil {
		h.db.Model(&article).UpdateColumn("view_count", gorm.Expr("view_count + 1"))
		return c.JSON(article)
	}

	return fiber.NewError(fiber.StatusNotFound, "artigo não encontrado ou não publicado")
}

// PublicAsk POST /v1/public/helpdesk/:workspace_slug/ask
func (h *HelpDeskHandler) PublicAsk(c *fiber.Ctx) error {
	ws, err := h.lookupWorkspaceBySlug(c.Params("workspace_slug"))
	if err != nil {
		return fiber.NewError(fiber.StatusNotFound, "workspace não encontrado")
	}

	var body struct {
		Question string `json:"question"`
	}
	if err := c.BodyParser(&body); err != nil {
		return fiber.NewError(fiber.StatusBadRequest, err.Error())
	}
	if body.Question == "" {
		return fiber.NewError(fiber.StatusBadRequest, "question é obrigatória")
	}

	// Find top 5 matching published articles.
	like := "%" + body.Question + "%"
	var articles []models.HelpDeskArticle
	h.db.Where("workspace_id = ? AND status = ? AND (title ILIKE ? OR content ILIKE ? OR summary ILIKE ?)",
		ws.ID, models.ArticlePublished, like, like, like).
		Limit(5).Find(&articles)

	if len(articles) == 0 {
		return c.JSON(fiber.Map{
			"answer":  "Não encontrei artigos relacionados à sua pergunta.",
			"sources": []interface{}{},
		})
	}

	// Find active LLM integration for the workspace.
	var integration models.UserIntegration
	err = h.db.
		Joins("JOIN user_workspaces uw ON uw.user_id = user_integrations.user_id").
		Where("uw.workspace_id = ? AND user_integrations.is_active = true", ws.ID).
		First(&integration).Error
	if err != nil {
		// Return articles without LLM answer.
		type source struct {
			ID    uuid.UUID `json:"id"`
			Title string    `json:"title"`
			Slug  string    `json:"slug"`
		}
		sources := make([]source, len(articles))
		for i, a := range articles {
			sources[i] = source{ID: a.ID, Title: a.Title, Slug: a.Slug}
		}
		return c.JSON(fiber.Map{
			"answer":  "Veja os artigos relacionados abaixo.",
			"sources": sources,
		})
	}

	// Build context from articles.
	var sb strings.Builder
	for _, a := range articles {
		sb.WriteString(fmt.Sprintf("# %s\n%s\n\n", a.Title, a.Content))
	}
	articleContext := sb.String()
	if len(articleContext) > 8000 {
		articleContext = articleContext[:8000]
	}

	system := `Você é um assistente de suporte. Use SOMENTE os artigos fornecidos abaixo para responder à pergunta do usuário de forma clara e direta. Se a resposta não estiver nos artigos, diga que não encontrou informações suficientes.

Artigos disponíveis:
` + articleContext

	answer, err := h.llm.CallChatWithSystem(context.Background(), &integration, system, body.Question, false)
	if err != nil {
		answer = "Não foi possível processar sua pergunta no momento."
	}

	type source struct {
		ID    uuid.UUID `json:"id"`
		Title string    `json:"title"`
		Slug  string    `json:"slug"`
	}
	sources := make([]source, len(articles))
	for i, a := range articles {
		sources[i] = source{ID: a.ID, Title: a.Title, Slug: a.Slug}
	}

	return c.JSON(fiber.Map{
		"answer":  answer,
		"sources": sources,
	})
}
