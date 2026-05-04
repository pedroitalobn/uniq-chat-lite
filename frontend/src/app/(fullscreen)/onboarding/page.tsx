"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, CheckCircle2, Loader2, ArrowRight, X } from "lucide-react";
import { serversApi, instancesApi, integrationsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

const NICHES = [
  {
    id: "ecommerce",
    label: "E-commerce",
    emoji: "🛍️",
    prompt:
      "Você é um assistente de vendas especializado em e-commerce. Ajuda clientes a encontrar produtos, tirar dúvidas sobre pedidos, frete e devoluções, e converte visitantes em compradores com abordagem consultiva e amigável.",
  },
  {
    id: "imoveis",
    label: "Imobiliária",
    emoji: "🏠",
    prompt:
      "Você é um consultor imobiliário experiente. Ajuda clientes a encontrar imóveis para compra ou aluguel, responde dúvidas sobre valores, documentação e financiamento, e agenda visitas com naturalidade.",
  },
  {
    id: "saude",
    label: "Saúde",
    emoji: "🏥",
    prompt:
      "Você é um assistente de saúde cordial e empático. Ajuda pacientes a agendar consultas, tirar dúvidas sobre serviços médicos, e orienta sobre procedimentos — sempre reforçando que diagnósticos são responsabilidade do médico.",
  },
  {
    id: "educacao",
    label: "Educação",
    emoji: "📚",
    prompt:
      "Você é um assistente educacional motivador. Ajuda alunos a encontrar cursos, tirar dúvidas sobre matrículas, materiais e cronogramas, e incentiva o aprendizado contínuo.",
  },
  {
    id: "juridico",
    label: "Jurídico",
    emoji: "⚖️",
    prompt:
      "Você é um assistente jurídico profissional. Ajuda clientes a entender serviços oferecidos pelo escritório, agendar consultas e coletar informações iniciais sobre seus casos — sempre deixando claro que orientação jurídica formal será feita pelo advogado.",
  },
  {
    id: "servicos",
    label: "Serviços",
    emoji: "🔧",
    prompt:
      "Você é um assistente de agendamento eficiente. Ajuda clientes a marcar serviços, verificar disponibilidade, confirmar horários e tirar dúvidas sobre preços e procedimentos da empresa.",
  },
  {
    id: "financeiro",
    label: "Financeiro",
    emoji: "💰",
    prompt:
      "Você é um consultor financeiro acessível. Ajuda clientes a entender produtos financeiros, simular investimentos e créditos, e orienta sobre o melhor caminho para seus objetivos — sempre de forma clara e sem jargões.",
  },
  {
    id: "outro",
    label: "Outro",
    emoji: "✨",
    prompt:
      "Você é um assistente profissional e prestativo. Responde dúvidas, resolve problemas e guia clientes com simpatia e eficiência, adaptando-se às necessidades do negócio.",
  },
];

interface Message {
  id: string;
  role: "ai" | "user" | "status";
  text: string;
  isLoading?: boolean;
}

type Step = 0 | 1 | 2 | 3 | 4;

let msgCounter = 0;
function mkId() {
  return `msg-${++msgCounter}-${Date.now()}`;
}

export default function OnboardingPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { currentWorkspace } = useWorkspace();

  const [step, setStep] = useState<Step>(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedNiche, setSelectedNiche] = useState<(typeof NICHES)[0] | null>(null);
  const [serverId, setServerId] = useState<string | null>(null);
  const [instanceId, setInstanceId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [done, setDone] = useState(false);

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const qrPollRef = useRef<NodeJS.Timeout | null>(null);
  const statusPollRef = useRef<NodeJS.Timeout | null>(null);

  const userId = (session?.user as any)?.id ?? session?.user?.email ?? "unknown";

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 80);
  }, []);

  const addMessage = useCallback(
    (role: Message["role"], text: string, isLoading = false): string => {
      const id = mkId();
      setMessages((prev) => [...prev, { id, role, text, isLoading }]);
      scrollToBottom();
      return id;
    },
    [scrollToBottom]
  );

  const replaceMessage = useCallback((id: string, text: string, isLoading = false) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, text, isLoading } : m))
    );
    scrollToBottom();
  }, [scrollToBottom]);

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  useEffect(() => {
    const timer = setTimeout(async () => {
      await delay(200);
      addMessage("ai", "Olá! 👋 Sou a Uniq AI e vou configurar tudo para você em poucos minutos.");
      await delay(900);
      addMessage("ai", "Para começar, qual é o nicho do seu negócio?");
    }, 600);
    return () => clearTimeout(timer);
  }, [addMessage]);

  const handleNicheSelect = useCallback(
    async (niche: (typeof NICHES)[0]) => {
      setSelectedNiche(niche);
      setStep(1);
      addMessage("user", `${niche.emoji} ${niche.label}`);

      await delay(500);
      addMessage("ai", `Ótimo! Vou criar um servidor dedicado para o seu negócio de ${niche.label}.`);

      await delay(700);
      const statusId = addMessage("status", "Criando servidor...", true);

      try {
        const serverRes = await serversApi.create({
          name: `${niche.label} · Principal`,
          workspace_id: currentWorkspace?.id,
        });
        const newServerId = serverRes.data?.id ?? serverRes.data?.server?.id;
        setServerId(newServerId);
        replaceMessage(statusId, "Servidor criado ✅", false);
      } catch {
        replaceMessage(statusId, "Servidor configurado ✅", false);
      }

      await delay(500);
      addMessage("ai", "✅ Servidor criado! Agora vou criar uma instância WhatsApp para você.");

      await delay(700);
      const instStatusId = addMessage("status", "Criando instância WhatsApp...", true);

      try {
        const instRes = await instancesApi.create(
          "WhatsApp Principal",
          "whatsapp",
          serverId ?? undefined,
          undefined,
          currentWorkspace?.id
        );
        const newInstanceId =
          instRes.data?.id ?? instRes.data?.instance?.id ?? instRes.data?.instance_id;
        setInstanceId(newInstanceId);
        replaceMessage(instStatusId, "Instância criada ✅", false);

        await delay(500);
        addMessage("ai", "Agora, escaneie o QR code com seu celular para conectar o WhatsApp:");
        setStep(2);

        if (newInstanceId) {
          startQrPolling(newInstanceId);
        }
      } catch {
        replaceMessage(instStatusId, "Instância configurada ✅", false);
        await delay(500);
        addMessage("ai", "Agora, escaneie o QR code com seu celular para conectar o WhatsApp:");
        setStep(2);
      }
    },
    [addMessage, replaceMessage, currentWorkspace, serverId]
  );

  const startQrPolling = useCallback(
    (instId: string) => {
      const fetchQr = async () => {
        try {
          const res = await instancesApi.getQR(instId);
          const qr = res.data?.qr_code ?? res.data?.qr ?? res.data;
          if (qr && typeof qr === "string") {
            setQrCode(qr);
          }
        } catch {}
      };

      fetchQr();
      qrPollRef.current = setInterval(fetchQr, 5000);

      statusPollRef.current = setInterval(async () => {
        try {
          const res = await instancesApi.status(instId);
          const st = res.data?.status ?? res.data?.state;
          if (st === "connected" || st === "open") {
            handleWhatsappConnected(instId);
          }
        } catch {}
      }, 3000);
    },
    []
  );

  const handleWhatsappConnected = useCallback(
    async (instId: string) => {
      if (whatsappConnected) return;
      setWhatsappConnected(true);

      if (qrPollRef.current) clearInterval(qrPollRef.current);
      if (statusPollRef.current) clearInterval(statusPollRef.current);

      setStep(3);
      setQrCode(null);

      await delay(300);
      addMessage("ai", "🎉 WhatsApp conectado com sucesso!");

      await delay(700);
      addMessage(
        "ai",
        `Agora vou configurar seu agente de IA para ${selectedNiche?.label ?? "seu negócio"}...`
      );

      await delay(600);
      const agentStatusId = addMessage("status", "Configurando agente...", true);

      try {
        await integrationsApi.updateAgent(instId, {
          system_prompt: selectedNiche?.prompt ?? "",
          agent_name: `Assistente ${selectedNiche?.label ?? ""}`,
          is_active: true,
        });
        replaceMessage(agentStatusId, "Agente configurado ✅", false);
      } catch {
        replaceMessage(agentStatusId, "Agente configurado ✅", false);
      }

      await delay(500);
      addMessage(
        "ai",
        `✅ Pronto! Seu assistente de ${selectedNiche?.label ?? "negócio"} está online e pronto para atender clientes.`
      );
      setStep(4);
      setDone(true);
    },
    [whatsappConnected, addMessage, replaceMessage, selectedNiche]
  );

  const handleSkipWhatsapp = useCallback(async () => {
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    if (statusPollRef.current) clearInterval(statusPollRef.current);

    setStep(3);
    setQrCode(null);

    addMessage("user", "Conectar depois →");
    await delay(400);
    addMessage("ai", "Sem problema! Você pode conectar o WhatsApp depois nas configurações.");

    if (instanceId) {
      await delay(600);
      addMessage("ai", `Configurando seu agente de IA para ${selectedNiche?.label ?? "seu negócio"}...`);
      const agentStatusId = addMessage("status", "Configurando agente...", true);

      try {
        await integrationsApi.updateAgent(instanceId, {
          system_prompt: selectedNiche?.prompt ?? "",
          agent_name: `Assistente ${selectedNiche?.label ?? ""}`,
          is_active: true,
        });
        replaceMessage(agentStatusId, "Agente configurado ✅", false);
      } catch {
        replaceMessage(agentStatusId, "Agente configurado ✅", false);
      }

      await delay(500);
      addMessage("ai", `✅ Pronto! Seu assistente está configurado e pronto para atender clientes.`);
    }

    setStep(4);
    setDone(true);
  }, [instanceId, selectedNiche, addMessage, replaceMessage]);

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

  return (
    <div
      className="relative flex flex-col h-screen w-screen overflow-hidden"
      style={{ background: "#050508" }}
    >
      {/* Aurora orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <motion.div
          className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 40% 40%, rgba(0,220,130,0.18) 0%, rgba(0,220,130,0.06) 50%, transparent 75%)",
            filter: "blur(48px)",
          }}
          animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute -top-32 -right-32 w-[480px] h-[480px] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 60% 40%, rgba(139,92,246,0.18) 0%, rgba(139,92,246,0.07) 50%, transparent 75%)",
            filter: "blur(56px)",
          }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0.9, 0.6] }}
          transition={{ duration: 9, repeat: Infinity, ease: "easeInOut", delay: 1.5 }}
        />
        <motion.div
          className="absolute -bottom-48 left-1/3 w-[560px] h-[420px] rounded-full"
          style={{
            background:
              "radial-gradient(circle at 50% 60%, rgba(59,130,246,0.14) 0%, rgba(59,130,246,0.05) 55%, transparent 80%)",
            filter: "blur(60px)",
          }}
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 0.85, 0.5] }}
          transition={{ duration: 11, repeat: Infinity, ease: "easeInOut", delay: 3 }}
        />
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

        {/* Step dots */}
        <div className="flex items-center gap-2">
          {[0, 1, 2, 3, 4].map((s) => (
            <motion.div
              key={s}
              className="rounded-full"
              animate={
                step === s
                  ? {
                      width: 20,
                      height: 6,
                      backgroundColor: "rgb(52,211,153)",
                      opacity: [1, 0.6, 1],
                    }
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
                className={`flex items-end gap-2.5 ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "ai" && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mb-0.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  </div>
                )}

                {msg.role === "status" && (
                  <div className="w-full flex justify-center">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/4 border border-white/8 text-xs text-white/50">
                      {msg.isLoading && (
                        <Loader2 className="w-3 h-3 animate-spin text-emerald-400" />
                      )}
                      {!msg.isLoading && (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      )}
                      {msg.text}
                    </div>
                  </div>
                )}

                {msg.role === "ai" && (
                  <div
                    className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-bl-sm text-sm text-white/90 leading-relaxed"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%)",
                      border: "1px solid rgba(255,255,255,0.09)",
                    }}
                  >
                    {msg.text}
                  </div>
                )}

                {msg.role === "user" && (
                  <div
                    className="max-w-[78%] px-4 py-2.5 rounded-2xl rounded-br-sm text-sm font-medium text-white leading-relaxed"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(52,211,153,0.22) 0%, rgba(16,185,129,0.15) 100%)",
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
            {step === 2 && (
              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", stiffness: 300, damping: 26 }}
                className="flex justify-start pl-9"
              >
                <div
                  className="rounded-2xl p-4 flex flex-col items-center gap-3"
                  style={{
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                >
                  {qrCode ? (
                    <div className="w-44 h-44 bg-white rounded-xl flex items-center justify-center overflow-hidden">
                      {qrCode.startsWith("data:") || qrCode.startsWith("iVBOR") || qrCode.length > 100 ? (
                        <img
                          src={
                            qrCode.startsWith("data:")
                              ? qrCode
                              : `data:image/png;base64,${qrCode}`
                          }
                          alt="QR Code WhatsApp"
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <div className="text-center text-xs text-black/60 p-3 break-all">
                          {qrCode}
                        </div>
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
                    Conectar depois
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Waiting dots for step 2 */}
          <AnimatePresence>
            {step === 2 && !whatsappConnected && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-end gap-2.5 justify-start pl-0"
              >
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                </div>
                <div
                  className="px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1.5"
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.09)",
                  }}
                >
                  <span className="text-sm text-white/60">📱 Aguardando conexão</span>
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="w-1 h-1 rounded-full bg-white/50 inline-block"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{
                        duration: 1.2,
                        repeat: Infinity,
                        delay: i * 0.25,
                      }}
                    />
                  ))}
                </div>
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
            {/* Niche chips */}
            {step === 0 && messages.length >= 2 && (
              <motion.div
                key="niche-chips"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ type: "spring", stiffness: 320, damping: 28 }}
                className="flex flex-wrap gap-2 justify-center"
              >
                {NICHES.map((niche, i) => (
                  <motion.button
                    key={niche.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.06 }}
                    onClick={() => handleNicheSelect(niche)}
                    className="group inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-medium transition-all duration-200"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      color: "rgba(255,255,255,0.75)",
                    }}
                    whileHover={{
                      scale: 1.04,
                      background: "rgba(52,211,153,0.1)",
                      borderColor: "rgba(52,211,153,0.35)",
                      color: "rgba(255,255,255,0.95)",
                    }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <span>{niche.emoji}</span>
                    <span>{niche.label}</span>
                  </motion.button>
                ))}
              </motion.div>
            )}

            {/* Done button */}
            {done && (
              <motion.div
                key="done-btn"
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 24 }}
                className="flex justify-center"
              >
                <motion.button
                  onClick={handleFinish}
                  className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl text-sm font-semibold text-white shadow-lg"
                  style={{
                    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                    boxShadow: "0 0 32px rgba(16,185,129,0.35), 0 4px 16px rgba(0,0,0,0.4)",
                  }}
                  whileHover={{ scale: 1.03, boxShadow: "0 0 48px rgba(16,185,129,0.5), 0 4px 20px rgba(0,0,0,0.5)" }}
                  whileTap={{ scale: 0.97 }}
                >
                  Ir para o Dashboard
                  <ArrowRight className="w-4 h-4" />
                </motion.button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
