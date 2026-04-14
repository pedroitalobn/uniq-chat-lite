export interface User {
  id: string;
  name: string;
  email: string;
  username?: string;
  role: UserRole;
  is_beta?: boolean;
  plan?: Plan;
  is_active: boolean;
  blocked_until?: string;
  created_at: string;
}

export type UserRole = "super_admin" | "customer" | "lead";

export interface Server {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description?: string;
  is_active: boolean;
  proxy_pool_id?: string;
  proxy_pool?: ProxyPool;
  webhook_url?: string;
  created_at: string;
  updated_at: string;
}

export interface ProxyPool {
  id: string;
  name: string;
  provider: string;
  status: string;
  current_instances?: number;
  max_instances?: number;
}

export interface ProxyProviderConfig {
  id: string;
  user_id: string;
  provider: string;
  name: string;
  api_key_masked?: string;
  country: string;
  is_active: boolean;
  proxy_type?: string;
  proxy_host?: string;
  proxy_port?: number;
  proxy_username?: string;
  created_at: string;
  updated_at: string;
}

export interface ServerStats {
  total_instances: number;
  connected: number;
  disconnected: number;
  connecting: number;
  banned: number;
  total_messages: number;
}

export interface Plan {
  id: string;
  name: string;
  price: number;
  max_instances: number;
  max_messages_per_day: number;
  max_users: number;
  max_workspaces: number;
  features: string; // JSON-encoded string from API
  allow_proxy: boolean;
  is_active: boolean;
  stripe_price_id?: string;
}

export type ChannelType = "whatsapp" | "instagram" | "facebook" | "telegram" | "linkedin" | "tiktok" | "kwai" | "waba";

export interface ChannelInfo {
  id: ChannelType;
  label: string;
  color: string;
  description: string;
  available: boolean;
}

export type InstanceStatus = "disconnected" | "connecting" | "connected" | "banned";
export type ProxyMode = "none" | "manual" | "residencial";
export type ProxyStatus = "untested" | "ok" | "failed";
export type ProxyType = "http" | "https" | "socks5";

export interface InstanceSettings {
  always_online: boolean;
  reject_calls: boolean;
  read_messages: boolean;
  ignore_groups: boolean;
  ignore_status: boolean;
}

export interface Instance {
  id: string;
  user_id: string;
  server_id?: string;
  server?: Server;
  name: string;
  slug: string;
  token: string;
  channel: ChannelType;
  phone_number?: string;
  status: InstanceStatus;
  // Proxy
  proxy_mode?: ProxyMode;
  proxy_enabled: boolean;
  proxy_type?: ProxyType;
  proxy_host?: string;
  proxy_port?: number;
  proxy_username?: string;
  proxy_status: ProxyStatus;
  proxy_last_tested?: string;
  proxy_external_ip?: string;
  proxy_error?: string;
  proxy_pool_id?: string;
  use_global_proxy?: boolean;
  global_proxy_id?: string;
  connected_at?: string;
  // MCP
  mcp_enabled: boolean;
  // Advanced settings
  always_online: boolean;
  reject_calls: boolean;
  read_messages: boolean;
  ignore_groups: boolean;
  ignore_status: boolean;
  // Instagram-specific
  instagram_username?: string;
  instagram_device_id?: string;
  is_paused?: boolean;
  last_message_at?: string;
  created_at: string;
  updated_at: string;
}

export interface APIKey {
  id: string;
  name: string;
  key_prefix: string;
  masked_key: string;
  is_active: boolean;
  last_used_at?: string;
  created_at: string;
}

export interface Webhook {
  id: string;
  instance_id: string;
  name: string;
  is_active: boolean;
  events: string; // JSON array string
  // Filters
  ignore_groups: boolean;
  ignore_self: boolean;
  ignore_api_sent: boolean;
  // HTTP (primary)
  url?: string;
  // RabbitMQ bridge
  rabbitmq_enabled: boolean;
  amqp_url?: string;
  exchange?: string;
  routing_key?: string;
  // NATS bridge
  nats_enabled: boolean;
  nats_url?: string;
  nats_subject?: string;
  // WebSocket bridge
  ws_enabled: boolean;
  ws_client_url?: string;
  created_at: string;
}

