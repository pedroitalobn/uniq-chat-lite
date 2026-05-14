"use client";

import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { getSession } from "next-auth/react";

// ─── Helpers ────────────────────────────────────────────────────────────────────

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
  widget_enabled: boolean;
  webchat_token?: string;
  article_count: number;
  workspace_name: string;
  theme_mode: "dark" | "light" | "system";
  font_family: string;
  custom_domain: string;
  layout_style: string;
  hide_uniq_branding: boolean;
  visibility?: string;
  badge_style?: string;
  badge_icon?: string;
  badge_color?: string;
  position?: string;
  offset_x?: number;
  offset_y?: number;
  border_radius?: number;
  shadow_intensity?: string;
  display_name?: string;
}

interface Category {
  id: string;
  name: string;
  description: string;
  icon: string;
  slug: string;
  article_count: number;
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
  category?: Category;
  updated_at: string;
}

// ─── Font loader ────────────────────────────────────────────────────────────────

const FONT_URLS: Record<string, string> = {
  inter: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  geist: "", // Geist is bundled via next/font
  manrope: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap",
  jetbrains: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap",
};

const FONT_STACKS: Record<string, string> = {
  inter: "'Inter', system-ui, -apple-system, sans-serif",
  geist: "var(--font-sans), system-ui, -apple-system, sans-serif",
  manrope: "'Manrope', system-ui, -apple-system, sans-serif",
  jetbrains: "'JetBrains Mono', monospace",
};

// ─── Floating Widget ────────────────────────────────────────────────────────────

