"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

// ─── Types ──────────────────────────────────────────────────────────────────────

interface WidgetConfig {
  display_name: string;
  greeting: string;
  primary_color: string;
  avatar_url: string;
  whatsapp_redirect_number?: string;
  help_desk_enabled?: boolean;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  source?: "ai" | "human" | "queued";
}

interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string;
  category?: { id: string; name: string; icon: string };
  view_count: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function getOrCreateSessionId(token: string): string {
  const key = `uniq_wc_${token}`;
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored) as { sessionId?: string };
      if (parsed.sessionId) return parsed.sessionId;
    }
    const sessionId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : generateId();
    localStorage.setItem(key, JSON.stringify({ sessionId }));
    return sessionId;
  } catch {
    return generateId();
  }
}

const API_URL =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080")
    : "http://localhost:8080";

// ─── Typing indicator ───────────────────────────────────────────────────────────

function TypingDots({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 2px" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: color,
            animation: `dot-bounce 1.2s ease-in-out ${i * 0.18}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ─── Article card ───────────────────────────────────────────────────────────────

function ArticleCard({ article, color }: { article: Article; color: string }) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 14,
        background: "var(--input)",
        border: "1px solid var(--border-subtle)",
        cursor: "pointer",
        transition: "all 0.2s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--border-default)";
        e.currentTarget.style.borderColor = `${color}40`;
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--input)";
        e.currentTarget.style.borderColor = "var(--border-subtle)";
        e.currentTarget.style.transform = "none";
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        {article.category?.icon && (
          <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>
            {article.category.icon}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              color: "#f1f5f9",
              lineHeight: 1.4,
            }}
          >
            {article.title}
          </h4>
          {article.summary && (
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 11,
                color: "#94a3b8",
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {article.summary}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Widget Page ───────────────────────────────────────────────────────────

type Tab = "chat" | "articles";

export default function EmbedWidgetPage() {
  const params = useParams();
  const token = params.token as string;

  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => getOrCreateSessionId(token));
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Articles state
  const [articles, setArticles] = useState<Article[]>([]);
  const [articleSearch, setArticleSearch] = useState("");
  const [articlesLoading, setArticlesLoading] = useState(false);

  // ─── Load config ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/v1/public/webchat/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("config_error");
        return r.json() as Promise<WidgetConfig>;
      })
      .then((data) => {
        setConfig(data);
        if (data.greeting) {
          setMessages([
            {
              id: "greeting",
              role: "assistant",
              content: data.greeting,
              timestamp: new Date(),
              source: "ai",
            },
          ]);
        }
      })
      .catch(() => setConfigError(true));
  }, [token]);

  // ─── Load articles ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!token || !config?.help_desk_enabled) return;
    setArticlesLoading(true);
    const qs = articleSearch ? `?q=${encodeURIComponent(articleSearch)}` : "";
    fetch(`${API_URL}/v1/public/webchat/${token}/articles${qs}`)
      .then((r) => (r.ok ? (r.json() as Promise<Article[]>) : []))
      .then((data) => setArticles(data))
      .catch(() => {})
      .finally(() => setArticlesLoading(false));
  }, [token, config?.help_desk_enabled, articleSearch]);

  // ─── Scroll chat ──────────────────────────────────────────────────────────

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // ─── Send message ─────────────────────────────────────────────────────────

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputText("");
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/v1/public/webchat/${token}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, message: text, visitor_name: "Visitante" }),
      });
      if (!res.ok) throw new Error("send_error");
      const data = (await res.json()) as { reply?: string; source?: "ai" | "human" | "queued" };
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "assistant",
          content: data.source === "queued" ? "Um atendente vai responder em breve..." : (data.reply ?? ""),
          timestamp: new Date(),
          source: data.source,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: generateId(), role: "system", content: "Erro ao enviar. Tente novamente.", timestamp: new Date() },
      ]);
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ─── Derived ──────────────────────────────────────────────────────────────

  const color = config?.primary_color ?? "#00d46a";
  const name = config?.display_name ?? "Suporte";
  const showArticlesTab = config?.help_desk_enabled === true;

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (!config && !configError) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: "#0f1117",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: `2.5px solid ${color}`,
            borderTopColor: "transparent",
            animation: "spin 0.7s linear infinite",
          }}
        />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // ─── Error ────────────────────────────────────────────────────────────────

  if (configError) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          background: "#0f1117",
          color: "#94a3b8",
          fontFamily: "Inter, system-ui, sans-serif",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 10 }}>💬</div>
        <p style={{ color: "#f1f5f9", fontWeight: 600, fontSize: 14 }}>Widget indisponível</p>
        <p style={{ fontSize: 12, marginTop: 4 }}>Configuração não encontrada.</p>
      </div>
    );
  }

  // ─── Main ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "#0f1117",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        overflow: "hidden",
        color: "#f1f5f9",
      }}
    >
      <style>{`
        @keyframes dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulse-glow {
          0%, 100% { box-shadow: 0 0 0 0 ${color}40; }
          50% { box-shadow: 0 0 0 8px ${color}00; }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
      `}</style>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          background: `linear-gradient(135deg, ${color}, ${color}dd)`,
          padding: "16px 18px",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* Avatar */}
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: "var(--border-strong)",
              border: "1.5px solid var(--border-strong)",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {config?.avatar_url ? (
              <img
                src={config.avatar_url}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <span style={{ fontSize: 18 }}>💬</span>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, color: "var(--text-1)", fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>
              {name}
            </p>
            <p style={{ margin: 0, color: "var(--text-2)", fontSize: 11, lineHeight: 1.3 }}>
              Respondemos em até 1 minuto
            </p>
          </div>
        </div>

        {/* Tab pills */}
        {showArticlesTab && (
          <div
            style={{
              display: "flex",
              marginTop: 14,
              background: "rgba(0,0,0,0.18)",
              borderRadius: 12,
              padding: 3,
              gap: 2,
            }}
          >
            {(["chat", "articles"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  flex: 1,
                  padding: "8px 0",
                  border: "none",
                  borderRadius: 10,
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 12,
                  transition: "all 0.2s ease",
                  background: tab === t ? "var(--text-1)" : "transparent",
                  color: tab === t ? "#0f1117" : "var(--text-2)",
                }}
              >
                {t === "chat" ? "Conversa" : "Artigos"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── Chat Tab ─────────────────────────────────────────────────────── */}
      {tab === "chat" && (
        <>
          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {messages.map((msg) => {
              if (msg.role === "system") {
                return (
                  <div key={msg.id} style={{ textAlign: "center", fontSize: 10, color: "#64748b", padding: "4px 0" }}>
                    {msg.content}
                  </div>
                );
              }

              const isUser = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    justifyContent: isUser ? "flex-end" : "flex-start",
                    animation: "slide-up 0.25s ease",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "80%",
                      padding: "10px 14px",
                      borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                      background: isUser
                        ? `linear-gradient(135deg, ${color}, ${color}dd)`
                        : "var(--border-subtle)",
                      color: isUser ? "var(--text-1)" : "#e2e8f0",
                      fontSize: 13,
                      lineHeight: 1.55,
                      wordBreak: "break-word",
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{ background: "var(--border-subtle)", borderRadius: "18px 18px 18px 4px", padding: "8px 14px" }}>
                  <TypingDots color={color} />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* WhatsApp redirect */}
          {config?.whatsapp_redirect_number && (
            <a
              href={`https://wa.me/${config.whatsapp_redirect_number.replace(/\D/g, "")}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                padding: "8px 14px",
                margin: "0 14px",
                borderRadius: 12,
                background: "rgba(37,211,102,0.12)",
                border: "1px solid rgba(37,211,102,0.20)",
                color: "#4ade80",
                fontSize: 11,
                fontWeight: 600,
                textDecoration: "none",
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 13 }}>📱</span> Continuar no WhatsApp
            </a>
          )}

          {/* Input */}
          <div
            style={{
              padding: "10px 12px",
              borderTop: "1px solid var(--border-subtle)",
              flexShrink: 0,
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                ref={inputRef}
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escreva sua mensagem..."
                disabled={isLoading}
                style={{
                  flex: 1,
                  padding: "10px 16px",
                  borderRadius: 28,
                  border: "1px solid var(--border-default)",
                  background: "var(--input)",
                  fontSize: 13,
                  color: "#f1f5f9",
                  outline: "none",
                  transition: "border-color 0.2s",
                  fontFamily: "inherit",
                }}
                onFocus={(e) => ((e.target as HTMLInputElement).style.borderColor = `${color}80`)}
                onBlur={(e) => ((e.target as HTMLInputElement).style.borderColor = "var(--border-default)")}
              />
              <button
                onClick={sendMessage}
                disabled={!inputText.trim() || isLoading}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: "50%",
                  background: !inputText.trim() || isLoading ? "var(--border-subtle)" : color,
                  border: "none",
                  cursor: !inputText.trim() || isLoading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  transition: "all 0.15s ease",
                  boxShadow: !inputText.trim() || isLoading ? "none" : `0 4px 16px ${color}50`,
                }}
              >
                {isLoading ? (
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      border: "2px solid rgba(255,255,255,0.4)",
                      borderTopColor: "var(--text-1)",
                      borderRadius: "50%",
                      animation: "spin 0.8s linear infinite",
                      display: "block",
                    }}
                  />
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-1)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Articles Tab ─────────────────────────────────────────────────── */}
      {tab === "articles" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", animation: "fade-in 0.25s ease" }}>
          {/* Search */}
          <div style={{ padding: "12px 14px", flexShrink: 0 }}>
            <input
              type="text"
              value={articleSearch}
              onChange={(e) => setArticleSearch(e.target.value)}
              placeholder="Buscar artigos..."
              style={{
                width: "100%",
                padding: "9px 14px",
                borderRadius: 12,
                border: "1px solid var(--border-default)",
                background: "var(--input)",
                fontSize: 12,
                color: "#f1f5f9",
                outline: "none",
                fontFamily: "inherit",
                transition: "border-color 0.2s",
              }}
              onFocus={(e) => ((e.target as HTMLInputElement).style.borderColor = `${color}60`)}
              onBlur={(e) => ((e.target as HTMLInputElement).style.borderColor = "var(--border-default)")}
            />
          </div>

          {/* List */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            {articlesLoading && (
              <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", border: `2px solid ${color}`, borderTopColor: "transparent", animation: "spin 0.7s linear infinite" }} />
              </div>
            )}

            {!articlesLoading && articles.length === 0 && (
              <div style={{ textAlign: "center", padding: "32px 16px", color: "#64748b" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>📭</div>
                <p style={{ fontSize: 12, margin: 0 }}>
                  {articleSearch ? "Nenhum artigo encontrado." : "Nenhum artigo disponível."}
                </p>
              </div>
            )}

            {articles.map((a) => (
              <ArticleCard key={a.id} article={a} color={color} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
