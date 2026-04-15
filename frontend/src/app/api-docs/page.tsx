"use client";

import { useState } from "react";
import {
  ChevronRight, ChevronDown, Copy, Check, Globe, Key,
  MessageSquare, Webhook, Smartphone, Send, BookOpen,
  Users, Tag, Megaphone, Bot, Shield, Settings, Zap,
  Hash, FileText, Phone, Video, Image, Music, MapPin,
  RefreshCw, Lock, LogIn, CreditCard, BarChart2
} from "lucide-react";
import { Logo } from "@/components/Logo";

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

interface Endpoint {
  method: Method;
  path: string;
  description: string;
  auth?: "token" | "bearer" | "none";
  body?: Record<string, any>;
  params?: Record<string, string>;
  response?: string;
}

interface Section {
  id: string;
  title: string;
  icon: React.ElementType;
  description: string;
  badge?: string;
  endpoints: Endpoint[];
}

const BASE = "https://api.uniq.chat";
const V1_BASE = `${BASE}/v1/{server}/{instance}`;

const SECTIONS: Section[] = [
  {
    id: "auth",
    title: "Autenticação",
    icon: LogIn,
    description: "Login, registro, refresh de tokens e gerenciamento de conta",
    badge: "Público",
    endpoints: [
      { method: "POST", path: "/auth/login", description: "Login com email/username e senha", auth: "none", body: { identifier: "email@exemplo.com", password: "senha123" }, response: `{ "access_token": "...", "refresh_token": "..." }` },
      { method: "POST", path: "/auth/register", description: "Criar nova conta de usuário", auth: "none", body: { name: "João Silva", email: "joao@exemplo.com", password: "senha123" }, response: `{ "access_token": "...", "user": { "id": "..." } }` },
      { method: "POST", path: "/auth/refresh", description: "Renovar access token usando refresh token", auth: "none", body: { refresh_token: "..." }, response: `{ "access_token": "..." }` },
      { method: "POST", path: "/auth/logout", description: "Encerrar sessão e invalidar token", auth: "bearer" },
      { method: "POST", path: "/auth/forgot-password", description: "Solicitar e-mail de redefinição de senha", auth: "none", body: { email: "email@exemplo.com" } },
      { method: "POST", path: "/auth/reset-password", description: "Redefinir senha com token recebido por e-mail", auth: "none", body: { token: "...", password: "novaSenha123" } },
      { method: "GET",  path: "/auth/me", description: "Retorna dados do usuário autenticado", auth: "bearer", response: `{ "id": "...", "name": "João", "email": "..." }` },
      { method: "PUT",  path: "/auth/me", description: "Atualizar dados do perfil do usuário", auth: "bearer", body: { name: "Novo Nome" } },
      { method: "POST", path: "/auth/change-password", description: "Alterar senha do usuário autenticado", auth: "bearer", body: { current_password: "...", new_password: "..." } },
    ],
  },
  {
    id: "messages",
    title: "Mensagens",
    icon: MessageSquare,
    description: "Envio de todos os tipos de mensagens via WhatsApp",
    badge: "V1 API",
    endpoints: [
      { method: "GET",  path: "/v1/{server}/{instance}/messages", description: "Listar histórico de mensagens de um chat", auth: "token", params: { jid: "5511999999999@s.whatsapp.net", limit: "50" }, response: `[{ "id": "...", "body": "texto", "from": "...", "timestamp": 1234567890 }]` },
      { method: "POST", path: "/v1/{server}/{instance}/messages/text", description: "Enviar mensagem de texto simples", auth: "token", body: { to: "5511999999999@s.whatsapp.net", text: "Olá!" }, response: `{ "status": "sent", "messageId": "..." }` },
      { method: "POST", path: "/v1/{server}/{instance}/messages/image", description: "Enviar imagem com legenda opcional", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://...", caption: "Legenda" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/document", description: "Enviar documento (PDF, DOCX, etc.)", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://...", filename: "arquivo.pdf" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/audio", description: "Enviar áudio ou nota de voz", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://...", ptt: false } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/video", description: "Enviar vídeo com legenda opcional", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://...", caption: "Vídeo" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/location", description: "Enviar localização com lat/lng", auth: "token", body: { to: "5511999999999@s.whatsapp.net", latitude: -23.5505, longitude: -46.6333, name: "São Paulo" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/contact", description: "Enviar contato como vCard", auth: "token", body: { to: "5511999999999@s.whatsapp.net", contact: { name: "João", phone: "5511888888888" } } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/reaction", description: "Reagir a uma mensagem com emoji", auth: "token", body: { to: "5511999999999@s.whatsapp.net", message_id: "...", emoji: "👍" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/poll", description: "Enviar enquete", auth: "token", body: { to: "5511999999999@s.whatsapp.net", question: "Qual opção?", options: ["A", "B", "C"] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/buttons", description: "Enviar template com botões hidratados (reply/url/call)", auth: "token", body: { to: "5511999999999@s.whatsapp.net", body: "Escolha uma opção", footer: "Uniq.chat", buttons: [{ id: "sim", text: "Sim", type: "reply" }, { text: "Abrir site", type: "url", url: "https://uniq.chat" }, { text: "Ligar", type: "call", phone: "+5511999999999" }] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/template", description: "Enviar template message com quick reply, URL e ligação", auth: "token", body: { to: "5511999999999@s.whatsapp.net", content: "Template content", footer: "Some footer text", buttons: [{ display_text: "Yes", type: "quickreply", id: "yes" }, { display_text: "No", type: "quickreply", id: "no" }, { display_text: "Visit Site", type: "url", url: "https://www.fop2.com" }, { display_text: "Llamame", type: "call", phone_number: "1155554444" }] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/list", description: "Enviar lista estruturada", auth: "token", body: { to: "5511999999999@s.whatsapp.net", title: "Catálogo", description: "Escolha uma opção", button_text: "Ver opções", footer: "Uniq.chat", sections: [{ title: "Seção 1", rows: [{ id: "opcao_1", title: "Opção 1", description: "Descrição curta" }] }] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/menu", description: "Enviar menu unificado (button, list, poll ou carousel)", auth: "token", body: { number: "5511999999999", type: "list", text: "Escolha uma opção", listButton: "Abrir menu", footerText: "Uniq.chat", choices: ["[Atendimento]", "Suporte|suporte|Falar com suporte", "Financeiro|financeiro|2ª via e pagamentos"] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/sticker", description: "Enviar sticker/figurinha", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://..." } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/status", description: "Publicar status/story em texto, imagem ou vídeo", auth: "token", body: { text: "Bom dia, clientes!", bg_color: "#103529" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/presence", description: "Atualizar presença global da conta", auth: "token", body: { available: true } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/typing", description: "Simular indicador de digitação", auth: "token", body: { to: "5511999999999@s.whatsapp.net", duration: 3000 } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/read", description: "Marcar mensagem como lida", auth: "token", body: { jid: "5511999999999@s.whatsapp.net", message_id: "..." } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/revoke", description: "Apagar mensagem enviada", auth: "token", body: { jid: "5511999999999@s.whatsapp.net", message_id: "..." } },
      { method: "POST", path: "/v1/{server}/{instance}/media/upload", description: "Fazer upload de mídia e obter URL", auth: "token", body: { file: "(multipart/form-data)" } },
    ],
  },
  {
    id: "instance",
    title: "Instâncias",
    icon: Smartphone,
    description: "Conexão, status, QR Code e configurações das instâncias WhatsApp",
    badge: "V1 API",
    endpoints: [
      { method: "GET",  path: "/v1/{server}/{instance}/status", description: "Status de conexão da instância", auth: "token", response: `{ "status": "connected", "phone": "5511999..." }` },
      { method: "GET",  path: "/v1/{server}/{instance}/qr", description: "Obter QR Code para conexão", auth: "token", response: `{ "qr": "data:image/png;base64,..." }` },
      { method: "POST", path: "/v1/{server}/{instance}/pairing-code", description: "Gerar código de pareamento (sem QR)", auth: "token", body: { phone: "5511999999999" }, response: `{ "code": "ABCD-1234" }` },
      { method: "GET",  path: "/v1/{server}/{instance}/profile", description: "Obter perfil do número conectado", auth: "token", response: `{ "name": "...", "about": "...", "picture": "..." }` },
      { method: "GET",  path: "/v1/{server}/{instance}/chats", description: "Listar todos os chats", auth: "token", response: `[{ "jid": "...", "name": "...", "unread": 3 }]` },
      { method: "GET",  path: "/v1/{server}/{instance}/contacts", description: "Listar contatos salvos", auth: "token", response: `[{ "jid": "...", "name": "...", "phone": "..." }]` },
      { method: "POST", path: "/v1/{server}/{instance}/check-number", description: "Verificar se número tem WhatsApp", auth: "token", body: { phone: "5511999999999" }, response: `{ "exists": true, "jid": "..." }` },
      { method: "POST", path: "/v1/{server}/{instance}/bulk-check", description: "Verificar múltiplos números em lote", auth: "token", body: { phones: ["5511999999999", "5511888888888"] }, response: `[{ "phone": "...", "exists": true }]` },
      { method: "POST", path: "/v1/{server}/{instance}/contact/info", description: "Consultar nome, JID canônico e avatar de um contato", auth: "token", body: { phone: "5511999999999" }, response: `{ "query": "5511999999999", "exists": true, "jid": "5511999999999@s.whatsapp.net", "phone": "5511999999999", "push_name": "Cliente", "avatar_url": "https://..." }` },
      { method: "POST", path: "/v1/{server}/{instance}/contact/avatar", description: "Buscar apenas o avatar de um contato", auth: "token", body: { jid: "5511999999999@s.whatsapp.net" }, response: `{ "query": "5511999999999@s.whatsapp.net", "exists": true, "jid": "5511999999999@s.whatsapp.net", "avatar_url": "https://..." }` },
    ],
  },
  {
    id: "groups",
    title: "Grupos",
    icon: Users,
    description: "Criação e gerenciamento de grupos do WhatsApp",
    badge: "V1 API",
    endpoints: [
      { method: "GET",  path: "/v1/{server}/{instance}/groups", description: "Listar todos os grupos", auth: "token", response: `[{ "id": "...", "subject": "Grupo 1", "participants": 42 }]` },
      { method: "POST", path: "/v1/{server}/{instance}/groups", description: "Criar novo grupo", auth: "token", body: { name: "Meu Grupo", participants: ["5511999999999@s.whatsapp.net"] } },
      { method: "GET",  path: "/v1/{server}/{instance}/groups/{jid}", description: "Obter detalhes e participantes de um grupo", auth: "token", response: `{ "id": "...", "subject": "...", "participants": [...] }` },
      { method: "PUT",  path: "/v1/{server}/{instance}/groups/{jid}", description: "Atualizar nome ou foto do grupo", auth: "token", body: { subject: "Novo Nome" } },
      { method: "POST", path: "/v1/{server}/{instance}/groups/{jid}/participants", description: "Adicionar, remover ou promover participantes", auth: "token", body: { action: "add", participants: ["5511999999999@s.whatsapp.net"] } },
      { method: "GET",  path: "/v1/{server}/{instance}/groups/{jid}/invite", description: "Obter link de convite do grupo", auth: "token", response: `{ "link": "https://chat.whatsapp.com/..." }` },
      { method: "POST", path: "/v1/{server}/{instance}/groups/{jid}/leave", description: "Sair de um grupo", auth: "token" },
    ],
  },
  {
    id: "webhooks",
    title: "Webhooks",
    icon: Webhook,
    description: "Configurar notificações em tempo real para eventos do WhatsApp",
    endpoints: [
      { method: "GET",  path: "/instances/{id}/webhooks", description: "Listar webhooks configurados na instância", auth: "bearer", response: `[{ "id": "...", "url": "https://...", "events": ["message.received"] }]` },
      { method: "POST", path: "/instances/{id}/webhooks", description: "Criar novo webhook. O secret é retornado apenas na criação.", auth: "bearer", body: { url: "https://seu-servidor.com/webhook", events: ["message.received", "connection.update"] }, response: `{ "id": "...", "url": "...", "secret": "...", "events": ["message.received"] }` },
      { method: "PUT",  path: "/instances/{id}/webhooks/{webhookId}", description: "Atualizar URL ou eventos do webhook", auth: "bearer", body: { url: "https://novo-endpoint.com/wh", events: ["message.received"] } },
      { method: "DELETE", path: "/instances/{id}/webhooks/{webhookId}", description: "Remover webhook", auth: "bearer" },
    ],
  },
  {
    id: "otp",
    title: "OTP",
    icon: Lock,
    description: "Envio e verificação de códigos OTP via WhatsApp",
    badge: "V1 API",
    endpoints: [
      { method: "POST", path: "/v1/{server}/{instance}/otp/send", description: "Enviar código OTP para um número", auth: "token", body: { phone: "5511999999999", template: "Seu código: {{code}}" }, response: `{ "session_id": "...", "expires_at": "..." }` },
      { method: "POST", path: "/v1/{server}/{instance}/otp/verify", description: "Verificar código OTP informado", auth: "token", body: { session_id: "...", code: "123456" }, response: `{ "valid": true }` },
      { method: "POST", path: "/v1/{server}/{instance}/otp/resend", description: "Reenviar código OTP para a sessão", auth: "token", body: { session_id: "..." } },
      { method: "GET",  path: "/v1/{server}/{instance}/otp/sessions", description: "Listar sessões OTP ativas", auth: "token", response: `[{ "id": "...", "phone": "...", "status": "pending" }]` },
    ],
  },
  {
    id: "crm",
    title: "CRM & Contatos",
    icon: Tag,
    description: "Gerenciamento de contatos, tags e relacionamentos",
    endpoints: [
      { method: "GET",    path: "/crm/contacts", description: "Listar contatos do CRM", auth: "bearer", response: `[{ "id": "...", "name": "...", "tags": [] }]` },
      { method: "POST",   path: "/crm/contacts", description: "Criar novo contato", auth: "bearer", body: { name: "João Silva", phone: "5511999999999", email: "joao@exemplo.com" } },
      { method: "GET",    path: "/crm/contacts/{id}", description: "Obter contato por ID", auth: "bearer" },
      { method: "PUT",    path: "/crm/contacts/{id}", description: "Atualizar contato", auth: "bearer", body: { name: "Novo Nome", email: "novo@email.com" } },
      { method: "DELETE", path: "/crm/contacts/{id}", description: "Remover contato", auth: "bearer" },
      { method: "PUT",    path: "/crm/contacts/{id}/tags", description: "Atribuir ou remover tags de um contato", auth: "bearer", body: { tags: ["vip", "cliente"] } },
      { method: "GET",    path: "/crm/tags", description: "Listar todas as tags disponíveis", auth: "bearer", response: `[{ "id": "...", "name": "vip", "color": "#00d46a" }]` },
      { method: "POST",   path: "/crm/tags", description: "Criar nova tag", auth: "bearer", body: { name: "vip", color: "#00d46a" } },
      { method: "DELETE", path: "/crm/tags/{id}", description: "Remover tag", auth: "bearer" },
    ],
  },
  {
    id: "campaigns",
    title: "Campanhas",
    icon: Megaphone,
    description: "Criação e gerenciamento de campanhas de disparo em massa",
    endpoints: [
      { method: "GET",    path: "/campaigns", description: "Listar todas as campanhas", auth: "bearer", response: `[{ "id": "...", "name": "Black Friday", "status": "active" }]` },
      { method: "POST",   path: "/campaigns", description: "Criar nova campanha", auth: "bearer", body: { name: "Black Friday", instance_id: "...", contacts: ["5511999999999"], message: "Promoção especial!" } },
      { method: "GET",    path: "/campaigns/{id}", description: "Obter detalhes da campanha", auth: "bearer" },
      { method: "POST",   path: "/campaigns/{id}/start", description: "Iniciar disparo da campanha", auth: "bearer" },
      { method: "POST",   path: "/campaigns/{id}/pause", description: "Pausar campanha em andamento", auth: "bearer" },
      { method: "POST",   path: "/campaigns/{id}/cancel", description: "Cancelar campanha", auth: "bearer" },
      { method: "DELETE", path: "/campaigns/{id}", description: "Remover campanha", auth: "bearer" },
    ],
  },
  {
    id: "integrations",
    title: "Integrações de IA",
    icon: Bot,
    description: "Gerenciar provedores de LLM conectados (OpenAI, Claude, DeepSeek, etc.)",
    endpoints: [
      { method: "GET",    path: "/integrations", description: "Listar integrações de IA configuradas", auth: "bearer", response: `[{ "id": "...", "provider": "openai", "name": "GPT-4", "is_active": true }]` },
      { method: "POST",   path: "/integrations", description: "Criar nova integração de IA", auth: "bearer", body: { provider: "openai", name: "Meu GPT", api_key: "sk-...", model: "gpt-4o" } },
      { method: "PUT",    path: "/integrations/{id}", description: "Atualizar configurações da integração", auth: "bearer", body: { model: "gpt-4o-mini", is_active: true } },
      { method: "DELETE", path: "/integrations/{id}", description: "Remover integração", auth: "bearer" },
      { method: "POST",   path: "/integrations/{id}/test", description: "Testar se a integração está funcionando", auth: "bearer", response: `{ "status": "ok", "latency_ms": 320 }` },
      { method: "POST",   path: "/ai/generate", description: "Gerar variações de texto com IA", auth: "bearer", body: { text: "Olá, tudo bem?", count: 3 }, response: `{ "variations": ["...", "...", "..."] }` },
    ],
  },
  {
    id: "ai-chat",
    title: "Chat IA / Jornadas",
    icon: Zap,
    description: "Conversar com a IA e criar jornadas de automação",
    endpoints: [
      { method: "POST", path: "/ai/chat", description: "Enviar mensagem para o assistente IA com contexto de jornadas e instâncias", auth: "bearer", body: { message: "Crie uma jornada para responder mensagens no grupo @vendas", integration_id: "(opcional)" }, response: `{ "response": "...", "journey_created": false }` },
      { method: "GET",  path: "/ai/tools", description: "Listar ferramentas disponíveis para o assistente IA", auth: "bearer", response: `{ "tools": [{ "name": "list_journeys", "description": "..." }] }` },
      { method: "GET",  path: "/journeys", description: "Listar jornadas de automação", auth: "bearer", response: `[{ "id": "...", "prompt": "...", "status": "active", "invocations": 10 }]` },
      { method: "POST", path: "/journeys", description: "Criar nova jornada de automação via prompt", auth: "bearer", body: { prompt: "Quando alguém falar 'preço' no grupo @vendas, responda com o catálogo", integration_id: "(opcional)" } },
      { method: "PATCH", path: "/journeys/{id}/status", description: "Ativar ou pausar uma jornada", auth: "bearer", body: { status: "active" } },
      { method: "DELETE", path: "/journeys/{id}", description: "Remover jornada de automação", auth: "bearer" },
      { method: "GET",  path: "/journeys/{id}", description: "Obter detalhes de uma jornada", auth: "bearer" },
    ],
  },
  {
    id: "apikeys",
    title: "API Keys",
    icon: Key,
    description: "Gerenciar chaves de API para acesso programático",
    endpoints: [
      { method: "GET",    path: "/api-keys", description: "Listar suas API Keys", auth: "bearer", response: `[{ "id": "...", "name": "Minha Key", "masked_key": "sk-...xyz" }]` },
      { method: "POST",   path: "/api-keys", description: "Criar nova API Key", auth: "bearer", body: { name: "Produção" }, response: `{ "key": "sk-...", "name": "Produção" }` },
      { method: "DELETE", path: "/api-keys/{id}", description: "Revogar API Key", auth: "bearer" },
    ],
  },
  {
    id: "instances-mgmt",
    title: "Gestão de Instâncias",
    icon: Settings,
    description: "Criar, gerenciar e configurar instâncias WhatsApp",
    endpoints: [
      { method: "GET",    path: "/instances", description: "Listar instâncias do usuário", auth: "bearer", response: `[{ "id": "...", "name": "pedro-sp", "status": "connected" }]` },
      { method: "POST",   path: "/instances", description: "Criar nova instância", auth: "bearer", body: { name: "minha-instancia", server_id: "..." } },
      { method: "GET",    path: "/instances/{id}", description: "Obter detalhes de uma instância", auth: "bearer" },
      { method: "DELETE", path: "/instances/{id}", description: "Remover instância", auth: "bearer" },
      { method: "POST",   path: "/instances/{id}/disconnect", description: "Desconectar WhatsApp da instância", auth: "bearer" },
      { method: "POST",   path: "/instances/{id}/reconnect", description: "Reconectar instância", auth: "bearer" },
      { method: "POST",   path: "/instances/{id}/regenerate-token", description: "Gerar novo token de instância", auth: "bearer" },
      { method: "GET",    path: "/instances/{id}/settings", description: "Obter configurações da instância", auth: "bearer" },
      { method: "PUT",    path: "/instances/{id}/settings", description: "Atualizar configurações da instância", auth: "bearer", body: { auto_read: true, webhook_url: "https://..." } },
      { method: "GET",    path: "/instances/{id}/agent", description: "Obter configuração do agente de IA da instância", auth: "bearer" },
      { method: "PUT",    path: "/instances/{id}/agent", description: "Configurar agente de IA para a instância", auth: "bearer", body: { enabled: true, integration_id: "...", system_prompt: "Você é um atendente..." } },
    ],
  },
];

const METHOD_COLORS: Record<string, { bg: string; text: string }> = {
  GET:    { bg: "rgba(34,197,94,0.12)",  text: "#22c55e" },
  POST:   { bg: "rgba(59,130,246,0.12)", text: "#3b82f6" },
  PUT:    { bg: "rgba(234,179,8,0.12)",  text: "#eab308" },
  PATCH:  { bg: "rgba(249,115,22,0.12)", text: "#f97316" },
  DELETE: { bg: "rgba(239,68,68,0.12)",  text: "#ef4444" },
};

const AUTH_LABELS: Record<string, { label: string; color: string; header: string }> = {
  token:  { label: "Instance Token", color: "#eab308", header: "X-Instance-Token: <token>" },
  bearer: { label: "Bearer JWT",     color: "#3b82f6", header: "Authorization: Bearer <token>" },
  none:   { label: "Público",        color: "#6b7280", header: "" },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="p-1.5 rounded transition-opacity hover:opacity-80"
    >
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-400" />
        : <Copy className="w-3.5 h-3.5" style={{ color: "#6b7280" }} />}
    </button>
  );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
  const [open, setOpen] = useState(false);
  const mc = METHOD_COLORS[ep.method];
  const auth = ep.auth ? AUTH_LABELS[ep.auth] : AUTH_LABELS.none;

  const curlBody = ep.body ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(ep.body)}'` : "";
  const curlAuth = ep.auth === "token"
    ? `\\\n  -H "X-Instance-Token: SEU_TOKEN" `
    : ep.auth === "bearer"
    ? `\\\n  -H "Authorization: Bearer SEU_JWT" `
    : "";
  const curlCmd = `curl -X ${ep.method} ${BASE}${ep.path} ${curlAuth}${curlBody}`;

  return (
    <div className="rounded-xl overflow-hidden border" style={{ borderColor: "hsl(240 8% 16%)" }}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
        style={{ background: "hsl(240 8% 10%)" }}
        onClick={() => setOpen(!open)}
      >
        <span className="text-xs font-bold px-2 py-0.5 rounded shrink-0 min-w-[52px] text-center" style={{ background: mc.bg, color: mc.text }}>
          {ep.method}
        </span>
        <code className="text-sm font-mono flex-1 truncate" style={{ color: "hsl(240 8% 80%)" }}>{ep.path}</code>
        <span className="text-xs hidden sm:block shrink-0" style={{ color: "hsl(240 8% 46%)" }}>{ep.description}</span>
        {ep.auth && (
          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium" style={{ background: `${auth.color}20`, color: auth.color }}>
            {auth.label}
          </span>
        )}
        {open
          ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "hsl(240 8% 40%)" }} />
          : <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "hsl(240 8% 40%)" }} />}
      </button>

      {open && (
        <div className="px-5 py-4 space-y-4 border-t" style={{ background: "hsl(240 8% 8%)", borderColor: "hsl(240 8% 14%)" }}>
          <p className="text-sm" style={{ color: "hsl(240 8% 65%)" }}>{ep.description}</p>

          {ep.auth && ep.auth !== "none" && (
            <div>
              <p className="text-xs font-semibold uppercase mb-1.5" style={{ color: "hsl(240 8% 40%)" }}>Autenticação</p>
              <code className="text-xs px-3 py-1.5 rounded inline-block" style={{ background: "hsl(240 8% 14%)", color: auth.color }}>
                {auth.header}
              </code>
            </div>
          )}

          {ep.params && (
            <div>
              <p className="text-xs font-semibold uppercase mb-1.5" style={{ color: "hsl(240 8% 40%)" }}>Query Params</p>
              <pre className="text-xs rounded-lg px-4 py-3" style={{ background: "hsl(240 8% 5%)", color: "#fde68a" }}>
                {Object.entries(ep.params).map(([k, v]) => `?${k}=${v}`).join("\n")}
              </pre>
            </div>
          )}

          {ep.body && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-semibold uppercase" style={{ color: "hsl(240 8% 40%)" }}>Body (JSON)</p>
                <CopyButton text={JSON.stringify(ep.body, null, 2)} />
              </div>
              <pre className="text-xs rounded-lg px-4 py-3 overflow-x-auto" style={{ background: "hsl(240 8% 5%)", color: "#86efac" }}>
                {JSON.stringify(ep.body, null, 2)}
              </pre>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold uppercase" style={{ color: "hsl(240 8% 40%)" }}>cURL</p>
              <CopyButton text={curlCmd} />
            </div>
            <pre className="text-xs rounded-lg px-4 py-3 overflow-x-auto" style={{ background: "hsl(240 8% 5%)", color: "#93c5fd" }}>
              {curlCmd}
            </pre>
          </div>

          {ep.response && (
            <div>
              <p className="text-xs font-semibold uppercase mb-1.5" style={{ color: "hsl(240 8% 40%)" }}>Resposta</p>
              <pre className="text-xs rounded-lg px-4 py-3 overflow-x-auto" style={{ background: "hsl(240 8% 5%)", color: "#fca5a5" }}>
                {ep.response}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const [activeSection, setActiveSection] = useState("messages");

  const totalEndpoints = SECTIONS.reduce((sum, s) => sum + s.endpoints.length, 0);
  const activeS = SECTIONS.find(s => s.id === activeSection)!;

  return (
    <div className="min-h-screen" style={{ background: "hsl(240 8% 6%)", color: "hsl(240 8% 85%)" }}>
      {/* Header */}
      <header className="border-b sticky top-0 z-10" style={{ background: "hsl(240 8% 6%)", borderColor: "hsl(240 8% 14%)" }}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="w-px h-5" style={{ background: "hsl(240 8% 20%)" }} />
            <div className="flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" style={{ color: "hsl(240 8% 50%)" }} />
              <span className="text-sm font-medium" style={{ color: "hsl(240 8% 70%)" }}>API Reference</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(0,212,106,0.1)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.2)" }}>
              v1
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs hidden sm:block" style={{ color: "hsl(240 8% 40%)" }}>
              {totalEndpoints} endpoints
            </span>
            <a
              href="/login"
              className="text-xs px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-80"
              style={{ background: "rgba(0,212,106,0.15)", border: "1px solid rgba(0,212,106,0.3)", color: "#00d46a" }}
            >
              Acessar plataforma →
            </a>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-6 py-10 flex gap-8">
        {/* Sidebar */}
        <aside className="w-56 shrink-0">
          <div className="sticky top-24 space-y-0.5">
            <p className="text-xs font-semibold uppercase mb-3 px-3" style={{ color: "hsl(240 8% 35%)" }}>Recursos</p>
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = activeSection === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors"
                  style={{
                    background: isActive ? "rgba(0,212,106,0.1)" : "transparent",
                    color: isActive ? "#00d46a" : "hsl(240 8% 55%)",
                    border: isActive ? "1px solid rgba(0,212,106,0.2)" : "1px solid transparent",
                  }}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="flex-1">{s.title}</span>
                  {s.badge && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: isActive ? "rgba(0,212,106,0.2)" : "rgba(255,255,255,0.08)", color: isActive ? "#00d46a" : "hsl(240 8% 40%)" }}>
                      {s.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">
          {/* Section header */}
          <div className="flex items-start gap-4 mb-6">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <activeS.icon className="w-6 h-6" style={{ color: "#00d46a" }} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold" style={{ color: "hsl(240 8% 90%)" }}>{activeS.title}</h1>
                {activeS.badge && (
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(0,212,106,0.1)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.2)" }}>
                    {activeS.badge}
                  </span>
                )}
              </div>
              <p className="text-sm mt-0.5" style={{ color: "hsl(240 8% 50%)" }}>{activeS.description}</p>
            </div>
          </div>

          {/* Base URL */}
          <div className="flex flex-wrap items-center gap-4 mb-6 px-4 py-3 rounded-xl" style={{ background: "hsl(240 8% 10%)", border: "1px solid hsl(240 8% 16%)" }}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase" style={{ color: "hsl(240 8% 40%)" }}>Base URL</span>
              <code className="text-sm font-mono" style={{ color: "#93c5fd" }}>{BASE}</code>
              <CopyButton text={BASE} />
            </div>
            {activeS.badge === "V1 API" && (
              <>
                <span style={{ color: "hsl(240 8% 25%)" }}>|</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase" style={{ color: "hsl(240 8% 40%)" }}>V1 Base</span>
                  <code className="text-sm font-mono" style={{ color: "#f9a8d4" }}>{V1_BASE}</code>
                  <CopyButton text={V1_BASE} />
                </div>
              </>
            )}
          </div>

          {/* Endpoints */}
          <div className="space-y-2">
            {activeS.endpoints.map((ep, i) => <EndpointCard key={i} ep={ep} />)}
          </div>

          {/* Auth legend */}
          <div className="mt-8 p-4 rounded-xl space-y-2" style={{ background: "hsl(240 8% 10%)", border: "1px solid hsl(240 8% 16%)" }}>
            <p className="text-xs font-semibold uppercase mb-3" style={{ color: "hsl(240 8% 40%)" }}>Tipos de Autenticação</p>
            <div className="flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>Bearer JWT</span>
                <span className="text-xs" style={{ color: "hsl(240 8% 50%)" }}>Authorization: Bearer &lt;token&gt; — obtido no login</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: "rgba(234,179,8,0.12)", color: "#eab308" }}>Instance Token</span>
                <span className="text-xs" style={{ color: "hsl(240 8% 50%)" }}>X-Instance-Token: &lt;token&gt; — token da instância específica</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: "rgba(107,114,128,0.12)", color: "#9ca3af" }}>Público</span>
                <span className="text-xs" style={{ color: "hsl(240 8% 50%)" }}>Sem autenticação necessária</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
