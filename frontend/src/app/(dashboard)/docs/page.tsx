"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { instancesApi } from "@/lib/api";
import type { Instance } from "@/types";
import {
  ChevronRight, ChevronDown, Play, Copy, Check,
  Send, Smartphone, Key, Webhook, Globe, MessageSquare,
  Activity, Loader2, BookOpen, Users, ShieldCheck,
  Megaphone, Contact, UploadCloud, Settings, Server as ServerIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const API_ROOT = "https://api.uniq.chat";
const API_BASE = `${API_ROOT}/v1`;
const API_BASE_PLAYGROUND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

function isRootLevelPath(path: string) {
  return path.startsWith("/auth/") ||
    path.startsWith("/stripe/") ||
    path.startsWith("/asaas/") ||
    path.startsWith("/waba/webhook") ||
    path.startsWith("/ws/") ||
    path === "/payments/plans" ||
    path === "/stripe/plans" ||
    path === "/asaas/plans";
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  summary: string;
  body?: Record<string, { type: string; required?: boolean; description?: string; example?: string }>;
  pathParams?: string[];
  response?: string;
}

interface Section {
  id: string;
  label: string;
  icon: React.ReactNode;
  endpoints: Endpoint[];
}

const METHOD_STYLE: Record<string, { bg: string; color: string }> = {
  GET:    { bg: "rgba(96,165,250,0.08)",   color: "#60a5fa" },
  POST:   { bg: "rgba(0,212,106,0.08)",    color: "#00d46a" },
  PUT:    { bg: "rgba(251,191,36,0.08)",   color: "#fbbf24" },
  DELETE: { bg: "rgba(239,68,68,0.08)",    color: "#f87171" },
};

// ─── API Sections ─────────────────────────────────────────────────────────────
const SECTIONS: Section[] = [
  // ── Public/Open API ───────────────────────────────────────────────────────
  {
    id: "public-open-api",
    label: "API Pública (Open)",
    icon: <Globe className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",  path: "/stripe/plans",          summary: "Listar planos (público)" },
      { method: "GET",  path: "/asaas/plans",           summary: "Listar planos Asaas (público)" },
      { method: "GET",  path: "/payments/plans",        summary: "Listar planos (alias público)" },
      { method: "GET",  path: "/v1/stripe/plans",       summary: "Listar planos v1 (público)" },
      { method: "GET",  path: "/v1/asaas/plans",        summary: "Listar planos Asaas v1 (público)" },
      { method: "GET",  path: "/v1/payments/plans",     summary: "Listar planos v1 (compat)" },
      { method: "GET",  path: "/v1/invites/status",     summary: "Status do sistema de convites" },
      { method: "POST", path: "/v1/invites/validate",   summary: "Validar código de convite",
        body: {
          code: { type: "string", required: true, description: "Código de convite", example: "ABC123" },
        },
      },
      { method: "POST", path: "/auth/register",         summary: "Registrar conta (público)" },
      { method: "POST", path: "/auth/login",            summary: "Login (público)" },
      { method: "POST", path: "/auth/validate-key",     summary: "Validar chave Anthropic (público)" },
      { method: "POST", path: "/auth/refresh",          summary: "Renovar token" },
      { method: "POST", path: "/auth/logout",           summary: "Logout" },
      { method: "POST", path: "/auth/forgot-password",  summary: "Solicitar recuperação de senha" },
      { method: "POST", path: "/auth/reset-password",   summary: "Resetar senha com token" },
      { method: "POST", path: "/stripe/activate-lead",  summary: "Ativar lead após checkout transparente" },
      { method: "POST", path: "/stripe/webhook",        summary: "Webhook Stripe (público)" },
      { method: "POST", path: "/asaas/webhook",         summary: "Webhook Asaas (público)" },
      { method: "POST", path: "/waba/webhook",          summary: "Webhook WABA (público)" },
      { method: "GET",  path: "/ws/events",             summary: "WebSocket global de eventos" },
      { method: "GET",  path: "/ws/agent-activity",     summary: "WebSocket de atividade de agentes" },
    ],
  },

  // ── Instances ──────────────────────────────────────────────────────────────
  {
    id: "instances",
    label: "Instâncias",
    icon: <Smartphone className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/instances",                        summary: "Listar instâncias" },
      { method: "POST",   path: "/instances",                        summary: "Criar instância",
        body: { name: { type: "string", required: true, description: "Nome da instância", example: "Suporte Principal" } },
        response: `{ "id": "uuid", "name": "Suporte Principal", "status": "disconnected" }` },
      { method: "GET",    path: "/instances/{id}",                    summary: "Buscar instância",       pathParams: ["id"] },
      { method: "DELETE", path: "/instances/{id}",                    summary: "Remover instância",      pathParams: ["id"] },
      { method: "GET",    path: "/instances/{id}/qr",                 summary: "Obter QR Code",          pathParams: ["id"] },
      { method: "POST",   path: "/instances/{id}/pairing-code",       summary: "Gerar código de pareamento", pathParams: ["id"],
        body: { phone: { type: "string", required: true, description: "Número com DDI", example: "5511999999999" } },
        response: `{ "code": "ABCD-1234" }` },
      { method: "POST",   path: "/instances/{id}/disconnect",         summary: "Desconectar instância",  pathParams: ["id"] },
      { method: "POST",   path: "/instances/{id}/reconnect",          summary: "Reconectar instância",   pathParams: ["id"] },
      { method: "GET",    path: "/instances/{id}/status",             summary: "Status da instância",    pathParams: ["id"] },
      { method: "GET",    path: "/instances/{id}/profile",            summary: "Perfil do número conectado", pathParams: ["id"] },
      { method: "GET",    path: "/instances/{id}/settings",           summary: "Buscar configurações",   pathParams: ["id"] },
      { method: "PUT",    path: "/instances/{id}/settings",           summary: "Atualizar configurações", pathParams: ["id"],
        body: {
          always_online:  { type: "boolean", required: false, description: "Manter status online", example: "false" },
          reject_calls:   { type: "boolean", required: false, description: "Rejeitar chamadas",     example: "false" },
          read_messages:  { type: "boolean", required: false, description: "Marcar como lido ao receber", example: "false" },
          ignore_groups:  { type: "boolean", required: false, description: "Ignorar eventos de grupo",    example: "false" },
          ignore_status:  { type: "boolean", required: false, description: "Ignorar atualizações de status", example: "false" },
        } },
    ],
  },

  // ── Messages ───────────────────────────────────────────────────────────────
  {
    id: "messages",
    label: "Mensagens",
    icon: <MessageSquare className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",  path: "/instances/{id}/messages",              summary: "Histórico de mensagens",     pathParams: ["id"] },
      { method: "POST", path: "/instances/{id}/messages/text",         summary: "Enviar texto",               pathParams: ["id"],
        body: {
          to:   { type: "string", required: true,  description: "Número com DDI",      example: "5511999999999" },
          text: { type: "string", required: true,  description: "Conteúdo da mensagem", example: "Olá! Tudo bem?" },
          reply_to: { type: "string", required: false, description: "ID da mensagem a responder" },
        },
        response: `{ "message_id": "uuid", "status": "queued" }` },
      { method: "POST", path: "/instances/{id}/messages/image",        summary: "Enviar imagem",              pathParams: ["id"],
        body: {
          to:      { type: "string", required: true,  description: "Número destinatário",  example: "5511999999999" },
          url:     { type: "string", required: false, description: "URL da imagem",        example: "https://exemplo.com/foto.jpg" },
          base64:  { type: "string", required: false, description: "Imagem em base64 (alternativa a url)" },
          caption: { type: "string", required: false, description: "Legenda",              example: "Confira!" },
        } },
      { method: "POST", path: "/instances/{id}/messages/document",     summary: "Enviar documento",           pathParams: ["id"],
        body: {
          to:       { type: "string", required: true,  description: "Número destinatário", example: "5511999999999" },
          url:      { type: "string", required: false, description: "URL do documento",    example: "https://exemplo.com/doc.pdf" },
          base64:   { type: "string", required: false, description: "Documento em base64" },
          filename: { type: "string", required: false, description: "Nome do arquivo",     example: "proposta.pdf" },
        } },
      { method: "POST", path: "/instances/{id}/messages/audio",        summary: "Enviar áudio (PTT)",         pathParams: ["id"],
        body: {
          to:     { type: "string", required: true,  description: "Número destinatário",   example: "5511999999999" },
          url:    { type: "string", required: false, description: "URL do áudio (.ogg/.mp3)" },
          base64: { type: "string", required: false, description: "Áudio em base64" },
          ptt:    { type: "boolean",required: false, description: "Enviar como mensagem de voz", example: "true" },
        } },
      { method: "POST", path: "/instances/{id}/messages/video",        summary: "Enviar vídeo",               pathParams: ["id"],
        body: {
          to:      { type: "string", required: true,  description: "Número destinatário",  example: "5511999999999" },
          url:     { type: "string", required: false, description: "URL do vídeo" },
          base64:  { type: "string", required: false, description: "Vídeo em base64" },
          caption: { type: "string", required: false, description: "Legenda" },
        } },
      { method: "POST", path: "/instances/{id}/messages/location",     summary: "Enviar localização",         pathParams: ["id"],
        body: {
          to:        { type: "string", required: true,  description: "Número destinatário", example: "5511999999999" },
          latitude:  { type: "number", required: true,  description: "Latitude",            example: "-23.550520" },
          longitude: { type: "number", required: true,  description: "Longitude",           example: "-46.633308" },
          name:      { type: "string", required: false, description: "Nome do local",        example: "São Paulo, SP" },
        } },
      { method: "POST", path: "/instances/{id}/messages/contact",      summary: "Enviar contato (vCard)",     pathParams: ["id"],
        body: {
          to:           { type: "string", required: true,  description: "Número destinatário",    example: "5511999999999" },
          contact_name: { type: "string", required: true,  description: "Nome do contato",        example: "João Silva" },
          contact_phone:{ type: "string", required: true,  description: "Telefone do contato",    example: "5511988887777" },
        } },
      { method: "POST", path: "/instances/{id}/messages/reaction",     summary: "Reagir a uma mensagem",      pathParams: ["id"],
        body: {
          to:         { type: "string", required: true, description: "Número do chat",        example: "5511999999999" },
          message_id: { type: "string", required: true, description: "ID da mensagem alvo",  example: "ABCD1234..." },
          emoji:      { type: "string", required: true, description: "Emoji de reação",       example: "👍" },
        } },
      { method: "POST", path: "/instances/{id}/messages/poll",         summary: "Enviar enquete",             pathParams: ["id"],
        body: {
          to:       { type: "string",   required: true,  description: "Número destinatário",  example: "5511999999999" },
          question: { type: "string",   required: true,  description: "Pergunta da enquete",  example: "Qual sua preferência?" },
          options:  { type: "string[]", required: true,  description: "Opções de resposta",   example: '["Opção A","Opção B"]' },
        } },
      { method: "POST", path: "/instances/{id}/messages/buttons",      summary: "Enviar botões hidratados",  pathParams: ["id"],
        body: {
          to:      { type: "string", required: true,  description: "Número destinatário", example: "5511999999999" },
          body:    { type: "string", required: true,  description: "Texto principal",      example: "Escolha uma opção" },
          footer:  { type: "string", required: false, description: "Rodapé",               example: "Uniq.chat" },
          buttons: { type: "object[]", required: true, description: "Até 3 botões. Suporta reply, url e call.", example: '[{"id":"sim","text":"Sim","type":"reply"},{"text":"Site","type":"url","url":"https://uniq.chat"},{"text":"Ligar","type":"call","phone":"+5511999999999"}]' },
        } },
      { method: "POST", path: "/instances/{id}/messages/template",     summary: "Enviar template message",    pathParams: ["id"],
        body: {
          to:      { type: "string", required: true,  description: "Número destinatário", example: "5511999999999" },
          content: { type: "string", required: true,  description: "Conteúdo principal",  example: "Template content" },
          footer:  { type: "string", required: false, description: "Rodapé",              example: "Some footer text" },
          buttons: { type: "object[]", required: true, description: "Botões de quick reply, URL e ligação", example: '[{"display_text":"Yes","type":"quickreply","id":"yes"},{"display_text":"Visit Site","type":"url","url":"https://www.fop2.com"},{"display_text":"Llamame","type":"call","phone_number":"1155554444"}]' },
        } },
      { method: "POST", path: "/instances/{id}/messages/list",         summary: "Enviar lista estruturada",   pathParams: ["id"],
        body: {
          to:          { type: "string",   required: true,  description: "Número destinatário", example: "5511999999999" },
          title:       { type: "string",   required: false, description: "Título da lista",     example: "Catálogo" },
          description: { type: "string",   required: false, description: "Texto principal",      example: "Escolha uma opção" },
          button_text: { type: "string",   required: true,  description: "Texto do botão",       example: "Ver opções" },
          footer:      { type: "string",   required: false, description: "Rodapé",               example: "Uniq.chat" },
          sections:    { type: "object[]", required: true,  description: "Seções com rows {id,title,description}", example: '[{"title":"Atendimento","rows":[{"id":"suporte","title":"Suporte","description":"Falar com suporte"}]}]' },
        } },
      { method: "POST", path: "/instances/{id}/messages/menu",         summary: "Enviar menu unificado",      pathParams: ["id"],
        body: {
          number:          { type: "string",   required: true,  description: "Número destinatário", example: "5511999999999" },
          type:            { type: "string",   required: true,  description: "button | list | poll | carousel", example: "list" },
          text:            { type: "string",   required: true,  description: "Texto principal", example: "Escolha uma opção" },
          choices:         { type: "string[]", required: true,  description: "Linhas estruturadas conforme o tipo", example: '["[Atendimento]","Suporte|suporte|Falar com suporte"]' },
          footerText:      { type: "string",   required: false, description: "Rodapé", example: "Uniq.chat" },
          listButton:      { type: "string",   required: false, description: "Texto do botão para listas", example: "Abrir menu" },
          selectableCount: { type: "number",   required: false, description: "Quantidade selecionável para poll", example: "1" },
        },
        response: `{ "message_id": "...", "status": "sent" }` },
      { method: "POST", path: "/instances/{id}/messages/revoke",       summary: "Revogar/apagar mensagem",    pathParams: ["id"],
        body: {
          to:         { type: "string", required: true, description: "Número do chat",        example: "5511999999999" },
          message_id: { type: "string", required: true, description: "ID da mensagem",        example: "ABCD1234..." },
        } },
      { method: "POST", path: "/instances/{id}/messages/status",       summary: "Publicar status/story",      pathParams: ["id"],
        body: {
          text:        { type: "string", required: false, description: "Texto do status", example: "Bom dia, clientes!" },
          media_base64:{ type: "string", required: false, description: "Imagem ou vídeo em base64" },
          mime_type:   { type: "string", required: false, description: "Tipo MIME da mídia", example: "image/jpeg" },
          bg_color:    { type: "string", required: false, description: "Cor de fundo para status de texto", example: "#103529" },
        } },
      { method: "POST", path: "/instances/{id}/messages/presence",     summary: "Atualizar presença da conta", pathParams: ["id"],
        body: {
          available: { type: "boolean", required: true, description: "true = online, false = indisponível", example: "true" },
        } },
      { method: "POST", path: "/instances/{id}/messages/typing",       summary: "Simular digitando",          pathParams: ["id"],
        body: {
          to:       { type: "string",  required: true,  description: "Número do chat",        example: "5511999999999" },
          duration: { type: "number",  required: false, description: "Duração em ms",         example: "3000" },
        } },
      { method: "POST", path: "/instances/{id}/messages/read",         summary: "Marcar mensagens como lidas", pathParams: ["id"],
        body: {
          chat_jid: { type: "string", required: true, description: "JID do chat",             example: "5511999999999@s.whatsapp.net" },
        } },
      { method: "POST", path: "/instances/{id}/media/upload",          summary: "Upload de mídia para MinIO", pathParams: ["id"],
        body: {
          file: { type: "file", required: true, description: "Arquivo (multipart/form-data, máx 64 MB)" },
        },
        response: `{ "url": "http://minio:9010/uniqchat-media/media/inst/2026/03/uuid.jpg", "mime_type": "image/jpeg", "size": 102400 }` },
      { method: "GET",  path: "/instances/{id}/chats",                 summary: "Listar conversas abertas",   pathParams: ["id"] },
      { method: "GET",  path: "/instances/{id}/contacts",              summary: "Listar contatos do WhatsApp", pathParams: ["id"] },
      { method: "POST", path: "/instances/{id}/check-number",          summary: "Verificar se número tem WhatsApp", pathParams: ["id"],
        body: { phone: { type: "string", required: true, description: "Número a verificar", example: "5511999999999" } },
        response: `{ "phone": "5511999999999", "exists": true, "jid": "5511999999999@s.whatsapp.net" }` },
      { method: "POST", path: "/instances/{id}/bulk-check",            summary: "Verificar vários números de uma vez", pathParams: ["id"],
        body: { phones: { type: "string[]", required: true, description: "Lista de números", example: '["5511999999999","5511988887777"]' } },
        response: `[{ "phone": "...", "exists": true }, ...]` },
      { method: "POST", path: "/instances/{id}/contact/info",         summary: "Consultar nome, JID e avatar de um contato", pathParams: ["id"],
        body: {
          phone: { type: "string", required: false, description: "Número do contato", example: "5511999999999" },
          jid:   { type: "string", required: false, description: "JID do contato", example: "5511999999999@s.whatsapp.net" },
        },
        response: `{ "query": "5511999999999", "exists": true, "jid": "5511999999999@s.whatsapp.net", "phone": "5511999999999", "push_name": "Cliente", "avatar_url": "https://..." }` },
      { method: "POST", path: "/instances/{id}/contact/avatar",       summary: "Buscar somente o avatar de um contato", pathParams: ["id"],
        body: {
          phone: { type: "string", required: false, description: "Número do contato", example: "5511999999999" },
          jid:   { type: "string", required: false, description: "JID do contato", example: "5511999999999@s.whatsapp.net" },
        },
        response: `{ "query": "5511999999999@s.whatsapp.net", "exists": true, "jid": "5511999999999@s.whatsapp.net", "avatar_url": "https://..." }` },
    ],
  },

  // ── OTP ────────────────────────────────────────────────────────────────────
  {
    id: "otp",
    label: "OTP",
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "POST", path: "/instances/{id}/otp/send",     summary: "Enviar OTP via WhatsApp",          pathParams: ["id"],
        body: {
          phone:           { type: "string", required: true,  description: "Número destinatário",             example: "5511999999999" },
          template:        { type: "string", required: false, description: "Template da mensagem. Use {{code}} e {{expiry}}", example: "Seu código: {{code}} — válido por {{expiry}} min." },
          code_length:     { type: "number", required: false, description: "Tamanho do código (padrão: 6)",    example: "6" },
          expires_minutes: { type: "number", required: false, description: "Expiração em minutos (padrão: 5)", example: "5" },
        },
        response: `{ "session_id": "uuid", "phone": "5511999999999", "expires_at": "2026-03-25T10:05:00Z", "status": "queued" }` },
      { method: "POST", path: "/instances/{id}/otp/verify",   summary: "Verificar código OTP",             pathParams: ["id"],
        body: {
          session_id: { type: "string", required: true, description: "ID da sessão retornado em /send", example: "uuid" },
          code:       { type: "string", required: true, description: "Código recebido pelo usuário",    example: "482931" },
        },
        response: `{ "valid": true, "session_id": "uuid", "phone": "...", "verified_at": "2026-03-25T10:02:12Z" }` },
      { method: "POST", path: "/instances/{id}/otp/resend",   summary: "Reenviar OTP (novo código)",       pathParams: ["id"],
        body: {
          session_id: { type: "string", required: true,  description: "ID da sessão original", example: "uuid" },
          template:   { type: "string", required: false, description: "Template alternativo" },
        },
        response: `{ "session_id": "uuid", "expires_at": "...", "resends": 1, "status": "queued" }` },
      { method: "GET",  path: "/instances/{id}/otp/sessions", summary: "Histórico de sessões OTP",         pathParams: ["id"],
        response: `{ "sessions": [{ "id": "uuid", "phone": "...", "status": "verified", "attempts": 1, ... }], "total": 1 }` },
    ],
  },

  // ── Groups ─────────────────────────────────────────────────────────────────
  {
    id: "groups",
    label: "Grupos",
    icon: <Users className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",  path: "/instances/{id}/groups",                     summary: "Listar grupos",               pathParams: ["id"] },
      { method: "POST", path: "/instances/{id}/groups",                     summary: "Criar grupo",                 pathParams: ["id"],
        body: {
          name:         { type: "string",   required: true,  description: "Nome do grupo",           example: "Time de Vendas" },
          participants: { type: "string[]", required: true,  description: "Números dos participantes", example: '["5511999999999"]' },
        },
        response: `{ "jid": "120363xxx@g.us", "name": "Time de Vendas", "participants": [...] }` },
      { method: "GET",  path: "/instances/{id}/groups/:jid",                summary: "Detalhes do grupo",           pathParams: ["id", "jid"] },
      { method: "PUT",  path: "/instances/{id}/groups/:jid",                summary: "Atualizar grupo",             pathParams: ["id", "jid"],
        body: {
          name:        { type: "string", required: false, description: "Novo nome do grupo" },
          description: { type: "string", required: false, description: "Nova descrição do grupo" },
        } },
      { method: "POST", path: "/instances/{id}/groups/:jid/participants",   summary: "Adicionar/remover participantes", pathParams: ["id", "jid"],
        body: {
          action:       { type: "string",   required: true, description: "add | remove | promote | demote", example: "add" },
          participants: { type: "string[]", required: true, description: "Lista de números",                example: '["5511999999999"]' },
        } },
      { method: "GET",  path: "/instances/{id}/groups/:jid/invite",         summary: "Obter link de convite",       pathParams: ["id", "jid"],
        response: `{ "invite_link": "https://chat.whatsapp.com/..." }` },
      { method: "POST", path: "/instances/{id}/groups/:jid/leave",          summary: "Sair do grupo",               pathParams: ["id", "jid"] },
    ],
  },

  // ── CRM ────────────────────────────────────────────────────────────────────
  {
    id: "crm",
    label: "CRM",
    icon: <Contact className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/crm/contacts",        summary: "Listar contatos CRM" },
      { method: "POST",   path: "/crm/contacts",        summary: "Criar contato",
        body: {
          name:        { type: "string", required: true,  description: "Nome",           example: "João Silva" },
          phone:       { type: "string", required: true,  description: "Telefone",       example: "5511999999999" },
          email:       { type: "string", required: false, description: "E-mail" },
          company:     { type: "string", required: false, description: "Empresa" },
          notes:       { type: "string", required: false, description: "Observações" },
        },
        response: `{ "id": "uuid", "name": "João Silva", "phone": "5511999999999", "tags": [] }` },
      { method: "GET",    path: "/crm/contacts/{id}",    summary: "Buscar contato",       pathParams: ["id"] },
      { method: "PUT",    path: "/crm/contacts/{id}",    summary: "Atualizar contato",    pathParams: ["id"],
        body: {
          name:    { type: "string", required: false, description: "Nome" },
          phone:   { type: "string", required: false, description: "Telefone" },
          email:   { type: "string", required: false, description: "E-mail" },
          company: { type: "string", required: false, description: "Empresa" },
          notes:   { type: "string", required: false, description: "Observações" },
        } },
      { method: "DELETE", path: "/crm/contacts/{id}",    summary: "Remover contato",      pathParams: ["id"] },
      { method: "PUT",    path: "/crm/contacts/{id}/tags", summary: "Associar tags",      pathParams: ["id"],
        body: {
          tag_ids: { type: "string[]", required: true, description: "IDs das tags", example: '["uuid1","uuid2"]' },
        } },
      { method: "GET",    path: "/crm/tags",            summary: "Listar tags" },
      { method: "POST",   path: "/crm/tags",            summary: "Criar tag",
        body: {
          name:  { type: "string", required: true,  description: "Nome da tag",  example: "Cliente VIP" },
          color: { type: "string", required: false, description: "Cor hex",       example: "#00d46a" },
        } },
      { method: "DELETE", path: "/crm/tags/{id}",        summary: "Remover tag",          pathParams: ["id"] },
    ],
  },

  // ── Campaigns ──────────────────────────────────────────────────────────────
  {
    id: "campaigns",
    label: "Campanhas",
    icon: <Megaphone className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/campaigns",         summary: "Listar campanhas" },
      { method: "POST",   path: "/campaigns",         summary: "Criar campanha",
        body: {
          name:        { type: "string", required: true,  description: "Nome da campanha",                     example: "Black Friday 2026" },
          instance_id: { type: "string", required: true,  description: "UUID da instância disparadora",        example: "uuid" },
          message:     { type: "string", required: true,  description: "Texto da mensagem",                    example: "Olá {{name}}! Aproveite 50% OFF 🎉" },
          delay_ms:    { type: "number", required: false, description: "Delay entre mensagens (ms, padrão 1200)", example: "2000" },
          scheduled_at:{ type: "string", required: false, description: "ISO 8601 para envio agendado" },
          recipients:  { type: "array",  required: true,  description: '[{ "phone": "55119...", "name": "João" }]', example: '[{"phone":"5511999999999","name":"João"}]' },
        },
        response: `{ "id": "uuid", "name": "Black Friday 2026", "status": "draft", "total": 1 }` },
      { method: "GET",    path: "/campaigns/{id}",     summary: "Detalhes da campanha",  pathParams: ["id"] },
      { method: "POST",   path: "/campaigns/{id}/start",  summary: "Iniciar campanha",   pathParams: ["id"] },
      { method: "POST",   path: "/campaigns/{id}/pause",  summary: "Pausar campanha",    pathParams: ["id"] },
      { method: "POST",   path: "/campaigns/{id}/cancel", summary: "Cancelar campanha",  pathParams: ["id"] },
      { method: "DELETE", path: "/campaigns/{id}",     summary: "Remover campanha",      pathParams: ["id"] },
    ],
  },

  // ── Webhooks ───────────────────────────────────────────────────────────────
  {
    id: "webhooks",
    label: "Webhooks",
    icon: <Webhook className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/instances/{id}/webhooks",            summary: "Listar webhooks",    pathParams: ["id"] },
      { method: "POST",   path: "/instances/{id}/webhooks",            summary: "Criar webhook",      pathParams: ["id"],
        body: {
          url:    { type: "string",   required: true, description: "URL de destino",       example: "https://seu-servidor.com/webhook" },
          events: { type: "string[]", required: true, description: "Eventos a escutar",    example: '["message.received","status.changed"]' },
        },
        response: `{ "id": "uuid", "url": "...", "secret": "...", "events": "message.received,...", "is_active": true }` },
      { method: "PUT",    path: "/instances/{id}/webhooks/:webhookId", summary: "Atualizar webhook",  pathParams: ["id", "webhookId"],
        body: {
          url:       { type: "string",  required: false, description: "Nova URL" },
          events:    { type: "string[]",required: false, description: "Novos eventos" },
          is_active: { type: "boolean", required: false, description: "Ativar/pausar" },
        } },
      { method: "DELETE", path: "/instances/{id}/webhooks/:webhookId", summary: "Remover webhook",    pathParams: ["id", "webhookId"] },
    ],
  },

  // ── Proxy ──────────────────────────────────────────────────────────────────
  {
    id: "proxy",
    label: "Proxy",
    icon: <Globe className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/proxy/pool",       summary: "Listar proxy pools disponíveis",
        response: `[{ "id": "uuid", "name": "Brasil Residencial", "provider": "brightdata", "status": "active", "current_instances": 5 }]` },
      { method: "GET",    path: "/instances/{id}/proxy",      summary: "Buscar proxy",         pathParams: ["id"] },
      { method: "PUT",    path: "/instances/{id}/proxy",      summary: "Configurar proxy (manual ou pool)",     pathParams: ["id"],
        body: {
          enabled:  { type: "boolean", required: true,  description: "Ativar proxy" },
          type:     { type: "string",  required: true,  description: "http | https | socks5 | residencial",  example: "residencial" },
          host:     { type: "string",  required: false, description: "Endereço do proxy manual", example: "proxy.exemplo.com" },
          port:     { type: "number",  required: false, description: "Porta do proxy manual",  example: "1080" },
          username: { type: "string",  required: false, description: "Usuário (opcional)" },
          password: { type: "string",  required: false, description: "Senha (opcional)" },
          proxy_pool_id: { type: "string", required: false, description: "ID do proxy pool (para modo residencial)", example: "uuid" },
        } },
      { method: "POST",   path: "/instances/{id}/proxy/test", summary: "Testar proxy",         pathParams: ["id"],
        response: `{ "success": true, "external_ip": "1.2.3.4", "latency_ms": 120 }` },
      { method: "DELETE", path: "/instances/{id}/proxy",      summary: "Remover proxy",        pathParams: ["id"] },
    ],
  },

  // ── API Keys ───────────────────────────────────────────────────────────────
  {
    id: "api-keys",
    label: "API Keys",
    icon: <Key className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/api-keys",     summary: "Listar API keys" },
      { method: "POST",   path: "/api-keys",     summary: "Criar API key",
        body: { name: { type: "string", required: true, description: "Nome da chave", example: "Produção" } },
        response: `{ "id": "uuid", "name": "Produção", "key": "sc_...", "masked_key": "sc_***...***" }` },
      { method: "DELETE", path: "/api-keys/{id}", summary: "Revogar API key", pathParams: ["id"] },
    ],
  },

  // ── Servers ────────────────────────────────────────────────────────────────
  {
    id: "servers",
    label: "Servers",
    icon: <ServerIcon className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/servers",         summary: "Listar seus servers (workspaces)",
        response: `[{ "id": "uuid", "name": "Acme Corp", "slug": "acme-corp", "description": "...", "is_active": true, "proxy_pool_id": "uuid", "webhook_url": "https://..." }]` },
      { method: "POST",   path: "/servers",         summary: "Criar server",
        body: {
          name:        { type: "string", required: true,  description: "Nome do workspace",          example: "Acme Corp" },
          slug:        { type: "string", required: false, description: "Slug único (auto-gerado se omitido)", example: "acme-corp" },
          description: { type: "string", required: false, description: "Descrição opcional" },
          workspace_id:{ type: "string", required: false, description: "ID do workspace opcional" },
        },
        response: `{ "id": "uuid", "name": "Acme Corp", "slug": "acme-corp", "is_active": true }` },
      { method: "GET",    path: "/servers/{id}",     summary: "Buscar server",      pathParams: ["id"] },
      { method: "PUT",    path: "/servers/{id}",     summary: "Atualizar server (inclui proxy e webhook)",   pathParams: ["id"],
        body: {
          name:          { type: "string",  required: false, description: "Novo nome" },
          description:   { type: "string",  required: false, description: "Nova descrição" },
          is_active:     { type: "boolean", required: false, description: "Ativar/desativar" },
          proxy_pool_id: { type: "string",  required: false, description: "ID do proxy pool (ou vazio para remover)", example: "uuid-uuid" },
          webhook_url:   { type: "string",  required: false, description: "URL do webhook padrão para instâncias", example: "https://webhook.com.br/hook" },
          apply_webhook: { type: "boolean", required: false, description: "Aplicar webhook a todas as instâncias do server" },
        },
        response: `{ "id": "uuid", "name": "...", "proxy_pool_id": "...", "webhook_url": "..." }` },
      { method: "DELETE", path: "/servers/{id}",     summary: "Remover server (instâncias são desassociadas)", pathParams: ["id"] },
      { method: "GET",    path: "/servers/{id}/instances", summary: "Listar instâncias do server", pathParams: ["id"] },
      { method: "POST",   path: "/servers/{id}/actions", summary: "Ações em massa nas instâncias", pathParams: ["id"],
        body: {
          action: { type: "string", required: true, description: "Ação: pause, resume, reconnect, disconnect, delete, apply_proxy, rotate_proxy", example: "pause" },
        },
        response: `{ "message": "ação concluída", "action": "pause", "total": 5, "success": 5, "errors": 0, "results": ["instância 1 pausada", ...] }` },
      { method: "GET",    path: "/servers/{id}/stats", summary: "Estatísticas agregadas do server", pathParams: ["id"],
        response: `{ "total_instances": 5, "connected": 3, "disconnected": 1, "connecting": 1, "banned": 0, "total_messages": 1250 }` },
    ],
  },

  // ── Auth ───────────────────────────────────────────────────────────────────
  {
    id: "auth",
    label: "Auth",
    icon: <Activity className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "POST", path: "/auth/register",     summary: "Criar nova conta",
        body: {
          name:     { type: "string", required: true,  description: "Nome completo",       example: "João Silva" },
          email:    { type: "string", required: true,  description: "E-mail",              example: "joao@empresa.com" },
          username: { type: "string", required: false, description: "Username único (opcional)", example: "joaosilva" },
          password: { type: "string", required: true,  description: "Senha (mín. 6 chars)", example: "minhasenha123" },
        },
        response: `{ "access_token": "...", "user": { "id": "...", "name": "João Silva", "email": "...", "role": "user" } }` },
      { method: "POST", path: "/auth/login",        summary: "Login com email/username + senha ou Anthropic Key",
        body: {
          identifier:       { type: "string", required: false, description: "Email ou username",  example: "joao@empresa.com" },
          password:         { type: "string", required: false, description: "Senha",              example: "minhasenha123" },
          anthropic_api_key:{ type: "string", required: false, description: "Chave Anthropic (alternativa ao identifier+password)", example: "sk-ant-api03-..." },
        },
        response: `{ "access_token": "...", "token_type": "Bearer", "expires_in": 900, "user": { "id": "...", "email": "...", "role": "user" } }` },
      { method: "POST", path: "/auth/validate-key", summary: "Validar Anthropic Key (pré-login)",
        body: { anthropic_api_key: { type: "string", required: true, description: "Chave a validar" } },
        response: `{ "valid": true }` },
      { method: "POST", path: "/auth/refresh",      summary: "Renovar access token (usa cookie refresh_token)" },
      { method: "POST", path: "/auth/logout",       summary: "Logout (limpa cookie)" },
      { method: "GET",  path: "/auth/me",           summary: "Dados do usuário autenticado" },
      { method: "PUT",  path: "/auth/me",           summary: "Atualizar dados do usuário",
        body: {
          name:  { type: "string", required: false, description: "Nome", example: "João Silva" },
          avatar:{ type: "string", required: false, description: "URL do avatar" },
        } },
      { method: "POST", path: "/auth/change-password", summary: "Alterar senha",
        body: {
          current_password: { type: "string", required: true, description: "Senha atual" },
          new_password:     { type: "string", required: true, description: "Nova senha" },
        } },
    ],
  },

  // ── Workspaces ───────────────────────────────────────────────────────────────
  {
    id: "workspaces",
    label: "Workspaces",
    icon: <Users className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/workspaces",           summary: "Listar workspaces" },
      { method: "POST",   path: "/workspaces",           summary: "Criar workspace",
        body: {
          name:        { type: "string", required: true,  description: "Nome do workspace",   example: "Minha Empresa" },
          description: { type: "string", required: false, description: "Descrição" },
        } },
      { method: "GET",    path: "/workspaces/{id}",       summary: "Buscar workspace",      pathParams: ["id"] },
      { method: "PUT",    path: "/workspaces/{id}",       summary: "Atualizar workspace",   pathParams: ["id"],
        body: {
          name:        { type: "string", required: false, description: "Nome" },
          description: { type: "string", required: false, description: "Descrição" },
          is_active:   { type: "boolean", required: false, description: "Ativar/desativar" },
        } },
      { method: "DELETE", path: "/workspaces/{id}",       summary: "Desativar workspace",   pathParams: ["id"] },
      { method: "GET",    path: "/workspaces/{id}/members",      summary: "Listar membros",   pathParams: ["id"] },
      { method: "DELETE", path: "/workspaces/{id}/members/:member_id", summary: "Remover membro", pathParams: ["id", "member_id"] },
      { method: "POST",   path: "/workspaces/{id}/invites",       summary: "Criar convite",   pathParams: ["id"],
        body: {
          email:    { type: "string", required: true,  description: "E-mail do convidado", example: "colaborador@empresa.com" },
          role_id:  { type: "string", required: true,  description: "ID do cargo",          example: "uuid" },
        },
        response: `{ "token": "abc123...", "expires_at": "2026-04-10T...", "role": "SDR" }` },
      { method: "GET",    path: "/workspaces/{id}/invites",      summary: "Listar convites",   pathParams: ["id"] },
      { method: "DELETE", path: "/workspaces/{id}/invites/:invite_id", summary: "Revogar convite", pathParams: ["id", "invite_id"] },
    ],
  },

  // ── Roles ────────────────────────────────────────────────────────────────────
  {
    id: "roles",
    label: "Cargos e Permissões",
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/workspaces/:workspace_id/roles",       summary: "Listar cargos",        pathParams: ["workspace_id"] },
      { method: "POST",   path: "/workspaces/:workspace_id/roles",       summary: "Criar cargo",          pathParams: ["workspace_id"],
        body: {
          name:        { type: "string", required: true,  description: "Nome do cargo",    example: "SDR" },
          description: { type: "string", required: false, description: "Descrição" },
          permissions: { type: "string[]", required: true, description: "Chaves de permissões", example: '["instances:view","inbox:send"]' },
        } },
      { method: "GET",    path: "/workspaces/:workspace_id/roles/:role_id", summary: "Buscar cargo",     pathParams: ["workspace_id", "role_id"] },
      { method: "PUT",    path: "/workspaces/:workspace_id/roles/:role_id", summary: "Atualizar cargo",  pathParams: ["workspace_id", "role_id"],
        body: {
          name:        { type: "string", required: false, description: "Nome" },
          description: { type: "string", required: false, description: "Descrição" },
          permissions: { type: "string[]", required: false, description: "Permissões" },
        } },
      { method: "DELETE", path: "/workspaces/:workspace_id/roles/:role_id", summary: "Deletar cargo",  pathParams: ["workspace_id", "role_id"] },
      { method: "GET",    path: "/permissions",          summary: "Listar todas as permissões disponíveis" },
    ],
  },

  // ── Inbox ───────────────────────────────────────────────────────────────────
  {
    id: "inbox",
    label: "Inbox (Chat)",
    icon: <MessageSquare className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/instances/{id}/inbox/chats",              summary: "Listar conversas",      pathParams: ["id"],
        response: `{ "chats": [{ "jid": "...", "name": "João", "phone": "...", "last_message": "Olá!", "unread_count": 2 }], "total": 10, "connected": true }` },
      { method: "GET",    path: "/instances/{id}/inbox/chats/:jid",        summary: "Detalhes do chat + contato", pathParams: ["id", "jid"],
        response: `{ "contact": { "jid": "...", "name": "João", "phone": "...", "email": "...", "tags": ["VIP"], "stage": "Novo Lead" }, "stats": { "total_sent": 5, "total_received": 10 } }` },
      { method: "GET",    path: "/instances/{id}/inbox/chats/:jid/messages", summary: "Mensagens do chat", pathParams: ["id", "jid"],
        body: {
          limit:  { type: "number", required: false, description: "Limite (padrão 50)", example: "50" },
          offset: { type: "number", required: false, description: "Offset para paginação" },
          before: { type: "string", required: false, description: "RFC3339 timestamp para carregar anteriores" },
        },
        response: `{ "messages": [{ "id": "uuid", "content": "Olá!", "from_me": false, "timestamp": 1234567890 }], "total": 100, "has_more": true }` },
      { method: "POST",   path: "/instances/{id}/inbox/chats/:jid/messages", summary: "Enviar mensagem", pathParams: ["id", "jid"],
        body: {
          content: { type: "string", required: true,  description: "Texto da mensagem", example: "Olá! Como posso ajudar?" },
          type:    { type: "string", required: false, description: "Tipo (padrão: text)", example: "text" },
        },
        response: `{ "id": "uuid", "status": "sending", "timestamp": 1234567890 }` },
      { method: "POST",   path: "/instances/{id}/inbox/chats/:jid/messages/media", summary: "Enviar mídia", pathParams: ["id", "jid"],
        body: {
          url:      { type: "string", required: true,  description: "URL da mídia",       example: "https://exemplo.com/foto.jpg" },
          caption:  { type: "string", required: false, description: "Legenda da mídia" },
          mime_type:{ type: "string", required: false, description: "Tipo MIME",          example: "image/jpeg" },
        } },
      { method: "POST",   path: "/instances/{id}/inbox/chats/:jid/read",      summary: "Marcar como lido", pathParams: ["id", "jid"] },
      { method: "POST",   path: "/instances/{id}/inbox/chats/:jid/typing",   summary: "Enviar indicador de digitação", pathParams: ["id", "jid"],
        body: { typing: { type: "boolean", required: true, description: "true = digitando, false = parar", example: "true" } } },
      { method: "PUT",    path: "/instances/{id}/inbox/contacts/{id}",       summary: "Atualizar contato CRM", pathParams: ["id"],
        body: {
          name:    { type: "string", required: false, description: "Nome" },
          email:   { type: "string", required: false, description: "E-mail" },
          notes:   { type: "string", required: false, description: "Notas" },
          stage:   { type: "string", required: false, description: "Pipeline/Stage", example: "Novo Lead" },
          journey: { type: "string", required: false, description: "Jornada", example: "Bem-vindo" },
          tag_ids: { type: "string[]", required: false, description: "IDs das tags", example: '["uuid1","uuid2"]' },
        },
        response: `{ "id": "uuid", "name": "João", "stage": "Novo Lead", "tags": [...] }` },
    ],
  },

  // ── AI & Journeys ───────────────────────────────────────────────────────────
  {
    id: "ai-journeys",
    label: "AI & Journeys",
    icon: <Activity className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "POST", path: "/ai/chat",          summary: "Chat com IA",
        body: {
          message:      { type: "string", required: true,  description: "Mensagem do usuário",        example: "Crie uma jornada para..." },
          instance_id:  { type: "string", required: true,  description: "ID da instância",            example: "uuid" },
          context:      { type: "string", required: false, description: "Contexto adicional" },
        },
        response: `{ "response": "Entendi! Vou criar...", "journey_id": "uuid" }` },
      { method: "GET",  path: "/ai/tools",        summary: "Listar ferramentas disponíveis para IA" },
      { method: "POST", path: "/ai/generate",      summary: "Gerar variações de texto com IA",
        body: {
          text:       { type: "string", required: true,  description: "Texto original",        example: "Olá, tudo bem?" },
          count:      { type: "number", required: false, description: "Quantidade (padrão 3)", example: "5" },
          variation:  { type: "string", required: false, description: "Tipo: casual|formal|sales", example: "sales" },
        },
        response: `{ "variations": ["E aí, beleza?", "Olá! Como vai?"] }` },
      { method: "GET",  path: "/journeys",            summary: "Listar jornadas" },
      { method: "POST", path: "/journeys",            summary: "Criar jornada",
        body: {
          name:        { type: "string", required: true,  description: "Nome da jornada",    example: "Boas-vindas" },
          instance_id: { type: "string", required: true,  description: "ID da instância",    example: "uuid" },
          prompt:      { type: "string", required: true,  description: "Descrição da jornada", example: "Quando alguém enviar 'oi', enviar mensagem de boas-vindas..." },
        },
        response: `{ "id": "uuid", "name": "Boas-vindas", "status": "active", "trigger_type": "keyword" }` },
      { method: "GET",  path: "/journeys/{id}",        summary: "Detalhes da jornada", pathParams: ["id"] },
      { method: "PUT",  path: "/journeys/{id}/status", summary: "Ativar/desativar jornada", pathParams: ["id"],
        body: { is_active: { type: "boolean", required: true, description: "true = ativar", example: "true" } } },
      { method: "DELETE",path: "/journeys/{id}",       summary: "Deletar jornada",   pathParams: ["id"] },
      { method: "GET",  path: "/journeys/{id}/executions", summary: "Execuções da jornada", pathParams: ["id"] },
    ],
  },

  // ── Agent Center ─────────────────────────────────────────────────────────────
  {
    id: "agent",
    label: "Agent Center",
    icon: <Activity className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",  path: "/agent/stats",          summary: "Estatísticas do agente" },
      { method: "GET",  path: "/agent/activity",       summary: "Atividade recente do agente" },
      { method: "GET",  path: "/agent/instances",      summary: "Instâncias com agente configurado" },
      { method: "POST", path: "/agent/executions/{id}/stop", summary: "Parar execução", pathParams: ["id"] },
      { method: "GET",  path: "/instances/{id}/agent", summary: "Configuração do agente na instância", pathParams: ["id"] },
      { method: "PUT",  path: "/instances/{id}/agent", summary: "Atualizar configuração do agente", pathParams: ["id"],
        body: {
          enabled:   { type: "boolean", required: false, description: "Ativar agente" },
          system_prompt: { type: "string", required: false, description: "Prompt do sistema" },
          trigger_keywords: { type: "string[]", required: false, description: "Palavras-chave", example: '["/ai", "assistant"]' },
        } },
    ],
  },

  // ── Integrations ───────────────────────────────────────────────────────────
  {
    id: "integrations",
    label: "Integrações",
    icon: <Key className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/integrations",            summary: "Listar integrações" },
      { method: "POST",   path: "/integrations",            summary: "Criar integração",
        body: {
          type:       { type: "string", required: true,  description: "Tipo: anthropic|openai|google", example: "anthropic" },
          name:       { type: "string", required: true,  description: "Nome da integração",  example: "Minha Key" },
          api_key:    { type: "string", required: true,  description: "Chave da API",       example: "sk-..." },
          config:     { type: "object", required: false, description: "Configurações adicionais" },
        } },
      { method: "PUT",    path: "/integrations/{id}",        summary: "Atualizar integração",  pathParams: ["id"],
        body: { api_key: { type: "string", required: false, description: "Nova chave" } } },
      { method: "DELETE", path: "/integrations/{id}",        summary: "Deletar integração",    pathParams: ["id"] },
      { method: "POST",   path: "/integrations/{id}/test",   summary: "Testar integração",     pathParams: ["id"] },
    ],
  },

  // ── Admin ───────────────────────────────────────────────────────────────────
  {
    id: "admin",
    label: "Admin",
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/admin/users",              summary: "Listar usuários",      pathParams: [] },
      { method: "POST",   path: "/admin/users",              summary: "Criar usuário",
        body: {
          name:     { type: "string", required: true,  description: "Nome",         example: "João Silva" },
          email:    { type: "string", required: true,  description: "E-mail",      example: "joao@empresa.com" },
          password: { type: "string", required: true,  description: "Senha inicial" },
          role:     { type: "string", required: false, description: "super_admin|admin|user", example: "user" },
        } },
      { method: "PUT",    path: "/admin/users/{id}",          summary: "Atualizar usuário",  pathParams: ["id"],
        body: {
          name:    { type: "string", required: false, description: "Nome" },
          email:   { type: "string", required: false, description: "E-mail" },
          role:    { type: "string", required: false, description: "Cargo" },
          plan_id: { type: "string", required: false, description: "ID do plano" },
        } },
      { method: "POST",   path: "/admin/users/{id}/reset-password", summary: "Resetar senha", pathParams: ["id"] },
      { method: "DELETE", path: "/admin/users/{id}",          summary: "Deletar usuário",    pathParams: ["id"] },
      { method: "GET",    path: "/admin/plans",              summary: "Listar planos" },
      { method: "POST",   path: "/admin/plans",              summary: "Criar plano" },
      { method: "PUT",    path: "/admin/plans/{id}",          summary: "Atualizar plano",    pathParams: ["id"] },
      { method: "GET",    path: "/admin/stats",              summary: "Estatísticas da plataforma" },
    ],
  },

  // ── Recovery ────────────────────────────────────────────────────────────────
  {
    id: "recovery",
    label: "Recovery",
    icon: <Activity className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/instances/{id}/recovery",         summary: "Listar snapshots",      pathParams: ["id"] },
      { method: "POST",   path: "/instances/{id}/recovery/restore", summary: "Restaurar snapshot",   pathParams: ["id"],
        body: { snapshot_id: { type: "string", required: true, description: "ID do snapshot", example: "uuid" } } },
    ],
  },
];

