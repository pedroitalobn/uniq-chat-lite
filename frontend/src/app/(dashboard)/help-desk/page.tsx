"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, ChevronRight, FolderOpen, Loader2, Plus, Search,
  Sparkles, Tag, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { helpDeskApi, type HelpDeskArticle, type HelpDeskCategory } from "@/lib/helpdesk-api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

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

type StatusFilter = "all" | "draft" | "published" | "archived";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Todos",
  draft: "Rascunho",
  published: "Publicado",
  archived: "Arquivado",
};

const STATUS_BADGE: Record<HelpDeskArticle["status"], CSSProperties> = {
  draft: { background: "rgba(255,255,255,0.10)", color: "var(--text-3)", border: "1px solid rgba(255,255,255,0.08)" },
  published: { background: "rgba(0,212,106,0.12)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.20)" },
  archived: { background: "rgba(255,191,36,0.10)", color: "#fbbf24", border: "1px solid rgba(255,191,36,0.20)" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

// ─── AI Generate Dialog ─────────────────────────────────────────────────────

function AIGenerateDialog({
  categories,
  workspaceId,
  onClose,
  onCreated,
}: {
  categories: HelpDeskCategory[];
  workspaceId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const qc = useQueryClient();

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await helpDeskApi.generateArticle({ prompt, category_id: categoryId || undefined }, workspaceId);
      const { title, content, summary } = res.data;
      const articleRes = await helpDeskApi.createArticle(
        { title, content, summary, status: "draft", category_id: categoryId || undefined },
        workspaceId,
      );
      return articleRes.data;
    },
    onSuccess: (article) => {
      qc.invalidateQueries({ queryKey: ["helpdesk-articles"] });
      toast.success("Artigo gerado com IA!");
      onCreated(article.id);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao gerar artigo."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.70)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{ ...glassCard, width: "100%", maxWidth: 520, padding: 24 }}
      >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" style={{ color: "#a78bfa" }} />
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
              Gerar artigo com IA
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-all hover:bg-white/10" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>
              Descreva o artigo que deseja criar
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ex: Como redefinir minha senha, passo a passo para usuários iniciantes..."
              style={{ ...inp, minHeight: 120, resize: "vertical" }}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>
              Categoria (opcional)
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{ ...inp }}
            >
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}
            >
              Cancelar
            </button>
            <button
              onClick={() => generateMutation.mutate()}
              disabled={!prompt.trim() || generateMutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, rgba(167,139,250,0.25), rgba(139,92,246,0.15))",
                color: "#a78bfa",
                border: "1px solid rgba(139,92,246,0.30)",
                opacity: !prompt.trim() || generateMutation.isPending ? 0.6 : 1,
              }}
            >
              {generateMutation.isPending ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Gerar</>
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── New Category Dialog ────────────────────────────────────────────────────

function NewCategoryDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () =>
      helpDeskApi.createCategory({ name, description, icon: "📁" }, workspaceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helpdesk-categories"] });
      toast.success("Categoria criada.");
      onClose();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao criar categoria."),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.70)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ ...glassCard, width: "100%", maxWidth: 440, padding: 24 }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Nova categoria</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-all hover:bg-white/10" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome da categoria"
            style={inp}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descrição (opcional)"
            style={{ ...inp, minHeight: 80, resize: "vertical" }}
          />
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}
            >
              Cancelar
            </button>
            <button
              onClick={() => createMutation.mutate()}
              disabled={!name.trim() || createMutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
                color: "#00d46a",
                border: "1px solid rgba(0,212,106,0.30)",
                opacity: !name.trim() || createMutation.isPending ? 0.6 : 1,
              }}
            >
              {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Criar
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function HelpDeskPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";

  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [showAIDialog, setShowAIDialog] = useState(false);
  const [showCategoryDialog, setShowCategoryDialog] = useState(false);

  const categoriesQuery = useQuery({
    queryKey: ["helpdesk-categories", wsId],
    queryFn: async () => (await helpDeskApi.listCategories(wsId)).data ?? [],
    enabled: !!wsId,
  });

  const articlesQuery = useQuery({
    queryKey: ["helpdesk-articles", wsId, selectedCategoryId, statusFilter, search],
    queryFn: async () =>
      (
        await helpDeskApi.listArticles(
          {
            category_id: selectedCategoryId ?? undefined,
            status: statusFilter === "all" ? undefined : statusFilter,
            q: search || undefined,
          },
          wsId,
        )
      ).data ?? [],
    enabled: !!wsId,
  });

  const createArticleMutation = useMutation({
    mutationFn: () =>
      helpDeskApi.createArticle(
        { title: "Novo artigo", status: "draft", category_id: selectedCategoryId ?? undefined },
        wsId,
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["helpdesk-articles"] });
      router.push(`/help-desk/${res.data.id}`);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Não foi possível criar artigo."),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => helpDeskApi.deleteCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helpdesk-categories"] });
      setSelectedCategoryId(null);
      toast.success("Categoria removida.");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao remover."),
  });

  const categories = categoriesQuery.data ?? [];
  const articles = articlesQuery.data ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-medium flex items-center gap-2.5" style={{ color: "var(--text-1)" }}>
            <BookOpen className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: "#00d46a" }} />
            Help Desk
          </h1>
          <p className="text-xs sm:text-sm mt-1" style={{ color: "var(--text-3)" }}>
            Base de conhecimento centralizada — artigos, tutoriais e FAQs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAIDialog(true)}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(167,139,250,0.20), rgba(139,92,246,0.10))",
              color: "#a78bfa",
              border: "1px solid rgba(139,92,246,0.25)",
            }}
          >
            <Sparkles className="w-4 h-4" />
            Gerar com IA
          </button>
          <button
            onClick={() => createArticleMutation.mutate()}
            disabled={createArticleMutation.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
              color: "#00d46a",
              border: "1px solid rgba(0,212,106,0.30)",
              boxShadow: "0 4px 16px rgba(0,212,106,0.12)",
              opacity: createArticleMutation.isPending ? 0.7 : 1,
            }}
          >
            {createArticleMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
            Novo artigo
          </button>
        </div>
      </div>

      {/* Two-panel layout */}
      <div className="flex gap-5 items-start">
        {/* Categories Sidebar */}
        <aside className="flex-shrink-0 w-60 space-y-1" style={{ ...glassCard, padding: "12px 8px" }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest px-3 mb-2" style={{ color: "var(--text-3)" }}>
            Categorias
          </p>

          {/* All */}
          <button
            onClick={() => setSelectedCategoryId(null)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all"
            style={{
              background: selectedCategoryId === null ? "rgba(0,212,106,0.10)" : "transparent",
              color: selectedCategoryId === null ? "#00d46a" : "var(--text-2)",
            }}
          >
            <span className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              Todos
            </span>
            <span
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-3)" }}
            >
              {articles.length}
            </span>
          </button>

          {categoriesQuery.isLoading &&
            [1, 2, 3].map((i) => (
              <div key={i} className="h-9 rounded-xl animate-pulse mx-1" style={{ background: "var(--surface-3)" }} />
            ))}

          {categories.map((cat) => (
            <div key={cat.id} className="group flex items-center gap-1">
              <button
                onClick={() => setSelectedCategoryId(cat.id)}
                className="flex-1 flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-all"
                style={{
                  background: selectedCategoryId === cat.id ? "rgba(0,212,106,0.10)" : "transparent",
                  color: selectedCategoryId === cat.id ? "#00d46a" : "var(--text-2)",
                }}
              >
                <span className="flex items-center gap-2 truncate">
                  <span>{cat.icon || "📁"}</span>
                  <span className="truncate">{cat.name}</span>
                </span>
                {cat.article_count !== undefined && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded-full flex-shrink-0"
                    style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-3)" }}
                  >
                    {cat.article_count}
                  </span>
                )}
              </button>
              <button
                onClick={() => deleteCategoryMutation.mutate(cat.id)}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all"
                style={{ color: "var(--text-3)" }}
                title="Remover categoria"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}

          {/* Add category */}
          <button
            onClick={() => setShowCategoryDialog(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all mt-2"
            style={{ color: "var(--text-3)", border: "1px dashed rgba(255,255,255,0.12)" }}
          >
            <Plus className="w-3.5 h-3.5" />
            Nova categoria
          </button>
        </aside>

        {/* Articles main area */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Search + status filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "var(--text-3)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar artigos..."
                style={{ ...inp, paddingLeft: 36 }}
              />
            </div>
            <div className="flex gap-1.5">
              {(["all", "draft", "published", "archived"] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className="px-3 py-2 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: statusFilter === s ? "rgba(0,212,106,0.12)" : "var(--surface-3)",
                    color: statusFilter === s ? "#00d46a" : "var(--text-3)",
                    border: `1px solid ${statusFilter === s ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
                  }}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Articles grid */}
          {articlesQuery.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl"
                  style={{ background: "var(--surface-3)", height: 160, border: "1px solid var(--surface-border)" }}
                />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <BookOpen className="w-12 h-12 mb-4 opacity-30" style={{ color: "var(--text-3)" }} />
              <h3 className="text-base font-medium mb-1" style={{ color: "var(--text-1)" }}>
                Nenhum artigo encontrado
              </h3>
              <p className="text-sm mb-6" style={{ color: "var(--text-3)" }}>
                Crie seu primeiro artigo de ajuda para a base de conhecimento.
              </p>
              <button
                onClick={() => createArticleMutation.mutate()}
                disabled={createArticleMutation.isPending}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
                style={{
                  background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
                  color: "#00d46a",
                  border: "1px solid rgba(0,212,106,0.30)",
                }}
              >
                <Plus className="w-4 h-4" /> Criar primeiro artigo
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {articles.map((article) => (
                <motion.div
                  key={article.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  onClick={() => router.push(`/help-desk/${article.id}`)}
                  className="cursor-pointer rounded-2xl p-4 flex flex-col gap-3 transition-all hover:scale-[1.01]"
                  style={{
                    ...glassCard,
                    borderRadius: 16,
                    boxShadow: "0 2px 12px rgba(0,0,0,0.20)",
                  }}
                >
                  {/* Top row: category + status */}
                  <div className="flex items-center justify-between gap-2">
                    {article.category ? (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-3)", border: "1px solid rgba(255,255,255,0.08)" }}
                      >
                        <Tag className="w-2.5 h-2.5" />
                        {article.category.name}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span
                      className="text-[11px] px-2 py-0.5 rounded-full font-medium"
                      style={STATUS_BADGE[article.status]}
                    >
                      {STATUS_LABELS[article.status]}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-sm font-semibold leading-snug line-clamp-2" style={{ color: "var(--text-1)" }}>
                    {article.title}
                  </h3>

                  {/* Summary */}
                  {article.summary && (
                    <p className="text-xs leading-relaxed line-clamp-3 flex-1" style={{ color: "var(--text-3)" }}>
                      {article.summary}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-auto pt-1">
                    <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                      {formatDate(article.updated_at)}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5" style={{ color: "var(--text-3)" }} />
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <AnimatePresence>
        {showAIDialog && (
          <AIGenerateDialog
            categories={categories}
            workspaceId={wsId}
            onClose={() => setShowAIDialog(false)}
            onCreated={(id) => {
              setShowAIDialog(false);
              router.push(`/help-desk/${id}`);
            }}
          />
        )}
        {showCategoryDialog && (
          <NewCategoryDialog
            workspaceId={wsId}
            onClose={() => setShowCategoryDialog(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
