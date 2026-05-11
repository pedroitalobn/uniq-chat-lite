"use client";

import { useState } from "react";
import { Loader2, Search, X, Zap, Clock, Layers } from "lucide-react";
import { toast } from "sonner";
import { journeysApi } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlowStep {
  id: string;
  type: string;
  label?: string;
  config?: Record<string, unknown>;
  next_step_id?: string;
  is_start_step?: boolean;
  branch_true?: string;
  branch_false?: string;
}

interface JourneyFlow {
  start_step?: string;
  steps: FlowStep[];
}

type Category = "all" | "retention" | "acquisition" | "engagement" | "support";

interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  category: Exclude<Category, "all">;
  icon: string;
  color: string;
  trigger_type: string;
  trigger_label: string;
  channels: string[];
  steps_count: number;
  estimated_time: string;
  flow: JourneyFlow;
}

interface TemplatesDialogProps {
  onClose: () => void;
  instanceId?: string;
}

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<Exclude<Category, "all">, { label: string; color: string }> = {
  retention:   { label: "Retenção",    color: "#10b981" },
  acquisition: { label: "Captação",    color: "#3b82f6" },
  engagement:  { label: "Engajamento", color: "#a855f7" },
  support:     { label: "Suporte",     color: "#f59e0b" },
};

const CATEGORY_TABS: { value: Category; label: string }[] = [
  { value: "all",         label: "Todos"       },
  { value: "retention",   label: "Retenção"    },
  { value: "acquisition", label: "Captação"    },
  { value: "engagement",  label: "Engajamento" },
  { value: "support",     label: "Suporte"     },
];

// ─── Built-in templates ───────────────────────────────────────────────────────

