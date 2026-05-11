"use client";

// Ambient AI Panel — painel lateral glass que desliza da direita.
// Fica sobreposto ao conteúdo (não empurra layout). Design inspirado
// em Raycast AI, Linear AI e Vercel AI SDK demos.
//
// Acesso: ⌘K (global) ou clique na Dynamic Island.
// Fecha ao pressionar Esc, clicar no backdrop, ou chamar close().

import { AnimatePresence, motion } from "framer-motion";
import { X, Sparkles, Maximize2, ExternalLink } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { UniqAIChatPanel } from "@/features/uniq-ai/chat-panel";
import type { Message } from "@/features/uniq-ai/atoms";
import { useUniqAIIsland } from "./island-context";

const PANEL_WIDTH = 400;

// Sugestões contextuais por rota — o AI sugere ações relevantes ao que o
// usuário está vendo, sem precisar perguntar.
function getContextualSuggestions(pathname: string): { label: string; prompt: string }[] {
  if (pathname.startsWith("/inbox")) {
    return [
      { label: "Resumir conversa", prompt: "Resuma os pontos principais desta conversa" },
      { label: "Sugerir resposta", prompt: "Sugira uma resposta profissional para esta conversa" },
      { label: "Criar jornada", prompt: "Crie uma jornada de follow-up para este contato" },
    ];
  }
  if (pathname.startsWith("/crm")) {
    return [
      { label: "Analisar funil", prompt: "Analise meu funil de vendas e sugira melhorias" },
      { label: "Importar contatos", prompt: "Como posso importar contatos em massa?" },
      { label: "Criar segmento", prompt: "Crie um segmento de clientes para campanha" },
    ];
  }
  if (pathname.startsWith("/campaigns")) {
    return [
      { label: "Otimizar campanha", prompt: "Como posso melhorar minha taxa de entrega?" },
      { label: "Criar mensagem", prompt: "Crie uma mensagem de campanha persuasiva" },
      { label: "Analisar resultados", prompt: "Explique as métricas da minha campanha" },
    ];
  }
  if (pathname.startsWith("/journeys")) {
    return [
      { label: "Nova jornada", prompt: "Quero criar uma jornada de boas-vindas automática" },
      { label: "Otimizar fluxo", prompt: "Como posso melhorar minhas jornadas existentes?" },
      { label: "Jornada de vendas", prompt: "Crie uma jornada para converter leads em clientes" },
    ];
  }
  if (pathname.startsWith("/instances")) {
    return [
      { label: "Status instâncias", prompt: "Quais são minhas instâncias conectadas agora?" },
      { label: "Reconectar", prompt: "Como reconectar uma instância desconectada?" },
      { label: "Criar automação", prompt: "Configure uma automação para esta instância" },
    ];
  }
  if (pathname.startsWith("/agents")) {
    return [
      { label: "Criar agente", prompt: "Como criar um agente de atendimento automático?" },
      { label: "Treinar agente", prompt: "Como treinar meu agente com dados específicos?" },
      { label: "Integrar IA", prompt: "Conecte meu agente com uma integração de IA" },
    ];
  }
  if (pathname === "/dashboard") {
    return [
      { label: "Analisar métricas", prompt: "Analise minhas métricas e sugira melhorias" },
      { label: "Próximos passos", prompt: "Quais são as próximas ações prioritárias?" },
      { label: "Relatório diário", prompt: "Gere um resumo do dia de hoje" },
    ];
  }
  return [
    { label: "O que posso fazer?", prompt: "Me explique todas as suas funcionalidades" },
    { label: "Criar automação", prompt: "Crie uma automação para minha conta" },
    { label: "Ajuda rápida", prompt: "Como começo a usar a plataforma?" },
  ];
}

function getPageLabel(pathname: string): string {
  if (pathname.startsWith("/inbox")) return "Inbox";
  if (pathname.startsWith("/crm")) return "CRM";
  if (pathname.startsWith("/campaigns")) return "Campanhas";
  if (pathname.startsWith("/journeys")) return "Jornadas";
  if (pathname.startsWith("/instances")) return "Instâncias";
  if (pathname.startsWith("/agents")) return "Agentes";
  if (pathname.startsWith("/shops")) return "Lojas";
  if (pathname === "/dashboard") return "Dashboard";
  if (pathname.startsWith("/settings")) return "Configurações";
  return "Uniq";
}

