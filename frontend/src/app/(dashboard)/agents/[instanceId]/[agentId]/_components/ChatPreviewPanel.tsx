"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, X, MessageSquareDashed, Loader2, RefreshCw, Pencil } from "lucide-react";
import { integrationsApi } from "@/lib/api";
import type { AgentForm } from "../../../_shared/types";

type Msg = { id: string; role: "user" | "agent"; text: string; ms?: number };

// Slide-over com chat de teste do agente. Hits POST /v1/instances/:id/
// agent/preview, que chama LLM in-memory sem persistir. Mantém
// histórico local pra dar contexto multi-turno (envia até 25 turnos).
//
// Quando o form tem mudanças não salvas (dirty), o painel envia o
// objeto `override` no payload — o backend aplica essas mudanças em
// memória pra construir o system prompt, sem tocar no DB. Isso
// permite iterar identidade/objetivo/restrições e testar em segundos.
export function ChatPreviewPanel({
  instanceId,
  agentId,
  agentName,
  open,
  dirty,
  form,
  onClose,
}: {
  instanceId: string;
  agentId: string;
  agentName: string;
  open: boolean;
  dirty: boolean;
  form: AgentForm;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const realAgentId = agentId === "primary" ? undefined : agentId;

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      const history = messages.slice(-24).map((m) => ({ role: m.role, text: m.text }));
      // Sempre manda override com o form atual — assim o preview
      // reflete o que está na tela mesmo sem ter salvado. Backend
      // só usa override se os campos vierem (e vêm sempre).
      const r = await integrationsApi.previewAgent(instanceId, {
        message: text,
        history,
        agent_id: realAgentId,
        override: {
          agent_name: form.agent_name,
          identity: form.identity,
          objective: form.objective,
          communication_guidelines: form.communication_guidelines,
          service_instructions: form.service_instructions,
          restrictions: form.restrictions,
          knowledge_base: form.knowledge_base,
          system_prompt: form.system_prompt,
        },
      });
      return r.data;
    },
    onSuccess: (data, sentText) => {
      // Append user msg + agent reply na ordem; já adicionamos o
      // user no submit, então só completamos com a resposta.
      setMessages((prev) => [
        ...prev,
        {
          id: rand(),
          role: "agent",
          text: data.error ? `⚠ ${data.error}` : data.reply || "(resposta vazia)",
          ms: data.duration_ms,
        },
      ]);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.error ||
        err?.message ||
        "Erro ao chamar a LLM. Verifique se o agente tem provedor + modelo configurados.";
      setMessages((prev) => [
        ...prev,
        { id: rand(), role: "agent", text: `⚠ ${msg}` },
      ]);
    },
  });

  // Auto-scroll pro fim quando chega mensagem nova
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, sendMutation.isPending]);

  // Foca o input quando abre
  useEffect(() => {
    if (open && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 200);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = () => {
    const text = input.trim();
    if (!text || sendMutation.isPending) return;
    setMessages((prev) => [...prev, { id: rand(), role: "user", text }]);
    setInput("");
    sendMutation.mutate(text);
  };

  const reset = () => {
    setMessages([]);
    sendMutation.reset();
  };

  return (
    <>
      {/* Backdrop — só visível em mobile */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-[140]"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          onClick={onClose}
        />
      )}

      {/* Painel: full-screen drawer da direita em mobile, sticky aside em lg+ */}
      <aside
        className={`fixed inset-y-0 right-0 z-[145] flex flex-col w-full sm:w-[420px] transition-transform duration-300 ease-out`}
        style={{
          background: "var(--surface-1)",
          borderLeft: "1px solid var(--surface-border)",
          boxShadow: open ? "-8px 0 32px rgba(0,0,0,0.40)" : undefined,
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--surface-border)" }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: "linear-gradient(135deg, rgba(37, 99, 235,0.20), rgba(37, 99, 235,0.05))",
              border: "1px solid rgba(37, 99, 235,0.30)",
              color: "var(--green)",
            }}
          >
            <MessageSquareDashed className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
              Testar agente
            </p>
            <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
              {agentName} · sem persistência
            </p>
          </div>
          <button
            onClick={reset}
            className="p-1.5 rounded-lg hover:bg-white/5"
            style={{ color: "var(--text-3)" }}
            title="Limpar conversa"
            disabled={messages.length === 0}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5"
            style={{ color: "var(--text-3)" }}
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Banner azul quando há edições — agora positivo: o preview
           já aplica as mudanças não salvas. Só lembra que persistir
           ainda exige Salvar. */}
        {dirty && (
          <div
            className="flex items-start gap-2 px-4 py-2 flex-shrink-0"
            style={{
              background: "rgba(99,102,241,0.06)",
              borderBottom: "1px solid rgba(99,102,241,0.20)",
            }}
          >
            <Pencil className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "#a5b4fc" }} />
            <p className="text-[10px]" style={{ color: "#a5b4fc" }}>
              Testando com suas <b>edições não salvas</b>. Clique em Salvar quando estiver feliz com o
              resultado pra persistir.
            </p>
          </div>
        )}

        {/* Mensagens */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <MessageSquareDashed
                className="w-8 h-8 mb-2"
                style={{ color: "var(--text-4)" }}
              />
              <p className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                Mande uma mensagem pra testar
              </p>
              <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
                Sem persistência: a conversa some quando fecha. Útil pra iterar rápido.
              </p>
            </div>
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} />)
          )}
          {sendMutation.isPending && (
            <div className="flex items-center gap-2 px-3 py-2">
              <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--text-3)" }} />
              <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
                Agente pensando…
              </span>
            </div>
          )}
        </div>

        {/* Composer — safe-area-inset garante que o input não fica
           atrás do home indicator no iPhone. */}
        <div
          className="px-3 py-3 flex-shrink-0"
          style={{
            borderTop: "1px solid var(--surface-border)",
            paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
          }}
        >
          <div
            className="flex items-end gap-2 rounded-xl px-3 py-2"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Digite uma mensagem de teste…"
              className="flex-1 bg-transparent outline-none text-xs resize-none"
              style={{ color: "var(--text-1)", maxHeight: 120, minHeight: 20 }}
              rows={1}
            />
            <button
              onClick={submit}
              disabled={!input.trim() || sendMutation.isPending}
              className="p-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}
            >
              {sendMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
          <p className="text-[9px] mt-1.5 text-center" style={{ color: "var(--text-4)" }}>
            Enter envia · Shift+Enter quebra linha
          </p>
        </div>
      </aside>
    </>
  );
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[80%] rounded-xl px-3 py-2"
        style={
          isUser
            ? {
                background: "var(--green)",
                color: "var(--green-fg)",
                borderTopRightRadius: 4,
              }
            : {
                background: "var(--surface-2)",
                border: "1px solid var(--surface-border)",
                color: "var(--text-1)",
                borderTopLeftRadius: 4,
              }
        }
      >
        <p className="text-xs whitespace-pre-wrap break-words">{msg.text}</p>
        {msg.ms != null && (
          <p
            className="text-[9px] mt-1 font-mono"
            style={{ color: isUser ? "rgba(0,0,0,0.45)" : "var(--text-4)" }}
          >
            {msg.ms}ms
          </p>
        )}
      </div>
    </div>
  );
}

function rand() {
  return Math.random().toString(36).slice(2, 10);
}
