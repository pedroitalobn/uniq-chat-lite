"use client";

// AgentActionsConfig — toggles para as ações nativas que o agente pode
// executar dentro da Uniq durante uma conversa (add_tag, criar tarefa,
// agendar reunião, etc) + política de confirmação. Os toggles são
// persistidos como entradas do array app_access (type="action") pra
// reusar a infra existente; o backend lê via parseEnabledTools.

import {
  Bot, BookmarkPlus, ClipboardList, FileText, MessageSquareWarning, NotebookPen, Tag, UserMinus, UsersRound,
  Image as ImageIcon, Video, Mic, Paperclip, MapPin, Contact, QrCode, ListChecks, BarChart3, Smile, Instagram, BookOpen, Send,
} from "lucide-react";

type ActionId =
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

type AppAccessEntry = {
  id: string;
  name: string;
  type: string;
  target: string;
  description: string;
  enabled: boolean;
};

const ACTIONS: Array<{
  id: ActionId;
  label: string;
  description: string;
  icon: any;
}> = [
  { id: "add_tag",           label: "Adicionar tag",       description: "Marca o contato com uma tag (ex: VIP, comprador, lead-quente).", icon: Tag },
  { id: "remove_tag",        label: "Remover tag",         description: "Tira uma tag do contato.",                                       icon: BookmarkPlus },
  { id: "note",              label: "Anotar no CRM",       description: "Registra uma nota interna na timeline do contato.",               icon: NotebookPen },
  { id: "create_task",       label: "Criar tarefa",        description: "Abre tarefa pra time humano (ex: ligar amanhã, enviar proposta).", icon: ClipboardList },
  { id: "schedule_meeting",  label: "Agendar reunião",     description: "Cria reunião na agenda do CRM com horário sugerido.",             icon: FileText },
  { id: "transfer_to_human", label: "Transferir pra humano", description: "Desliga o bot e passa a conversa pro atendimento humano.",       icon: UserMinus },
  // Sprint A — CRM completo
  { id: "update_contact",    label: "Atualizar contato",   description: "Atualiza nome, email e custom_fields. Telefone fica imutável (segurança).", icon: NotebookPen },
  { id: "create_deal",       label: "Criar negócio",       description: "Abre um deal novo no funil/estágio escolhido pelo nome.",           icon: ClipboardList },
  { id: "update_deal_stage", label: "Mover deal de etapa", description: "Move o deal aberto mais recente do contato pra outra etapa.",        icon: FileText },
  { id: "search_contact",    label: "Buscar contato",      description: "Procura contatos por nome/telefone/email no workspace.",            icon: BookmarkPlus },
  // Sprint B — jornadas
  { id: "enroll_in_journey", label: "Inscrever em jornada", description: "Coloca o contato numa jornada de mensagens automáticas existente.", icon: FileText },
  // Sprint C — instância (WhatsApp + Instagram)
  { id: "send_image",         label: "Enviar imagem",     description: "Manda foto/imagem via URL com legenda opcional.",                       icon: ImageIcon },
  { id: "send_video",         label: "Enviar vídeo",      description: "Manda vídeo via URL com legenda opcional.",                              icon: Video },
  { id: "send_audio",         label: "Enviar áudio",      description: "Manda áudio (com ptt=true vira voice note do WhatsApp).",                icon: Mic },
  { id: "send_document",      label: "Enviar documento",  description: "Manda PDF/arquivo via URL com nome customizado.",                        icon: Paperclip },
  { id: "send_location",      label: "Enviar localização", description: "Manda coordenadas GPS com nome do local.",                              icon: MapPin },
  { id: "send_contact",       label: "Enviar contato",    description: "Compartilha vCard de outro contato (nome + telefone + email).",          icon: Contact },
  { id: "send_pix",           label: "Enviar cobrança PIX", description: "Card interativo de pagamento com chave PIX (CPF/CNPJ/EMAIL/PHONE/EVP).", icon: QrCode },
  { id: "send_buttons",       label: "Enviar botões",     description: "Mensagem com até 3 botões clicáveis (resposta rápida).",                 icon: ListChecks },
  { id: "send_poll",          label: "Enviar enquete",    description: "Pergunta com 2-12 opções; suporta múltipla escolha.",                    icon: BarChart3 },
  { id: "react_to_last",      label: "Reagir à última msg", description: "Coloca emoji-reação na última mensagem do cliente (👍, ❤️, etc).",    icon: Smile },
  { id: "instagram_follow",   label: "Seguir no Instagram", description: "Segue o usuário do Instagram (instâncias IG via Taktik).",              icon: Instagram },
  { id: "instagram_unfollow", label: "Deixar de seguir IG", description: "Unfollow no Instagram.",                                                 icon: Instagram },
  // Sprint D — Help Desk
  { id: "search_help_articles", label: "Buscar artigo Help Desk", description: "Procura tutoriais publicados que podem responder a dúvida do cliente.", icon: BookOpen },
  { id: "send_help_article",    label: "Enviar artigo Help Desk",  description: "Envia link/preview do artigo direto pra conversa.",                    icon: Send },
  // Sprint E — RAG + Instagram extra + utility
  { id: "query_kb",          label: "Consultar base do agente", description: "Busca trechos relevantes nos documentos carregados na knowledge base do agente.", icon: BookOpen },
  { id: "instagram_dm",      label: "Enviar DM Instagram",      description: "DM proativo via Instagram (não é resposta — começa conversa nova).",            icon: Instagram },
  { id: "instagram_comment", label: "Comentar no Instagram",    description: "Posta comentário num media (post/reel) via media_id.",                          icon: Instagram },
  { id: "get_current_time",  label: "Saber data/hora atual",    description: "Devolve data/hora em PT-BR. Habilite quando o agente discute prazos/datas.",     icon: ListChecks },
];

