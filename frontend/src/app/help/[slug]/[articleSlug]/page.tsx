"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { getSession } from "next-auth/react";

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
  visibility?: string;
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

function ArticleContent({ html, color }: { html: string; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const plyrs = useRef<Plyr[]>([]);

  useEffect(() => {
    if (!ref.current) return;
    plyrs.current.forEach((p) => p.destroy());
    plyrs.current = [];

    const el = ref.current;
    el.querySelectorAll("iframe").forEach((iframe) => {
      const src = iframe.getAttribute("src") || "";
      const isYouTube = /youtube\.com|youtu\.be/.test(src);
      const isVimeo = /vimeo\.com/.test(src);
      if (!isYouTube && !isVimeo) return;
      const wrapper = document.createElement("div");
      wrapper.style.cssText = "position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:14px;margin:20px 0";
      iframe.style.cssText = "position:absolute;top:0;left:0;width:100%;height:100%;border:0";
      iframe.parentElement?.insertBefore(wrapper, iframe);
      wrapper.appendChild(iframe);
    });

    el.querySelectorAll("video").forEach((v) => {
      const p = new Plyr(v, {
        youtube: { noCookie: true },
        vimeo: { byline: false, portrait: false },
      });
      plyrs.current.push(p);
    });

    el.querySelectorAll("iframe").forEach((iframe) => {
      const src = iframe.getAttribute("src") || "";
      const isYouTube = /youtube\.com/.test(src);
      const isVimeo = /vimeo\.com/.test(src);
      if (!isYouTube && !isVimeo) return;
      const parent = iframe.parentElement;
      if (!parent) return;
      const video = document.createElement("video");
      if (isYouTube) {
        const match = src.match(/embed\/([a-zA-Z0-9_-]+)/);
        if (match) video.dataset.src = match[1];
        video.dataset.provider = "youtube";
      } else {
        const match = src.match(/video\/(\d+)/);
        if (match) video.dataset.src = match[1];
        video.dataset.provider = "vimeo";
      }
      video.playsInline = true;
      parent.replaceChild(video, iframe);
      try {
        const p = new Plyr(video, {
          youtube: { noCookie: true },
          vimeo: { byline: false, portrait: false },
        });
        plyrs.current.push(p);
      } catch {}
    });

    return () => {
      plyrs.current.forEach((p) => p.destroy());
      plyrs.current = [];
    };
  }, [html]);

  return (
    <div
      ref={ref}
      className="article-body"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{ "--plyr-color-main": color } as React.CSSProperties}
    />
  );
}

