import axios from "axios";
import { getSession } from "next-auth/react";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080",
  withCredentials: true,
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
});

let memoryToken: string | null = null;
let cachedSession: { accessToken?: string } | null = null;
let sessionFetchPromise: Promise<{ accessToken?: string }> | null = null;
let isRefreshing = false;
let refreshSubscribers: ((token: string) => void)[] = [];

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

// Cache session fetch to avoid multiple concurrent calls
async function getCachedSession() {
  if (cachedSession?.accessToken) {
    return cachedSession;
  }

  if (sessionFetchPromise) {
    return sessionFetchPromise;
  }

  const sessionStart = performance.now();
  sessionFetchPromise = getSession().then((session) => {
    cachedSession = session;
    if (session?.accessToken) {
      memoryToken = session.accessToken;
    }
    return session;
  }).finally(() => {
    const elapsed = Math.round(performance.now() - sessionStart);
    if (elapsed > 500) {
      console.warn(`[api] getSession slow: ${elapsed}ms`);
    }
    sessionFetchPromise = null;
  });

  return sessionFetchPromise;
}

async function getSessionWithTimeout(timeoutMs = 1200) {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const session = await Promise.race([getCachedSession(), timeout]);
  return session as { accessToken?: string } | null;
}

// Attach JWT token from session or memory
api.interceptors.request.use(async (config) => {
  const startedAt = performance.now();
  (config as any).metadata = { startedAt };

  if (memoryToken) {
    config.headers.Authorization = `Bearer ${memoryToken}`;
    return config;
  }

  // Do not block requests too long waiting for /v1/auth/session
  const session = await getSessionWithTimeout(1200);
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }

  return config;
});

