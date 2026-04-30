"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Clock, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { windowKeeperApi } from "@/lib/api";
import { toast } from "sonner";

const DEFAULT_MSG = "Olá! Só passando para confirmar que ainda estamos à disposição 😊 Pode responder quando quiser.";

interface Props {
  wsId: string;
  conversationId: string;
  enabled: boolean;
  message?: string;
  onChanged?: (enabled: boolean, message: string) => void;
}

export function WindowKeeperToggle({ wsId, conversationId, enabled, message = "", onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [localMsg, setLocalMsg] = useState(message || DEFAULT_MSG);

  const mutation = useMutation({
    mutationFn: ({ en, msg }: { en: boolean; msg: string }) =>
      windowKeeperApi.set(wsId, conversationId, en, msg),
    onSuccess: (_, vars) => {
      onChanged?.(vars.en, vars.msg);
      toast.success(vars.en ? "Lembrete de janela ativado" : "Lembrete de janela desativado");
    },
    onError: () => toast.error("Falha ao atualizar lembrete"),
  });

  const toggle = () => {
    mutation.mutate({ en: !enabled, msg: localMsg });
  };

  const saveMsg = () => {
    if (!enabled) return;
    mutation.mutate({ en: true, msg: localMsg });
  };

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--surface-border)", background: "var(--surface-2)" }}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: enabled ? "rgba(245,166,35,0.15)" : "var(--surface-3)" }}>
          <Clock className="w-3.5 h-3.5" style={{ color: enabled ? "#f5a623" : "var(--text-3)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium" style={{ color: "var(--text-1)" }}>Lembrete de janela</p>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
            {enabled ? "Ativo — envia mensagem antes da janela de 24h fechar" : "Envia lembrete automático antes dos 24h expirarem"}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {mutation.isPending && <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--text-3)" }} />}
          {/* Toggle switch */}
          <button
            onClick={toggle}
            disabled={mutation.isPending}
            className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50"
            style={{ background: enabled ? "#f5a623" : "var(--surface-border)" }}>
            <span
              className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }}
            />
          </button>
          <button
            onClick={() => setOpen(!open)}
            className="p-0.5 rounded transition-opacity hover:opacity-70"
            style={{ color: "var(--text-3)" }}>
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expandable message editor */}
      {open && (
        <div className="px-3 pb-3 pt-1 border-t" style={{ borderColor: "var(--surface-border)" }}>
          <p className="text-[10px] mb-1.5 font-medium" style={{ color: "var(--text-3)" }}>
            Mensagem enviada automaticamente às ~20h:
          </p>
          <textarea
            value={localMsg}
            onChange={e => setLocalMsg(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg px-2.5 py-2 text-xs outline-none"
            style={{
              background: "var(--surface-3)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-1)",
            }}
          />
          {enabled && (
            <button
              onClick={saveMsg}
              disabled={mutation.isPending || localMsg.trim() === (message || DEFAULT_MSG)}
              className="mt-1.5 text-[10px] font-medium px-2 py-1 rounded-md disabled:opacity-40"
              style={{ background: "var(--green)", color: "#000" }}>
              Salvar mensagem
            </button>
          )}
        </div>
      )}
    </div>
  );
}
