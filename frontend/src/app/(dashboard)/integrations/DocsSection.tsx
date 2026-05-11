"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
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
  PATCH:  { bg: "rgba(249,115,22,0.08)",    color: "#fb923c" },
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
      { method: "GET",    path: "/instances/{id}/agent",              summary: "Obter config do agente IA da instância", pathParams: ["id"] },
      { method: "PUT",    path: "/instances/{id}/agent",              summary: "Configurar agente IA da instância",  pathParams: ["id"],
        body: {
          enabled:        { type: "boolean", required: true,  description: "Ativar agente" },
          integration_id: { type: "string",  required: false, description: "ID da integração LLM" },
          system_prompt:  { type: "string",  required: false, description: "Prompt de sistema", example: "Você é um atendente..." },
          model:          { type: "string",  required: false, description: "Modelo específico" },
        } },
      { method: "GET",    path: "/instances/{id}/proxy/effective",    summary: "Proxy efetivo em uso (resolve herança instância→servidor→global)", pathParams: ["id"] },
      { method: "GET",    path: "/instances/{id}/recovery",           summary: "Status da rotina de recuperação automática", pathParams: ["id"] },
      { method: "POST",   path: "/instances/{id}/recovery/snapshot",  summary: "Disparar snapshot manual da sessão whatsmeow", pathParams: ["id"] },
      { method: "POST",   path: "/instances/{id}/recovery/reset",     summary: "Reset completo da sessão (requer re-pareamento)", pathParams: ["id"] },
      { method: "PUT",    path: "/instances/{id}/recovery/schedule",  summary: "Agendar frequência de snapshots automáticos", pathParams: ["id"],
        body: {
          interval_hours: { type: "number", required: true, description: "Intervalo entre snapshots (horas)", example: "12" },
        } },
      { method: "GET",    path: "/instances/{id}/ws",                 summary: "WebSocket de eventos em tempo real (upgrade HTTP→WS)", pathParams: ["id"] },
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
      { method: "GET",  path: "/instances/{id}/messages/{msgID}",      summary: "Buscar UMA mensagem por ID (qualquer tipo). Aceita UUID interno ou stanza WhatsApp.", pathParams: ["id", "msgID"] },
      { method: "POST", path: "/instances/{id}/messages/revoke",       summary: "Revogar/apagar mensagem",    pathParams: ["id"],
        body: {
          to:         { type: "string", required: true, description: "Número do chat",        example: "5511999999999" },
          message_id: { type: "string", required: true, description: "ID da mensagem",        example: "ABCD1234..." },
        } },
      { method: "POST", path: "/instances/{id}/messages/buttons",      summary: "Botões interativos (reply/url/call/copy)", pathParams: ["id"],
        body: {
          to:      { type: "string", required: true, description: "Número destinatário",      example: "5511999999999" },
          body:    { type: "string", required: true, description: "Texto principal",          example: "Escolha uma opção" },
          footer:  { type: "string", required: false,description: "Rodapé (opcional)",         example: "Uniq.chat" },
          buttons: { type: "array",  required: true, description: "Máx. 3 botões. Tipos: reply, url, call, copy", example: '[{"id":"sim","text":"Sim","type":"reply"},{"text":"Abrir site","type":"url","url":"https://uniq.chat"},{"text":"Copiar cupom","type":"copy","copy_code":"BLACKFRIDAY20"}]' },
        } },
      { method: "POST", path: "/instances/{id}/messages/template",     summary: "Template (alias de /buttons em formato Cloud API)", pathParams: ["id"],
        body: {
          to:      { type: "string", required: true, description: "Número destinatário",       example: "5511999999999" },
          content: { type: "string", required: true, description: "Conteúdo do template",      example: "Olá! Posso ajudar?" },
          footer:  { type: "string", required: false,description: "Rodapé" },
          buttons: { type: "array",  required: true, description: "Array de {display_text, type, id|url|phone_number}. Máx. 3.", example: '[{"display_text":"Sim","type":"quickreply","id":"yes"},{"display_text":"Visitar","type":"url","url":"https://uniq.chat"}]' },
        } },
      { method: "POST", path: "/instances/{id}/messages/list",         summary: "Lista interativa com seções",     pathParams: ["id"],
        body: {
          to:          { type: "string", required: true, description: "Número destinatário",  example: "5511999999999" },
          title:       { type: "string", required: true, description: "Título",               example: "Catálogo" },
          description: { type: "string", required: true, description: "Descrição",            example: "Escolha uma opção" },
          button_text: { type: "string", required: true, description: "Texto do botão",       example: "Ver opções" },
          footer:      { type: "string", required: false,description: "Rodapé" },
          sections:    { type: "array",  required: true, description: "Seções com rows {id, title, description}", example: '[{"title":"Atendimento","rows":[{"id":"suporte","title":"Suporte","description":"Falar com humano"}]}]' },
        } },
      { method: "POST", path: "/instances/{id}/messages/pix",          summary: "Cobrança PIX interativa (review_and_pay)", pathParams: ["id"],
        body: {
          to:            { type: "string", required: true, description: "Número destinatário",            example: "5511999999999" },
          merchant_name: { type: "string", required: true, description: "Nome do recebedor",              example: "Uniq Chat" },
          pix_key:       { type: "string", required: true, description: "Chave PIX",                       example: "pagamentos@uniq.chat" },
          key_type:      { type: "string", required: true, description: "CPF | CNPJ | EMAIL | PHONE | EVP", example: "EMAIL" },
          header_title:  { type: "string", required: false,description: "Título do card",                   example: "Pagamento" },
          body_text:     { type: "string", required: false,description: "Texto principal",                  example: "Toque em Pagar para concluir." },
          footer_text:   { type: "string", required: false,description: "Rodapé",                            example: "Uniq.chat" },
        } },
      { method: "POST", path: "/instances/{id}/messages/carousel",     summary: "Carrossel de cards (HSCROLL)", pathParams: ["id"],
        body: {
          to:    { type: "string", required: true, description: "Número destinatário",                      example: "5511999999999" },
          cards: { type: "array",  required: true, description: "Cards com header (title + image_url|video_url), body e até 3 buttons", example: '[{"header":{"title":"Plano Pro","image_url":"https://picsum.photos/seed/pro/720/480"},"body":"Recursos avançados.","buttons":[{"text":"Assinar","type":"url","url":"https://uniq.chat/checkout/pro"}]}]' },
        } },
      { method: "POST", path: "/instances/{id}/messages/menu",         summary: "Menu unificado (button/list/poll/carousel via DSL)", pathParams: ["id"],
        body: {
          number:     { type: "string", required: true, description: "Número destinatário",    example: "5511999999999" },
          type:       { type: "string", required: true, description: "button | list | poll | carousel", example: "list" },
          text:       { type: "string", required: true, description: "Texto principal",        example: "Escolha uma opção" },
          listButton: { type: "string", required: false,description: "Texto do botão (list)",   example: "Abrir menu" },
          footerText: { type: "string", required: false,description: "Rodapé",                  example: "Uniq.chat" },
          choices:    { type: "array",  required: true, description: "Opções em formato texto", example: '["[Atendimento]","Suporte|suporte|Falar com suporte"]' },
        } },
      { method: "POST", path: "/instances/{id}/messages/sticker",      summary: "Enviar sticker/figurinha",    pathParams: ["id"],
        body: {
          to:  { type: "string", required: true, description: "Número destinatário",           example: "5511999999999" },
          url: { type: "string", required: true, description: "URL do sticker (WebP)",          example: "https://exemplo.com/sticker.webp" },
        } },
      { method: "POST", path: "/instances/{id}/messages/status",       summary: "Publicar status/story",       pathParams: ["id"],
        body: {
          text:     { type: "string", required: false, description: "Texto do status",          example: "Bom dia!" },
          bg_color: { type: "string", required: false, description: "Cor de fundo (hex)",       example: "#103529" },
          url:      { type: "string", required: false, description: "URL de mídia (imagem/vídeo)" },
        } },
      { method: "POST", path: "/instances/{id}/messages/presence",     summary: "Atualizar presença global",   pathParams: ["id"],
        body: {
          available: { type: "boolean", required: true, description: "Online/offline",          example: "true" },
        } },
      { method: "POST", path: "/instances/{id}/messages/payment-request", summary: "Solicitar pagamento (WhatsApp Pay)", pathParams: ["id"],
        body: {
          to:       { type: "string", required: true,  description: "Número destinatário",     example: "5511999999999" },
          amount:   { type: "number", required: true,  description: "Valor",                    example: "99.90" },
          currency: { type: "string", required: false, description: "Moeda (padrão BRL)",       example: "BRL" },
          note:     { type: "string", required: false, description: "Nota/descrição",           example: "Pedido #1234" },
        } },
      { method: "POST", path: "/instances/{id}/contact/info",          summary: "Info completa de contato (nome, avatar, jid canônico)", pathParams: ["id"],
        body: {
          phone: { type: "string", required: true, description: "Número a consultar",           example: "5511999999999" },
        },
        response: `{ "exists": true, "jid": "5511999999999@s.whatsapp.net", "push_name": "Cliente", "avatar_url": "https://..." }` },
      { method: "POST", path: "/instances/{id}/contact/avatar",        summary: "Apenas o avatar de um contato", pathParams: ["id"],
        body: {
          jid: { type: "string", required: true, description: "JID do contato",                 example: "5511999999999@s.whatsapp.net" },
        },
        response: `{ "exists": true, "avatar_url": "https://..." }` },
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

      // ─── Paridade Evolution-Go ──────────────────────────────────
      { method: "POST", path: "/instances/{id}/messages/link",         summary: "Texto com preview de link automático", pathParams: ["id"],
        body: {
          to:   { type: "string", required: true, description: "Destinatário",                         example: "5511999999999" },
          text: { type: "string", required: true, description: "Texto contendo URL (preview auto)",   example: "Confira: https://uniq.chat" },
        } },
      { method: "POST", path: "/instances/{id}/messages/edit",         summary: "Editar texto de mensagem (janela 15min)", pathParams: ["id"],
        body: {
          chat_jid:   { type: "string", required: true, description: "JID do chat",       example: "5511999999999@s.whatsapp.net" },
          message_id: { type: "string", required: true, description: "ID da mensagem",     example: "ABCD1234" },
          new_text:   { type: "string", required: true, description: "Novo texto",          example: "Texto corrigido" },
        } },
      { method: "POST", path: "/instances/{id}/chat/pin",              summary: "Fixar/desafixar conversa", pathParams: ["id"],
        body: {
          jid:    { type: "string",  required: true, description: "JID do chat",  example: "5511999999999@s.whatsapp.net" },
          pinned: { type: "boolean", required: true, description: "true = fixar", example: "true" },
        } },
      { method: "POST", path: "/instances/{id}/chat/archive",          summary: "Arquivar/desarquivar conversa", pathParams: ["id"],
        body: {
          jid:      { type: "string",  required: true, description: "JID do chat",      example: "5511999999999@s.whatsapp.net" },
          archived: { type: "boolean", required: true, description: "true = arquivar",   example: "true" },
        } },
      { method: "POST", path: "/instances/{id}/chat/mute",             summary: "Silenciar/desilenciar (duration_ms=0 = sempre)", pathParams: ["id"],
        body: {
          jid:         { type: "string",  required: true, description: "JID do chat",       example: "5511999999999@s.whatsapp.net" },
          mute:        { type: "boolean", required: true, description: "true = silenciar",   example: "true" },
          duration_ms: { type: "number",  required: false, description: "Duração em ms (8h = 28800000)", example: "28800000" },
        } },
      { method: "POST", path: "/instances/{id}/chat/history-sync",     summary: "Pedir lote de mensagens antigas", pathParams: ["id"],
        body: {
          chat_jid:   { type: "string", required: true, description: "JID do chat",                example: "5511999999999@s.whatsapp.net" },
          message_id: { type: "string", required: true, description: "Última msg conhecida",       example: "ABCD1234" },
          sender_jid: { type: "string", required: false, description: "Sender (se 1:1, default = chat_jid)" },
          count:      { type: "number", required: false, description: "Qtd msgs (default 50)",      example: "100" },
        } },
      { method: "PUT",  path: "/instances/{id}/profile/name",          summary: "Atualizar nome (push name) da conta", pathParams: ["id"],
        body: { name: { type: "string", required: true, description: "Novo nome", example: "Uniq Chat" } } },
      { method: "PUT",  path: "/instances/{id}/profile/status",        summary: "Atualizar status/recado", pathParams: ["id"],
        body: { status: { type: "string", required: true, description: "Status curto", example: "Disponível" } } },
      { method: "PUT",  path: "/instances/{id}/profile/picture",       summary: "Atualizar/remover foto de perfil", pathParams: ["id"],
        body: {
          url:    { type: "string",  required: false, description: "URL da imagem JPEG" },
          base64: { type: "string",  required: false, description: "Base64 alternativo" },
          remove: { type: "boolean", required: false, description: "true ignora url/base64 e remove a foto" },
        } },
      { method: "POST", path: "/instances/{id}/block",                 summary: "Bloquear contato", pathParams: ["id"],
        body: { jid: { type: "string", required: true, description: "JID do contato", example: "5511999999999@s.whatsapp.net" } } },
      { method: "POST", path: "/instances/{id}/unblock",               summary: "Desbloquear contato", pathParams: ["id"],
        body: { jid: { type: "string", required: true, description: "JID do contato", example: "5511999999999@s.whatsapp.net" } } },
      { method: "GET",  path: "/instances/{id}/blocklist",             summary: "Listar contatos bloqueados", pathParams: ["id"],
        response: `{ "blocked": ["5511...@s.whatsapp.net"] }` },
      { method: "PUT",  path: "/instances/{id}/group-ops/photo",       summary: "Atualizar/remover foto do grupo", pathParams: ["id"],
        body: {
          jid:    { type: "string",  required: true,  description: "JID do grupo",   example: "12036xx@g.us" },
          url:    { type: "string",  required: false, description: "URL da imagem JPEG" },
          base64: { type: "string",  required: false, description: "Base64 alternativo" },
          remove: { type: "boolean", required: false, description: "true remove a foto" },
        } },
      { method: "PUT",  path: "/instances/{id}/group-ops/announce",    summary: "Modo announce (só admins falam)", pathParams: ["id"],
        body: {
          jid:      { type: "string",  required: true, description: "JID do grupo",  example: "12036xx@g.us" },
          announce: { type: "boolean", required: true, description: "true = ligar",   example: "true" },
        } },
      { method: "PUT",  path: "/instances/{id}/group-ops/locked",      summary: "Modo locked (só admins editam)", pathParams: ["id"],
        body: {
          jid:    { type: "string",  required: true, description: "JID do grupo", example: "12036xx@g.us" },
          locked: { type: "boolean", required: true, description: "true = ligar",  example: "true" },
        } },
      { method: "POST", path: "/instances/{id}/labels/chat",           summary: "Aplicar/remover label em conversa", pathParams: ["id"],
        body: {
          jid:      { type: "string",  required: true, description: "JID do chat",                  example: "5511999999999@s.whatsapp.net" },
          label_id: { type: "string",  required: true, description: "ID numérico da label",          example: "1" },
          labeled:  { type: "boolean", required: true, description: "true aplica, false remove",      example: "true" },
        } },
      { method: "POST", path: "/instances/{id}/labels/message",        summary: "Aplicar/remover label em mensagem", pathParams: ["id"],
        body: {
          jid:        { type: "string",  required: true, description: "JID do chat" },
          label_id:   { type: "string",  required: true, description: "ID da label" },
          message_id: { type: "string",  required: true, description: "ID da mensagem" },
          labeled:    { type: "boolean", required: true, description: "true aplica, false remove" },
        } },
      { method: "POST", path: "/instances/{id}/labels/edit",           summary: "Criar/renomear/recolorir/apagar label", pathParams: ["id"],
        body: {
          label_id: { type: "string",  required: true,  description: "ID numérico",                    example: "1" },
          name:     { type: "string",  required: false, description: "Nome novo",                       example: "Lead quente" },
          color:    { type: "number",  required: false, description: "Índice 0..19 da paleta",          example: "5" },
          deleted:  { type: "boolean", required: false, description: "true apaga a label" },
        } },
      { method: "GET",  path: "/instances/{id}/privacy",               summary: "Snapshot das settings de privacidade", pathParams: ["id"] },
      { method: "PUT",  path: "/instances/{id}/privacy",               summary: "Alterar uma setting de privacidade", pathParams: ["id"],
        body: {
          setting: { type: "string", required: true, description: "lastseen | profile | status | readreceipts | groupadd | calladd | online", example: "lastseen" },
          value:   { type: "string", required: true, description: "all | contacts | contact_blacklist | match_last_seen | known | none",     example: "contacts" },
        } },
      { method: "POST", path: "/instances/{id}/force-reconnect",       summary: "Disconnect + reconnect socket", pathParams: ["id"] },
      { method: "POST", path: "/instances/{id}/communities",           summary: "Criar comunidade WhatsApp", pathParams: ["id"],
        body: {
          name:        { type: "string", required: true,  description: "Nome",        example: "Minha comunidade" },
          description: { type: "string", required: false, description: "Descrição" },
        } },
      { method: "POST", path: "/instances/{id}/communities/link",      summary: "Vincular grupo como subgrupo", pathParams: ["id"],
        body: {
          parent_jid: { type: "string", required: true, description: "JID da comunidade", example: "12036xx@g.us" },
          child_jid:  { type: "string", required: true, description: "JID do grupo",       example: "12036yy@g.us" },
        } },
      { method: "POST", path: "/instances/{id}/communities/unlink",    summary: "Remover subgrupo da comunidade", pathParams: ["id"],
        body: {
          parent_jid: { type: "string", required: true, description: "JID da comunidade" },
          child_jid:  { type: "string", required: true, description: "JID do subgrupo" },
        } },
      { method: "GET",  path: "/instances/{id}/communities/{jid}/groups", summary: "Listar subgrupos da comunidade", pathParams: ["id", "jid"] },
      { method: "POST", path: "/instances/{id}/newsletters",           summary: "Criar canal/newsletter", pathParams: ["id"],
        body: {
          name:           { type: "string", required: true,  description: "Nome do canal" },
          description:    { type: "string", required: false, description: "Descrição" },
          picture_url:    { type: "string", required: false, description: "URL da foto" },
          picture_base64: { type: "string", required: false, description: "Base64 alternativo" },
        } },
      { method: "GET",  path: "/instances/{id}/newsletters",           summary: "Listar canais que segue", pathParams: ["id"] },
      { method: "GET",  path: "/instances/{id}/newsletters/{jid}",     summary: "Info do canal (use ?invite=<key> em vez do JID p/ resolver convite)", pathParams: ["id", "jid"] },
      { method: "POST", path: "/instances/{id}/newsletters/{jid}/follow",   summary: "Seguir canal",       pathParams: ["id", "jid"] },
      { method: "POST", path: "/instances/{id}/newsletters/{jid}/unfollow", summary: "Deixar de seguir",   pathParams: ["id", "jid"] },
      { method: "GET",  path: "/instances/{id}/newsletters/{jid}/messages", summary: "Mensagens do canal", pathParams: ["id", "jid"] },
      { method: "POST", path: "/instances/{id}/calls/reject",          summary: "Rejeitar chamada recebida", pathParams: ["id"],
        body: {
          caller_jid: { type: "string", required: true, description: "Quem ligou (do evento de oferta)", example: "5511999999999@s.whatsapp.net" },
          call_id:    { type: "string", required: true, description: "ID da chamada (do evento)",         example: "abc123" },
        } },

      // ─── Extras whatsmeow (nem Evo-Go expõe) ────────────────────
      { method: "GET",  path: "/instances/{id}/business-profile/{jid}", summary: "Perfil business (catálogo, horário, email, site)", pathParams: ["id", "jid"] },
      { method: "POST", path: "/instances/{id}/disappearing",          summary: "Mensagens efêmeras por chat", pathParams: ["id"],
        body: {
          chat_jid:    { type: "string", required: true, description: "JID do chat",                      example: "5511999999999@s.whatsapp.net" },
          duration_ms: { type: "number", required: true, description: "0=off, 86400000=24h, 604800000=7d, 7776000000=90d", example: "604800000" },
        } },
      { method: "POST", path: "/instances/{id}/disappearing/default",  summary: "Default global de mensagens efêmeras", pathParams: ["id"],
        body: { duration_ms: { type: "number", required: true, description: "Mesma escala do endpoint anterior", example: "604800000" } } },
      { method: "POST", path: "/instances/{id}/groups/join-with-invite", summary: "Entrar em grupo via código (privado)", pathParams: ["id"],
        body: {
          group_jid:   { type: "string", required: true,  description: "JID do grupo" },
          inviter_jid: { type: "string", required: true,  description: "JID de quem convidou" },
          code:        { type: "string", required: true,  description: "Código do convite" },
          expiration:  { type: "number", required: false, description: "Timestamp unix da expiração" },
        } },
      { method: "POST", path: "/instances/{id}/groups/preview-invite", summary: "Preview de grupo SEM entrar", pathParams: ["id"],
        body: {
          group_jid:   { type: "string", required: true,  description: "JID do grupo" },
          inviter_jid: { type: "string", required: true,  description: "JID de quem convidou" },
          code:        { type: "string", required: true,  description: "Código" },
          expiration:  { type: "number", required: false, description: "Timestamp" },
        } },
      { method: "GET",  path: "/instances/{id}/groups/preview-link",   summary: "Resolve link chat.whatsapp.com/<code>", pathParams: ["id"] },
      { method: "GET",  path: "/instances/{id}/groups/{jid}/requests", summary: "Pedidos pendentes de entrada", pathParams: ["id", "jid"] },
      { method: "POST", path: "/instances/{id}/groups/{jid}/requests", summary: "Aprovar/rejeitar pedidos", pathParams: ["id", "jid"],
        body: {
          participants: { type: "string[]", required: true, description: "JIDs dos solicitantes" },
          action:       { type: "string",   required: true, description: "approve | reject", example: "approve" },
        } },
      { method: "GET",  path: "/instances/{id}/communities/{jid}/participants", summary: "Todos participantes únicos da comunidade", pathParams: ["id", "jid"] },
      { method: "POST", path: "/instances/{id}/newsletters/{jid}/mark-viewed", summary: "Marcar msgs do canal como vistas", pathParams: ["id", "jid"],
        body: { server_ids: { type: "number[]", required: true, description: "Lista de server_id", example: "[1234,1235]" } } },
      { method: "POST", path: "/instances/{id}/newsletters/{jid}/react", summary: "Reagir mensagem do canal", pathParams: ["id", "jid"],
        body: {
          server_id:  { type: "number", required: true, description: "server_id" },
          reaction:   { type: "string", required: false, description: "Emoji (vazio remove)", example: "👍" },
          message_id: { type: "string", required: true, description: "MessageID" },
        } },
      { method: "POST", path: "/instances/{id}/newsletters/{jid}/mute", summary: "Silenciar/desilenciar canal", pathParams: ["id", "jid"],
        body: { mute: { type: "boolean", required: true, description: "true silencia", example: "true" } } },
      { method: "POST", path: "/instances/{id}/tos/accept",            summary: "Aceitar TOS pendente", pathParams: ["id"],
        body: {
          notice_id: { type: "string", required: true,  description: "ID do notice" },
          stage:     { type: "string", required: false, description: "Stage do notice" },
        } },
      { method: "GET",  path: "/instances/{id}/status-privacy",        summary: "Privacy de status updates", pathParams: ["id"] },
      { method: "GET",  path: "/instances/{id}/resolve/business-link", summary: "Resolve wa.me/message/<code>", pathParams: ["id"] },
      { method: "GET",  path: "/instances/{id}/resolve/contact-qr",    summary: "Resolve wa.me/qr/<code>", pathParams: ["id"] },
      { method: "GET",  path: "/instances/{id}/qr-link",               summary: "Link QR público da conta. ?revoke=true regera", pathParams: ["id"] },

      // ─── Sprint 8 — PIX simplificado ────────────────────────────
      { method: "POST", path: "/instances/{id}/messages/pix-button",   summary: "PIX minimalista — só pix_key + key_type (paridade UazAPI)", pathParams: ["id"],
        body: {
          to:            { type: "string", required: true,  description: "Destinatário",                example: "5511999999999" },
          pix_key:       { type: "string", required: true,  description: "Chave PIX",                    example: "pagamentos@uniq.chat" },
          key_type:      { type: "string", required: true,  description: "CPF | CNPJ | EMAIL | PHONE | EVP", example: "EMAIL" },
          merchant_name: { type: "string", required: false, description: "Nome do recebedor (default: 'Pagamento PIX')" },
          body_text:     { type: "string", required: false, description: "Texto do card (gerado se vazio)" },
        } },

      // ─── Sprint 7 — Warmup (anti-ban) ────────────────────────────
      { method: "GET",  path: "/instances/{id}/warmup",                summary: "Estado da sessão de warmup", pathParams: ["id"] },
      { method: "POST", path: "/instances/{id}/warmup",                summary: "Configurar warmup (curva de volume + pools)", pathParams: ["id"],
        body: {
          duration_days: { type: "number",   required: false, description: "Total da curva (default 14)",          example: "14" },
          daily_target:  { type: "number",   required: false, description: "Target ao final (default 200)",         example: "200" },
          start_hour:    { type: "number",   required: false, description: "Janela ativa início (0..23)",            example: "9" },
          end_hour:      { type: "number",   required: false, description: "Janela ativa fim",                        example: "21" },
          min_delay_sec: { type: "number",   required: false, description: "Intervalo mínimo entre msgs",            example: "60" },
          max_delay_sec: { type: "number",   required: false, description: "Intervalo máximo",                        example: "300" },
          message_pool:  { type: "string[]", required: true,  description: "Frases humanas (sortidas aleatoriamente)", example: '["Bom dia!","Tudo certo?"]' },
          contact_pool:  { type: "string[]", required: true,  description: "JIDs/telefones de teste",                  example: '["5511...@s.whatsapp.net"]' },
        } },
      { method: "POST", path: "/instances/{id}/warmup/start",          summary: "Iniciar warmup",  pathParams: ["id"] },
      { method: "POST", path: "/instances/{id}/warmup/pause",          summary: "Pausar warmup",   pathParams: ["id"] },
      { method: "POST", path: "/instances/{id}/warmup/resume",         summary: "Retomar warmup",  pathParams: ["id"] },
      { method: "POST", path: "/instances/{id}/warmup/stop",           summary: "Parar definitivamente", pathParams: ["id"] },

      // ─── Sprint 9 — RAG ingestion (sem upload de arquivo) ────────
      { method: "POST", path: "/instances/{id}/agent/ingest-url",      summary: "Ingerir URL na knowledge base do agente", pathParams: ["id"],
        body: {
          url:  { type: "string", required: true,  description: "URL pública (HTML/MD/TXT)",  example: "https://uniq.chat/faq" },
          name: { type: "string", required: false, description: "Nome amigável do asset" },
        } },
      { method: "POST", path: "/instances/{id}/agent/ingest-text",     summary: "Ingerir texto direto na knowledge base", pathParams: ["id"],
        body: {
          name:     { type: "string", required: false, description: "Nome do asset" },
          text:     { type: "string", required: true,  description: "Texto cru (FAQ, instruções, catálogo)" },
          category: { type: "string", required: false, description: "knowledge | faq | skill (default knowledge)" },
        } },
    ],
  },

  // ─── Sprint 7 — Campaign control granular ───────────────────────
  {
    id: "campaigns-control",
    label: "Campanhas (controle)",
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "POST", path: "/campaigns/{id}/resume",      summary: "Retomar campanha pausada", pathParams: ["id"] },
      { method: "POST", path: "/campaigns/{id}/abort",       summary: "Cancelar campanha (alias UazAPI-style)", pathParams: ["id"] },
      { method: "POST", path: "/campaigns/{id}/clear-sent",  summary: "Limpar fila já enviada (pra reusar a campanha)", pathParams: ["id"] },
      { method: "GET",  path: "/campaigns/{id}/messages",    summary: "Status por mensagem com paginação. Query: ?status=sent|failed|pending&limit=100&offset=0", pathParams: ["id"] },
    ],
  },

  // ─── Sprint 8 — Triggers (autoresponder por keyword) ────────────
  {
    id: "triggers",
    label: "Triggers",
    icon: <ShieldCheck className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/triggers",              summary: "Listar triggers. Query: ?instance_id=<uuid>&only_active=true" },
      { method: "POST",   path: "/triggers",              summary: "Criar trigger (autoresponder simples)",
        body: {
          name:           { type: "string",  required: true,  description: "Nome amigável",                                            example: "Saudação" },
          keyword:        { type: "string",  required: true,  description: "Palavra/regex que dispara",                                example: "oi" },
          action:         { type: "string",  required: true,  description: "reply | forward_ai | tag | start_journey",                  example: "reply" },
          payload:        { type: "string",  required: false, description: "Reply: texto. Tag: nome da tag. Journey: UUID.",            example: "Olá! Como posso ajudar?" },
          match_mode:     { type: "string",  required: false, description: "exact | contains | starts | regex (default contains)",      example: "contains" },
          case_sensitive: { type: "boolean", required: false, description: "Default false" },
          priority:       { type: "number",  required: false, description: "Menor = mais prioritário (default 100)",                     example: "100" },
          multi_match:    { type: "boolean", required: false, description: "Se true, não para no primeiro match" },
          cooldown_sec:   { type: "number",  required: false, description: "Cooldown por contato (default 300)",                         example: "300" },
          only_direct:    { type: "boolean", required: false, description: "Se true, ignora grupos (default true)" },
          instance_id:    { type: "string",  required: false, description: "Limita a uma instância (vazio = todas)" },
        } },
      { method: "GET",    path: "/triggers/{id}",         summary: "Detalhes do trigger",          pathParams: ["id"] },
      { method: "PUT",    path: "/triggers/{id}",         summary: "Atualizar trigger",            pathParams: ["id"] },
      { method: "DELETE", path: "/triggers/{id}",         summary: "Remover trigger",              pathParams: ["id"] },
      { method: "POST",   path: "/triggers/{id}/test",    summary: "Simular match com texto",       pathParams: ["id"],
        body: { text: { type: "string", required: true, description: "Texto sample", example: "olá, gostaria de saber mais" } } },
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
      { method: "GET",    path: "/crm/funnels",          summary: "Listar funis de vendas" },
      { method: "POST",   path: "/crm/funnels",          summary: "Criar novo funil",
        body: {
          name: { type: "string", required: true, description: "Nome do funil", example: "Vendas Enterprise" },
        } },
      { method: "DELETE", path: "/crm/funnels/{id}",     summary: "Remover funil", pathParams: ["id"] },
      { method: "GET",    path: "/crm/funnels/{id}/stages", summary: "Listar etapas do funil", pathParams: ["id"] },
      { method: "POST",   path: "/crm/funnels/{id}/stages", summary: "Adicionar etapa ao funil", pathParams: ["id"],
        body: {
          name:  { type: "string", required: true,  description: "Nome da etapa",  example: "Proposta" },
          order: { type: "number", required: false, description: "Ordem na visualização", example: "2" },
          color: { type: "string", required: false, description: "Cor hex",              example: "#3b82f6" },
        } },
      { method: "DELETE", path: "/crm/funnels/{id}/stages/:stageId", summary: "Remover etapa", pathParams: ["id", "stageId"] },
      { method: "GET",    path: "/crm/funnel-options",   summary: "Autocomplete: nomes de funis em uso" },
      { method: "GET",    path: "/crm/stage-options",    summary: "Autocomplete: nomes de etapas em uso" },
      { method: "GET",    path: "/crm/journey-options",  summary: "Autocomplete: nomes de jornadas em uso por contatos" },
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
      { method: "POST",   path: "/campaigns/segment-preview", summary: "Prévia do tamanho do segmento",
        body: {
          funnel: { type: "string",   required: false, description: "Filtrar por funil",  example: "Vendas" },
          stage:  { type: "string",   required: false, description: "Filtrar por etapa",  example: "Qualificado" },
          tags:   { type: "string[]", required: false, description: "Filtrar por tags",   example: '["vip"]' },
        },
        response: `{ "total": 1287, "sample": [{ "id": "...", "name": "..." }] }` },
      { method: "GET",    path: "/campaigns/segment-options", summary: "Filtros disponíveis (funis, stages, tags, jornadas)" },
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
      { method: "GET",    path: "/webhooks/system",                  summary: "Listar webhooks de workspace (recebe eventos de TODAS as instâncias)" },
      { method: "POST",   path: "/webhooks/system",                  summary: "Criar webhook de workspace",
        body: {
          url:    { type: "string",   required: true, description: "URL de destino",    example: "https://central.exemplo.com/wh" },
          events: { type: "string[]", required: true, description: "Eventos a escutar", example: '["message.received","journey.triggered"]' },
        } },
      { method: "PUT",    path: "/webhooks/system/{id}",             summary: "Atualizar webhook de workspace", pathParams: ["id"] },
      { method: "DELETE", path: "/webhooks/system/{id}",             summary: "Remover webhook de workspace",  pathParams: ["id"] },
      { method: "POST",   path: "/webhooks/system/{id}/test",        summary: "Disparar evento de teste", pathParams: ["id"],
        response: `{ "ok": true, "status_code": 200, "latency_ms": 120 }` },
      { method: "GET",    path: "/webhooks/system/events",           summary: "Listar tipos de eventos disponíveis para assinatura" },
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
      { method: "PUT",    path: "/integrations/{id}",        summary: "Atualizar integração",  pathParams: ["id"],
        body: {
          name:      { type: "string",   required: false, description: "Novo nome" },
          api_key:   { type: "string",   required: false, description: "Nova API key" },
          models:    { type: "string[]", required: false, description: "Modelos habilitados" },
          is_active: { type: "boolean",  required: false, description: "Ativar/desativar" },
        } },
      { method: "DELETE", path: "/integrations/{id}",        summary: "Deletar integração",    pathParams: ["id"] },
      { method: "POST",   path: "/integrations/{id}/test",   summary: "Testar integração",     pathParams: ["id"] },
      { method: "POST",   path: "/integrations/claude/oauth/start",      summary: "Iniciar OAuth PKCE do Claude — retorna auth_url pra redirect",
        response: `{ "auth_url": "https://claude.ai/oauth/authorize?...", "state": "..." }` },
      { method: "POST",   path: "/integrations/claude/oauth/callback",   summary: "Callback OAuth Claude — troca code por tokens",
        body: {
          code:  { type: "string", required: true, description: "Authorization code recebido" },
          state: { type: "string", required: true, description: "State pra validar fluxo" },
        } },
      { method: "POST",   path: "/integrations/openrouter/oauth/start",    summary: "Iniciar OAuth PKCE do OpenRouter",
        response: `{ "auth_url": "https://openrouter.ai/auth?...", "state": "..." }` },
      { method: "POST",   path: "/integrations/openrouter/oauth/callback", summary: "Callback OAuth OpenRouter" },
      { method: "POST",   path: "/integrations/{id}/oauth/refresh",        summary: "Renovar access_token expirado (OAuth)", pathParams: ["id"] },
      { method: "POST",   path: "/ai/generate",                summary: "Gerar variações de texto com IA",
        body: {
          text:  { type: "string", required: true,  description: "Texto base",           example: "Olá, tudo bem?" },
          count: { type: "number", required: false, description: "Qtd de variações",     example: "3" },
        },
        response: `{ "variations": ["...", "...", "..."] }` },
    ],
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: <MessageSquare className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",    path: "/instances/{id}/inbox/chats",                  summary: "Listar conversas com última mensagem + dados do CRM", pathParams: ["id"] },
      { method: "GET",    path: "/instances/{id}/inbox/chats/:jid",             summary: "Detalhes do contato + estatísticas", pathParams: ["id", "jid"] },
      { method: "GET",    path: "/instances/{id}/inbox/chats/:jid/messages",    summary: "Histórico paginado de mensagens", pathParams: ["id", "jid"] },
      { method: "POST",   path: "/instances/{id}/inbox/chats/:jid/messages",    summary: "Enviar mensagem via inbox (roteia LID/PN automaticamente)", pathParams: ["id", "jid"],
        body: {
          text:              { type: "string", required: true,  description: "Texto",                    example: "Olá! Como posso ajudar?" },
          quoted_message_id: { type: "string", required: false, description: "Responder mensagem específica" },
        } },
      { method: "POST",   path: "/instances/{id}/inbox/chats/:jid/messages/media", summary: "Enviar mídia (multipart/form-data)", pathParams: ["id", "jid"],
        body: {
          file:    { type: "file",   required: true,  description: "Arquivo multipart" },
          caption: { type: "string", required: false, description: "Legenda" },
        } },
      { method: "POST",   path: "/instances/{id}/inbox/chats/:jid/read",        summary: "Marcar chat como lido", pathParams: ["id", "jid"] },
      { method: "POST",   path: "/instances/{id}/inbox/chats/:jid/typing",      summary: "Simular typing (3s padrão)", pathParams: ["id", "jid"],
        body: {
          duration_ms: { type: "number", required: false, description: "Duração em ms", example: "3000" },
        } },
      { method: "PATCH",  path: "/instances/{id}/inbox/messages/:id",           summary: "Atualizar mensagem (starred, nota)", pathParams: ["id"] },
      { method: "POST",   path: "/instances/{id}/inbox/messages/:msgID/resend", summary: "Reenviar mensagem que falhou", pathParams: ["id", "msgID"] },
      { method: "PUT",    path: "/instances/{id}/inbox/contacts/:contactId",    summary: "Atualizar dados do contato pela inbox", pathParams: ["id", "contactId"],
        body: {
          name:   { type: "string",   required: false, description: "Nome" },
          funnel: { type: "string",   required: false, description: "Funil",      example: "Vendas" },
          stage:  { type: "string",   required: false, description: "Etapa",      example: "Qualificado" },
          tags:   { type: "string[]", required: false, description: "Tags",       example: '["vip"]' },
          notes:  { type: "string",   required: false, description: "Observações" },
        } },
    ],
  },
  {
    id: "journeys",
    label: "Jornadas",
    icon: <Activity className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "POST",   path: "/ai/chat",                            summary: "Conversar com a IA (contexto de jornadas e instâncias)",
        body: {
          message:        { type: "string", required: true,  description: "Prompt do usuário",       example: "Crie jornada que responda 'preço' com o catálogo" },
          integration_id: { type: "string", required: false, description: "ID da integração LLM (opcional)" },
        },
        response: `{ "response": "...", "journey_created": false }` },
      { method: "GET",    path: "/ai/tools",                           summary: "Listar tools disponíveis pro assistente IA" },
      { method: "GET",    path: "/journeys",                           summary: "Listar jornadas do usuário" },
      { method: "POST",   path: "/journeys",                           summary: "Criar jornada via prompt em linguagem natural",
        body: {
          prompt:         { type: "string", required: true,  description: "Descrição da jornada", example: "Quando alguém falar 'preço' no grupo @vendas, envie catálogo" },
          integration_id: { type: "string", required: false, description: "ID da integração LLM" },
          original_input: { type: "string", required: false, description: "Input cru do usuário (preservado)" },
        } },
      { method: "GET",    path: "/journeys/{id}",                       summary: "Detalhes completos + flow + stats", pathParams: ["id"] },
      { method: "DELETE", path: "/journeys/{id}",                       summary: "Remover jornada", pathParams: ["id"] },
      { method: "PATCH",  path: "/journeys/{id}/status",                summary: "Ativar/pausar/arquivar", pathParams: ["id"],
        body: { status: { type: "string", required: true, description: "active | paused | archived", example: "paused" } } },
      { method: "PATCH",  path: "/journeys/{id}/flow",                  summary: "Atualizar flow (canvas builder)", pathParams: ["id"],
        body: {
          flow: { type: "object", required: true, description: "{ steps, edges, start_step }" },
        } },
      { method: "PATCH",  path: "/journeys/{id}/trigger",               summary: "Atualizar gatilho (keywords, grupo, modo)", pathParams: ["id"],
        body: {
          trigger_type:  { type: "string",   required: false, description: "group_keyword | private_keyword | etc", example: "group_keyword" },
          group_jid:     { type: "string",   required: false, description: "JID do grupo",  example: "120363xxx@g.us" },
          keywords:      { type: "array",    required: false, description: "[{ word, op }]", example: '[{"word":"preço","op":"contains"}]' },
          response_mode: { type: "string",   required: false, description: "private | group", example: "private" },
          name:          { type: "string",   required: false, description: "Nome da jornada" },
        } },
      { method: "POST",   path: "/journeys/{id}/edit-llm",              summary: "Editar jornada via prompt (LLM)", pathParams: ["id"],
        body: { instruction: { type: "string", required: true, description: "Instrução de edição", example: "Adicione delay de 5s antes da resposta" } } },
      { method: "POST",   path: "/journeys/{id}/simulate",              summary: "Simular execução em sandbox (sem enviar)", pathParams: ["id"],
        body: {
          input_text:   { type: "string", required: true,  description: "Mensagem de entrada",    example: "Olá, tem preço?" },
          contact_name: { type: "string", required: false, description: "Nome do contato simulado" },
        },
        response: `{ "events": [...], "steps_run": 3, "final_vars": {} }` },
      { method: "GET",    path: "/journeys/{id}/executions",            summary: "Histórico de execuções", pathParams: ["id"] },
      { method: "GET",    path: "/journeys/templates",                  summary: "Listar templates públicos de jornadas" },
      { method: "POST",   path: "/journeys/from-template/:slug",        summary: "Criar jornada a partir de template", pathParams: ["slug"],
        body: {
          instance_id: { type: "string", required: true,  description: "Instância que vai rodar" },
          customize:   { type: "object", required: false, description: "Variáveis customizáveis do template" },
        } },
    ],
  },
  {
    id: "agent",
    label: "Agent Stats",
    icon: <Activity className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",  path: "/agent/stats",                summary: "KPIs agregados do agente IA (execs, taxa de sucesso, tempo médio)" },
      { method: "GET",  path: "/agent/activity",             summary: "Feed de atividade em tempo real (últimas execs, alertas)" },
      { method: "GET",  path: "/agent/instances",            summary: "Status do agente em cada instância" },
      { method: "POST", path: "/agent/executions/{id}/stop", summary: "Interromper execução em andamento", pathParams: ["id"] },
    ],
  },
  {
    id: "invites",
    label: "Invites",
    icon: <Users className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "POST", path: "/invites/generate", summary: "Gerar novo código de convite",
        response: `{ "code": "UNIQ-1234-ABCD", "expires_at": "..." }` },
      { method: "POST", path: "/invites/validate", summary: "Validar código de convite (usado no cadastro)",
        body: { code: { type: "string", required: true, description: "Código recebido", example: "UNIQ-1234-ABCD" } },
        response: `{ "valid": true, "invited_by": "..." }` },
      { method: "GET",  path: "/invites/mine",     summary: "Meus convites e status" },
      { method: "GET",  path: "/invites/status",   summary: "Checar se invite-only está ativo",
        response: `{ "invite_required": true }` },
    ],
  },
  {
    id: "payments",
    label: "Billing",
    icon: <Key className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",  path: "/payments/plans",         summary: "Listar planos ativos (unifica Stripe+Asaas)" },
      { method: "POST", path: "/payments/checkout",      summary: "Criar sessão de checkout",
        body: {
          plan_id:    { type: "string", required: true, description: "ID do plano",                example: "pro" },
          provider:   { type: "string", required: true, description: "stripe | asaas",              example: "stripe" },
          return_url: { type: "string", required: true, description: "URL de retorno",              example: "https://app.uniq.chat/billing" },
        },
        response: `{ "checkout_url": "https://..." }` },
      { method: "GET",  path: "/payments/subscription",  summary: "Status da assinatura atual" },
      { method: "GET",  path: "/stripe/plans",           summary: "Planos Stripe" },
      { method: "POST", path: "/stripe/checkout",        summary: "Sessão Stripe Checkout" },
      { method: "GET",  path: "/stripe/subscription",    summary: "Assinatura Stripe" },
      { method: "GET",  path: "/asaas/plans",            summary: "Planos Asaas (PIX/boleto)" },
      { method: "POST", path: "/asaas/checkout",         summary: "Cobrança Asaas" },
      { method: "GET",  path: "/asaas/subscription",     summary: "Assinatura Asaas" },
    ],
  },
  {
    id: "permissions",
    label: "Permissões",
    icon: <Key className="w-3.5 h-3.5" />,
    endpoints: [
      { method: "GET",  path: "/permissions",      summary: "Listar permissões do sistema (inbox.read, crm.write, etc)" },
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

// CopyBtn — botão pequeno que copia texto pra clipboard com feedback visual.
// Usa toast.sonner se disponível; fallback pra ícone Check temporário.
function CopyBtn({
  value,
  label,
  size = "sm",
  variant = "default",
}: {
  value: string;
  label?: string;
  size?: "xs" | "sm";
  variant?: "default" | "primary";
}) {
  const [copied, setCopied] = useState(false);
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  const isPrimary = variant === "primary";
  const sizeCls = size === "xs" ? "text-[10px] px-2 py-1" : "text-[11px] px-2.5 py-1.5";
  const iconSize = size === "xs" ? "w-3 h-3" : "w-3.5 h-3.5";
  return (
    <button
      onClick={onClick}
      title={label ? `Copiar ${label.toLowerCase()}` : "Copiar"}
      className={cn(
        "flex items-center gap-1.5 rounded-md font-medium transition-all",
        sizeCls,
      )}
      style={{
        background: copied
          ? "rgba(0,212,106,0.15)"
          : isPrimary
            ? "rgba(0,212,106,0.08)"
            : "var(--surface-2)",
        border: copied
          ? "1px solid rgba(0,212,106,0.3)"
          : isPrimary
            ? "1px solid rgba(0,212,106,0.2)"
            : "1px solid var(--border-default)",
        color: copied || isPrimary ? "#00d46a" : "var(--text-3)",
      }}
    >
      {copied ? <Check className={iconSize} /> : <Copy className={iconSize} />}
      {label && <span>{copied ? "Copiado!" : label}</span>}
    </button>
  );
}

// Substitui {placeholders} no path por valores reais do user (instance id,
// api base, etc) pra que o copy gere uma URL pronta pra colar no n8n/curl.
function expandPath(path: string, instanceId?: string): string {
  let out = path;
  if (instanceId) out = out.replace(/\{id\}/g, instanceId);
  // Outros placeholders (campaignId, contactId…) ficam como estão pro user
  // saber que precisa preencher manualmente.
  return out;
}

// Constrói body JSON cru a partir do schema com os valores `example` dos
// próprios docs. Campos opcionais sem example viram comentários inline.
function buildExampleBody(body?: Endpoint["body"]): string {
  if (!body) return "";
  const obj: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v.example !== undefined && v.example !== "") {
      // Tenta inferir o tipo: number/boolean ficam crus, resto é string.
      const ex = v.example;
      if (v.type === "boolean") obj[k] = ex === "true";
      else if (v.type === "number") {
        const n = Number(ex);
        obj[k] = Number.isFinite(n) ? n : ex;
      } else obj[k] = ex;
    } else if (v.required) {
      // Pra requireds sem example, deixa um placeholder explícito.
      obj[k] = `<${v.type}>`;
    }
  }
  return JSON.stringify(obj, null, 2);
}

