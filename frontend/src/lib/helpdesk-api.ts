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

export const helpDeskApi = {
  listCategories: (workspaceId?: string) =>
    api.get<HelpDeskCategory[]>("/v1/helpdesk/categories", { headers: wsHeader(workspaceId) }),
  createCategory: (data: Partial<HelpDeskCategory>, workspaceId?: string) =>
    api.post<HelpDeskCategory>("/v1/helpdesk/categories", data, { headers: wsHeader(workspaceId) }),
  updateCategory: (id: string, data: Partial<HelpDeskCategory>) =>
    api.patch<HelpDeskCategory>(`/v1/helpdesk/categories/${id}`, data),
  deleteCategory: (id: string) => api.delete(`/v1/helpdesk/categories/${id}`),

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
  getArticle: (id: string) => api.get<HelpDeskArticle>(`/v1/helpdesk/articles/${id}`),
  updateArticle: (id: string, data: Partial<HelpDeskArticle>) =>
    api.patch<HelpDeskArticle>(`/v1/helpdesk/articles/${id}`, data),
  deleteArticle: (id: string) => api.delete(`/v1/helpdesk/articles/${id}`),
  publishArticle: (id: string) =>
    api.post<HelpDeskArticle>(`/v1/helpdesk/articles/${id}/publish`),
  generateArticle: (
    data: { prompt: string; category_id?: string },
    workspaceId?: string,
  ) =>
    api.post<{ title: string; content: string; summary: string }>(
      "/v1/helpdesk/articles/generate",
      data,
      { headers: wsHeader(workspaceId) },
    ),
};

export const webChatApi = {
  getConfig: (instanceId: string) =>
    api.get<WebChatConfig>(`/v1/instances/${instanceId}/webchat`),
  upsertConfig: (instanceId: string, data: Partial<WebChatConfig>) =>
    api.put<WebChatConfig>(`/v1/instances/${instanceId}/webchat`, data),
  getSnippet: (instanceId: string) =>
    api.get<{ snippet: string }>(`/v1/instances/${instanceId}/webchat/snippet`),
};