export interface InstanceProfile {
  phone_number: string;
  profile_pic_url: string;
  conversations: number;
  status: string;
  connected_at?: string;
}

export interface MessageLog {
  id: string;
  instance_id: string;
  direction: "in" | "out";
  type: string;
  to_jid?: string;
  content: string;
  status: string;
  created_at: string;
}

export interface Stats {
  users: { total: number; active: number };
  instances: { total: number; connected: number };
  messages: { total: number; today: number };
}

// ─── CRM ─────────────────────────────────────────────────────────────────────

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: string;
}

export type ContactSource = "whatsapp" | "waba" | "instagram" | "telegram" | "linkedin" | "tiktok" | "kwai" | "manual";

export interface Contact {
  id: string;
  user_id: string;
  owner_id?: string;
  workspace_id?: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  avatar_url?: string;
  source?: ContactSource;
  instance_id?: string;
  funnel?: string;
  stage?: string;
  journey?: string;
  external_id?: string;
  tags: Tag[];
  created_at: string;
  updated_at: string;
}

export interface PipelineStage {
  id: string;
  workspace_id: string;
  name: string;
  order: number;
  color: string;
  is_default: boolean;
  funnel?: string;
}

export type ActivityType = "created" | "stage_changed" | "note_added" | "assigned" | "messaged";

export interface ContactActivity {
  id: string;
  contact_id: string;
  user_id: string;
  type: ActivityType;
  description: string;
  metadata?: string;
  created_at: string;
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "failed";
export type RecipientStatus = "pending" | "sent" | "failed";
export type RecipientType = "contacts" | "groups";
export type MessageType = "text" | "image" | "audio" | "document";

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  phone: string; // phone number or group JID
  name?: string;
  status: RecipientStatus;
  send_count: number;
  sent_today: number;
  last_sent_date?: string;
  message_id?: string;
  error?: string;
  sent_at?: string;
  created_at: string;
}

export interface Campaign {
  id: string;
  user_id: string;
  instance_id: string;
  name: string;
  recipient_type: RecipientType;
  message_type: MessageType;
  message_text: string;
  caption?: string;
  media_mime?: string;
  media_name?: string;
  // Scheduling
  start_date?: string;
  end_date?: string;
  times_total: number;
  times_per_day: number;
  schedule_hours: string; // JSON: "[9,14,18]"
  delay_seconds: number;
  // State
  status: CampaignStatus;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  total_count: number;
  sent_count: number;
  failed_count: number;
  recipients?: CampaignRecipient[];
  created_at: string;
  updated_at: string;
}

// ─── Workspace & Multi-tenancy ──────────────────────────────────────────────

export interface Workspace {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  plan_id?: string;
  is_active: boolean;
  is_owner: boolean;
  role?: Role;
  joined_at: string;
  created_at: string;
}

export interface Role {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  permissions: Permission[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Permission {
  id: string;
  key: string;
  name: string;
  description?: string;
  category: string;
  created_at: string;
}

export interface UserWorkspace {
  id: string;
  user_id: string;
  workspace_id: string;
  user?: User;
  role?: Role;
  is_owner: boolean;
  joined_at: string;
}

export interface Invite {
  id: string;
  workspace_id: string;
  email: string;
  role_id: string;
  role?: Role;
  invited_by: string;
  inviter?: User;
  token: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  expires_at: string;
  created_at: string;
}

// ─── WABA (WhatsApp Business API) ─────────────────────────────────────────────

export interface WABAInstance {
  id: string;
  instance_id: string;
  waba_id: string;
  phone_number_id: string;
  phone_number: string;
  business_name: string;
  created_at: string;
}

export interface WABAAuthURL {
  url: string;
}
