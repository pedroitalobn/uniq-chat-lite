"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft, Check, ChevronDown, Loader2, Save, Sparkles, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { helpDeskApi, type HelpDeskArticle } from "@/lib/helpdesk-api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { RichTextEditor } from "@/components/helpdesk/RichTextEditor";

// escapeHTML — usado quando o content legado vem em Markdown puro e
// queremos exibir no Tiptap como texto, sem interpretar caracteres especiais
// como tags. O & precisa ser escapado primeiro pra não duplicar.
function escapeHTML(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── Style helpers ─────────────────────────────────────────────────────────

const glassCard: CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "20px",
};

const inp: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid var(--surface-border)",
  background: "var(--surface-3)",
  color: "var(--text-1)",
  padding: "10px 14px",
  fontSize: 14,
  outline: "none",
};

const STATUS_BADGE: Record<HelpDeskArticle["status"], CSSProperties> = {
  draft: { background: "rgba(255,255,255,0.10)", color: "var(--text-3)", border: "1px solid rgba(255,255,255,0.08)" },
  published: { background: "rgba(0,212,106,0.12)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.20)" },
  archived: { background: "rgba(255,191,36,0.10)", color: "#fbbf24", border: "1px solid rgba(255,191,36,0.20)" },
};

const STATUS_LABELS: Record<HelpDeskArticle["status"], string> = {
  draft: "Rascunho",
  published: "Publicado",
  archived: "Arquivado",
};

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ArticleEditorPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";
  const articleId = params.id as string;

  // Form state
  const [title, setTitle] = useState("Novo artigo");
  const [content, setContent] = useState("");
  const [summary, setSummary] = useState("");
  const [slug, setSlug] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [heroImageURL, setHeroImageURL] = useState<string>("");
  const [slugTouched, setSlugTouched] = useState(false);

  // UI state
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAIImprove, setShowAIImprove] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Categories
  const categoriesQuery = useQuery({
    queryKey: ["helpdesk-categories", wsId],
    queryFn: async () => (await helpDeskApi.listCategories(wsId)).data ?? [],
    enabled: !!wsId,
  });

  // Fetch article. Header X-Workspace-ID é obrigatório no backend (sem
  // ele as rotas /v1/helpdesk/articles/* respondem 401).
  const articleQuery = useQuery({
    queryKey: ["helpdesk-article", articleId, wsId],
    queryFn: async () => (await helpDeskApi.getArticle(articleId, wsId)).data,
    enabled: !!articleId && !!wsId,
  });

  useEffect(() => {
    const data = articleQuery.data;
    if (!data) return;
    setTitle(data.title ?? "");
    // Markdown legacy: se o content não tem tags HTML, tratamos como texto
    // puro e injetamos num parágrafo. O Tiptap normaliza no primeiro save.
    const raw = data.content ?? "";
    const looksLikeHTML = /<[a-zA-Z][^>]*>/.test(raw);
    setContent(looksLikeHTML ? raw : raw.split(/\n{2,}/).map((p) => `<p>${escapeHTML(p)}</p>`).join(""));
    setSummary(data.summary ?? "");
    setSlug(data.slug ?? "");
    setCategoryId(data.category_id ?? "");
    setHeroImageURL(data.hero_image_url ?? "");
  }, [articleQuery.data]);

  // Auto-derive slug from title unless the user touched it
  useEffect(() => {
    if (!slugTouched && title) {
      setSlug(slugify(title));
    }
  }, [title, slugTouched]);

  // Debounced auto-save
  const autoSave = useCallback(
    (patch: Partial<HelpDeskArticle>) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      setSaveStatus("saving");
      saveTimerRef.current = setTimeout(async () => {
        try {
          await helpDeskApi.updateArticle(articleId, patch, wsId);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
          setSaveStatus("idle");
        }
      }, 1500);
    },
    [articleId, wsId],
  );

  // Mutations — todas precisam do wsId pra montar o header X-Workspace-ID.
  // Sem ele o backend retorna 401 e o "Publicar"/"Salvar" silencia.
  const saveMutation = useMutation({
    mutationFn: () =>
      helpDeskApi.updateArticle(articleId, {
        title,
        content,
        summary,
        slug,
        category_id: categoryId || undefined,
        hero_image_url: heroImageURL || undefined,
      }, wsId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helpdesk-article", articleId] });
      qc.invalidateQueries({ queryKey: ["helpdesk-articles"] });
      toast.success("Artigo salvo.");
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao salvar."),
  });

  const publishMutation = useMutation({
    mutationFn: () =>
      articleQuery.data?.status === "published"
        ? helpDeskApi.updateArticle(articleId, { status: "draft" }, wsId)
        : helpDeskApi.publishArticle(articleId, wsId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helpdesk-article", articleId] });
      qc.invalidateQueries({ queryKey: ["helpdesk-articles"] });
      toast.success(
        articleQuery.data?.status === "published" ? "Artigo despublicado." : "Artigo publicado!",
      );
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao publicar."),
  });

  const deleteMutation = useMutation({
    mutationFn: () => helpDeskApi.deleteArticle(articleId, wsId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helpdesk-articles"] });
      toast.success("Artigo removido.");
      router.push("/help-desk");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao remover."),
  });

  const aiMutation = useMutation({
    mutationFn: () =>
      helpDeskApi.generateArticle({ prompt: aiPrompt, category_id: categoryId || undefined }, wsId),
    onSuccess: (res) => {
      const { content: newContent, summary: newSummary } = res.data;
      setContent(newContent);
      setSummary(newSummary);
      autoSave({ content: newContent, summary: newSummary });
      setShowAIImprove(false);
      setAiPrompt("");
      toast.success("Conteúdo melhorado com IA.");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao gerar com IA."),
  });

  const currentStatus = articleQuery.data?.status ?? "draft";
  const categories = categoriesQuery.data ?? [];

  // Loader cobre 3 estados: workspace context ainda não chegou (wsId
  // vazio), query carregando, ou query disabled mas dados ainda
  // ausentes. Antes só checava isLoading — quando a query estava
  // disabled (porque wsId era ""), isLoading=false e a página
  // renderizava com defaults vazios. Hard refresh "consertava"
  // porque o context recarregava antes do primeiro render.
  if (!wsId || articleQuery.isLoading || (!articleQuery.isFetched && !articleQuery.data)) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--text-3)" }} />
      </div>
    );
  }
  if (articleQuery.isError || !articleQuery.data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-sm" style={{ color: "var(--text-2)" }}>Não foi possível carregar este artigo.</p>
        <button onClick={() => articleQuery.refetch()}
          className="px-3 py-1.5 rounded-lg text-xs font-medium"
          style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <button
            onClick={() => router.push("/help-desk")}
            className="inline-flex items-center gap-1.5 text-xs mb-3 px-2.5 py-1.5 rounded-lg transition-all"
            style={{ color: "var(--text-3)", background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}
          >
            <ArrowLeft className="w-3 h-3" />
            Help Desk
          </button>

          {/* Editable title */}
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              autoSave({ title: e.target.value });
            }}
            className="text-2xl sm:text-3xl font-bold bg-transparent outline-none w-full"
            style={{ color: "var(--text-1)", border: "none", padding: 0 }}
            placeholder="Título do artigo"
          />

          <div className="flex items-center gap-2 mt-2">
            <span
              className="text-[11px] px-2.5 py-1 rounded-full font-medium"
              style={STATUS_BADGE[currentStatus]}
            >
              {STATUS_LABELS[currentStatus]}
            </span>
            {saveStatus === "saving" && (
              <span className="text-xs flex items-center gap-1" style={{ color: "var(--text-3)" }}>
                <Loader2 className="w-3 h-3 animate-spin" /> Salvando...
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="text-xs flex items-center gap-1" style={{ color: "#00d46a" }}>
                <Check className="w-3 h-3" /> Salvo
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Preview público — abre /help/[ws-slug]/[article-slug] em
              outra aba. Visível só com slug + status published, senão
              abre 404. */}
          <PreviewButton workspaceId={wsId} articleSlug={slug} status={currentStatus} />
          <button
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending}
            className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              background:
                currentStatus === "published"
                  ? "rgba(255,191,36,0.12)"
                  : "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
              color: currentStatus === "published" ? "#fbbf24" : "#00d46a",
              border: `1px solid ${currentStatus === "published" ? "rgba(255,191,36,0.25)" : "rgba(0,212,106,0.30)"}`,
            }}
          >
            {publishMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : currentStatus === "published" ? (
              "Despublicar"
            ) : (
              "Publicar"
            )}
          </button>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              background: "var(--surface-3)",
              color: "var(--text-2)",
              border: "1px solid var(--surface-border)",
            }}
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Salvar
          </button>

          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-2 rounded-xl transition-all"
            style={{ background: "rgba(239,68,68,0.10)", color: "#f87171", border: "1px solid rgba(239,68,68,0.18)" }}
            title="Excluir artigo"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main 70/30 split */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5">
        {/* LEFT — Content */}
        <div className="space-y-4" style={{ ...glassCard, padding: 20 }}>
          {/* Hero image: capa exibida no topo do artigo público.
              Aceita upload pra bucket (MinIO/S3) OU URL externa. */}
          <HeroImageField
            value={heroImageURL}
            onChange={(v) => { setHeroImageURL(v); autoSave({ hero_image_url: v || undefined }); }}
            wsId={wsId}
          />

          {/* Title (já renderizado fora desse bloco como input grande;
              repetimos o label aqui só pra clareza visual) */}

          {/* Rich text editor — Tiptap. Suporta headings, listas, links,
              imagens, vídeos do YouTube e HTML embed (iframes / áudio /
              vídeo). Substitui o textarea de Markdown anterior. */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-widest" style={{ color: "var(--text-3)" }}>
                Corpo do artigo
              </label>
              <span className="text-xs" style={{ color: "var(--text-3)" }}>
                Tip: cole URL do YouTube no botão ▶ pra embedar vídeo
              </span>
            </div>
            <RichTextEditor
              value={content}
              onChange={(html) => {
                setContent(html);
                autoSave({ content: html });
              }}
              placeholder="Comece a escrever… use a barra acima pra formatar (headings, listas, imagens, vídeos, embeds HTML)."
            />
          </div>

          {/* Bloco antigo do textarea — mantido escondido pra não quebrar
              o layout enquanto migra. Removido em commit subsequente. */}
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              autoSave({ content: e.target.value });
            }}
            placeholder="(legacy — não use)"
            style={{
              display: "none",
              ...inp,
              minHeight: 500,
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: 1.7,
              resize: "vertical",
              background: "rgba(0,0,0,0.25)",
            }}
          />
        </div>

        {/* RIGHT — Metadata + AI */}
        <div className="space-y-4">
          {/* Metadata card */}
          <div style={{ ...glassCard, padding: 20 }} className="space-y-4">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Metadados</h3>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Categoria</label>
              <select
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  autoSave({ category_id: e.target.value || undefined });
                }}
                style={inp}
              >
                <option value="">Sem categoria</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Resumo</label>
              <textarea
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  autoSave({ summary: e.target.value });
                }}
                placeholder="Breve descrição do artigo..."
                style={{ ...inp, minHeight: 80, resize: "vertical" }}
              />
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Slug</label>
              <input
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                  autoSave({ slug: e.target.value });
                }}
                placeholder="meu-artigo-de-ajuda"
                style={inp}
              />
              <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
                Derivado automaticamente do título.
              </p>
            </div>
          </div>

          {/* AI Improve card */}
          <div style={{ ...glassCard, padding: 20, border: "1px solid rgba(139,92,246,0.18)" }} className="space-y-3">
            <button
              onClick={() => setShowAIImprove((v) => !v)}
              className="w-full flex items-center justify-between text-sm font-medium"
              style={{ color: "#a78bfa" }}
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Gerar / Melhorar com IA
              </span>
              <ChevronDown
                className="w-4 h-4 transition-transform"
                style={{ transform: showAIImprove ? "rotate(180deg)" : "rotate(0deg)" }}
              />
            </button>

            {showAIImprove && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-3 overflow-hidden"
              >
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Ex: Melhore a clareza, adicione exemplos práticos, reescreva em tom mais amigável..."
                  style={{ ...inp, minHeight: 90, resize: "vertical", fontSize: 13 }}
                />
                <button
                  onClick={() => aiMutation.mutate()}
                  disabled={!aiPrompt.trim() || aiMutation.isPending}
                  className="w-full py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
                  style={{
                    background: "linear-gradient(135deg, rgba(167,139,250,0.20), rgba(139,92,246,0.10))",
                    color: "#a78bfa",
                    border: "1px solid rgba(139,92,246,0.25)",
                    opacity: !aiPrompt.trim() || aiMutation.isPending ? 0.6 : 1,
                  }}
                >
                  {aiMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</>
                  ) : (
                    <><Sparkles className="w-4 h-4" /> Aplicar</>
                  )}
                </button>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  O conteúdo atual será substituído pelo resultado da IA.
                </p>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation overlay */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.70)", backdropFilter: "blur(4px)" }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{ ...glassCard, maxWidth: 400, width: "100%", padding: 24 }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Excluir artigo?</h2>
              <button onClick={() => setShowDeleteConfirm(false)} className="p-1.5 rounded-lg hover:bg-white/10" style={{ color: "var(--text-3)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm mb-5" style={{ color: "var(--text-3)" }}>
              Esta ação não pode ser desfeita. O artigo será excluído permanentemente.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 py-2.5 rounded-xl text-sm"
                style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                style={{ background: "rgba(239,68,68,0.15)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }}
              >
                {deleteMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Excluir
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// ─── PreviewButton ─────────────────────────────────────────────────────────
// Lê o public_url da config (workspace slug efetivo) e abre /help/<slug>/<article>
// em nova aba. Mostra warning quando o artigo ainda é rascunho — preview
// público não funciona até publicar.

function PreviewButton({ workspaceId, articleSlug, status }: {
  workspaceId: string;
  articleSlug: string;
  status: HelpDeskArticle["status"];
}) {
  const cfgQuery = useQuery({
    queryKey: ["helpdesk-config", workspaceId],
    queryFn: async () => (await helpDeskApi.getConfig(workspaceId)).data,
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
  const publicURL = cfgQuery.data?.public_url ?? "";
  const previewURL = publicURL && articleSlug ? `${publicURL}/${articleSlug}` : "";
  const disabled = !previewURL;

  return (
    <a
      href={previewURL || "#"}
      target={previewURL ? "_blank" : undefined}
      rel="noopener noreferrer"
      onClick={(e) => {
        if (disabled) { e.preventDefault(); return; }
        if (status !== "published") {
          if (!confirm("Este artigo ainda não está publicado. O preview pode mostrar 404. Continuar?")) {
            e.preventDefault();
          }
        }
      }}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all"
      style={{
        background: "rgba(99,91,255,0.10)",
        color: disabled ? "var(--text-3)" : "#a5a3ff",
        border: "1px solid rgba(99,91,255,0.20)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
      title={disabled ? "Defina um slug pra abrir preview" : "Abrir preview público em nova aba"}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      Preview
    </a>
  );
}

// ─── HeroImageField ────────────────────────────────────────────────────────
// Permite upload pra o bucket OU colar URL externa. Quando o user
// dropa/seleciona um arquivo, sobe via /v1/helpdesk/articles/upload-hero
// e seta a URL devolvida. Pre-existente (URL externa) continua funcionando.

function HeroImageField({ value, onChange, wsId }: {
  value: string;
  onChange: (v: string) => void;
  wsId: string;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Apenas imagens.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem deve ter até 5MB.");
      return;
    }
    setUploading(true);
    try {
      const res = await helpDeskApi.uploadHeroImage(file, wsId);
      onChange(res.data.url);
      toast.success("Capa atualizada.");
    } catch (e: any) {
      toast.error(e?.response?.data?.error || "Falha no upload.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-widest mb-1.5" style={{ color: "var(--text-3)" }}>
        Imagem de capa (hero)
      </label>
      <div className="flex items-stretch gap-3">
        <div className="flex-1 flex flex-col gap-1.5">
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="https://… ou faça upload ao lado"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.10)",
              color: "var(--text-1)",
            }}
          />
          <div className="flex gap-1.5">
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "rgba(0,212,106,0.10)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.20)" }}>
              {uploading ? <Loader2 className="w-3 h-3 animate-spin" /> : (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              )}
              {uploading ? "Enviando..." : "Upload"}
            </button>
            {value && (
              <button type="button" onClick={() => onChange("")} className="px-2 py-1.5 rounded-lg text-xs"
                style={{ background: "rgba(248,113,113,0.10)", color: "#f87171", border: "1px solid rgba(248,113,113,0.20)" }}>
                Remover
              </button>
            )}
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
            Aparece como banner no topo do artigo público. PNG/JPG até 5MB.
          </p>
        </div>
        {value && (
          <div className="rounded-lg overflow-hidden flex-shrink-0"
            style={{ width: 96, height: 64, border: "1px solid rgba(255,255,255,0.10)" }}>
            <img src={value} alt="Hero preview" className="w-full h-full object-cover" />
          </div>
        )}
      </div>
    </div>
  );
}
