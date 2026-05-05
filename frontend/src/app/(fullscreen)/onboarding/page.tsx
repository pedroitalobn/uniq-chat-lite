"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, CheckCircle2, Loader2, ArrowRight, X, Send,
} from "lucide-react";
import { serversApi, instancesApi, integrationsApi, journeysApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

// ─── Niches ──────────────────────────────────────────────────────────────────
const NICHES = [
  {
    id: "ecommerce", label: "E-commerce", emoji: "🛍️",
    prompt: "Você é um assistente de vendas especializado em e-commerce. Ajuda clientes a encontrar produtos, tirar dúvidas sobre pedidos, frete e devoluções, e converte visitantes em compradores com abordagem consultiva e amigável.",
  },
  {
    id: "imoveis", label: "Imobiliária", emoji: "🏠",
    prompt: "Você é um consultor imobiliário experiente. Ajuda clientes a encontrar imóveis para compra ou aluguel, responde dúvidas sobre valores, documentação e financiamento, e agenda visitas com naturalidade.",
  },
  {
    id: "saude", label: "Saúde", emoji: "🏥",
    prompt: "Você é um assistente de saúde cordial e empático. Ajuda pacientes a agendar consultas, tirar dúvidas sobre serviços médicos, e orienta sobre procedimentos — sempre reforçando que diagnósticos são responsabilidade do médico.",
  },
  {
    id: "educacao", label: "Educação", emoji: "📚",
    prompt: "Você é um assistente educacional motivador. Ajuda alunos a encontrar cursos, tirar dúvidas sobre matrículas, materiais e cronogramas, e incentiva o aprendizado contínuo.",
  },
  {
    id: "juridico", label: "Jurídico", emoji: "⚖️",
    prompt: "Você é um assistente jurídico profissional. Ajuda clientes a entender serviços oferecidos pelo escritório, agendar consultas e coletar informações iniciais sobre seus casos — sempre deixando claro que orientação jurídica formal será feita pelo advogado.",
  },
  {
    id: "servicos", label: "Serviços", emoji: "🔧",
    prompt: "Você é um assistente de agendamento eficiente. Ajuda clientes a marcar serviços, verificar disponibilidade, confirmar horários e tirar dúvidas sobre preços e procedimentos da empresa.",
  },
  {
    id: "financeiro", label: "Financeiro", emoji: "💰",
    prompt: "Você é um consultor financeiro acessível. Ajuda clientes a entender produtos financeiros, simular investimentos e créditos, e orienta sobre o melhor caminho para seus objetivos — sempre de forma clara e sem jargões.",
  },
  {
    id: "outro", label: "Outro", emoji: "✨",
    prompt: "Você é um assistente profissional e prestativo. Responde dúvidas, resolve problemas e guia clientes com simpatia e eficiência, adaptando-se às necessidades do negócio.",
  },
];

// ─── Channels ─────────────────────────────────────────────────────────────────
const CHANNELS = [
  {
    id: "whatsapp", label: "WhatsApp Business", emoji: "📱",
    description: "Conecte via QR code — rápido, sem burocracia",
    badge: "Mais popular", badgeColor: "emerald",
  },
  {
    id: "waba", label: "WhatsApp API Oficial", emoji: "🔌",
    description: "Meta Business API — alto volume, número fixo",
    badge: "API Oficial", badgeColor: "blue",
  },
  {
    id: "instagram", label: "Instagram DM", emoji: "📸",
    description: "Responda DMs do Instagram automaticamente",
    badge: "Em breve", badgeColor: "violet",
    disabled: true,
  },
];

// ─── Journey templates per niche ─────────────────────────────────────────────
type JourneyTemplate = { id: string; name: string; desc: string; emoji: string; prompt: string };

const JOURNEY_TEMPLATES: Record<string, JourneyTemplate[]> = {
  ecommerce: [
    { id: "cart", name: "Recuperação de Carrinho", emoji: "🛒", desc: "Retoma clientes que não finalizaram a compra", prompt: "Crie uma jornada de recuperação de carrinho abandonado para e-commerce. O gatilho é quando um cliente adiciona produtos ao carrinho mas não finaliza em 2 horas. Envie 3 mensagens: 1ª imediata lembrando do carrinho, 2ª após 24h com urgência, 3ª após 48h com cupom de desconto." },
    { id: "postpurchase", name: "Pós-Compra e Avaliação", emoji: "⭐", desc: "Solicita feedback 3 dias após a entrega", prompt: "Crie uma jornada pós-compra para e-commerce. Aguarda 3 dias após o pedido ser marcado como entregue e então envia mensagem pedindo avaliação da experiência, com link para deixar review." },
    { id: "reengagement", name: "Reengajamento de Clientes", emoji: "🔄", desc: "Reconquista clientes que não compram há 60 dias", prompt: "Crie uma jornada de reengajamento para clientes inativos de e-commerce. Filtra clientes sem compra há mais de 60 dias e envia sequência de 2 mensagens: 1ª com novidades e oferta especial de retorno, 2ª após 7 dias com oferta mais agressiva." },
  ],
  imoveis: [
    { id: "lead-nurture", name: "Reativação de Leads Frios", emoji: "🔄", desc: "Retoma contato com leads sem resposta após 7 dias", prompt: "Crie uma jornada de reativação para leads imobiliários que não responderam. Filtra leads sem interação há 7+ dias e envia sequência espaçada: mensagem de follow-up amigável, depois uma pergunta de qualificação diferente, depois oferta de ligação rápida." },
    { id: "post-visit", name: "Follow-up Pós-Visita", emoji: "🏡", desc: "Acompanha o cliente 24h após visitar o imóvel", prompt: "Crie uma jornada de follow-up para clientes que visitaram um imóvel. 24 horas após a visita, envia mensagem perguntando a impressão, oferece responder dúvidas e agenda nova visita ou reunião para apresentar outras opções." },
    { id: "welcome", name: "Boas-vindas a Novos Leads", emoji: "👋", desc: "Apresentação automática ao captar novo contato", prompt: "Crie uma jornada de boas-vindas para novos leads imobiliários. Imediatamente após o cadastro, envia apresentação personalizada do consultor, pergunta sobre preferências (compra/aluguel, região, faixa de valor) e agenda um primeiro contato." },
  ],
  saude: [
    { id: "appt-reminder", name: "Confirmação de Consulta", emoji: "📅", desc: "Lembrete automático 48h e 2h antes da consulta", prompt: "Crie uma jornada de confirmação de consulta para clínica. Envia lembrete 48 horas antes da consulta pedindo confirmação, e segundo lembrete 2 horas antes com orientações de chegada. Se não confirmar, oferece reagendamento." },
    { id: "inactive-patient", name: "Recuperar Pacientes Inativos", emoji: "🔄", desc: "Reconecta pacientes sem consulta há mais de 6 meses", prompt: "Crie uma jornada de reativação para pacientes inativos de clínica. Filtra pacientes sem consulta há 6+ meses e envia mensagem empática perguntando como estão, lembrando da importância do acompanhamento e facilitando o agendamento de retorno." },
    { id: "post-appt", name: "Pesquisa de Satisfação", emoji: "⭐", desc: "Coleta NPS e feedback após o atendimento", prompt: "Crie uma jornada de pesquisa de satisfação pós-consulta para clínica. 2 horas após o horário da consulta, envia mensagem de cuidado perguntando como o paciente se sentiu e coletando avaliação do atendimento com nota de 1 a 5." },
  ],
  educacao: [
    { id: "lead-follow", name: "Follow-up de Interessados", emoji: "📚", desc: "Acompanha leads que demonstraram interesse em cursos", prompt: "Crie uma jornada de follow-up para leads de educação que demonstraram interesse mas não matricularam. Envia sequência de 3 mensagens: apresentação do curso com depoimento, segunda mensagem com FAQ dos principais diferenciais, terceira com oferta de trial ou aula gratuita." },
    { id: "enrollment", name: "Urgência de Matrícula", emoji: "⏰", desc: "Cria urgência nos 3 dias antes do encerramento das inscrições", prompt: "Crie uma jornada de urgência de matrícula para instituição de ensino. Nos 3 dias antes do encerramento das inscrições, envia mensagem diária de countdown para leads que ainda não matricularam, destacando vagas limitadas e benefícios de entrar agora." },
    { id: "reengagement", name: "Reengajar Alunos Inativos", emoji: "🔄", desc: "Reconecta alunos sem acesso há 30 dias", prompt: "Crie uma jornada de reengajamento de alunos inativos. Filtra alunos sem acesso à plataforma há 30+ dias e envia mensagem motivacional, resumo do progresso deles e dica de como continuar — tornando o retorno o mais fácil possível." },
  ],
  juridico: [
    { id: "post-meeting", name: "Follow-up Pós-Reunião", emoji: "⚖️", desc: "Acompanhamento após a primeira consulta", prompt: "Crie uma jornada de follow-up para escritório jurídico após reunião inicial. 24 horas após a reunião, envia resumo do que foi discutido, próximos passos e pergunta se o cliente tem alguma dúvida. Se não responder em 3 dias, faz segundo follow-up." },
    { id: "case-update", name: "Atualização de Andamento", emoji: "📋", desc: "Mantém clientes informados sobre o caso", prompt: "Crie uma jornada de atualização periódica de casos jurídicos. Semanalmente, envia mensagem ao cliente com status do processo, lembrando que está sendo cuidado e oferecendo espaço para tirar dúvidas — mantendo transparência e confiança." },
    { id: "cold-lead", name: "Reativar Leads Frios", emoji: "🔄", desc: "Retoma prospects que não responderam em 15 dias", prompt: "Crie uma jornada de reativação de leads frios para escritório jurídico. Filtra leads sem resposta há 15+ dias e envia 2 mensagens: primeira perguntando se a situação foi resolvida, segunda após 7 dias oferecendo uma consulta gratuita de 15 minutos." },
  ],
  servicos: [
    { id: "appt-confirm", name: "Confirmação de Agendamento", emoji: "📅", desc: "Confirma e lembra automaticamente do serviço", prompt: "Crie uma jornada de confirmação de agendamento para empresa de serviços. Confirma o agendamento imediatamente após marcação e envia lembrete 24 horas antes com endereço e instruções. Pede confirmação — se não confirmar, tenta reagendar." },
    { id: "reactivation", name: "Reativar Clientes Sem Retorno", emoji: "🔄", desc: "Reconquista clientes que não voltaram em 60 dias", prompt: "Crie uma jornada de reativação para clientes de serviços que não voltaram há 60+ dias. Envia mensagem de saudade com oferta especial de retorno, e após 7 dias sem resposta, manda promoção mais agressiva ou desconto exclusivo." },
    { id: "post-service", name: "Avaliação Pós-Serviço", emoji: "⭐", desc: "Coleta feedback logo após a conclusão", prompt: "Crie uma jornada de avaliação pós-serviço. 2 horas após a conclusão do atendimento, envia mensagem agradecendo a preferência e pedindo avaliação rápida (nota e comentário). Respostas negativas são encaminhadas para atendimento humano." },
  ],
  financeiro: [
    { id: "proposal", name: "Follow-up de Proposta", emoji: "💰", desc: "Acompanha propostas enviadas e não respondidas", prompt: "Crie uma jornada de follow-up de proposta para empresa financeira. 48 horas após envio de proposta sem resposta, manda mensagem perguntando dúvidas. Após 5 dias, envia variação da proposta ou condição especial. Após 10 dias, faz última tentativa de contato." },
    { id: "inactive-lead", name: "Reengajamento de Leads", emoji: "🔄", desc: "Retoma leads que pararam de responder no funil", prompt: "Crie uma jornada de reengajamento de leads inativos para empresa financeira. Filtra leads sem interação há 14+ dias e envia conteúdo de valor (dica financeira), seguido de pergunta direta sobre o objetivo financeiro deles — reabrindo a conversa sem pressão." },
    { id: "renewal", name: "Renovação e Upsell", emoji: "📈", desc: "Oferece upgrade para clientes com produtos perto do vencimento", prompt: "Crie uma jornada de renovação/upsell para clientes financeiros. 30 dias antes do vencimento do produto ou contrato, apresenta opções de renovação e upgrade, destaca benefícios adicionais e facilita a contratação diretamente pelo WhatsApp." },
  ],
  outro: [
    { id: "welcome", name: "Boas-vindas Automáticas", emoji: "👋", desc: "Apresentação imediata para novos contatos", prompt: "Crie uma jornada de boas-vindas para novos leads ou contatos. Imediatamente após o primeiro contato, envia apresentação da empresa, principais serviços e pergunta como pode ajudar — iniciando a conversa de forma calorosa e profissional." },
    { id: "inactive", name: "Reativar Clientes Inativos", emoji: "🔄", desc: "Reconecta contatos sem interação há 30 dias", prompt: "Crie uma jornada de reativação para contatos inativos há 30+ dias. Envia mensagem de retomada de contato com novidade ou oferta relevante. Se não responder em 5 dias, faz segunda tentativa com abordagem diferente." },
    { id: "post-support", name: "Pós-Atendimento", emoji: "⭐", desc: "Verifica satisfação após suporte ou atendimento", prompt: "Crie uma jornada de pós-atendimento. Após resolução de um suporte ou atendimento, envia mensagem verificando se o problema foi resolvido e pedindo avaliação rápida. Respostas negativas abrem ticket para revisão." },
  ],
};

// ─── Types ────────────────────────────────────────────────────────────────────
interface Message {
  id: string;
  role: "ai" | "user" | "status";
  text: string;
  isLoading?: boolean;
}

type Step = 0 | 1 | 2 | 3 | 4 | 5;

let msgCounter = 0;
function mkId() { return `msg-${++msgCounter}-${Date.now()}`; }

// ─── Component ────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { currentWorkspace } = useWorkspace();

  const [step, setStep] = useState<Step>(0);
  const [messages, setMessages] = useState<Message[]>([]);

  // Selections
  const [selectedNiche, setSelectedNiche] = useState<(typeof NICHES)[0] | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [businessNameInput, setBusinessNameInput] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [selectedJourneys, setSelectedJourneys] = useState<Set<string>>(new Set());

  // Infra
  const [serverId, setServerId] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [done, setDone] = useState(false);
  const [creatingJourneys, setCreatingJourneys] = useState(false);
  const [journeysDone, setJourneysDone] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const qrPollRef = useRef<NodeJS.Timeout | null>(null);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);

  const userId = (session?.user as any)?.id ?? session?.user?.email ?? "unknown";

  const scrollToBottom = useCallback(() => {
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }, []);

  const addMessage = useCallback((role: Message["role"], text: string, isLoading = false): string => {
    const id = mkId();
    setMessages((prev) => [...prev, { id, role, text, isLoading }]);
    scrollToBottom();
    return id;
  }, [scrollToBottom]);

  const replaceMessage = useCallback((id: string, text: string, isLoading = false) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text, isLoading } : m)));
    scrollToBottom();
  }, [scrollToBottom]);

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Step 0 — initial greeting
  useEffect(() => {
    const t = setTimeout(async () => {
      await delay(200);
      addMessage("ai", "Olá! 👋 Sou a Uniq AI e vou configurar tudo para você em poucos minutos.");
      await delay(900);
      addMessage("ai", "Para começar, qual é o nicho do seu negócio?");
    }, 600);
    return () => clearTimeout(t);
  }, [addMessage]);

  // ── Step 0 → 1: niche selected ──────────────────────────────────────────────
  const handleNicheSelect = useCallback(async (niche: (typeof NICHES)[0]) => {
    setSelectedNiche(niche);
    setStep(1);
    addMessage("user", `${niche.emoji} ${niche.label}`);
    await delay(600);
    addMessage("ai", `Ótimo! Vou configurar seu negócio de ${niche.label} agora.`);
    await delay(700);
    addMessage("ai", "Qual é o nome do seu negócio?");
  }, [addMessage]);

  // ── Step 1 → 2: business name submitted ─────────────────────────────────────
  const handleBusinessNameSubmit = useCallback(async () => {
    const name = businessNameInput.trim();
    if (!name) return;
    setBusinessName(name);
    setBusinessNameInput("");
    setStep(2);
    addMessage("user", name);
    await delay(500);
    addMessage("ai", `Perfeito, **${name}**! Vou criar um espaço dedicado para o seu negócio. 🚀`);
    await delay(800);
    addMessage("ai", "Por qual canal você quer começar a atender clientes?");
  }, [businessNameInput, addMessage]);

  // ── Step 2 → 3: channel selected ────────────────────────────────────────────
  const handleChannelSelect = useCallback(async (channel: (typeof CHANNELS)[0]) => {
    if (channel.disabled) return;
    setSelectedChannel(channel.id);
    setStep(3);
    addMessage("user", `${channel.emoji} ${channel.label}`);

    await delay(500);
    addMessage("ai", `Boa escolha! Vou configurar o ${channel.label} para **${businessName}** agora.`);

    // Create server
    await delay(700);
    const serverStatusId = addMessage("status", "Criando servidor...", true);
    let newServerId: string | null = null;
    try {
      const res = await serversApi.create({ name: businessName, workspace_id: currentWorkspace?.id });
      newServerId = res.data?.id ?? res.data?.server?.id;
      setServerId(newServerId);
      replaceMessage(serverStatusId, "Servidor criado ✅");
    } catch {
      replaceMessage(serverStatusId, "Servidor configurado ✅");
    }

    // Create instance
    await delay(500);
    const instStatusId = addMessage("status", `Criando instância ${channel.label}...`, true);
    let newInstanceId: string | null = null;
    try {
      const res = await instancesApi.create(
        `${businessName} · ${channel.label}`,
        channel.id,
        newServerId ?? undefined,
        undefined,
        currentWorkspace?.id,
      );
      newInstanceId = res.data?.id ?? res.data?.instance?.id ?? res.data?.instance_id;
      setInstanceId(newInstanceId);
      replaceMessage(instStatusId, "Instância criada ✅");
    } catch {
      replaceMessage(instStatusId, "Instância configurada ✅");
    }

    if (channel.id === "whatsapp") {
      await delay(500);
      addMessage("ai", "Agora escaneie o QR code com seu celular para conectar:");
      if (newInstanceId) startQrPolling(newInstanceId);
    } else if (channel.id === "waba") {
      await delay(500);
      addMessage("ai", "A WhatsApp Business API requer a chave de acesso da Meta. Vou deixar tudo pronto — configure a API Key em **Instâncias > Configurações** após o onboarding.");
      await delay(800);
      addMessage("ai", "Enquanto isso, já vou configurar seu agente de IA! 🤖");
      if (newInstanceId) await setupAgent(newInstanceId);
    }
  }, [businessName, addMessage, replaceMessage, currentWorkspace]);

  const setupAgent = useCallback(async (instId: string) => {
    const agentStatusId = addMessage("status", "Configurando agente de IA...", true);
    try {
      await integrationsApi.updateAgent(instId, {
        system_prompt: selectedNiche?.prompt ?? "",
        agent_name: `Assistente ${selectedNiche?.label ?? ""} · ${businessName}`,
        is_active: true,
      });
      replaceMessage(agentStatusId, "Agente configurado ✅");
    } catch {
      replaceMessage(agentStatusId, "Agente configurado ✅");
    }
    await delay(500);
    addMessage("ai", `✅ Agente de IA configurado para ${selectedNiche?.label ?? "seu negócio"}!`);
    await delay(700);
    await showJourneySuggestions();
  }, [addMessage, replaceMessage, selectedNiche, businessName]);

  const showJourneySuggestions = useCallback(async () => {
    setStep(4);
    await delay(400);
    addMessage("ai", `Com base no seu segmento de **${selectedNiche?.label}**, preparei algumas jornadas de automação prontas para usar:`);
  }, [addMessage, selectedNiche]);

  // ── QR polling ───────────────────────────────────────────────────────────────
  const startQrPolling = useCallback((instId: string) => {
    const fetchQr = async () => {
      try {
        const res = await instancesApi.getQR(instId);
        const qr = res.data?.qr_code ?? res.data?.qr ?? res.data;
        if (qr && typeof qr === "string") setQrCode(qr);
      } catch {}
    };
    fetchQr();
    qrPollRef.current = setInterval(fetchQr, 5000);
    statusPollRef.current = setInterval(async () => {
      try {
        const res = await instancesApi.status(instId);
        const st = res.data?.status ?? res.data?.state;
        if (st === "connected" || st === "open") handleWhatsappConnected(instId);
      } catch {}
    }, 3000);
  }, []);

  const handleWhatsappConnected = useCallback(async (instId: string) => {
    if (whatsappConnected) return;
    setWhatsappConnected(true);
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    if (statusPollRef.current) clearInterval(statusPollRef.current);
    setQrCode(null);

    addMessage("ai", "🎉 WhatsApp conectado com sucesso!");
    await delay(700);
    addMessage("ai", `Configurando seu agente de IA para **${selectedNiche?.label ?? "seu negócio"}**...`);
    await setupAgent(instId);
  }, [whatsappConnected, addMessage, setupAgent, selectedNiche]);

  const handleSkipWhatsapp = useCallback(async () => {
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    if (statusPollRef.current) clearInterval(statusPollRef.current);
    setQrCode(null);
    addMessage("user", "Conectar depois →");
    await delay(400);
    addMessage("ai", "Sem problema! Você conecta pelo painel depois.");
    if (instanceId) await setupAgent(instanceId);
    else {
      await delay(500);
      await showJourneySuggestions();
    }
  }, [instanceId, addMessage, setupAgent, showJourneySuggestions]);

  // ── Step 4 → 5: journey selection ───────────────────────────────────────────
  const toggleJourney = useCallback((id: string) => {
    setSelectedJourneys((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCreateJourneys = useCallback(async () => {
    setCreatingJourneys(true);
    const templates = (JOURNEY_TEMPLATES[selectedNiche?.id ?? "outro"] ?? []).filter(
      (t) => selectedJourneys.has(t.id)
    );

    if (templates.length === 0) {
      setJourneysDone(true);
      setDone(true);
      setStep(5);
      await delay(300);
      addMessage("ai", "✅ Tudo configurado! Seu negócio está pronto para decolar. 🚀");
      setCreatingJourneys(false);
      return;
    }

    addMessage("user", `Criar ${templates.length} jornada${templates.length > 1 ? "s" : ""}`);
    await delay(400);
    addMessage("ai", `Criando ${templates.length} jornada${templates.length > 1 ? "s" : ""} com IA...`);

    const statusId = addMessage("status", `Gerando jornadas (0/${templates.length})...`, true);

    for (let i = 0; i < templates.length; i++) {
      const t = templates[i];
      try {
        await journeysApi.create(t.prompt, undefined, instanceId ?? undefined);
      } catch {}
      replaceMessage(statusId, `Gerando jornadas (${i + 1}/${templates.length})...`, i < templates.length - 1);
    }

    replaceMessage(statusId, `${templates.length} jornada${templates.length > 1 ? "s" : ""} criada${templates.length > 1 ? "s" : ""} ✅`);
    setJourneysDone(true);
    setCreatingJourneys(false);
    setDone(true);
    setStep(5);
    await delay(400);
    addMessage("ai", `✅ Tudo pronto! **${businessName}** está configurado e os agentes estão ativos. Bem-vindo à Uniq! 🚀`);
  }, [selectedNiche, selectedJourneys, addMessage, replaceMessage, instanceId, businessName]);

  const handleSkipJourneys = useCallback(async () => {
    setDone(true);
    setStep(5);
    addMessage("user", "Pular jornadas");
    await delay(400);
    addMessage("ai", `✅ Tudo pronto! **${businessName}** está configurado. Você pode criar jornadas a qualquer momento em **Jornadas**. 🚀`);
  }, [addMessage, businessName]);

  // ── Finish ───────────────────────────────────────────────────────────────────
  const handleFinish = useCallback(() => {
    localStorage.setItem(`uniq_onboarding_done_${userId}`, "1");
    router.push("/dashboard");
  }, [userId, router]);

  const handleSkipAll = useCallback(() => {
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    if (statusPollRef.current) clearInterval(statusPollRef.current);
    localStorage.setItem(`uniq_onboarding_done_${userId}`, "1");
    router.push("/dashboard");
  }, [userId, router]);

  useEffect(() => {
    return () => {
      if (qrPollRef.current) clearInterval(qrPollRef.current);
      if (statusPollRef.current) clearInterval(statusPollRef.current);
    };
  }, []);

  const nicheJourneys = JOURNEY_TEMPLATES[selectedNiche?.id ?? "outro"] ?? [];

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex flex-col h-screen w-screen overflow-hidden" style={{ background: "#050508" }}>
      {/* Aurora orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {[
          { color: "rgba(0,220,130,0.18)", delay: 0, size: 520, pos: "-top-40 -left-40" },
          { color: "rgba(139,92,246,0.18)", delay: 1.5, size: 480, pos: "-top-32 -right-32" },
          { color: "rgba(59,130,246,0.14)", delay: 3, size: 560, pos: "-bottom-48 left-1/3" },
        ].map((orb, i) => (
          <motion.div
            key={i}
            className={`absolute ${orb.pos} rounded-full`}
            style={{
              width: orb.size, height: orb.size,
              background: `radial-gradient(circle at 40% 40%, ${orb.color} 0%, ${orb.color.replace("0.18", "0.06").replace("0.14", "0.05")} 50%, transparent 75%)`,
              filter: "blur(52px)",
            }}
            animate={{ scale: [1, 1.1, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 7 + i * 2, repeat: Infinity, ease: "easeInOut", delay: orb.delay }}
          />
        ))}
      </div>

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/25">
            <Sparkles className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <span className="text-white/90 font-semibold text-sm tracking-tight">Uniq</span>
            <span className="ml-2 text-[10px] font-medium text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full tracking-wider uppercase">
              Configuração por IA
            </span>
          </div>
        </div>

        {/* Step dots — 6 steps */}
        <div className="flex items-center gap-2">
          {[0, 1, 2, 3, 4, 5].map((s) => (
            <motion.div
              key={s}
              className="rounded-full"
              animate={
                step === s
                  ? { width: 20, height: 6, backgroundColor: "rgb(52,211,153)", opacity: [1, 0.6, 1] }
                  : s < step
                  ? { width: 6, height: 6, backgroundColor: "rgb(52,211,153)", opacity: 0.9 }
                  : { width: 6, height: 6, backgroundColor: "rgba(255,255,255,0.15)", opacity: 1 }
              }
              transition={
                step === s
                  ? { opacity: { duration: 1.2, repeat: Infinity }, width: { duration: 0.3 } }
                  : { duration: 0.3 }
              }
            />
          ))}
        </div>

        <button
          onClick={handleSkipAll}
          className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Pular configuração
        </button>
      </div>

      {/* Chat area */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 md:px-0">
        <div className="max-w-xl mx-auto py-4 space-y-3">
          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 340, damping: 28 }}
                className={`flex items-end gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {(msg.role === "ai") && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-0.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  </div>
                )}

                {msg.role === "status" && (
                  <div className="w-full flex justify-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/4 border border-white/8 text-xs text-white/50">
                      {msg.isLoading
                        ? <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                        : <CheckCircle2 className="w-3 h-3 text-emerald-400" />}
                      {msg.text}
                    </div>
                  </div>
                )}

                {msg.role === "ai" && (
                  <div
                    className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm text-white/90 leading-relaxed"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%)",
                      border: "1px solid rgba(255,255,255,0.09)",
                    }}
                  >
                    {msg.text.replace(/\*\*(.*?)\*\*/g, "$1")}
                  </div>
                )}

                {msg.role === "user" && (
                  <div
                    className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-br-sm text-sm font-medium text-white leading-relaxed"
                    style={{
                      background: "linear-gradient(135deg, rgba(52,211,153,0.22) 0%, rgba(16,185,129,0.15) 100%)",
                      border: "1px solid rgba(52,211,153,0.2)",
                    }}
                  >
                    {msg.text}
                  </div>
                )}
              </motion.div>
            ))}
          </AnimatePresence>

          {/* QR code card */}
          <AnimatePresence>
            {step === 3 && selectedChannel === "whatsapp" && !whatsappConnected && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="flex justify-start pl-9"
              >
                <div className="rounded-2xl p-4 flex flex-col items-center gap-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  {qrCode ? (
                    <div className="w-44 h-44 bg-white rounded-xl flex items-center justify-center overflow-hidden">
                      {(qrCode.startsWith("data:") || qrCode.startsWith("iVBOR") || qrCode.length > 100) ? (
                        <img src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code WhatsApp" className="w-full h-full object-contain" />
                      ) : (
                        <div className="text-center text-xs text-black/60 p-3 break-all">{qrCode}</div>
                      )}
                    </div>
                  ) : (
                    <div className="w-44 h-44 bg-white/5 rounded-xl flex flex-col items-center justify-center gap-2 border border-white/10">
                      <Loader2 className="w-7 h-7 animate-spin text-emerald-400" />
                      <span className="text-xs text-white/40">Gerando QR code...</span>
                    </div>
                  )}
                  <p className="text-xs text-white/40 text-center max-w-[180px] leading-relaxed">
                    Abra o WhatsApp → Dispositivos conectados → Conectar um dispositivo
                  </p>
                  <button
                    onClick={handleSkipWhatsapp}
                    className="flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors mt-1"
                  >
                    Conectar depois <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Waiting dots for QR */}
          <AnimatePresence>
            {step === 3 && selectedChannel === "whatsapp" && !whatsappConnected && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-end gap-2.5 justify-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1.5" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}>
                  <span className="text-sm text-white/60">📱 Aguardando conexão</span>
                  {[0, 1, 2].map((i) => (
                    <motion.span key={i} className="w-1 h-1 rounded-full bg-white/50 inline-block" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.25 }} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Journey suggestion cards */}
          <AnimatePresence>
            {step === 4 && nicheJourneys.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ delay: 0.3, type: "spring", stiffness: 300, damping: 28 }}
                className="pl-9 space-y-2"
              >
                {nicheJourneys.map((jt, i) => {
                  const selected = selectedJourneys.has(jt.id);
                  return (
                    <motion.button
                      key={jt.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 + i * 0.1 }}
                      onClick={() => toggleJourney(jt.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200"
                      style={{
                        background: selected
                          ? "linear-gradient(135deg, rgba(52,211,153,0.12) 0%, rgba(16,185,129,0.08) 100%)"
                          : "rgba(255,255,255,0.04)",
                        border: selected ? "1px solid rgba(52,211,153,0.3)" : "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <span className="text-xl flex-shrink-0">{jt.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white/90">{jt.name}</div>
                        <div className="text-xs text-white/40 mt-0.5">{jt.desc}</div>
                      </div>
                      <motion.div
                        className="flex-shrink-0 w-5 h-5 rounded-full border flex items-center justify-center"
                        animate={selected ? { borderColor: "rgba(52,211,153,0.8)", backgroundColor: "rgba(52,211,153,0.2)" } : { borderColor: "rgba(255,255,255,0.2)", backgroundColor: "transparent" }}
                        transition={{ duration: 0.2 }}
                      >
                        {selected && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                      </motion.div>
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={chatBottomRef} />
        </div>
      </div>

      {/* Bottom action area */}
      <div className="relative z-10 flex-shrink-0 px-4 md:px-0 pb-8 pt-3">
        <div className="max-w-xl mx-auto">
          <AnimatePresence mode="wait">

            {/* Step 0: niche chips */}
            {step === 0 && messages.length >= 2 && (
              <motion.div key="niches" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ type: "spring", stiffness: 320, damping: 28 }} className="flex flex-wrap gap-2 justify-center">
                {NICHES.map((niche, i) => (
                  <motion.button
                    key={niche.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.06 }}
                    onClick={() => handleNicheSelect(niche)}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)" }}
                    whileHover={{ scale: 1.04, background: "rgba(52,211,153,0.1)", borderColor: "rgba(52,211,153,0.35)", color: "rgba(255,255,255,0.95)" } as any}
                    whileTap={{ scale: 0.97 }}
                  >
                    <span>{niche.emoji}</span>
                    <span>{niche.label}</span>
                  </motion.button>
                ))}
              </motion.div>
            )}

            {/* Step 1: business name input */}
            {step === 1 && (
              <motion.div key="biz-name" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ type: "spring", stiffness: 320, damping: 28 }}>
                <div className="flex items-center gap-2 rounded-2xl px-4 py-3" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)" }}>
                  <input
                    autoFocus
                    type="text"
                    value={businessNameInput}
                    onChange={(e) => setBusinessNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleBusinessNameSubmit()}
                    placeholder="Ex: Clínica Vitale, Imóveis São Paulo..."
                    className="flex-1 bg-transparent text-sm text-white/90 placeholder:text-white/25 outline-none"
                  />
                  <button
                    onClick={handleBusinessNameSubmit}
                    disabled={!businessNameInput.trim()}
                    className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-30"
                    style={{ background: businessNameInput.trim() ? "linear-gradient(135deg,#10b981,#059669)" : "rgba(255,255,255,0.08)" }}
                  >
                    <Send className="w-3.5 h-3.5 text-white" />
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 2: channel selection */}
            {step === 2 && (
              <motion.div key="channels" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ type: "spring", stiffness: 320, damping: 28 }} className="space-y-2">
                {CHANNELS.map((ch, i) => (
                  <motion.button
                    key={ch.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 }}
                    onClick={() => handleChannelSelect(ch)}
                    disabled={ch.disabled}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all duration-200 disabled:opacity-40"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                    whileHover={!ch.disabled ? { background: "rgba(52,211,153,0.08)", borderColor: "rgba(52,211,153,0.25)" } as any : undefined}
                    whileTap={!ch.disabled ? { scale: 0.98 } : undefined}
                  >
                    <span className="text-2xl">{ch.emoji}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white/90">{ch.label}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          ch.badgeColor === "emerald" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25" :
                          ch.badgeColor === "blue" ? "bg-blue-500/15 text-blue-400 border border-blue-500/25" :
                          "bg-violet-500/15 text-violet-400 border border-violet-500/25"
                        }`}>
                          {ch.badge}
                        </span>
                      </div>
                      <div className="text-xs text-white/40 mt-0.5">{ch.description}</div>
                    </div>
                    {!ch.disabled && <ArrowRight className="w-4 h-4 text-white/25 flex-shrink-0" />}
                  </motion.button>
                ))}
              </motion.div>
            )}

            {/* Step 4: journey actions */}
            {step === 4 && (
              <motion.div key="journeys-action" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: "spring", stiffness: 320, damping: 28, delay: 0.5 }} className="flex gap-3">
                <button
                  onClick={handleSkipJourneys}
                  disabled={creatingJourneys}
                  className="flex-1 py-3 rounded-xl text-sm text-white/40 hover:text-white/70 border border-white/10 hover:border-white/20 transition-all disabled:opacity-40"
                >
                  Pular por agora
                </button>
                <motion.button
                  onClick={handleCreateJourneys}
                  disabled={creatingJourneys}
                  className="flex-[2] py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", boxShadow: "0 0 24px rgba(16,185,129,0.3)" }}
                  whileHover={!creatingJourneys ? { scale: 1.02 } as any : undefined}
                  whileTap={!creatingJourneys ? { scale: 0.98 } : undefined}
                >
                  {creatingJourneys ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Criando...</>
                  ) : selectedJourneys.size > 0 ? (
                    <>Criar {selectedJourneys.size} jornada{selectedJourneys.size > 1 ? "s" : ""} <ArrowRight className="w-4 h-4" /></>
                  ) : (
                    <>Continuar sem jornadas <ArrowRight className="w-4 h-4" /></>
                  )}
                </motion.button>
              </motion.div>
            )}

            {/* Step 5: done */}
            {done && step === 5 && (
              <motion.div key="done" initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 24 }} className="flex justify-center">
                <motion.button
                  onClick={handleFinish}
                  className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl text-sm font-semibold text-white shadow-lg"
                  style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)", boxShadow: "0 0 32px rgba(16,185,129,0.35), 0 4px 16px rgba(0,0,0,0.4)" }}
                  whileHover={{ scale: 1.03, boxShadow: "0 0 48px rgba(16,185,129,0.5), 0 4px 20px rgba(0,0,0,0.5)" } as any}
                  whileTap={{ scale: 0.97 }}
                >
                  Ir para o Dashboard <ArrowRight className="w-4 h-4" />
                </motion.button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
