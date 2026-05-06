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

    // 404 em /v1/instances/<uuid>/* = instance ID stale no frontend (deletada
    // ou movida pra outro workspace). Invalida o cache global de instances
    // pra forçar refetch e o user vê a lista atualizada na próxima nav.
    // Disparamos o evento custom — quem ouve (LayoutClient com QueryClient)
    // chama qc.invalidateQueries(["instances"]).
    if (
      error.response?.status === 404 &&
      typeof originalRequest?.url === "string" &&
      /\/v1\/instances\/[0-9a-f-]{36}/i.test(originalRequest.url)
    ) {
      try {
        window.dispatchEvent(new CustomEvent("uniq:instance-stale", {
          detail: { url: originalRequest.url },
        }));
      } catch { /* SSR */ }
    }

    // 429 Too Many Requests: respeita Retry-After (segundos) ou
    // x-ratelimit-reset (RFC3339), default 5s. Faz 1 retry automático
    // depois do delay — UI não vê erro a menos que persista.
    if (error.response?.status === 429 && !originalRequest._retry429) {
      originalRequest._retry429 = true;
      const retryAfter = error.response.headers["retry-after"];
      const reset = error.response.data?.retry_after;
      let waitMs = 5000;
      if (retryAfter) {
        const n = Number(retryAfter);
        if (Number.isFinite(n)) waitMs = Math.max(500, n * 1000);
      } else if (reset) {
        const resetMs = new Date(reset).getTime() - Date.now();
        if (resetMs > 0 && resetMs < 60_000) waitMs = resetMs + 200;
      }
      console.warn(`[api] 429 received — retrying after ${waitMs}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
      return api(originalRequest);
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
  forgotPassword: (email: string) =>
    api.post("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) =>
    api.post("/auth/reset-password", { token, password }),
  me: () => api.get("/auth/me"),
  updateMe: (data: { name?: string; username?: string }) => api.put("/auth/me", data),
  changePassword: (current_password: string, new_password: string) =>
    api.post("/auth/change-password", { current_password, new_password }),
  logout: () => api.post("/auth/logout"),
  refresh: () => api.post("/auth/refresh"),
  resendVerification: (email: string) =>
    api.post("/auth/resend-verification", { email }),
  // 2FA TOTP
  setup2FA: () => api.post("/auth/2fa/setup"),
  enable2FA: (code: string) => api.post("/auth/2fa/enable", { code }),
  disable2FA: (code: string) => api.post("/auth/2fa/disable", { code }),
  verify2FA: (challenge_token: string, code: string) =>
    api.post("/auth/2fa/verify", { challenge_token, code }),
  verify2FABackup: (challenge_token: string, backup_code: string) =>
    api.post("/auth/2fa/verify", { challenge_token, backup_code }),
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
  listPlatform: () => api.get("/v1/proxies/platform"),
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
  update: (id: string, data: { name?: string }) =>
    api.patch(`/v1/instances/${id}`, data),
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
  instagramFollow: (id: string, data: { target: string }) =>
    api.post(`/v1/instances/${id}/instagram/follow`, data),
  instagramUnfollow: (id: string, data: { target: string }) =>
    api.post(`/v1/instances/${id}/instagram/unfollow`, data),
  instagramPause: (id: string) => api.post(`/v1/instances/${id}/instagram/pause`),
  instagramResume: (id: string) => api.post(`/v1/instances/${id}/instagram/resume`),
  instagramPost: (id: string, data: { image_url?: string; video_url?: string; caption?: string }) =>
    api.post(`/v1/instances/${id}/instagram/post`, data),
  instagramPublishPost: (id: string, data: { image_url?: string; video_url?: string; caption?: string }) =>
    api.post(`/v1/instances/${id}/instagram/post`, data),
  instagramStory: (id: string, data: { image_url?: string; video_url?: string; caption?: string }) =>
    api.post(`/v1/instances/${id}/instagram/story`, data),
  instagramUploadStory: (id: string, data: { image_url?: string; video_url?: string; caption?: string }) =>
    api.post(`/v1/instances/${id}/instagram/story`, data),
  instagramGetUserMedia: (id: string, username: string) =>
    api.get(`/v1/instances/${id}/instagram/media`, { params: { username } }),
  instagramLike: (id: string, data: { media_id: string }) =>
    api.post(`/v1/instances/${id}/instagram/like`, data),
  instagramLikeMedia: (id: string, mediaId: string) =>
    api.post(`/v1/instances/${id}/instagram/like`, { media_id: mediaId }),
  instagramUnlike: (id: string, data: { media_id: string }) =>
    api.post(`/v1/instances/${id}/instagram/unlike`, data),
  instagramComment: (id: string, data: { media_id: string; text: string }) =>
    api.post(`/v1/instances/${id}/instagram/comment`, data),
  instagramGetComments: (id: string, mediaId: string) =>
    api.get(`/v1/instances/${id}/instagram/comments`, { params: { media_id: mediaId } }),
  instagramDMReply: (id: string, data: { thread_id: string; text: string }) =>
    api.post(`/v1/instances/${id}/instagram/dm/reply`, data),
  instagramGetThread: (id: string, threadId: string) =>
    api.get(`/v1/instances/${id}/instagram/dm/thread`, { params: { thread_id: threadId } }),
  instagramSearchUsers: (id: string, query: string) =>
    api.get(`/v1/instances/${id}/instagram/search/users`, { params: { query } }),
  instagramHashtag: (id: string, hashtag: string) =>
    api.get(`/v1/instances/${id}/instagram/hashtag`, { params: { hashtag } }),
  instagramProfile: (id: string, username: string) =>
    api.get(`/v1/instances/${id}/instagram/profile`, { params: { username } }),
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
  // GET por ID — funciona com qualquer tipo. Aceita UUID interno OU
  // external_message_id (stanza WhatsApp).
  get: (id: string, msgID: string) =>
    api.get(`/v1/instances/${id}/messages/${encodeURIComponent(msgID)}`),
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
  sendButtons: (
    id: string,
    data: {
      to: string;
      body: string;
      footer?: string;
      // Backend aceita até 3 botões. Tipos:
      //   reply → quick reply (retorna o id ao clicar)
      //   url   → abre URL externa
      //   call  → disca número (phone)
      //   copy  → copia código pra clipboard (copy_code)
      buttons: {
        id?: string;
        text: string;
        type?: "reply" | "url" | "call" | "copy";
        url?: string;
        phone?: string;
        copy_code?: string;
      }[];
    },
  ) =>
    api.post(`/v1/instances/${id}/messages/buttons`, data),
  sendTemplate: (id: string, data: { to: string; content: string; footer?: string; buttons: { display_text: string; type: "quickreply" | "url" | "call"; id?: string; url?: string; phone_number?: string }[] }) =>
    api.post(`/v1/instances/${id}/messages/template`, data),
  sendList: (id: string, data: { to: string; title?: string; description?: string; button_text: string; footer?: string; sections: { title: string; rows: { id: string; title: string; description?: string }[] }[] }) =>
    api.post(`/v1/instances/${id}/messages/list`, data),
  // PIX (review_and_pay) — card de cobrança interativo. KeyType aceita
  // CPF, CNPJ, EMAIL, PHONE, EVP. Valor é o exibido pelo recipient antes
  // de confirmar; o protocolo atual aceita 0,01 default e o user ajusta no app.
  sendPix: (
    id: string,
    data: {
      to: string;
      header_title: string;
      body_text: string;
      footer_text?: string;
      merchant_name: string;
      pix_key: string;
      key_type: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";
    },
  ) =>
    api.post(`/v1/instances/${id}/messages/pix`, data),
  // Carrossel — cards horizontais (HSCROLL_CARDS). Cada card tem
  // header com título e mídia opcional, body e até 3 botões interativos.
  sendCarousel: (
    id: string,
    data: {
      to: string;
      cards: {
        header: { title: string; image_url?: string; video_url?: string };
        body: string;
        buttons: {
          id?: string;
          text: string;
          type?: "reply" | "url" | "call" | "copy";
          url?: string;
          phone?: string;
          copy_code?: string;
        }[];
      }[];
    },
  ) =>
    api.post(`/v1/instances/${id}/messages/carousel`, data),
  sendMenu: (id: string, data: { number: string; type: "button"|"list"|"poll"|"carousel"; text: string; choices: string[]; footerText?: string; listButton?: string; selectableCount?: number; imageButton?: string }) =>
    api.post(`/v1/instances/${id}/messages/menu`, data),
  // Texto com preview de link automático (foto + título extraídos pelo WhatsApp).
  sendLink: (id: string, data: { to: string; text: string }) =>
    api.post(`/v1/instances/${id}/messages/link`, data),
  // Editar mensagem já enviada (janela de 15min do WhatsApp).
  editMessage: (id: string, data: { chat_jid: string; message_id: string; new_text: string }) =>
    api.post(`/v1/instances/${id}/messages/edit`, data),
};

// Operações de chat (pin/archive/mute) e history-sync.
export const chatOpsApi = {
  pin: (id: string, jid: string, pinned: boolean) =>
    api.post(`/v1/instances/${id}/chat/pin`, { jid, pinned }),
  archive: (id: string, jid: string, archived: boolean) =>
    api.post(`/v1/instances/${id}/chat/archive`, { jid, archived }),
  // duration_ms = 0 → silencia "para sempre" (default WhatsApp = 8h se não informado).
  mute: (id: string, data: { jid: string; mute: boolean; duration_ms?: number }) =>
    api.post(`/v1/instances/${id}/chat/mute`, data),
  historySync: (id: string, data: { chat_jid: string; sender_jid?: string; message_id: string; count?: number }) =>
    api.post(`/v1/instances/${id}/chat/history-sync`, data),
};

// Perfil da própria conta conectada à instância.
export const profileApi = {
  setName: (id: string, name: string) =>
    api.put(`/v1/instances/${id}/profile/name`, { name }),
  setStatus: (id: string, status: string) =>
    api.put(`/v1/instances/${id}/profile/status`, { status }),
  // remove=true ignora url/base64; senão mande url ou base64.
  setPicture: (id: string, data: { url?: string; base64?: string; remove?: boolean }) =>
    api.put(`/v1/instances/${id}/profile/picture`, data),
};

// Bloqueio de contatos.
export const blockApi = {
  block: (id: string, jid: string) =>
    api.post(`/v1/instances/${id}/block`, { jid }),
  unblock: (id: string, jid: string) =>
    api.post(`/v1/instances/${id}/unblock`, { jid }),
  list: (id: string) =>
    api.get(`/v1/instances/${id}/blocklist`),
};

// Atributos de grupo (foto/announce/locked).
export const groupOpsApi = {
  setPhoto: (id: string, data: { jid: string; url?: string; base64?: string; remove?: boolean }) =>
    api.put(`/v1/instances/${id}/group-ops/photo`, data),
  setAnnounce: (id: string, jid: string, announce: boolean) =>
    api.put(`/v1/instances/${id}/group-ops/announce`, { jid, announce }),
  setLocked: (id: string, jid: string, locked: boolean) =>
    api.put(`/v1/instances/${id}/group-ops/locked`, { jid, locked }),
};

// Labels do WhatsApp (estrelinhas/cores).
export const labelsApi = {
  labelChat: (id: string, data: { jid: string; label_id: string; labeled: boolean }) =>
    api.post(`/v1/instances/${id}/labels/chat`, data),
  labelMessage: (id: string, data: { jid: string; label_id: string; message_id: string; labeled: boolean }) =>
    api.post(`/v1/instances/${id}/labels/message`, data),
  // color = índice 0..19 da paleta. deleted=true apaga.
  edit: (id: string, data: { label_id: string; name?: string; color?: number; deleted?: boolean }) =>
    api.post(`/v1/instances/${id}/labels/edit`, data),
};

// Privacy settings.
export const privacyApi = {
  get: (id: string) =>
    api.get(`/v1/instances/${id}/privacy`),
  set: (id: string, setting: string, value: string) =>
    api.put(`/v1/instances/${id}/privacy`, { setting, value }),
};

// Call operations.
export const callsApi = {
  reject: (instanceId: string, callerJid: string, callId: string) =>
    api.post(`/v1/instances/${instanceId}/calls/reject`, { caller_jid: callerJid, call_id: callId }),
  offer: (instanceId: string, jid: string, video = false) =>
    api.post(`/v1/instances/${instanceId}/calls/offer`, { jid, video }),
};

// Comunidades WhatsApp.
export const communityApi = {
  create: (id: string, data: { name: string; description?: string }) =>
    api.post(`/v1/instances/${id}/communities`, data),
  link: (id: string, data: { parent_jid: string; child_jid: string }) =>
    api.post(`/v1/instances/${id}/communities/link`, data),
  unlink: (id: string, data: { parent_jid: string; child_jid: string }) =>
    api.post(`/v1/instances/${id}/communities/unlink`, data),
  listGroups: (id: string, jid: string) =>
    api.get(`/v1/instances/${id}/communities/${encodeURIComponent(jid)}/groups`),
};

// Newsletters (channels).
export const newsletterApi = {
  create: (id: string, data: { name: string; description?: string; picture_url?: string; picture_base64?: string }) =>
    api.post(`/v1/instances/${id}/newsletters`, data),
  list: (id: string) =>
    api.get(`/v1/instances/${id}/newsletters`),
  // info aceita ?invite=<key> em vez de :jid pra resolver convite.
  info: (id: string, jidOrInvite: string, byInvite = false) =>
    byInvite
      ? api.get(`/v1/instances/${id}/newsletters/_?invite=${encodeURIComponent(jidOrInvite)}`)
      : api.get(`/v1/instances/${id}/newsletters/${encodeURIComponent(jidOrInvite)}`),
  follow: (id: string, jid: string) =>
    api.post(`/v1/instances/${id}/newsletters/${encodeURIComponent(jid)}/follow`),
  unfollow: (id: string, jid: string) =>
    api.post(`/v1/instances/${id}/newsletters/${encodeURIComponent(jid)}/unfollow`),
  messages: (id: string, jid: string, params?: { count?: number; before?: string }) =>
    api.get(`/v1/instances/${id}/newsletters/${encodeURIComponent(jid)}/messages`, { params }),
};

// Billing — upgrade/cancel/preview com Stripe proration nativa.
export const billingApi = {
  status: () => api.get("/v1/billing/status"),
  preview: (planId: string) => api.get(`/v1/billing/preview/${planId}`),
  upgrade: (planId: string) => api.post("/v1/billing/upgrade", { plan_id: planId }),
  cancel: (immediate = false) => api.post("/v1/billing/cancel", { immediate }),
  resume: () => api.post("/v1/billing/resume"),
};

// Reconnect & calls.
export const instanceOpsApi = {
  forceReconnect: (id: string) =>
    api.post(`/v1/instances/${id}/force-reconnect`),
  rejectCall: (id: string, data: { caller_jid: string; call_id: string }) =>
    api.post(`/v1/instances/${id}/calls/reject`, data),
};

// Sprint 8 — keyword triggers (autoresponder simples).
export const triggersApi = {
  list: (params?: { instance_id?: string; only_active?: boolean }) =>
    api.get(`/v1/triggers`, { params }),
  create: (data: {
    name: string;
    keyword: string;
    action: "reply" | "forward_ai" | "tag" | "start_journey";
    payload?: string;
    instance_id?: string;
    match_mode?: "exact" | "contains" | "starts" | "regex";
    case_sensitive?: boolean;
    priority?: number;
    multi_match?: boolean;
    cooldown_sec?: number;
    only_direct?: boolean;
  }) => api.post(`/v1/triggers`, data),
  get: (id: string) => api.get(`/v1/triggers/${id}`),
  update: (id: string, data: Partial<{ name: string; keyword: string; action: string; payload: string; is_active: boolean; priority: number; match_mode: string; case_sensitive: boolean; multi_match: boolean; cooldown_sec: number; only_direct: boolean }>) =>
    api.put(`/v1/triggers/${id}`, data),
  delete: (id: string) => api.delete(`/v1/triggers/${id}`),
  test: (id: string, text: string) => api.post(`/v1/triggers/${id}/test`, { text }),
};

// Sprint 7 — warmup (anti-ban) por instância.
export const warmupApi = {
  get: (id: string) => api.get(`/v1/instances/${id}/warmup`),
  upsert: (id: string, data: {
    duration_days?: number;
    daily_target?: number;
    start_hour?: number;
    end_hour?: number;
    min_delay_sec?: number;
    max_delay_sec?: number;
    message_pool: string[];
    contact_pool: string[];
  }) => api.post(`/v1/instances/${id}/warmup`, data),
  start: (id: string) => api.post(`/v1/instances/${id}/warmup/start`),
  pause: (id: string) => api.post(`/v1/instances/${id}/warmup/pause`),
  resume: (id: string) => api.post(`/v1/instances/${id}/warmup/resume`),
  stop: (id: string) => api.post(`/v1/instances/${id}/warmup/stop`),
};

// Sprint 7 — campaign controls granulares (resume/abort/clear-sent/messages).
export const campaignControlApi = {
  resume: (id: string) => api.post(`/v1/campaigns/${id}/resume`),
  abort: (id: string) => api.post(`/v1/campaigns/${id}/abort`),
  clearSent: (id: string) => api.post(`/v1/campaigns/${id}/clear-sent`),
  messageStatus: (id: string, params?: { status?: string; limit?: number; offset?: number }) =>
    api.get(`/v1/campaigns/${id}/messages`, { params }),
};

// Sprint 9 — RAG: ingestão por URL/texto direto (além do upload de arquivo).
export const agentRagApi = {
  ingestURL: (instanceId: string, data: { url: string; name?: string }) =>
    api.post(`/v1/instances/${instanceId}/agent/ingest-url`, data),
  ingestText: (instanceId: string, data: { name?: string; text: string; category?: "knowledge" | "faq" | "skill" }) =>
    api.post(`/v1/instances/${instanceId}/agent/ingest-text`, data),
};

// Sprint 8 — PIX simplificado (alias minimalista do /pix).
export const pixButtonApi = {
  send: (instanceId: string, data: { to: string; pix_key: string; key_type: "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP"; merchant_name?: string; body_text?: string }) =>
    api.post(`/v1/instances/${instanceId}/messages/pix-button`, data),
};

// Sprint 6 — extras whatsmeow (nem Evo-Go expõe).
// Business profile, disappearing messages, group invite preview,
// approve/reject join requests, newsletter avançado, TOS, QR resolvers.
export const whatsmeowExtrasApi = {
  // Catálogo + horário + email + website + descrição de uma conta business
  businessProfile: (id: string, jid: string) =>
    api.get(`/v1/instances/${id}/business-profile/${encodeURIComponent(jid)}`),

  // Mensagens efêmeras: 0=off, 86400000=24h, 604800000=7d, 7776000000=90d
  setDisappearing: (id: string, data: { chat_jid: string; duration_ms: number }) =>
    api.post(`/v1/instances/${id}/disappearing`, data),
  setDisappearingDefault: (id: string, durationMs: number) =>
    api.post(`/v1/instances/${id}/disappearing/default`, { duration_ms: durationMs }),

  // Convites de grupo (preview sem entrar / entrar via código)
  previewGroupInvite: (id: string, data: { group_jid: string; inviter_jid: string; code: string; expiration?: number }) =>
    api.post(`/v1/instances/${id}/groups/preview-invite`, data),
  previewGroupLink: (id: string, code: string) =>
    api.get(`/v1/instances/${id}/groups/preview-link`, { params: { code } }),
  joinGroupViaInvite: (id: string, data: { group_jid: string; inviter_jid: string; code: string; expiration?: number }) =>
    api.post(`/v1/instances/${id}/groups/join-with-invite`, data),

  // Aprovação/rejeição de pedidos de entrada
  listGroupRequests: (id: string, jid: string) =>
    api.get(`/v1/instances/${id}/groups/${encodeURIComponent(jid)}/requests`),
  updateGroupRequests: (id: string, jid: string, data: { participants: string[]; action: "approve" | "reject" }) =>
    api.post(`/v1/instances/${id}/groups/${encodeURIComponent(jid)}/requests`, data),

  // Participantes únicos de TODOS os subgrupos da comunidade
  communityParticipants: (id: string, jid: string) =>
    api.get(`/v1/instances/${id}/communities/${encodeURIComponent(jid)}/participants`),

  // Newsletter avançado
  newsletterMarkViewed: (id: string, jid: string, serverIds: number[]) =>
    api.post(`/v1/instances/${id}/newsletters/${encodeURIComponent(jid)}/mark-viewed`, { server_ids: serverIds }),
  newsletterReact: (id: string, jid: string, data: { server_id: number; reaction: string; message_id: string }) =>
    api.post(`/v1/instances/${id}/newsletters/${encodeURIComponent(jid)}/react`, data),
  newsletterMute: (id: string, jid: string, mute: boolean) =>
    api.post(`/v1/instances/${id}/newsletters/${encodeURIComponent(jid)}/mute`, { mute }),

  // TOS notice (quando WhatsApp pede pra aceitar termos)
  acceptTOS: (id: string, data: { notice_id: string; stage?: string }) =>
    api.post(`/v1/instances/${id}/tos/accept`, data),

  // Privacy específico de status
  statusPrivacy: (id: string) =>
    api.get(`/v1/instances/${id}/status-privacy`),

  // Resolvers de wa.me/* links
  resolveBusinessLink: (id: string, code: string) =>
    api.get(`/v1/instances/${id}/resolve/business-link`, { params: { code } }),
  resolveContactQR: (id: string, code: string) =>
    api.get(`/v1/instances/${id}/resolve/contact-qr`, { params: { code } }),
  getSelfQRLink: (id: string, revoke = false) =>
    api.get(`/v1/instances/${id}/qr-link`, { params: { revoke } }),
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

// mediaApi.download — stream do bucket via backend pra evitar CORS.
// O bucket Hetzner serve mídia via signed URL (preview funciona em <img src>),
// mas fetch() do JS falha em CORS preflight. O backend stream com
// Content-Disposition: attachment força download pelo browser.
export const mediaApi = {
  download: (key: string, filename?: string) =>
    api.get(`/v1/media/download`, {
      params: { key, ...(filename ? { filename } : {}) },
      responseType: "blob",
    }),
};

export interface LinkPreview {
  id: string;
  url: string;
  title?: string;
  description?: string;
  image_url?: string;
  site_name?: string;
  favicon_url?: string;
  fetched_at: string;
  fetch_err?: string;
}

// linkPreviewApi — busca metadados OG cacheados pelo backend.
export const linkPreviewApi = {
  get: (url: string) => api.get<LinkPreview>(`/v1/link-preview`, { params: { url } }),
};

// WABA (WhatsApp API / Cloud API oficial Meta) — Tech Provider flow.
// Endpoints: get embedded signup URL, callback, listar/criar/deletar
// templates, register phone (PIN), subscribe webhooks.
export const wabaApi = {
  getAuthURL: () => api.get(`/v1/waba/auth-url`),
  callback: (code: string) => api.post(`/v1/waba/callback`, { code }),
  get: (instanceId: string) => api.get(`/v1/instances/${instanceId}/waba`),
  delete: (instanceId: string) => api.delete(`/v1/instances/${instanceId}/waba`),
  phoneNumbers: (instanceId: string) =>
    api.get(`/v1/instances/${instanceId}/waba/phone-numbers`),
  templates: (instanceId: string) =>
    api.get(`/v1/instances/${instanceId}/waba/templates`),
  createTemplate: (instanceId: string, data: {
    name: string;
    language: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    components: any[];
  }) => api.post(`/v1/instances/${instanceId}/waba/templates`, data),
  editTemplate: (instanceId: string, templateId: string, data: { components: any[]; category?: string }) =>
    api.post(`/v1/instances/${instanceId}/waba/templates/${templateId}`, data),
  deleteTemplate: (instanceId: string, name: string) =>
    api.delete(`/v1/instances/${instanceId}/waba/templates/${name}`),
  register: (instanceId: string, pin: string) =>
    api.post(`/v1/instances/${instanceId}/waba/register`, { pin }),
  subscribe: (instanceId: string) =>
    api.post(`/v1/instances/${instanceId}/waba/subscribe`),
  sendMessage: (
    instanceId: string,
    data: {
      to: string;
      type: "text" | "template" | "image" | "document" | "audio" | "video";
      text?: { body: string; preview_url?: boolean };
      template?: {
        name: string;
        language: { code: string };
        components?: Array<Record<string, unknown>>;
      };
      image?: { link?: string; id?: string; caption?: string };
      document?: { link?: string; id?: string; filename?: string; caption?: string };
      audio?: { link?: string; id?: string };
      video?: { link?: string; id?: string; caption?: string };
    },
  ) => api.post(`/v1/instances/${instanceId}/waba/messages`, data),
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
  // Sprint webhooks: logs, retry, test selecionado
  deliveries: (id: string, webhookId: string, params?: { status?: string; event?: string; limit?: number; offset?: number }) =>
    api.get(`/v1/instances/${id}/webhooks/${webhookId}/deliveries`, { params }),
  retry: (id: string, webhookId: string, deliveryId: string) =>
    api.post(`/v1/instances/${id}/webhooks/${webhookId}/deliveries/${deliveryId}/retry`),
  test: (id: string, webhookId: string, eventId?: string) =>
    api.post(`/v1/instances/${id}/webhooks/${webhookId}/test`, { event_id: eventId }),
};

export const globalWebhooksApi = {
  // listEvents aceita scope (instance|global|both) e include_admin pra super admin
  listEvents: (params?: { scope?: "instance" | "global" | "both"; include_admin?: boolean }) =>
    api.get("/v1/webhooks/system/events", { params }),
  // Preview do payload sem disparar — útil pro dialog mostrar JSON exemplo
  previewEvent: (eventId: string) =>
    api.get(`/v1/webhooks/system/events/${encodeURIComponent(eventId)}/preview`),
  list: () => api.get("/v1/webhooks/system"),
  create: (data: { name: string; url: string; events: string[]; is_active?: boolean }) =>
    api.post("/v1/webhooks/system", data),
  update: (id: string, data: { name?: string; url?: string; events?: string[]; is_active?: boolean }) =>
    api.put(`/v1/webhooks/system/${id}`, data),
  delete: (id: string) => api.delete(`/v1/webhooks/system/${id}`),
  test: (id: string, eventId?: string) =>
    api.post(`/v1/webhooks/system/${id}/test`, { event_id: eventId }),
  deliveries: (id: string, params?: { status?: string; event?: string; limit?: number; offset?: number }) =>
    api.get(`/v1/webhooks/system/${id}/deliveries`, { params }),
  retry: (id: string, deliveryId: string) =>
    api.post(`/v1/webhooks/system/${id}/deliveries/${deliveryId}/retry`),
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
  update: (id: string, data: { name?: string; color?: string; icon?: string }) =>
    api.put(`/v1/workspaces/${id}`, data),
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
  previewInvite: (token: string) => api.get(`/v1/workspaces/invites/preview/${token}`),
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
  updateFunnel: (id: string, data: { name?: string; description?: string; color?: string }) => api.put(`/v1/crm/funnels/${id}`, data),
  deleteFunnel: (id: string) => api.delete(`/v1/crm/funnels/${id}`),
  listFunnelStages: (funnelId: string) => api.get(`/v1/crm/funnels/${funnelId}/stages`),
  createFunnelStage: (funnelId: string, data: { name: string; color?: string; order?: number }) => api.post(`/v1/crm/funnels/${funnelId}/stages`, data),
  updateFunnelStage: (funnelId: string, stageId: string, data: { name?: string; color?: string; order?: number }) => api.put(`/v1/crm/funnels/${funnelId}/stages/${stageId}`, data),
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
    action_type?: string;
    recipient_type: string;
    channel_config?: string;
    message_type?: string;
    message_text?: string;
    caption?: string;
    media_base64?: string;
    media_mime?: string;
    media_name?: string;
    template_name?: string;
    template_language?: string;
    template_variables?: Record<string, string>;
    template_header_url?: string;
    start_date?: string;
    end_date?: string;
    times_total?: number;
    times_per_day?: number;
    schedule_hours?: string;
    delay_seconds?: number;
    delay_min_seconds?: number;
    delay_max_seconds?: number;
    daily_limit_per_account?: number;
    recipients?: Array<{ phone: string; name?: string }>;
    segment_filter?: {
      funnel?: string; stage?: string; journey?: string;
      tags?: string[]; owner?: string; external_id?: string;
      segment_id?: string;
      purchased_shop_id?: string;
      purchased_since_days?: number;
      purchased_min_total?: number;
      purchased_status?: string;
      never_purchased?: boolean;
      passed_agent_id?: string;
    };
  }) => api.post("/v1/campaigns", data),
  get: (id: string) => api.get(`/v1/campaigns/${id}`),
  start: (id: string) => api.post(`/v1/campaigns/${id}/start`),
  pause: (id: string) => api.post(`/v1/campaigns/${id}/pause`),
  cancel: (id: string) => api.post(`/v1/campaigns/${id}/cancel`),
  delete: (id: string) => api.delete(`/v1/campaigns/${id}`),
};

// ─── Customer.io / Close-inspired modules ──────────────────────────
export const segmentsApi = {
  list: () => api.get("/v1/segments"),
  create: (data: { name: string; description?: string; type?: "dynamic" | "manual"; filter?: any; trigger_journey_id?: string }) =>
    api.post("/v1/segments", data),
  update: (id: string, data: any) => api.patch(`/v1/segments/${id}`, data),
  delete: (id: string) => api.delete(`/v1/segments/${id}`),
  preview: (filter: any) => api.post("/v1/segments/preview", { filter }),
  overlap: (ids: string[]) => api.post("/v1/segments/overlap", { ids }),
  importCSV: (id: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api.post(`/v1/segments/${id}/import-csv`, fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
};

export const suppressionsApi = {
  list: (params?: { channel?: string; q?: string }) =>
    api.get("/v1/suppressions", { params }),
  create: (data: { key: string; channel?: string; reason: string; note?: string }) =>
    api.post("/v1/suppressions", data),
  delete: (id: string) => api.delete(`/v1/suppressions/${id}`),
};

export const subscriptionTopicsApi = {
  list: () => api.get("/v1/subscription-topics"),
  create: (data: { slug: string; name: string; description?: string; is_required?: boolean; default_opt_in?: boolean }) =>
    api.post("/v1/subscription-topics", data),
  update: (id: string, data: any) => api.patch(`/v1/subscription-topics/${id}`, data),
  delete: (id: string) => api.delete(`/v1/subscription-topics/${id}`),
  generateLink: (contactId: string) =>
    api.post(`/v1/contacts/${contactId}/preference-link`),
};

export const crmImportApi = {
  contacts: (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return api.post("/v1/crm/contacts/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
  },
  companies: (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return api.post("/v1/crm/companies/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
  },
  deals: (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return api.post("/v1/crm/deals/import", fd, { headers: { "Content-Type": "multipart/form-data" } });
  },
};

export const contactsMergeApi = {
  duplicates: (by: "phone" | "email" = "phone") =>
    api.get("/v1/contacts/duplicates", { params: { by } }),
  merge: (survivor_id: string, looser_ids: string[]) =>
    api.post("/v1/contacts/merge", { survivor_id, looser_ids }),
};

export const integrationsApi = {
  list: (workspaceId?: string) =>
    api.get("/v1/integrations", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  create: (data: {
    provider: string;
    name: string;
    api_key: string;
    base_url?: string;
    models?: string[];
    config?: string;
    workspace_id?: string;
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
  stats: (workspaceId?: string) =>
    api.get("/v1/agent/stats", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  activity: (limit?: number, workspaceId?: string) =>
    api.get("/v1/agent/activity", {
      params: {
        ...(limit ? { limit } : {}),
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
      },
    }),
  instances: (workspaceId?: string) =>
    api.get("/v1/agent/instances", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
  stopExecution: (executionId: string) => api.post(`/v1/agent/executions/${executionId}/stop`),
};

export const journeysApi = {
  list: (workspaceId?: string) =>
    api.get("/v1/journeys", { params: workspaceId ? { workspace_id: workspaceId } : undefined }),
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

// Stripe — sempre cartão. Use direto pra "Pagar com cartão" indep
// do active_provider configurado no admin.
export const stripeApi = {
  plans: () => api.get("/v1/payments/plans"),
  createCheckout: (planId: string) => api.post("/v1/stripe/checkout", { plan_id: planId }),
  subscription: () => api.get("/v1/stripe/subscription"),
};

// Asaas — sempre PIX recorrente (cycle MONTHLY). User precisa fornecer CPF
// pra Asaas validar o customer. Não vendemos boleto nem PIX único.
export const asaasApi = {
  createCheckout: (data: { plan_id: string; cpf: string }) =>
    api.post("/v1/asaas/checkout", data),
  subscription: () => api.get("/v1/asaas/subscription"),
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
  deleteUser: (id: string) => api.delete(`/v1/admin/users/${id}?cascade=true`),
  listPlans: () => api.get("/v1/admin/plans"),
  createPlan: (data: Record<string, unknown>) => api.post("/v1/admin/plans", data),
  updatePlan: (id: string, data: Record<string, unknown>) =>
    api.put(`/v1/admin/plans/${id}`, data),
  getPaymentSettings: () => api.get("/v1/admin/payment-settings"),
  updatePaymentSettings: (data: Record<string, unknown>) =>
    api.put("/v1/admin/payment-settings", data),
  /** Testa conectividade de um provider (stripe|asaas) sem alterar config.
   *  Atualiza test_status que a UI consome. Útil pra revalidar credencial
   *  antiga (rotação de chave do lado do provider) sem precisar re-salvar. */
  testPaymentProvider: (provider: "stripe" | "asaas") =>
    api.post(`/v1/admin/payment-settings/test/${provider}`),
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
  getCommunicationSettings: () => api.get("/v1/admin/communication-settings"),
  updateCommunicationSettings: (data: Record<string, unknown>) =>
    api.put("/v1/admin/communication-settings", data),
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
  /** Comma-separated instance UUIDs ou um único id */
  instance_id?: string;
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
  if (p.instance_id) out.instance_id = p.instance_id;
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
    is_pinned?: boolean;
    is_muted?: boolean;
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
      media_key?: string;
      caption?: string;
      filename?: string;
      template_name?: string;
      template_language?: string;
      template_components?: Array<Record<string, unknown>>;
      reply_to_message_id?: string;
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
  // Message-level actions: revoke, edit, react, forward.
  revokeMessage: (workspaceId: string, id: string, msgId: string) =>
    api.delete(`/v1/conversations/${id}/messages/${msgId}`, { headers: wsHeaders(workspaceId) }),
  editMessage: (workspaceId: string, id: string, msgId: string, body: string) =>
    api.patch(`/v1/conversations/${id}/messages/${msgId}/content`, { body }, { headers: wsHeaders(workspaceId) }),
  reactToMessage: (workspaceId: string, id: string, msgId: string, emoji: string) =>
    api.post(`/v1/conversations/${id}/messages/${msgId}/react`, { emoji }, { headers: wsHeaders(workspaceId) }),
  forwardMessage: (workspaceId: string, id: string, msgId: string, conversationIds: string[]) =>
    api.post(
      `/v1/conversations/${id}/messages/${msgId}/forward`,
      { conversation_ids: conversationIds },
      { headers: wsHeaders(workspaceId) },
    ),
  getMessageReceipts: (workspaceId: string, id: string, msgId: string) =>
    api.get(`/v1/conversations/${id}/messages/${msgId}/receipts`, { headers: wsHeaders(workspaceId) }),
  searchMessages: (workspaceId: string, q: string, limit = 30) =>
    api.get(`/v1/conversations/messages/search`, {
      headers: wsHeaders(workspaceId),
      params: { q, limit },
    }),
  sendConstraints: (workspaceId: string, id: string) =>
    api.get(`/v1/conversations/${id}/send-constraints`, { headers: wsHeaders(workspaceId) }),
  assign: (workspaceId: string, id: string, userId?: string) =>
    api.post(`/v1/conversations/${id}/assign`, userId ? { user_id: userId } : {}, { headers: wsHeaders(workspaceId) }),
  unassign: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/unassign`, {}, { headers: wsHeaders(workspaceId) }),
  transfer: (workspaceId: string, id: string, data: { queue_id?: string; team_id?: string; department_id?: string; user_id?: string; note?: string }) =>
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

  // Agent State
  getAgentState: (workspaceId: string, id: string) =>
    api.get(`/v1/conversations/${id}/agent-state`, { headers: wsHeaders(workspaceId) }),
  setAgentState: (workspaceId: string, id: string, data: { mode: "active" | "observing" | "disabled"; agent_id?: string; handoff_reason?: string }) =>
    api.patch(`/v1/conversations/${id}/agent-state`, data, { headers: wsHeaders(workspaceId) }),
  suggestAgentReply: (workspaceId: string, id: string) =>
    api.post(`/v1/conversations/${id}/agent/suggest`, {}, { headers: wsHeaders(workspaceId) }),

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

// crmContactsApi — CRUD do contato no CRM. Usado pelo card de vCard
// na inbox pra "Adicionar ao CRM" diretamente.
export const crmContactsApi = {
  create: (workspaceId: string, data: {
    name: string;
    phone: string;
    email?: string;
    notes?: string;
    avatar_url?: string;
    funnel?: string;
    stage?: string;
    journey?: string;
    external_id?: string;
    owner_id?: string;
  }) =>
    api.post("/v1/crm/contacts", { ...data, workspace_id: workspaceId }, { headers: wsHeaders(workspaceId) }),
};

export type DealStatus = "open" | "won" | "lost" | "archived";
export type FunnelViewKind = "kanban" | "list" | "table" | "forecast";

export const companiesApi = {
  list: (
    workspaceId: string,
    params?: {
      q?: string;
      owner_id?: string;
      /** Empresas cujos contatos vêm de uma instância específica. */
      instance_id?: string;
      /** Empresas com pelo menos um contato com a tag. */
      tag_id?: string;
      /** Empresas com pelo menos um contato no funil. */
      funnel?: string;
      /** Empresas com pelo menos um contato na jornada. */
      journey?: string;
      limit?: number;
      offset?: number;
    },
  ) =>
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
  /** Filtra deals cujos contatos pertencem a uma instância específica. */
  instance_id?: string;
  /** Filtra deals que tem uma tag específica anexada. */
  tag_id?: string;
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

// ─── CRM Tasks ────────────────────────────────────────────────────────────────
export interface CrmTask {
  id: string;
  workspace_id: string;
  created_by_id: string;
  title: string;
  description?: string;
  type: "call" | "follow_up" | "message" | "meeting_prep" | "email" | "custom";
  status: "pending" | "in_progress" | "completed" | "cancelled";
  priority: "low" | "medium" | "high";
  due_at?: string;
  completed_at?: string;
  assignee_type: "user" | "agent";
  assignee_user_id?: string;
  assignee_agent_id?: string;
  contact_id?: string;
  company_id?: string;
  deal_id?: string;
  meeting_id?: string;
  conversation_id?: string;
  agent_instructions?: string;
  agent_instance_id?: string;
  agent_executed_at?: string;
  agent_result?: string;
  agent_error?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const crmTasksApi = {
  list: (workspaceId: string, params?: Record<string, unknown>) =>
    api.get("/v1/crm/tasks", { headers: wsHeaders(workspaceId), params }),
  get: (workspaceId: string, id: string) =>
    api.get(`/v1/crm/tasks/${id}`, { headers: wsHeaders(workspaceId) }),
  create: (workspaceId: string, data: Partial<CrmTask>) =>
    api.post("/v1/crm/tasks", data, { headers: wsHeaders(workspaceId) }),
  patch: (workspaceId: string, id: string, data: Partial<CrmTask>) =>
    api.patch(`/v1/crm/tasks/${id}`, data, { headers: wsHeaders(workspaceId) }),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/v1/crm/tasks/${id}`, { headers: wsHeaders(workspaceId) }),
  complete: (workspaceId: string, id: string) =>
    api.post(`/v1/crm/tasks/${id}/complete`, {}, { headers: wsHeaders(workspaceId) }),
};

// ─── CRM Meetings ─────────────────────────────────────────────────────────────
export interface CrmMeeting {
  id: string;
  workspace_id: string;
  created_by_id: string;
  title: string;
  description?: string;
  location?: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  start_at: string;
  end_at: string;
  timezone: string;
  deal_id?: string;
  contact_id?: string;
  company_id?: string;
  attendees?: Array<{
    user_id?: string;
    contact_id?: string;
    email?: string;
    name?: string;
    status?: string;
    is_organizer?: boolean;
  }>;
  meeting_url?: string;
  meeting_provider_name?: string;
  provider: "manual" | "google" | "outlook";
  external_calendar?: string;
  external_event_id?: string;
  external_event_link?: string;
  last_synced_at?: string;
  reminder_minutes?: number[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const crmMeetingsApi = {
  list: (workspaceId: string, params?: Record<string, unknown>) =>
    api.get("/v1/crm/meetings", { headers: wsHeaders(workspaceId), params }),
  get: (workspaceId: string, id: string) =>
    api.get(`/v1/crm/meetings/${id}`, { headers: wsHeaders(workspaceId) }),
  create: (workspaceId: string, data: Partial<CrmMeeting>) =>
    api.post("/v1/crm/meetings", data, { headers: wsHeaders(workspaceId) }),
  patch: (workspaceId: string, id: string, data: Partial<CrmMeeting>) =>
    api.patch(`/v1/crm/meetings/${id}`, data, { headers: wsHeaders(workspaceId) }),
  delete: (workspaceId: string, id: string) =>
    api.delete(`/v1/crm/meetings/${id}`, { headers: wsHeaders(workspaceId) }),
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

// ─── Voices / TTS ────────────────────────────────────────────────────────────

// ─── Window Keeper ───────────────────────────────────────────────────────────

export const windowKeeperApi = {
  set: (workspaceId: string, conversationId: string, enabled: boolean, message?: string) =>
    api.patch(`/v1/conversations/${conversationId}/window-keeper`,
      { enabled, message },
      { headers: wsHeaders(workspaceId) }),
};

export const voicesApi = {
  listProviders: (workspaceId: string) =>
    api.get("/v1/voices/providers", { headers: wsHeaders(workspaceId) }),
  createProvider: (workspaceId: string, data: { provider: string; name: string; api_key: string }) =>
    api.post("/v1/voices/providers", data, { headers: wsHeaders(workspaceId) }),
  deleteProvider: (workspaceId: string, id: string) =>
    api.delete(`/v1/voices/providers/${id}`, { headers: wsHeaders(workspaceId) }),
  testProvider: (workspaceId: string, id: string) =>
    api.post(`/v1/voices/providers/${id}/test`, {}, { headers: wsHeaders(workspaceId) }),
  getUsage: (workspaceId: string, id: string) =>
    api.get(`/v1/voices/providers/${id}/usage`, { headers: wsHeaders(workspaceId) }),
  syncVoices: (workspaceId: string, providerId: string) =>
    api.post(`/v1/voices/providers/${providerId}/sync`, {}, { headers: wsHeaders(workspaceId) }),
  cloneVoice: (workspaceId: string, providerId: string, form: FormData) =>
    api.post(`/v1/voices/providers/${providerId}/clone`, form, {
      headers: { ...wsHeaders(workspaceId), "Content-Type": "multipart/form-data" },
    }),
  listVoices: (workspaceId: string, params?: { provider_id?: string; active?: string }) =>
    api.get("/v1/voices/", { headers: wsHeaders(workspaceId), params }),
  toggleVoice: (workspaceId: string, id: string, is_active: boolean) =>
    api.patch(`/v1/voices/${id}`, { is_active }, { headers: wsHeaders(workspaceId) }),
  deleteVoice: (workspaceId: string, id: string) =>
    api.delete(`/v1/voices/${id}`, { headers: wsHeaders(workspaceId) }),
  testTTS: (workspaceId: string, voice_id: string, text?: string) =>
    api.post("/v1/voices/test", { voice_id, text }, { headers: wsHeaders(workspaceId), responseType: "arraybuffer" }),
};

// ─── Platform AI (Uniq AI) ────────────────────────────────────────────────────
export interface PlatformAIConfig {
  id?: string;
  provider: string;
  name: string;
  base_url?: string;
  models?: string;
  config?: string;
  is_active: boolean;
  has_api_key?: boolean;
  test_status?: string;
  last_tested_at?: string;
}

export const platformAIApi = {
  // Admin endpoints (multi-config)
  list: () => api.get<PlatformAIConfig[]>("/v1/admin/platform-ai"),
  create: (data: Partial<PlatformAIConfig> & { api_key?: string }) =>
    api.post<{ ok: boolean; id: string }>("/v1/admin/platform-ai", data),
  update: (id: string, data: Partial<PlatformAIConfig> & { api_key?: string }) =>
    api.put<{ ok: boolean; id: string }>(`/v1/admin/platform-ai/${id}`, data),
  delete: (id: string) => api.delete(`/v1/admin/platform-ai/${id}`),
  test: (id: string) =>
    api.post<{ ok: boolean; message: string }>(`/v1/admin/platform-ai/${id}/test`),
  // Public endpoint (active configs for ModelSelector)
  listPublic: () => api.get<PlatformAIConfig[]>("/v1/integrations/platform-ai"),
};
