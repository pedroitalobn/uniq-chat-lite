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

export const inboxApi = {
  getChats: (instanceId: string, search?: string, filter?: string) =>
    api.get(`/v1/instances/${instanceId}/inbox/chats`, { params: { search, filter } }),
  getChat: (instanceId: string, jid: string) =>
    api.get(`/v1/instances/${instanceId}/inbox/chats/${jid}`),
  getMessages: (instanceId: string, jid: string, params?: { limit?: number; offset?: number; before?: string }) =>
    api.get(`/v1/instances/${instanceId}/inbox/chats/${jid}/messages`, { params }),
  sendMessage: (instanceId: string, jid: string, data: { content: string; type?: string }) =>
    api.post(`/v1/instances/${instanceId}/inbox/chats/${jid}/messages`, data),
  sendMedia: (instanceId: string, jid: string, data: { url: string; mime_type: string; filename?: string; caption?: string; ptt?: boolean }) =>
    api.post(`/v1/instances/${instanceId}/inbox/chats/${jid}/messages/media`, data),
  uploadMedia: (instanceId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api.post(`/v1/instances/${instanceId}/media/upload`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  markRead: (instanceId: string, jid: string) =>
    api.post(`/v1/instances/${instanceId}/inbox/chats/${jid}/read`),
  resendMessage: (instanceId: string, msgId: string) =>
    api.post(`/v1/instances/${instanceId}/inbox/messages/${msgId}/resend`),
  sendTyping: (instanceId: string, jid: string, typing: boolean) =>
    api.post(`/v1/instances/${instanceId}/inbox/chats/${jid}/typing`, { typing }),
  updateContact: (instanceId: string, contactId: string, data: { name?: string; phone?: string; email?: string; notes?: string; funnel?: string; stage?: string; journey?: string; owner?: string; tag_ids?: string[] }) =>
    api.put(`/v1/instances/${instanceId}/inbox/contacts/${contactId}`, data),
  updateMessage: (instanceId: string, messageId: string, data: { is_pinned?: boolean; is_favorite?: boolean; is_archived?: boolean; is_deleted?: boolean }) =>
    api.patch(`/v1/instances/${instanceId}/inbox/messages/${messageId}`, data),
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
  removeMember: (id: string, memberId: string) => api.delete(`/v1/workspaces/${id}/members/${memberId}`),
  // Invites
  createInvite: (id: string, data: { email: string; role_id: string }) => api.post(`/v1/workspaces/${id}/invites`, data),
  listInvites: (id: string) => api.get(`/v1/workspaces/${id}/invites`),
  revokeInvite: (id: string, inviteId: string) => api.delete(`/v1/workspaces/${id}/invites/${inviteId}`),
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
    system_prompt?: string;
    is_active?: boolean;
    webhook_url?: string;
    webhook_secret?: string;
    mcp_server_url?: string;
  }) => api.put(`/v1/instances/${instanceId}/agent`, data),
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

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProxyConfig {
  enabled: boolean;
  type: "http" | "https" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
}