// ─── Webhook Events Reference ─────────────────────────────────────────────────
const WEBHOOK_EVENTS = [
  { event: "message.received",  description: "Nova mensagem recebida na instância" },
  { event: "message.sent",      description: "Mensagem enviada com sucesso" },
  { event: "status.changed",    description: "Status da instância mudou (connected/disconnected)" },
  { event: "qr.updated",        description: "QR Code atualizado — novo scan necessário" },
  { event: "call.received",     description: "Chamada recebida (rejeitada se reject_calls=true)" },
  { event: "group.joined",      description: "Instância entrou em um grupo" },
  { event: "group.left",        description: "Instância saiu de um grupo" },
];

// ─── Playground ───────────────────────────────────────────────────────────────
function Playground({ endpoint, apiKey, instanceId }: {
  endpoint: Endpoint; apiKey: string; instanceId: string;
}) {
  const [pathValues, setPathValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    endpoint.pathParams?.forEach((p) => { if (p === "id") init[p] = instanceId; else init[p] = ""; });
    return init;
  });
  const [bodyValues, setBodyValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    if (endpoint.body) Object.entries(endpoint.body).forEach(([k, v]) => { init[k] = v.example || ""; });
    return init;
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ status: number; body: string } | null>(null);

  const buildUrl = () => {
    let path = endpoint.path;
    endpoint.pathParams?.forEach((p) => { path = path.replace(`:${p}`, pathValues[p] || `:${p}`); });
    const base = isRootLevelPath(path) ? API_BASE_PLAYGROUND.replace(/\/v1$/, "") : API_BASE_PLAYGROUND;
    return `${base}${path}`;
  };

  const run = async () => {
    if (!apiKey) return;
    setLoading(true);
    setResult(null);
    try {
      const url = buildUrl();
      const hasBody = endpoint.body && endpoint.method !== "GET" && endpoint.method !== "DELETE";
      const body = hasBody
        ? JSON.stringify(Object.fromEntries(
            Object.entries(bodyValues)
              .filter(([, v]) => v !== "")
              .map(([k, v]) => { try { return [k, JSON.parse(v)]; } catch { return [k, v]; } })
          ))
        : undefined;

      const res = await fetch(url, {
        method: endpoint.method,
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body,
      });
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* raw */ }
      setResult({ status: res.status, body: pretty });
    } catch (e) {
      setResult({ status: 0, body: `Erro de rede: ${e}` });
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-3 pt-2">
      {endpoint.pathParams && endpoint.pathParams.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 38%)" }}>Path Params</p>
          {endpoint.pathParams.map((p) => (
            <div key={p} className="flex items-center gap-2">
              <span className="text-xs font-mono w-24 flex-shrink-0" style={{ color: "#fbbf24" }}>:{p}</span>
              <input type="text" value={pathValues[p] || ""} onChange={(e) => setPathValues({ ...pathValues, [p]: e.target.value })}
                placeholder={p === "id" ? "instance-uuid" : p} className="input-field flex-1 text-xs font-mono py-1.5" />
            </div>
          ))}
        </div>
      )}

      {endpoint.body && endpoint.method !== "GET" && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 38%)" }}>Body</p>
          {Object.entries(endpoint.body).map(([key, field]) => (
            <div key={key}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs font-mono" style={{ color: "hsl(240 15% 80%)" }}>{key}</span>
                <span className="text-[10px] font-mono" style={{ color: "hsl(240 8% 38%)" }}>{field.type}</span>
                {field.required && <span className="text-[10px] px-1 rounded" style={{ background: "rgba(239,68,68,0.08)", color: "#f87171" }}>required</span>}
              </div>
              <input type="text" value={bodyValues[key] || ""} onChange={(e) => setBodyValues({ ...bodyValues, [key]: e.target.value })}
                placeholder={field.example || field.description || key} className="input-field w-full text-xs font-mono py-1.5" />
            </div>
          ))}
        </div>
      )}

      <button onClick={run} disabled={loading || !apiKey}
        className="flex items-center gap-2 text-xs font-semibold px-4 py-2 rounded-xl transition-all disabled:opacity-40"
        style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)", color: "var(--green)" }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,106,0.16)")}
        onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,212,106,0.1)")}
        title={!apiKey ? "Selecione uma API Key acima para testar" : ""}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
        Executar
      </button>

      {result && (
        <div className="rounded-xl overflow-hidden" style={{
          border: result.status >= 200 && result.status < 300 ? "1px solid rgba(0,212,106,0.15)" : "1px solid rgba(239,68,68,0.15)",
        }}>
          <div className="flex items-center gap-2 px-3 py-1.5" style={{
            background: result.status >= 200 && result.status < 300 ? "rgba(0,212,106,0.06)" : "rgba(239,68,68,0.06)",
          }}>
            <span className="text-xs font-bold font-mono" style={{ color: result.status >= 200 && result.status < 300 ? "var(--green)" : "#f87171" }}>
              {result.status || "ERR"}
            </span>
            <span className="text-[10px]" style={{ color: "hsl(240 8% 46%)" }}>
              {result.status >= 200 && result.status < 300 ? "OK" : "Error"}
            </span>
          </div>
          <pre className="text-xs p-3 overflow-x-auto font-mono leading-relaxed"
            style={{ color: "hsl(240 8% 70%)", background: "hsl(240 20% 3.5%)", maxHeight: "240px" }}>
            {result.body}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Endpoint Row ─────────────────────────────────────────────────────────────
function EndpointRow({ endpoint, apiKey, instanceId }: {
  endpoint: Endpoint; apiKey: string; instanceId: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const m = METHOD_STYLE[endpoint.method];

  const isV1Route = endpoint.path.startsWith("/instances/{id}/messages") ||
    endpoint.path.startsWith("/instances/{id}/otp") ||
    endpoint.path.startsWith("/instances/{id}/groups") ||
    endpoint.path.startsWith("/instances/{id}/chats") ||
    endpoint.path.startsWith("/instances/{id}/contacts") ||
    endpoint.path.startsWith("/instances/{id}/check-number") ||
    endpoint.path.startsWith("/instances/{id}/bulk-check") ||
    endpoint.path.startsWith("/instances/{id}/media") ||
    endpoint.path.startsWith("/instances/{id}/qr") ||
    endpoint.path.startsWith("/instances/{id}/pairing-code") ||
    endpoint.path.startsWith("/instances/{id}/status") ||
    endpoint.path.startsWith("/instances/{id}/profile");

  const curlExample = () => {
    let path = endpoint.path;
    let authHeader = "X-API-Key: sc_...";
    if (isV1Route) {
      path = path.replace("/instances/{id}", "/v1/{server-slug}/{instance-slug}");
      authHeader = "Authorization: Bearer it_...";
      endpoint.pathParams?.forEach((p) => { if (p !== "id") path = path.replace(`:${p}`, `{${p}}`); });
    } else {
      endpoint.pathParams?.forEach((p) => { path = path.replace(`:${p}`, p === "id" ? "{instance_id}" : `{${p}}`); });
    }
    const base = isRootLevelPath(path) ? API_ROOT : API_BASE;
    const url = `${base}${path}`;
    const hasBody = endpoint.body && endpoint.method !== "GET" && endpoint.method !== "DELETE";
    const bodyStr = hasBody
      ? ` \\\n  -d '${JSON.stringify(Object.fromEntries(Object.entries(endpoint.body!).map(([k, v]) => [k, v.example || `<${k}>`])), null, 2)}'`
      : "";
    return `curl -X ${endpoint.method} '${url}' \\\n  -H '${authHeader}' \\\n  -H 'Content-Type: application/json'${bodyStr}`;
  };

  const copyCurl = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(curlExample());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl overflow-hidden transition-all" style={{
      background: open ? "hsl(240 18% 6%)" : "transparent",
      border: open ? "1px solid hsl(240 12% 13%)" : "1px solid transparent",
    }}>
      <div onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-4 py-3 cursor-pointer group select-none">
        <span className="text-[11px] font-bold font-mono px-2 py-0.5 rounded-lg w-16 text-center flex-shrink-0"
          style={{ background: m.bg, color: m.color }}>{endpoint.method}</span>
        <code className="text-xs font-mono flex-1" style={{ color: "hsl(240 15% 75%)" }}>{endpoint.path}</code>
        <span className="text-xs hidden sm:block" style={{ color: "hsl(240 8% 42%)" }}>{endpoint.summary}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={copyCurl} className="p-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
            style={{ color: "hsl(240 8% 42%)" }} title="Copiar curl">
            {copied ? <Check className="w-3 h-3" style={{ color: "var(--green)" }} /> : <Copy className="w-3 h-3" />}
          </button>
          {open
            ? <ChevronDown className="w-3.5 h-3.5"  style={{ color: "hsl(240 8% 42%)" }} />
            : <ChevronRight className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 30%)" }} />}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-4">
          <div className="rounded-xl p-3 overflow-x-auto" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
            <pre className="text-xs font-mono" style={{ color: "hsl(240 8% 55%)" }}>{curlExample()}</pre>
          </div>
          {endpoint.response && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: "hsl(240 8% 38%)" }}>Response</p>
              <div className="rounded-xl p-3" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
                <pre className="text-xs font-mono" style={{ color: "#86efac" }}>{endpoint.response}</pre>
              </div>
            </div>
          )}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(240 8% 38%)" }}>Playground</p>
            <Playground endpoint={endpoint} apiKey={apiKey} instanceId={instanceId} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Instagram Sections ───────────────────────────────────────────────────────
