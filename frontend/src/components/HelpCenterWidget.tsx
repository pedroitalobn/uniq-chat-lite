"use client";

import { use, useEffect, useRef, useState } from "react";

// Deriva a URL do backend — mesmo helper usado nas rotas públicas
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
const DEFAULT_COLOR = "#00d46a";

export default function HelpCenterWidget() {
  const [api] = useState(() => getApiBase());
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const fetched = useRef(false);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;

    fetch(`${api}/v1/public/helpdesk/${WORKSPACE_SLUG}/config`)
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (data?.widget_enabled && data?.webchat_token) {
          setToken(data.webchat_token);
          if (data.primary_color) setColor(data.primary_color);
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [api]);

  // Não mostra nada se o workspace não tiver chat configurado
  if (!ready || !token) return null;

  return (
    <>
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 90,
            right: 24,
            width: 400,
            height: 600,
            maxHeight: "calc(100vh - 120px)",
            borderRadius: 20,
            overflow: "hidden",
            boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
            zIndex: 99999,
            animation: "uniq-widget-fade-in 0.2s ease",
          }}
        >
          <iframe
            src={`/embed/chat/${token}`}
            style={{ width: "100%", height: "100%", border: "none" }}
            allow="microphone"
            title="Chat"
          />
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Suporte"
        aria-label={open ? "Fechar chat" : "Abrir chat"}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          background: color,
          color: "#000",
          fontSize: 22,
          fontWeight: 800,
          boxShadow: `0 4px 24px ${color}66`,
          zIndex: 99999,
          transition: "transform 0.2s",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
      >
        {open ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>
      <style>{`@keyframes uniq-widget-fade-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
    </>
  );
}