const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  // 1 ── Recuperação de Clientes
  {
    id: "recuperacao-clientes",
    name: "Recuperação de Clientes",
    description: "Reengaje clientes inativos com uma mensagem personalizada e acompanhe a resposta para marcar quem voltou.",
    category: "retention",
    icon: "🔄",
    color: "#f59e0b",
    trigger_type: "cron_schedule",
    trigger_label: "Cron mensal",
    channels: ["WhatsApp"],
    steps_count: 5,
    estimated_time: "~2h 30m",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "message",
          label: "Mensagem de reaproximação",
          is_start_step: true,
          config: { text: "Oi {{name}}! Saudades 💛 Faz um tempo que a gente não conversa. Tem algo que posso fazer por você?" },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "wait",
          label: "Aguardar 2h",
          config: { duration: "2h" },
          next_step_id: "s3",
        },
        {
          id: "s3",
          type: "condition",
          label: "Cliente respondeu?",
          config: { variable: "{{last_input}}", operator: "exists" },
          branch_true: "s4",
          branch_false: "s5",
        },
        {
          id: "s4",
          type: "add_tag",
          label: "Marcar como reengajado",
          config: { tag: "reengajado" },
        },
        {
          id: "s5",
          type: "message",
          label: "Mensagem de encerramento",
          config: { text: "Qualquer hora que precisar, estou por aqui! 🙌" },
        },
      ],
    },
  },

  // 2 ── Boas-vindas & Onboarding
  {
    id: "boas-vindas-onboarding",
    name: "Boas-vindas & Onboarding",
    description: "Receba novos contatos com opções claras e direcione cada um para o caminho certo: produtos, suporte ou humano.",
    category: "acquisition",
    icon: "🚀",
    color: "#3b82f6",
    trigger_type: "first_message",
    trigger_label: "Primeira mensagem",
    channels: ["WhatsApp", "Instagram"],
    steps_count: 5,
    estimated_time: "~1m",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "buttons",
          label: "Menu de boas-vindas",
          is_start_step: true,
          config: {
            text: "Olá! Seja bem-vindo(a)! 👋\n\nComo posso te ajudar hoje?",
            buttons: [
              { id: "produto",  text: "Ver Produtos"       },
              { id: "suporte",  text: "Suporte"            },
              { id: "falar",    text: "Falar com Humano"   },
            ],
          },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "wait",
          label: "Aguardar seleção",
          config: { duration: "1s" },
          next_step_id: "s3",
        },
        {
          id: "s3",
          type: "condition",
          label: "Selecionou produto?",
          config: { variable: "{{last_input}}", operator: "eq", value: "produto" },
          branch_true: "s4",
          branch_false: "s5",
        },
        {
          id: "s4",
          type: "message",
          label: "Enviar catálogo",
          config: { text: "Ótimo! Acesse nosso catálogo: {{catalog_url}} 🛍️" },
        },
        {
          id: "s5",
          type: "handoff",
          label: "Transferir para equipe",
          config: { message: "Transferindo para nossa equipe... 👥" },
        },
      ],
    },
  },

  // 3 ── Aniversariantes
  {
    id: "aniversariantes",
    name: "Aniversariantes",
    description: "Surpreenda clientes no aniversário com uma mensagem especial e um cupom exclusivo gerado automaticamente.",
    category: "engagement",
    icon: "🎂",
    color: "#ec4899",
    trigger_type: "contact_birthday",
    trigger_label: "Aniversário",
    channels: ["WhatsApp"],
    steps_count: 3,
    estimated_time: "~30m",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "message",
          label: "Parabéns + cupom",
          is_start_step: true,
          config: {
            text: "🎉 Parabéns, {{name}}! Muitas felicidades no seu dia especial!\n\nComo presente, preparamos um cupom exclusivo para você: ANIV{{id_short}}",
          },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "wait",
          label: "Aguardar 30 min",
          config: { duration: "30m" },
          next_step_id: "s3",
        },
        {
          id: "s3",
          type: "message",
          label: "Lembrete do cupom",
          config: { text: "Seu cupom é válido por 7 dias! Aproveite 🎁" },
        },
      ],
    },
  },

  // 4 ── Solicitação de Indicação
  {
    id: "solicitacao-indicacao",
    name: "Solicitação de Indicação",
    description: "Ative clientes VIP para indicarem conhecidos e recompense automaticamente quem participar.",
    category: "retention",
    icon: "🤝",
    color: "#10b981",
    trigger_type: "contact_tag_added",
    trigger_label: "Tag: cliente-vip",
    channels: ["WhatsApp"],
    steps_count: 6,
    estimated_time: "~1d",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "wait",
          label: "Aguardar 1 dia",
          is_start_step: true,
          config: { duration: "1d" },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "message",
          label: "Pedido de indicação",
          config: {
            text: "Olá {{name}}! 🌟\n\nVocê é um dos nossos clientes mais especiais. Conhece alguém que também poderia se beneficiar dos nossos serviços?",
          },
          next_step_id: "s3",
        },
        {
          id: "s3",
          type: "input",
          label: "Capturar nome do indicado",
          config: {
            text: "Como se chama essa pessoa? (ou responda 'não' se preferir)",
            variable_name: "indicado",
          },
          next_step_id: "s4",
        },
        {
          id: "s4",
          type: "condition",
          label: "Forneceu indicação?",
          config: { variable: "{{indicado}}", operator: "neq", value: "não" },
          branch_true: "s5",
          branch_false: "s6",
        },
        {
          id: "s5",
          type: "add_tag",
          label: "Tag: indicou",
          config: { tag: "indicou" },
          next_step_id: "s5b",
        },
        {
          id: "s5b",
          type: "message",
          label: "Confirmar indicação",
          config: {
            text: "Incrível! Vou entrar em contato com {{indicado}}. Você ganhou um benefício exclusivo! 🎁",
          },
        },
        {
          id: "s6",
          type: "message",
          label: "Resposta negativa",
          config: { text: "Sem problemas! Se mudar de ideia, é só chamar. 😊" },
        },
      ],
    },
  },

  // 5 ── Atendimento Multi-canal
  {
    id: "atendimento-multicanal",
    name: "Atendimento Multi-canal",
    description: "Confirme o recebimento, use IA para responder e escale para humano quando detectar pedido de atendimento.",
    category: "support",
    icon: "📡",
    color: "#8b5cf6",
    trigger_type: "any_message",
    trigger_label: "Qualquer mensagem",
    channels: ["WhatsApp", "Instagram", "Telegram"],
    steps_count: 5,
    estimated_time: "~30s",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "message",
          label: "Confirmação de recebimento",
          is_start_step: true,
          config: {
            text: "Olá! Recebemos sua mensagem e um de nossos atendentes entrará em contato em breve. ⏱️",
          },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "wait",
          label: "Aguardar 30s",
          config: { duration: "30s" },
          next_step_id: "s3",
        },
        {
          id: "s3",
          type: "ai_response",
          label: "Resposta da IA",
          config: {
            system_prompt: "Você é um atendente simpático. Responda de forma breve e acolhedora.",
            user_prompt: "{{last_input}}",
            send_to_user: true,
          },
          next_step_id: "s4",
        },
        {
          id: "s4",
          type: "condition",
          label: "Pediu humano?",
          config: { variable: "{{last_input}}", operator: "contains", value: "humano" },
          branch_true: "s5",
          branch_false: "s6",
        },
        {
          id: "s5",
          type: "handoff",
          label: "Transferir para humano",
          config: { message: "Transferindo para humano..." },
        },
        {
          id: "s6",
          type: "end",
          label: "Fim do fluxo",
          config: {},
        },
      ],
    },
  },

  // 6 ── Retenção Pós-compra
  {
    id: "retencao-pos-compra",
    name: "Retenção Pós-compra",
    description: "Confirme o pedido, solicite avaliação após entrega e incentive a indicação com cupom especial.",
    category: "retention",
    icon: "🛒",
    color: "#14b8a6",
    trigger_type: "webhook",
    trigger_label: "Webhook: pedido pago",
    channels: ["WhatsApp"],
    steps_count: 5,
    estimated_time: "~7d",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "message",
          label: "Confirmação do pedido",
          is_start_step: true,
          config: {
            text: "Olá {{name}}! 🎉 Pedido #{{order_id}} confirmado! Obrigado pela compra.",
          },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "wait",
          label: "Aguardar 3 dias",
          config: { duration: "3d" },
          next_step_id: "s3",
        },
        {
          id: "s3",
          type: "message",
          label: "Solicitar avaliação",
          config: {
            text: "Oi {{name}}! Seu pedido chegou? O que achou? Avalie sua experiência! ⭐",
          },
          next_step_id: "s4",
        },
        {
          id: "s4",
          type: "wait",
          label: "Aguardar 4 dias",
          config: { duration: "4d" },
          next_step_id: "s5",
        },
        {
          id: "s5",
          type: "message",
          label: "Incentivo de indicação",
          config: {
            text: "{{name}}, esperamos que tenha adorado! Que tal indicar para um amigo? Use o cupom AMIGO10 📦",
          },
        },
      ],
    },
  },

  // 7 ── Qualificação de Leads
  {
    id: "qualificacao-leads",
    name: "Qualificação de Leads",
    description: "Capture leads por palavra-chave, segmente o perfil e envie dados qualificados diretamente para o CRM.",
    category: "acquisition",
    icon: "🎯",
    color: "#f97316",
    trigger_type: "private_keyword",
    trigger_label: "Palavra-chave: interesse, preço, quero",
    channels: ["WhatsApp"],
    steps_count: 6,
    estimated_time: "~1m",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "buttons",
          label: "Menu de qualificação",
          is_start_step: true,
          config: {
            text: "Olá! Fico feliz com seu interesse 😊\n\nPara te ajudar melhor, qual é o seu perfil?",
            buttons: [
              { id: "empresa",    text: "Empresa"      },
              { id: "pessoal",    text: "Uso pessoal"  },
              { id: "revendedor", text: "Revendedor"   },
            ],
          },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "condition",
          label: "É empresa?",
          config: { variable: "{{last_input}}", operator: "eq", value: "empresa" },
          branch_true: "s3",
          branch_false: "s5",
        },
        {
          id: "s3",
          type: "set_variable",
          label: "Definir tipo B2B",
          config: { name: "lead_type", value: "B2B" },
          next_step_id: "s4",
        },
        {
          id: "s4",
          type: "http_request",
          label: "Enviar ao CRM",
          config: {
            method: "POST",
            url: "{{crm_webhook}}",
            body: '{"lead":"{{name}}","type":"B2B","channel":"{{channel}}"}',
            save_result: "crm_id",
          },
          next_step_id: "s6",
        },
        {
          id: "s5",
          type: "add_tag",
          label: "Tag: lead-pessoal",
          config: { tag: "lead-pessoal" },
          next_step_id: "s6",
        },
        {
          id: "s6",
          type: "handoff",
          label: "Conectar com especialista",
          config: { message: "Conectando com especialista..." },
        },
      ],
    },
  },

  // 8 ── Lembretes de Pagamento
  {
    id: "lembretes-pagamento",
    name: "Lembretes de Pagamento",
    description: "Notifique vencimentos, confirme pagamentos automaticamente e escale cobranças em atraso.",
    category: "support",
    icon: "💳",
    color: "#ef4444",
    trigger_type: "webhook",
    trigger_label: "Webhook: vencimento",
    channels: ["WhatsApp"],
    steps_count: 6,
    estimated_time: "~2d",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "message",
          label: "Lembrete de vencimento",
          is_start_step: true,
          config: {
            text: "⚠️ Lembrete: Seu pagamento de {{amount}} vence em {{due_date}}. Clique aqui para pagar: {{payment_link}}",
          },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "wait",
          label: "Aguardar 1 dia",
          config: { duration: "1d" },
          next_step_id: "s3",
        },
        {
          id: "s3",
          type: "condition",
          label: "Pagamento confirmado?",
          config: { variable: "{{payment_paid}}", operator: "eq", value: "true" },
          branch_true: "s4",
          branch_false: "s5",
        },
        {
          id: "s4",
          type: "message",
          label: "Confirmação de pagamento",
          config: { text: "✅ Pagamento confirmado! Obrigado, {{name}}!" },
        },
        {
          id: "s5",
          type: "message",
          label: "Aviso de vencimento hoje",
          config: {
            text: "🔔 {{name}}, seu pagamento vence hoje! Evite juros: {{payment_link}}",
          },
          next_step_id: "s6",
        },
        {
          id: "s6",
          type: "wait",
          label: "Aguardar mais 1 dia",
          config: { duration: "1d" },
          next_step_id: "s7",
        },
        {
          id: "s7",
          type: "message",
          label: "Cobrança em atraso",
          config: {
            text: "⛔ {{name}}, pagamento vencido. Entre em contato para negociar: {{contact_link}}",
          },
        },
      ],
    },
  },

  // 9 ── Jornada de Fidelização
  {
    id: "jornada-fidelizacao",
    name: "Jornada de Fidelização",
    description: "Apresente o clube VIP, deixe o cliente escolher seus benefícios e registre a preferência para futuras ações.",
    category: "retention",
    icon: "👑",
    color: "#a855f7",
    trigger_type: "contact_tag_added",
    trigger_label: "Tag: cliente-fiel",
    channels: ["WhatsApp"],
    steps_count: 5,
    estimated_time: "~2d",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "message",
          label: "Boas-vindas VIP",
          is_start_step: true,
          config: {
            text: "{{name}}, você faz parte do nosso clube VIP! 👑\n\nBenefícios exclusivos:\n✅ Desconto de 15%\n✅ Atendimento prioritário\n✅ Brindes especiais",
          },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "wait",
          label: "Aguardar 2 dias",
          config: { duration: "2d" },
          next_step_id: "s3",
        },
        {
          id: "s3",
          type: "buttons",
          label: "Escolha de benefício",
          config: {
            text: "Como prefere receber seus benefícios?",
            buttons: [
              { id: "desconto", text: "Cupom de Desconto"  },
              { id: "brinde",   text: "Brinde na Compra"   },
              { id: "ambos",    text: "Os dois! 😄"        },
            ],
          },
          next_step_id: "s4",
        },
        {
          id: "s4",
          type: "set_variable",
          label: "Salvar preferência",
          config: { name: "fidelidade_pref", value: "{{last_input}}" },
          next_step_id: "s5",
        },
        {
          id: "s5",
          type: "add_tag",
          label: "Tag: vip-ativo",
          config: { tag: "vip-ativo" },
        },
      ],
    },
  },

  // 10 ── Suporte com IA
  {
    id: "suporte-ia",
    name: "Suporte com IA",
    description: "Resolva dúvidas automaticamente com IA e transfira para humano apenas quando necessário.",
    category: "support",
    icon: "🤖",
    color: "#06b6d4",
    trigger_type: "any_message",
    trigger_label: "Qualquer mensagem",
    channels: ["WhatsApp", "Instagram"],
    steps_count: 5,
    estimated_time: "~5m",
    flow: {
      start_step: "s1",
      steps: [
        {
          id: "s1",
          type: "ai_response",
          label: "Resposta automática com IA",
          is_start_step: true,
          config: {
            system_prompt:
              "Você é um assistente de suporte amigável. Responda perguntas sobre produtos/serviços. Se não souber, peça para falar com humano.",
            user_prompt: "{{last_input}}",
            send_to_user: true,
            variable_name: "ai_resp",
          },
          next_step_id: "s2",
        },
        {
          id: "s2",
          type: "condition",
          label: "IA sugeriu humano?",
          config: { variable: "{{ai_resp}}", operator: "contains", value: "humano" },
          branch_true: "s3",
          branch_false: "s4",
        },
        {
          id: "s3",
          type: "handoff",
          label: "Transferir para especialista",
          config: { message: "Conectando com atendente especializado..." },
        },
        {
          id: "s4",
          type: "wait",
          label: "Aguardar 5 min",
          config: { duration: "5m" },
          next_step_id: "s5",
        },
        {
          id: "s5",
          type: "message",
          label: "Follow-up pós-IA",
          config: { text: "Ficou com alguma dúvida? Pode perguntar! 😊" },
        },
      ],
    },
  },
];

