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

  // Do not block requests too long waiting for /api/auth/session
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
  list: (workspaceId?: string) => api.get("/api/servers", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  get: (id: string) => api.get(`/api/servers/${id}`),
  create: (data: { name: string; slug?: string; description?: string; workspace_id?: string }) =>
    api.post("/api/servers", data),
  update: (id: string, data: { 
    name?: string; 
    description?: string; 
    is_active?: boolean;
    proxy_pool_id?: string;
    webhook_url?: string;
    apply_webhook?: boolean;
  }) => api.put(`/api/servers/${id}`, data),
  delete: (id: string) => api.delete(`/api/servers/${id}`),
  instances: (id: string) => api.get(`/api/servers/${id}/instances`),
  stats: (id: string) => api.get(`/api/servers/${id}/stats`),
  action: (id: string, action: string) => api.post(`/api/servers/${id}/actions`, { action }),
};

export const channelsApi = {
  list: () => api.get("/api/channels"),
};

export const proxyPoolsApi = {
  list: () => api.get("/api/proxy/pool"),
  listProviders: () => api.get("/api/proxy/providers"),
  getGlobalProxies: () => api.get("/api/proxy/global"),
  createProvider: (data: { provider: string; name: string; api_key: string; country?: string }) =>
    api.post("/api/proxy/providers", data),
  updateProvider: (id: string, data: { name?: string; api_key?: string; country?: string; is_active?: boolean }) =>
    api.put(`/api/proxy/providers/${id}`, data),
  deleteProvider: (id: string) => api.delete(`/api/proxy/providers/${id}`),
};

export const instancesApi = {
  list: (channel?: string, workspaceId?: string) => {
    const params: Record<string, string> = {};
    if (channel) params.channel = channel;
    if (workspaceId) params.workspace_id = workspaceId;
    return api.get("/api/instances", { params: Object.keys(params).length ? params : undefined });
  },
  get: (id: string) => api.get(`/api/instances/${id}`),
  create: (name: string, channel?: string, serverId?: string, token?: string, workspaceId?: string) =>
    api.post("/api/instances", {
      name,
      channel: channel || "whatsapp",
      server_id: serverId || undefined,
      token: token || undefined,
      workspace_id: workspaceId || undefined,
    }),
  delete: (id: string) => api.delete(`/api/instances/${id}`),
  getQR: (id: string) => api.get(`/api/instances/${id}/qr`),
  getPairingCode: (id: string, phoneNumber: string) =>
    api.post(`/api/instances/${id}/pairing-code`, { phone_number: phoneNumber }),
  disconnect: (id: string) => api.post(`/api/instances/${id}/disconnect`),
  reconnect: (id: string) => api.post(`/api/instances/${id}/reconnect`),
  status: (id: string) => api.get(`/api/instances/${id}/status`),
  profile: (id: string) => api.get(`/api/instances/${id}/profile`),
  regenerateToken: (id: string) => api.post(`/api/instances/${id}/regenerate-token`),
  instagramLogin: (id: string, creds: { username: string; password: string }) =>
    api.post(`/api/instances/${id}/instagram/login`, creds),
  instagramLogout: (id: string) => api.post(`/api/instances/${id}/instagram/logout`),
  instagramSendDM: (id: string, data: { recipient: string; message: string }) =>
    api.post(`/api/instances/${id}/instagram/dm`, data),
  instagramGetInbox: (id: string) => api.get(`/api/instances/${id}/instagram/dm`),
  instagramFollow: (id: string, target: string) =>
    api.post(`/api/instances/${id}/instagram/follow`, { target }),
  instagramUnfollow: (id: string, target: string) =>
    api.post(`/api/instances/${id}/instagram/unfollow`, { target }),
  instagramPause: (id: string) => api.post(`/api/instances/${id}/instagram/pause`),
  instagramResume: (id: string) => api.post(`/api/instances/${id}/instagram/resume`),
  instagramPublishPost: (id: string, data: { image_url?: string; video_url?: string; caption?: string }) =>
    api.post(`/api/instances/${id}/instagram/post`, data),
  instagramUploadStory: (id: string, data: { image_url?: string; video_url?: string; caption?: string }) =>
    api.post(`/api/instances/${id}/instagram/story`, data),
  instagramGetUserMedia: (id: string, username: string) =>
    api.get(`/api/instances/${id}/instagram/media`, { params: { username } }),
  instagramLikeMedia: (id: string, mediaId: string) =>
    api.post(`/api/instances/${id}/instagram/like`, { media_id: mediaId }),
  instagramChallenge: (id: string, data: { api_path: string; code: string; method?: string }) =>
    api.post(`/api/instances/${id}/instagram/challenge`, data),
  instagramChallengeResend: (id: string, data: { api_path: string; method?: string }) =>
    api.post(`/api/instances/${id}/instagram/challenge/resend`, data),
};

