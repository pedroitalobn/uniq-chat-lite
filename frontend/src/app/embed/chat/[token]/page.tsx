"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

// ─── Types ──────────────────────────────────────────────────────────────────

interface WebChatPublicConfig {
  display_name: string;
  greeting: string;
  primary_color: string;
  avatar_url: string;
  whatsapp_redirect_number?: string;
  help_desk_enabled?: boolean;
  destination_type?: string;
  destination_phone?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  source?: "ai" | "human" | "queued";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Typing indicator ────────────────────────────────────────────────────────

function TypingIndicator({ color }: { color: string }) {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "8px 14px" }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            backgroundColor: color,
            opacity: 0.6,
            animation: `uniq-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`
        @keyframes uniq-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function EmbedChatPage() {
  const params = useParams();
  const token = params.token as string;

  const [config, setConfig] = useState<WebChatPublicConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => getOrCreateSessionId(token));
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Load config
  useEffect(() => {
    if (!token) return;
    fetch(`${API_URL}/v1/public/webchat/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("config_error");
        return r.json() as Promise<WebChatPublicConfig>;
      })
      .then((data) => {
        setConfig(data);
        // Greeting message
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

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

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
        body: JSON.stringify({
          session_id: sessionId,
          message: text,
          visitor_name: "Visitante",
        }),
      });

      if (!res.ok) throw new Error("send_error");

      const data = (await res.json()) as {
        reply?: string;
        source?: "ai" | "human" | "queued";
      };

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content:
          data.source === "queued"
            ? "Aguardando atendente..."
            : (data.reply ?? ""),
        timestamp: new Date(),
        source: data.source,
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: generateId(),
          role: "system",
          content: "Não foi possível enviar a mensagem. Tente novamente.",
          timestamp: new Date(),
        },
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

  const primaryColor = config?.primary_color ?? "#2563EB";
  const displayName = config?.display_name ?? "Chat";

  // Loading config state
  if (!config && !configError) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--text-1)",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            border: `3px solid ${primaryColor}`,
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "uniq-spin 0.8s linear infinite",
          }}
        />
        <style>{`@keyframes uniq-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Config error fallback
  if (configError) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          background: "var(--text-1)",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          padding: 24,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 32,
            marginBottom: 12,
            lineHeight: 1,
          }}
        >
          💬
        </div>
        <p style={{ color: "#374151", fontSize: 15, fontWeight: 600, margin: 0 }}>
          Chat indisponível
        </p>
        <p style={{ color: "#9ca3af", fontSize: 13, marginTop: 6 }}>
          Este widget não está configurado corretamente.
        </p>
      </div>
    );
  }

  // Redirect instance — show WhatsApp CTA instead of chat input
  if (config?.destination_type === "redirect_instance") {
    const phone = config.destination_phone || config.whatsapp_redirect_number || "";
    const waLink = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : "#";
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100vh",
          background: "var(--text-1)",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            background: primaryColor,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            boxShadow: `0 2px 12px ${primaryColor}60`,
          }}
        >
          <div
            style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "rgba(255,255,255,0.25)",
              border: "2px solid var(--text-3)",
              overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            {config?.avatar_url ? (
              <img src={config.avatar_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <span style={{ color: "var(--text-1)", fontSize: 16 }}>💬</span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ color: "var(--text-1)", fontWeight: 700, fontSize: 15, margin: 0, lineHeight: 1.3 }}>{displayName}</p>
            <p style={{ color: "var(--text-2)", fontSize: 11, margin: 0, lineHeight: 1.2 }}>Online</p>
          </div>
        </div>

        {/* CTA Body */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            gap: 16,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 64, height: 64, borderRadius: "50%",
              background: `${primaryColor}18`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 28,
            }}
          >
            {config?.avatar_url ? (
              <img src={config.avatar_url} alt="avatar" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <span>💬</span>
            )}
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#1f2937" }}>{displayName}</p>
            <p style={{ margin: "6px 0 0", fontSize: 14, color: "#6b7280", lineHeight: 1.5 }}>
              {config?.greeting || "Olá! Como posso ajudar?"}
            </p>
          </div>
          {phone ? (
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                padding: "12px 24px", borderRadius: 14,
                background: "#25d366", color: "#fff",
                fontSize: 14, fontWeight: 700, textDecoration: "none",
                boxShadow: "0 4px 16px rgba(37,211,102,0.35)",
                transition: "transform 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              <span style={{ fontSize: 18 }}>📱</span>
              Continuar no WhatsApp
            </a>
          ) : (
            <p style={{ fontSize: 12, color: "#9ca3af", margin: 0 }}>
              Nenhum número de telefone configurado para redirecionamento.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "var(--text-1)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: primaryColor,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
          boxShadow: `0 2px 12px ${primaryColor}60`,
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.25)",
            border: "2px solid var(--text-3)",
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
              alt="avatar"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <span style={{ color: "var(--text-1)", fontSize: 16 }}>💬</span>
          )}
        </div>

        {/* Name */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              color: "var(--text-1)",
              fontWeight: 700,
              fontSize: 15,
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            {displayName}
          </p>
          <p
            style={{
              color: "var(--text-2)",
              fontSize: 11,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            Online
          </p>
        </div>
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          const isSystem = msg.role === "system";

          if (isSystem) {
            return (
              <div
                key={msg.id}
                style={{
                  textAlign: "center",
                  fontSize: 11,
                  color: "#9ca3af",
                  padding: "4px 0",
                }}
              >
                {msg.content}
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              style={{
                display: "flex",
                justifyContent: isUser ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "78%",
                  padding: "10px 14px",
                  borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                  background: isUser ? primaryColor : "#f3f4f6",
                  color: isUser ? "var(--text-1)" : "#1f2937",
                  fontSize: 14,
                  lineHeight: 1.5,
                  wordBreak: "break-word",
                  boxShadow: isUser
                    ? `0 2px 8px ${primaryColor}40`
                    : "0 1px 4px rgba(0,0,0,0.08)",
                }}
              >
                {msg.content}
              </div>
            </div>
          );
        })}

        {/* Typing indicator */}
        {isLoading && (
          <div style={{ display: "flex", justifyContent: "flex-start" }}>
            <div
              style={{
                background: "#f3f4f6",
                borderRadius: "18px 18px 18px 4px",
                padding: "2px 4px",
              }}
            >
              <TypingIndicator color={primaryColor} />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid #e5e7eb",
          background: "var(--text-1)",
          flexShrink: 0,
        }}
      >
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
              borderRadius: 12,
              background: "#25d36618",
              border: "1px solid #25d36630",
              color: "#128c7e",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "none",
              marginBottom: 8,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 14 }}>📱</span>
            Continuar no WhatsApp
          </a>
        )}

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Digite sua mensagem..."
            disabled={isLoading}
            style={{
              flex: 1,
              padding: "10px 14px",
              borderRadius: 24,
              border: "1px solid #e5e7eb",
              background: "#f9fafb",
              fontSize: 14,
              color: "#1f2937",
              outline: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) =>
              ((e.target as HTMLInputElement).style.borderColor = primaryColor)
            }
            onBlur={(e) =>
              ((e.target as HTMLInputElement).style.borderColor = "#e5e7eb")
            }
          />

          <button
            onClick={sendMessage}
            disabled={!inputText.trim() || isLoading}
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background:
                !inputText.trim() || isLoading
                  ? "#e5e7eb"
                  : primaryColor,
              border: "none",
              cursor: !inputText.trim() || isLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              transition: "background 0.15s",
              boxShadow:
                !inputText.trim() || isLoading
                  ? "none"
                  : `0 3px 10px ${primaryColor}50`,
            }}
          >
            {isLoading ? (
              <span
                style={{
                  width: 16,
                  height: 16,
                  border: "2px solid rgba(255,255,255,0.5)",
                  borderTopColor: "white",
                  borderRadius: "50%",
                  animation: "uniq-spin 0.8s linear infinite",
                  display: "block",
                }}
              />
            ) : (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes uniq-spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>
    </div>
  );
}
