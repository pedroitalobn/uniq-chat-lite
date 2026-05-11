"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertTriangle } from "lucide-react";

// ConfirmDialog — substitui confirm() nativo do browser por modal alinhado
// ao tema dark do uniq.chat. Use via state local: { confirm, setConfirm }.
//
//   const [confirmDel, setConfirmDel] = useState<{ id: string; name: string } | null>(null);
//   ... onClick={() => setConfirmDel({ id: q.id, name: q.name })} ...
//   {confirmDel && <ConfirmDialog title="Excluir fila" body={`"${confirmDel.name}" será removida.`} onConfirm={() => { remove.mutate(confirmDel.id); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />}
export function ConfirmDialog({
  title, body, confirmLabel = "Confirmar", cancelLabel = "Cancelar",
  variant = "default", onConfirm, onCancel, isPending,
}: {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
  isPending?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm]);

  const bg = variant === "danger" ? "#ef4444" : "#00d46a";
  const fg = variant === "danger" ? "white" : "#03170a";

  return (
    <AnimatePresence>
      <motion.div
        key="confirm-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[160] flex items-center justify-center"
        style={{
          background: "rgba(0,0,0,0.70)",
          backdropFilter: "blur(8px) saturate(150%)",
          WebkitBackdropFilter: "blur(8px) saturate(150%)",
        }}
        onClick={onCancel}
      >
        <motion.div
          key="confirm-modal"
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 4 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm"
          style={{
            background: "linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 50%, rgba(0,0,0,0.10) 100%)",
            backdropFilter: "blur(32px) saturate(200%) brightness(1.1)",
            WebkitBackdropFilter: "blur(32px) saturate(200%) brightness(1.1)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "20px",
            boxShadow: "0 40px 80px rgba(0,0,0,0.70), 0 16px 32px rgba(0,0,0,0.50), 0 4px 8px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -1px 0 rgba(0,0,0,0.20)",
            overflow: "hidden",
            position: "relative",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Top light line */}
          <div style={{
            position: "absolute",
            top: 0,
            left: "20%",
            right: "20%",
            height: "1px",
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.30), transparent)",
            pointerEvents: "none",
          }} />

          {/* Ambient orb — color shifts for danger variant */}
          <div style={{
            position: "absolute",
            top: "-40px",
            right: "-40px",
            width: "140px",
            height: "140px",
            borderRadius: "50%",
            background: variant === "danger"
              ? "radial-gradient(circle, rgba(239,68,68,0.18) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(0,212,106,0.15) 0%, transparent 70%)",
            filter: "blur(30px)",
            pointerEvents: "none",
          }} />

          <div className="flex items-start gap-3 px-5 py-4">
            {variant === "danger" && (
              <div
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
                style={{
                  background: "rgba(239,68,68,0.12)",
                  border: "1px solid rgba(239,68,68,0.25)",
                }}
              >
                <AlertTriangle className="h-4 w-4" style={{ color: "#ef4444" }} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
                {title}
              </div>
              {body && (
                <div className="mt-1 text-xs" style={{ color: "var(--text-2)" }}>
                  {body}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md p-1 hover:bg-white/10"
              style={{ color: "var(--text-3)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div
            className="flex items-center justify-end gap-2 px-5 py-3"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-3 py-1.5 text-xs transition-colors hover:bg-white/8"
              style={{ color: "hsl(240 8% 70%)" }}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isPending}
              className="rounded-md px-4 py-1.5 text-xs font-medium disabled:opacity-50 transition-opacity"
              style={{ background: bg, color: fg }}
            >
              {isPending ? "Processando…" : confirmLabel}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