export function AmbientAIPanel() {
  const { state, close, pageContext } = useUniqAIIsland();
  const pathname = usePathname() || "";
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const isOpen = state.mode === "expanded";

  const suggestions = getContextualSuggestions(pathname);
  const pageLabel = getPageLabel(pathname);

  const handleSuggestion = (prompt: string) => {
    const msg: Message = { id: `sug-${Date.now()}`, role: "user", content: prompt };
    setMessages([msg]);
  };

  const handleOpenFull = () => {
    close();
    router.push("/uniq-ai");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop — toque fecha, blur leve pra não distrair do conteúdo */}
          <motion.div
            key="ambient-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
            className="fixed inset-0 z-[80]"
            style={{ background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)" }}
          />

          {/* Painel lateral — desliza da direita */}
          <motion.div
            key="ambient-panel"
            initial={{ x: PANEL_WIDTH + 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: PANEL_WIDTH + 20, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 36, mass: 0.8 }}
            className="fixed top-0 right-0 bottom-0 z-[81] flex flex-col overflow-hidden"
            style={{
              width: PANEL_WIDTH,
              background: "rgba(10, 12, 16, 0.88)",
              backdropFilter: "blur(32px) saturate(200%) brightness(1.08)",
              borderLeft: "1px solid rgba(255,255,255,0.07)",
              boxShadow: "-20px 0 60px rgba(0,0,0,0.5), inset 1px 0 0 rgba(255,255,255,0.05)",
            }}
          >
            {/* Top highlight */}
            <div
              className="absolute top-0 left-0 right-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }}
            />

            {/* Ambient orb — verde suave */}
            <div
              className="absolute top-20 right-8 w-48 h-48 rounded-full pointer-events-none"
              style={{
                background: "radial-gradient(circle, rgba(0,212,106,0.07) 0%, transparent 70%)",
                filter: "blur(30px)",
              }}
            />

            {/* Header */}
            <div
              className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
              style={{ borderBottom: "1px solid var(--border-subtle)" }}
            >
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: "rgba(0,212,106,0.15)",
                  border: "1px solid rgba(0,212,106,0.3)",
                  boxShadow: "0 0 12px rgba(0,212,106,0.2)",
                }}
              >
                <Sparkles className="w-4 h-4" style={{ color: "var(--green)" }} />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white/90 leading-none">Uniq AI</p>
                <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                  Contexto: {pageContext?.label || pageLabel}
                </p>
              </div>

              <button
                onClick={handleOpenFull}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/08"
                style={{ color: "rgba(255,255,255,0.4)" }}
                title="Abrir em tela cheia"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={close}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-white/08"
                style={{ color: "rgba(255,255,255,0.4)" }}
                title="Fechar (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Sugestões contextuais — visíveis apenas quando sem mensagens */}
            {messages.length === 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
                className="px-4 pt-4 pb-2 flex-shrink-0"
              >
                <p className="text-[10px] uppercase font-semibold tracking-wider mb-2.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                  Sugestões para {pageLabel}
                </p>
                <div className="flex flex-col gap-1.5">
                  {suggestions.map((s, i) => (
                    <motion.button
                      key={s.label}
                      initial={{ opacity: 0, x: 8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 + i * 0.05 }}
                      onClick={() => handleSuggestion(s.prompt)}
                      className="text-left px-3 py-2.5 rounded-xl text-sm transition-all group flex items-center gap-2"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.06)",
                        color: "rgba(255,255,255,0.75)",
                      }}
                      whileHover={{ backgroundColor: "rgba(255,255,255,0.07)", x: 2 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-40 group-hover:opacity-70 transition-opacity" />
                      {s.label}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* Chat panel — flex-1 ocupa o restante */}
            <div className="flex-1 min-h-0">
              <UniqAIChatPanel
                compact
                hideHeader
                messages={messages}
                onMessagesChange={setMessages}
                pageContext={pageContext}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
