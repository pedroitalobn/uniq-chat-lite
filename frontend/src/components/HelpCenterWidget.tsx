"use client";

import { useEffect, useRef, useState } from "react";

function getApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL ?? "";
  if (env && !/localhost|127\.0\.0\.1/.test(env)) return env.replace(/\/v1\/?$/, "");
  if (typeof window !== "undefined" && window.location.hostname && !/localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    const host = window.location.hostname;
    const apiHost =
      host.startsWith("app.") || host.startsWith("admin.") || host.startsWith("dashboard.") || host.startsWith("help.")
        ? "api." + host.split(".").slice(1).join(".")
        : "api." + host;
    return `${window.location.protocol}//${apiHost}`;
  }
  return env || "https://api.uniq.chat";
}

const WORKSPACE_SLUG = "uniqchat";
const DEFAULT_COLOR = "#2563EB";

export default function HelpCenterWidget() {
  const [api] = useState(() => getApiBase());
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [hover, setHover] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    fetch(`${api}/v1/public/helpdesk/${WORKSPACE_SLUG}/config`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.widget_enabled && data?.webchat_token) {
          setToken(data.webchat_token);
          if (data.primary_color) setColor(data.primary_color);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [api]);

  if (!ready || !token) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          background: open ? "rgba(0,0,0,0.30)" : "transparent",
          pointerEvents: open ? "auto" : "none",
          zIndex: 99998,
          transition: "background 0.35s ease",
          backdropFilter: open ? "blur(2px)" : "none",
          WebkitBackdropFilter: open ? "blur(2px)" : "none",
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: "fixed",
          bottom: 92,
          right: 24,
          width: 400,
          height: 600,
          maxHeight: "calc(100vh - 120px)",
          borderRadius: 24,
          overflow: "hidden",
          background: "#0f1117",
          boxShadow: open
            ? `0 32px 80px rgba(0,0,0,0.55), 0 0 0 1px var(--border-default), 0 0 80px ${color}15`
            : "0 8px 32px rgba(0,0,0,0.20)",
          zIndex: 99999,
          opacity: open ? 1 : 0,
          transform: open ? "translateY(0) scale(1)" : "translateY(20px) scale(0.96)",
          pointerEvents: open ? "auto" : "none",
          transition: "all 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
          transformOrigin: "bottom right",
        }}
      >
        {open && token && (
          <iframe
            src={`/embed/widget/${token}`}
            style={{ width: "100%", height: "100%", border: "none" }}
            allow="microphone"
            title="Suporte Qchat"
          />
        )}
      </div>

      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        aria-label={open ? "Fechar suporte" : "Abrir suporte"}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: open ? 18 : 28,
          border: "none",
          cursor: "pointer",
          background: `linear-gradient(135deg, ${color}, ${color}dd)`,
          color: "var(--text-1)",
          zIndex: 99999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: hover
            ? `0 8px 32px ${color}50, 0 0 0 4px ${color}18`
            : `0 4px 20px ${color}40`,
          transition: "all 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: hover ? "scale(1.06)" : "scale(1)",
        }}
      >
        {/* Pulse ring */}
        {!open && (
          <span
            style={{
              position: "absolute",
              inset: -6,
              borderRadius: 34,
              border: `2px solid ${color}40`,
              animation: "widget-pulse 2s ease-out infinite",
              pointerEvents: "none",
            }}
          />
        )}

        {open ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M8 10h.01M12 10h.01M16 10h.01" strokeWidth="2.5" />
          </svg>
        )}
      </button>

      <style>{`
        @keyframes widget-pulse {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.5); opacity: 0; }
        }
      `}</style>
    </>
  );
}
