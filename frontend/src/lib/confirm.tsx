"use client";
import React from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle, Info } from "lucide-react";

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** true = botão vermelho (default), false = botão verde */
  danger?: boolean;
}

function ConfirmDialog({
  message,
  title,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmOptions & { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "16px",
        background: "rgba(0,0,0,0.60)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        width: "100%", maxWidth: "360px",
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        borderRadius: "18px",
        padding: "24px",
        display: "flex", flexDirection: "column", gap: "20px",
        boxShadow: "0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px var(--input)",
        animation: "confirm-pop 0.15s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        {/* Icon + text */}
        <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
          <div style={{
            width: "38px", height: "38px", borderRadius: "10px", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: danger ? "rgba(239,68,68,0.10)" : "rgba(0,212,106,0.10)",
            border: danger ? "1px solid rgba(239,68,68,0.22)" : "1px solid rgba(0,212,106,0.22)",
          }}>
            {danger
              ? <AlertTriangle style={{ width: "17px", height: "17px", color: "#f87171" }} />
              : <Info style={{ width: "17px", height: "17px", color: "var(--green)" }} />
            }
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && (
              <p style={{ fontSize: "14px", fontWeight: 600, color: "hsl(var(--card-foreground))", marginBottom: "4px", lineHeight: 1.3 }}>
                {title}
              </p>
            )}
            <p style={{ fontSize: "13px", color: "hsl(var(--muted-foreground))", lineHeight: 1.55, margin: 0 }}>
              {message}
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="btn-ghost"
            onClick={onCancel}
            style={{ flex: 1, padding: "9px 0", fontSize: "13px" }}
          >
            {cancelLabel}
          </button>
          <button
            className={danger ? "btn-danger" : "btn-primary"}
            onClick={onConfirm}
            style={{ flex: 1, padding: "9px 0", fontSize: "13px" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes confirm-pop {
          from { opacity: 0; transform: scale(0.93); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

export function showConfirm(message: string, opts?: ConfirmOptions): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    const cleanup = (result: boolean) => {
      root.unmount();
      container.remove();
      resolve(result);
    };

    root.render(
      <ConfirmDialog
        message={message}
        title={opts?.title}
        confirmLabel={opts?.confirmLabel}
        cancelLabel={opts?.cancelLabel}
        danger={opts?.danger ?? true}
        onConfirm={() => cleanup(true)}
        onCancel={() => cleanup(false)}
      />
    );
  });
}