// Auto-refresh on 401 with concurrency lock
api.interceptors.response.use(
  (res) => {
    const startedAt = (res.config as any)?.metadata?.startedAt;
    if (startedAt) {
      const elapsed = Math.round(performance.now() - startedAt);
      if (elapsed > 1200) {
        console.warn(`[api] slow request ${res.config.method?.toUpperCase()} ${res.config.url}: ${elapsed}ms`);
      }
    }
    return res;
  },
  async (error) => {
    const originalRequest = error.config;

    if (originalRequest?.metadata?.startedAt) {
      const elapsed = Math.round(performance.now() - originalRequest.metadata.startedAt);
      if (elapsed > 1200) {
        const code = error?.code || "UNKNOWN";
        const message = error?.message || "unknown error";
        const baseURL = originalRequest?.baseURL || "";
        console.warn(`[api] failed/slow request ${originalRequest.method?.toUpperCase()} ${originalRequest.url}: ${elapsed}ms status=${error.response?.status || "ERR"} code=${code} msg=${message} base=${baseURL}`);
      }
    }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // If already refreshing, wait for the new token
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshSubscribers.push((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          });
        });
      }

      isRefreshing = true;
      const refreshStart = performance.now();
      try {
        const refresh = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        const refreshElapsed = Math.round(performance.now() - refreshStart);
        if (refreshElapsed > 500) {
          console.warn(`[api] refresh token slow: ${refreshElapsed}ms`);
        }

        const newToken = refresh.data.access_token;
        memoryToken = newToken;

        isRefreshing = false;
        onRefreshed(newToken);

        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        memoryToken = null;
        cachedSession = null;
        refreshSubscribers = [];
        window.location.href = "/login";
        return Promise.reject(refreshError);
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ─── Typed API helpers ────────────────────────────────────────────────────────

export const authApi = {
  login: (identifier: string, password: string) =>
    api.post("/auth/login", { identifier, password }),
  loginWithKey: (anthropicApiKey: string) =>
    api.post("/auth/login", { anthropic_api_key: anthropicApiKey }),
  register: (data: { name: string; email: string; username?: string; password: string }) =>
    api.post("/auth/register", data),
  validateKey: (anthropicApiKey: string) =>
    api.post("/auth/validate-key", { anthropic_api_key: anthropicApiKey }),
  me: () => api.get("/auth/me"),
  updateMe: (data: { name?: string; username?: string }) => api.put("/auth/me", data),
  changePassword: (current_password: string, new_password: string) =>
    api.post("/auth/change-password", { current_password, new_password }),
  logout: () => api.post("/auth/logout"),
  refresh: () => api.post("/auth/refresh"),
};

export const serversApi = {
  list: (workspaceId?: string) => api.get("/v1/servers", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  get: (id: string) => api.get(`/v1/servers/${id}`),
  create: (data: { name: string; slug?: string; description?: string; workspace_id?: string }) =>
    api.post("/v1/servers", data),
  update: (id: string, data: {
    name?: string;
    description?: string;
    is_active?: boolean;
    webhook_url?: string;
    apply_webhook?: boolean;
  }) => api.put(`/v1/servers/${id}`, data),
  delete: (id: string) => api.delete(`/v1/servers/${id}`),
  instances: (id: string) => api.get(`/v1/servers/${id}/instances`),
  stats: (id: string) => api.get(`/v1/servers/${id}/stats`),
  action: (id: string, action: string) => api.post(`/v1/servers/${id}/actions`, { action }),
  // Proxy do server — todas as instâncias vinculadas compartilham.
  getProxy: (id: string) => api.get(`/v1/servers/${id}/proxy`),
  setProxy: (id: string, proxyId: string | null) =>
    api.put(`/v1/servers/${id}/proxy`, { proxy_id: proxyId }),
  deleteProxy: (id: string) => api.delete(`/v1/servers/${id}/proxy`),
  testProxy: (id: string) => api.post(`/v1/servers/${id}/proxy/test`),
};

export const channelsApi = {
  list: () => api.get("/v1/channels"),
};

// Catálogo de proxies (plataforma + próprios do usuário)
export const proxiesApi = {
  listAvailable: () => api.get("/v1/proxies"),
  listMine: () => api.get("/v1/proxies/mine"),
  create: (data: {
    name: string;
    country?: string;
    proxy_type?: "http" | "https" | "socks5";
    host: string;
    port: number;
    username?: string;
    password?: string;
  }) => api.post("/v1/proxies", data),
  update: (id: string, data: Partial<{
    name: string;
    country: string;
    proxy_type: "http" | "https" | "socks5";
    host: string;
    port: number;
    username: string;
    password: string;
  }>) => api.put(`/v1/proxies/${id}`, data),
  remove: (id: string) => api.delete(`/v1/proxies/${id}`),
  test: (id: string) => api.post(`/v1/proxies/${id}/test`),
  testInline: (data: {
    proxy_type?: "http" | "https" | "socks5";
    host: string;
    port: number;
    username?: string;
    password?: string;
  }) => api.post("/v1/proxies/test-inline", data),
};

export const instancesApi = {
  list: (channel?: string, workspaceId?: string) => {
    const params: Record<string, string> = {};
    if (channel) params.channel = channel;
    if (workspaceId) params.workspace_id = workspaceId;
    return api.get("/v1/instances", { params: Object.keys(params).length ? params : undefined });
  },
  get: (id: string) => api.get(`/v1/instances/${id}`),
  create: (name: string, channel?: string, serverId?: string, token?: string, workspaceId?: string) =>
    api.post("/v1/instances", {
      name,
      channel: channel || "whatsapp",
      server_id: serverId || undefined,
      token: token || undefined,
      workspace_id: workspaceId || undefined,
    }),
  delete: (id: string) => api.delete(`/v1/instances/${id}`),
  getQR: (id: string) => api.get(`/v1/instances/${id}/qr`),
  getPairingCode: (id: string, phoneNumber: string) =>
    api.post(`/v1/instances/${id}/pairing-code`, { phone_number: phoneNumber }),
  disconnect: (id: string) => api.post(`/v1/instances/${id}/disconnect`),
  reconnect: (id: string) => api.post(`/v1/instances/${id}/reconnect`),
  status: (id: string) => api.get(`/v1/instances/${id}/status`),
  profile: (id: string) => api.get(`/v1/instances/${id}/profile`),
  contactInfo: (id: string, data: { phone?: string; jid?: string }) =>
    api.post(`/v1/instances/${id}/contact/info`, data),
  contactAvatar: (id: string, data: { phone?: string; jid?: string }) =>
    api.post(`/v1/instances/${id}/contact/avatar`, data),
  regenerateToken: (id: string) => api.post(`/v1/instances/${id}/regenerate-token`),
  instagramLogin: (id: string, creds: { username: string; password: string }) =>
    api.post(`/v1/instances/${id}/instagram/login`, creds),
  instagramLogout: (id: string) => api.post(`/v1/instances/${id}/instagram/logout`),
  instagramSendDM: (id: string, data: { recipient: string; message: string }) =>
    api.post(`/v1/instances/${id}/instagram/dm`, data),
  instagramGetInbox: (id: string) => api.get(`/v1/instances/${id}/instagram/dm`),
  instagramFollow: (id: string, target: string) =>
    api.post(`/v1/instances/${id}/instagram/follow`, { target }),
  instagramUnfollow: (id: string, target: string) =>
    api.post(`/v1/instances/${id}/instagram/unfollow`, { target }),
  instagramPause: (id: string) => api.post(`/v1/instances/${id}/instagram/pause`),
  instagramResume: (id: string) => api.post(`/v1/instances/${id}/instagram/resume`),
  instagramPublishPost: (id: string, data: { image_url?: string; video_url?: string; caption?: string }) =>
    api.post(`/v1/instances/${id}/instagram/post`, data),
  instagramUploadStory: (id: string, data: { image_url?: string; video_url?: string; caption?: string }) =>
    api.post(`/v1/instances/${id}/instagram/story`, data),
  instagramGetUserMedia: (id: string, username: string) =>
    api.get(`/v1/instances/${id}/instagram/media`, { params: { username } }),
  instagramLikeMedia: (id: string, mediaId: string) =>
    api.post(`/v1/instances/${id}/instagram/like`, { media_id: mediaId }),
  instagramChallenge: (id: string, data: { api_path: string; code: string; method?: string }) =>
    api.post(`/v1/instances/${id}/instagram/challenge`, data),
  instagramChallengeResend: (id: string, data: { api_path: string; method?: string }) =>
    api.post(`/v1/instances/${id}/instagram/challenge/resend`, data),
};

export const settingsApi = {
  get: (id: string) => api.get(`/v1/instances/${id}/settings`),
  update: (id: string, data: Partial<{
    always_online: boolean;
    reject_calls: boolean;
    read_messages: boolean;
    ignore_groups: boolean;
    ignore_status: boolean;
    mcp_enabled: boolean;
  }>) => api.put(`/v1/instances/${id}/settings`, data),
};

// Read-only: a config efetiva da instância sai do server. Pra alterar, vai no server.
export const proxyApi = {
  get: (id: string) => api.get(`/v1/instances/${id}/proxy`),
  effective: (id: string) => api.get(`/v1/instances/${id}/proxy/effective`),
};

export const messagesApi = {
  list: (id: string, params?: { limit?: number; offset?: number }) =>
    api.get(`/v1/instances/${id}/messages`, { params }),
  sendText: (id: string, to: string, text: string) =>
    api.post(`/v1/instances/${id}/messages/text`, { to, text }),
  sendImage: (id: string, data: { to: string; url?: string; base64?: string; caption?: string }) =>
    api.post(`/v1/instances/${id}/messages/image`, data),
  sendDocument: (id: string, data: { to: string; url?: string; base64?: string; filename?: string; caption?: string }) =>
    api.post(`/v1/instances/${id}/messages/document`, data),
  sendAudio: (id: string, data: { to: string; url?: string; base64?: string }) =>
    api.post(`/v1/instances/${id}/messages/audio`, data),
  sendVideo: (id: string, data: { to: string; url?: string; base64?: string; caption?: string }) =>
    api.post(`/v1/instances/${id}/messages/video`, data),
  sendLocation: (id: string, data: { to: string; latitude: number; longitude: number; name?: string; address?: string }) =>
    api.post(`/v1/instances/${id}/messages/location`, data),
  sendContact: (id: string, data: { to: string; display_name: string; phone: string }) =>
    api.post(`/v1/instances/${id}/messages/contact`, data),
  sendReaction: (id: string, data: { to: string; message_id: string; emoji: string }) =>
    api.post(`/v1/instances/${id}/messages/reaction`, data),
  sendPoll: (id: string, data: { to: string; question: string; options: string[]; multiple_answers?: boolean }) =>
    api.post(`/v1/instances/${id}/messages/poll`, data),
  sendSticker: (id: string, data: { to: string; url?: string; base64?: string }) =>
    api.post(`/v1/instances/${id}/messages/sticker`, data),
  sendButtons: (id: string, data: { to: string; body: string; footer?: string; buttons: { id?: string; text: string; type?: "reply" | "url" | "call"; url?: string; phone?: string }[] }) =>
    api.post(`/v1/instances/${id}/messages/buttons`, data),
  sendTemplate: (id: string, data: { to: string; content: string; footer?: string; buttons: { display_text: string; type: "quickreply" | "url" | "call"; id?: string; url?: string; phone_number?: string }[] }) =>
    api.post(`/v1/instances/${id}/messages/template`, data),
  sendList: (id: string, data: { to: string; title?: string; description?: string; button_text: string; footer?: string; sections: { title: string; rows: { id: string; title: string; description?: string }[] }[] }) =>
    api.post(`/v1/instances/${id}/messages/list`, data),
  sendMenu: (id: string, data: { number: string; type: "button"|"list"|"poll"|"carousel"; text: string; choices: string[]; footerText?: string; listButton?: string; selectableCount?: number; imageButton?: string }) =>
    api.post(`/v1/instances/${id}/messages/menu`, data),
};

// inboxApi foi removido da aplicação. As rotas /v1/instances/:id/inbox/*
// continuam registradas no backend para clientes externos via API key, mas
// nenhuma página do dashboard consome essas URLs diretamente — tudo passa
// pelo fluxo de Conversations (conversationsApi).
//
// Se você vier da documentação antiga, as equivalências são:
//   inboxApi.getChats/getChat/getMessages  →  conversationsApi.list/get/timeline
//   inboxApi.sendMessage                   →  conversationsApi.sendMessage
//   inboxApi.markRead                      →  conversationsApi.markRead
//   inboxApi.updateContact                 →  crmApi.updateContact
//   inboxApi.updateMessage                 →  (sem substituto — usar PATCH direto)

/**
 * Legacy media upload — usado pelo composer quando for adicionado suporte
 * a mídia na página unificada. A rota /v1/instances/:id/media/upload
 * continua válida e genérica (não é parte do legacy inbox handler).
 */
export const mediaUploadApi = {
  upload: (instanceId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/v1/instances/${instanceId}/media/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};

// WABA (Meta WhatsApp Cloud API) — templates aprovados para o
// business. Usados quando a janela de 24h de atendimento humano fechou e
// o operador precisa iniciar conversa via HSM.
export const wabaApi = {
  templates: (instanceId: string) =>
    api.get(`/v1/instances/${instanceId}/waba/templates`),
};

export interface WebhookPayload {
  name?: string;
  url?: string;
  events?: string[];
  is_active?: boolean;
  ignore_groups?: boolean;
  ignore_self?: boolean;
  ignore_api_sent?: boolean;
  // RabbitMQ bridge
  rabbitmq_enabled?: boolean;
  amqp_url?: string;
  exchange?: string;
  routing_key?: string;
  // NATS bridge
  nats_enabled?: boolean;
  nats_url?: string;
  nats_subject?: string;
  nats_token?: string;
  // WebSocket bridge
  ws_enabled?: boolean;
  ws_client_url?: string;
  ws_client_token?: string;
}

export const webhooksApi = {
  list: (id: string) => api.get(`/v1/instances/${id}/webhooks`),
  create: (id: string, data: WebhookPayload) =>
    api.post(`/v1/instances/${id}/webhooks`, data),
  update: (id: string, webhookId: string, data: WebhookPayload) =>
    api.put(`/v1/instances/${id}/webhooks/${webhookId}`, data),
  delete: (id: string, webhookId: string) =>
    api.delete(`/v1/instances/${id}/webhooks/${webhookId}`),
};

export const globalWebhooksApi = {
  listEvents: () => api.get("/v1/webhooks/system/events"),
  list: () => api.get("/v1/webhooks/system"),
  create: (data: { name: string; url: string; events: string[]; is_active?: boolean }) =>
    api.post("/v1/webhooks/system", data),
  update: (id: string, data: { name?: string; url?: string; events?: string[]; is_active?: boolean }) =>
    api.put(`/v1/webhooks/system/${id}`, data),
  delete: (id: string) => api.delete(`/v1/webhooks/system/${id}`),
  test: (id: string) => api.post(`/v1/webhooks/system/${id}/test`, {}),
};

export const recoveryApi = {
  get: (id: string) => api.get(`/v1/instances/${id}/recovery`),
  snapshot: (id: string) => api.post(`/v1/instances/${id}/recovery/snapshot`),
  reset: (id: string) => api.post(`/v1/instances/${id}/recovery/reset`),
  setSchedule: (id: string, schedule: "" | "daily" | "weekly") =>
    api.put(`/v1/instances/${id}/recovery/schedule`, { schedule }),
};

export const mcpApi = {
  tools: (id: string) => api.get(`/v1/instances/${id}/mcp/tools`),
};

// ─── Workspace API ────────────────────────────────────────────────────────────

export const workspacesApi = {
  list: () => api.get("/v1/workspaces"),
  create: (data: { name: string }) => api.post("/v1/workspaces", data),
  get: (id: string) => api.get(`/v1/workspaces/${id}`),
  update: (id: string, data: { name: string }) => api.put(`/v1/workspaces/${id}`, data),
  delete: (id: string) => api.delete(`/v1/workspaces/${id}`),
  // Members
  listMembers: (id: string) => api.get(`/v1/workspaces/${id}/members`),
  updateMember: (id: string, memberId: string, data: { role_id: string | null }) =>
    api.patch(`/v1/workspaces/${id}/members/${memberId}`, data),
  removeMember: (id: string, memberId: string) => api.delete(`/v1/workspaces/${id}/members/${memberId}`),
  // Invites
  createInvite: (id: string, data: { email: string; role_id: string }) => api.post(`/v1/workspaces/${id}/invites`, data),
  listInvites: (id: string) => api.get(`/v1/workspaces/${id}/invites`),
  revokeInvite: (id: string, inviteId: string) => api.delete(`/v1/workspaces/${id}/invites/${inviteId}`),
  resendInvite: (id: string, inviteId: string) => api.post(`/v1/workspaces/${id}/invites/${inviteId}/resend`),
  acceptInvite: (token: string) => api.post(`/v1/workspaces/accept-invite/${token}`),
};

// ─── Roles API ────────────────────────────────────────────────────────────────

export const rolesApi = {
  list: (workspaceId: string) => api.get(`/v1/workspaces/${workspaceId}/roles`),
  get: (workspaceId: string, roleId: string) => api.get(`/v1/workspaces/${workspaceId}/roles/${roleId}`),
  create: (workspaceId: string, data: { name: string; description?: string; permission_ids: string[] }) =>
    api.post(`/v1/workspaces/${workspaceId}/roles`, data),
  update: (workspaceId: string, roleId: string, data: { name?: string; description?: string; permission_ids?: string[] }) =>
    api.put(`/v1/workspaces/${workspaceId}/roles/${roleId}`, data),
  delete: (workspaceId: string, roleId: string) => api.delete(`/v1/workspaces/${workspaceId}/roles/${roleId}`),
};

export const permissionsApi = {
  list: () => api.get("/v1/permissions"),
  seed: () => api.post("/v1/permissions/seed"),
};

export const apiKeysApi = {
  list: () => api.get("/v1/api-keys"),
  create: (name: string) => api.post("/v1/api-keys", { name }),
  delete: (id: string) => api.delete(`/v1/api-keys/${id}`),
};

export const groupsApi = {
  list: (instanceId: string) => api.get(`/v1/instances/${instanceId}/groups`),
  create: (instanceId: string, name: string, participants: string[]) =>
    api.post(`/v1/instances/${instanceId}/groups`, { name, participants }),
  get: (instanceId: string, jid: string) => api.get(`/v1/instances/${instanceId}/groups/${jid}`),
  update: (instanceId: string, jid: string, data: { name?: string; description?: string }) =>
    api.put(`/v1/instances/${instanceId}/groups/${jid}`, data),
  updateParticipants: (instanceId: string, jid: string, action: string, participants: string[]) =>
    api.post(`/v1/instances/${instanceId}/groups/${jid}/participants`, { action, participants }),
  inviteLink: (instanceId: string, jid: string, reset = false) =>
    api.get(`/v1/instances/${instanceId}/groups/${jid}/invite`, { params: { reset } }),
  leave: (instanceId: string, jid: string) =>
    api.post(`/v1/instances/${instanceId}/groups/${jid}/leave`),
};

export const crmApi = {
  listContacts: (params?: { search?: string; tag_id?: string; limit?: number; offset?: number; workspace_id?: string }) =>
    api.get("/v1/crm/contacts", { params }),
  createContact: (data: { name: string; phone: string; email?: string; notes?: string; avatar_url?: string; workspace_id?: string }) =>
    api.post("/v1/crm/contacts", data),
  getContact: (id: string) => api.get(`/v1/crm/contacts/${id}`),
  updateContact: (id: string, data: Partial<{ name: string; phone: string; email: string; notes: string; avatar_url: string; funnel: string; stage: string; journey: string; external_id: string; owner_id: string }>) =>
    api.put(`/v1/crm/contacts/${id}`, data),
  deleteContact: (id: string) => api.delete(`/v1/crm/contacts/${id}`),
  assignTags: (id: string, tagIds: string[]) => api.put(`/v1/crm/contacts/${id}/tags`, { tag_ids: tagIds }),
  listTags: (workspaceId?: string) => api.get("/v1/crm/tags", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  createTag: (name: string, color: string, workspaceId?: string) => api.post("/v1/crm/tags", { name, color, workspace_id: workspaceId }),
  deleteTag: (id: string) => api.delete(`/v1/crm/tags/${id}`),
  listFunnels: (workspaceId?: string) => api.get("/v1/crm/funnels", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  createFunnel: (data: { name: string; description?: string; color?: string; workspace_id?: string }) => api.post("/v1/crm/funnels", data),
  deleteFunnel: (id: string) => api.delete(`/v1/crm/funnels/${id}`),
  listFunnelStages: (funnelId: string) => api.get(`/v1/crm/funnels/${funnelId}/stages`),
  createFunnelStage: (funnelId: string, data: { name: string; color?: string }) => api.post(`/v1/crm/funnels/${funnelId}/stages`, data),
  deleteFunnelStage: (funnelId: string, stageId: string) => api.delete(`/v1/crm/funnels/${funnelId}/stages/${stageId}`),
  listJourneyOptions: () => api.get("/v1/crm/journey-options"),
  listStageOptions: (workspaceId?: string) => api.get("/v1/crm/stage-options", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  listFunnelOptions: (workspaceId?: string) => api.get("/v1/crm/funnel-options", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
};

export const campaignsApi = {
  list: (workspaceId?: string) => api.get("/v1/campaigns", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  segmentOptions: () => api.get("/v1/campaigns/segment-options"),
  segmentPreview: (data: {
    funnel?: string; stage?: string; journey?: string;
    tags?: string[]; owner?: string; external_id?: string;
  }) => api.post("/v1/campaigns/segment-preview", data),
  create: (data: {
    workspace_id?: string;
    instance_id: string;
    name: string;
    recipient_type: "contacts" | "groups" | "crm" | "segment";
    message_type?: string;
    message_text?: string;
    caption?: string;
    media_base64?: string;
    media_mime?: string;
    media_name?: string;
    start_date?: string;
    end_date?: string;
    times_total?: number;
    times_per_day?: number;
    schedule_hours?: string;
    delay_seconds?: number;
    recipients?: Array<{ phone: string; name?: string }>;
    segment_filter?: {
      funnel?: string; stage?: string; journey?: string;
      tags?: string[]; owner?: string; external_id?: string;
    };
  }) => api.post("/v1/campaigns", data),
  get: (id: string) => api.get(`/v1/campaigns/${id}`),
  start: (id: string) => api.post(`/v1/campaigns/${id}/start`),
  pause: (id: string) => api.post(`/v1/campaigns/${id}/pause`),
  cancel: (id: string) => api.post(`/v1/campaigns/${id}/cancel`),
  delete: (id: string) => api.delete(`/v1/campaigns/${id}`),
};

export const integrationsApi = {
  list: () => api.get("/v1/integrations"),
  create: (data: {
    provider: string;
    name: string;
    api_key: string;
    base_url?: string;
    models?: string[];
    config?: string;
  }) => api.post("/v1/integrations", data),
  update: (id: string, data: {
    name?: string;
    api_key?: string;
    base_url?: string;
    models?: string[];
    config?: string;
    is_active?: boolean;
  }) => api.put(`/v1/integrations/${id}`, data),
  delete: (id: string) => api.delete(`/v1/integrations/${id}`),
  test: (id: string) => api.post(`/v1/integrations/${id}/test`),
  // Claude OAuth (login com conta claude.ai — alternativa a API key)
  startClaudeOAuth: () => api.post("/v1/integrations/claude/oauth/start"),
  completeClaudeOAuth: (data: { code: string; state: string; name?: string }) =>
    api.post("/v1/integrations/claude/oauth/callback", data),
  refreshOAuth: (id: string) => api.post(`/v1/integrations/${id}/oauth/refresh`),
  // OpenRouter OAuth PKCE — devolve API key persistente vinculada à conta
  startOpenRouterOAuth: (callbackUrl?: string) =>
    api.post("/v1/integrations/openrouter/oauth/start", { callback_url: callbackUrl }),
  completeOpenRouterOAuth: (data: { code: string; state: string; name?: string }) =>
    api.post("/v1/integrations/openrouter/oauth/callback", data),
  getAgent: (instanceId: string) => api.get(`/v1/instances/${instanceId}/agent`),
  updateAgent: (instanceId: string, data: {
    integration_id?: string | null;
    model?: string;
    system_prompt?: string;
    agent_name?: string;
    identity?: string;
    objective?: string;
    communication_guidelines?: string;
    service_instructions?: string;
    restrictions?: string;
    knowledge_base?: string;
    faq?: Array<Record<string, unknown>>;
    variables?: Array<Record<string, unknown>>;
    voice?: Record<string, unknown>;
    skills?: Array<Record<string, unknown>>;
    app_access?: Array<Record<string, unknown>>;
    rag_enabled?: boolean;
    is_active?: boolean;
    webhook_url?: string;
    webhook_secret?: string;
    mcp_server_url?: string;
  }) => api.put(`/v1/instances/${instanceId}/agent`, data),
  uploadAgentAsset: (instanceId: string, file: File, category: "knowledge" | "faq" | "skill", name?: string) => {
    const form = new FormData();
    form.append("file", file);
    form.append("category", category);
    if (name) form.append("name", name);
    return api.post(`/v1/instances/${instanceId}/agent/assets`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  deleteAgentAsset: (instanceId: string, assetId: string) =>
    api.delete(`/v1/instances/${instanceId}/agent/assets/${assetId}`),
};

export const agentsApi = {
  chat: (
    message: string,
    integrationId?: string,
    model?: string,
    extras?: {
      rendered_text?: string;
      original_input?: string;
      mentions?: { type: string; id: string; label: string; meta?: Record<string, string> }[];
    },
  ) =>
    api.post("/v1/ai/chat", {
      message,
      integration_id: integrationId,
      model,
      rendered_text: extras?.rendered_text,
      original_input: extras?.original_input,
      mentions: extras?.mentions,
    }),
  stats: () => api.get("/v1/agent/stats"),
  activity: (limit?: number) => api.get("/v1/agent/activity", { params: limit ? { limit } : undefined }),
  instances: () => api.get("/v1/agent/instances"),
  stopExecution: (executionId: string) => api.post(`/v1/agent/executions/${executionId}/stop`),
};

export const journeysApi = {
  list: () => api.get("/v1/journeys"),
  create: (
    prompt: string,
    integrationId?: string,
    instanceId?: string,
    extras?: {
      rendered_text?: string;
      original_input?: string;
      mentions?: { type: string; id: string; label: string; meta?: Record<string, string> }[];
    },
  ) =>
    api.post("/v1/journeys", {
      prompt,
      integration_id: integrationId,
      instance_id: instanceId,
      rendered_text: extras?.rendered_text,
      original_input: extras?.original_input,
      mentions: extras?.mentions,
    }),
  createBlank: (data?: { name?: string; instance_id?: string }) =>
    api.post("/v1/journeys", { blank: true, name: data?.name, instance_id: data?.instance_id }),
  updateTrigger: (
    id: string,
    data: Partial<{
      name: string;
      trigger_type: string;
      trigger_filter: string;
      keywords: string[];
      group_jid: string;
      instance_id: string;
      response_mode: string;
    }>,
  ) => api.patch(`/v1/journeys/${id}/trigger`, data),
  get: (id: string) => api.get(`/v1/journeys/${id}`),
  updateStatus: (id: string, status: "active" | "paused") =>
    api.patch(`/v1/journeys/${id}/status`, { status }),
  delete: (id: string) => api.delete(`/v1/journeys/${id}`),
  executions: (id: string, limit?: number, offset?: number) =>
    api.get(`/v1/journeys/${id}/executions`, { params: { limit: limit || 20, offset: offset || 0 } }),
  // ─── Flow builder (canvas + LLM edit + simulator + templates) ─────────────
  updateFlow: (id: string, flow: { start_step?: string; steps: unknown[] }) =>
    api.patch(`/v1/journeys/${id}/flow`, flow),
  editWithLLM: (
    id: string,
    instruction: string,
    integrationId?: string,
    extras?: {
      rendered_text?: string;
      mentions?: { type: string; id: string; label: string; meta?: Record<string, string> }[];
    },
  ) =>
    api.post(`/v1/journeys/${id}/edit-llm`, {
      instruction,
      integration_id: integrationId,
      rendered_text: extras?.rendered_text,
      mentions: extras?.mentions,
    }),
  simulate: (id: string, message: string, contactName?: string) =>
    api.post(`/v1/journeys/${id}/simulate`, { message, contact_name: contactName }),
  listTemplates: () => api.get("/v1/journeys/templates"),
  createFromTemplate: (slug: string, instanceId?: string, name?: string) =>
    api.post(`/v1/journeys/from-template/${slug}`, { instance_id: instanceId, name }),
};

export const aiApi = {
  generate: (data: {
    integration_id: string;
    base_message: string;
    count?: number;
    tone?: string;
    context?: string;
  }) => api.post("/v1/ai/generate", data),
};

export const stripeApi = {
  plans: () => api.get("/v1/payments/plans"),
  createCheckout: (planId: string) => api.post("/v1/payments/checkout", { plan_id: planId }),
  subscription: () => api.get("/v1/payments/subscription"),
};

export const adminApi = {
  getStats: () => api.get("/v1/admin/stats"),
  listUsers: () => api.get("/v1/admin/users"),
  getProxyConfig: () => api.get("/v1/admin/proxy-config"),
  updateProxyConfig: (data: Record<string, unknown>) => api.put("/v1/admin/proxy-config", data),
  updateGlobalProxy: (data: Record<string, unknown>) => api.put("/v1/admin/proxy-config", data),
  deleteProxyConfig: (id: string) => api.delete(`/v1/admin/proxy-config/${id}`),
  deleteGlobalProxy: (id: string) => api.delete(`/v1/admin/proxy-config/${id}`),
  testGlobalProxy: (id?: string) => api.post("/v1/admin/proxy-test", id ? { id } : {}),
  testGlobalProxyInline: (data: {
    proxy_type?: string;
    host: string;
    port: number;
    username?: string;
    password?: string;
  }) => api.post("/v1/admin/proxy-test", data),
  getProxyStats: () => api.get("/v1/admin/proxy-stats"),
  createUser: (data: {
    name: string; email: string; username?: string;
    password: string; role?: string; plan_id?: string;
  }) => api.post("/v1/admin/users", data),
  updateUser: (id: string, data: Record<string, unknown>) =>
    api.put(`/v1/admin/users/${id}`, data),
  resetPassword: (id: string, password: string) =>
    api.post(`/v1/admin/users/${id}/reset-password`, { password }),
  deleteUser: (id: string) => api.delete(`/v1/admin/users/${id}`),
  listPlans: () => api.get("/v1/admin/plans"),
  createPlan: (data: Record<string, unknown>) => api.post("/v1/admin/plans", data),
  updatePlan: (id: string, data: Record<string, unknown>) =>
    api.put(`/v1/admin/plans/${id}`, data),
  getPaymentSettings: () => api.get("/v1/admin/payment-settings"),
  updatePaymentSettings: (data: Record<string, unknown>) =>
    api.put("/v1/admin/payment-settings", data),
  // Inspect/Support - list all servers and instances for super admin
  listAllServers: () => api.get("/v1/admin/inspect/servers"),
  listAllInstances: () => api.get("/v1/admin/inspect/instances"),
  getInstance: (id: string) => api.get(`/v1/admin/inspect/instances/${id}`),
  // Email settings
  getEmailSettings: () => api.get("/v1/admin/email-settings"),
  updateEmailSettings: (data: {
    api_key?: string;
    sender_email?: string;
    sender_name?: string;
    is_enabled?: boolean;
  }) => api.put("/v1/admin/email-settings", data),
  testEmail: (to: string) => api.post("/v1/admin/email-settings/test", { to }),
  listEmailTemplates: () => api.get("/v1/admin/email-templates"),
  getEmailTemplate: (slug: string) => api.get(`/v1/admin/email-templates/${slug}`),
  updateEmailTemplate: (slug: string, data: {
    subject?: string;
    html_content?: string;
    is_active?: boolean;
  }) => api.put(`/v1/admin/email-templates/${slug}`, data),
  testEmailTemplate: (slug: string, to: string) =>
    api.post(`/v1/admin/email-templates/${slug}/test`, { to }),
  getEmailLogs: (limit?: number, offset?: number) => 
    api.get("/v1/admin/email-logs", { params: { limit, offset } }),
};

export const plansApi = {
  list: () => api.get("/v1/payments/plans"),
  checkout: (data: { plan_id: string }) => api.post("/v1/payments/checkout", data),
  subscription: () => api.get("/v1/payments/subscription"),
};

// ─── Instagram ───────────────────────────────────────────────────────────────


// ─── TikTok ─────────────────────────────────────────────────────────────────

export const tiktokApi = {
  health: () => api.get("/v1/tiktok/health"),
  listAccounts: () => api.get("/v1/tiktok/accounts"),
  createAccount: (data: { username: string; password: string }) =>
    api.post("/v1/tiktok/accounts", data),
  getAccount: (id: string) => api.get(`/v1/tiktok/accounts/${id}`),
  deleteAccount: (id: string) => api.delete(`/v1/tiktok/accounts/${id}`),
  connect: (id: string) => api.post(`/v1/tiktok/accounts/${id}/connect`),
  disconnect: (id: string) => api.post(`/v1/tiktok/accounts/${id}/disconnect`),
  updateSettings: (id: string, data: {
    auto_reply?: boolean; ai_enabled?: boolean; integration_id?: string | null;
  }) => api.put(`/v1/tiktok/accounts/${id}/settings`, data),
  sendDM: (id: string, target: string, message: string) =>
    api.post(`/v1/tiktok/accounts/${id}/dm`, { target, message }),
  readDMs: (id: string) => api.get(`/v1/tiktok/accounts/${id}/dm`),
  follow: (id: string, target: string) =>
    api.post(`/v1/tiktok/accounts/${id}/follow`, { target }),
  unfollow: (id: string, target: string) =>
    api.post(`/v1/tiktok/accounts/${id}/unfollow`, { target }),
  scrapeFollowers: (id: string, target: string, limit?: number) =>
    api.post(`/v1/tiktok/accounts/${id}/scrape/followers`, { target, limit: limit || 100 }),
  scrapeHashtag: (id: string, hashtag: string, limit?: number) =>
    api.post(`/v1/tiktok/accounts/${id}/scrape/hashtag`, { hashtag, limit: limit || 100 }),
  listTargets: () => api.get("/v1/tiktok/targets"),
  listDMs: (accountId?: string) =>
    api.get("/v1/tiktok/dms", { params: accountId ? { account_id: accountId } : {} }),
};

// ─── Atendimento / Tickets ───────────────────────────────────────────────────
// All routes live under /v1/conversations and require X-Workspace-ID.
// Pass workspaceId as the first argument; it is sent in the header so RBAC
// middleware can enforce workspace-scoped permissions.

type HeaderMap = Record<string, string>;
function wsHeaders(workspaceId: string, extra?: HeaderMap): HeaderMap {
  return { "X-Workspace-ID": workspaceId, ...(extra || {}) };
}

export type ConversationStatus = "open" | "pending" | "resolved" | "closed" | "snoozed";
export type ConversationPriority = "low" | "normal" | "high" | "urgent";

export interface ConversationListParams {
  status?: ConversationStatus | ConversationStatus[];
  channel?: string;
  queue_id?: string | "none";
  assigned_user_id?: string | "me" | "none";
  contact_id?: string;
  priority?: ConversationPriority;
  is_archived?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

function buildListParams(p?: ConversationListParams): Record<string, string | number> {
  if (!p) return {};
  const out: Record<string, string | number> = {};
  if (p.status) out.status = Array.isArray(p.status) ? p.status.join(",") : p.status;
  if (p.channel) out.channel = p.channel;
  if (p.queue_id) out.queue_id = p.queue_id;
  if (p.assigned_user_id) out.assigned_user_id = p.assigned_user_id;
  if (p.contact_id) out.contact_id = p.contact_id;
  if (p.priority) out.priority = p.priority;
  if (p.is_archived !== undefined) out.is_archived = String(p.is_archived);
  if (p.q) out.q = p.q;
  if (p.limit) out.limit = p.limit;
  if (p.offset) out.offset = p.offset;
  return out;
}

export const conversationsApi = {
  list: (workspaceId: string, params?: ConversationListParams) =>
    api.get("/v1/conversations", { headers: wsHeaders(workspaceId), params: buildListParams(params) }),
  count: (workspaceId: string) =>
    api.get("/v1/conversations/count", { headers: wsHeaders(workspaceId) }),
  inboxStats: (workspaceId: string) =>
    api.get("/v1/conversations/inbox-stats", { headers: wsHeaders(workspaceId) }),
  backfill: (workspaceId: string, data?: { limit?: number; max_batches?: number }) =>
    api.post("/v1/conversations/backfill", data ?? {}, { headers: wsHeaders(workspaceId) }),
  /** Health probe — rota pública (sem permission), usada pelo UI pra
   *  diferenciar "backend antigo sem /v1/conversations" de "rota OK mas
   *  erro de tabela / permissão". */
  health: () => api.get("/v1/conversations/health"),
  get: (workspaceId: string, id: string) =>
    api.get(`/v1/conversations/${id}`, { headers: wsHeaders(workspaceId) }),
  timeline: (workspaceId: string, id: string, opts?: { before?: string; limit?: number }) =>
    api.get(`/v1/conversations/${id}/timeline`, {
      headers: wsHeaders(workspaceId),
      params: opts,
    }),
  patch: (workspaceId: string, id: string, data: {
    subject?: string;
    priority?: ConversationPriority;
    sub_status?: string;
    is_archived?: boolean;
    funnel_id?: string | null;
    stage_id?: string | null;
  }) => api.patch(`/v1/conversations/${id}`, data, { headers: wsHeaders(workspaceId) }),
  markRead: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/read`, {}, { headers: wsHeaders(workspaceId) }),
  sendMessage: (
    workspaceId: string,
    id: string,
    data: {
      body?: string;
      type?: string;
      media_url?: string;
      media_mime?: string;
      caption?: string;
      filename?: string;
      template_name?: string;
      template_language?: string;
      template_components?: Array<Record<string, unknown>>;
    },
  ) => api.post(`/v1/conversations/${id}/messages`, data, { headers: wsHeaders(workspaceId) }),
  sendTyping: (workspaceId: string, id: string, typing: boolean) =>
    api.post(`/v1/conversations/${id}/typing`, { typing }, { headers: wsHeaders(workspaceId) }),
  patchMessage: (
    workspaceId: string,
    id: string,
    msgId: string,
    data: { is_pinned?: boolean; is_favorite?: boolean; is_archived?: boolean; is_deleted?: boolean },
  ) => api.patch(`/v1/conversations/${id}/messages/${msgId}`, data, { headers: wsHeaders(workspaceId) }),
  assign: (workspaceId: string, id: string, userId?: string) =>
    api.post(`/v1/conversations/${id}/assign`, userId ? { user_id: userId } : {}, { headers: wsHeaders(workspaceId) }),
  unassign: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/unassign`, {}, { headers: wsHeaders(workspaceId) }),
  transfer: (workspaceId: string, id: string, data: { queue_id?: string; team_id?: string; user_id?: string; note?: string }) =>
    api.post(`/v1/conversations/${id}/transfer`, data, { headers: wsHeaders(workspaceId) }),
  resolve: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/resolve`, {}, { headers: wsHeaders(workspaceId) }),
  close: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/close`, {}, { headers: wsHeaders(workspaceId) }),
  reopen: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/reopen`, {}, { headers: wsHeaders(workspaceId) }),
  snooze: (workspaceId: string, id: string, until: string) =>
    api.post(`/v1/conversations/${id}/snooze`, { until }, { headers: wsHeaders(workspaceId) }),
  unsnooze: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/unsnooze`, {}, { headers: wsHeaders(workspaceId) }),
  enableBot: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/bot/enable`, {}, { headers: wsHeaders(workspaceId) }),
  disableBot: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/bot/disable`, {}, { headers: wsHeaders(workspaceId) }),

  // Notes
  listNotes: (workspaceId: string, id: string) =>
    api.get(`/v1/conversations/${id}/notes`, { headers: wsHeaders(workspaceId) }),
  createNote: (workspaceId: string, id: string, data: { body: string; mentioned?: string[]; is_pinned?: boolean }) =>
    api.post(`/v1/conversations/${id}/notes`, data, { headers: wsHeaders(workspaceId) }),
  updateNote: (workspaceId: string, id: string, noteId: string, data: { body?: string; is_pinned?: boolean }) =>
    api.patch(`/v1/conversations/${id}/notes/${noteId}`, data, { headers: wsHeaders(workspaceId) }),
  deleteNote: (workspaceId: string, id: string, noteId: string) =>
    api.delete(`/v1/conversations/${id}/notes/${noteId}`, { headers: wsHeaders(workspaceId) }),
};

export const departmentsApi = {
  list: (workspaceId: string) =>
    api.get("/v1/departments", { headers: wsHeaders(workspaceId) }),
  create: (workspaceId: string, data: {
    name: string; description?: string; color?: string; icon?: string; sort_order?: number;
  }) => api.post("/v1/departments", data, { headers: wsHeaders(workspaceId) }),
  patch: (workspaceId: string, id: string, data: Partial<{
    name: string; description: string; color: string; icon: string; is_active: boolean; sort_order: number;
  }>) => api.patch(`/v1/departments/${id}`, data, { headers: wsHeaders(workspaceId) }),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/v1/departments/${id}`, { headers: wsHeaders(workspaceId) }),
};

export const teamsApi = {
  list: (workspaceId: string, departmentId?: string) =>
    api.get("/v1/teams", { headers: wsHeaders(workspaceId), params: departmentId ? { department_id: departmentId } : undefined }),
  create: (workspaceId: string, data: {
    name: string; description?: string; department_id?: string; leader_user_id?: string;
  }) => api.post("/v1/teams", data, { headers: wsHeaders(workspaceId) }),
  patch: (workspaceId: string, id: string, data: Partial<{
    name: string; description: string; department_id: string | null; leader_user_id: string | null; is_active: boolean;
  }>) => api.patch(`/v1/teams/${id}`, data, { headers: wsHeaders(workspaceId) }),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/v1/teams/${id}`, { headers: wsHeaders(workspaceId) }),
  listMembers: (workspaceId: string, id: string) =>
    api.get(`/v1/teams/${id}/members`, { headers: wsHeaders(workspaceId) }),
  addMember: (workspaceId: string, id: string, data: { user_id: string; role?: string }) =>
    api.post(`/v1/teams/${id}/members`, data, { headers: wsHeaders(workspaceId) }),
  removeMember: (workspaceId: string, id: string, userId: string) =>
    api.delete(`/v1/teams/${id}/members/${userId}`, { headers: wsHeaders(workspaceId) }),
};

export type QueueAssignmentStrategy =
  | "round_robin"
  | "least_busy"
  | "load_balanced"
  | "manual"
  | "sticky_owner";

export const queuesApi = {
  list: (workspaceId: string, filters?: { department_id?: string; team_id?: string }) =>
    api.get("/v1/queues", { headers: wsHeaders(workspaceId), params: filters }),
  get: (workspaceId: string, id: string) =>
    api.get(`/v1/queues/${id}`, { headers: wsHeaders(workspaceId) }),
  create: (workspaceId: string, data: {
    name: string;
    description?: string;
    color?: string;
    department_id?: string;
    team_id?: string;
    assignment_strategy?: QueueAssignmentStrategy;
    max_concurrent_per_user?: number;
    auto_assign_on_open?: boolean;
    auto_close_after_hours?: number;
    reopen_window_minutes?: number;
    enable_chatbot?: boolean;
    chatbot_agent_id?: string;
    business_hours?: string;
    timezone?: string;
    off_hours_message?: string;
    first_response_sla_minutes?: number;
    resolution_sla_minutes?: number;
    priority?: number;
  }) => api.post("/v1/queues", data, { headers: wsHeaders(workspaceId) }),
  patch: (workspaceId: string, id: string, data: Record<string, unknown>) =>
    api.patch(`/v1/queues/${id}`, data, { headers: wsHeaders(workspaceId) }),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/v1/queues/${id}`, { headers: wsHeaders(workspaceId) }),
  stats: (workspaceId: string, id: string) =>
    api.get(`/v1/queues/${id}/stats`, { headers: wsHeaders(workspaceId) }),
  listMembers: (workspaceId: string, id: string) =>
    api.get(`/v1/queues/${id}/members`, { headers: wsHeaders(workspaceId) }),
  addMember: (workspaceId: string, id: string, data: { user_id: string; priority?: number }) =>
    api.post(`/v1/queues/${id}/members`, data, { headers: wsHeaders(workspaceId) }),
  updateMember: (workspaceId: string, id: string, userId: string, data: { can_receive?: boolean; priority?: number }) =>
    api.patch(`/v1/queues/${id}/members/${userId}`, data, { headers: wsHeaders(workspaceId) }),
  removeMember: (workspaceId: string, id: string, userId: string) =>
    api.delete(`/v1/queues/${id}/members/${userId}`, { headers: wsHeaders(workspaceId) }),
  listChannels: (workspaceId: string, id: string) =>
    api.get(`/v1/queues/${id}/channels`, { headers: wsHeaders(workspaceId) }),
  addChannel: (workspaceId: string, id: string, data: { instance_id: string; is_default?: boolean }) =>
    api.post(`/v1/queues/${id}/channels`, data, { headers: wsHeaders(workspaceId) }),
  removeChannel: (workspaceId: string, id: string, instanceId: string) =>
    api.delete(`/v1/queues/${id}/channels/${instanceId}`, { headers: wsHeaders(workspaceId) }),
};

export type PresenceStatus = "online" | "away" | "busy" | "offline";

export const presenceApi = {
  getMine: (workspaceId: string) =>
    api.get("/v1/me/presence", { headers: wsHeaders(workspaceId) }),
  updateMine: (workspaceId: string, data: {
    status?: PresenceStatus;
    status_message?: string;
    away_reason?: string;
    max_load?: number;
  }) => api.put("/v1/me/presence", data, { headers: wsHeaders(workspaceId) }),
  myWorkload: (workspaceId: string) =>
    api.get("/v1/me/workload", { headers: wsHeaders(workspaceId) }),
  listWorkspace: (workspaceId: string) =>
    api.get(`/v1/workspaces/${workspaceId}/presence`, { headers: wsHeaders(workspaceId) }),
};

// meApi returns info about the authenticated user for the active workspace
// (permission keys, presence, workload). For Fase 1 only the workspace
// membership and role.permissions slice from /workspaces/:id/members is
// available — we synthesize a "perm keys" array from it until a dedicated
// endpoint lands.
export const workspacePermissionsApi = {
  // Fetches the signed-in user's role + permissions inside a workspace.
  mine: async (workspaceId: string) => {
    const { data } = await api.get(`/v1/workspaces/${workspaceId}/members`);
    return data;
  },
};

export const quickRepliesApi = {
  list: (workspaceId: string, scope: "mine" | "workspace" | "all" = "all") =>
    api.get("/v1/quick-replies", { headers: wsHeaders(workspaceId), params: { scope } }),
  search: (workspaceId: string, q: string) =>
    api.get("/v1/quick-replies/search", { headers: wsHeaders(workspaceId), params: { q } }),
  create: (workspaceId: string, data: {
    shortcut?: string; title?: string; body: string;
    media_url?: string; media_type?: string; variables?: string[];
    department_id?: string; queue_id?: string; shared?: boolean;
  }) => api.post("/v1/quick-replies", data, { headers: wsHeaders(workspaceId) }),
  patch: (workspaceId: string, id: string, data: Partial<{
    shortcut: string; title: string; body: string;
    media_url: string; media_type: string;
    variables: string[]; is_active: boolean;
  }>) => api.patch(`/v1/quick-replies/${id}`, data, { headers: wsHeaders(workspaceId) }),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/v1/quick-replies/${id}`, { headers: wsHeaders(workspaceId) }),
  use: (workspaceId: string, id: string) =>
    api.post(`/v1/quick-replies/${id}/use`, {}, { headers: wsHeaders(workspaceId) }),
};

export const reportsApi = {
  overview: (workspaceId: string, params?: { from?: string; to?: string }) =>
    api.get("/v1/reports/overview", { headers: wsHeaders(workspaceId), params }),
  byQueue: (workspaceId: string, params?: { from?: string; to?: string }) =>
    api.get("/v1/reports/by-queue", { headers: wsHeaders(workspaceId), params }),
  byUser: (workspaceId: string, params?: { from?: string; to?: string }) =>
    api.get("/v1/reports/by-user", { headers: wsHeaders(workspaceId), params }),
  csat: (workspaceId: string, params?: { from?: string; to?: string }) =>
    api.get("/v1/reports/csat", { headers: wsHeaders(workspaceId), params }),
  sla: (workspaceId: string, params?: { from?: string; to?: string }) =>
    api.get("/v1/reports/sla", { headers: wsHeaders(workspaceId), params }),
};

export const csatApi = {
  listForConversation: (workspaceId: string, conversationId: string) =>
    api.get(`/v1/conversations/${conversationId}/csat`, { headers: wsHeaders(workspaceId) }),
  send: (workspaceId: string, conversationId: string) =>
    api.post(`/v1/conversations/${conversationId}/csat`, {}, { headers: wsHeaders(workspaceId) }),
  // Public endpoints (no auth) — used by the customer-facing /csat/:token page.
  getPublic: (token: string) => api.get(`/csat/${token}`),
  submitPublic: (token: string, data: { rating: number; comment?: string }) =>
    api.post(`/csat/${token}`, data),
};

// ─── CRM v2 ─────────────────────────────────────────────────────────────────
// Companies, Deals, Funnel views and Contact groups. All send X-Workspace-ID.

export type DealStatus = "open" | "won" | "lost" | "archived";
export type FunnelViewKind = "kanban" | "list" | "table" | "forecast";

export const companiesApi = {
  list: (workspaceId: string, params?: { q?: string; owner_id?: string; limit?: number; offset?: number }) =>
    api.get("/v1/crm/companies", { headers: wsHeaders(workspaceId), params }),
  get: (workspaceId: string, id: string) =>
    api.get(`/v1/crm/companies/${id}`, { headers: wsHeaders(workspaceId) }),
  create: (workspaceId: string, data: Record<string, unknown>) =>
    api.post("/v1/crm/companies", data, { headers: wsHeaders(workspaceId) }),
  patch: (workspaceId: string, id: string, data: Record<string, unknown>) =>
    api.patch(`/v1/crm/companies/${id}`, data, { headers: wsHeaders(workspaceId) }),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/v1/crm/companies/${id}`, { headers: wsHeaders(workspaceId) }),
  contacts: (workspaceId: string, id: string) =>
    api.get(`/v1/crm/companies/${id}/contacts`, { headers: wsHeaders(workspaceId) }),
  deals: (workspaceId: string, id: string) =>
    api.get(`/v1/crm/companies/${id}/deals`, { headers: wsHeaders(workspaceId) }),
};

export interface DealListParams {
  funnel_id?: string;
  stage_id?: string;
  status?: DealStatus | string;
  owner_id?: string | "me";
  contact_id?: string;
  company_id?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export const dealsApi = {
  list: (workspaceId: string, params?: DealListParams) =>
    api.get("/v1/crm/deals", { headers: wsHeaders(workspaceId), params }),
  summary: (workspaceId: string, funnelId: string) =>
    api.get("/v1/crm/deals/summary", { headers: wsHeaders(workspaceId), params: { funnel_id: funnelId } }),
  get: (workspaceId: string, id: string) =>
    api.get(`/v1/crm/deals/${id}`, { headers: wsHeaders(workspaceId) }),
  create: (workspaceId: string, data: {
    title: string;
    contact_id: string;
    funnel_id: string;
    stage_id: string;
    company_id?: string;
    value?: number;
    currency?: string;
    expected_close_date?: string;
    description?: string;
    owner_id?: string;
    priority?: string;
    source?: string;
  }) => api.post("/v1/crm/deals", data, { headers: wsHeaders(workspaceId) }),
  patch: (workspaceId: string, id: string, data: Record<string, unknown>) =>
    api.patch(`/v1/crm/deals/${id}`, data, { headers: wsHeaders(workspaceId) }),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/v1/crm/deals/${id}`, { headers: wsHeaders(workspaceId) }),
  move: (workspaceId: string, id: string, stageId: string) =>
    api.post(`/v1/crm/deals/${id}/move`, { stage_id: stageId }, { headers: wsHeaders(workspaceId) }),
  win: (workspaceId: string, id: string) =>
    api.post(`/v1/crm/deals/${id}/win`, {}, { headers: wsHeaders(workspaceId) }),
  lose: (workspaceId: string, id: string, reason?: string) =>
    api.post(`/v1/crm/deals/${id}/lose`, { reason: reason ?? "" }, { headers: wsHeaders(workspaceId) }),
  reopen: (workspaceId: string, id: string) =>
    api.post(`/v1/crm/deals/${id}/reopen`, {}, { headers: wsHeaders(workspaceId) }),
  timeline: (workspaceId: string, id: string) =>
    api.get(`/v1/crm/deals/${id}/timeline`, { headers: wsHeaders(workspaceId) }),
  addNote: (workspaceId: string, id: string, body: string) =>
    api.post(`/v1/crm/deals/${id}/notes`, { body }, { headers: wsHeaders(workspaceId) }),
};

export const funnelViewsApi = {
  list: (workspaceId: string, funnelId: string) =>
    api.get(`/v1/crm/funnels/${funnelId}/views`, { headers: wsHeaders(workspaceId) }),
  create: (workspaceId: string, funnelId: string, data: {
    name: string;
    icon?: string;
    kind: FunnelViewKind;
    filter?: string;
    sort?: string;
    columns?: string;
    extra?: string;
    is_default?: boolean;
    sort_order?: number;
  }) => api.post(`/v1/crm/funnels/${funnelId}/views`, data, { headers: wsHeaders(workspaceId) }),
  patch: (workspaceId: string, funnelId: string, viewId: string, data: Record<string, unknown>) =>
    api.patch(`/v1/crm/funnels/${funnelId}/views/${viewId}`, data, { headers: wsHeaders(workspaceId) }),
  delete: (workspaceId: string, funnelId: string, viewId: string) =>
    api.delete(`/v1/crm/funnels/${funnelId}/views/${viewId}`, { headers: wsHeaders(workspaceId) }),
};

export const contactGroupsApi = {
  list: (workspaceId: string, params?: { instance_id?: string; q?: string }) =>
    api.get("/v1/crm/groups", { headers: wsHeaders(workspaceId), params }),
  get: (workspaceId: string, id: string) =>
    api.get(`/v1/crm/groups/${id}`, { headers: wsHeaders(workspaceId) }),
  members: (workspaceId: string, id: string) =>
    api.get(`/v1/crm/groups/${id}/members`, { headers: wsHeaders(workspaceId) }),
  contactGroups: (workspaceId: string, contactId: string) =>
    api.get(`/v1/crm/contacts/${contactId}/groups`, { headers: wsHeaders(workspaceId) }),
  sync: (workspaceId: string, instanceId: string) =>
    api.post("/v1/crm/groups/sync", { instance_id: instanceId }, { headers: wsHeaders(workspaceId) }),
};

export const conversationExtraApi = {
  listTags: (workspaceId: string, conversationId: string) =>
    api.get(`/v1/conversations/${conversationId}/tags`, { headers: wsHeaders(workspaceId) }),
  addTag: (workspaceId: string, conversationId: string, tagId: string) =>
    api.post(`/v1/conversations/${conversationId}/tags`, { tag_id: tagId }, { headers: wsHeaders(workspaceId) }),
  removeTag: (workspaceId: string, conversationId: string, tagId: string) =>
    api.delete(`/v1/conversations/${conversationId}/tags/${tagId}`, { headers: wsHeaders(workspaceId) }),
  listParticipants: (workspaceId: string, conversationId: string) =>
    api.get(`/v1/conversations/${conversationId}/participants`, { headers: wsHeaders(workspaceId) }),
  addParticipant: (workspaceId: string, conversationId: string, userId: string, role = "follower") =>
    api.post(`/v1/conversations/${conversationId}/participants`, { user_id: userId, role }, { headers: wsHeaders(workspaceId) }),
  removeParticipant: (workspaceId: string, conversationId: string, userId: string) =>
    api.delete(`/v1/conversations/${conversationId}/participants/${userId}`, { headers: wsHeaders(workspaceId) }),
  listAssignments: (workspaceId: string, conversationId: string) =>
    api.get(`/v1/conversations/${conversationId}/assignments`, { headers: wsHeaders(workspaceId) }),
  listEvents: (workspaceId: string, conversationId: string, limit = 200) =>
    api.get(`/v1/conversations/${conversationId}/events`, { headers: wsHeaders(workspaceId), params: { limit } }),
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProxyConfig {
  enabled: boolean;
  type: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
}
