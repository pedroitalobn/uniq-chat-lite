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

const API_BASE = "https://api.uniq.chat/v1";
const API_BASE_PLAYGROUND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

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
  PUT:    { bg: "rgba(251,191,36,0.08)",    color: "#fbbf24" },
  DELETE: { bg: "rgba(239,68,68,0.08)",     color: "#f87171" },
};

const SECTIONS: Section[] = [
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
      { method: "POST", path: "/instances/{id}/messages/revoke",       summary: "Revogar/apagar mensagem",    pathParams: ["id"],
        body: {
          to:         { type: "string", required: true, description: "Número do chat",        example: "5511999999999" },
          message_id: { type: "string", required: true, description: "ID da mensagem",        example: "ABCD1234..." },
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
    ],
  },
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
        response: `{ "id": "uuid", "url": "...", "events": "message.received,...", "is_active": true }` },
      { method: "PUT",    path: "/instances/{id}/webhooks/:webhookId", summary: "Atualizar webhook",  pathParams: ["id", "webhookId"],
        body: {
          url:       { type: "string",  required: false, description: "Nova URL" },
          events:    { type: "string[]",required: false, description: "Novos eventos" },
          is_active: { type: "boolean", required: false, description: "Ativar/pausar" },
        } },
      { method: "DELETE", path: "/instances/{id}/webhooks/:webhookId", summary: "Remover webhook",    pathParams: ["id", "webhookId"] },
    ],
  },
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
  {
    id: "integrations",
    label: "Integrações",
    icon: <Key className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/integrations",            summary: "Listar integrações" },
      { method: "POST",   path: "/integrations",            summary: "Criar integração",
        body: {
          provider: { type: "string", required: true, description: "Provider: claude, openai, deepseek, gemini, openrouter, qwen", example: "claude" },
          name:     { type: "string", required: true, description: "Nome da integração", example: "Minha Key" },
          api_key:  { type: "string", required: true, description: "Chave da API", example: "sk-..." },
          models:   { type: "string[]", required: false, description: "Modelos a usar", example: '["claude-sonnet-4-6"]' },
        } },
      { method: "DELETE", path: "/integrations/{id}",        summary: "Deletar integração",    pathParams: ["id"] },
      { method: "POST",   path: "/integrations/{id}/test",   summary: "Testar integração",     pathParams: ["id"] },
    ],
  },
];

const WEBHOOK_EVENTS = [
  { event: "message.received",  description: "Nova mensagem recebida (qualquer tipo)" },
  { event: "message.sent",      description: "Mensagem enviada com sucesso" },
  { event: "message.location",  description: "Mensagem recebida contém localização" },
  { event: "message.image",     description: "Mensagem recebida contém imagem" },
  { event: "message.audio",     description: "Mensagem recebida contém áudio" },
  { event: "message.video",     description: "Mensagem recebida contém vídeo" },
  { event: "message.document",  description: "Mensagem recebida contém documento" },
  { event: "message.reaction",  description: "Contato reagiu a uma mensagem" },
  { event: "status.changed",    description: "Status da instância mudou (connected/disconnected)" },
  { event: "qr.updated",        description: "QR Code atualizado — novo scan necessário" },
  { event: "call.incoming",     description: "Chamada recebida (ringing)" },
  { event: "call.accepted",     description: "Chamada foi atendida" },
  { event: "call.missed",       description: "Chamada perdida (ninguém atendeu)" },
  { event: "call.rejected",     description: "Chamada rejeitada manualmente" },
  { event: "call.terminate",    description: "Chamada encerrada (qualquer motivo)" },
  { event: "group.joined",      description: "Instância entrou em um grupo" },
  { event: "group.left",        description: "Instância saiu de um grupo" },
];

