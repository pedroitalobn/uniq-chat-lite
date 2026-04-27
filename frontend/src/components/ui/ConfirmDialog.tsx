"use client";

import { useEffect } from "react";
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
    <div
      className="fixed inset-0 z-[160] flex items-center justify-center uniq-fade-in"
      style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl shadow-2xl uniq-scale-in"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 px-5 py-4">
          {variant === "danger" && (
            <div
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
              style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)" }}
            >
              <AlertTriangle className="h-4 w-4" style={{ color: "#ef4444" }} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium" style={{ color: "hsl(240 15% 92%)" }}>
              {title}
            </div>
            {body && (
              <div className="mt-1 text-xs" style={{ color: "hsl(240 8% 65%)" }}>
                {body}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 hover:bg-white/10"
            style={{ color: "hsl(240 8% 60%)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          className="flex items-center justify-end gap-2 border-t px-5 py-3"
          style={{ borderColor: "hsl(240 12% 14%)" }}
        >
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-xs"
            style={{ color: "hsl(240 8% 70%)" }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-md px-4 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ background: bg, color: fg }}
          >
            {isPending ? "Processando…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
