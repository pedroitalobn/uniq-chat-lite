"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Helper: deriva a URL do backend mesmo quando NEXT_PUBLIC_API_URL
// está vazio ou apontando localhost no build de produção. Usado em
// rotas públicas que rodam em qualquer subdomínio.
function getApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL ?? "";
  if (env && !/localhost|127\.0\.0\.1/.test(env)) return env.replace(/\/v1\/?$/, "");
  if (typeof window !== "undefined" && window.location.hostname && !/localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    const host = window.location.hostname;
    const apiHost = host.startsWith("app.") || host.startsWith("admin.") || host.startsWith("dashboard.") || host.startsWith("help.")
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
  updated_at: string;
}

function mdToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/^(?!<[hul])(.+)$/gm, "<p>$1</p>")
    .replace(/<p><\/p>/g, "");
}

export default function HelpCenterPage({ params }: { params: { slug: string } }) {
  const { slug } = params;
  // Derivado lazy via window — sem isso o build de produção com env
  // vazio caía em fetch relativo (`/v1/public/...`) batendo no front
  // em vez do backend e devolvendo 404 do Next pra "Central de Ajuda".
  const [API] = useState(() => getApiBase());
  const [config, setConfig] = useState<Config | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Article[] | null>(null);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<{ answer: string; sources: { id: string; title: string; slug: string }[] } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const primaryColor = config?.primary_color ?? "#00d46a";

  useEffect(() => {
    async function load() {
      try {
        const [cfgRes, catsRes] = await Promise.all([
          fetch(`${API}/v1/public/helpdesk/${slug}/config`),
          fetch(`${API}/v1/public/helpdesk/${slug}/articles`),
        ]);
        if (cfgRes.status === 404) { setNotFound(true); return; }
        const cfgData = await cfgRes.json();
        setConfig(cfgData);
        const arts: Article[] = await catsRes.json();
        setArticles(arts);

        // Derive categories from articles
        const catMap: Record<string, Category> = {};
        arts.forEach((a) => {
          if ((a as any).category) {
            const cat = (a as any).category;
            if (!catMap[cat.id]) catMap[cat.id] = { ...cat, article_count: 0 };
            catMap[cat.id].article_count++;
          }
        });
        setCategories(Object.values(catMap));
      } catch {
        setNotFound(true);
      }
    }
    load();
  }, [slug]);

  // Debounced search
  useEffect(() => {
    if (!search.trim()) { setSearchResults(null); return; }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API}/v1/public/helpdesk/${slug}/articles?q=${encodeURIComponent(search)}`);
        setSearchResults(await res.json());
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 350);
  }, [search, slug]);

  async function askAI() {
    if (!aiQuestion.trim()) return;
    setAiLoading(true);
    setAiAnswer(null);
    try {
      const res = await fetch(`${API}/v1/public/helpdesk/${slug}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: aiQuestion }),
      });
      setAiAnswer(await res.json());
    } catch { setAiAnswer({ answer: "Erro ao processar sua pergunta.", sources: [] }); }
    finally { setAiLoading(false); }
  }

  const displayedArticles = searchResults ?? (selectedCat
    ? articles.filter((a) => a.category_id === selectedCat)
    : articles);

  if (notFound) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d0d", color: "#fff" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🔍</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Central de ajuda não encontrada</h1>
        <p style={{ color: "#888" }}>O link pode estar errado ou a Central de Ajuda ainda não foi configurada.</p>
      </div>
    </div>
  );

  if (!config) return (
    <div style={{ minHeight: "100vh", background: "#0d0d0d", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 36, height: 36, border: `3px solid ${primaryColor}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  const bg = "#0d0d0d";
  const surface = "#161616";
  const border = "rgba(255,255,255,0.08)";
  const text1 = "#f0f0f0";
  const text2 = "#a0a0a0";
  const text3 = "#666";

  return (
    <div style={{ minHeight: "100vh", background: bg, color: text1 }}>
      <style>{`
        *{box-sizing:border-box;}
        a{color:${primaryColor};text-decoration:none;}
        a:hover{text-decoration:underline;}
        .art-body h1,.art-body h2,.art-body h3{color:${text1};margin:1.4em 0 0.5em}
        .art-body p{color:${text2};line-height:1.75;margin:0.6em 0}
        .art-body ul{color:${text2};padding-left:1.5em;line-height:1.75}
        .art-body code{background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:4px;font-size:0.85em}
        .art-body strong{color:${text1}}
        .search-input::placeholder{color:${text3}}
        .cat-btn:hover{background:rgba(255,255,255,0.06)!important}
        .art-card:hover{border-color:${primaryColor}44!important;transform:translateY(-2px)}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
        .fade-in{animation:fadeIn 0.3s ease}
      `}</style>

      {/* Header */}
      <header style={{ background: surface, borderBottom: `1px solid ${border}`, padding: "0 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {config.logo_url
              ? <img src={config.logo_url} alt="logo" style={{ height: 32, borderRadius: 6 }} />
              : <div style={{ width: 32, height: 32, borderRadius: 8, background: primaryColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>💬</div>
            }
            <span style={{ fontWeight: 600, fontSize: 16, color: text1 }}>{config.title}</span>
          </div>
          <span style={{ fontSize: 13, color: text3 }}>{config.article_count} artigo{config.article_count !== 1 ? "s" : ""}</span>
        </div>
      </header>

      {/* Hero + Search */}
      {!selectedArticle && (
        <div style={{ padding: "56px 24px 40px", textAlign: "center", background: `linear-gradient(180deg, ${primaryColor}08 0%, transparent 100%)` }}>
          <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 12, color: text1 }}>
            {config.title}
          </h1>
          {config.description && (
            <p style={{ fontSize: 16, color: text2, marginBottom: 32, maxWidth: 480, margin: "0 auto 32px" }}>
              {config.description}
            </p>
          )}
          <div style={{ maxWidth: 560, margin: "0 auto", position: "relative" }}>
            <input
              className="search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar artigos..."
              style={{
                width: "100%", padding: "14px 20px 14px 48px", fontSize: 15, borderRadius: 14,
                background: surface, border: `1px solid ${search ? primaryColor + "60" : border}`,
                color: text1, outline: "none", transition: "border-color 0.2s",
              }}
            />
            <span style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: text3, fontSize: 18 }}>🔍</span>
            {searching && (
              <span style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)" }}>
                <div style={{ width: 18, height: 18, border: `2px solid ${primaryColor}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
              </span>
            )}
          </div>
        </div>
      )}

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "0 24px 80px", display: "flex", gap: 32 }}>
        {/* Sidebar */}
        {!selectedArticle && (
          <aside style={{ width: 220, flexShrink: 0, paddingTop: search ? 0 : 0 }}>
            {categories.length > 0 && !search && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: text3, textTransform: "uppercase", marginBottom: 8 }}>
                  Categorias
                </p>
                <button
                  className="cat-btn"
                  onClick={() => setSelectedCat(null)}
                  style={{ width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer", marginBottom: 4, background: selectedCat === null ? `${primaryColor}18` : "transparent", color: selectedCat === null ? primaryColor : text2, fontWeight: 500, fontSize: 14, transition: "background 0.15s" }}
                >
                  📚 Todos ({articles.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    className="cat-btn"
                    onClick={() => setSelectedCat(cat.id)}
                    style={{ width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 10, border: "none", cursor: "pointer", marginBottom: 4, background: selectedCat === cat.id ? `${primaryColor}18` : "transparent", color: selectedCat === cat.id ? primaryColor : text2, fontWeight: 500, fontSize: 14, transition: "background 0.15s" }}
                  >
                    {cat.icon || "📂"} {cat.name} ({cat.article_count})
                  </button>
                ))}
              </div>
            )}

            {/* AI Ask box */}
            {!search && (
              <div style={{ marginTop: 32, padding: "16px", background: surface, border: `1px solid ${border}`, borderRadius: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: text1, marginBottom: 10 }}>✨ Perguntar à IA</p>
                <textarea
                  value={aiQuestion}
                  onChange={(e) => setAiQuestion(e.target.value)}
                  placeholder="Qual é minha dúvida..."
                  rows={3}
                  style={{ width: "100%", background: "#1e1e1e", border: `1px solid ${border}`, borderRadius: 10, color: text1, padding: "10px 12px", fontSize: 13, resize: "vertical", outline: "none" }}
                />
                <button
                  onClick={askAI}
                  disabled={aiLoading || !aiQuestion.trim()}
                  style={{ marginTop: 8, width: "100%", padding: "9px", borderRadius: 10, border: "none", background: primaryColor, color: "#000", fontWeight: 600, fontSize: 13, cursor: aiLoading ? "not-allowed" : "pointer", opacity: aiLoading ? 0.7 : 1 }}
                >
                  {aiLoading ? "Processando..." : "Perguntar"}
                </button>
                {aiAnswer && (
                  <div className="fade-in" style={{ marginTop: 12 }}>
                    <p style={{ fontSize: 13, color: text1, lineHeight: 1.6, marginBottom: 8 }}>{aiAnswer.answer}</p>
                    {aiAnswer.sources.length > 0 && (
                      <div>
                        <p style={{ fontSize: 11, color: text3, marginBottom: 4 }}>Fontes:</p>
                        {aiAnswer.sources.map((s) => (
                          <button
                            key={s.id}
                            onClick={() => { const art = articles.find((a) => a.slug === s.slug || a.id === s.id); if (art) setSelectedArticle(art); }}
                            style={{ display: "block", fontSize: 12, color: primaryColor, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: "2px 0" }}
                          >
                            → {s.title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </aside>
        )}

        {/* Main content */}
        <main style={{ flex: 1, minWidth: 0 }}>
          {/* Article reader */}
          {selectedArticle ? (
            <div className="fade-in">
              <button
                onClick={() => setSelectedArticle(null)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 24, background: "none", border: "none", color: text3, cursor: "pointer", fontSize: 14 }}
              >
                ← Voltar
              </button>
              <article>
                {/* Hero image: capa renderizada acima do título quando o
                    artigo tem hero_image_url. Aspect ratio largo, sombra
                    sutil pra integrar com o fundo. */}
                {selectedArticle.hero_image_url && (
                  <div
                    style={{
                      marginBottom: 24,
                      borderRadius: 16,
                      overflow: "hidden",
                      aspectRatio: "16 / 7",
                      background: "rgba(255,255,255,0.04)",
                      border: `1px solid ${border}`,
                    }}
                  >
                    <img
                      src={selectedArticle.hero_image_url}
                      alt={selectedArticle.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </div>
                )}
                <h1 style={{ fontSize: 28, fontWeight: 700, color: text1, marginBottom: 8 }}>{selectedArticle.title}</h1>
                {selectedArticle.summary && (
                  <p style={{ fontSize: 16, color: text2, marginBottom: 24, paddingBottom: 24, borderBottom: `1px solid ${border}` }}>{selectedArticle.summary}</p>
                )}
                {/* O content agora é HTML produzido pelo Tiptap (editor
                    rich text). Ainda detectamos artigos antigos em Markdown
                    e os renderizamos via mdToHtml — heurística: começa com
                    `#` ou não tem nenhuma tag HTML. */}
                <div
                  className="art-body"
                  dangerouslySetInnerHTML={{
                    __html: /<[a-zA-Z][^>]*>/.test(selectedArticle.content)
                      ? selectedArticle.content
                      : mdToHtml(selectedArticle.content),
                  }}
                />
                <div style={{ marginTop: 48, paddingTop: 24, borderTop: `1px solid ${border}`, display: "flex", gap: 16, fontSize: 13, color: text3 }}>
                  <span>{selectedArticle.view_count} visualizações</span>
                  <span>Atualizado {new Date(selectedArticle.updated_at).toLocaleDateString("pt-BR")}</span>
                </div>
              </article>
            </div>
          ) : (
            <div className="fade-in">
              {search && searchResults !== null && (
                <p style={{ fontSize: 13, color: text3, marginBottom: 16 }}>
                  {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""} para "{search}"
                </p>
              )}
              {displayedArticles.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: text3 }}>
                  <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
                  <p>{search ? "Nenhum artigo encontrado para essa busca." : "Nenhum artigo publicado ainda."}</p>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 16 }}>
                  {displayedArticles.map((art) => (
                    <Link
                      key={art.id}
                      href={`/help/${slug}/${art.slug}`}
                      className="art-card"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "20px 24px", borderRadius: 14, background: surface, border: `1px solid ${border}`, cursor: "pointer", transition: "all 0.2s", textDecoration: "none" }}
                    >
                      <h3 style={{ fontSize: 16, fontWeight: 600, color: text1, marginBottom: 6 }}>{art.title}</h3>
                      {art.summary && <p style={{ fontSize: 14, color: text2, lineHeight: 1.5, marginBottom: 8 }}>{art.summary}</p>}
                      <div style={{ display: "flex", gap: 12, fontSize: 12, color: text3 }}>
                        <span>{art.view_count} views</span>
                        <span>{new Date(art.updated_at).toLocaleDateString("pt-BR")}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Footer */}
      <footer style={{ borderTop: `1px solid ${border}`, padding: "20px 24px", textAlign: "center" }}>
        <p style={{ fontSize: 12, color: text3 }}>
          Powered by <span style={{ color: primaryColor }}>Uniq Chat</span>
        </p>
      </footer>

      {/* Floating chat widget */}
      {config.widget_enabled && config.webchat_token && (
        <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
          {chatOpen && (
            <iframe
              src={`/embed/chat/${config.webchat_token}`}
              style={{
                width: 380, height: 580, border: "none", borderRadius: 16,
                boxShadow: "0 8px 40px rgba(0,0,0,0.25)", background: "#fff",
                animation: "chatFadeIn 0.2s ease",
              }}
              allow="microphone"
              title="Chat"
            />
          )}
          <button
            onClick={() => setChatOpen((v) => !v)}
            style={{
              width: 56, height: 56, borderRadius: "50%", border: "none",
              background: primaryColor, color: "#fff", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: `0 4px 20px ${primaryColor}60`,
              transition: "transform 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.08)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            aria-label={chatOpen ? "Fechar chat" : "Abrir chat"}
          >
            {chatOpen ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            )}
          </button>
          <style>{`@keyframes chatFadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}`}</style>
        </div>
      )}
    </div>
  );
}
