"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, Check, ChevronRight, Code2, Copy, ExternalLink, FolderOpen,
  Globe, Loader2, Plus, Search, Settings, Sparkles, Tag, Trash2, X,
} from "lucide-react";
import { toast } from "sonner";
import { helpDeskApi, type HelpDeskArticle, type HelpDeskCategory, type HelpDeskConfig } from "@/lib/helpdesk-api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

type PageTab = "articles" | "settings";

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

// ─── Help Center Settings ────────────────────────────────────────────────────

function HelpCenterSettings({ workspaceId }: { workspaceId: string }) {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [snippetCopied, setSnippetCopied] = useState(false);

  const configQuery = useQuery({
    queryKey: ["helpdesk-config", workspaceId],
    queryFn: async () => (await helpDeskApi.getConfig(workspaceId)).data,
    enabled: !!workspaceId,
  });

  const cfg = configQuery.data?.config;
  const publicURL = configQuery.data?.public_url ?? "";
  const effectiveSlug = configQuery.data?.effective_slug ?? "";

  const [form, setForm] = useState<Partial<HelpDeskConfig>>({});
  const initialised = useRef(false);

  useEffect(() => {
    if (cfg && !initialised.current) {
      initialised.current = true;
      setForm({
        title: cfg.title,
        description: cfg.description,
        custom_slug: cfg.custom_slug,
        primary_color: cfg.primary_color,
        logo_url: cfg.logo_url,
        widget_enabled: cfg.widget_enabled,
      });
    }
  }, [cfg]);

  const saveMutation = useMutation({
    mutationFn: () => helpDeskApi.updateConfig(form, workspaceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["helpdesk-config", workspaceId] });
      initialised.current = false;
      toast.success("Configurações salvas.");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao salvar."),
  });

  function copyURL() {
    navigator.clipboard.writeText(publicURL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const widgetColor = form.primary_color ?? "#00d46a";
  const widgetSlug = form.custom_slug || effectiveSlug;
  const widgetURL = publicURL || (typeof window !== "undefined" ? `${window.location.origin}/help/${widgetSlug}` : "");

  const embedSnippet = `<!-- Uniq Help Center Widget -->
<script>
(function(){
  var HELP_URL = "${widgetURL}";
  var COLOR = "${widgetColor}";
  var open = false;
  var btn = document.createElement('button');
  btn.innerHTML = '?';
  btn.title = 'Central de Ajuda';
  btn.style.cssText = 'position:fixed;bottom:24px;right:24px;width:52px;height:52px;border-radius:50%;background:'+COLOR+';color:#000;font-size:22px;font-weight:800;border:none;cursor:pointer;box-shadow:0 4px 24px '+COLOR+'66;z-index:99999;transition:transform 0.2s';
  btn.onmouseenter = function(){ btn.style.transform = 'scale(1.08)' };
  btn.onmouseleave = function(){ btn.style.transform = 'scale(1)' };
  var modal = document.createElement('div');
  modal.style.cssText = 'display:none;position:fixed;bottom:90px;right:24px;width:400px;height:640px;border-radius:20px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.5);z-index:99999;';
  var iframe = document.createElement('iframe');
  iframe.src = HELP_URL;
  iframe.style.cssText = 'width:100%;height:100%;border:none;';
  modal.appendChild(iframe);
  btn.addEventListener('click', function(){ open=!open; modal.style.display=open?'block':'none'; btn.innerHTML=open?'✕':'?'; });
  document.body.appendChild(btn);
  document.body.appendChild(modal);
})();
</\script>`;

  function copySnippet() {
    navigator.clipboard.writeText(embedSnippet);
    setSnippetCopied(true);
    setTimeout(() => setSnippetCopied(false), 2000);
  }

  if (configQuery.isLoading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} />
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
      {/* Left: config form */}
      <div className="space-y-5">

        {/* Public URL */}
        <div className="rounded-2xl p-5 space-y-3" style={glassCard}>
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4" style={{ color: "#00d46a" }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>URL pública do Help Center</h3>
          </div>
          {publicURL ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-xl px-3 py-2.5 text-sm font-mono truncate"
                style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>
                {publicURL}
              </div>
              <button onClick={copyURL} className="flex-shrink-0 p-2.5 rounded-xl transition-all"
                style={{ background: copied ? "rgba(0,212,106,0.15)" : "var(--surface-3)", border: "1px solid var(--surface-border)", color: copied ? "#00d46a" : "var(--text-3)" }}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
              <a href={publicURL} target="_blank" rel="noopener noreferrer"
                className="flex-shrink-0 p-2.5 rounded-xl transition-all"
                style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-3)" }}>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Configure o APP_URL no servidor para gerar a URL pública.</p>
          )}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>
              Slug personalizado (opcional)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm flex-shrink-0" style={{ color: "var(--text-3)" }}>/help/</span>
              <input
                value={form.custom_slug ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, custom_slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
                placeholder={effectiveSlug}
                style={{ ...inp, flex: 1 }}
              />
            </div>
            <p className="text-xs mt-1.5" style={{ color: "var(--text-3)" }}>
              Deixe em branco para usar o slug do workspace ({effectiveSlug}).
            </p>
          </div>
        </div>

        {/* Branding */}
        <div className="rounded-2xl p-5 space-y-4" style={glassCard}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Identidade visual</h3>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Título do Help Center</label>
            <input
              value={form.title ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder="Central de Ajuda"
              style={inp}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Descrição</label>
            <textarea
              value={form.description ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Como podemos ajudar?"
              style={{ ...inp, minHeight: 80, resize: "vertical" }}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Cor principal</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={form.primary_color ?? "#00d46a"}
                  onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))}
                  style={{ width: 40, height: 36, borderRadius: 8, border: "1px solid var(--surface-border)", background: "var(--surface-3)", cursor: "pointer", padding: 2 }}
                />
                <input
                  value={form.primary_color ?? "#00d46a"}
                  onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))}
                  style={{ ...inp, fontFamily: "monospace", flex: 1 }}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>URL do logotipo</label>
              <input
                value={form.logo_url ?? ""}
                onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))}
                placeholder="https://..."
                style={inp}
              />
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: "var(--text-2)" }}>
            <input
              type="checkbox"
              checked={form.widget_enabled ?? true}
              onChange={(e) => setForm((p) => ({ ...p, widget_enabled: e.target.checked }))}
            />
            Widget habilitado (botão flutuante na página pública)
          </label>
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
              color: "#00d46a", border: "1px solid rgba(0,212,106,0.30)",
              opacity: saveMutation.isPending ? 0.7 : 1,
            }}
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salvar configurações
          </button>
        </div>
      </div>

      {/* Right: embed snippet + preview */}
      <div className="space-y-5">
        {/* Embed snippet */}
        <div className="rounded-2xl p-5 space-y-3" style={glassCard}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4" style={{ color: "#a78bfa" }} />
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Embed widget</h3>
            </div>
            <button
              onClick={copySnippet}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: snippetCopied ? "rgba(0,212,106,0.15)" : "var(--surface-3)", color: snippetCopied ? "#00d46a" : "var(--text-2)", border: "1px solid var(--surface-border)" }}
            >
              {snippetCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {snippetCopied ? "Copiado!" : "Copiar"}
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            Cole este snippet antes do {"</body>"} do seu site para adicionar um botão flutuante que abre o Help Center.
          </p>
          <div className="rounded-xl p-3 overflow-x-auto" style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.06)" }}>
            <pre className="text-xs font-mono whitespace-pre-wrap" style={{ color: "#a78bfa", margin: 0 }}>
              {embedSnippet}
            </pre>
          </div>
        </div>

        {/* Live preview */}
        <div className="rounded-2xl p-5 space-y-3" style={glassCard}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Preview do widget</h3>
          <div className="relative rounded-xl overflow-hidden flex items-center justify-center"
            style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", height: 200 }}>
            <div style={{ position: "absolute", bottom: 20, right: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: widgetColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: "#000", boxShadow: `0 4px 20px ${widgetColor}66` }}>?</div>
            </div>
            <p className="text-xs text-center px-4" style={{ color: "rgba(255,255,255,0.3)" }}>
              Botão flutuante aparece no canto inferior direito do seu site
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 6, background: widgetColor, flexShrink: 0 }} />
            <div className="min-w-0">
              <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>{form.title || "Central de Ajuda"}</p>
              <p className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>{widgetURL || "Configure o APP_URL para gerar a URL"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function HelpDeskPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";

  const [activeTab, setActiveTab] = useState<PageTab>("articles");
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
        {activeTab === "articles" && (
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
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
        {([
          { id: "articles", label: "Artigos", icon: BookOpen },
          { id: "settings", label: "Configurações", icon: Settings },
        ] as const).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{
              background: activeTab === id ? "var(--surface-2)" : "transparent",
              color: activeTab === id ? "var(--text-1)" : "var(--text-3)",
              border: activeTab === id ? "1px solid var(--surface-border)" : "1px solid transparent",
            }}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Settings tab */}
      {activeTab === "settings" && <HelpCenterSettings workspaceId={wsId} />}

      {/* Articles tab — Two-panel layout */}
      {activeTab === "articles" && (<>
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
      </>)}
    </div>
  );
}