// cURL completo pra colar no terminal — auth + content-type + body se POST/PUT.
function buildCurl(
  endpoint: Endpoint,
  fullUrl: string,
  apiKey: string,
  body: string,
): string {
  const lines: string[] = [`curl -X ${endpoint.method} "${fullUrl}" \\`];
  if (apiKey) lines.push(`  -H "apikey: ${apiKey}" \\`);
  if (body) {
    lines.push(`  -H "Content-Type: application/json" \\`);
    lines.push(`  -d '${body.replace(/'/g, "'\\''")}'`);
  } else {
    // Remove o último \ pra não ficar pendurado.
    lines[lines.length - 1] = lines[lines.length - 1]!.replace(/ \\$/, "");
  }
  return lines.join("\n");
}

function EndpointCard({
  endpoint,
  apiKey,
  instanceId,
}: {
  endpoint: Endpoint;
  apiKey: string;
  instanceId: string;
}) {
  const [paramsOpen, setParamsOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const style = METHOD_STYLE[endpoint.method];

  const expandedPath = expandPath(endpoint.path, instanceId);
  const fullUrl = `${API_BASE}${expandedPath}`;
  const exampleBody = buildExampleBody(endpoint.body);
  const curl = buildCurl(endpoint, fullUrl, apiKey, exampleBody);

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: "var(--surface-solid)", border: "1px solid var(--border)" }}>
      <div className="p-3">
        <div className="flex items-start gap-2">
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
            style={{ background: style?.bg, color: style?.color }}
          >
            {endpoint.method}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <code className="text-xs font-mono break-all" style={{ color: "hsl(240 15% 80%)" }}>
                {expandedPath}
              </code>
              <CopyBtn value={fullUrl} label="URL" size="xs" />
              <CopyBtn value={curl} label="cURL" size="xs" />
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>{endpoint.summary}</p>
          </div>
        </div>

        {endpoint.body && (
          <div className="mt-3" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setParamsOpen((o) => !o)}
                className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest transition-colors"
                style={{ color: "var(--text-3)" }}
              >
                {paramsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                Parâmetros ({Object.keys(endpoint.body).length})
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowRaw((v) => !v)}
                  className="text-[10px] font-medium px-2 py-1 rounded-md transition-colors"
                  style={{
                    background: showRaw ? "rgba(0,212,106,0.08)" : "var(--surface-2)",
                    border: "1px solid " + (showRaw ? "rgba(0,212,106,0.2)" : "var(--surface-2)"),
                    color: showRaw ? "#00d46a" : "var(--text-3)",
                  }}
                >
                  {showRaw ? "Tabela" : "JSON cru"}
                </button>
                <CopyBtn value={exampleBody} label="JSON" size="xs" variant="primary" />
              </div>
            </div>

            <AnimatePresence initial={false}>
            {paramsOpen && !showRaw && (
              <motion.div
                key="params-table"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                style={{ overflow: "hidden" }}
              >
              <div className="mt-2 space-y-1.5">
                {Object.entries(endpoint.body).map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-start gap-2 text-[11px] rounded-lg px-2.5 py-1.5"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <code className="font-mono font-medium flex-shrink-0" style={{ color: v.required ? "#f87171" : "hsl(240 15% 80%)" }}>
                      {k}
                    </code>
                    <span className="font-mono text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded" style={{ background: "rgba(96,165,250,0.08)", color: "#60a5fa" }}>
                      {v.type}
                    </span>
                    {v.required && (
                      <span className="text-[10px] flex-shrink-0 px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.08)", color: "#f87171" }}>
                        obrigatório
                      </span>
                    )}
                    <span className="flex-1 min-w-0" style={{ color: "var(--text-3)" }}>{v.description || "—"}</span>
                    {v.example !== undefined && (
                      <CopyBtn value={String(v.example)} label="" size="xs" />
                    )}
                  </div>
                ))}
              </div>
              </motion.div>
            )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
            {paramsOpen && showRaw && (
              <motion.div
                key="params-raw"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                style={{ overflow: "hidden" }}
              >
              <div className="mt-2 relative group">
                <pre
                  className="text-[11px] font-mono rounded-lg px-3 py-2.5 overflow-x-auto"
                  style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)", color: "var(--text-2)" }}
                >
                  {exampleBody || "// nenhum exemplo disponível"}
                </pre>
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <CopyBtn value={exampleBody} label="" size="xs" variant="primary" />
                </div>
              </div>
              </motion.div>
            )}
            </AnimatePresence>
          </div>
        )}

        {endpoint.response && (
          <div className="mt-3" style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 10 }}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-[10px] font-medium uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
                Resposta de exemplo
              </span>
              <CopyBtn value={endpoint.response} label="" size="xs" />
            </div>
            <pre
              className="text-[11px] font-mono rounded-lg px-3 py-2 overflow-x-auto"
              style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)", color: "var(--text-2)" }}
            >
              {endpoint.response}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

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
        style={{ background: "var(--surface-solid)", border: "1px solid var(--border)" }}>
        <div>
          <label className="text-[10px] font-medium uppercase tracking-widest block mb-1.5" style={{ color: "hsl(240 8% 42%)" }}>
            API Key para Playground
          </label>
          <input type="text" value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}
            placeholder="Cole sua API Key aqui: sc_..." className="input-field w-full text-sm font-mono" />
        </div>
        <div>
          <label className="text-[10px] font-medium uppercase tracking-widest block mb-1.5" style={{ color: "hsl(240 8% 42%)" }}>
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
        <p className="text-xs font-medium mb-2" style={{ color: "#a78bfa" }}>Estrutura da URL</p>
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
              style={activeSection === s.id ? { background: "var(--surface-2)", boxShadow: "inset 1px 0 0 0 var(--green)" } : undefined}
            >
              <span style={activeSection === s.id ? { color: "var(--green)" } : { color: "var(--text-4)" }}>{s.icon}</span>
              {s.label}
              <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-lg"
                style={{ background: "var(--surface-2)", color: "var(--text-4)" }}>
                {s.endpoints.length}
              </span>
            </button>
          ))}
          <button onClick={() => setActiveSection("webhook-events")}
            className={cn("w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-all",
              activeSection === "webhook-events" ? "text-white" : "text-slate-500 hover:text-slate-300")}
            style={activeSection === "webhook-events" ? { background: "var(--surface-2)", boxShadow: "inset 1px 0 0 0 var(--green)" } : undefined}
          >
            <BookOpen className="w-3.5 h-3.5" style={activeSection === "webhook-events" ? { color: "var(--green)" } : { color: "var(--text-4)" }} />
            Eventos
          </button>
        </div>

        {/* Content */}
        <div className="min-w-0 space-y-3">
          {activeSection === "webhook-events" ? (
            <>
              <h2 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Eventos de Webhook</h2>
              <div className="space-y-2">
                {WEBHOOK_EVENTS.map((ev) => (
                  <div key={ev.event} className="flex items-start gap-3 rounded-xl px-4 py-3"
                    style={{ background: "var(--surface-solid)", border: "1px solid var(--border)" }}>
                    <code className="text-xs font-mono px-2 py-1 rounded-lg flex-shrink-0"
                      style={{ background: "rgba(96,165,250,0.08)", color: "#60a5fa" }}>{ev.event}</code>
                    <p className="text-xs pt-0.5" style={{ color: "var(--text-3)" }}>{ev.description}</p>
                  </div>
                ))}
              </div>
            </>
          ) : section ? (
            <>
              <div className="flex items-center gap-2">
                <span style={{ color: "var(--green)" }}>{section.icon}</span>
                <h2 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{section.label}</h2>
                <span className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>({section.endpoints.length} endpoints)</span>
              </div>
              <div className="space-y-2">
                {section.endpoints.map((ep, i) => (
                  <EndpointCard
                    key={i}
                    endpoint={ep}
                    apiKey={selectedKey}
                    instanceId={selectedInstance}
                  />
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}