export function DocsSection() {
  const [activeSection, setActiveSection] = useState("instances");
  const [selectedKey, setSelectedKey] = useState("");
  const [selectedInstance, setSelectedInstance] = useState("");

  const { data: instances = [] } = useQuery<Instance[]>({
    queryKey: ["instances"],
    queryFn: () => instancesApi.list().then((r) => r.data),
  });

  const section = SECTIONS.find((s) => s.id === activeSection);

  return (
    <div className="space-y-4">
      {/* API Key + Instance selector */}
      <div className="rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: "hsl(240 8% 42%)" }}>
            API Key para Playground
          </label>
          <input type="text" value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}
            placeholder="Cole sua API Key aqui: sc_..." className="input-field w-full text-sm font-mono" />
        </div>
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-widest block mb-1.5" style={{ color: "hsl(240 8% 42%)" }}>
            Instância padrão
          </label>
          <select value={selectedInstance} onChange={(e) => setSelectedInstance(e.target.value)} className="input-field w-full text-sm">
            <option value="">— selecione —</option>
            {instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      {/* URL structure */}
      <div className="rounded-2xl p-4" style={{ background: "rgba(167,139,250,0.04)", border: "1px solid rgba(167,139,250,0.14)" }}>
        <p className="text-xs font-semibold mb-2" style={{ color: "#a78bfa" }}>Estrutura da URL</p>
        <div className="rounded-xl px-3 py-2.5" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
          <code className="text-xs font-mono" style={{ color: "hsl(240 15% 75%)" }}>
            <span style={{ color: "hsl(240 8% 46)" }}>{API_BASE}</span>
            <span style={{ color: "#a78bfa" }}>/v1/</span>
            <span style={{ color: "#fbbf24" }}>{"{server-slug}"}</span>
            <span style={{ color: "#a78bfa" }}>/</span>
            <span style={{ color: "#00d46a" }}>{"{instance-slug}"}</span>
            <span style={{ color: "hsl(240 8% 55%" }}>/messages/text</span>
          </code>
        </div>
      </div>

      {/* Sections */}
      <div className="grid grid-cols-[180px_1fr] gap-4">
        <div className="space-y-0.5">
          {SECTIONS.map((s) => (
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
          <button onClick={() => setActiveSection("webhook-events")}
            className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all",
              activeSection === "webhook-events" ? "text-white" : "text-slate-500 hover:text-slate-300")}
            style={activeSection === "webhook-events" ? { background: "rgba(255,255,255,0.06)", boxShadow: "inset 1px 0 0 0 var(--green)" } : undefined}
          >
            <BookOpen className="w-3.5 h-3.5" style={activeSection === "webhook-events" ? { color: "var(--green)" } : { color: "hsl(240 8% 40%)" }} />
            Eventos
          </button>
        </div>

        {/* Content */}
        <div className="min-w-0 space-y-3">
          {activeSection === "webhook-events" ? (
            <>
              <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>Eventos de Webhook</h2>
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
            </>
          ) : section ? (
            <>
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--green)" }}>{section.icon}</span>
                <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>{section.label}</h2>
                <span className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>({section.endpoints.length} endpoints)</span>
              </div>
              <div className="space-y-2">
                {section.endpoints.map((ep, i) => {
                  const style = METHOD_STYLE[ep.method];
                  return (
                    <div key={i} className="rounded-xl p-3" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: style.bg, color: style.color }}>{ep.method}</span>
                        <code className="text-xs font-mono" style={{ color: "hsl(240 15% 80%)" }}>{ep.path}</code>
                      </div>
                      <p className="text-xs" style={{ color: "hsl(240 8% 55%)" }}>{ep.summary}</p>
                      {ep.body && (
                        <details className="mt-2">
                          <summary className="text-[10px] cursor-pointer" style={{ color: "hsl(240 8% 42%)" }}>Parâmetros</summary>
                          <div className="mt-1 space-y-1">
                            {Object.entries(ep.body).map(([k, v]) => (
                              <div key={k} className="flex gap-2 text-[10px] font-mono" style={{ color: "hsl(240 8% 55%)" }}>
                                <span style={{ color: v.required ? "#f87171" : "hsl(240 8% 55%)" }}>{k}</span>
                                <span style={{ color: "hsl(240 8% 38%)" }}>: {v.type}{v.required ? " (obrigatório)" : ""} — {v.description}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}