export const settingsApi = {
  get: (id: string) => api.get(`/api/instances/${id}/settings`),
  update: (id: string, data: Partial<{
    always_online: boolean;
    reject_calls: boolean;
    read_messages: boolean;
    ignore_groups: boolean;
    ignore_status: boolean;
    mcp_enabled: boolean;
  }>) => api.put(`/api/instances/${id}/settings`, data),
};

export const proxyApi = {
  get: (id: string) => api.get(`/api/instances/${id}/proxy`),
  set: (id: string, data: ProxyConfig) => api.put(`/api/instances/${id}/proxy`, data),
  test: (id: string, data?: Partial<ProxyConfig>) =>
    api.post(`/api/instances/${id}/proxy/test`, data || {}),
  delete: (id: string) => api.delete(`/api/instances/${id}/proxy`),
  setMode: (id: string, data: { mode: string; global_proxy_id?: string; provider_id?: string }) => 
    api.put(`/api/instances/${id}/proxy/mode`, data),
};

export const messagesApi = {
  list: (id: string, params?: { limit?: number; offset?: number }) =>
    api.get(`/api/instances/${id}/messages`, { params }),
  sendText: (id: string, to: string, text: string) =>
    api.post(`/api/instances/${id}/messages/text`, { to, text }),
  sendImage: (id: string, data: { to: string; url?: string; base64?: string; caption?: string }) =>
    api.post(`/api/instances/${id}/messages/image`, data),
  sendDocument: (id: string, data: { to: string; url?: string; base64?: string; filename?: string; caption?: string }) =>
    api.post(`/api/instances/${id}/messages/document`, data),
  sendAudio: (id: string, data: { to: string; url?: string; base64?: string }) =>
    api.post(`/api/instances/${id}/messages/audio`, data),
  sendVideo: (id: string, data: { to: string; url?: string; base64?: string; caption?: string }) =>
    api.post(`/api/instances/${id}/messages/video`, data),
  sendLocation: (id: string, data: { to: string; latitude: number; longitude: number; name?: string; address?: string }) =>
    api.post(`/api/instances/${id}/messages/location`, data),
  sendContact: (id: string, data: { to: string; display_name: string; phone: string }) =>
    api.post(`/api/instances/${id}/messages/contact`, data),
  sendReaction: (id: string, data: { to: string; message_id: string; emoji: string }) =>
    api.post(`/api/instances/${id}/messages/reaction`, data),
  sendPoll: (id: string, data: { to: string; question: string; options: string[]; multiple_answers?: boolean }) =>
    api.post(`/api/instances/${id}/messages/poll`, data),
  sendSticker: (id: string, data: { to: string; url?: string; base64?: string }) =>
    api.post(`/api/instances/${id}/messages/sticker`, data),
  sendButtons: (id: string, data: { to: string; body: string; footer?: string; buttons: { id: string; text: string }[] }) =>
    api.post(`/api/instances/${id}/messages/buttons`, data),
  sendList: (id: string, data: { to: string; title?: string; description?: string; button_text: string; footer?: string; sections: { title: string; rows: { id: string; title: string; description?: string }[] }[] }) =>
    api.post(`/api/instances/${id}/messages/list`, data),
  sendMenu: (id: string, data: { number: string; type: "button"|"list"|"poll"|"carousel"; text: string; choices: string[]; footerText?: string; listButton?: string; selectableCount?: number; imageButton?: string }) =>
    api.post(`/api/instances/${id}/messages/menu`, data),
};