function ArticleAgentChat({
  slug, articleSlug, apiBase, color, t, authHeader,
}: {
  slug: string;
  articleSlug: string;
  apiBase: string;
  color: string;
  t: { bg: string; surface: string; border: string; text: string; text2: string; text3: string };
  authHeader?: Record<string, string>;
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
        headers: { "Content-Type": "application/json", ...authHeader },
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
  const [authHeader, setAuthHeader] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Config | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessGranted, setAccessGranted] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [checkingPassword, setCheckingPassword] = useState(false);
  const [forbiddenMsg, setForbiddenMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let headers: Record<string, string> = {};
      try {
        const session = await getSession();
        if (session?.accessToken) {
          headers = { Authorization: `Bearer ${session.accessToken}` };
        }
      } catch {}
      setAuthHeader(headers);
      try {
        setLoading(true);
        const cfgRes = await fetch(`${API}/v1/public/helpdesk/${slug}/config`, { headers });
        if (!cfgRes.ok) {
          setError("Central não encontrada.");
          return;
        }
        const cfgData: Config = await cfgRes.json();
        if (cancelled) return;
        setConfig(cfgData);

        const vis = cfgData.visibility || "public";
        let granted = false;

        if (vis === "public") {
          granted = true;
        } else if (vis === "password") {
          const unlocked = sessionStorage.getItem(`hc_unlock_${slug}`) === "1";
          granted = unlocked;
        } else if (vis === "uniq_users") {
          granted = !!headers.Authorization;
        } else if (vis === "workspace_users") {
          granted = !!headers.Authorization;
        }

        setAccessGranted(granted);

        if (!granted) {
          setLoading(false);
          return;
        }

        const artRes = await fetch(`${API}/v1/public/helpdesk/${slug}/articles/${articleSlug}`, { headers });
        if (cancelled) return;
        if (!artRes.ok) {
          if (artRes.status === 403) {
            const data = await artRes.json().catch(() => ({}));
            setForbiddenMsg(data.error || "Acesso restrito a membros da workspace.");
            setAccessGranted(false);
          } else if (artRes.status === 401) {
            setAccessGranted(false);
          } else {
            setError(artRes.status === 404 ? "Artigo não encontrado." : "Erro ao carregar artigo.");
          }
          return;
        }
        setArticle(await artRes.json());
      } catch {
        if (!cancelled) setError("Erro de conexão.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [slug, articleSlug, API]);

  const loadArticle = async () => {
    setLoading(true);
    setError(null);
    try {
      const artRes = await fetch(`${API}/v1/public/helpdesk/${slug}/articles/${articleSlug}`, { headers: authHeader });
      if (!artRes.ok) {
        if (artRes.status === 403) {
          const data = await artRes.json().catch(() => ({}));
          setForbiddenMsg(data.error || "Acesso restrito a membros da workspace.");
          setAccessGranted(false);
        } else if (artRes.status === 401) {
          setAccessGranted(false);
        } else {
          setError(artRes.status === 404 ? "Artigo não encontrado." : "Erro ao carregar artigo.");
        }
        return;
      }
      setArticle(await artRes.json());
    } catch {
      setError("Erro de conexão.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (accessGranted && !article && !error) {
      loadArticle();
    }
  }, [accessGranted]);

  const verifyPassword = async () => {
    if (!passwordInput.trim()) return;
    setCheckingPassword(true);
    setPasswordError(false);
    try {
      const res = await fetch(`${API}/v1/public/helpdesk/${slug}/verify-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json();
      if (data.valid) {
        sessionStorage.setItem(`hc_unlock_${slug}`, "1");
        setAccessGranted(true);
      } else {
        setPasswordError(true);
      }
    } catch {
      setPasswordError(true);
    } finally {
      setCheckingPassword(false);
    }
  };

  const color = config?.primary_color || "#2563EB";
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
        .article-body iframe {
          max-width: 100%;
          border-radius: 14px;
          margin: 20px 0;
        }
        .article-body .plyr {
          border-radius: 14px;
          margin: 20px 0;
          overflow: hidden;
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

        {!loading && !error && !accessGranted && config && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", animation: "hc-fade-in 0.3s ease" }}>
            <div style={{ maxWidth: 380, width: "100%", textAlign: "center", display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto" }}>
                {config.visibility === "password" ? "🔒" : "🛡️"}
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text }}>
                  {config.visibility === "password" ? "Acesso protegido" : "Acesso restrito"}
                </h1>
                <p style={{ margin: "8px 0 0", fontSize: 14, color: t.text3, lineHeight: 1.5 }}>
                  {forbiddenMsg
                    ? forbiddenMsg
                    : config.visibility === "password"
                      ? "Esta central de ajuda requer uma senha para acessar."
                      : config.visibility === "uniq_users"
                        ? "Apenas usuários logados no  Qchat têm acesso a esta central."
                        : "Apenas membros da workspace têm acesso a esta central."}
                </p>
              </div>
              {config.visibility === "password" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <input
                    type="password"
                    value={passwordInput}
                    onChange={(e) => { setPasswordInput(e.target.value); setPasswordError(false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") verifyPassword(); }}
                    placeholder="Digite a senha..."
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      borderRadius: 12,
                      border: `1px solid ${passwordError ? "#ef4444" : t.border}`,
                      background: t.surface,
                      color: t.text,
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                  {passwordError && (
                    <p style={{ margin: 0, fontSize: 12, color: "#ef4444" }}>Senha incorreta. Tente novamente.</p>
                  )}
                  <button
                    onClick={verifyPassword}
                    disabled={checkingPassword || !passwordInput.trim()}
                    style={{
                      width: "100%",
                      padding: "12px",
                      borderRadius: 12,
                      border: "none",
                      background: color,
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: checkingPassword || !passwordInput.trim() ? "not-allowed" : "pointer",
                      opacity: checkingPassword || !passwordInput.trim() ? 0.7 : 1,
                    }}
                  >
                    {checkingPassword ? "Verificando..." : "Entrar"}
                  </button>
                </div>
              )}
              {(config.visibility === "uniq_users" || config.visibility === "workspace_users") && (
                <a
                  href="/login"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "12px 24px",
                    borderRadius: 12,
                    background: color,
                    color: "#fff",
                    fontSize: 14,
                    fontWeight: 700,
                    textDecoration: "none",
                  }}
                >
                  Fazer login
                </a>
              )}
              <Link
                href={`/help/${slug}`}
                style={{
                  fontSize: 13,
                  color: t.text3,
                  textDecoration: "none",
                }}
              >
                ← Voltar à central
              </Link>
            </div>
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
        <ArticleContent html={article.content || ""} color={color} />
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
          authHeader={authHeader}
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
              Qchat
            </a>
          </p>
        </footer>
      )}
    </div>
  );
}