// ─── Channel badge ────────────────────────────────────────────────────────────

function ChannelBadge({ channel }: { channel: string }) {
  const colors: Record<string, string> = {
    WhatsApp:  "rgba(37,211,102,0.15)",
    Instagram: "rgba(225,48,108,0.15)",
    Telegram:  "rgba(41,182,246,0.15)",
  };
  const text: Record<string, string> = {
    WhatsApp:  "#25d366",
    Instagram: "#e1306c",
    Telegram:  "#29b6f6",
  };
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
      style={{
        background: colors[channel] ?? "rgba(255,255,255,0.08)",
        color:      text[channel]   ?? "rgba(255,255,255,0.6)",
        border:     `1px solid ${text[channel] ?? "rgba(255,255,255,0.12)"}22`,
      }}
    >
      {channel}
    </span>
  );
}

// ─── Template card ────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  creating,
  onUse,
}: {
  template: BuiltinTemplate;
  creating: string | null;
  onUse: (t: BuiltinTemplate) => void;
}) {
  const isLoading = creating === template.id;
  const catColor   = CATEGORY_CONFIG[template.category].color;

  return (
    <div
      className="relative flex flex-col rounded-xl overflow-hidden transition-all duration-200"
      style={{
        background:   "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
        border:       "1px solid rgba(255,255,255,0.10)",
        borderLeft:   `4px solid ${template.color}`,
        backdropFilter: "blur(12px)",
        transform:    "translateY(0)",
      }}
      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-2px)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "translateY(0)")}
    >
      {/* Ambient orb */}
      <div
        className="absolute top-0 right-0 w-24 h-24 rounded-full pointer-events-none"
        style={{
          background:   `radial-gradient(circle, ${template.color}18 0%, transparent 70%)`,
          transform:    "translate(30%, -30%)",
        }}
      />

      <div className="relative flex flex-col flex-1 p-4 gap-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span
              className="text-base w-7 h-7 flex items-center justify-center rounded-md flex-shrink-0"
              style={{ background: `${template.color}22` }}
            >
              {template.icon}
            </span>
            <span
              className="font-semibold text-sm leading-tight truncate"
              style={{ color: "rgba(255,255,255,0.92)" }}
            >
              {template.name}
            </span>
          </div>
          <span
            className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
            style={{
              background: `${catColor}18`,
              color:       catColor,
              border:     `1px solid ${catColor}28`,
            }}
          >
            {CATEGORY_CONFIG[template.category].label}
          </span>
        </div>

        {/* Channels */}
        <div className="flex flex-wrap gap-1">
          {template.channels.map(ch => (
            <ChannelBadge key={ch} channel={ch} />
          ))}
        </div>

        {/* Description */}
        <p
          className="text-xs leading-relaxed line-clamp-2"
          style={{ color: "rgba(255,255,255,0.50)" }}
        >
          {template.description}
        </p>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-[11px]" style={{ color: "rgba(255,255,255,0.35)" }}>
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {template.trigger_label}
          </span>
          <span className="flex items-center gap-1">
            <Layers className="w-3 h-3" />
            {template.steps_count} etapas
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {template.estimated_time}
          </span>
        </div>

        {/* CTA */}
        <button
          onClick={() => onUse(template)}
          disabled={!!creating}
          className="mt-auto w-full py-2 rounded-lg text-xs font-semibold transition-all duration-150 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: isLoading
              ? `${template.color}22`
              : `linear-gradient(135deg, ${template.color}33 0%, ${template.color}1a 100%)`,
            color:  template.color,
            border: `1px solid ${template.color}44`,
          }}
          onMouseEnter={e => {
            if (!creating) {
              (e.currentTarget as HTMLButtonElement).style.background =
                `linear-gradient(135deg, ${template.color}55 0%, ${template.color}33 100%)`;
            }
          }}
          onMouseLeave={e => {
            if (!creating) {
              (e.currentTarget as HTMLButtonElement).style.background =
                `linear-gradient(135deg, ${template.color}33 0%, ${template.color}1a 100%)`;
            }
          }}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Criando jornada...
            </>
          ) : (
            "Usar template"
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

export function TemplatesDialog({ onClose, instanceId }: TemplatesDialogProps) {
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [search, setSearch]                 = useState("");
  const [creating, setCreating]             = useState<string | null>(null);

  const filtered = BUILTIN_TEMPLATES.filter(t => {
    const matchCat    = activeCategory === "all" || t.category === activeCategory;
    const q           = search.toLowerCase().trim();
    const matchSearch = !q ||
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.channels.some(c => c.toLowerCase().includes(q)) ||
      t.trigger_label.toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const createFromTemplate = async (template: BuiltinTemplate) => {
    setCreating(template.id);
    try {
      // Try server-side template first
      try {
        const r = await journeysApi.createFromTemplate(template.id, instanceId, template.name);
        const id = r.data?.id;
        if (id) {
          toast.success("Jornada criada a partir do template");
          window.location.href = `/journeys/${id}`;
          return;
        }
      } catch {
        // fall through to local creation
      }

      // Fallback: create blank + apply flow + set trigger
      const r  = await journeysApi.createBlank({ name: template.name, instance_id: instanceId });
      const id = r.data?.id;
      if (!id) throw new Error("ID ausente na resposta");

      await journeysApi.updateFlow(id, template.flow);
      await journeysApi.updateTrigger(id, {
        name:         template.name,
        trigger_type: template.trigger_type,
      });

      toast.success("Jornada criada a partir do template");
      window.location.href = `/journeys/${id}`;
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Falha ao criar jornada");
    } finally {
      setCreating(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)" }}
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        className="relative w-full max-w-4xl rounded-2xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
        style={{
          background:     "linear-gradient(135deg, rgba(12,12,22,0.97) 0%, rgba(8,8,16,0.99) 100%)",
          border:         "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(24px)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between px-5 pt-5 pb-4"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div>
            <h2 className="text-base font-semibold" style={{ color: "rgba(255,255,255,0.92)" }}>
              Biblioteca de Templates
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.40)" }}>
              Comece com um fluxo pronto. Personalize no canvas depois.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition-colors"
            style={{ color: "rgba(255,255,255,0.35)" }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.75)")}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.35)")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search + filters */}
        <div
          className="px-5 py-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          {/* Search */}
          <div className="relative flex-1 w-full sm:max-w-xs">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
              style={{ color: "rgba(255,255,255,0.30)" }}
            />
            <input
              type="text"
              placeholder="Buscar templates..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg outline-none transition-all"
              style={{
                background:   "rgba(255,255,255,0.05)",
                border:       "1px solid rgba(255,255,255,0.10)",
                color:        "rgba(255,255,255,0.85)",
              }}
              onFocus={e => ((e.target as HTMLInputElement).style.borderColor = "rgba(0,212,106,0.45)")}
              onBlur={e  => ((e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.10)")}
            />
          </div>

          {/* Category tabs */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {CATEGORY_TABS.map(tab => {
              const isActive = activeCategory === tab.value;
              const color =
                tab.value === "all"
                  ? "#00d46a"
                  : CATEGORY_CONFIG[tab.value as Exclude<Category, "all">].color;
              return (
                <button
                  key={tab.value}
                  onClick={() => setActiveCategory(tab.value)}
                  className="px-3 py-1 rounded-full text-xs font-medium transition-all duration-150"
                  style={{
                    background: isActive ? `${color}22` : "rgba(255,255,255,0.04)",
                    color:      isActive ? color         : "rgba(255,255,255,0.45)",
                    border:     isActive
                      ? `1px solid ${color}44`
                      : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {filtered.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center py-16 gap-2"
              style={{ color: "rgba(255,255,255,0.25)" }}
            >
              <Search className="w-8 h-8 opacity-40" />
              <p className="text-sm">Nenhum template encontrado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 gap-3">
              {filtered.map(t => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  creating={creating}
                  onUse={createFromTemplate}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3 flex items-center justify-between"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          <p className="text-[11px]" style={{ color: "rgba(255,255,255,0.25)" }}>
            {BUILTIN_TEMPLATES.length} templates disponíveis
          </p>
          <button
            onClick={onClose}
            className="text-xs px-4 py-1.5 rounded-lg transition-all"
            style={{
              background: "rgba(255,255,255,0.06)",
              color:      "rgba(255,255,255,0.50)",
              border:     "1px solid rgba(255,255,255,0.10)",
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
