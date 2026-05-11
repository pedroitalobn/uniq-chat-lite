"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

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

interface Config {
  title: string;
  description: string;
  primary_color: string;
  logo_url: string;
  workspace_name: string;
  theme_mode: "dark" | "light" | "system";
  font_family: string;
  hide_uniq_branding: boolean;
}

interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string;
  content: string;
  hero_image_url?: string;
  status: string;
  view_count: number;
  category_id?: string;
  category?: { id: string; name: string; icon: string };
  updated_at: string;
}

const FONT_STACKS: Record<string, string> = {
  inter: "'Inter', system-ui, -apple-system, sans-serif",
  geist: "var(--font-sans), system-ui, -apple-system, sans-serif",
  manrope: "'Manrope', system-ui, -apple-system, sans-serif",
  jetbrains: "'JetBrains Mono', monospace",
};

function ArticleAgentChat({
  slug, articleSlug, apiBase, color, t,
}: {
  slug: string;
  articleSlug: string;
  apiBase: string;
  color: string;
  t: { bg: string; surface: string; border: string; text: string; text2: string; text3: string };
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true);
    setError(false);
    setAnswer("");
    try {
      const res = await fetch(`${apiBase}/v1/public/helpdesk/${slug}/articles/${articleSlug}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const data = await res.json();
      if (data.answer) {
        setAnswer(data.answer);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 40, maxWidth: 720, marginLeft: "auto", marginRight: "auto", padding: "0 24px" }}>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          style={{
            width: "100%",
            padding: "14px 20px",
            borderRadius: 14,
            border: `1px solid ${t.border}`,
            background: t.surface,
            color: t.text2,
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; e.currentTarget.style.color = color; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = t.border; e.currentTarget.style.color = t.text2; }}
        >
          <span style={{ fontSize: 16 }}>🤖</span>
          Perguntar sobre este artigo
        </button>
      ) : (
        <div style={{ borderRadius: 16, border: `1px solid ${t.border}`, background: t.surface, overflow: "hidden" }}>
          <div style={{ padding: "16px 20px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>🤖</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: t.text }}>Assistente do artigo</span>
            </div>
            <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", color: t.text3, cursor: "pointer", fontSize: 18 }}>×</button>
          </div>

          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                placeholder="Qual a sua dúvida sobre este artigo?"
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: `1px solid ${t.border}`,
                  background: t.bg,
                  color: t.text,
                  fontSize: 14,
                  outline: "none",
                }}
              />
              <button
                onClick={ask}
                disabled={loading || !question.trim()}
                style={{
                  padding: "10px 18px",
                  borderRadius: 10,
                  border: "none",
                  background: color,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: loading || !question.trim() ? "not-allowed" : "pointer",
                  opacity: loading || !question.trim() ? 0.7 : 1,
                }}
              >
                {loading ? "..." : "Perguntar"}
              </button>
            </div>

            {answer && (
              <div style={{ padding: 14, borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, fontSize: 14, lineHeight: 1.6, color: t.text2 }}>
                {answer}
              </div>
            )}
            {error && (
              <p style={{ margin: 0, fontSize: 13, color: "#ef4444" }}>Não foi possível obter uma resposta. Tente novamente.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ArticlePage({
  params,
}: {
  params: Promise<{ slug: string; articleSlug: string }>;
}) {
  const { slug, articleSlug } = use(params);
  const [API] = useState(() => getApiBase());
  const [config, setConfig] = useState<Config | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [cfgRes, artRes] = await Promise.all([
          fetch(`${API}/v1/public/helpdesk/${slug}/config`),
          fetch(`${API}/v1/public/helpdesk/${slug}/articles/${articleSlug}`),
        ]);
        if (cfgRes.ok) setConfig(await cfgRes.json());
        if (!artRes.ok) {
          setError(artRes.status === 404 ? "Artigo não encontrado." : "Erro ao carregar artigo.");
          return;
        }
        setArticle(await artRes.json());
      } catch {
        setError("Erro de conexão.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [slug, articleSlug, API]);

  const color = config?.primary_color || "#00d46a";
  const themeMode = config?.theme_mode ?? "dark";
  const fontFamily = FONT_STACKS[config?.font_family ?? "inter"] ?? FONT_STACKS.inter;
  const hideBranding = config?.hide_uniq_branding ?? false;

  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const isDark = themeMode === "system" ? prefersDark : themeMode === "dark";
  const isLight = !isDark;

  const t = {
    bg: isLight ? "#f8fafc" : "#08090d",
    surface: isLight ? "var(--text-1)" : "var(--input)",
    border: isLight ? "rgba(0,0,0,0.06)" : "var(--border-subtle)",
    text: isLight ? "#0f172a" : "#f1f5f9",
    text2: isLight ? "#475569" : "#94a3b8",
    text3: isLight ? "#94a3b8" : "#64748b",
    glass: isLight
      ? "rgba(255,255,255,0.70)"
      : "var(--input)",
    glassBorder: isLight
      ? "rgba(0,0,0,0.06)"
      : "var(--border-subtle)",
  };

  return (
    <div style={{ background: t.bg, color: t.text, minHeight: "100vh", fontFamily }}>
      <style>{`
        @keyframes hc-fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .article-body h1, .article-body h2, .article-body h3 {
          margin-top: 36px;
          margin-bottom: 12px;
          font-weight: 600;
          line-height: 1.3;
          color: ${t.text};
        }
        .article-body h2 { font-size: 24px; letter-spacing: -0.01em; }
        .article-body h3 { font-size: 20px; }
        .article-body p {
          margin-bottom: 16px;
          font-size: 15px;
          line-height: 1.75;
          color: ${t.text2};
        }
        .article-body ul, .article-body ol {
          margin: 12px 0 16px;
          padding-left: 24px;
          color: ${t.text2};
        }
        .article-body li { margin-bottom: 6px; font-size: 15px; line-height: 1.6; }
        .article-body a {
          color: ${color};
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .article-body code {
          background: ${isLight ? "#f1f5f9" : "var(--border-subtle)"};
          padding: 2px 8px;
          border-radius: 6px;
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
        }
        .article-body pre {
          background: ${isLight ? "#f1f5f9" : "var(--input)"};
          padding: 16px 20px;
          border-radius: 14px;
          overflow-x: auto;
          margin: 20px 0;
          border: 1px solid ${t.border};
        }
        .article-body pre code {
          background: transparent;
          padding: 0;
          font-size: 13px;
        }
        .article-body img, .article-body video {
          max-width: 100%;
          border-radius: 14px;
          margin: 20px 0;
        }
        .article-body blockquote {
          border-left: 3px solid ${color};
          padding-left: 18px;
          margin: 20px 0;
          color: ${t.text2};
          font-style: italic;
        }
        .article-body table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 14px;
        }
        .article-body th, .article-body td {
          padding: 10px 14px;
          border: 1px solid ${t.border};
          text-align: left;
        }
        .article-body th {
          background: ${isLight ? "#f8fafc" : "var(--input)"};
          font-weight: 600;
        }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${t.text3}40; border-radius: 4px; }
      `}</style>

      {/* Glass header */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: t.glass,
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderBottom: `1px solid ${t.glassBorder}`,
        }}
      >
        <div
          style={{
            maxWidth: 800,
            margin: "0 auto",
            padding: "0 24px",
            height: 52,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <Link
            href={`/help/${slug}`}
            style={{
              color: t.text2,
              textDecoration: "none",
              fontSize: 13,
              fontWeight: 500,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            {config?.workspace_name || "Central"}
          </Link>
          {config?.title && (
            <span style={{ color: t.text3, fontSize: 13 }}>· {config.title}</span>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 800, margin: "0 auto", padding: "36px 24px 80px" }}>
        {loading && (
          <div style={{ padding: 60, textAlign: "center", color: t.text3 }}>
            <div
              style={{
                width: 28,
                height: 28,
                border: `2.5px solid ${color}`,
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "hc-fade-in 0.7s linear infinite",
                margin: "0 auto",
              }}
            />
          </div>
        )}

        {!loading && error && (
          <div
            style={{
              padding: 48,
              textAlign: "center",
              background: t.surface,
              border: `1px solid ${t.border}`,
              borderRadius: 18,
              animation: "hc-fade-in 0.3s ease",
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.5 }}>404</div>
            <p style={{ fontSize: 17, fontWeight: 600, marginBottom: 6, color: t.text }}>
              {error}
            </p>
            <p style={{ color: t.text2, marginBottom: 20, fontSize: 13 }}>
              Verifique se o link está correto.
            </p>
            <Link
              href={`/help/${slug}`}
              style={{
                display: "inline-block",
                padding: "10px 22px",
                borderRadius: 12,
                background: color,
                color: "var(--text-1)",
                fontWeight: 600,
                textDecoration: "none",
                fontSize: 13,
              }}
            >
              Voltar à central
            </Link>
          </div>
        )}

        {!loading && !error && article && (
          <article style={{ animation: "hc-fade-in 0.4s ease" }}>
            {/* Hero image */}
            {article.hero_image_url && (
              <div
                style={{
                  width: "100%",
                  aspectRatio: "16/9",
                  borderRadius: 18,
                  overflow: "hidden",
                  marginBottom: 36,
                  border: `1px solid ${t.border}`,
                  background: t.surface,
                }}
              >
                <img
                  src={article.hero_image_url}
                  alt={article.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </div>
            )}

            {/* Category badge */}
            {article.category && (
              <span
                style={{
                  display: "inline-block",
                  padding: "3px 12px",
                  borderRadius: 8,
                  background: `${color}14`,
                  color,
                  fontSize: 11,
                  fontWeight: 600,
                  marginBottom: 14,
                }}
              >
                {article.category.icon} {article.category.name}
              </span>
            )}

            {/* Title */}
            <h1
              style={{
                fontSize: 34,
                fontWeight: 700,
                lineHeight: 1.2,
                marginBottom: 12,
                letterSpacing: "-0.02em",
                color: t.text,
              }}
            >
              {article.title}
            </h1>

            {/* Summary */}
            {article.summary && (
              <p
                style={{
                  fontSize: 17,
                  color: t.text2,
                  marginBottom: 22,
                  lineHeight: 1.55,
                }}
              >
                {article.summary}
              </p>
            )}

            {/* Meta */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 13,
                color: t.text3,
                marginBottom: 36,
                paddingBottom: 24,
                borderBottom: `1px solid ${t.border}`,
              }}
            >
              <span>{article.view_count} visualizações</span>
              <span>·</span>
              <span>
                Atualizado em{" "}
                {new Date(article.updated_at).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>

            {/* Content */}
            <div
              className="article-body"
              dangerouslySetInnerHTML={{ __html: article.content || "" }}
            />
          </article>
        )}
      </main>

      {/* Article Agent */}
      {article && (
        <ArticleAgentChat
          slug={slug}
          articleSlug={articleSlug}
          apiBase={API}
          color={color}
          t={{ bg: t.bg, surface: t.surface, border: t.border, text: t.text, text2: t.text2, text3: t.text3 }}
        />
      )}

      {/* Footer */}
      {!hideBranding && (
        <footer
          style={{
            borderTop: `1px solid ${t.border}`,
            padding: "16px 24px",
            textAlign: "center",
          }}
        >
          <p style={{ fontSize: 11, color: t.text3, margin: 0 }}>
            Powered by{" "}
            <a
              href="https://uniq.chat"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color, textDecoration: "none", fontWeight: 600 }}
            >
              Uniq Chat
            </a>
          </p>
        </footer>
      )}
    </div>
  );
}