export const inboxApi = {
  getChats: (instanceId: string, search?: string, filter?: string) =>
    api.get(`/api/instances/${instanceId}/inbox/chats`, { params: { search, filter } }),
  getChat: (instanceId: string, jid: string) =>
    api.get(`/api/instances/${instanceId}/inbox/chats/${jid}`),
  getMessages: (instanceId: string, jid: string, params?: { limit?: number; offset?: number; before?: string }) =>
    api.get(`/api/instances/${instanceId}/inbox/chats/${jid}/messages`, { params }),
  sendMessage: (instanceId: string, jid: string, data: { content: string; type?: string }) =>
    api.post(`/api/instances/${instanceId}/inbox/chats/${jid}/messages`, data),
  sendMedia: (instanceId: string, jid: string, data: { url: string; caption?: string; mime_type?: string }) =>
    api.post(`/api/instances/${instanceId}/inbox/chats/${jid}/messages/media`, data),
  markRead: (instanceId: string, jid: string) =>
    api.post(`/api/instances/${instanceId}/inbox/chats/${jid}/read`),
  sendTyping: (instanceId: string, jid: string, typing: boolean) =>
    api.post(`/api/instances/${instanceId}/inbox/chats/${jid}/typing`, { typing }),
  updateContact: (instanceId: string, contactId: string, data: { name?: string; phone?: string; email?: string; notes?: string; funnel?: string; stage?: string; journey?: string; owner?: string; tag_ids?: string[] }) =>
    api.put(`/api/instances/${instanceId}/inbox/contacts/${contactId}`, data),
  updateMessage: (instanceId: string, messageId: string, data: { is_pinned?: boolean; is_favorite?: boolean; is_archived?: boolean; is_deleted?: boolean }) =>
    api.patch(`/api/instances/${instanceId}/inbox/messages/${messageId}`, data),
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
  list: (id: string) => api.get(`/api/instances/${id}/webhooks`),
  create: (id: string, data: WebhookPayload) =>
    api.post(`/api/instances/${id}/webhooks`, data),
  update: (id: string, webhookId: string, data: WebhookPayload) =>
    api.put(`/api/instances/${id}/webhooks/${webhookId}`, data),
  delete: (id: string, webhookId: string) =>
    api.delete(`/api/instances/${id}/webhooks/${webhookId}`),
};

export const globalWebhooksApi = {
  listEvents: () => api.get("/api/webhooks/system/events"),
  list: () => api.get("/api/webhooks/system"),
  create: (data: { name: string; url: string; events: string[] }) =>
    api.post("/api/webhooks/system", data),
  delete: (id: string) => api.delete(`/api/webhooks/system/${id}`),
  test: (id: string) => api.post(`/api/webhooks/system/${id}/test`, {}),
};

export const recoveryApi = {
  get: (id: string) => api.get(`/api/instances/${id}/recovery`),
  snapshot: (id: string) => api.post(`/api/instances/${id}/recovery/snapshot`),
  reset: (id: string) => api.post(`/api/instances/${id}/recovery/reset`),
  setSchedule: (id: string, schedule: "" | "daily" | "weekly") =>
    api.put(`/api/instances/${id}/recovery/schedule`, { schedule }),
};

export const mcpApi = {
  tools: (id: string) => api.get(`/api/instances/${id}/mcp/tools`),
};

// ─── Workspace API ────────────────────────────────────────────────────────────

export const workspacesApi = {
  list: () => api.get("/api/workspaces"),
  create: (data: { name: string }) => api.post("/api/workspaces", data),
  get: (id: string) => api.get(`/api/workspaces/${id}`),
  update: (id: string, data: { name: string }) => api.put(`/api/workspaces/${id}`, data),
  delete: (id: string) => api.delete(`/api/workspaces/${id}`),
  // Members
  listMembers: (id: string) => api.get(`/api/workspaces/${id}/members`),
  removeMember: (id: string, memberId: string) => api.delete(`/api/workspaces/${id}/members/${memberId}`),
  // Invites
  createInvite: (id: string, data: { email: string; role_id: string }) => api.post(`/api/workspaces/${id}/invites`, data),
  listInvites: (id: string) => api.get(`/api/workspaces/${id}/invites`),
  revokeInvite: (id: string, inviteId: string) => api.delete(`/api/workspaces/${id}/invites/${inviteId}`),
  acceptInvite: (token: string) => api.post(`/api/workspaces/accept-invite/${token}`),
};