const INSTAGRAM_SECTIONS: Section[] = [
  {
    id: "ig-instances",
    label: "Instâncias",
    icon: <Smartphone className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",  path: "/instances",     summary: "Listar instâncias Instagram" },
      { method: "POST", path: "/instances",      summary: "Criar instância Instagram",
        body: { name: { type: "string", required: true, description: "Nome da instância", example: "Instagram DMs" },
                channel: { type: "string", required: true, description: "Canal", example: "instagram" } } },
      { method: "DELETE", path: "/instances/{id}", summary: "Remover instância", pathParams: ["id"] },
    ],
  },
  {
    id: "ig-connect",
    label: "Conexão",
    icon: <Key className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "POST", path: "/instagram/instances/{id}/connect",    summary: "Conectar conta Instagram", pathParams: ["id"],
        body: {
          username:     { type: "string", required: false, description: "Usuário Instagram (instagram-cli)", example: "minha_conta" },
          password:     { type: "string", required: false, description: "Senha (instagram-cli)", example: "••••••••" },
          access_token: { type: "string", required: false, description: "Token Meta Graph API", example: "EAA..." },
        },
        response: `{ "message": "Instagram connection initiated", "instance_id": "uuid" }` },
      { method: "POST", path: "/instagram/instances/{id}/disconnect", summary: "Desconectar conta", pathParams: ["id"] },
    ],
  },
  {
    id: "ig-messages",
    label: "Mensagens DM",
    icon: <MessageSquare className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",  path: "/instagram/instances/{id}/messages/dm", summary: "Listar DMs recebidas", pathParams: ["id"],
        response: `{ "dms": [{ "from": "user123", "text": "Olá!", "timestamp": "..." }] }` },
      { method: "POST", path: "/instagram/instances/{id}/messages/dm", summary: "Enviar DM", pathParams: ["id"],
        body: {
          to:   { type: "string", required: true, description: "Username ou ID do destinatário", example: "user123" },
          text: { type: "string", required: true, description: "Conteúdo da mensagem", example: "Olá! Como posso ajudar?" },
        },
        response: `{ "message_id": "...", "status": "sent" }` },
    ],
  },
];