function FloatingWidget({ token, config }: { token: string; config: Config }) {
  const [chatOpen, setChatOpen] = useState(false);
  const color = config.badge_color || config.primary_color || "#2563EB";
  const pos = config.position || "bottom-right";
  const isTop = pos.startsWith("top");
  const isLeft = pos.endsWith("left");

  const shadowMap: Record<string, string> = {
    none: "none",
    soft: `0 2px 12px ${color}30`,
    medium: `0 4px 24px ${color}44`,
    strong: `0 8px 40px ${color}60`,
  };

  const badgeStyle = config.badge_style || "bubble";
  const badgeSize =
    badgeStyle === "pill" ? { w: 120, h: 48 } :
    badgeStyle === "square" ? { w: 56, h: 56 } :
    badgeStyle === "minimal" ? { w: 40, h: 40 } :
    { w: 56, h: 56 };

  const borderR =
    badgeStyle === "bubble" ? "50%" :
    badgeStyle === "pill" ? 9999 :
    badgeStyle === "square" ? 14 :
    (config.border_radius ?? 9999);

  const offsetX = config.offset_x ?? 20;
  const offsetY = config.offset_y ?? 20;

  return (
    <div
      style={{
        position: "fixed",
        [isTop ? "top" : "bottom"]: offsetY,
        [isLeft ? "left" : "right"]: offsetX,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: isLeft ? "flex-start" : "flex-end",
        gap: 12,
      }}
    >
      {chatOpen && (
        <iframe
          src={`/embed/chat/${token}`}
          style={{
            width: 380,
            height: 560,
            border: "none",
            borderRadius: 20,
            boxShadow: `0 12px 48px rgba(0,0,0,0.30), 0 0 0 1px var(--border-default)`,
            background: "var(--text-1)",
            animation: "hc-fade-up 0.25s ease",
          }}
          allow="microphone"
          title="Chat"
        />
      )}
      <button
        onClick={() => setChatOpen((v) => !v)}
        style={{
          width: badgeSize.w,
          height: badgeSize.h,
          borderRadius: borderR,
          border: "none",
          background: color,
          color: "#fff",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: shadowMap[config.shadow_intensity ?? "medium"],
          transition: "transform 0.2s ease",
          fontSize: badgeStyle === "pill" ? 13 : 20,
          fontWeight: 700,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.06)")}
        onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        aria-label={chatOpen ? "Fechar chat" : "Abrir chat"}
      >
        {chatOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : badgeStyle === "pill" ? (
          <span className="flex items-center gap-1.5">
            <span>{config.badge_icon || "💬"}</span>
            <span>{config.display_name || "Chat"}</span>
          </span>
        ) : (
          <span>{config.badge_icon || "💬"}</span>
        )}
      </button>
    </div>
  );
}

// ─── Article Card ───────────────────────────────────────────────────────────────

function ArticleCard({
  article,
  slug,
  color,
  isLight,
}: {
  article: Article;
  slug: string;
  color: string;
  isLight: boolean;
}) {
  return (
    <Link
      href={`/help/${slug}/${article.slug}`}
      style={{ textDecoration: "none" }}
    >
      <div
        className="hc-article-card"
        style={{
          padding: "20px 22px",
          borderRadius: 16,
          background: isLight ? "var(--text-1)" : "var(--input)",
          border: isLight ? "1px solid rgba(0,0,0,0.06)" : "1px solid var(--border-subtle)",
          cursor: "pointer",
          transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          position: "relative" as const,
          overflow: "hidden",
        }}
      >
        {/* Hover glow */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            background: `radial-gradient(circle at 50% 0%, ${color}12 0%, transparent 70%)`,
            transition: "opacity 0.3s ease",
          }}
          className="hc-glow"
        />

        <div style={{ position: "relative", zIndex: 1 }}>
          {article.category && (
            <span
              style={{
                display: "inline-block",
                padding: "3px 10px",
                borderRadius: 8,
                background: `${color}14`,
                color: color,
                fontSize: 11,
                fontWeight: 600,
                marginBottom: 10,
              }}
            >
              {article.category.icon} {article.category.name}
            </span>
          )}
          <h3
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: isLight ? "#0f172a" : "#f1f5f9",
              margin: "0 0 6px",
              lineHeight: 1.4,
            }}
          >
            {article.title}
          </h3>
          {article.summary && (
            <p
              style={{
                fontSize: 13,
                color: isLight ? "#64748b" : "#94a3b8",
                lineHeight: 1.5,
                margin: 0,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {article.summary}
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 12,
              fontSize: 11,
              color: isLight ? "#94a3b8" : "#64748b",
            }}
          >
            <span>{article.view_count} views</span>
            <span>
              {new Date(article.updated_at).toLocaleDateString("pt-BR", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function HelpCenterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const [API] = useState(() => getApiBase());
  const [authHeader, setAuthHeader] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Config | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Article[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [notFoundHint, setNotFoundHint] = useState<{
    requested?: string;
    available?: string[];
    hint?: string;
  } | null>(null);
  const [fontLoaded, setFontLoaded] = useState(false);
  const [accessGranted, setAccessGranted] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [checkingPassword, setCheckingPassword] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Load data ───────────────────────────────────────────────────────────—

  useEffect(() => {
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
        const [cfgRes, catsRes, artsRes] = await Promise.all([
          fetch(`${API}/v1/public/helpdesk/${slug}/config`, { headers }),
          fetch(`${API}/v1/public/helpdesk/${slug}/categories`, { headers }),
          fetch(`${API}/v1/public/helpdesk/${slug}/articles`, { headers }),
        ]);
        if (cfgRes.status === 404) {
          setNotFound(true);
          try {
            const data = await cfgRes.json();
            setNotFoundHint({
              requested: data?.requested_slug,
              available: Array.isArray(data?.available_slugs) ? data.available_slugs : [],
              hint: data?.hint,
            });
          } catch {}
          return;
        }
        const cfgData: Config = await cfgRes.json();
        setConfig(cfgData);

        // Access control
        if (cfgData.visibility === "public") {
          setAccessGranted(true);
        } else if (cfgData.visibility === "password") {
          const unlocked = sessionStorage.getItem(`hc_unlock_${slug}`) === "1";
          setAccessGranted(unlocked);
        } else if (cfgData.visibility === "uniq_users" || cfgData.visibility === "workspace_users") {
          setAccessGranted(false);
        }

        if (catsRes.ok) {
          setCategories((await catsRes.json()) as Category[]);
        }
        setArticles((await artsRes.json()) as Article[]);
      } catch {
        setNotFound(true);
      }
    }
    load();
  }, [slug, API]);

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

  // ─── Load font ───────────────────────────────────────────────────────────—

  useEffect(() => {
    if (!config?.font_family || config.font_family === "inter" || config.font_family === "geist")
      return;
    const url = FONT_URLS[config.font_family];
    if (!url) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.onload = () => setFontLoaded(true);
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [config?.font_family]);

  // ─── Search ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults(null);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${API}/v1/public/helpdesk/${slug}/articles?q=${encodeURIComponent(search)}`,
          { headers: authHeader }
        );
        setSearchResults((await res.json()) as Article[]);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [search, slug, API]);

  // ─── Derived values ───────────────────────────────────────────────────────

  const color = config?.primary_color ?? "#2563EB";
  const themeMode = config?.theme_mode ?? "dark";
  const fontFamily =
    FONT_STACKS[config?.font_family ?? "inter"] ?? FONT_STACKS.inter;
  const hideBranding = config?.hide_uniq_branding ?? false;

  const prefersDark =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const isDark =
    themeMode === "system" ? prefersDark : themeMode === "dark";
  const isLight = !isDark;

  // ─── Theme tokens ─────────────────────────────────────────────────────────

  const t = {
    bg: isLight ? "#f8fafc" : "#08090d",
    surface: isLight ? "var(--text-1)" : "var(--input)",
    surfaceHover: isLight ? "#f1f5f9" : "var(--input)",
    border: isLight ? "rgba(0,0,0,0.06)" : "var(--border-subtle)",
    borderStrong: isLight ? "rgba(0,0,0,0.10)" : "var(--border-default)",
    text: isLight ? "#0f172a" : "#f1f5f9",
    text2: isLight ? "#475569" : "#94a3b8",
    text3: isLight ? "#94a3b8" : "#64748b",
    glass: isLight
      ? "rgba(255,255,255,0.70)"
      : "var(--input)",
    glassBorder: isLight
      ? "rgba(0,0,0,0.06)"
      : "var(--border-subtle)",
    inputBg: isLight ? "#f1f5f9" : "var(--input)",
  };

  const filteredArticles = searchResults ?? (selectedCat
    ? articles.filter((a) => a.category_id === selectedCat)
    : articles);

  // ─── 404 ──────────────────────────────────────────────────────────────────

  if (notFound) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: t.bg,
          color: t.text,
          fontFamily,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 480, padding: 40 }}>
          <div style={{ fontSize: 56, marginBottom: 16, opacity: 0.4 }}>404</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
            Central não encontrada
          </h1>
          <p style={{ color: t.text2, marginBottom: 20, fontSize: 14 }}>
            {notFoundHint?.requested ? (
              <>
                <code
                  style={{
                    background: t.surface,
                    padding: "2px 8px",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  {notFoundHint.requested}
                </code>{" "}
                não localizado.
              </>
            ) : (
              "O link pode estar errado ou a central ainda não foi configurada."
            )}
          </p>
          {notFoundHint?.available && notFoundHint.available.length > 0 && (
            <div
              style={{
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: 14,
                padding: 16,
                textAlign: "left",
              }}
            >
              <p style={{ fontSize: 12, color: t.text3, marginBottom: 10 }}>
                Centrais disponíveis:
              </p>
              {notFoundHint.available.map((s) => (
                <Link
                  key={s}
                  href={`/help/${s}`}
                  style={{
                    display: "block",
                    color,
                    textDecoration: "none",
                    fontSize: 13,
                    padding: "5px 0",
                  }}
                >
                  /help/{s}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (!config) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: t.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            border: `2.5px solid ${color}`,
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "hc-spin 0.7s linear infinite",
          }}
        />
      </div>
    );
  }

  // ─── Access gate ──────────────────────────────────────────────────────────

  if (!accessGranted && config) {
    const isPassword = config.visibility === "password";
    const isUniqUsers = config.visibility === "uniq_users";
    const isWorkspace = config.visibility === "workspace_users";
    return (
      <div style={{ minHeight: "100vh", background: t.bg, fontFamily, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 380, width: "100%", textAlign: "center", display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, margin: "0 auto" }}>
            {isPassword ? "🔒" : "🛡️"}
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.text }}>
              {isPassword ? "Acesso protegido" : "Acesso restrito"}
            </h1>
            <p style={{ margin: "8px 0 0", fontSize: 14, color: t.text3, lineHeight: 1.5 }}>
              {isPassword
                ? "Esta central de ajuda requer uma senha para acessar."
                : isUniqUsers
                ? "Apenas usuários logados no  Qchat têm acesso a esta central."
                : "Apenas membros da workspace têm acesso a esta central."}
            </p>
          </div>
          {isPassword && (
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
          {(isUniqUsers || isWorkspace) && (
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
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", background: t.bg, fontFamily }}>
      {/* ── Global styles ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes hc-spin { to { transform: rotate(360deg); } }
        @keyframes hc-fade-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes hc-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .hc-article-card:hover {
          transform: translateY(-2px);
          border-color: ${color}40 !important;
          box-shadow: 0 8px 30px ${color}10;
        }
        .hc-article-card:hover .hc-glow { opacity: 1; }
        .hc-search:focus { border-color: ${color}60 !important; box-shadow: 0 0 0 3px ${color}10; }
        .hc-cat-btn {
          transition: all 0.15s ease;
        }
        .hc-cat-btn:hover {
          background: ${color}10 !important;
          color: ${color} !important;
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${t.text3}40; border-radius: 4px; }
      `}</style>

      {/* ── Glass header ─────────────────────────────────────────────────── */}
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
            maxWidth: 1040,
            margin: "0 auto",
            padding: "0 24px",
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {config.logo_url ? (
              <img
                src={config.logo_url}
                alt=""
                style={{ height: 26, borderRadius: 6 }}
              />
            ) : (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: `linear-gradient(135deg, ${color}, ${color}cc)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                }}
              >
                ?
              </div>
            )}
            <span style={{ fontWeight: 600, fontSize: 15, color: t.text }}>
              {config.title}
            </span>
          </div>
          <span style={{ fontSize: 12, color: t.text3 }}>
            {config.article_count} artigo{config.article_count !== 1 ? "s" : ""}
          </span>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: "48px 24px 40px",
          textAlign: "center",
          background: isLight
            ? `linear-gradient(180deg, ${color}06 0%, transparent 100%)`
            : `linear-gradient(180deg, ${color}08 0%, transparent 100%)`,
        }}
      >
        <h1
          style={{
            fontSize: 32,
            fontWeight: 700,
            color: t.text,
            marginBottom: 8,
            letterSpacing: "-0.02em",
          }}
        >
          {config.title}
        </h1>
        {config.description && (
          <p
            style={{
              fontSize: 15,
              color: t.text2,
              marginBottom: 28,
              maxWidth: 440,
              margin: "0 auto 28px",
            }}
          >
            {config.description}
          </p>
        )}

        {/* Search */}
        <div
          style={{
            maxWidth: 500,
            margin: "0 auto",
            position: "relative",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke={t.text3}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)" }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="hc-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar artigos..."
            style={{
              width: "100%",
              padding: "13px 18px 13px 46px",
              fontSize: 14,
              borderRadius: 14,
              background: t.inputBg,
              border: `1px solid ${t.borderStrong}`,
              color: t.text,
              outline: "none",
              transition: "all 0.2s ease",
              fontFamily: "inherit",
            }}
          />
          {searching && (
            <div
              style={{
                position: "absolute",
                right: 16,
                top: "50%",
                transform: "translateY(-50%)",
                width: 18,
                height: 18,
                border: `2px solid ${color}`,
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "hc-spin 0.7s linear infinite",
              }}
            />
          )}
        </div>
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div
        style={{
          maxWidth: 1040,
          margin: "0 auto",
          padding: "0 24px 80px",
          display: "flex",
          gap: 40,
        }}
      >
        {/* Sidebar */}
        <aside style={{ width: 220, flexShrink: 0, paddingTop: 4 }}>
          {categories.length > 0 && !search && (
            <div>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.14em",
                  color: t.text3,
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                Categorias
              </p>
              <button
                className="hc-cat-btn"
                onClick={() => setSelectedCat(null)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: "none",
                  cursor: "pointer",
                  marginBottom: 3,
                  background: !selectedCat ? `${color}14` : "transparent",
                  color: !selectedCat ? color : t.text2,
                  fontWeight: 500,
                  fontSize: 13,
                  fontFamily: "inherit",
                }}
              >
                Todos ({articles.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  className="hc-cat-btn"
                  onClick={() => setSelectedCat(cat.id)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                    marginBottom: 3,
                    background: selectedCat === cat.id ? `${color}14` : "transparent",
                    color: selectedCat === cat.id ? color : t.text2,
                    fontWeight: 500,
                    fontSize: 13,
                    fontFamily: "inherit",
                  }}
                >
                  {cat.icon || "📂"} {cat.name}{" "}
                  <span style={{ color: t.text3, fontSize: 11 }}>
                    {cat.article_count}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* AI Ask */}
          {!search && (
            <div
              style={{
                marginTop: 28,
                padding: 16,
                background: t.surface,
                border: `1px solid ${t.border}`,
                borderRadius: 14,
              }}
            >
              <p
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: t.text,
                  marginBottom: 8,
                }}
              >
                Perguntar à IA
              </p>
              <textarea
                id="hc-ai-input"
                placeholder="Tire sua dúvida..."
                rows={2}
                style={{
                  width: "100%",
                  background: t.inputBg,
                  border: `1px solid ${t.border}`,
                  borderRadius: 10,
                  color: t.text,
                  padding: "9px 11px",
                  fontSize: 12,
                  resize: "vertical",
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={async () => {
                  const input = document.getElementById("hc-ai-input") as HTMLTextAreaElement;
                  const q = input?.value?.trim();
                  if (!q) return;
                  input.value = "";
                  const btn = document.getElementById("hc-ai-btn") as HTMLButtonElement;
                  const ans = document.getElementById("hc-ai-answer");
                  if (btn) { btn.disabled = true; btn.textContent = "Pensando..."; }
                  try {
              const res = await fetch(`${API}/v1/public/helpdesk/${slug}/ask`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeader },
                body: JSON.stringify({ question: q }),
              });
                    const data = await res.json();
                    if (ans) {
                      ans.innerHTML = `
                        <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:${t.text}">${data.answer}</p>
                        ${data.sources?.length ? `<p style="margin:0;font-size:10px;color:${t.text3}">Fontes: ${data.sources.map((s: { title: string }) => s.title).join(", ")}</p>` : ""}
                      `;
                    }
                  } catch {
                    if (ans) ans.innerHTML = `<p style="margin:0;font-size:12px;color:${t.text2}">Erro ao consultar.</p>`;
                  } finally {
                    if (btn) { btn.disabled = false; btn.textContent = "Perguntar"; }
                  }
                }}
                id="hc-ai-btn"
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "8px",
                  borderRadius: 10,
                  border: "none",
                  background: color,
                  color: "var(--text-1)",
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Perguntar
              </button>
              <div id="hc-ai-answer" style={{ marginTop: 10 }} />
            </div>
          )}
        </aside>

        {/* Main */}
        <main style={{ flex: 1, minWidth: 0 }}>
          {search && searchResults !== null && (
            <p
              style={{
                fontSize: 12,
                color: t.text3,
                marginBottom: 16,
              }}
            >
              {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""}{" "}
              para &ldquo;{search}&rdquo;
            </p>
          )}

          {filteredArticles.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "60px 0",
                color: t.text3,
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.5 }}>
                📭
              </div>
              <p style={{ fontSize: 14 }}>
                {search
                  ? "Nenhum artigo encontrado."
                  : "Nenhum artigo publicado ainda."}
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {filteredArticles.map((art, i) => (
                <div
                  key={art.id}
                  style={{
                    animation: `hc-fade-up 0.35s ease ${i * 0.04}s both`,
                  }}
                >
                  <ArticleCard
                    article={art}
                    slug={slug}
                    color={color}
                    isLight={isLight}
                  />
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
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

      {/* ── Floating chat widget ──────────────────────────────────────────── */}
      {config.widget_enabled && config.webchat_token && (
        <FloatingWidget
          token={config.webchat_token}
          config={config}
        />
      )}
    </div>
  );
}