// ─── Roles API ────────────────────────────────────────────────────────────────

export const rolesApi = {
  list: (workspaceId: string) => api.get(`/api/workspaces/${workspaceId}/roles`),
  get: (workspaceId: string, roleId: string) => api.get(`/api/workspaces/${workspaceId}/roles/${roleId}`),
  create: (workspaceId: string, data: { name: string; description?: string; permission_ids: string[] }) =>
    api.post(`/api/workspaces/${workspaceId}/roles`, data),
  update: (workspaceId: string, roleId: string, data: { name?: string; description?: string; permission_ids?: string[] }) =>
    api.put(`/api/workspaces/${workspaceId}/roles/${roleId}`, data),
  delete: (workspaceId: string, roleId: string) => api.delete(`/api/workspaces/${workspaceId}/roles/${roleId}`),
};

export const permissionsApi = {
  list: () => api.get("/api/permissions"),
  seed: () => api.post("/api/permissions/seed"),
};

export const apiKeysApi = {
  list: () => api.get("/api/api-keys"),
  create: (name: string) => api.post("/api/api-keys", { name }),
  delete: (id: string) => api.delete(`/api/api-keys/${id}`),
};

export const groupsApi = {
  list: (instanceId: string) => api.get(`/api/instances/${instanceId}/groups`),
  create: (instanceId: string, name: string, participants: string[]) =>
    api.post(`/api/instances/${instanceId}/groups`, { name, participants }),
  get: (instanceId: string, jid: string) => api.get(`/api/instances/${instanceId}/groups/${jid}`),
  update: (instanceId: string, jid: string, data: { name?: string; description?: string }) =>
    api.put(`/api/instances/${instanceId}/groups/${jid}`, data),
  updateParticipants: (instanceId: string, jid: string, action: string, participants: string[]) =>
    api.post(`/api/instances/${instanceId}/groups/${jid}/participants`, { action, participants }),
  inviteLink: (instanceId: string, jid: string, reset = false) =>
    api.get(`/api/instances/${instanceId}/groups/${jid}/invite`, { params: { reset } }),
  leave: (instanceId: string, jid: string) =>
    api.post(`/api/instances/${instanceId}/groups/${jid}/leave`),
};