type ChannelTab = "whatsapp" | "instagram";

const CHANNEL_TABS: { id: ChannelTab; label: string; color: string }[] = [
  { id: "whatsapp",  label: "WhatsApp",  color: "#25d366" },
  { id: "instagram", label: "Instagram", color: "#e1306c" },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DocsPage() {
  const [channelTab, setChannelTab] = useState<ChannelTab>("whatsapp");
  const [activeSection, setActiveSection] = useState("instances");
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedInstance, setSelectedInstance] = useState("");

  const { data: instances = [] } = useQuery<Instance[]>({
    queryKey: ["instances"],
    queryFn: () => instancesApi.list().then((r) => r.data),
  });

  const activeSections = channelTab === "instagram" ? INSTAGRAM_SECTIONS : SECTIONS;
  const section = activeSections.find((s) => s.id === activeSection);
  const totalEndpoints = [...SECTIONS, ...INSTAGRAM_SECTIONS].reduce((acc, s) => acc + s.endpoints.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>API Reference</h1>
        <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
          <span className="font-mono text-xs px-1.5 py-0.5 rounded-md mr-1"
            style={{ background: "rgba(0,212,106,0.08)", color: "var(--green)" }}>{totalEndpoints}</span>
          endpoints — autentique com{" "}
          <code className="text-xs px-1.5 py-0.5 rounded-md font-mono" style={{ background: "rgba(255,255,255,0.06)", color: "hsl(240 15% 80%)" }}>X-API-Key</code>
          {" "}ou{" "}
          <code className="text-xs px-1.5 py-0.5 rounded-md font-mono" style={{ background: "rgba(255,255,255,0.06)", color: "hsl(240 15% 80%)" }}>Authorization: Bearer</code>
        </p>
      </div>

      {/* Auth + Instance selector */}
      <div className="rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 animate-fade-in-up"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: "hsl(240 8% 42%)" }}>
            API Key para Playground
          </label>
          <input type="text" value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}
            placeholder="Cole sua API Key aqui: sc_..." className="input-field w-full text-sm font-mono" />
          <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 36%)" }}>
            Gere em <a href="/api-keys" className="underline" style={{ color: "var(--green)" }}>API Keys</a>
          </p>
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: "hsl(240 8% 42%)" }}>
            Instância padrão (para {`{id}`})
          </label>
          <select value={selectedInstance} onChange={(e) => setSelectedInstance(e.target.value)} className="input-field w-full text-sm">
            <option value="">— selecione uma instância —</option>
            {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      {/* URL structure + Auth info */}
      <div className="space-y-3 animate-fade-in-up">
        <div className="rounded-2xl p-4 space-y-3"
          style={{ background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.14)" }}>
          <p className="text-xs font-semibold" style={{ color: "#a78bfa" }}>Estrutura da URL — API Pública v1</p>
          <div className="rounded-xl px-3 py-2.5" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
            <code className="text-xs font-mono" style={{ color: "hsl(240 15% 75%)" }}>
              <span style={{ color: "hsl(240 8% 46%)" }}>{API_ROOT}</span>
              <span style={{ color: "#a78bfa" }}>/v1/</span>
              <span style={{ color: "#fbbf24" }}>{"{server-slug}"}</span>
              <span style={{ color: "#a78bfa" }}>/</span>
              <span style={{ color: "#00d46a" }}>{"{instance-slug}"}</span>
              <span style={{ color: "hsl(240 8% 55%)" }}>/messages/text</span>
            </code>
          </div>
          <p className="text-[11px]" style={{ color: "hsl(240 8% 44%)" }}>
            Cada instância tem um <strong style={{ color: "hsl(240 15% 70%)" }}>slug único</strong> dentro do seu server (derivado do nome) e um <strong style={{ color: "hsl(240 15% 70%)" }}>token</strong> exclusivo para autenticação. Encontre esses valores na página de gerenciamento da instância.
          </p>
        </div>
        <div className="rounded-2xl p-4 space-y-2"
          style={{ background: "rgba(96,165,250,0.04)", border: "1px solid rgba(96,165,250,0.12)" }}>
          <p className="text-xs font-semibold" style={{ color: "#60a5fa" }}>Autenticação</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div className="rounded-lg px-3 py-2" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
              <span style={{ color: "hsl(240 8% 46%)" }}>v1 (por instância): </span>
              <span style={{ color: "#60a5fa" }}>Authorization: Bearer it_...</span>
            </div>
            <div className="rounded-lg px-3 py-2" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
              <span style={{ color: "hsl(240 8% 46%)" }}>Dashboard API: </span>
              <span style={{ color: "#60a5fa" }}>X-API-Key: sc_...</span>
            </div>
          </div>
        </div>
      </div>

      {/* Channel Tab Switcher */}
      <div className="flex gap-1.5 animate-fade-in-up">
        {CHANNEL_TABS.map((tab) => (
          <button key={tab.id} onClick={() => { setChannelTab(tab.id); setActiveSection(tab.id === "instagram" ? "ig-instances" : "instances"); }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all"
            style={channelTab === tab.id
              ? { background: `${tab.color}18`, color: tab.color, border: `1px solid ${tab.color}40` }
              : { background: "transparent", color: "hsl(240 8% 46%)", border: "1px solid hsl(240 12% 13%)" }}>
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: channelTab === tab.id ? tab.color : "hsl(240 8% 30%)" }} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[180px_1fr] gap-5">
        {/* Sidebar */}
        <div className="space-y-0.5">
          {activeSections.map((s) => (
            <button key={s.id} onClick={() => setActiveSection(s.id)}
              className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all",
                activeSection === s.id ? "text-white" : "text-slate-500 hover:text-slate-300")}
              style={activeSection === s.id ? { background: "rgba(255,255,255,0.06)", boxShadow: "inset 1px 0 0 0 var(--green)" } : undefined}
            >
              <span style={activeSection === s.id ? { color: "var(--green)" } : { color: "hsl(240 8% 40%)" }}>{s.icon}</span>
              {s.label}
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-lg"
                style={{ background: "rgba(255,255,255,0.04)", color: "hsl(240 8% 38%)" }}>
                {s.endpoints.length}
              </span>
            </button>
          ))}

          <div className="pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-widest px-3 mb-2" style={{ color: "hsl(240 8% 36%)" }}>Referência</p>
            <button onClick={() => setActiveSection("webhook-events")}
              className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all",
                activeSection === "webhook-events" ? "text-white" : "text-slate-500 hover:text-slate-300")}
              style={activeSection === "webhook-events" ? { background: "rgba(255,255,255,0.06)", boxShadow: "inset 1px 0 0 0 var(--green)" } : undefined}
            >
              <BookOpen className="w-3.5 h-3.5" style={activeSection === "webhook-events" ? { color: "var(--green)" } : { color: "hsl(240 8% 40%)" }} />
              Eventos
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="min-w-0">
          {activeSection === "webhook-events" ? (
            <div className="space-y-3 animate-fade-in-up">
              <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>Eventos de Webhook</h2>
              <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>
                Configure por instância em <code className="font-mono">POST /instances/<code className="font-mono">{'{' + 'id}'}</code>/webhooks</code>.
                O payload é enviado via <strong>HTTP POST</strong> para a URL configurada.
              </p>
              <div className="space-y-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <div key={ev.event} className="flex items-start gap-3 rounded-xl px-4 py-3"
                    style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
                    <code className="text-xs font-mono px-2 py-1 rounded-lg flex-shrink-0"
                      style={{ background: "rgba(96,165,250,0.08)", color: "#60a5fa" }}>{ev.event}</code>
                    <p className="text-xs pt-0.5" style={{ color: "hsl(240 8% 55%)" }}>{ev.description}</p>
                  </div>
                ))}
              </div>
              <div className="pt-2">
                <p className="text-xs font-semibold mb-2" style={{ color: "hsl(240 8% 52%)" }}>Exemplo de payload:</p>
                <div className="rounded-xl p-4 overflow-x-auto" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
                  <pre className="text-xs font-mono" style={{ color: "hsl(240 8% 65%)" }}>{`{
  "event": "message.received",
  "instance_id": "uuid",
  "timestamp": "2026-03-25T10:00:00Z",
  "data": {
    "from": "5511999999999",
    "message": "Olá!",
    "type": "text",
    "message_id": "ABCD1234..."
  }
}`}</pre>
                </div>
              </div>
            </div>
          ) : section ? (
            <div className="space-y-2 animate-fade-in-up">
              <div className="flex items-center gap-2 mb-4">
                <span style={{ color: "var(--green)" }}>{section.icon}</span>
                <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>{section.label}</h2>
                <span className="text-xs" style={{ color: "hsl(240 8% 38%)" }}>
                  {section.endpoints.length} endpoint{section.endpoints.length !== 1 ? "s" : ""}
                </span>
              </div>
              {section.endpoints.map((ep, i) => (
                <EndpointRow key={i} endpoint={ep} apiKey={selectedKey} instanceId={selectedInstance} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
