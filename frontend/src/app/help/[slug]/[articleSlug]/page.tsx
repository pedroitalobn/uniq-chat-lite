"use client";

// Página dedicada pra artigo individual do help center público:
//   /help/<workspace_slug>/<article_slug>
//
// Antes só existia /help/[slug]/page.tsx (lista geral) — abrir um
// artigo direto via URL retornava 404 do Next porque o segundo
// segmento não tinha rota match. Agora cada artigo tem permalink
// próprio (compartilhável, indexável, link do PreviewButton funciona).
//
// Render é mínimo e se inspira na lista — usa as mesmas cores do
// HelpDeskConfig do workspace.

import Link from "next/link";
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Config {
  title: string;
  description: string;
  primary_color: string;
  logo_url: string;
  workspace_name: string;
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

export default function ArticlePage({
  params,
}: {
  params: { slug: string; articleSlug: string };
}) {
  const { slug, articleSlug } = params;
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
  }, [slug, articleSlug]);

  const primaryColor = config?.primary_color || "#00d46a";
  const bg = "#0a0a0b";
  const surface = "#141416";
  const border = "rgba(255,255,255,0.08)";
  const text1 = "#f3f4f6";
  const text2 = "#a1a1aa";
  const text3 = "#6b7280";

  return (
    <div style={{ background: bg, color: text1, minHeight: "100vh" }}>
      <header style={{
        borderBottom: `1px solid ${border}`,
        padding: "16px 24px",
        background: "rgba(10,10,11,0.75)",
        backdropFilter: "blur(8px)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "center", gap: 16 }}>
          <Link href={`/help/${slug}`}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: text2, textDecoration: "none", fontSize: 13, fontWeight: 500 }}>
            ← {config?.workspace_name || "Central de Ajuda"}
          </Link>
          {config?.title && (
            <span style={{ color: text3, fontSize: 13 }}>· {config.title}</span>
          )}
        </div>
      </header>

      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 24px 80px" }}>
        {loading && (
          <div style={{ padding: 40, textAlign: "center", color: text3 }}>
            Carregando…
          </div>
        )}

        {!loading && error && (
          <div style={{
            padding: 40,
            textAlign: "center",
            background: surface,
            border: `1px solid ${border}`,
            borderRadius: 14,
          }}>
            <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Ops…</p>
            <p style={{ color: text2, marginBottom: 20 }}>{error}</p>
            <Link href={`/help/${slug}`}
              style={{ display: "inline-block", padding: "10px 20px", borderRadius: 12, background: primaryColor, color: "#000", fontWeight: 600, textDecoration: "none" }}>
              Voltar à central
            </Link>
          </div>
        )}

        {!loading && !error && article && (
          <article>
            {article.hero_image_url && (
              <div style={{
                width: "100%",
                aspectRatio: "16/9",
                borderRadius: 16,
                overflow: "hidden",
                marginBottom: 32,
                border: `1px solid ${border}`,
              }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={article.hero_image_url} alt={article.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              </div>
            )}

            <h1 style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.2, marginBottom: 12, letterSpacing: "-0.02em" }}>
              {article.title}
            </h1>

            {article.summary && (
              <p style={{ fontSize: 18, color: text2, marginBottom: 24, lineHeight: 1.5 }}>
                {article.summary}
              </p>
            )}

            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontSize: 13,
              color: text3,
              marginBottom: 40,
              paddingBottom: 24,
              borderBottom: `1px solid ${border}`,
            }}>
              <span>{article.view_count} visualizações</span>
              <span>·</span>
              <span>Atualizado em {new Date(article.updated_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}</span>
            </div>

            <div
              className="article-content"
              style={{ fontSize: 16, lineHeight: 1.7, color: text1 }}
              dangerouslySetInnerHTML={{ __html: article.content || "" }}
            />
          </article>
        )}
      </main>

      <style jsx global>{`
        .article-content h1, .article-content h2, .article-content h3 {
          margin-top: 32px;
          margin-bottom: 12px;
          font-weight: 600;
          line-height: 1.3;
        }
        .article-content h2 { font-size: 24px; }
        .article-content h3 { font-size: 20px; }
        .article-content p { margin-bottom: 16px; }
        .article-content ul, .article-content ol {
          margin: 12px 0 16px 0;
          padding-left: 24px;
        }
        .article-content li { margin-bottom: 6px; }
        .article-content a {
          color: ${primaryColor};
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .article-content code {
          background: rgba(255,255,255,0.06);
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 14px;
          font-family: 'SF Mono', Monaco, monospace;
        }
        .article-content pre {
          background: rgba(255,255,255,0.04);
          padding: 16px;
          border-radius: 12px;
          overflow-x: auto;
          margin: 20px 0;
          border: 1px solid ${border};
        }
        .article-content pre code {
          background: transparent;
          padding: 0;
        }
        .article-content img, .article-content video {
          max-width: 100%;
          border-radius: 12px;
          margin: 20px 0;
        }
        .article-content blockquote {
          border-left: 3px solid ${primaryColor};
          padding-left: 16px;
          margin: 20px 0;
          color: ${text2};
          font-style: italic;
        }
        .article-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
        }
        .article-content th, .article-content td {
          padding: 10px 14px;
          border: 1px solid ${border};
          text-align: left;
        }
        .article-content th {
          background: rgba(255,255,255,0.04);
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
