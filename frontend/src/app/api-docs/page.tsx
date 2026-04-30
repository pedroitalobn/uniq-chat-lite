"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight, ChevronDown, Copy, Check, Globe, Key,
  MessageSquare, Webhook, Smartphone, Send, BookOpen,
  Users, Tag, Megaphone, Bot, Settings, Zap,
  Hash, FileText, Phone, Video, Image, Music, MapPin,
  RefreshCw, Lock, LogIn, CreditCard, BarChart2, Inbox, Server,
  Building2, Activity, UserCheck, Mail, Search, X,
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
      { method: "POST", path: "/auth/validate-key", description: "Validar se uma API key é válida e retornar metadata", auth: "none", body: { api_key: "sk-..." }, response: `{ "valid": true, "user_id": "...", "plan": "pro" }` },
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
      { method: "GET",  path: "/v1/{server}/{instance}/messages/{msgID}", description: "Buscar UMA mensagem por ID — qualquer tipo (texto/imagem/áudio/sticker/poll/button/list/pix/carousel...). Aceita UUID interno ou external_message_id (stanza WhatsApp).", auth: "token", response: `{ "id": "...", "message_id": "ABCD1234", "type": "image", "content": "{...}", "content_parsed": { "url": "...", "mime_type": "image/jpeg" }, "status": "delivered" }` },
      { method: "POST", path: "/v1/{server}/{instance}/messages/text", description: "Enviar mensagem de texto simples", auth: "token", body: { to: "5511999999999@s.whatsapp.net", text: "Olá!" }, response: `{ "status": "sent", "messageId": "..." }` },
      { method: "POST", path: "/v1/{server}/{instance}/messages/image", description: "Enviar imagem com legenda opcional", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://...", caption: "Legenda" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/document", description: "Enviar documento (PDF, DOCX, etc.)", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://...", filename: "arquivo.pdf" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/audio", description: "Enviar áudio ou nota de voz", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://...", ptt: false } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/video", description: "Enviar vídeo com legenda opcional", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://...", caption: "Vídeo" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/location", description: "Enviar localização com lat/lng", auth: "token", body: { to: "5511999999999@s.whatsapp.net", latitude: -23.5505, longitude: -46.6333, name: "São Paulo" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/contact", description: "Enviar contato como vCard", auth: "token", body: { to: "5511999999999@s.whatsapp.net", contact: { name: "João", phone: "5511888888888" } } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/reaction", description: "Reagir a uma mensagem com emoji", auth: "token", body: { to: "5511999999999@s.whatsapp.net", message_id: "...", emoji: "👍" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/poll", description: "Enviar enquete", auth: "token", body: { to: "5511999999999@s.whatsapp.net", question: "Qual opção?", options: ["A", "B", "C"] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/buttons", description: "Enviar mensagem com botões interativos (reply, url, call, copy). Máx. 3 botões — renderiza como NativeFlow no WhatsApp.", auth: "token", body: { to: "5511999999999@s.whatsapp.net", body: "Escolha uma opção", footer: "Uniq.chat", buttons: [{ id: "sim", text: "Sim", type: "reply" }, { text: "Abrir site", type: "url", url: "https://uniq.chat" }, { text: "Copiar cupom", type: "copy", copy_code: "BLACKFRIDAY20" }] }, response: `{ "status": "sent", "messageId": "..." }` },
      { method: "POST", path: "/v1/{server}/{instance}/messages/template", description: "Enviar mensagem template — alias de /messages/buttons com mapping para o formato Cloud API (display_text/quickreply/url/call). Máx. 3 botões.", auth: "token", body: { to: "5511999999999@s.whatsapp.net", content: "Conteúdo do template", footer: "Uniq.chat", buttons: [{ display_text: "Confirmar", type: "quickreply", id: "yes" }, { display_text: "Visitar site", type: "url", url: "https://uniq.chat" }, { display_text: "Ligar", type: "call", phone_number: "+5511999999999" }] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/list", description: "Enviar lista estruturada com seções e itens selecionáveis.", auth: "token", body: { to: "5511999999999@s.whatsapp.net", title: "Catálogo", description: "Escolha uma opção", button_text: "Ver opções", footer: "Uniq.chat", sections: [{ title: "Atendimento", rows: [{ id: "suporte", title: "Suporte", description: "Falar com um humano" }, { id: "financeiro", title: "Financeiro", description: "2ª via e pagamentos" }] }] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/pix", description: "Enviar cobrança PIX como mensagem interativa (review_and_pay). Suporta CPF, CNPJ, EMAIL, PHONE e EVP.", auth: "token", body: { to: "5511999999999@s.whatsapp.net", merchant_name: "Uniq Chat", pix_key: "pagamentos@uniq.chat", key_type: "EMAIL", header_title: "Pagamento", body_text: "Toque em 'Pagar' para concluir a compra.", footer_text: "Uniq.chat" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/pix-button", description: "Alias minimalista do /pix — só pix_key + key_type. Header/body/footer gerados automaticamente. Inspirado no /send/pix-button do UazAPI.", auth: "token", body: { to: "5511999999999@s.whatsapp.net", pix_key: "pagamentos@uniq.chat", key_type: "EMAIL" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/carousel", description: "Enviar carrossel horizontal de cards (HSCROLL_CARDS). Cada card tem header (título + imagem/vídeo opcional), body e até 3 botões.", auth: "token", body: { to: "5511999999999@s.whatsapp.net", cards: [{ header: { title: "Plano Starter", image_url: "https://picsum.photos/seed/starter/720/480" }, body: "Para times pequenos começarem rápido.", buttons: [{ text: "Conhecer", type: "url", url: "https://uniq.chat/precos" }, { text: "Falar com vendas", type: "call", phone: "+551140002025" }] }, { header: { title: "Plano Pro", image_url: "https://picsum.photos/seed/pro/720/480" }, body: "Recursos avançados para escala.", buttons: [{ text: "Assinar Pro", type: "url", url: "https://uniq.chat/checkout/pro" }] }] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/menu", description: "Endpoint unificado (sintaxe DSL): aceita type=button|list|poll|carousel e converte choices em string para a stanza correta.", auth: "token", body: { number: "5511999999999", type: "list", text: "Escolha uma opção", listButton: "Abrir menu", footerText: "Uniq.chat", choices: ["[Atendimento]", "Suporte|suporte|Falar com suporte", "Financeiro|financeiro|2ª via e pagamentos"] } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/link", description: "Texto com preview de link automático (foto + título extraídos pelo WhatsApp).", auth: "token", body: { to: "5511999999999@s.whatsapp.net", text: "Confira: https://uniq.chat" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/edit", description: "Editar texto de mensagem já enviada (janela de 15 min).", auth: "token", body: { chat_jid: "5511999999999@s.whatsapp.net", message_id: "ABCD1234", new_text: "Texto corrigido" } },
      { method: "POST", path: "/v1/{server}/{instance}/chat/pin", description: "Fixar/desafixar conversa.", auth: "token", body: { jid: "5511999999999@s.whatsapp.net", pinned: true } },
      { method: "POST", path: "/v1/{server}/{instance}/chat/archive", description: "Arquivar/desarquivar conversa.", auth: "token", body: { jid: "5511999999999@s.whatsapp.net", archived: true } },
      { method: "POST", path: "/v1/{server}/{instance}/chat/mute", description: "Silenciar/desilenciar (duration_ms=0 = pra sempre).", auth: "token", body: { jid: "5511999999999@s.whatsapp.net", mute: true, duration_ms: 28800000 } },
      { method: "POST", path: "/v1/{server}/{instance}/chat/history-sync", description: "Pedir lote de mensagens antigas a partir de uma message_id conhecida.", auth: "token", body: { chat_jid: "5511999999999@s.whatsapp.net", message_id: "ABCD1234", count: 100 } },
      { method: "PUT",  path: "/v1/{server}/{instance}/profile/name", description: "Atualizar nome de exibição (push name) da conta conectada.", auth: "token", body: { name: "Uniq Chat" } },
      { method: "PUT",  path: "/v1/{server}/{instance}/profile/status", description: "Atualizar status/recado da conta.", auth: "token", body: { status: "Disponível" } },
      { method: "PUT",  path: "/v1/{server}/{instance}/profile/picture", description: "Atualizar/remover foto de perfil (remove=true ignora url/base64).", auth: "token", body: { url: "https://...jpg" } },
      { method: "POST", path: "/v1/{server}/{instance}/block", description: "Bloquear contato.", auth: "token", body: { jid: "5511999999999@s.whatsapp.net" } },
      { method: "POST", path: "/v1/{server}/{instance}/unblock", description: "Desbloquear contato.", auth: "token", body: { jid: "5511999999999@s.whatsapp.net" } },
      { method: "GET",  path: "/v1/{server}/{instance}/blocklist", description: "Listar contatos bloqueados.", auth: "token", response: `{ "blocked": ["5511...@s.whatsapp.net"] }` },
      { method: "PUT",  path: "/v1/{server}/{instance}/group-ops/photo", description: "Atualizar/remover foto do grupo.", auth: "token", body: { jid: "12036xx@g.us", url: "https://...jpg" } },
      { method: "PUT",  path: "/v1/{server}/{instance}/group-ops/announce", description: "Modo announce (só admins falam).", auth: "token", body: { jid: "12036xx@g.us", announce: true } },
      { method: "PUT",  path: "/v1/{server}/{instance}/group-ops/locked", description: "Modo locked (só admins editam grupo).", auth: "token", body: { jid: "12036xx@g.us", locked: true } },
      { method: "POST", path: "/v1/{server}/{instance}/labels/chat", description: "Aplicar/remover label em conversa inteira.", auth: "token", body: { jid: "5511999999999@s.whatsapp.net", label_id: "1", labeled: true } },
      { method: "POST", path: "/v1/{server}/{instance}/labels/message", description: "Aplicar/remover label em mensagem.", auth: "token", body: { jid: "5511999999999@s.whatsapp.net", label_id: "1", message_id: "ABCD", labeled: true } },
      { method: "POST", path: "/v1/{server}/{instance}/labels/edit", description: "Criar/renomear/recolorir/apagar label.", auth: "token", body: { label_id: "1", name: "Lead quente", color: 5, deleted: false } },
      { method: "GET",  path: "/v1/{server}/{instance}/privacy", description: "Snapshot das configurações de privacidade.", auth: "token", response: `{ "GroupAdd": "all", "LastSeen": "contacts" }` },
      { method: "PUT",  path: "/v1/{server}/{instance}/privacy", description: "Alterar UMA setting. setting: lastseen, profile, status, readreceipts, groupadd, calladd, online. value: all, contacts, contact_blacklist, none.", auth: "token", body: { setting: "lastseen", value: "contacts" } },
      { method: "POST", path: "/v1/{server}/{instance}/force-reconnect", description: "Disconnect + reconnect (último recurso quando socket trava).", auth: "token" },
      { method: "POST", path: "/v1/{server}/{instance}/communities", description: "Criar comunidade WhatsApp.", auth: "token", body: { name: "Minha comunidade", description: "..." } },
      { method: "POST", path: "/v1/{server}/{instance}/communities/link", description: "Vincular grupo existente como subgrupo de uma comunidade.", auth: "token", body: { parent_jid: "12036xx@g.us", child_jid: "12036yy@g.us" } },
      { method: "POST", path: "/v1/{server}/{instance}/communities/unlink", description: "Remover subgrupo da comunidade.", auth: "token", body: { parent_jid: "12036xx@g.us", child_jid: "12036yy@g.us" } },
      { method: "GET",  path: "/v1/{server}/{instance}/communities/{jid}/groups", description: "Listar subgrupos da comunidade.", auth: "token", response: `{ "groups": [...] }` },
      { method: "POST", path: "/v1/{server}/{instance}/newsletters", description: "Criar canal/newsletter.", auth: "token", body: { name: "Meu canal", description: "..." } },
      { method: "GET",  path: "/v1/{server}/{instance}/newsletters", description: "Listar canais que a conta segue.", auth: "token", response: `{ "newsletters": [...] }` },
      { method: "GET",  path: "/v1/{server}/{instance}/newsletters/{jid}", description: "Info de um canal por JID. Use ?invite=<key> em vez do JID pra resolver via convite.", auth: "token" },
      { method: "POST", path: "/v1/{server}/{instance}/newsletters/{jid}/follow", description: "Seguir canal.", auth: "token" },
      { method: "POST", path: "/v1/{server}/{instance}/newsletters/{jid}/unfollow", description: "Deixar de seguir canal.", auth: "token" },
      { method: "GET",  path: "/v1/{server}/{instance}/newsletters/{jid}/messages", description: "Mensagens recentes do canal.", auth: "token", params: { count: "50", before: "<server_id>" } },
      { method: "POST", path: "/v1/{server}/{instance}/calls/reject", description: "Rejeitar chamada recebida (callerJID e callID vêm do evento de oferta).", auth: "token", body: { caller_jid: "5511999999999@s.whatsapp.net", call_id: "abc123" } },
      { method: "GET",  path: "/v1/{server}/{instance}/business-profile/{jid}", description: "Perfil de empresa (catálogo, horário, email, site, descrição).", auth: "token" },
      { method: "POST", path: "/v1/{server}/{instance}/disappearing", description: "Mensagens efêmeras por chat. duration_ms: 0=off, 86400000=24h, 604800000=7d, 7776000000=90d.", auth: "token", body: { chat_jid: "5511999999999@s.whatsapp.net", duration_ms: 604800000 } },
      { method: "POST", path: "/v1/{server}/{instance}/disappearing/default", description: "Default global pra novos chats.", auth: "token", body: { duration_ms: 604800000 } },
      { method: "POST", path: "/v1/{server}/{instance}/groups/join-with-invite", description: "Entrar em grupo via código de convite (privado).", auth: "token", body: { group_jid: "12036xx@g.us", inviter_jid: "5511...@s.whatsapp.net", code: "abc123", expiration: 0 } },
      { method: "POST", path: "/v1/{server}/{instance}/groups/preview-invite", description: "Preview do grupo via convite SEM entrar.", auth: "token", body: { group_jid: "12036xx@g.us", inviter_jid: "5511...@s.whatsapp.net", code: "abc123", expiration: 0 } },
      { method: "GET",  path: "/v1/{server}/{instance}/groups/preview-link", description: "Resolve link público chat.whatsapp.com/<code>.", auth: "token", params: { code: "abc123" } },
      { method: "GET",  path: "/v1/{server}/{instance}/groups/{jid}/requests", description: "Lista pedidos pendentes de entrada (grupos com aprovação).", auth: "token" },
      { method: "POST", path: "/v1/{server}/{instance}/groups/{jid}/requests", description: "Aprovar ou rejeitar pedidos. action: approve | reject.", auth: "token", body: { participants: ["5511...@s.whatsapp.net"], action: "approve" } },
      { method: "GET",  path: "/v1/{server}/{instance}/communities/{jid}/participants", description: "Participantes únicos de TODOS os subgrupos da comunidade.", auth: "token" },
      { method: "POST", path: "/v1/{server}/{instance}/newsletters/{jid}/mark-viewed", description: "Marcar mensagens do canal como vistas.", auth: "token", body: { server_ids: [1234, 1235] } },
      { method: "POST", path: "/v1/{server}/{instance}/newsletters/{jid}/react", description: "Reagir mensagem do canal. reaction='' remove.", auth: "token", body: { server_id: 1234, reaction: "👍", message_id: "ABCD" } },
      { method: "POST", path: "/v1/{server}/{instance}/newsletters/{jid}/mute", description: "Silenciar/desilenciar canal.", auth: "token", body: { mute: true } },
      { method: "POST", path: "/v1/{server}/{instance}/tos/accept", description: "Aceitar Termo de Serviço pendente (notice vem nos eventos).", auth: "token", body: { notice_id: "abc", stage: "1" } },
      { method: "GET",  path: "/v1/{server}/{instance}/status-privacy", description: "Configuração específica de privacidade dos status.", auth: "token" },
      { method: "GET",  path: "/v1/{server}/{instance}/resolve/business-link", description: "Resolve link wa.me/message/<code>.", auth: "token", params: { code: "abc123" } },
      { method: "GET",  path: "/v1/{server}/{instance}/resolve/contact-qr", description: "Resolve link wa.me/qr/<code>.", auth: "token", params: { code: "abc123" } },
      { method: "GET",  path: "/v1/{server}/{instance}/qr-link", description: "Link QR público da própria conta. ?revoke=true regera.", auth: "token", params: { revoke: "false" } },
      // Sprint 7-9 — paridade UazAPI
      { method: "GET",  path: "/v1/instances/{id}/warmup", description: "Estado da sessão de warmup (anti-ban) da instância.", auth: "bearer" },
      { method: "POST", path: "/v1/instances/{id}/warmup", description: "Configurar warmup: pool de mensagens humanas + contatos teste + curva de volume.", auth: "bearer", body: { duration_days: 14, daily_target: 200, start_hour: 9, end_hour: 21, min_delay_sec: 60, max_delay_sec: 300, message_pool: ["Bom dia!", "Tudo certo?"], contact_pool: ["5511999999999@s.whatsapp.net"] } },
      { method: "POST", path: "/v1/instances/{id}/warmup/start", description: "Iniciar warmup.", auth: "bearer" },
      { method: "POST", path: "/v1/instances/{id}/warmup/pause", description: "Pausar warmup.", auth: "bearer" },
      { method: "POST", path: "/v1/instances/{id}/warmup/resume", description: "Retomar warmup.", auth: "bearer" },
      { method: "POST", path: "/v1/instances/{id}/warmup/stop", description: "Parar warmup definitivamente.", auth: "bearer" },
      { method: "POST", path: "/v1/campaigns/{id}/resume", description: "Retomar campanha pausada.", auth: "bearer" },
      { method: "POST", path: "/v1/campaigns/{id}/abort", description: "Cancelar campanha (alias de /cancel).", auth: "bearer" },
      { method: "POST", path: "/v1/campaigns/{id}/clear-sent", description: "Apagar recipients já enviados (limpar fila).", auth: "bearer" },
      { method: "GET",  path: "/v1/campaigns/{id}/messages", description: "Status por mensagem com paginação.", auth: "bearer", params: { status: "sent|failed|pending", limit: "100", offset: "0" } },
      { method: "GET",  path: "/v1/triggers", description: "Listar triggers (autoresponder por keyword) do workspace.", auth: "bearer" },
      { method: "POST", path: "/v1/triggers", description: "Criar trigger. Action: reply | forward_ai | tag | start_journey. MatchMode: exact | contains | starts | regex.", auth: "bearer", body: { name: "Saudação", keyword: "oi", match_mode: "contains", action: "reply", payload: "Olá! Como posso ajudar?", priority: 100, cooldown_sec: 300 } },
      { method: "GET",  path: "/v1/triggers/{id}", description: "Detalhes de um trigger.", auth: "bearer" },
      { method: "PUT",  path: "/v1/triggers/{id}", description: "Atualizar trigger.", auth: "bearer" },
      { method: "DELETE", path: "/v1/triggers/{id}", description: "Remover trigger.", auth: "bearer" },
      { method: "POST", path: "/v1/triggers/{id}/test", description: "Simular match com texto sample.", auth: "bearer", body: { text: "olá, gostaria de saber mais" } },
      { method: "POST", path: "/v1/instances/{id}/agent/ingest-url", description: "Ingerir URL na knowledge base do agente (RAG). Faz GET, limpa HTML e salva como AgentAsset.", auth: "bearer", body: { url: "https://uniq.chat/faq", name: "FAQ Uniq" } },
      { method: "POST", path: "/v1/instances/{id}/agent/ingest-text", description: "Ingerir texto direto na knowledge base. category: knowledge | faq | skill.", auth: "bearer", body: { name: "Política de troca", text: "Trocas em até 7 dias...", category: "knowledge" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/sticker", description: "Enviar sticker/figurinha", auth: "token", body: { to: "5511999999999@s.whatsapp.net", url: "https://..." } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/status", description: "Publicar status/story em texto, imagem ou vídeo", auth: "token", body: { text: "Bom dia, clientes!", bg_color: "#103529" } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/presence", description: "Atualizar presença global da conta", auth: "token", body: { available: true } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/typing", description: "Simular indicador de digitação", auth: "token", body: { to: "5511999999999@s.whatsapp.net", duration: 3000 } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/read", description: "Marcar mensagem como lida", auth: "token", body: { jid: "5511999999999@s.whatsapp.net", message_id: "..." } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/revoke", description: "Apagar mensagem enviada", auth: "token", body: { jid: "5511999999999@s.whatsapp.net", message_id: "..." } },
      { method: "POST", path: "/v1/{server}/{instance}/messages/payment-request", description: "Enviar solicitação de pagamento via WhatsApp Pay", auth: "token", body: { to: "5511999999999@s.whatsapp.net", amount: 99.90, currency: "BRL", note: "Pedido #1234" } },
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
    description: "Notificações em tempo real para eventos do WhatsApp — webhooks por instância e no nível do sistema (workspace)",
    endpoints: [
      { method: "GET",  path: "/v1/instances/{id}/webhooks", description: "Listar webhooks configurados na instância", auth: "bearer", response: `[{ "id": "...", "url": "https://...", "events": ["message.received"] }]` },
      { method: "POST", path: "/v1/instances/{id}/webhooks", description: "Criar novo webhook para a instância. O secret é retornado apenas na criação.", auth: "bearer", body: { url: "https://seu-servidor.com/webhook", events: ["message.received", "connection.update"] }, response: `{ "id": "...", "url": "...", "secret": "...", "events": ["message.received"] }` },
      { method: "GET",  path: "/v1/webhooks/system", description: "Listar webhooks no nível de workspace (recebe eventos de TODAS as instâncias)", auth: "bearer", response: `[{ "id": "...", "url": "...", "events": ["message.received"], "scope": "workspace" }]` },
      { method: "POST", path: "/v1/webhooks/system", description: "Criar webhook de workspace", auth: "bearer", body: { url: "https://central.exemplo.com/wh", events: ["message.received", "journey.triggered"] } },
      { method: "PUT",  path: "/v1/webhooks/system/{id}", description: "Atualizar webhook de workspace", auth: "bearer", body: { url: "https://novo.com/wh", events: ["message.received"] } },
      { method: "DELETE", path: "/v1/webhooks/system/{id}", description: "Remover webhook de workspace", auth: "bearer" },
      { method: "POST", path: "/v1/webhooks/system/{id}/test", description: "Disparar um evento de teste para validar o endpoint", auth: "bearer", response: `{ "ok": true, "status_code": 200, "latency_ms": 120 }` },
      { method: "GET",  path: "/v1/webhooks/system/events", description: "Listar todos os tipos de eventos disponíveis para assinatura", auth: "bearer", response: `{ "events": ["message.received", "message.sent", "connection.update", "journey.triggered"] }` },
    ],
  },
  {
    id: "media",
    title: "Mídia",
    icon: Music,
    description: "Acesso a qualquer mídia do bucket S3-compatível (Hetzner / MinIO — áudio, imagem, vídeo, sticker, documentos e arquivos). Use media_id nas integrações novas; media_key continua aceito como legado.",
    endpoints: [
      { method: "GET", path: "/v1/media/files/{media_id}", description: "Consulta metadados internos da mídia e retorna media_key, media_type, mime_type, filename, size_bytes, download_url e stream_url.", auth: "bearer" },
      { method: "GET", path: "/v1/media/files", description: "Consulta metadados internos por media_key e retorna o media_id correspondente.", auth: "bearer", params: { key: "media/<instance_id>/<yyyy>/<mm>/<uuid>.<ext>" } },
      { method: "GET", path: "https://media.uniq.chat/m/{media_id}", description: "URL pública curta por media_id. Redireciona para signed URL temporária do bucket sem expor a key.", auth: "none" },
      { method: "GET", path: "https://media.uniq.chat/m/{media_id}/download", description: "Download público curto por media_id.", auth: "none" },
      { method: "GET", path: "/v1/media/files/{media_id}/download", description: "Download autenticado por ID interno (Content-Disposition: attachment).", auth: "bearer", params: { filename: "(opcional) nome do arquivo no header" } },
      { method: "GET", path: "/v1/media/files/{media_id}/stream", description: "Stream inline autenticado por ID interno com suporte a Range requests (HTTP 206).", auth: "bearer", params: { filename: "(opcional)", Range: "(opcional, header) ex: bytes=0-65535" } },
      { method: "GET", path: "/v1/media/download", description: "Legado: download autenticado por media_key. Também aceita id/media_id via query.", auth: "bearer", params: { key: "media/<instance_id>/<yyyy>/<mm>/<uuid>.<ext>", id: "(opcional) media_id", filename: "(opcional) nome do arquivo no header" } },
      { method: "GET", path: "/v1/media/stream", description: "Legado: stream inline por media_key. Também aceita id/media_id via query.", auth: "bearer", params: { key: "media/<instance_id>/<yyyy>/<mm>/<uuid>.<ext>", id: "(opcional) media_id", filename: "(opcional)", Range: "(opcional, header) ex: bytes=0-65535" } },
      { method: "GET", path: "/v1/media/{key}", description: "Redirect 302 público pra signed URL temporária do bucket (TTL 30min). Sem auth header — ideal pra <audio src> / <img src> direto no DOM. Aceita key com slashes (wildcard). ⚠️ Qualquer um com a URL acessa enquanto a signed URL não expirar — não use pra mídia sensível.", auth: "none" },
      { method: "GET", path: "/v1/admin/media/health", description: "Diagnóstico end-to-end do storage: upload + presign + fetch de arquivo de teste. Reporta cada etapa pra debug (bucket inexistente, credencial errada, endpoint errado, signed URL inválida).", auth: "bearer", response: `{ "configured": true, "upload": { "ok": true, "public_url": "..." }, "presign": { "ok": true, "signed_url": "..." }, "fetch": { "ok": true, "status": 200, "match": true } }` },
      { method: "POST", path: "/v1/{server}/{instance}/media/upload", description: "Upload de qualquer mídia/arquivo pro bucket. Retorna media_id + media_type + public_url + media_key + download_url/stream_url pra usar nos endpoints de envio.", auth: "token", body: { file: "(multipart/form-data)" }, response: `{ "media_id": "...", "media_type": "audio|image|video|document|file", "public_url": "/m/...", "media_key": "media/.../<uuid>.<ext>", "download_url": "/v1/media/files/.../download", "stream_url": "/v1/media/files/.../stream" }` },
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
    description: "Gerenciamento de contatos, tags, funis e etapas do pipeline",
    endpoints: [
      { method: "GET",    path: "/v1/crm/contacts", description: "Listar contatos do CRM. Suporta filtros por ?funnel=, ?stage=, ?tag=, ?search=", auth: "bearer", response: `[{ "id": "...", "name": "...", "tags": [], "funnel": "Vendas", "stage": "Qualificado" }]` },
      { method: "POST",   path: "/v1/crm/contacts", description: "Criar novo contato", auth: "bearer", body: { name: "João Silva", phone: "5511999999999", email: "joao@exemplo.com" } },
      { method: "GET",    path: "/v1/crm/contacts/{id}", description: "Obter contato por ID", auth: "bearer" },
      { method: "PUT",    path: "/v1/crm/contacts/{id}", description: "Atualizar contato (nome, e-mail, funnel, stage, journey, notes, owner)", auth: "bearer", body: { name: "Novo Nome", funnel: "Vendas", stage: "Proposta" } },
      { method: "DELETE", path: "/v1/crm/contacts/{id}", description: "Remover contato", auth: "bearer" },
      { method: "PUT",    path: "/v1/crm/contacts/{id}/tags", description: "Atribuir ou remover tags de um contato", auth: "bearer", body: { tags: ["vip", "cliente"] } },
      { method: "GET",    path: "/v1/crm/tags", description: "Listar todas as tags disponíveis", auth: "bearer", response: `[{ "id": "...", "name": "vip", "color": "#00d46a" }]` },
      { method: "POST",   path: "/v1/crm/tags", description: "Criar nova tag", auth: "bearer", body: { name: "vip", color: "#00d46a" } },
      { method: "DELETE", path: "/v1/crm/tags/{id}", description: "Remover tag", auth: "bearer" },
      { method: "GET",    path: "/v1/crm/funnels", description: "Listar funis de vendas", auth: "bearer", response: `[{ "id": "...", "name": "Vendas", "stages": [] }]` },
      { method: "POST",   path: "/v1/crm/funnels", description: "Criar novo funil", auth: "bearer", body: { name: "Vendas Enterprise" } },
      { method: "DELETE", path: "/v1/crm/funnels/{id}", description: "Remover funil", auth: "bearer" },
      { method: "GET",    path: "/v1/crm/funnels/{id}/stages", description: "Listar etapas de um funil", auth: "bearer", response: `[{ "id": "...", "name": "Qualificado", "order": 1, "color": "#22c55e" }]` },
      { method: "POST",   path: "/v1/crm/funnels/{id}/stages", description: "Adicionar etapa ao funil", auth: "bearer", body: { name: "Proposta", order: 2, color: "#3b82f6" } },
      { method: "DELETE", path: "/v1/crm/funnels/{id}/stages/{stageId}", description: "Remover etapa de um funil", auth: "bearer" },
      { method: "GET",    path: "/v1/crm/funnel-options", description: "Listar nomes únicos de funis usados por contatos (autocomplete)", auth: "bearer", response: `["Vendas", "Suporte", "Pós-venda"]` },
      { method: "GET",    path: "/v1/crm/stage-options", description: "Listar nomes únicos de etapas usadas (autocomplete)", auth: "bearer", response: `["Qualificado", "Proposta", "Fechado"]` },
      { method: "GET",    path: "/v1/crm/journey-options", description: "Listar nomes únicos de jornadas em uso por contatos", auth: "bearer", response: `["Onboarding novo cliente", "Recuperação de carrinho"]` },
    ],
  },
  {
    id: "campaigns",
    title: "Campanhas",
    icon: Megaphone,
    description: "Criação e gerenciamento de campanhas de disparo em massa com segmentação por funil/stage/tags",
    endpoints: [
      { method: "GET",    path: "/v1/campaigns", description: "Listar todas as campanhas", auth: "bearer", response: `[{ "id": "...", "name": "Black Friday", "status": "active" }]` },
      { method: "POST",   path: "/v1/campaigns", description: "Criar nova campanha. Pode usar segment (filtro dinâmico) ou contacts (lista fixa).", auth: "bearer", body: { name: "Black Friday", instance_id: "...", segment: { funnel: "Vendas", tags: ["vip"] }, message: "Promoção especial!", schedule_at: "2026-11-29T09:00:00Z" } },
      { method: "GET",    path: "/v1/campaigns/{id}", description: "Obter detalhes da campanha (inclui estatísticas de entrega)", auth: "bearer" },
      { method: "POST",   path: "/v1/campaigns/{id}/start", description: "Iniciar disparo da campanha imediatamente", auth: "bearer" },
      { method: "POST",   path: "/v1/campaigns/{id}/pause", description: "Pausar campanha em andamento (retomável)", auth: "bearer" },
      { method: "POST",   path: "/v1/campaigns/{id}/cancel", description: "Cancelar campanha definitivamente", auth: "bearer" },
      { method: "DELETE", path: "/v1/campaigns/{id}", description: "Remover campanha", auth: "bearer" },
      { method: "POST",   path: "/v1/campaigns/segment-preview", description: "Prévia do tamanho do segmento antes de criar a campanha", auth: "bearer", body: { funnel: "Vendas", tags: ["vip"], stage: "Qualificado" }, response: `{ "total": 1287, "sample": [{ "id": "...", "name": "..." }] }` },
      { method: "GET",    path: "/v1/campaigns/segment-options", description: "Retorna os filtros disponíveis (funis, stages, tags, jornadas) para construir segmentos", auth: "bearer", response: `{ "funnels": [...], "stages": [...], "tags": [...], "journeys": [...] }` },
    ],
  },
  {
    id: "integrations",
    title: "Integrações de IA",
    icon: Bot,
    description: "Gerenciar provedores de LLM conectados (OpenAI, Claude, DeepSeek, Gemini, OpenRouter) com suporte a OAuth",
    endpoints: [
      { method: "GET",    path: "/v1/integrations", description: "Listar integrações de IA configuradas", auth: "bearer", response: `[{ "id": "...", "provider": "openai", "name": "GPT-4", "is_active": true }]` },
      { method: "POST",   path: "/v1/integrations", description: "Criar nova integração (informando api_key diretamente)", auth: "bearer", body: { provider: "openai", name: "Meu GPT", api_key: "sk-...", model: "gpt-4o" } },
      { method: "PUT",    path: "/v1/integrations/{id}", description: "Atualizar configurações da integração", auth: "bearer", body: { model: "gpt-4o-mini", is_active: true } },
      { method: "DELETE", path: "/v1/integrations/{id}", description: "Remover integração", auth: "bearer" },
      { method: "POST",   path: "/v1/integrations/{id}/test", description: "Testar se a integração está funcionando", auth: "bearer", response: `{ "status": "ok", "latency_ms": 320 }` },
      { method: "POST",   path: "/v1/integrations/claude/oauth/start", description: "Iniciar fluxo OAuth PKCE para Claude — retorna auth_url pra redirect", auth: "bearer", response: `{ "auth_url": "https://claude.ai/oauth/authorize?...", "state": "..." }` },
      { method: "POST",   path: "/v1/integrations/claude/oauth/callback", description: "Callback do OAuth Claude — troca code por tokens", auth: "bearer", body: { code: "...", state: "..." }, response: `{ "integration_id": "...", "status": "active" }` },
      { method: "POST",   path: "/v1/integrations/openrouter/oauth/start", description: "Iniciar fluxo OAuth PKCE para OpenRouter", auth: "bearer", response: `{ "auth_url": "https://openrouter.ai/auth?...", "state": "..." }` },
      { method: "POST",   path: "/v1/integrations/openrouter/oauth/callback", description: "Callback do OAuth OpenRouter", auth: "bearer", body: { code: "...", state: "..." } },
      { method: "POST",   path: "/v1/integrations/{id}/oauth/refresh", description: "Renovar o access_token expirado de uma integração OAuth", auth: "bearer", response: `{ "refreshed": true, "expires_at": "..." }` },
      { method: "POST",   path: "/v1/ai/generate", description: "Gerar variações de texto com IA (reescrita, tom, tamanho)", auth: "bearer", body: { text: "Olá, tudo bem?", count: 3 }, response: `{ "variations": ["...", "...", "..."] }` },
    ],
  },
  {
    id: "ai-chat",
    title: "Chat IA / Jornadas",
    icon: Zap,
    description: "Conversar com a IA, criar jornadas via prompt ou canvas visual, e simular execuções antes de ativar",
    endpoints: [
      { method: "POST",   path: "/v1/ai/chat", description: "Enviar mensagem para o assistente IA com contexto de jornadas e instâncias", auth: "bearer", body: { message: "Crie uma jornada para responder mensagens no grupo @vendas", integration_id: "(opcional)" }, response: `{ "response": "...", "journey_created": false }` },
      { method: "GET",    path: "/v1/ai/tools", description: "Listar ferramentas disponíveis para o assistente IA", auth: "bearer", response: `{ "tools": [{ "name": "list_journeys", "description": "..." }] }` },
      { method: "GET",    path: "/v1/journeys", description: "Listar jornadas de automação do usuário", auth: "bearer", response: `[{ "id": "...", "prompt": "...", "status": "active", "invocations": 10 }]` },
      { method: "POST",   path: "/v1/journeys", description: "Criar nova jornada via prompt em linguagem natural (LLM gera o flow)", auth: "bearer", body: { prompt: "Quando alguém falar 'preço' no grupo @vendas, responda com o catálogo", integration_id: "(opcional)" } },
      { method: "GET",    path: "/v1/journeys/{id}", description: "Obter detalhes completos de uma jornada (flow, executions, stats)", auth: "bearer" },
      { method: "DELETE", path: "/v1/journeys/{id}", description: "Remover jornada de automação", auth: "bearer" },
      { method: "PATCH",  path: "/v1/journeys/{id}/status", description: "Ativar, pausar ou arquivar uma jornada", auth: "bearer", body: { status: "active" } },
      { method: "PATCH",  path: "/v1/journeys/{id}/flow", description: "Atualizar o flow (steps, edges) via canvas builder", auth: "bearer", body: { flow: { steps: [], edges: [], start_step: "..." } } },
      { method: "PATCH",  path: "/v1/journeys/{id}/trigger", description: "Atualizar configuração de gatilho (keywords, group_jid, trigger_type, response_mode)", auth: "bearer", body: { trigger_type: "group_keyword", group_jid: "120363@g.us", keywords: ["preço"], response_mode: "private" } },
      { method: "POST",   path: "/v1/journeys/{id}/edit-llm", description: "Editar uma jornada existente via prompt LLM (ex: 'adicione um passo de delay de 5 segundos')", auth: "bearer", body: { instruction: "Adicione um passo de delay de 5 segundos antes da resposta" } },
      { method: "POST",   path: "/v1/journeys/{id}/simulate", description: "Simular execução sem enviar mensagens reais (sandbox)", auth: "bearer", body: { input_text: "Olá, tem preço?", contact_name: "Teste" }, response: `{ "events": [...], "steps_run": 3, "final_vars": {} }` },
      { method: "GET",    path: "/v1/journeys/{id}/executions", description: "Histórico de execuções da jornada (quem disparou, quando, status)", auth: "bearer", response: `[{ "id": "...", "contact_jid": "...", "status": "completed", "started_at": "..." }]` },
      { method: "GET",    path: "/v1/journeys/templates", description: "Listar templates públicos de jornadas prontas pra uso", auth: "bearer", response: `[{ "slug": "onboarding-novo-cliente", "name": "Onboarding", "description": "..." }]` },
      { method: "POST",   path: "/v1/journeys/from-template/{slug}", description: "Criar jornada a partir de um template", auth: "bearer", body: { instance_id: "...", customize: { welcome_message: "Olá!" } } },
    ],
  },
  {
    id: "apikeys",
    title: "API Keys",
    icon: Key,
    description: "Gerenciar chaves de API para acesso programático. A key deve ser enviada no header 'apikey'.",
    endpoints: [
      { method: "GET",    path: "/v1/api-keys", description: "Listar suas API Keys (masked)", auth: "bearer", response: `[{ "id": "...", "name": "Minha Key", "masked_key": "sk-...xyz", "last_used_at": "..." }]` },
      { method: "POST",   path: "/v1/api-keys", description: "Criar nova API Key. O valor completo só é retornado aqui — guarde com cuidado.", auth: "bearer", body: { name: "Produção" }, response: `{ "key": "sk-...", "name": "Produção" }` },
      { method: "DELETE", path: "/v1/api-keys/{id}", description: "Revogar API Key", auth: "bearer" },
    ],
  },
  {
    id: "instances-mgmt",
    title: "Gestão de Instâncias",
    icon: Settings,
    description: "Criar, gerenciar e configurar instâncias WhatsApp, incluindo proxy dedicado, recuperação e WebSocket de eventos",
    endpoints: [
      { method: "GET",    path: "/v1/instances", description: "Listar instâncias do usuário", auth: "bearer", response: `[{ "id": "...", "name": "pedro-sp", "status": "connected" }]` },
      { method: "POST",   path: "/v1/instances", description: "Criar nova instância", auth: "bearer", body: { name: "minha-instancia", server_id: "..." } },
      { method: "GET",    path: "/v1/instances/{id}", description: "Obter detalhes de uma instância", auth: "bearer" },
      { method: "DELETE", path: "/v1/instances/{id}", description: "Remover instância", auth: "bearer" },
      { method: "GET",    path: "/v1/instances/{id}/settings", description: "Obter configurações da instância", auth: "bearer" },
      { method: "PUT",    path: "/v1/instances/{id}/settings", description: "Atualizar configurações da instância", auth: "bearer", body: { auto_read: true, webhook_url: "https://..." } },
      { method: "GET",    path: "/v1/instances/{id}/agent", description: "Obter configuração do agente de IA da instância", auth: "bearer" },
      { method: "PUT",    path: "/v1/instances/{id}/agent", description: "Configurar agente de IA para a instância", auth: "bearer", body: { enabled: true, integration_id: "...", system_prompt: "Você é um atendente..." } },
      { method: "GET",    path: "/v1/instances/{id}/proxy", description: "Obter proxy configurado para a instância", auth: "bearer", response: `{ "proxy_id": "...", "source": "instance" }` },
      { method: "GET",    path: "/v1/instances/{id}/proxy/effective", description: "Obter o proxy efetivo em uso (resolve herança instância → servidor → global)", auth: "bearer" },
      { method: "GET",    path: "/v1/instances/{id}/recovery", description: "Status da rotina de recuperação automática da instância", auth: "bearer" },
      { method: "POST",   path: "/v1/instances/{id}/recovery/snapshot", description: "Disparar snapshot manual da sessão whatsmeow", auth: "bearer" },
      { method: "POST",   path: "/v1/instances/{id}/recovery/reset", description: "Reset completo da sessão (requer re-pareamento)", auth: "bearer" },
      { method: "PUT",    path: "/v1/instances/{id}/recovery/schedule", description: "Agendar frequência de snapshots automáticos", auth: "bearer", body: { interval_hours: 12 } },
      { method: "GET",    path: "/v1/instances/{id}/ws", description: "Conectar WebSocket pra receber eventos em tempo real (upgrade HTTP → WS)", auth: "bearer" },
    ],
  },
  {
    id: "inbox",
    title: "Inbox / Conversas",
    icon: Inbox,
    description: "API CRM de conversas — lista de chats, mensagens, status de leitura, typing, contatos enriquecidos",
    endpoints: [
      { method: "GET",    path: "/v1/instances/{id}/inbox/chats", description: "Listar conversas com última mensagem, unread count, avatar, e dados do CRM", auth: "bearer", params: { limit: "50", offset: "0", search: "joão" }, response: `[{ "jid": "...", "name": "João", "last_message": "...", "unread": 3, "funnel": "Vendas" }]` },
      { method: "GET",    path: "/v1/instances/{id}/inbox/chats/{jid}", description: "Detalhes do contato + estatísticas (total_sent, total_received, unread)", auth: "bearer", response: `{ "jid": "...", "name": "...", "tags": [], "funnel": "...", "total_sent": 12 }` },
      { method: "GET",    path: "/v1/instances/{id}/inbox/chats/{jid}/messages", description: "Histórico paginado de mensagens do chat", auth: "bearer", params: { limit: "50", offset: "0" }, response: `{ "messages": [...], "has_more": true }` },
      { method: "POST",   path: "/v1/instances/{id}/inbox/chats/{jid}/messages", description: "Enviar mensagem de texto via inbox (roteia para LID/PN automaticamente)", auth: "bearer", body: { text: "Olá! Como posso ajudar?", quoted_message_id: "(opcional)" } },
      { method: "POST",   path: "/v1/instances/{id}/inbox/chats/{jid}/messages/media", description: "Enviar mídia (multipart/form-data). Tipo inferido pelo mime", auth: "bearer", body: { file: "(multipart)", caption: "Legenda opcional" } },
      { method: "POST",   path: "/v1/instances/{id}/inbox/chats/{jid}/read", description: "Marcar chat como lido (zera unread count)", auth: "bearer" },
      { method: "POST",   path: "/v1/instances/{id}/inbox/chats/{jid}/typing", description: "Simular indicador de digitação", auth: "bearer", body: { duration_ms: 3000 } },
      { method: "PATCH",  path: "/v1/instances/{id}/inbox/messages/{id}", description: "Atualizar status/metadata de uma mensagem (starred, note)", auth: "bearer", body: { starred: true } },
      { method: "POST",   path: "/v1/instances/{id}/inbox/messages/{msgID}/resend", description: "Reenviar mensagem que falhou (status=failed)", auth: "bearer" },
      { method: "PUT",    path: "/v1/instances/{id}/inbox/contacts/{id}", description: "Atualizar dados do contato a partir da inbox (nome, funil, stage, tags)", auth: "bearer", body: { name: "Novo Nome", funnel: "Vendas", tags: ["vip"] } },
    ],
  },
  {
    id: "conversations",
    title: "CRM Conversations (multi-canal)",
    icon: MessageSquare,
    description: "API CRM unificada de atendimento — conversas multi-canal (WhatsApp, Instagram, Email…), filas, transferências, snooze, bot, tags, notas e ações em lote. Header obrigatório: X-Workspace-ID.",
    endpoints: [
      { method: "GET",    path: "/v1/conversations", description: "Listar conversas (filtros: status, channel, queue_id, assigned_user_id, contact_id, priority, is_archived, q)", auth: "bearer", params: { status: "open", queue_id: "...", assigned_user_id: "me" } },
      { method: "GET",    path: "/v1/conversations/count", description: "Contar conversas (mesmos filtros do List)", auth: "bearer" },
      { method: "GET",    path: "/v1/conversations/inbox-stats", description: "Diagnóstico: pending backfill, open, mine-open", auth: "bearer" },
      { method: "GET",    path: "/v1/conversations/messages/search", description: "Buscar mensagens por conteúdo/from/to", auth: "bearer", params: { q: "pedido", limit: "50" } },
      { method: "GET",    path: "/v1/conversations/{id}", description: "Detalhes da conversa (contato, instância, queue, dept, team, assignee, status)", auth: "bearer" },
      { method: "GET",    path: "/v1/conversations/{id}/timeline", description: "Timeline paginada de mensagens + eventos", auth: "bearer", params: { limit: "50", before: "<msg_id>" } },
      { method: "GET",    path: "/v1/conversations/{id}/send-constraints", description: "Verifica se pode enviar mensagem agora (janela 24h, opt-in, etc.)", auth: "bearer" },
      { method: "PATCH",  path: "/v1/conversations/{id}", description: "Atualizar metadados (subject, priority, sub_status, is_archived, is_pinned, is_muted, funnel_id, stage_id)", auth: "bearer", body: { priority: "high", is_pinned: true } },
      { method: "POST",   path: "/v1/conversations/{id}/messages", description: "Enviar mensagem (text/image/audio/video/document)", auth: "bearer", body: { type: "text", text: "Olá!" } },
      { method: "PATCH",  path: "/v1/conversations/{id}/messages/{msgId}/content", description: "Editar conteúdo da mensagem (quando suportado pelo canal)", auth: "bearer", body: { text: "novo texto" } },
      { method: "DELETE", path: "/v1/conversations/{id}/messages/{msgId}", description: "Revogar/apagar mensagem", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/messages/{msgId}/react", description: "Reagir com emoji", auth: "bearer", body: { emoji: "👍" } },
      { method: "POST",   path: "/v1/conversations/{id}/messages/{msgId}/forward", description: "Encaminhar mensagem pra outro chat/conversa", auth: "bearer", body: { to_conversation_id: "..." } },
      { method: "GET",    path: "/v1/conversations/{id}/messages/{msgId}/receipts", description: "Status de entrega/leitura por destinatário", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/typing", description: "Indicador de digitação", auth: "bearer", body: { state: "composing" } },
      { method: "POST",   path: "/v1/conversations/{id}/read", description: "Marcar como lido (zera unread)", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/unread", description: "Marcar como não lido (volta o badge pra agente)", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/take", description: "Atender (self-assign atomic, 409 se já estiver com outro)", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/assign", description: "Atribuir a um usuário (sem user_id = self-assign)", auth: "bearer", body: { user_id: "<uuid>" } },
      { method: "POST",   path: "/v1/conversations/{id}/unassign", description: "Remover atribuição", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/transfer", description: "Transferir pra fila, departamento, equipe ou usuário (combine os campos)", auth: "bearer", body: { queue_id: "...", department_id: "...", team_id: "...", user_id: "...", note: "motivo" } },
      { method: "POST",   path: "/v1/conversations/{id}/resolve", description: "Resolver atendimento (opcional: enviar CSAT)", auth: "bearer", body: { reason: "Resolvido", send_csat: true } },
      { method: "POST",   path: "/v1/conversations/{id}/close", description: "Fechar atendimento (sem coleta de satisfação)", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/reopen", description: "Reabrir conversa fechada/resolvida", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/snooze", description: "Pausar até timestamp (RFC3339)", auth: "bearer", body: { until: "2026-04-28T09:00:00-03:00" } },
      { method: "POST",   path: "/v1/conversations/{id}/unsnooze", description: "Despausar antes do prazo", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/bot/enable", description: "Reativar bot/agente IA pra essa conversa", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/bot/disable", description: "Desligar bot (humano assume)", auth: "bearer" },
      { method: "GET",    path: "/v1/conversations/{id}/tags", description: "Listar tags da conversa", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/tags", description: "Adicionar tag", auth: "bearer", body: { tag_id: "<uuid>" } },
      { method: "DELETE", path: "/v1/conversations/{id}/tags/{tagId}", description: "Remover tag", auth: "bearer" },
      { method: "GET",    path: "/v1/conversations/{id}/participants", description: "Listar followers/colaboradores", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/participants", description: "Adicionar participante (recebe notificações)", auth: "bearer", body: { user_id: "<uuid>" } },
      { method: "DELETE", path: "/v1/conversations/{id}/participants/{userId}", description: "Remover participante", auth: "bearer" },
      { method: "GET",    path: "/v1/conversations/{id}/notes", description: "Listar notas internas", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/notes", description: "Criar nota interna (não visível ao cliente)", auth: "bearer", body: { body: "Cliente prefere contato à tarde" } },
      { method: "PATCH",  path: "/v1/conversations/{id}/notes/{noteId}", description: "Editar nota", auth: "bearer", body: { body: "..." } },
      { method: "DELETE", path: "/v1/conversations/{id}/notes/{noteId}", description: "Deletar nota", auth: "bearer" },
      { method: "GET",    path: "/v1/conversations/{id}/assignments", description: "Histórico de atribuições/transferências", auth: "bearer" },
      { method: "GET",    path: "/v1/conversations/{id}/events", description: "Timeline completa de eventos (status, queue, assignment, snooze, transfer, …)", auth: "bearer" },
      { method: "GET",    path: "/v1/conversations/{id}/csat", description: "Pesquisas de satisfação dessa conversa", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/{id}/csat", description: "Disparar CSAT manualmente", auth: "bearer" },
      { method: "POST",   path: "/v1/conversations/bulk", description: "Ações em lote (até 200 ids). Actions: resolve, close, reopen, snooze, unsnooze, read, unread, assign, unassign, transfer, archive, unarchive, pin, unpin, mute, unmute", auth: "bearer", body: { ids: ["<uuid>", "<uuid>"], action: "transfer", queue_id: "<uuid>", note: "Triagem" } },
      { method: "GET",    path: "/v1/conversations/{id}/shop-context", description: "Contexto comercial do contato: últimos 10 pedidos + totais (gasto, ticket médio, qtde, último pedido)", auth: "bearer" },
      { method: "GET",    path: "/v1/contacts/{id}/orders", description: "Pedidos paginados de um contato (limit/offset)", auth: "bearer" },
      { method: "POST",   path: "/v1/auth/verify-email", description: "Confirma e-mail via token enviado no signup (24h)", auth: "none", body: { token: "verify_..." } },
      { method: "POST",   path: "/v1/auth/resend-verification", description: "Re-emite o link de verificação. Resposta neutra (anti-enumeração)", auth: "none", body: { email: "user@example.com" } },
      { method: "POST",   path: "/v1/auth/2fa/setup", description: "Inicia ativação 2FA — retorna secret + otpauth_url pra renderizar QR", auth: "bearer" },
      { method: "POST",   path: "/v1/auth/2fa/enable", description: "Confirma código TOTP e ativa 2FA. Retorna 10 backup codes (uma vez)", auth: "bearer", body: { code: "123456" } },
      { method: "POST",   path: "/v1/auth/2fa/disable", description: "Desativa 2FA (precisa do código atual)", auth: "bearer", body: { code: "123456" } },
      { method: "POST",   path: "/v1/auth/2fa/verify", description: "Troca challenge_token + código por access_token (segundo passo do login)", auth: "none", body: { challenge_token: "...", code: "123456" } },
      { method: "GET",    path: "/v1/admin/audit-logs", description: "Lista audit logs (filtros: actor_user_id, action, target_type, target_id, since, until, limit)", auth: "bearer" },
    ],
  },
  {
    id: "queues",
    title: "Filas, Departamentos e Equipes",
    icon: Users,
    description: "Estrutura organizacional do atendimento. Queue pode ter departamento e/ou equipe (opcional) — workspace-wide se nenhum. Membership manual via QueueMember (não cascateia de team).",
    endpoints: [
      { method: "GET",    path: "/v1/queues", description: "Listar filas do workspace", auth: "bearer" },
      { method: "POST",   path: "/v1/queues", description: "Criar fila", auth: "bearer", body: { name: "Suporte N1", department_id: "...", team_id: "...", strategy: "round_robin" } },
      { method: "PATCH",  path: "/v1/queues/{id}", description: "Atualizar fila", auth: "bearer" },
      { method: "DELETE", path: "/v1/queues/{id}", description: "Deletar fila", auth: "bearer" },
      { method: "GET",    path: "/v1/queues/{id}/stats", description: "Métricas (waiting, active, members_online)", auth: "bearer" },
      { method: "GET",    path: "/v1/queues/{id}/members", description: "Listar membros (operadores) da fila", auth: "bearer" },
      { method: "POST",   path: "/v1/queues/{id}/members", description: "Adicionar operador à fila", auth: "bearer", body: { user_id: "<uuid>" } },
      { method: "DELETE", path: "/v1/queues/{id}/members/{userId}", description: "Remover operador", auth: "bearer" },
      { method: "GET",    path: "/v1/queues/{id}/channels", description: "Listar instâncias/canais associados à fila", auth: "bearer" },
      { method: "POST",   path: "/v1/queues/{id}/channels", description: "Vincular instância à fila (opc. is_default)", auth: "bearer", body: { instance_id: "<uuid>", is_default: true } },
      { method: "DELETE", path: "/v1/queues/{id}/channels/{channelId}", description: "Desvincular instância", auth: "bearer" },
      { method: "GET",    path: "/v1/departments", description: "Listar departamentos", auth: "bearer" },
      { method: "POST",   path: "/v1/departments", description: "Criar departamento", auth: "bearer", body: { name: "Vendas" } },
      { method: "PATCH",  path: "/v1/departments/{id}", description: "Atualizar departamento", auth: "bearer" },
      { method: "DELETE", path: "/v1/departments/{id}", description: "Deletar departamento", auth: "bearer" },
      { method: "GET",    path: "/v1/teams", description: "Listar equipes", auth: "bearer" },
      { method: "POST",   path: "/v1/teams", description: "Criar equipe", auth: "bearer", body: { name: "Time SP", department_id: "<uuid>" } },
      { method: "PATCH",  path: "/v1/teams/{id}", description: "Atualizar equipe", auth: "bearer" },
      { method: "DELETE", path: "/v1/teams/{id}", description: "Deletar equipe", auth: "bearer" },
    ],
  },
  {
    id: "workspaces",
    title: "Workspaces",
    icon: Building2,
    description: "Organizações/times com membros, roles, permissões e convites",
    endpoints: [
      { method: "GET",    path: "/v1/workspaces", description: "Listar workspaces do usuário autenticado", auth: "bearer", response: `[{ "id": "...", "name": "Minha Empresa", "role": "owner" }]` },
      { method: "POST",   path: "/v1/workspaces", description: "Criar novo workspace", auth: "bearer", body: { name: "Minha Empresa", slug: "minha-empresa" } },
      { method: "GET",    path: "/v1/workspaces/{id}", description: "Obter detalhes do workspace", auth: "bearer" },
      { method: "PUT",    path: "/v1/workspaces/{id}", description: "Atualizar workspace (nome, slug, logo)", auth: "bearer", body: { name: "Novo Nome" } },
      { method: "DELETE", path: "/v1/workspaces/{id}", description: "Deletar workspace (só owner)", auth: "bearer" },
      { method: "GET",    path: "/v1/workspaces/{id}/members", description: "Listar membros do workspace", auth: "bearer", response: `[{ "user_id": "...", "name": "...", "role": "admin" }]` },
      { method: "DELETE", path: "/v1/workspaces/{id}/members/{member_id}", description: "Remover membro do workspace", auth: "bearer" },
      { method: "GET",    path: "/v1/workspaces/{id}/invites", description: "Listar convites pendentes", auth: "bearer" },
      { method: "POST",   path: "/v1/workspaces/{id}/invites", description: "Convidar usuário por e-mail", auth: "bearer", body: { email: "novo@membro.com", role_id: "..." } },
      { method: "DELETE", path: "/v1/workspaces/{id}/invites/{invite_id}", description: "Cancelar convite pendente", auth: "bearer" },
      { method: "POST",   path: "/v1/workspaces/accept-invite/{token}", description: "Aceitar convite recebido por e-mail (token opaco)", auth: "bearer" },
      { method: "GET",    path: "/v1/workspaces/{id}/roles", description: "Listar papéis customizados do workspace", auth: "bearer", response: `[{ "id": "...", "name": "Atendente", "permissions": ["inbox.read"] }]` },
      { method: "POST",   path: "/v1/workspaces/{id}/roles", description: "Criar papel customizado", auth: "bearer", body: { name: "Gerente", permissions: ["inbox.*", "crm.*"] } },
      { method: "GET",    path: "/v1/workspaces/{id}/roles/{role_id}", description: "Obter detalhes de um papel", auth: "bearer" },
      { method: "PUT",    path: "/v1/workspaces/{id}/roles/{role_id}", description: "Atualizar papel", auth: "bearer", body: { name: "Gerente Pleno", permissions: ["inbox.*"] } },
      { method: "DELETE", path: "/v1/workspaces/{id}/roles/{role_id}", description: "Remover papel", auth: "bearer" },
      { method: "GET",    path: "/v1/permissions", description: "Listar todas as permissões disponíveis no sistema", auth: "bearer", response: `["inbox.read", "inbox.write", "crm.read", "crm.write", "journeys.admin"]` },
    ],
  },
  {
    id: "servers",
    title: "Servidores",
    icon: Server,
    description: "Servidores que hospedam instâncias WhatsApp. Cada instância pertence a um servidor com proxy/região próprios",
    endpoints: [
      { method: "GET",    path: "/v1/servers", description: "Listar servidores do usuário/workspace", auth: "bearer", response: `[{ "id": "...", "slug": "br-sp-1", "region": "sa-east-1", "is_active": true }]` },
      { method: "POST",   path: "/v1/servers", description: "Criar novo servidor lógico", auth: "bearer", body: { slug: "br-sp-1", name: "São Paulo 1", region: "sa-east-1" } },
      { method: "GET",    path: "/v1/servers/{id}", description: "Obter detalhes do servidor", auth: "bearer" },
      { method: "PUT",    path: "/v1/servers/{id}", description: "Atualizar servidor", auth: "bearer", body: { name: "Novo Nome" } },
      { method: "DELETE", path: "/v1/servers/{id}", description: "Remover servidor (se não tem instâncias ativas)", auth: "bearer" },
      { method: "GET",    path: "/v1/servers/{id}/instances", description: "Listar instâncias nesse servidor", auth: "bearer" },
      { method: "POST",   path: "/v1/servers/{id}/actions", description: "Executar ação administrativa (restart, drain, etc)", auth: "bearer", body: { action: "restart" } },
      { method: "GET",    path: "/v1/servers/{id}/stats", description: "Estatísticas de uso do servidor (CPU, RAM, mensagens/s)", auth: "bearer", response: `{ "cpu_percent": 34, "memory_mb": 512, "msgs_per_min": 128 }` },
      { method: "GET",    path: "/v1/servers/{id}/proxy", description: "Obter proxy padrão do servidor (herdado por novas instâncias)", auth: "bearer" },
      { method: "PUT",    path: "/v1/servers/{id}/proxy", description: "Configurar proxy padrão do servidor", auth: "bearer", body: { proxy_id: "..." } },
      { method: "DELETE", path: "/v1/servers/{id}/proxy", description: "Remover proxy do servidor (volta a usar global)", auth: "bearer" },
      { method: "POST",   path: "/v1/servers/{id}/proxy/test", description: "Testar conectividade do proxy configurado", auth: "bearer", response: `{ "ok": true, "latency_ms": 120, "external_ip": "..." }` },
    ],
  },
  {
    id: "proxies",
    title: "Proxies",
    icon: Globe,
    description: "Proxies dedicados atribuídos a instâncias, servidores, ou global (hierarquia instância → servidor → global)",
    endpoints: [
      { method: "GET",    path: "/v1/proxies", description: "Listar proxies do usuário", auth: "bearer", response: `[{ "id": "...", "name": "Proxy BR-1", "host": "proxy.exemplo.com", "port": 8080, "type": "http" }]` },
      { method: "POST",   path: "/v1/proxies", description: "Criar novo proxy", auth: "bearer", body: { name: "Proxy BR-1", type: "http", host: "proxy.com", port: 8080, username: "user", password: "pass" } },
      { method: "GET",    path: "/v1/proxies/mine", description: "Listar proxies visíveis ao usuário atual (seus + compartilhados)", auth: "bearer" },
      { method: "PUT",    path: "/v1/proxies/{id}", description: "Atualizar proxy", auth: "bearer" },
      { method: "DELETE", path: "/v1/proxies/{id}", description: "Remover proxy", auth: "bearer" },
      { method: "POST",   path: "/v1/proxies/{id}/test", description: "Testar proxy configurado", auth: "bearer", response: `{ "ok": true, "external_ip": "...", "latency_ms": 120 }` },
      { method: "POST",   path: "/v1/proxies/test-inline", description: "Testar uma config de proxy sem persistir", auth: "bearer", body: { type: "http", host: "...", port: 8080 } },
      { method: "GET",    path: "/v1/proxy/global", description: "Obter proxy global do workspace (fallback de última instância)", auth: "bearer" },
      { method: "PUT",    path: "/v1/proxy/global", description: "Definir proxy global", auth: "bearer", body: { proxy_id: "..." } },
    ],
  },
  {
    id: "agent",
    title: "Agent Stats",
    icon: Activity,
    description: "Métricas e atividade do agente IA em produção (jornadas rodando, atendimentos em andamento)",
    endpoints: [
      { method: "GET",  path: "/v1/agent/stats", description: "Estatísticas agregadas do agente IA (total de execuções, taxa de sucesso, tempo médio)", auth: "bearer", response: `{ "total_executions": 12934, "success_rate": 0.92, "avg_response_ms": 1200 }` },
      { method: "GET",  path: "/v1/agent/activity", description: "Feed de atividade em tempo real (últimas execuções, eventos, alertas)", auth: "bearer", response: `[{ "type": "journey.triggered", "journey_id": "...", "at": "..." }]` },
      { method: "GET",  path: "/v1/agent/instances", description: "Status de cada instância sob controle do agente", auth: "bearer" },
      { method: "POST", path: "/v1/agent/executions/{id}/stop", description: "Interromper uma execução em andamento", auth: "bearer" },
      { method: "GET",  path: "/ws/agent-activity", description: "WebSocket de eventos do agente em tempo real", auth: "bearer" },
    ],
  },
  {
    id: "invites",
    title: "Invites",
    icon: UserCheck,
    description: "Convites de acesso à plataforma (programa beta/early access)",
    endpoints: [
      { method: "POST", path: "/v1/invites/generate", description: "Gerar novo código de convite (se o usuário tiver cotas disponíveis)", auth: "bearer", response: `{ "code": "UNIQ-1234-ABCD", "expires_at": "..." }` },
      { method: "POST", path: "/v1/invites/validate", description: "Validar um código de convite (usado no cadastro)", auth: "none", body: { code: "UNIQ-1234-ABCD" }, response: `{ "valid": true, "invited_by": "..." }` },
      { method: "GET",  path: "/v1/invites/mine", description: "Listar convites gerados pelo usuário e seus status", auth: "bearer" },
      { method: "GET",  path: "/v1/invites/status", description: "Verificar se invite-only está ativo no cadastro", auth: "none", response: `{ "invite_required": true }` },
    ],
  },
  {
    id: "payments",
    title: "Pagamentos & Billing",
    icon: CreditCard,
    description: "Planos, checkout e assinatura via Stripe (cartão) ou Asaas (PIX/boleto). Webhooks processam eventos de pagamento.",
    endpoints: [
      { method: "GET",  path: "/v1/payments/plans", description: "Listar planos ativos (unifica Stripe + Asaas conforme config)", auth: "none", response: `[{ "id": "pro", "name": "Pro", "price_brl": 149.90, "features": [...] }]` },
      { method: "POST", path: "/v1/payments/checkout", description: "Criar sessão de checkout para o provedor escolhido", auth: "bearer", body: { plan_id: "pro", provider: "stripe", return_url: "https://..." }, response: `{ "checkout_url": "https://..." }` },
      { method: "GET",  path: "/v1/payments/subscription", description: "Status da assinatura atual do usuário", auth: "bearer", response: `{ "status": "active", "plan": "pro", "current_period_end": "..." }` },
      { method: "GET",  path: "/v1/stripe/plans", description: "Listar planos do Stripe", auth: "none" },
      { method: "POST", path: "/v1/stripe/checkout", description: "Criar sessão Stripe Checkout", auth: "bearer", body: { plan_id: "price_123", return_url: "..." } },
      { method: "GET",  path: "/v1/stripe/subscription", description: "Status da assinatura Stripe", auth: "bearer" },
      { method: "POST", path: "/stripe/webhook", description: "Webhook Stripe (público, assinado por stripe-signature)", auth: "none" },
      { method: "POST", path: "/stripe/activate-lead", description: "Ativar lead capturado via Stripe Payment Link", auth: "none", body: { email: "...", session_id: "..." } },
      { method: "GET",  path: "/v1/asaas/plans", description: "Listar planos Asaas (PIX/boleto)", auth: "none" },
      { method: "POST", path: "/v1/asaas/checkout", description: "Criar cobrança Asaas", auth: "bearer", body: { plan_id: "...", billing_type: "PIX" } },
      { method: "GET",  path: "/v1/asaas/subscription", description: "Status da assinatura Asaas", auth: "bearer" },
      { method: "POST", path: "/asaas/webhook", description: "Webhook Asaas (público, validado por token)", auth: "none" },
    ],
  },
  {
    id: "waba",
    title: "WABA (WhatsApp API Oficial)",
    icon: Send,
    description: "WhatsApp Cloud API (Meta) — templates HSM, janela de 24h, envio de mensagens ativas. Use X-API-Key: sc_... no header. Os endpoints /v1/instances/{id}/waba/* requerem uma instância com WABA vinculada.",
    badge: "Meta Cloud API",
    endpoints: [
      // Setup
      { method: "GET",    path: "/v1/instances/{id}/waba", description: "Detalhes da conta WABA vinculada à instância (WABA ID, business name, status)", auth: "bearer", response: `{ "waba_id": "...", "business_name": "Minha Empresa", "phone_number_id": "...", "status": "active" }` },
      { method: "GET",    path: "/v1/instances/{id}/waba/phone-numbers", description: "Listar números de telefone cadastrados na conta WABA com rating de qualidade e status", auth: "bearer", response: `{ "data": [{ "id": "...", "display_phone_number": "+55 11 99999-9999", "verified_name": "Minha Empresa", "quality_rating": "GREEN", "status": "CONNECTED" }] }` },
      { method: "POST",   path: "/v1/instances/{id}/waba/subscribe", description: "Assinar webhooks da App Meta na conta WABA (Tech Provider flow — executar após Embedded Signup)", auth: "bearer" },
      { method: "POST",   path: "/v1/instances/{id}/waba/register", description: "Registrar número de telefone para habilitar envio de mensagens ativas", auth: "bearer", body: { pin: "(opcional) PIN de verificação" } },
      { method: "DELETE", path: "/v1/instances/{id}/waba", description: "Desvincular conta WABA da instância", auth: "bearer" },
      // Templates
      { method: "GET",    path: "/v1/instances/{id}/waba/templates", description: "Listar templates HSM — inclui status (APPROVED, PENDING, REJECTED) e componentes de cada template", auth: "bearer", response: `{ "data": [{ "id": "...", "name": "confirmacao_pedido", "status": "APPROVED", "language": "pt_BR", "components": [{ "type": "BODY", "text": "Olá {{1}}, seu pedido {{2}} foi confirmado." }] }] }` },
      { method: "POST",   path: "/v1/instances/{id}/waba/templates", description: "Criar novo template e enviá-lo para revisão da Meta. Status inicial: PENDING. Aprovação leva de minutos a horas.", auth: "bearer", body: { name: "confirmacao_pedido", language: "pt_BR", category: "UTILITY", components: [{ type: "BODY", text: "Olá {{1}}, seu pedido {{2}} foi confirmado." }] }, response: `{ "id": "...", "name": "confirmacao_pedido", "status": "PENDING" }` },
      { method: "POST",   path: "/v1/instances/{id}/waba/templates/{templateId}", description: "Editar template existente (status volta a PENDING após edição — mesmo que fosse APPROVED)", auth: "bearer", body: { components: [{ type: "BODY", text: "Olá {{1}}, confirmamos o pedido {{2}}." }] } },
      { method: "DELETE", path: "/v1/instances/{id}/waba/templates/{name}", description: "Deletar template pelo nome (remove permanentemente da Meta — não pode ser desfeito)", auth: "bearer" },
      // Mensagens
      { method: "POST",   path: "/v1/instances/{id}/waba/messages", description: "Enviar mensagem WABA. Dentro da janela de 24h: qualquer tipo (text/image/audio/document/video). Fora da janela: apenas templates aprovados. Use GET /conversations/{id}/send-constraints para verificar.", auth: "bearer", body: { to: "5511999999999", type: "template", template_name: "confirmacao_pedido", template_language: "pt_BR", components: [{ type: "body", parameters: [{ type: "text", text: "João" }, { type: "text", text: "#12345" }] }] }, response: `{ "id": "uuid", "message_id": "wamid.HBgM...", "status": "sent" }` },
      // Webhook
      { method: "GET",    path: "/waba/webhook", description: "Verificação do webhook pela Meta (hub.challenge) — responde automaticamente, não chamar diretamente", auth: "none" },
      { method: "POST",   path: "/waba/webhook", description: "Recebe eventos WABA da Meta: mensagens inbound, status (sent/delivered/read/failed), erros de entrega. Qualquer falha de entrega gera delivery_error no MessageLog.", auth: "none" },
      { method: "GET",    path: "/v1/waba/auth-url", description: "Gerar URL para iniciar Embedded Signup Meta (vinculação WABA via OAuth)", auth: "bearer", response: `{ "url": "https://www.facebook.com/dialog/oauth?..." }` },
      { method: "POST",   path: "/v1/waba/callback", description: "Callback OAuth pós-Embedded Signup: troca code por access_token e vincula a conta WABA à instância", auth: "bearer", body: { code: "...", instance_id: "..." }, response: `{ "waba_id": "...", "phone_number_id": "..." }` },
      // Janela / constraints
      { method: "GET",    path: "/v1/conversations/{id}/send-constraints", description: "Verificar janela de 24h WABA antes de enviar. Se window_open=false, é obrigatório usar template. Funciona para todos os tipos de canal.", auth: "bearer", response: `{ "channel": "waba", "window_open": false, "allows_template": true, "allowed_types": ["template"], "max_body_chars": 1024, "last_customer_msg_at": "2026-04-29T10:00:00Z" }` },
    ],
  },
  {
    id: "instagram",
    title: "Instagram DMs",
    icon: Globe,
    description: "Instagram via conexão não-oficial — envio de DMs, follow/unfollow, upload de stories e posts. A instância deve ter channel=instagram e estar conectada com usuário/senha ou token Meta.",
    badge: "Instagram (não-oficial)",
    endpoints: [
      { method: "POST", path: "/v1/instances/{id}/instagram/login", description: "Conectar conta Instagram com usuário + senha (instagram-cli interno)", auth: "bearer", body: { username: "minha_conta", password: "••••••••" }, response: `{ "message": "login iniciado", "instance_id": "..." }` },
      { method: "POST", path: "/v1/instances/{id}/instagram/logout", description: "Desconectar conta Instagram", auth: "bearer" },
      { method: "POST", path: "/v1/instances/{id}/instagram/dm", description: "Enviar DM para um usuário pelo username ou user_id", auth: "bearer", body: { to: "user123", text: "Olá! Como posso ajudar?" }, response: `{ "status": "sent", "message_id": "..." }` },
      { method: "GET",  path: "/v1/instances/{id}/instagram/dm", description: "Listar DMs recebidas (inbox)", auth: "bearer", response: `{ "dms": [{ "from": "user123", "text": "Olá!", "timestamp": "..." }] }` },
      { method: "POST", path: "/v1/instances/{id}/instagram/follow", description: "Seguir usuário pelo username", auth: "bearer", body: { username: "user123" } },
      { method: "POST", path: "/v1/instances/{id}/instagram/unfollow", description: "Deixar de seguir usuário", auth: "bearer", body: { username: "user123" } },
      { method: "POST", path: "/v1/instances/{id}/instagram/post", description: "Publicar post (foto/vídeo)", auth: "bearer", body: { media_url: "https://...", caption: "Legenda do post" } },
      { method: "POST", path: "/v1/instances/{id}/instagram/story", description: "Publicar story (imagem ou vídeo)", auth: "bearer", body: { media_url: "https://..." } },
      { method: "GET",  path: "/v1/instances/{id}/instagram/media", description: "Listar posts/mídias do usuário conectado", auth: "bearer" },
      { method: "POST", path: "/v1/instances/{id}/instagram/like", description: "Curtir uma mídia pelo media_id", auth: "bearer", body: { media_id: "1234567890" } },
      { method: "POST", path: "/v1/instances/{id}/instagram/pause", description: "Pausar automação Instagram (para o bot sem desconectar)", auth: "bearer" },
      { method: "POST", path: "/v1/instances/{id}/instagram/resume", description: "Retomar automação Instagram", auth: "bearer" },
      { method: "POST", path: "/v1/instances/{id}/instagram/challenge", description: "Responder challenge de verificação de identidade Instagram", auth: "bearer", body: { code: "123456" } },
      { method: "POST", path: "/v1/instances/{id}/instagram/challenge/resend", description: "Solicitar reenvio do código de challenge", auth: "bearer" },
    ],
  },
  {
    id: "realtime",
    title: "Realtime & Health",
    icon: BarChart2,
    description: "Eventos em tempo real (WebSocket) e endpoints públicos de health/channels",
    endpoints: [
      { method: "GET", path: "/health", description: "Health check público — retorna { status: 'ok' } se o serviço está no ar", auth: "none", response: `{ "status": "ok", "service": "uniq-chat" }` },
      { method: "GET", path: "/channels", description: "Metadata dos canais disponíveis na plataforma", auth: "none", response: `[{ "id": "whatsapp", "name": "WhatsApp", "color": "#25d366" }]` },
      { method: "GET", path: "/v1/channels", description: "Mesma coisa de /channels, sob prefixo v1 (prefira este)", auth: "none" },
      { method: "GET", path: "/ws/events", description: "WebSocket de eventos da conta inteira (mensagens, status, jornadas). Passe o JWT em query ?token=", auth: "bearer" },
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

// ─── Tab definitions ─────────────────────────────────────────────────────────
type TabId = "account" | "business" | "waba" | "ig-profile" | "ig-api";

const TABS: { id: TabId; label: string; color: string; description: string; comingSoon?: boolean }[] = [
  { id: "account",    label: "Uniq Account",      color: "#00d46a", description: "Auth, workspaces, CRM, campanhas, billing e AI — comum a toda a plataforma" },
  { id: "business",   label: "Business API",       color: "#25d366", description: "WhatsApp via whatsmeow (QR/pairing) — mensagens, grupos, OTP, inbox" },
  { id: "waba",       label: "WABA",               color: "#3b82f6", description: "WhatsApp Cloud API oficial (Meta) — templates HSM, janela 24h" },
  { id: "ig-profile", label: "Instagram Profile",  color: "#e1306c", description: "Instagram não-oficial — DMs, follow, stories, automação" },
  { id: "ig-api",     label: "Instagram API",      color: "#cc2366", description: "API oficial Meta (Messaging Graph API) — em breve", comingSoon: true },
];

const SECTION_TABS: Record<string, TabId> = {
  // Uniq Account
  auth: "account", apikeys: "account", "instances-mgmt": "account",
  webhooks: "account", media: "account", crm: "account",
  campaigns: "account", integrations: "account", "ai-chat": "account",
  agent: "account", invites: "account", payments: "account",
  realtime: "account", queues: "account", workspaces: "account",
  servers: "account", proxies: "account", conversations: "account",
  // Business API
  messages: "business", instance: "business", groups: "business",
  otp: "business", inbox: "business",
  // WABA
  waba: "waba",
  // Instagram Profile
  instagram: "ig-profile",
};

const AUTH_LABELS: Record<string, { label: string; color: string; header: string }> = {
  // "Token" = instance token OU global API key (sk_*) — ambos vão no mesmo
  // header `apikey:`. NÃO confundir com JWT — ver seção "Autenticação".
  token:  { label: "Instance Token", color: "#eab308", header: "apikey: <instance_token>" },
  bearer: { label: "JWT (humano)",   color: "#3b82f6", header: "Authorization: Bearer <jwt>" },
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

// endpointSlug — gera ID estável pra anchor + key (ex: "post-v1-server-instance-messages-text").
function endpointSlug(ep: Endpoint): string {
  const cleanPath = ep.path
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${ep.method.toLowerCase()}-${cleanPath}`;
}

function EndpointCard({
  ep,
  anchor,
  open,
  onToggle,
}: {
  ep: Endpoint;
  anchor: string;
  open: boolean;
  onToggle: (anchor: string) => void;
}) {
  // Card é totalmente controlado pelo parent (accordion):
  // só 1 aberto por vez na página. Click no header → toggle no parent.
  const mc = METHOD_COLORS[ep.method];
  const auth = ep.auth ? AUTH_LABELS[ep.auth] : AUTH_LABELS.none;

  const curlBody = ep.body ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(ep.body)}'` : "";
  const curlAuth = ep.auth === "token"
    ? `\\\n  -H "apikey: SEU_INSTANCE_TOKEN" `
    : ep.auth === "bearer"
    ? `\\\n  -H "Authorization: Bearer SEU_JWT" `
    : "";
  const curlCmd = `curl -X ${ep.method} ${BASE}${ep.path} ${curlAuth}${curlBody}`;

  return (
    <div id={anchor} className="rounded-xl overflow-hidden border scroll-mt-24" style={{ borderColor: "hsl(240 8% 16%)" }}>
      <button
        className="w-full text-left transition-colors hover:bg-white/5"
        style={{ background: "hsl(240 8% 10%)" }}
        onClick={() => onToggle(anchor)}
      >
        {/* Linha 1: METHOD + PATH (sempre visível, sem truncate) + auth + chevron */}
        <div className="flex items-center gap-3 px-4 pt-3">
          <span className="text-xs font-semibold px-2 py-0.5 rounded shrink-0 min-w-[52px] text-center" style={{ background: mc.bg, color: mc.text }}>
            {ep.method}
          </span>
          <code className="text-sm font-mono flex-1 break-all leading-relaxed" style={{ color: "hsl(240 8% 88%)" }}>
            {ep.path}
          </code>
          {ep.auth && (
            <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 font-medium hidden sm:inline" style={{ background: `${auth.color}20`, color: auth.color }}>
              {auth.label}
            </span>
          )}
          {open
            ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: "hsl(240 8% 40%)" }} />
            : <ChevronRight className="w-4 h-4 shrink-0" style={{ color: "hsl(240 8% 40%)" }} />}
        </div>
        {/* Linha 2: descrição (cor mais soft, com indent pra alinhar com o path) */}
        <p className="text-xs leading-relaxed pl-[76px] pr-4 pb-3 pt-1" style={{ color: "hsl(240 8% 55%)" }}>
          {ep.description}
        </p>
      </button>

      {open && (
        <div className="px-5 py-4 space-y-4 border-t" style={{ background: "hsl(240 8% 8%)", borderColor: "hsl(240 8% 14%)" }}>
          {/* Description já aparece no header agora — removida daqui pra
              não duplicar. Se precisar de copy do path no detalhe, é
              renderizado pelo bloco de cURL abaixo. */}

          {ep.auth && ep.auth !== "none" && (
            <div>
              <p className="text-xs font-medium uppercase mb-1.5" style={{ color: "hsl(240 8% 40%)" }}>Autenticação</p>
              <code className="text-xs px-3 py-1.5 rounded inline-block" style={{ background: "hsl(240 8% 14%)", color: auth.color }}>
                {auth.header}
              </code>
            </div>
          )}

          {ep.params && (
            <div>
              <p className="text-xs font-medium uppercase mb-1.5" style={{ color: "hsl(240 8% 40%)" }}>Query Params</p>
              <pre className="text-xs rounded-lg px-4 py-3" style={{ background: "hsl(240 8% 5%)", color: "#fde68a" }}>
                {Object.entries(ep.params).map(([k, v]) => `?${k}=${v}`).join("\n")}
              </pre>
            </div>
          )}

          {ep.body && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium uppercase" style={{ color: "hsl(240 8% 40%)" }}>Body (JSON)</p>
                <CopyButton text={JSON.stringify(ep.body, null, 2)} />
              </div>
              <pre className="text-xs rounded-lg px-4 py-3 overflow-x-auto" style={{ background: "hsl(240 8% 5%)", color: "#86efac" }}>
                {JSON.stringify(ep.body, null, 2)}
              </pre>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium uppercase" style={{ color: "hsl(240 8% 40%)" }}>cURL</p>
              <CopyButton text={curlCmd} />
            </div>
            <pre className="text-xs rounded-lg px-4 py-3 overflow-x-auto" style={{ background: "hsl(240 8% 5%)", color: "#93c5fd" }}>
              {curlCmd}
            </pre>
          </div>

          {ep.response && (
            <div>
              <p className="text-xs font-medium uppercase mb-1.5" style={{ color: "hsl(240 8% 40%)" }}>Resposta</p>
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
  const [activeTab, setActiveTab] = useState<TabId>("business");
  const [activeSection, setActiveSection] = useState("messages");
  const [activeAnchor, setActiveAnchor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["messages"]));

  const tabSections = useMemo(
    () => SECTIONS.filter(s => SECTION_TABS[s.id] === activeTab),
    [activeTab]
  );

  const totalEndpoints = SECTIONS.reduce((sum, s) => sum + s.endpoints.length, 0);
  const activeS = tabSections.find(s => s.id === activeSection) ?? tabSections[0];
  const activeTabDef = TABS.find(t => t.id === activeTab)!;

  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (ep: Endpoint) =>
    !searchLower ||
    ep.path.toLowerCase().includes(searchLower) ||
    ep.description.toLowerCase().includes(searchLower) ||
    ep.method.toLowerCase().includes(searchLower);

  const sectionMatches = useMemo(() => {
    return tabSections.map(s => ({
      ...s,
      filteredEndpoints: s.endpoints.filter(matchesSearch),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLower, tabSections]);

  useEffect(() => {
    if (searchLower) {
      setOpenSections(new Set(sectionMatches.filter(s => s.filteredEndpoints.length > 0).map(s => s.id)));
    } else {
      setOpenSections(new Set([activeSection]));
    }
  }, [searchLower, activeSection, sectionMatches]);

  const switchTab = (tabId: TabId) => {
    setActiveTab(tabId);
    const first = SECTIONS.find(s => SECTION_TABS[s.id] === tabId);
    if (first) { setActiveSection(first.id); setOpenSections(new Set([first.id])); }
    setActiveAnchor(null);
    setSearch("");
  };

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const goToEndpoint = (sectionId: string, anchor: string) => {
    setActiveSection(sectionId);
    setActiveAnchor(anchor);
    setTimeout(() => {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const toggleCard = (anchor: string) => {
    setActiveAnchor(prev => (prev === anchor ? null : anchor));
  };

  return (
    <div className="min-h-screen" style={{ background: "hsl(240 8% 6%)", color: "hsl(240 8% 85%)" }}>
      {/* Header */}
      <header className="border-b sticky top-0 z-10" style={{ background: "hsl(240 8% 6%)", borderColor: "hsl(240 8% 14%)" }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <div className="w-px h-5" style={{ background: "hsl(240 8% 20%)" }} />
            <div className="flex items-center gap-1.5">
              <BookOpen className="w-4 h-4" style={{ color: "hsl(240 8% 50%)" }} />
              <span className="text-sm font-medium" style={{ color: "hsl(240 8% 70%)" }}>API Reference</span>
            </div>
            <span className="text-xs px-2 py-0.5 rounded" style={{ background: "rgba(0,212,106,0.1)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.2)" }}>v1</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs hidden sm:block" style={{ color: "hsl(240 8% 40%)" }}>{totalEndpoints} endpoints</span>
            <a href="/login" className="text-xs px-4 py-2 rounded-lg font-medium transition-opacity hover:opacity-80"
              style={{ background: "rgba(0,212,106,0.15)", border: "1px solid rgba(0,212,106,0.3)", color: "#00d46a" }}>
              Acessar plataforma →
            </a>
          </div>
        </div>

        {/* ── Tab Pills ──────────────────────────────────────────────────────── */}
        <div className="max-w-7xl mx-auto px-6 pb-2.5 flex items-center gap-1.5 overflow-x-auto scrollbar-none">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => !tab.comingSoon && switchTab(tab.id)}
                title={tab.description}
                disabled={tab.comingSoon}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all shrink-0"
                style={isActive
                  ? { background: `${tab.color}22`, color: tab.color, border: `1px solid ${tab.color}55` }
                  : { background: "transparent", color: tab.comingSoon ? "hsl(240 8% 28%)" : "hsl(240 8% 52%)", border: "1px solid hsl(240 8% 17%)", cursor: tab.comingSoon ? "default" : "pointer" }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: isActive ? tab.color : "hsl(240 8% 28%)" }} />
                {tab.label}
                {tab.comingSoon && (
                  <span className="text-[9px] px-1 rounded-sm ml-0.5" style={{ background: "hsl(240 8% 16%)", color: "hsl(240 8% 38%)" }}>
                    em breve
                  </span>
                )}
              </button>
            );
          })}
          <div className="flex-1" />
          <span className="text-[11px] shrink-0" style={{ color: "hsl(240 8% 35%)" }}>
            {tabSections.reduce((n, s) => n + s.endpoints.length, 0)} endpoints nesta aba
          </span>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col lg:flex-row gap-4 sm:gap-8">
        {/* Mobile controls */}
        <div className="lg:hidden space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "hsl(240 8% 40%)" }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar endpoint..." className="w-full text-sm rounded-lg pl-9 pr-3 py-2 outline-none"
              style={{ background: "hsl(240 8% 10%)", border: "1px solid hsl(240 8% 16%)", color: "hsl(240 8% 85%)" }} />
          </div>
          <select value={activeSection} onChange={e => { setActiveSection(e.target.value); setActiveAnchor(null); }}
            className="w-full text-sm rounded-lg px-3 py-2 outline-none"
            style={{ background: "hsl(240 8% 10%)", border: "1px solid hsl(240 8% 16%)", color: "hsl(240 8% 85%)" }}>
            {tabSections.map(s => <option key={s.id} value={s.id}>{s.title} ({s.endpoints.length})</option>)}
          </select>
        </div>

        {/* Sidebar */}
        <aside className="w-64 shrink-0 hidden lg:block">
          <div className="sticky top-[6.5rem] space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "hsl(240 8% 40%)" }} />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Buscar endpoint..." className="w-full text-sm rounded-lg pl-9 pr-9 py-2 outline-none"
                style={{ background: "hsl(240 8% 10%)", border: "1px solid hsl(240 8% 16%)", color: "hsl(240 8% 85%)" }} />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/10">
                  <X className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 50%)" }} />
                </button>
              )}
            </div>

            <p className="text-[10px] font-semibold uppercase tracking-wider px-1" style={{ color: activeTabDef.color }}>
              {activeTabDef.label}
              {searchLower && (
                <span className="ml-2 normal-case font-normal" style={{ color: "hsl(240 8% 50%)" }}>
                  · {sectionMatches.reduce((n, s) => n + s.filteredEndpoints.length, 0)} resultados
                </span>
              )}
            </p>

            {activeTabDef.comingSoon ? (
              <div className="px-2 py-10 text-center space-y-2">
                <p className="text-sm" style={{ color: "hsl(240 8% 40%)" }}>Em breve</p>
                <p className="text-xs" style={{ color: "hsl(240 8% 30%)" }}>{activeTabDef.description}</p>
              </div>
            ) : (
              <div className="space-y-0.5 max-h-[calc(100vh-16rem)] overflow-y-auto pr-1">
                {sectionMatches.map(s => {
                  const Icon = s.icon;
                  const isActive = activeSection === s.id;
                  const isOpen = openSections.has(s.id);
                  const endpoints = searchLower ? s.filteredEndpoints : s.endpoints;
                  if (searchLower && endpoints.length === 0) return null;

                  return (
                    <div key={s.id}>
                      <button
                        onClick={() => { setActiveSection(s.id); toggleSection(s.id); setActiveAnchor(null); }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition-colors"
                        style={{
                          background: isActive && !activeAnchor ? `${activeTabDef.color}18` : "transparent",
                          color: isActive ? activeTabDef.color : "hsl(240 8% 68%)",
                          border: isActive && !activeAnchor ? `1px solid ${activeTabDef.color}35` : "1px solid transparent",
                        }}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="flex-1 font-medium text-[13px]">{s.title}</span>
                        <span className="text-[10px] tabular-nums" style={{ color: "hsl(240 8% 38%)" }}>{endpoints.length}</span>
                        {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                      </button>

                      {isOpen && (
                        <div className="ml-3 pl-3 mt-0.5 space-y-0.5" style={{ borderLeft: "1px solid hsl(240 8% 13%)" }}>
                          {endpoints.map(ep => {
                            const anchor = endpointSlug(ep);
                            const isEpActive = isActive && activeAnchor === anchor;
                            const mc = METHOD_COLORS[ep.method];
                            return (
                              <button key={anchor} onClick={() => goToEndpoint(s.id, anchor)}
                                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors"
                                style={{ background: isEpActive ? `${activeTabDef.color}12` : "transparent", color: isEpActive ? activeTabDef.color : "hsl(240 8% 58%)" }}>
                                <span className="text-[9px] font-bold uppercase shrink-0 w-8 text-center px-0.5 py-0.5 rounded" style={{ background: mc.bg, color: mc.text }}>
                                  {ep.method === "DELETE" ? "DEL" : ep.method}
                                </span>
                                <span className="flex-1 truncate font-mono" style={{ fontSize: "11px" }}>
                                  {ep.path.split("/").filter(p => p && !p.startsWith("{")).slice(-2).join("/")}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {searchLower && sectionMatches.every(s => s.filteredEndpoints.length === 0) && (
                  <p className="text-xs px-2 py-6 italic text-center" style={{ color: "hsl(240 8% 40%)" }}>
                    Sem resultados para &quot;{search}&quot;
                  </p>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">
          {activeTabDef.comingSoon ? (
            <div className="flex flex-col items-center justify-center py-28 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: `${activeTabDef.color}14`, border: `1px solid ${activeTabDef.color}30` }}>
                <Globe className="w-8 h-8" style={{ color: activeTabDef.color }} />
              </div>
              <h2 className="text-xl font-semibold" style={{ color: "hsl(240 8% 85%)" }}>{activeTabDef.label}</h2>
              <p className="text-sm max-w-sm" style={{ color: "hsl(240 8% 50%)" }}>{activeTabDef.description}</p>
              <span className="text-xs px-3 py-1.5 rounded-full" style={{ background: "hsl(240 8% 14%)", color: "hsl(240 8% 45%)" }}>Em breve</span>
            </div>
          ) : activeS ? (
            <>
              {/* Section header */}
              <div className="flex items-start gap-4 mb-6">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${activeTabDef.color}14`, border: `1px solid ${activeTabDef.color}30` }}>
                  <activeS.icon className="w-5 h-5" style={{ color: activeTabDef.color }} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-semibold" style={{ color: "hsl(240 8% 90%)" }}>{activeS.title}</h1>
                    {activeS.badge && (
                      <span className="text-xs px-2 py-0.5 rounded" style={{ background: `${activeTabDef.color}14`, color: activeTabDef.color, border: `1px solid ${activeTabDef.color}30` }}>
                        {activeS.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-sm mt-0.5" style={{ color: "hsl(240 8% 50%)" }}>{activeS.description}</p>
                </div>
              </div>

              {/* Base URL bar */}
              <div className="flex flex-wrap items-center gap-4 mb-6 px-4 py-3 rounded-xl" style={{ background: "hsl(240 8% 10%)", border: "1px solid hsl(240 8% 16%)" }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase" style={{ color: "hsl(240 8% 40%)" }}>Base URL</span>
                  <code className="text-sm font-mono" style={{ color: "#93c5fd" }}>{BASE}</code>
                  <CopyButton text={BASE} />
                </div>
                {activeS.badge === "V1 API" && (
                  <>
                    <span style={{ color: "hsl(240 8% 25%)" }}>|</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium uppercase" style={{ color: "hsl(240 8% 40%)" }}>V1 Base</span>
                      <code className="text-sm font-mono" style={{ color: "#f9a8d4" }}>{V1_BASE}</code>
                      <CopyButton text={V1_BASE} />
                    </div>
                  </>
                )}
              </div>

              {/* Endpoints accordion */}
              <div className="space-y-2">
                {activeS.endpoints.map((ep, i) => {
                  const anchor = endpointSlug(ep);
                  return (
                    <EndpointCard key={`${anchor}-${i}`} ep={ep} anchor={anchor} open={activeAnchor === anchor} onToggle={toggleCard} />
                  );
                })}
              </div>

              {/* Auth legend */}
              <div className="mt-8 p-5 rounded-xl space-y-4" style={{ background: "hsl(240 8% 10%)", border: "1px solid hsl(240 8% 16%)" }}>
                <p className="text-xs font-medium uppercase" style={{ color: "hsl(240 8% 40%)" }}>Como autenticar</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: "rgba(234,179,8,0.12)", color: "#eab308" }}>Instance Token</span>
                    <span className="text-xs font-medium" style={{ color: "hsl(240 8% 80%)" }}>endpoints de mensagem / instância</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "hsl(240 8% 60%)" }}>
                    Token único por instância. <strong>Não expira</strong>. Pegue em <code className="text-[11px] px-1 py-0.5 rounded" style={{ background: "hsl(240 8% 14%)", color: "#93c5fd" }}>app.uniq.chat → Instâncias → [sua instância] → Token</code>.
                  </p>
                  <pre className="text-[11px] font-mono p-2 rounded mt-1 overflow-x-auto" style={{ background: "hsl(240 8% 6%)", color: "hsl(240 8% 75%)" }}>
{`# Header canônico
apikey: inst_abc123xyz...

# Aliases aceitos
X-Instance-Token: inst_abc123xyz...
Authorization: Bearer inst_abc123xyz...`}
                  </pre>
                </div>
                <div className="space-y-1.5 pt-3" style={{ borderTop: "1px solid hsl(240 8% 16%)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: "rgba(234,179,8,0.12)", color: "#eab308" }}>Global API Key</span>
                    <span className="text-xs font-medium" style={{ color: "hsl(240 8% 80%)" }}>n8n / SDK — várias instâncias</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "hsl(240 8% 60%)" }}>
                    Chave <code>sc_*</code> que acessa todas as instâncias do dono. Crie em <code className="text-[11px] px-1 py-0.5 rounded" style={{ background: "hsl(240 8% 14%)", color: "#93c5fd" }}>app.uniq.chat → API Keys</code>. Mesmo header <code>apikey:</code>. Não expira.
                  </p>
                </div>
                <div className="space-y-1.5 pt-3" style={{ borderTop: "1px solid hsl(240 8% 16%)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6" }}>JWT (humano)</span>
                    <span className="text-xs font-medium" style={{ color: "hsl(240 8% 80%)" }}>UI / fluxo logado</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "hsl(240 8% 60%)" }}>
                    Token de sessão do <code>POST /auth/login</code>. <strong>Expira em 24h</strong>; renove com <code>/auth/refresh</code>. Necessário para CRM, workspace, billing.
                  </p>
                  <pre className="text-[11px] font-mono p-2 rounded mt-1 overflow-x-auto" style={{ background: "hsl(240 8% 6%)", color: "hsl(240 8% 75%)" }}>
{`Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`}
                  </pre>
                </div>
                <div className="pt-3" style={{ borderTop: "1px solid hsl(240 8% 16%)" }}>
                  <p className="text-xs font-medium mb-2" style={{ color: "hsl(240 8% 70%)" }}>Qual usar?</p>
                  <ul className="text-xs space-y-1" style={{ color: "hsl(240 8% 60%)" }}>
                    <li>• <strong>Enviar mensagens via n8n/cron/webhook?</strong> → Instance Token (ou Global Key)</li>
                    <li>• <strong>UI com login de usuário?</strong> → JWT</li>
                    <li>• <strong>Badge amarelo no endpoint?</strong> → Instance Token</li>
                    <li>• <strong>Badge azul no endpoint?</strong> → JWT</li>
                  </ul>
                </div>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