export const crmApi = {
  listContacts: (params?: { search?: string; tag_id?: string; limit?: number; offset?: number; workspace_id?: string }) =>
    api.get("/api/crm/contacts", { params }),
  createContact: (data: { name: string; phone: string; email?: string; notes?: string; avatar_url?: string; workspace_id?: string }) =>
    api.post("/api/crm/contacts", data),
  getContact: (id: string) => api.get(`/api/crm/contacts/${id}`),
  updateContact: (id: string, data: Partial<{ name: string; phone: string; email: string; notes: string; avatar_url: string }>) =>
    api.put(`/api/crm/contacts/${id}`, data),
  deleteContact: (id: string) => api.delete(`/api/crm/contacts/${id}`),
  assignTags: (id: string, tagIds: string[]) => api.put(`/api/crm/contacts/${id}/tags`, { tag_ids: tagIds }),
  listTags: (workspaceId?: string) => api.get("/api/crm/tags", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  createTag: (name: string, color: string, workspaceId?: string) => api.post("/api/crm/tags", { name, color, workspace_id: workspaceId }),
  deleteTag: (id: string) => api.delete(`/api/crm/tags/${id}`),
  listFunnels: (workspaceId?: string) => api.get("/api/crm/funnels", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  createFunnel: (data: { name: string; description?: string; color?: string; workspace_id?: string }) => api.post("/api/crm/funnels", data),
  deleteFunnel: (id: string) => api.delete(`/api/crm/funnels/${id}`),
  listFunnelStages: (funnelId: string) => api.get(`/api/crm/funnels/${funnelId}/stages`),
  createFunnelStage: (funnelId: string, data: { name: string; color?: string }) => api.post(`/api/crm/funnels/${funnelId}/stages`, data),
  deleteFunnelStage: (funnelId: string, stageId: string) => api.delete(`/api/crm/funnels/${funnelId}/stages/${stageId}`),
  listJourneyOptions: () => api.get("/api/crm/journey-options"),
  listStageOptions: () => api.get("/api/crm/stage-options"),
  listFunnelOptions: () => api.get("/api/crm/funnel-options"),
};

export const campaignsApi = {
  list: (workspaceId?: string) => api.get("/api/campaigns", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  segmentOptions: () => api.get("/api/campaigns/segment-options"),
  segmentPreview: (data: {
    funnel?: string; stage?: string; journey?: string;
    tags?: string[]; owner?: string; external_id?: string;
  }) => api.post("/api/campaigns/segment-preview", data),
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
  }) => api.post("/api/campaigns", data),
  get: (id: string) => api.get(`/api/campaigns/${id}`),
  start: (id: string) => api.post(`/api/campaigns/${id}/start`),
  pause: (id: string) => api.post(`/api/campaigns/${id}/pause`),
  cancel: (id: string) => api.post(`/api/campaigns/${id}/cancel`),
  delete: (id: string) => api.delete(`/api/campaigns/${id}`),
};

export const integrationsApi = {
  list: () => api.get("/api/integrations"),
  create: (data: {
    provider: string;
    name: string;
    api_key: string;
    base_url?: string;
    models?: string[];
    config?: string;
  }) => api.post("/api/integrations", data),
  update: (id: string, data: {
    name?: string;
    api_key?: string;
    base_url?: string;
    models?: string[];
    config?: string;
    is_active?: boolean;
  }) => api.put(`/api/integrations/${id}`, data),
  delete: (id: string) => api.delete(`/api/integrations/${id}`),
  test: (id: string) => api.post(`/api/integrations/${id}/test`),
  getAgent: (instanceId: string) => api.get(`/api/instances/${instanceId}/agent`),
  updateAgent: (instanceId: string, data: {
    integration_id?: string | null;
    system_prompt?: string;
    is_active?: boolean;
    webhook_url?: string;
    webhook_secret?: string;
    mcp_server_url?: string;
  }) => api.put(`/api/instances/${instanceId}/agent`, data),
};

export const agentsApi = {
  chat: (message: string, integrationId?: string, model?: string) =>
    api.post("/api/ai/chat", { message, integration_id: integrationId, model }),
  stats: () => api.get("/api/agent/stats"),
  activity: (limit?: number) => api.get("/api/agent/activity", { params: limit ? { limit } : undefined }),
  instances: () => api.get("/api/agent/instances"),
  stopExecution: (executionId: string) => api.post(`/api/agent/executions/${executionId}/stop`),
};

export const journeysApi = {
  list: () => api.get("/api/journeys"),
  create: (prompt: string, integrationId?: string, instanceId?: string) =>
    api.post("/api/journeys", { prompt, integration_id: integrationId, instance_id: instanceId }),
  get: (id: string) => api.get(`/api/journeys/${id}`),
  updateStatus: (id: string, status: "active" | "paused") =>
    api.patch(`/api/journeys/${id}/status`, { status }),
  delete: (id: string) => api.delete(`/api/journeys/${id}`),
  executions: (id: string, limit?: number, offset?: number) =>
    api.get(`/api/journeys/${id}/executions`, { params: { limit: limit || 20, offset: offset || 0 } }),
};

export const aiApi = {
  generate: (data: {
    integration_id: string;
    base_message: string;
    count?: number;
    tone?: string;
    context?: string;
  }) => api.post("/api/ai/generate", data),
};

export const stripeApi = {
  plans: () => api.get("/api/payments/plans"),
  createCheckout: (planId: string) => api.post("/api/payments/checkout", { plan_id: planId }),
  subscription: () => api.get("/api/payments/subscription"),
};

export const adminApi = {
  getStats: () => api.get("/api/admin/stats"),
  listUsers: () => api.get("/api/admin/users"),
  getProxyConfig: () => api.get("/api/admin/proxy-config"),
  updateProxyConfig: (data: Record<string, unknown>) => api.put("/api/admin/proxy-config", data),
  deleteProxyConfig: (id: string) => api.delete(`/api/admin/proxy-config/${id}`),
  getProxyStats: () => api.get("/api/admin/proxy-stats"),
  createUser: (data: {
    name: string; email: string; username?: string;
    password: string; role?: string; plan_id?: string;
  }) => api.post("/api/admin/users", data),
  updateUser: (id: string, data: Record<string, unknown>) =>
    api.put(`/api/admin/users/${id}`, data),
  resetPassword: (id: string, password: string) =>
    api.post(`/api/admin/users/${id}/reset-password`, { password }),
  deleteUser: (id: string) => api.delete(`/api/admin/users/${id}`),
  listPlans: () => api.get("/api/admin/plans"),
  createPlan: (data: Record<string, unknown>) => api.post("/api/admin/plans", data),
  updatePlan: (id: string, data: Record<string, unknown>) =>
    api.put(`/api/admin/plans/${id}`, data),
  getPaymentSettings: () => api.get("/api/admin/payment-settings"),
  updatePaymentSettings: (data: Record<string, unknown>) =>
    api.put("/api/admin/payment-settings", data),
  // Email settings
  getEmailSettings: () => api.get("/api/admin/email-settings"),
  updateEmailSettings: (data: {
    api_key?: string;
    sender_email?: string;
    sender_name?: string;
    is_enabled?: boolean;
  }) => api.put("/api/admin/email-settings", data),
  testEmail: (to: string) => api.post("/api/admin/email-settings/test", { to }),
  listEmailTemplates: () => api.get("/api/admin/email-templates"),
  getEmailTemplate: (slug: string) => api.get(`/api/admin/email-templates/${slug}`),
  updateEmailTemplate: (slug: string, data: {
    subject?: string;
    html_content?: string;
    is_active?: boolean;
  }) => api.put(`/api/admin/email-templates/${slug}`, data),
  testEmailTemplate: (slug: string, to: string) =>
    api.post(`/api/admin/email-templates/${slug}/test`, { to }),
  getEmailLogs: (limit?: number, offset?: number) => 
    api.get("/api/admin/email-logs", { params: { limit, offset } }),
};

export const plansApi = {
  list: () => api.get("/api/payments/plans"),
  checkout: (data: { plan_id: string }) => api.post("/api/payments/checkout", data),
  subscription: () => api.get("/api/payments/subscription"),
};

// ─── Instagram ───────────────────────────────────────────────────────────────


// ─── TikTok ─────────────────────────────────────────────────────────────────

export const tiktokApi = {
  health: () => api.get("/api/tiktok/health"),
  listAccounts: () => api.get("/api/tiktok/accounts"),
  createAccount: (data: { username: string; password: string }) =>
    api.post("/api/tiktok/accounts", data),
  getAccount: (id: string) => api.get(`/api/tiktok/accounts/${id}`),
  deleteAccount: (id: string) => api.delete(`/api/tiktok/accounts/${id}`),
  connect: (id: string) => api.post(`/api/tiktok/accounts/${id}/connect`),
  disconnect: (id: string) => api.post(`/api/tiktok/accounts/${id}/disconnect`),
  updateSettings: (id: string, data: {
    auto_reply?: boolean; ai_enabled?: boolean; integration_id?: string | null;
  }) => api.put(`/api/tiktok/accounts/${id}/settings`, data),
  sendDM: (id: string, target: string, message: string) =>
    api.post(`/api/tiktok/accounts/${id}/dm`, { target, message }),
  readDMs: (id: string) => api.get(`/api/tiktok/accounts/${id}/dm`),
  follow: (id: string, target: string) =>
    api.post(`/api/tiktok/accounts/${id}/follow`, { target }),
  unfollow: (id: string, target: string) =>
    api.post(`/api/tiktok/accounts/${id}/unfollow`, { target }),
  scrapeFollowers: (id: string, target: string, limit?: number) =>
    api.post(`/api/tiktok/accounts/${id}/scrape/followers`, { target, limit: limit || 100 }),
  scrapeHashtag: (id: string, hashtag: string, limit?: number) =>
    api.post(`/api/tiktok/accounts/${id}/scrape/hashtag`, { hashtag, limit: limit || 100 }),
  listTargets: () => api.get("/api/tiktok/targets"),
  listDMs: (accountId?: string) =>
    api.get("/api/tiktok/dms", { params: accountId ? { account_id: accountId } : {} }),
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
