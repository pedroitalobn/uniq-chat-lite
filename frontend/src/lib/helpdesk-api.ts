import api from "./api";

export interface HelpDeskCategory {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  icon: string;
  slug: string;
  position: number;
  articles?: HelpDeskArticle[];
  article_count?: number;
  created_at: string;
  updated_at: string;
}

export interface HelpDeskArticle {
  id: string;
  workspace_id: string;
  category_id?: string;
  title: string;
  slug: string;
  summary: string;
  /** URL da imagem hero (opcional) renderizada no topo do artigo. */
  hero_image_url?: string;
  /** HTML do corpo (Tiptap). Antes era markdown — Markdown legacy é exibido como texto e re-salvo como HTML quando o editor abre. */
  content: string;
  status: "draft" | "published" | "archived";
  view_count: number;
  author_id?: string;
  created_at: string;
  updated_at: string;
  category?: HelpDeskCategory;
}

export interface WebChatConfig {
  id: string;
  instance_id: string;
  display_name: string;
  greeting: string;
  primary_color: string;
  position: "bottom-right" | "bottom-left";
  avatar_url: string;
  whatsapp_redirect_number: string;
  help_desk_enabled: boolean;
  created_at: string;
  updated_at: string;
}

function wsHeader(workspaceId?: string) {
  return workspaceId ? { "X-Workspace-ID": workspaceId } : {};
}

export interface HelpDeskConfig {
  id: string;
  workspace_id: string;
  title: string;
  description: string;
  custom_slug: string;
  primary_color: string;
  logo_url: string;
  webchat_instance_id?: string;
  widget_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface HelpDeskConfigResponse {
  config: HelpDeskConfig;
  workspace_slug: string;
  effective_slug: string;
  public_url: string;
}

// IMPORTANTE: TODAS as rotas /v1/helpdesk/* exigem o header X-Workspace-ID.
// O middleware do backend não popula c.Locals("workspace_id") pra esse
// chain, então sem o header todo handler retorna 401 "workspace_id não
// encontrado em context". Antes só list/create/config passavam o header
// — publish/update/delete/get caíam em 401 silencioso, fazendo parecer
// que o "Publicar" no dashboard não funcionava (na real era 401 que o
// front engolia em catch genérico).
export const helpDeskApi = {
  listCategories: (workspaceId?: string) =>
    api.get<HelpDeskCategory[]>("/v1/helpdesk/categories", { headers: wsHeader(workspaceId) }),
  createCategory: (data: Partial<HelpDeskCategory>, workspaceId?: string) =>
    api.post<HelpDeskCategory>("/v1/helpdesk/categories", data, { headers: wsHeader(workspaceId) }),
  updateCategory: (id: string, data: Partial<HelpDeskCategory>, workspaceId?: string) =>
    api.patch<HelpDeskCategory>(`/v1/helpdesk/categories/${id}`, data, { headers: wsHeader(workspaceId) }),
  deleteCategory: (id: string, workspaceId?: string) =>
    api.delete(`/v1/helpdesk/categories/${id}`, { headers: wsHeader(workspaceId) }),

  listArticles: (
    params?: { category_id?: string; status?: string; q?: string },
    workspaceId?: string,
  ) =>
    api.get<HelpDeskArticle[]>("/v1/helpdesk/articles", {
      params,
      headers: wsHeader(workspaceId),
    }),
  createArticle: (data: Partial<HelpDeskArticle>, workspaceId?: string) =>
    api.post<HelpDeskArticle>("/v1/helpdesk/articles", data, { headers: wsHeader(workspaceId) }),
  getArticle: (id: string, workspaceId?: string) =>
    api.get<HelpDeskArticle>(`/v1/helpdesk/articles/${id}`, { headers: wsHeader(workspaceId) }),
  updateArticle: (id: string, data: Partial<HelpDeskArticle>, workspaceId?: string) =>
    api.patch<HelpDeskArticle>(`/v1/helpdesk/articles/${id}`, data, { headers: wsHeader(workspaceId) }),
  deleteArticle: (id: string, workspaceId?: string) =>
    api.delete(`/v1/helpdesk/articles/${id}`, { headers: wsHeader(workspaceId) }),
  publishArticle: (id: string, workspaceId?: string) =>
    api.post<HelpDeskArticle>(`/v1/helpdesk/articles/${id}/publish`, undefined, { headers: wsHeader(workspaceId) }),
  generateArticle: (
    data: { prompt: string; category_id?: string },
    workspaceId?: string,
  ) =>
    api.post<{ title: string; content: string; summary: string }>(
      "/v1/helpdesk/articles/generate",
      data,
      { headers: wsHeader(workspaceId) },
    ),
  getConfig: (workspaceId?: string) =>
    api.get<HelpDeskConfigResponse>("/v1/helpdesk/config", { headers: wsHeader(workspaceId) }),
  updateConfig: (data: Partial<HelpDeskConfig>, workspaceId?: string) =>
    api.put<HelpDeskConfig>("/v1/helpdesk/config", data, { headers: wsHeader(workspaceId) }),
  uploadHeroImage: (file: File, workspaceId?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post<{ url: string; object_name: string }>(
      "/v1/helpdesk/articles/upload-hero",
      fd,
      { headers: { ...wsHeader(workspaceId), "Content-Type": "multipart/form-data" } },
    );
  },
};

export const webChatApi = {
  getConfig: (instanceId: string) =>
    api.get<WebChatConfig>(`/v1/instances/${instanceId}/webchat`),
  upsertConfig: (instanceId: string, data: Partial<WebChatConfig>) =>
    api.put<WebChatConfig>(`/v1/instances/${instanceId}/webchat`, data),
  getSnippet: (instanceId: string) =>
    api.get<{ snippet: string }>(`/v1/instances/${instanceId}/webchat/snippet`),
};