const CONFIRMATION_OPTIONS = [
  { value: "client", label: "Pergunta no chat",    description: "Agente confirma com o cliente antes de executar (default)." },
  { value: "auto",   label: "Executa direto",       description: "Sem confirmação. Use só quando o agente é experiente e o risco é baixo." },
  { value: "human",  label: "Aprovação humana",     description: "Cria tarefa no painel pra time aprovar antes de executar." },
];

function uid() { return Math.random().toString(36).slice(2, 10); }

export function AgentActionsConfig({
  appAccess,
  confirmation,
  onChangeAppAccess,
  onChangeConfirmation,
}: {
  appAccess: AppAccessEntry[];
  confirmation: "client" | "auto" | "human";
  onChangeAppAccess: (next: AppAccessEntry[]) => void;
  onChangeConfirmation: (v: "client" | "auto" | "human") => void;
}) {
  const isEnabled = (id: ActionId) =>
    appAccess.some((e) => e.type === "action" && e.name === id && e.enabled);

  const toggle = (id: ActionId) => {
    const idx = appAccess.findIndex((e) => e.type === "action" && e.name === id);
    if (idx >= 0) {
      const next = [...appAccess];
      next[idx] = { ...next[idx], enabled: !next[idx].enabled };
      onChangeAppAccess(next);
    } else {
      onChangeAppAccess([
        ...appAccess,
        {
          id: uid(),
          name: id,
          type: "action",
          target: "",
          description: ACTIONS.find((a) => a.id === id)?.description || "",
          enabled: true,
        },
      ]);
    }
  };

  const enabledCount = ACTIONS.filter((a) => isEnabled(a.id)).length;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-1)" }}>
          <Bot className="w-4 h-4" style={{ color: "#a78bfa" }} />
          Ações dentro da Uniq
        </h3>
        <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
          O agente pode executar ações no sistema durante a conversa (taguear, agendar, anotar). Liga só o que faz sentido pro fluxo dele.
        </p>
      </div>

      <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--text-2)" }}>Política de confirmação</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {CONFIRMATION_OPTIONS.map((opt) => {
            const active = confirmation === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChangeConfirmation(opt.value as any)}
                className="text-left rounded-lg p-2.5 transition"
                style={{
                  background: active ? "rgba(0,212,106,0.08)" : "var(--surface-3)",
                  border: `1px solid ${active ? "rgba(0,212,106,0.3)" : "var(--surface-border)"}`,
                }}
              >
                <p className="text-xs font-medium" style={{ color: active ? "var(--green)" : "var(--text-1)" }}>{opt.label}</p>
                <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium" style={{ color: "var(--text-2)" }}>Ações habilitadas</p>
          <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
            {enabledCount}/{ACTIONS.length} ativas
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ACTIONS.map((a) => {
            const Icon = a.icon;
            const on = isEnabled(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                className="text-left rounded-xl p-3 transition flex items-start gap-2"
                style={{
                  background: on ? "rgba(0,212,106,0.06)" : "var(--surface-2)",
                  border: `1px solid ${on ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
                }}
              >
                <Icon className="w-4 h-4 mt-0.5 shrink-0" style={{ color: on ? "var(--green)" : "var(--text-3)" }} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium" style={{ color: "var(--text-1)" }}>{a.label}</p>
                  <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{a.description}</p>
                </div>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    background: on ? "rgba(0,212,106,0.15)" : "var(--surface-3)",
                    color: on ? "var(--green)" : "var(--text-3)",
                  }}
                >
                  {on ? "ON" : "OFF"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
        <UsersRound className="w-3 h-3 inline mr-1" />
        O agente vai mencionar a ação no chat antes de executar (em modo &quot;Pergunta no chat&quot;) e usa o marker
        <code className="text-[10px] mx-1 px-1 rounded" style={{ background: "var(--surface-3)", color: "#a5b4fc" }}>{"[[action:nome({...})]]"}</code>
        que o backend remove automaticamente da resposta.
      </p>
    </div>
  );
}
