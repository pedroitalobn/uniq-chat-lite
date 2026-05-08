"use client";

import {
  BookmarkPlus,
  ClipboardList,
  FileText,
  NotebookPen,
  Tag,
  UserMinus,
  Image as ImageIcon,
  Video,
  Mic,
  Paperclip,
  MapPin,
  Contact,
  QrCode,
  ListChecks,
  BarChart3,
  Smile,
  Instagram,
  BookOpen,
  Send,
  Clock,
  type LucideIcon,
} from "lucide-react";

// Catálogo de ações nativas que o agente pode executar dentro da
// conversa. Agrupado por categoria pra modal de Habilidades exibir
// com chips. Mesmo conjunto usado pelo AgentActionsConfig antigo —
// se precisarmos sincronizar, este é o source-of-truth do novo editor.

export type ActionId =
  | "add_tag"
  | "remove_tag"
  | "note"
  | "create_task"
  | "schedule_meeting"
  | "transfer_to_human"
  | "update_contact"
  | "create_deal"
  | "update_deal_stage"
  | "search_contact"
  | "enroll_in_journey"
  | "send_image"
  | "send_video"
  | "send_audio"
  | "send_document"
  | "send_location"
  | "send_contact"
  | "send_pix"
  | "send_buttons"
  | "send_poll"
  | "react_to_last"
  | "instagram_follow"
  | "instagram_unfollow"
  | "search_help_articles"
  | "send_help_article"
  | "query_kb"
  | "instagram_dm"
  | "instagram_comment"
  | "get_current_time";

export type ActionDef = {
  id: ActionId;
  label: string;
  description: string;
  icon: LucideIcon;
};

export type ActionCategory = {
  id: string;
  label: string;
  emoji: string;
  color: string;
  actions: ActionDef[];
};

export const ACTION_CATEGORIES: ActionCategory[] = [
  {
    id: "crm",
    label: "CRM & Atendimento",
    emoji: "🤝",
    color: "#00d46a",
    actions: [
      { id: "add_tag",            label: "Adicionar tag",       description: "Marca o contato com uma tag (VIP, comprador, lead-quente).", icon: Tag },
      { id: "remove_tag",         label: "Remover tag",         description: "Tira uma tag do contato.",                                  icon: BookmarkPlus },
      { id: "note",               label: "Anotar no CRM",       description: "Registra uma nota interna na timeline do contato.",         icon: NotebookPen },
      { id: "create_task",        label: "Criar tarefa",        description: "Abre tarefa pra time humano.",                              icon: ClipboardList },
      { id: "schedule_meeting",   label: "Agendar reunião",     description: "Cria reunião na agenda do CRM.",                            icon: FileText },
      { id: "transfer_to_human",  label: "Transferir pra humano", description: "Desliga o bot e passa a conversa pro atendimento humano.", icon: UserMinus },
      { id: "update_contact",     label: "Atualizar contato",   description: "Atualiza nome/email/custom_fields. Telefone é imutável.",   icon: NotebookPen },
      { id: "create_deal",        label: "Criar negócio",       description: "Abre um deal novo no funil/estágio escolhido.",             icon: ClipboardList },
      { id: "update_deal_stage",  label: "Mover deal",          description: "Move o deal aberto mais recente do contato pra outra etapa.", icon: FileText },
      { id: "search_contact",     label: "Buscar contato",      description: "Procura contatos por nome/telefone/email no workspace.",    icon: BookmarkPlus },
      { id: "enroll_in_journey",  label: "Inscrever em jornada",description: "Coloca o contato numa jornada de mensagens automáticas.",   icon: FileText },
    ],
  },
  {
    id: "comm",
    label: "Mensagens & Mídia",
    emoji: "💬",
    color: "#60a5fa",
    actions: [
      { id: "send_image",     label: "Enviar imagem",        description: "Manda foto via URL com legenda opcional.",          icon: ImageIcon },
      { id: "send_video",     label: "Enviar vídeo",         description: "Manda vídeo via URL.",                              icon: Video },
      { id: "send_audio",     label: "Enviar áudio",         description: "Manda áudio (ptt=true vira voice note no WhatsApp).", icon: Mic },
      { id: "send_document",  label: "Enviar documento",     description: "Manda PDF/arquivo via URL com nome customizado.",   icon: Paperclip },
      { id: "send_location",  label: "Enviar localização",   description: "Manda coordenadas GPS com nome do local.",          icon: MapPin },
      { id: "send_contact",   label: "Enviar contato",       description: "Compartilha vCard (nome + telefone + email).",      icon: Contact },
      { id: "send_pix",       label: "Cobrança PIX",         description: "Card interativo de pagamento com chave PIX.",       icon: QrCode },
      { id: "send_buttons",   label: "Enviar botões",        description: "Mensagem com até 3 botões clicáveis.",              icon: ListChecks },
      { id: "send_poll",      label: "Enviar enquete",       description: "Pergunta com 2-12 opções; suporta múltipla escolha.", icon: BarChart3 },
      { id: "react_to_last",  label: "Reagir à última msg",  description: "Coloca emoji na última mensagem do cliente.",        icon: Smile },
    ],
  },
  {
    id: "instagram",
    label: "Instagram",
    emoji: "📷",
    color: "#e879f9",
    actions: [
      { id: "instagram_follow",   label: "Seguir no Instagram",  description: "Segue o usuário do Instagram.",                  icon: Instagram },
      { id: "instagram_unfollow", label: "Deixar de seguir IG",  description: "Unfollow no Instagram.",                          icon: Instagram },
      { id: "instagram_dm",       label: "Enviar DM Instagram",  description: "DM proativo via Instagram.",                      icon: Instagram },
      { id: "instagram_comment",  label: "Comentar no IG",       description: "Posta comentário num media (post/reel) via media_id.", icon: Instagram },
    ],
  },
  {
    id: "knowledge",
    label: "Conhecimento & Help Desk",
    emoji: "🎓",
    color: "#a78bfa",
    actions: [
      { id: "search_help_articles", label: "Buscar artigo Help Desk", description: "Procura tutoriais publicados.", icon: BookOpen },
      { id: "send_help_article",    label: "Enviar artigo Help Desk", description: "Envia link/preview do artigo.", icon: Send },
      { id: "query_kb",             label: "Consultar base do agente", description: "Busca trechos relevantes nos documentos da KB.", icon: BookOpen },
    ],
  },
  {
    id: "util",
    label: "Utilidades",
    emoji: "⚙️",
    color: "#f59e0b",
    actions: [
      { id: "get_current_time", label: "Saber data/hora atual", description: "Devolve data/hora em PT-BR.", icon: Clock },
    ],
  },
];

// Lookup flat — útil pra renderizar uma ação específica fora do contexto
// da categoria (ex: lista do top-6 enabled).
export const ALL_ACTIONS: ActionDef[] = ACTION_CATEGORIES.flatMap((c) => c.actions);

export function totalActionsCount(): number {
  return ALL_ACTIONS.length;
}
