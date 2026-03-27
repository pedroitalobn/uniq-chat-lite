import axios from "axios";
import { getSession } from "next-auth/react";

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

// Attach JWT token from session
api.interceptors.request.use(async (config) => {
  const session = await getSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (error.response?.status === 401) {
      try {
        const refresh = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );
        const newToken = refresh.data.access_token;
        error.config.headers.Authorization = `Bearer ${newToken}`;
        return api(error.config);
      } catch {
        window.location.href = "/login";
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
  list: () => api.get("/servers"),
  get: (id: string) => api.get(`/servers/${id}`),
  create: (data: { name: string; slug?: string; description?: string }) =>
    api.post("/servers", data),
  update: (id: string, data: { name?: string; description?: string; is_active?: boolean }) =>
    api.put(`/servers/${id}`, data),
  delete: (id: string) => api.delete(`/servers/${id}`),
  instances: (id: string) => api.get(`/servers/${id}/instances`),
};

export const channelsApi = {
  list: () => api.get("/channels"),
};

export const instancesApi = {
  list: (channel?: string) => api.get("/instances", { params: channel ? { channel } : undefined }),
  get: (id: string) => api.get(`/instances/${id}`),
  create: (name: string, channel?: string, serverId?: string, token?: string) =>
    api.post("/instances", {
      name,
      channel: channel || "whatsapp",
      server_id: serverId || undefined,
      token: token || undefined,
    }),
  delete: (id: string) => api.delete(`/instances/${id}`),
  getQR: (id: string) => api.get(`/instances/${id}/qr`),
  getPairingCode: (id: string, phoneNumber: string) =>
    api.post(`/instances/${id}/pairing-code`, { phone_number: phoneNumber }),
  disconnect: (id: string) => api.post(`/instances/${id}/disconnect`),
  reconnect: (id: string) => api.post(`/instances/${id}/reconnect`),
  status: (id: string) => api.get(`/instances/${id}/status`),
  profile: (id: string) => api.get(`/instances/${id}/profile`),
  regenerateToken: (id: string) => api.post(`/instances/${id}/regenerate-token`),
};

export const settingsApi = {
  get: (id: string) => api.get(`/instances/${id}/settings`),
  update: (id: string, data: Partial<{
    always_online: boolean;
    reject_calls: boolean;
    read_messages: boolean;
    ignore_groups: boolean;
    ignore_status: boolean;
    mcp_enabled: boolean;
  }>) => api.put(`/instances/${id}/settings`, data),
};

export const proxyApi = {
  get: (id: string) => api.get(`/instances/${id}/proxy`),
  set: (id: string, data: ProxyConfig) => api.put(`/instances/${id}/proxy`, data),
  test: (id: string, data?: Partial<ProxyConfig>) =>
    api.post(`/instances/${id}/proxy/test`, data || {}),
  delete: (id: string) => api.delete(`/instances/${id}/proxy`),
};

export const instagramApi = {
  connect: (id: string, data: { username?: string; password?: string; access_token?: string }) =>
    api.post(`/instagram/instances/${id}/connect`, data),
  disconnect: (id: string) => api.post(`/instagram/instances/${id}/disconnect`),
  getDMs: (id: string) => api.get(`/instagram/instances/${id}/messages/dm`),
  sendDM: (id: string, to: string, text: string) =>
    api.post(`/instagram/instances/${id}/messages/dm`, { to, text }),
};

export const messagesApi = {
  list: (id: string, params?: { limit?: number; offset?: number }) =>
    api.get(`/instances/${id}/messages`, { params }),
  sendText: (id: string, to: string, text: string) =>
    api.post(`/instances/${id}/messages/text`, { to, text }),
  sendImage: (id: string, data: { to: string; url?: string; base64?: string; caption?: string }) =>
    api.post(`/instances/${id}/messages/image`, data),
  sendDocument: (id: string, data: { to: string; url?: string; base64?: string; filename?: string; caption?: string }) =>
    api.post(`/instances/${id}/messages/document`, data),
  sendAudio: (id: string, data: { to: string; url?: string; base64?: string }) =>
    api.post(`/instances/${id}/messages/audio`, data),
  sendVideo: (id: string, data: { to: string; url?: string; base64?: string; caption?: string }) =>
    api.post(`/instances/${id}/messages/video`, data),
  sendLocation: (id: string, data: { to: string; latitude: number; longitude: number; name?: string; address?: string }) =>
    api.post(`/instances/${id}/messages/location`, data),
  sendContact: (id: string, data: { to: string; display_name: string; phone: string }) =>
    api.post(`/instances/${id}/messages/contact`, data),
  sendReaction: (id: string, data: { to: string; message_id: string; emoji: string }) =>
    api.post(`/instances/${id}/messages/reaction`, data),
  sendPoll: (id: string, data: { to: string; question: string; options: string[]; multiple_answers?: boolean }) =>
    api.post(`/instances/${id}/messages/poll`, data),
  sendSticker: (id: string, data: { to: string; url?: string; base64?: string }) =>
    api.post(`/instances/${id}/messages/sticker`, data),
  sendButtons: (id: string, data: { to: string; body: string; footer?: string; buttons: { id: string; text: string }[] }) =>
    api.post(`/instances/${id}/messages/buttons`, data),
  sendList: (id: string, data: { to: string; title?: string; description?: string; button_text: string; footer?: string; sections: { title: string; rows: { id: string; title: string; description?: string }[] }[] }) =>
    api.post(`/instances/${id}/messages/list`, data),
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
  list: (id: string) => api.get(`/instances/${id}/webhooks`),
  create: (id: string, data: WebhookPayload) =>
    api.post(`/instances/${id}/webhooks`, data),
  update: (id: string, webhookId: string, data: WebhookPayload) =>
    api.put(`/instances/${id}/webhooks/${webhookId}`, data),
  delete: (id: string, webhookId: string) =>
    api.delete(`/instances/${id}/webhooks/${webhookId}`),
};

export const recoveryApi = {
  get: (id: string) => api.get(`/instances/${id}/recovery`),
  snapshot: (id: string) => api.post(`/instances/${id}/recovery/snapshot`),
  reset: (id: string) => api.post(`/instances/${id}/recovery/reset`),
  setSchedule: (id: string, schedule: "" | "daily" | "weekly") =>
    api.put(`/instances/${id}/recovery/schedule`, { schedule }),
};

export const mcpApi = {
  tools: (id: string) => api.get(`/instances/${id}/mcp/tools`),
};

export const apiKeysApi = {
  list: () => api.get("/api-keys"),
  create: (name: string) => api.post("/api-keys", { name }),
  delete: (id: string) => api.delete(`/api-keys/${id}`),
};

export const groupsApi = {
  list: (instanceId: string) => api.get(`/instances/${instanceId}/groups`),
  create: (instanceId: string, name: string, participants: string[]) =>
    api.post(`/instances/${instanceId}/groups`, { name, participants }),
  get: (instanceId: string, jid: string) => api.get(`/instances/${instanceId}/groups/${jid}`),
  update: (instanceId: string, jid: string, data: { name?: string; description?: string }) =>
    api.put(`/instances/${instanceId}/groups/${jid}`, data),
  updateParticipants: (instanceId: string, jid: string, action: string, participants: string[]) =>
    api.post(`/instances/${instanceId}/groups/${jid}/participants`, { action, participants }),
  inviteLink: (instanceId: string, jid: string, reset = false) =>
    api.get(`/instances/${instanceId}/groups/${jid}/invite`, { params: { reset } }),
  leave: (instanceId: string, jid: string) =>
    api.post(`/instances/${instanceId}/groups/${jid}/leave`),
};

export const crmApi = {
  listContacts: (params?: { search?: string; tag_id?: string; limit?: number; offset?: number }) =>
    api.get("/crm/contacts", { params }),
  createContact: (data: { name: string; phone: string; email?: string; notes?: string; avatar_url?: string }) =>
    api.post("/crm/contacts", data),
  getContact: (id: string) => api.get(`/crm/contacts/${id}`),
  updateContact: (id: string, data: Partial<{ name: string; phone: string; email: string; notes: string; avatar_url: string }>) =>
    api.put(`/crm/contacts/${id}`, data),
  deleteContact: (id: string) => api.delete(`/crm/contacts/${id}`),
  assignTags: (id: string, tagIds: string[]) => api.put(`/crm/contacts/${id}/tags`, { tag_ids: tagIds }),
  listTags: () => api.get("/crm/tags"),
  createTag: (name: string, color: string) => api.post("/crm/tags", { name, color }),
  deleteTag: (id: string) => api.delete(`/crm/tags/${id}`),
};

export const campaignsApi = {
  list: () => api.get("/campaigns"),
  create: (data: {
    instance_id: string;
    name: string;
    recipient_type: "contacts" | "groups";
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
    recipients: Array<{ phone: string; name?: string }>;
  }) => api.post("/campaigns", data),
  get: (id: string) => api.get(`/campaigns/${id}`),
  start: (id: string) => api.post(`/campaigns/${id}/start`),
  pause: (id: string) => api.post(`/campaigns/${id}/pause`),
  cancel: (id: string) => api.post(`/campaigns/${id}/cancel`),
  delete: (id: string) => api.delete(`/campaigns/${id}`),
};

export const integrationsApi = {
  list: () => api.get("/integrations"),
  create: (data: {
    provider: string;
    name: string;
    api_key: string;
    base_url?: string;
    model?: string;
    config?: string;
  }) => api.post("/integrations", data),
  update: (id: string, data: {
    name?: string;
    api_key?: string;
    base_url?: string;
    model?: string;
    config?: string;
    is_active?: boolean;
  }) => api.put(`/integrations/${id}`, data),
  delete: (id: string) => api.delete(`/integrations/${id}`),
  test: (id: string) => api.post(`/integrations/${id}/test`),
  getAgent: (instanceId: string) => api.get(`/instances/${instanceId}/agent`),
  updateAgent: (instanceId: string, data: {
    integration_id?: string | null;
    system_prompt?: string;
    is_active?: boolean;
    webhook_url?: string;
    webhook_secret?: string;
    mcp_server_url?: string;
  }) => api.put(`/instances/${instanceId}/agent`, data),
};

export const aiApi = {
  generate: (data: {
    integration_id: string;
    base_message: string;
    count?: number;
    tone?: string;
    context?: string;
  }) => api.post("/ai/generate", data),
};

export const stripeApi = {
  plans: () => api.get("/stripe/plans"),
  createCheckout: (planId: string) => api.post("/stripe/checkout", { plan_id: planId }),
  subscription: () => api.get("/stripe/subscription"),
};

export const adminApi = {
  getStats: () => api.get("/admin/stats"),
  listUsers: () => api.get("/admin/users"),
  createUser: (data: {
    name: string; email: string; username?: string;
    password: string; role?: string; plan_id?: string;
  }) => api.post("/admin/users", data),
  updateUser: (id: string, data: Record<string, unknown>) =>
    api.put(`/admin/users/${id}`, data),
  resetPassword: (id: string, password: string) =>
    api.post(`/admin/users/${id}/reset-password`, { password }),
  deleteUser: (id: string) => api.delete(`/admin/users/${id}`),
  listPlans: () => api.get("/admin/plans"),
  createPlan: (data: Record<string, unknown>) => api.post("/admin/plans", data),
  updatePlan: (id: string, data: Record<string, unknown>) =>
    api.put(`/admin/plans/${id}`, data),
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
