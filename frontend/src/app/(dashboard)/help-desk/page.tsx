"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  BookOpen, Check, ChevronRight, Clock, Code2, Copy, ExternalLink, FolderOpen,
  Globe, Loader2, Plus, Search, Settings, Sparkles, Tag, Trash2, TrendingUp, X, Zap,
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

function readingTime(content?: string) {
  if (!content) return "1 min";
  const words = content.trim().split(/\s+/).length;
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min`;
}

// ─── AI Generate Dialog ─────────────────────────────────────────────────────

function AIGenerateDialog({
  categories, workspaceId, onClose, onCreated,
}: {
  categories: HelpDeskCategory[]; workspaceId: string;
  onClose: () => void; onCreated: (id: string) => void;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.70)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        style={{ ...glassCard, width: "100%", maxWidth: 520, padding: 24 }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" style={{ color: "#a78bfa" }} />
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Gerar artigo com IA</h2>
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
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Categoria (opcional)</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ ...inp }}>
              <option value="">Sem categoria</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}>
              Cancelar
            </button>
            <button
              onClick={() => generateMutation.mutate()}
              disabled={!prompt.trim() || generateMutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, rgba(167,139,250,0.25), rgba(139,92,246,0.15))",
                color: "#a78bfa", border: "1px solid rgba(139,92,246,0.30)",
                opacity: !prompt.trim() || generateMutation.isPending ? 0.6 : 1,
              }}>
              {generateMutation.isPending ? <><Loader2 className="w-4 h-4 animate-spin" /> Gerando...</> : <><Sparkles className="w-4 h-4" /> Gerar</>}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── New Category Dialog ────────────────────────────────────────────────────

function NewCategoryDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const qc = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => helpDeskApi.createCategory({ name, description, icon: "📁" }, workspaceId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["helpdesk-categories"] }); toast.success("Categoria criada."); onClose(); },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao criar categoria."),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.70)", backdropFilter: "blur(4px)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={{ ...glassCard, width: "100%", maxWidth: 440, padding: 24 }}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Nova categoria</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-all hover:bg-white/10" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da categoria" style={inp} />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição (opcional)"
            style={{ ...inp, minHeight: 80, resize: "vertical" }} />
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-medium"
              style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}>
              Cancelar
            </button>
            <button onClick={() => createMutation.mutate()} disabled={!name.trim() || createMutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))", color: "#00d46a", border: "1px solid rgba(0,212,106,0.30)", opacity: !name.trim() || createMutation.isPending ? 0.6 : 1 }}>
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
      setForm({ title: cfg.title, description: cfg.description, custom_slug: cfg.custom_slug, primary_color: cfg.primary_color, logo_url: cfg.logo_url, widget_enabled: cfg.widget_enabled });
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

  function copySnippet() { navigator.clipboard.writeText(embedSnippet); setSnippetCopied(true); setTimeout(() => setSnippetCopied(false), 2000); }
  function copyURL() { navigator.clipboard.writeText(publicURL); setCopied(true); setTimeout(() => setCopied(false), 2000); }

  if (configQuery.isLoading) return <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} /></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-6">
      <div className="space-y-5">
        <div className="rounded-2xl p-5 space-y-3" style={glassCard}>
          <div className="flex items-center gap-2 mb-1">
            <Globe className="w-4 h-4" style={{ color: "#00d46a" }} />
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>URL pública do Help Center</h3>
          </div>
          {publicURL ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-xl px-3 py-2.5 text-sm font-mono truncate"
                style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}>{publicURL}</div>
              <button onClick={copyURL} className="flex-shrink-0 p-2.5 rounded-xl transition-all"
                style={{ background: copied ? "rgba(0,212,106,0.15)" : "var(--surface-3)", border: "1px solid var(--surface-border)", color: copied ? "#00d46a" : "var(--text-3)" }}>
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
              <a href={publicURL} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 p-2.5 rounded-xl transition-all"
                style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-3)" }}>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ) : (
            <p className="text-sm" style={{ color: "var(--text-3)" }}>Configure o APP_URL no servidor para gerar a URL pública.</p>
          )}
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Slug personalizado (opcional)</label>
            <div className="flex items-center gap-2">
              <span className="text-sm flex-shrink-0" style={{ color: "var(--text-3)" }}>/help/</span>
              <input value={form.custom_slug ?? ""} onChange={(e) => setForm((p) => ({ ...p, custom_slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))} placeholder={effectiveSlug} style={{ ...inp, flex: 1 }} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-5 space-y-4" style={glassCard}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Identidade visual</h3>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Título do Help Center</label>
            <input value={form.title ?? ""} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Central de Ajuda" style={inp} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Descrição</label>
            <textarea value={form.description ?? ""} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Como podemos ajudar?" style={{ ...inp, minHeight: 80, resize: "vertical" }} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Cor principal</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.primary_color ?? "#00d46a"} onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))}
                  style={{ width: 40, height: 36, borderRadius: 8, border: "1px solid var(--surface-border)", background: "var(--surface-3)", cursor: "pointer", padding: 2 }} />
                <input value={form.primary_color ?? "#00d46a"} onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))} style={{ ...inp, fontFamily: "monospace", flex: 1 }} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>URL do logotipo</label>
              <input value={form.logo_url ?? ""} onChange={(e) => setForm((p) => ({ ...p, logo_url: e.target.value }))} placeholder="https://..." style={inp} />
            </div>
          </div>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: "var(--text-2)" }}>
            <input type="checkbox" checked={form.widget_enabled ?? true} onChange={(e) => setForm((p) => ({ ...p, widget_enabled: e.target.checked }))} />
            Widget habilitado (botão flutuante na página pública)
          </label>
        </div>

        <div className="flex justify-end">
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))", color: "#00d46a", border: "1px solid rgba(0,212,106,0.30)", opacity: saveMutation.isPending ? 0.7 : 1 }}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Salvar configurações
          </button>
        </div>
      </div>

      <div className="space-y-5">
        <div className="rounded-2xl p-5 space-y-3" style={glassCard}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Code2 className="w-4 h-4" style={{ color: "#a78bfa" }} />
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Embed widget</h3>
            </div>
            <button onClick={copySnippet} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: snippetCopied ? "rgba(0,212,106,0.15)" : "var(--surface-3)", color: snippetCopied ? "#00d46a" : "var(--text-2)", border: "1px solid var(--surface-border)" }}>
              {snippetCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {snippetCopied ? "Copiado!" : "Copiar"}
            </button>
          </div>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>Cole este snippet antes do {"</body>"} do seu site.</p>
          <div className="rounded-xl p-3 overflow-x-auto" style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.06)" }}>
            <pre className="text-xs font-mono whitespace-pre-wrap" style={{ color: "#a78bfa", margin: 0 }}>{embedSnippet}</pre>
          </div>
        </div>

        <div className="rounded-2xl p-5 space-y-3" style={glassCard}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>Preview do widget</h3>
          <div className="relative rounded-xl overflow-hidden flex items-center justify-center"
            style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", height: 200 }}>
            <div style={{ position: "absolute", bottom: 20, right: 20 }}>
              <div style={{ width: 52, height: 52, borderRadius: "50%", background: widgetColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 800, color: "#000", boxShadow: `0 4px 20px ${widgetColor}66` }}>?</div>
            </div>
            <p className="text-xs text-center px-4" style={{ color: "rgba(255,255,255,0.3)" }}>Botão flutuante no canto inferior direito</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Hero search bar ────────────────────────────────────────────────────────

function KnowledgeHero({
  search, onSearch, articleCount, publishedCount, categoryCount, onNewArticle, onAI, creating,
}: {
  search: string; onSearch: (v: string) => void;
  articleCount: number; publishedCount: number; categoryCount: number;
  onNewArticle: () => void; onAI: () => void; creating: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="relative rounded-2xl overflow-hidden p-6 sm:p-8"
      style={{
        background: "linear-gradient(135deg, rgba(0,212,106,0.06) 0%, rgba(167,139,250,0.04) 50%, rgba(255,255,255,0.02) 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(24px)",
      }}>
      {/* Decorative blobs */}
      <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(0,212,106,0.08) 0%, transparent 70%)", filter: "blur(32px)" }} />
      <div className="absolute -bottom-12 -left-12 w-40 h-40 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(167,139,250,0.07) 0%, transparent 70%)", filter: "blur(24px)" }} />

      {/* Title + actions */}
      <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          {/* Título "Base de conhecimento" + ícone agora no ModuleHeader. */}
          <p className="text-sm" style={{ color: "hsl(240 8% 50%)" }}>
            Artigos, tutoriais e FAQs para sua equipe e clientes
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={onAI}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: "linear-gradient(135deg, rgba(167,139,250,0.20), rgba(139,92,246,0.10))", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.25)" }}>
            <Sparkles className="w-4 h-4" />
            <span className="hidden sm:inline">Gerar com IA</span>
          </button>
          <button onClick={onNewArticle} disabled={creating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.97]"
            style={{ background: "linear-gradient(135deg, rgba(0,212,106,0.22), rgba(0,212,106,0.10))", color: "#00d46a", border: "1px solid rgba(0,212,106,0.32)", boxShadow: "0 4px 16px rgba(0,212,106,0.14)", opacity: creating ? 0.7 : 1 }}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Novo artigo
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none" style={{ color: "hsl(240 8% 42%)" }} />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Buscar artigos, tutoriais, FAQs..."
          className="w-full rounded-2xl text-sm transition-all"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.10)",
            color: "hsl(240 15% 90%)",
            padding: "14px 48px 14px 48px",
            outline: "none",
            backdropFilter: "blur(8px)",
          }}
          onFocus={e => {
            e.currentTarget.style.border = "1px solid rgba(0,212,106,0.30)";
            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(0,212,106,0.08)";
          }}
          onBlur={e => {
            e.currentTarget.style.border = "1px solid rgba(255,255,255,0.10)";
            e.currentTarget.style.boxShadow = "none";
          }}
        />
        <kbd className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-mono px-1.5 py-0.5 rounded hidden sm:block"
          style={{ background: "rgba(255,255,255,0.06)", color: "hsl(240 8% 40%)", border: "1px solid rgba(255,255,255,0.08)" }}>
          ⌘K
        </kbd>
        {search && (
          <button onClick={() => onSearch("")}
            className="absolute right-10 top-1/2 -translate-y-1/2 sm:right-14 p-0.5 rounded-full"
            style={{ color: "hsl(240 8% 40%)" }}>
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Stats strip */}
      <div className="relative flex items-center gap-6 mt-5 flex-wrap">
        {[
          { label: "Artigos", value: articleCount, icon: BookOpen, color: "#94a3b8" },
          { label: "Publicados", value: publishedCount, icon: TrendingUp, color: "#00d46a" },
          { label: "Categorias", value: categoryCount, icon: FolderOpen, color: "#a78bfa" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="flex items-center gap-2">
            <Icon className="w-3.5 h-3.5" style={{ color }} />
            <span className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>{value}</span>
            <span className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Article card ────────────────────────────────────────────────────────────

function ArticleCard({ article, onClick }: { article: HelpDeskArticle; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const isPublished = article.status === "published";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="cursor-pointer flex flex-col gap-3 transition-all duration-200"
      style={{
        ...glassCard,
        padding: 16,
        borderRadius: 16,
        border: hovered
          ? isPublished ? "1px solid rgba(0,212,106,0.20)" : "1px solid rgba(255,255,255,0.14)"
          : "1px solid rgba(255,255,255,0.07)",
        boxShadow: hovered ? "0 8px 28px rgba(0,0,0,0.35)" : "0 2px 12px rgba(0,0,0,0.20)",
        transform: hovered ? "translateY(-2px)" : "none",
      }}>
      {/* Top: category + status */}
      <div className="flex items-center justify-between gap-2">
        {article.category ? (
          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
            style={{ background: "rgba(255,255,255,0.08)", color: "var(--text-3)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <Tag className="w-2.5 h-2.5" />
            {article.category.name}
          </span>
        ) : <span />}
        <span className="text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0"
          style={STATUS_BADGE[article.status]}>
          {STATUS_LABELS[article.status]}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold leading-snug line-clamp-2"
        style={{ color: hovered ? "hsl(240 15% 98%)" : "hsl(240 15% 90%)", transition: "color 0.15s" }}>
        {article.title}
      </h3>

      {/* Summary */}
      {article.summary && (
        <p className="text-xs leading-relaxed line-clamp-3 flex-1" style={{ color: "var(--text-3)" }}>
          {article.summary}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-1.5"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-[11px]" style={{ color: "hsl(240 8% 42%)" }}>
            <Clock className="w-2.5 h-2.5" />
            {readingTime(article.content)}
          </span>
          <span className="text-[11px]" style={{ color: "hsl(240 8% 36%)" }}>
            {formatDate(article.updated_at)}
          </span>
        </div>
        <ChevronRight className="w-3.5 h-3.5 transition-transform duration-150"
          style={{ color: "hsl(240 8% 36%)", transform: hovered ? "translateX(2px)" : "none" }} />
      </div>
    </motion.div>
  );
}

// ─── Category pills ──────────────────────────────────────────────────────────

function CategoryPills({
  categories, selectedId, onSelect, onNew, onDelete, loading,
}: {
  categories: HelpDeskCategory[]; selectedId: string | null;
  onSelect: (id: string | null) => void; onNew: () => void;
  onDelete: (id: string) => void; loading: boolean;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => onSelect(null)}
        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl transition-all duration-150"
        style={selectedId === null ? {
          background: "rgba(0,212,106,0.12)", color: "#00d46a",
          border: "1px solid rgba(0,212,106,0.25)", borderRadius: 10,
        } : {
          background: "rgba(255,255,255,0.04)", color: "hsl(240 8% 52%)",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10,
        }}>
        <FolderOpen className="w-3 h-3" />
        Todos
      </button>

      {loading && [1, 2, 3].map(i => (
        <div key={i} className="animate-pulse h-7 rounded-xl w-20" style={{ background: "var(--surface-2)" }} />
      ))}

      {categories.map((cat) => (
        <div key={cat.id} className="group relative flex items-center">
          <button
            onClick={() => onSelect(cat.id)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-xl transition-all duration-150"
            style={selectedId === cat.id ? {
              background: "rgba(0,212,106,0.12)", color: "#00d46a",
              border: "1px solid rgba(0,212,106,0.25)", borderRadius: 10,
            } : {
              background: "rgba(255,255,255,0.04)", color: "hsl(240 8% 52%)",
              border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10,
            }}>
            <span>{cat.icon || "📁"}</span>
            {cat.name}
            {cat.article_count !== undefined && (
              <span className="text-[10px] px-1 rounded-full ml-0.5"
                style={{ background: "rgba(255,255,255,0.08)", color: "hsl(240 8% 40%)" }}>
                {cat.article_count}
              </span>
            )}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(cat.id); }}
            className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: "rgba(239,68,68,0.80)", color: "white" }}>
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}

      <button
        onClick={onNew}
        className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-xl transition-all duration-150"
        style={{ color: "hsl(240 8% 40%)", border: "1px dashed rgba(255,255,255,0.10)", borderRadius: 10 }}>
        <Plus className="w-3 h-3" />
        Nova
      </button>
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
      (await helpDeskApi.listArticles({ category_id: selectedCategoryId ?? undefined, status: statusFilter === "all" ? undefined : statusFilter, q: search || undefined }, wsId)).data ?? [],
    enabled: !!wsId,
  });

  const createArticleMutation = useMutation({
    mutationFn: () => helpDeskApi.createArticle({ title: "Novo artigo", status: "draft", category_id: selectedCategoryId ?? undefined }, wsId),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["helpdesk-articles"] }); router.push(`/help-desk/${res.data.id}`); },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Não foi possível criar artigo."),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (id: string) => helpDeskApi.deleteCategory(id, wsId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["helpdesk-categories"] }); setSelectedCategoryId(null); toast.success("Categoria removida."); },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao remover."),
  });

  const categories = categoriesQuery.data ?? [];
  const articles = articlesQuery.data ?? [];
  const publishedCount = articles.filter(a => a.status === "published").length;

  return (
    <div className="space-y-5">
      {/* Header com link da central pública sempre visível — admin
          não precisa entrar em "Configurações" só pra copiar/abrir
          a URL. publicURL vem do mesmo configQuery que o widget usa. */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <PublicCenterLink workspaceId={wsId} />
        <div className="flex gap-1 p-1 rounded-xl w-fit"
          style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
          {([
            { id: "articles", label: "Artigos", icon: BookOpen },
            { id: "settings", label: "Configurações", icon: Settings },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                background: activeTab === id ? "var(--surface-2)" : "transparent",
                color: activeTab === id ? "var(--text-1)" : "var(--text-3)",
                border: activeTab === id ? "1px solid var(--surface-border)" : "1px solid transparent",
              }}>
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Settings tab */}
      {activeTab === "settings" && <HelpCenterSettings workspaceId={wsId} />}

      {/* Articles tab */}
      {activeTab === "articles" && (
        <div className="space-y-5">
          {/* Hero search */}
          <KnowledgeHero
            search={search}
            onSearch={setSearch}
            articleCount={articles.length}
            publishedCount={publishedCount}
            categoryCount={categories.length}
            onNewArticle={() => createArticleMutation.mutate()}
            onAI={() => setShowAIDialog(true)}
            creating={createArticleMutation.isPending}
          />

          {/* Category pills + status filters */}
          <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
            <CategoryPills
              categories={categories}
              selectedId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
              onNew={() => setShowCategoryDialog(true)}
              onDelete={(id) => deleteCategoryMutation.mutate(id)}
              loading={categoriesQuery.isLoading}
            />
            <div className="flex gap-1.5 flex-shrink-0">
              {(["all", "draft", "published", "archived"] as StatusFilter[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className="px-2.5 py-1.5 rounded-xl text-[11px] font-medium transition-all"
                  style={{
                    background: statusFilter === s ? "rgba(0,212,106,0.12)" : "var(--surface-3)",
                    color: statusFilter === s ? "#00d46a" : "var(--text-3)",
                    border: `1px solid ${statusFilter === s ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
                  }}>
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Articles grid */}
          {articlesQuery.isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="animate-pulse rounded-2xl"
                  style={{ background: "var(--surface-3)", height: 180, border: "1px solid var(--surface-border)" }} />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl"
              style={{ border: "1px dashed rgba(255,255,255,0.08)" }}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                {search ? <Search className="w-6 h-6" style={{ color: "hsl(240 8% 35%)" }} /> : <BookOpen className="w-6 h-6" style={{ color: "hsl(240 8% 35%)" }} />}
              </div>
              <h3 className="text-sm font-medium mb-1" style={{ color: "hsl(240 8% 70%)" }}>
                {search ? `Nenhum resultado para "${search}"` : "Nenhum artigo encontrado"}
              </h3>
              <p className="text-xs mb-6" style={{ color: "hsl(240 8% 42%)" }}>
                {search ? "Tente termos diferentes ou remova os filtros." : "Crie o primeiro artigo de ajuda."}
              </p>
              {!search && (
                <button onClick={() => createArticleMutation.mutate()} disabled={createArticleMutation.isPending}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))", color: "#00d46a", border: "1px solid rgba(0,212,106,0.30)" }}>
                  <Plus className="w-4 h-4" /> Criar primeiro artigo
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {articles.map((article) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  onClick={() => router.push(`/help-desk/${article.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      <AnimatePresence>
        {showAIDialog && (
          <AIGenerateDialog
            categories={categories}
            workspaceId={wsId}
            onClose={() => setShowAIDialog(false)}
            onCreated={(id) => { setShowAIDialog(false); router.push(`/help-desk/${id}`); }}
          />
        )}
        {showCategoryDialog && (
          <NewCategoryDialog workspaceId={wsId} onClose={() => setShowCategoryDialog(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}


// PublicCenterLink — pill com a URL pública da central. Mostra
// "Central pública" + chip da URL clicável + botão de copiar.
// Visível no topo de /help-desk pra admin abrir/compartilhar sem
// precisar entrar em Configurações.
function PublicCenterLink({ workspaceId }: { workspaceId: string }) {
  const cfg = useQuery({
    queryKey: ["helpdesk-config", workspaceId],
    queryFn: async () => (await helpDeskApi.getConfig(workspaceId)).data,
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
  const url = cfg.data?.public_url ?? "";
  const slug = cfg.data?.effective_slug ?? "";
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!url) {
    return (
      <div className="text-xs" style={{ color: "var(--text-3)" }}>
        Configure o slug em <strong style={{ color: "var(--text-2)" }}>Configurações</strong> pra ativar a central pública.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: "var(--text-3)" }}>
        Central pública
      </span>
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono transition-all"
        style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)", color: "var(--text-2)" }}
        title="Abrir em nova aba">
        <Globe className="w-3 h-3" style={{ color: "#00d46a" }} />
        /{slug}
        <ExternalLink className="w-2.5 h-2.5 opacity-60" />
      </a>
      <button onClick={copy}
        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] transition-all"
        style={{ background: copied ? "rgba(0,212,106,0.10)" : "transparent", border: "1px solid var(--surface-border)", color: copied ? "var(--green)" : "var(--text-3)" }}
        title="Copiar URL completa">
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}
