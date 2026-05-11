"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import type { Instance } from "@/types";

interface NewConversationModalProps {
  open: boolean;
  onClose: () => void;
  instances: Instance[];
  onSubmit: (data: { instance_id: string; to: string; body: string }) => void;
  isPending: boolean;
}

export function NewConversationModal({
  open,
  onClose,
  instances,
  onSubmit,
  isPending,
}: NewConversationModalProps) {
  const [instanceId, setInstanceId] = useState("");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (open) {
      setInstanceId("");
      setTo("");
      setBody("");
    }
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "var(--surface-overlay)" }}>
      <div className="w-full max-w-md rounded-xl border p-5" style={{ background: "var(--surface-solid)", borderColor: "var(--border-subtle)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Nova conversa</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5">
            <X className="w-4 h-4" style={{ color: "var(--text-3)" }} />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-3)" }}>Instância</label>
            <select
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }}
            >
              <option value="">Selecione uma instância</option>
              {instances.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name} ({inst.channel})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-3)" }}>Destinatário</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="5511999999999 ou ID do contato"
              className="w-full rounded-lg px-3 py-2 text-xs outline-none"
              style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }}
            />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: "var(--text-3)" }}>Mensagem inicial</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="Digite a mensagem…"
              className="w-full rounded-lg px-3 py-2 text-xs outline-none resize-none"
              style={{ background: "var(--input)", border: "1px solid var(--border-default)", color: "var(--text-1)" }}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-2 text-xs font-medium"
              style={{ background: "var(--input)", color: "var(--text-2)" }}
            >
              Cancelar
            </button>
            <button
              onClick={() => {
                if (!instanceId || !to.trim()) {
                  toast.error("Preencha instância e destinatário");
                  return;
                }
                onSubmit({ instance_id: instanceId, to: to.trim(), body: body.trim() });
              }}
              disabled={isPending}
              className="rounded-lg px-3 py-2 text-xs font-medium"
              style={{
                background: "rgba(59,130,246,0.18)",
                border: "1px solid rgba(59,130,246,0.30)",
                color: "#93c5fd",
                opacity: isPending ? 0.6 : 1,
              }}
            >
              {isPending ? "Enviando…" : "Iniciar conversa"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
