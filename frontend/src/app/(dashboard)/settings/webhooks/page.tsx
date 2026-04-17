"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Webhook, Plus, Trash2, Play, CheckCircle2, XCircle, Search, Globe,
  Pencil, X, Copy, Check, ChevronDown, ChevronRight, Loader2,
} from "lucide-react";
import { globalWebhooksApi } from "@/lib/api";
import { toast } from "sonner";

interface SystemEvent {
  id: string;
  name: string;
  description: string;
  category: string;
}

interface GlobalWebhook {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  events: string[];
  created_at: string;
  updated_at?: string;
}

type Draft = {
  id?: string;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
};

const EMPTY_DRAFT: Draft = { name: "", url: "", events: [], is_active: true };

export default function WebhooksPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  const { data: events = [] } = useQuery<SystemEvent[]>({
    queryKey: ["system-events"],
    queryFn: () => globalWebhooksApi.listEvents().then((r) => r.data),
  });

  const { data: webhooks = [], isLoading } = useQuery<GlobalWebhook[]>({
    queryKey: ["global-webhooks"],
    queryFn: () => globalWebhooksApi.list().then((r) => r.data),
  });

  const saveMut = useMutation({
    mutationFn: async (d: Draft) => {
      if (d.id) {
        return globalWebhooksApi.update(d.id, {
          name: d.name,
          url: d.url,
          events: d.events,
          is_active: d.is_active,
        });
      }
      return globalWebhooksApi.create({
        name: d.name,
        url: d.url,
        events: d.events,
        is_active: d.is_active,
      });
    },
    onSuccess: (res, d) => {
      if (!d.id && res.data?.secret) {
        setCreatedSecret(res.data.secret);
      } else {
        toast.success("Webhook atualizado");
        setEditing(null);
      }
      qc.invalidateQueries({ queryKey: ["global-webhooks"] });
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao salvar";
      toast.error(msg);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => globalWebhooksApi.delete(id),
    onSuccess: () => {
      toast.success("Webhook deletado");
      qc.invalidateQueries({ queryKey: ["global-webhooks"] });
    },
    onError: () => toast.error("Erro ao deletar"),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => globalWebhooksApi.test(id),
    onSuccess: (res) => {
      if (res.data.success) toast.success("Teste enviado com sucesso!");
      else toast.error("Teste falhou: " + (res.data.message || ""));
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao testar";
      toast.error(msg);
    },
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      globalWebhooksApi.update(id, { is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["global-webhooks"] }),
    onError: () => toast.error("Falha ao alterar status"),
  });

  const eventMap = useMemo(() => {
    const m = new Map<string, SystemEvent>();
    events.forEach((e) => m.set(e.id, e));
    return m;
  }, [events]);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <a href="/settings" className="text-xs px-2 py-1.5 rounded-lg"
            style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 48%)" }}>
            ← <span className="hidden sm:inline">Voltar</span>
          </a>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-3" style={{ color: "var(--text-1)" }}>
              <Webhook className="w-5 sm:w-6 h-5 sm:h-6" style={{ color: "#8b5cf6" }} />
              Webhooks Globais
            </h1>
            <p className="text-sm mt-1 hidden sm:block" style={{ color: "var(--text-3)" }}>
              Receba eventos da plataforma (usuários, pagamentos, workspaces, CRM…)
            </p>
          </div>
        </div>
        <button
          onClick={() => setEditing({ ...EMPTY_DRAFT })}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: "#8b5cf6", color: "#fff" }}>
          <Plus className="w-4 h-4" />
          Novo Webhook
        </button>
      </div>

      {/* List */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-2)" }}>
          Meus Webhooks ({webhooks.length})
        </h2>

        {isLoading ? (
          <div className="text-center py-8 flex items-center justify-center gap-2"
            style={{ color: "var(--text-3)" }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        ) : webhooks.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-12 flex flex-col items-center gap-3"
            style={{ borderColor: "var(--surface-border)" }}>
            <Globe className="w-8 h-8" style={{ color: "var(--text-3)", opacity: 0.5 }} />
            <p className="text-sm" style={{ color: "var(--text-2)" }}>Nenhum webhook configurado</p>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>
              Crie um para começar a receber eventos do sistema.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {webhooks.map((wh) => (
              <div
                key={wh.id}
                className="p-4 rounded-xl border transition-colors"
                style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <button
                      onClick={() => toggleMut.mutate({ id: wh.id, is_active: !wh.is_active })}
                      title={wh.is_active ? "Desativar" : "Ativar"}
                      className="flex-shrink-0">
                      {wh.is_active ? (
                        <CheckCircle2 className="w-5 h-5" style={{ color: "#22c55e" }} />
                      ) : (
                        <XCircle className="w-5 h-5" style={{ color: "var(--text-3)" }} />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate" style={{ color: "var(--text-1)" }}>
                        {wh.name}
                      </p>
                      <p className="text-xs truncate font-mono" style={{ color: "var(--text-3)" }}>
                        {wh.url}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => testMut.mutate(wh.id)}
                      disabled={!wh.is_active || testMut.isPending}
                      className="p-2 rounded-lg transition-colors disabled:opacity-40"
                      style={{ color: "var(--text-2)" }}
                      title={wh.is_active ? "Enviar teste" : "Ative o webhook para testar"}>
                      <Play className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() =>
                        setEditing({
                          id: wh.id,
                          name: wh.name,
                          url: wh.url,
                          events: [...wh.events],
                          is_active: wh.is_active,
                        })
                      }
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: "var(--text-2)" }}
                      title="Editar">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Deletar "${wh.name}"?`)) deleteMut.mutate(wh.id);
                      }}
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: "#ef4444" }}
                      title="Deletar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mt-3">
                  {wh.events.length === 0 ? (
                    <span className="text-[10px]" style={{ color: "var(--text-3)" }}>
                      Nenhum evento selecionado
                    </span>
                  ) : (
                    wh.events.map((e) => (
                      <span
                        key={e}
                        className="px-2 py-0.5 rounded text-[10px]"
                        title={eventMap.get(e)?.description}
                        style={{ background: "#8b5cf620", color: "#8b5cf6" }}>
                        {eventMap.get(e)?.name || e}
                      </span>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {editing && (
        <WebhookEditor
          draft={editing}
          events={events}
          onCancel={() => setEditing(null)}
          onSave={(d) => saveMut.mutate(d)}
          saving={saveMut.isPending}
        />
      )}

      {/* Created Secret Modal */}
      {createdSecret && (
        <SecretRevealModal
          secret={createdSecret}
          copied={secretCopied}
          onCopy={() => {
            navigator.clipboard.writeText(createdSecret);
            setSecretCopied(true);
            setTimeout(() => setSecretCopied(false), 2000);
          }}
          onClose={() => {
            setCreatedSecret(null);
            setSecretCopied(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Editor Modal ──────────────────────────────────────────────────────────────
function WebhookEditor({
  draft: initial, events, onCancel, onSave, saving,
}: {
  draft: Draft;
  events: SystemEvent[];
  onCancel: () => void;
  onSave: (d: Draft) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, SystemEvent[]>();
    const q = search.trim().toLowerCase();
    for (const ev of events) {
      if (q && !ev.name.toLowerCase().includes(q) && !ev.id.toLowerCase().includes(q) && !ev.description.toLowerCase().includes(q)) continue;
      const cat = ev.category || "Outros";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(ev);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  }, [events, search]);

  const selectedSet = useMemo(() => new Set(draft.events), [draft.events]);

  const toggleEvent = (id: string) => {
    setDraft((d) => ({
      ...d,
      events: selectedSet.has(id) ? d.events.filter((e) => e !== id) : [...d.events, id],
    }));
  };

  const toggleCategory = (cat: string, categoryEvents: SystemEvent[]) => {
    const allIds = categoryEvents.map((e) => e.id);
    const allSelected = allIds.every((id) => selectedSet.has(id));
    setDraft((d) => {
      const remaining = d.events.filter((e) => !allIds.includes(e));
      return {
        ...d,
        events: allSelected ? remaining : [...remaining, ...allIds],
      };
    });
  };

  const toggleAll = () => {
    const visibleIds = grouped.flatMap(([, arr]) => arr.map((e) => e.id));
    const allSelected = visibleIds.every((id) => selectedSet.has(id));
    setDraft((d) => {
      if (allSelected) {
        return { ...d, events: d.events.filter((e) => !visibleIds.includes(e)) };
      }
      const set = new Set(d.events);
      visibleIds.forEach((id) => set.add(id));
      return { ...d, events: Array.from(set) };
    });
  };

  const toggleCollapse = (cat: string) => {
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const visibleCount = grouped.reduce((n, [, arr]) => n + arr.length, 0);
  const allVisibleSelected = grouped.length > 0 && grouped.flatMap(([, a]) => a).every((e) => selectedSet.has(e.id));

  const canSave = draft.name.trim() && draft.url.trim() && draft.events.length > 0 && !saving;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onCancel}>
      <div
        className="w-full max-w-xl rounded-2xl flex flex-col max-h-[90vh]"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--surface-border)" }}>
          <div>
            <h3 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
              {draft.id ? "Editar Webhook" : "Criar Webhook"}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              {draft.events.length} evento(s) selecionado(s)
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg"
            style={{ color: "var(--text-3)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          {/* Basic fields */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-2)" }}>
                Nome *
              </label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
                placeholder="Meu Webhook"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border cursor-pointer w-full"
                style={{ background: "var(--surface-3)", borderColor: "var(--surface-border)", color: "var(--text-2)" }}>
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                />
                Ativo (recebe eventos)
              </label>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium mb-1.5 block" style={{ color: "var(--text-2)" }}>
              URL *
            </label>
            <input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              type="url"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
              style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
              placeholder="https://seu-site.com/webhook"
            />
          </div>

          {/* Events selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                Eventos *
              </label>
              <button
                onClick={toggleAll}
                className="text-[10px] px-2 py-1 rounded-md"
                style={{
                  background: allVisibleSelected ? "rgba(239,68,68,0.1)" : "rgba(139,92,246,0.15)",
                  color: allVisibleSelected ? "#ef4444" : "#8b5cf6",
                }}>
                {allVisibleSelected ? `Desmarcar todos (${visibleCount})` : `Selecionar todos (${visibleCount})`}
              </button>
            </div>
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar eventos..."
                className="w-full pl-9 pr-3 py-2 rounded-lg text-xs outline-none"
                style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
              />
            </div>
            <div className="rounded-xl border overflow-hidden max-h-[320px] overflow-y-auto"
              style={{ borderColor: "var(--surface-border)", background: "var(--surface-3)" }}>
              {grouped.length === 0 ? (
                <div className="py-8 text-center text-xs" style={{ color: "var(--text-3)" }}>
                  Nenhum evento encontrado
                </div>
              ) : (
                grouped.map(([cat, list]) => {
                  const catIds = list.map((e) => e.id);
                  const catSelected = catIds.filter((id) => selectedSet.has(id)).length;
                  const isCollapsed = collapsed.has(cat);
                  const allSelected = catSelected === list.length;
                  return (
                    <div key={cat} className="border-b last:border-b-0"
                      style={{ borderColor: "var(--surface-border)" }}>
                      <div className="flex items-center justify-between px-3 py-2.5 sticky top-0"
                        style={{ background: "var(--surface-2)" }}>
                        <button
                          onClick={() => toggleCollapse(cat)}
                          className="flex items-center gap-1.5 text-xs font-semibold"
                          style={{ color: "var(--text-1)" }}>
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {cat}
                          <span className="text-[10px] font-normal px-1.5 py-0.5 rounded"
                            style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                            {catSelected}/{list.length}
                          </span>
                        </button>
                        <button
                          onClick={() => toggleCategory(cat, list)}
                          className="text-[10px] px-2 py-0.5 rounded-md"
                          style={{
                            background: allSelected ? "rgba(239,68,68,0.08)" : "rgba(139,92,246,0.12)",
                            color: allSelected ? "#ef4444" : "#8b5cf6",
                          }}>
                          {allSelected ? "desmarcar" : "todos"}
                        </button>
                      </div>
                      {!isCollapsed && (
                        <div className="px-3 pb-2">
                          {list.map((ev) => {
                            const selected = selectedSet.has(ev.id);
                            return (
                              <button
                                key={ev.id}
                                onClick={() => toggleEvent(ev.id)}
                                className="w-full flex items-start gap-2.5 py-1.5 px-2 rounded-lg text-left transition-colors"
                                style={{
                                  background: selected ? "rgba(139,92,246,0.08)" : "transparent",
                                }}>
                                <div
                                  className="w-4 h-4 mt-0.5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
                                  style={{
                                    background: selected ? "#8b5cf6" : "var(--surface-3)",
                                    border: `1.5px solid ${selected ? "#8b5cf6" : "var(--surface-border)"}`,
                                  }}>
                                  {selected && <Check className="w-2.5 h-2.5" style={{ color: "#fff" }} strokeWidth={3} />}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs font-medium" style={{ color: "var(--text-1)" }}>
                                    {ev.name}
                                  </p>
                                  <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
                                    {ev.id}
                                  </p>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t"
          style={{ borderColor: "var(--surface-border)" }}>
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
            Cancelar
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={!canSave}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            style={{ background: "#8b5cf6", color: "#fff" }}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {draft.id ? "Salvar" : "Criar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Secret Reveal Modal (shown ONCE after creation) ──────────────────────────
function SecretRevealModal({
  secret, copied, onCopy, onClose,
}: {
  secret: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div className="w-full max-w-md rounded-2xl p-6"
        style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(34,197,94,0.15)" }}>
            <CheckCircle2 className="w-5 h-5" style={{ color: "#22c55e" }} />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
              Webhook criado
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              Guarde o secret abaixo — ele só aparece uma vez. Use-o para validar o header
              <code className="px-1"> X-Webhook-Secret</code> nos eventos recebidos.
            </p>
          </div>
        </div>

        <div className="rounded-xl p-3 flex items-center gap-2 mb-4"
          style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
          <code className="text-xs font-mono flex-1 break-all" style={{ color: "var(--text-1)" }}>
            {secret}
          </code>
          <button
            onClick={onCopy}
            className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
            style={{ background: copied ? "rgba(34,197,94,0.15)" : "transparent", color: copied ? "#22c55e" : "var(--text-2)" }}
            title="Copiar">
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "#8b5cf6", color: "#fff" }}>
          Entendi, fechar
        </button>
      </div>
    </div>
  );
}
