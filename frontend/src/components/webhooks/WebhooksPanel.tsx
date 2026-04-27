"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Webhook, Plus, Trash2, CheckCircle2, XCircle, Search, Globe,
  Pencil, X, Copy, Check, Loader2, Sparkles, ListChecks, Lock,
} from "lucide-react";
import { globalWebhooksApi } from "@/lib/api";
import { toast } from "sonner";
import { WebhookDeliveriesDialog } from "./WebhookDeliveriesDialog";
import { EventTestMenu } from "./EventTestMenu";

interface SystemEvent {
  id: string;
  name: string;
  description: string;
  category: string;
  admin_only?: boolean;
  scope?: "instance" | "global" | "both";
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

/**
 * Painel reutilizável de webhooks globais.
 *
 * - showHeader: renderiza título "Webhooks Globais" + descrição. Útil em
 *   páginas standalone. Desabilite quando o container já tem header.
 */
export function WebhooksPanel({ showHeader = true }: { showHeader?: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [viewingLogs, setViewingLogs] = useState<{ id: string; name: string } | null>(null);

  // include_admin=1 — backend filtra automaticamente conforme role.User
  // não-admin não vê eventos admin-only mesmo passando o flag.
  const { data: events = [] } = useQuery<SystemEvent[]>({
    queryKey: ["system-events", "global"],
    queryFn: () => globalWebhooksApi.listEvents({ include_admin: true, scope: "both" }).then((r) => r.data),
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
      const msg =
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        "Erro ao salvar";
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
    <div>
      {/* Header (opcional) */}
      {showHeader && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Webhook className="w-5 h-5" style={{ color: "#8b5cf6" }} />
            <div>
              <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
                Webhooks Globais
              </h2>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
                Receba eventos da plataforma (usuários, pagamentos, workspaces, CRM…)
              </p>
            </div>
          </div>
          <button
            onClick={() => setEditing({ ...EMPTY_DRAFT })}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={{ background: "#8b5cf6", color: "#fff" }}
          >
            <Plus className="w-4 h-4" />
            Novo Webhook
          </button>
        </div>
      )}

      {/* Botão "Novo" flutuante quando sem header */}
      {!showHeader && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: "var(--text-2)" }}>
            Meus Webhooks ({webhooks.length})
          </h3>
          <button
            onClick={() => setEditing({ ...EMPTY_DRAFT })}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ background: "#8b5cf6", color: "#fff" }}
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Webhook
          </button>
        </div>
      )}

      {showHeader && (
        <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-2)" }}>
          Meus Webhooks ({webhooks.length})
        </h3>
      )}

      {isLoading ? (
        <div
          className="text-center py-8 flex items-center justify-center gap-2"
          style={{ color: "var(--text-3)" }}
        >
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
        </div>
      ) : webhooks.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed py-12 flex flex-col items-center gap-3"
          style={{ borderColor: "var(--surface-border)" }}
        >
          <Globe className="w-8 h-8" style={{ color: "var(--text-3)", opacity: 0.5 }} />
          <p className="text-sm" style={{ color: "var(--text-2)" }}>
            Nenhum webhook configurado
          </p>
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
              style={{
                background: "var(--surface-2)",
                borderColor: "var(--surface-border)",
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <button
                    onClick={() => toggleMut.mutate({ id: wh.id, is_active: !wh.is_active })}
                    title={wh.is_active ? "Desativar" : "Ativar"}
                    className="flex-shrink-0"
                  >
                    {wh.is_active ? (
                      <CheckCircle2 className="w-5 h-5" style={{ color: "#22c55e" }} />
                    ) : (
                      <XCircle className="w-5 h-5" style={{ color: "var(--text-3)" }} />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm font-medium truncate"
                      style={{ color: "var(--text-1)" }}
                    >
                      {wh.name}
                    </p>
                    <p
                      className="text-xs truncate font-mono"
                      style={{ color: "var(--text-3)" }}
                    >
                      {wh.url}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <EventTestMenu
                    scope={{ kind: "global", webhookId: wh.id }}
                    enabledEvents={wh.events}
                    allEvents={events}
                    disabled={!wh.is_active}
                  />
                  <button
                    onClick={() => setViewingLogs({ id: wh.id, name: wh.name })}
                    className="p-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: "var(--text-2)" }}
                    title="Logs de entrega"
                  >
                    <ListChecks className="w-4 h-4" />
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
                    className="p-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: "var(--text-2)" }}
                    title="Editar"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Deletar "${wh.name}"?`)) deleteMut.mutate(wh.id);
                    }}
                    className="p-2 rounded-lg transition-colors hover:bg-white/5"
                    style={{ color: "#ef4444" }}
                    title="Deletar"
                  >
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
                      style={{ background: "#8b5cf620", color: "#8b5cf6" }}
                    >
                      {eventMap.get(e)?.name || e}
                    </span>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <WebhookEditor
          draft={editing}
          events={events}
          onCancel={() => setEditing(null)}
          onSave={(d) => saveMut.mutate(d)}
          saving={saveMut.isPending}
        />
      )}

      {viewingLogs && (
        <WebhookDeliveriesDialog
          scope={{ kind: "global", webhookId: viewingLogs.id }}
          webhookName={viewingLogs.name}
          onClose={() => setViewingLogs(null)}
        />
      )}

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
  draft: initial,
  events,
  onCancel,
  onSave,
  saving,
}: {
  draft: Draft;
  events: SystemEvent[];
  onCancel: () => void;
  onSave: (d: Draft) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [search, setSearch] = useState("");

  const grouped = useMemo(() => {
    const map = new Map<string, SystemEvent[]>();
    const q = search.trim().toLowerCase();
    for (const ev of events) {
      if (
        q &&
        !ev.name.toLowerCase().includes(q) &&
        !ev.id.toLowerCase().includes(q) &&
        !ev.description.toLowerCase().includes(q)
      )
        continue;
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

  const toggleCategory = (categoryEvents: SystemEvent[]) => {
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

  const visibleCount = grouped.reduce((n, [, arr]) => n + arr.length, 0);
  const allVisibleSelected =
    grouped.length > 0 && grouped.flatMap(([, a]) => a).every((e) => selectedSet.has(e.id));

  const canSave =
    draft.name.trim() && draft.url.trim() && draft.events.length > 0 && !saving;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl rounded-2xl flex flex-col max-h-[92vh]"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--surface-border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b"
          style={{ borderColor: "var(--surface-border)" }}
        >
          <div>
            <h3 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>
              {draft.id ? "Editar Webhook" : "Criar Webhook"}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
              {draft.events.length} de {events.length} evento(s) selecionado(s)
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            style={{ color: "var(--text-3)" }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="text-xs font-medium mb-1.5 block"
                style={{ color: "var(--text-2)" }}
              >
                Nome *
              </label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{
                  background: "var(--surface-3)",
                  color: "var(--text-1)",
                  border: "1px solid var(--surface-border)",
                }}
                placeholder="Meu Webhook"
              />
            </div>
            <div className="flex items-end gap-2">
              <label
                className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border cursor-pointer w-full"
                style={{
                  background: "var(--surface-3)",
                  borderColor: "var(--surface-border)",
                  color: "var(--text-2)",
                }}
              >
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
            <label
              className="text-xs font-medium mb-1.5 block"
              style={{ color: "var(--text-2)" }}
            >
              URL *
            </label>
            <input
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              type="url"
              className="w-full px-3 py-2 rounded-lg text-sm outline-none font-mono"
              style={{
                background: "var(--surface-3)",
                color: "var(--text-1)",
                border: "1px solid var(--surface-border)",
              }}
              placeholder="https://seu-site.com/webhook"
            />
          </div>

          {/* Events selector — badge style */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                  Eventos *
                </label>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                  style={{
                    background:
                      draft.events.length > 0
                        ? "rgba(139,92,246,0.15)"
                        : "var(--surface-3)",
                    color: draft.events.length > 0 ? "#8b5cf6" : "var(--text-3)",
                  }}
                >
                  {draft.events.length}/{events.length}
                </span>
              </div>
              <button
                type="button"
                onClick={toggleAll}
                className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors"
                style={{
                  background: allVisibleSelected
                    ? "rgba(239,68,68,0.1)"
                    : "rgba(139,92,246,0.15)",
                  color: allVisibleSelected ? "#ef4444" : "#8b5cf6",
                }}
              >
                {!allVisibleSelected && <Sparkles className="w-3 h-3" />}
                {allVisibleSelected
                  ? `Desmarcar todos (${visibleCount})`
                  : `Selecionar todos (${visibleCount})`}
              </button>
            </div>

            <div className="relative mb-3">
              <Search
                className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2"
                style={{ color: "var(--text-3)" }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar evento por nome, id ou descrição..."
                className="w-full pl-9 pr-3 py-2 rounded-lg text-xs outline-none"
                style={{
                  background: "var(--surface-3)",
                  color: "var(--text-1)",
                  border: "1px solid var(--surface-border)",
                }}
              />
            </div>

            <div
              className="rounded-xl border max-h-[360px] overflow-y-auto p-4 space-y-4"
              style={{
                borderColor: "var(--surface-border)",
                background: "var(--surface-3)",
              }}
            >
              {grouped.length === 0 ? (
                <div className="py-8 text-center text-xs" style={{ color: "var(--text-3)" }}>
                  Nenhum evento encontrado
                </div>
              ) : (
                grouped.map(([cat, list]) => {
                  const catIds = list.map((e) => e.id);
                  const catSelectedCount = catIds.filter((id) => selectedSet.has(id)).length;
                  const allSelected = catSelectedCount === list.length;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs font-semibold uppercase tracking-wide"
                            style={{ color: "var(--text-1)" }}
                          >
                            {cat}
                          </span>
                          <span
                            className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                            style={{
                              background:
                                catSelectedCount > 0
                                  ? "rgba(139,92,246,0.15)"
                                  : "var(--surface-2)",
                              color: catSelectedCount > 0 ? "#8b5cf6" : "var(--text-3)",
                            }}
                          >
                            {catSelectedCount}/{list.length}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleCategory(list)}
                          className="text-[10px] px-2 py-0.5 rounded-md font-medium transition-colors"
                          style={{
                            background: allSelected
                              ? "rgba(239,68,68,0.1)"
                              : "rgba(139,92,246,0.12)",
                            color: allSelected ? "#ef4444" : "#8b5cf6",
                          }}
                        >
                          {allSelected ? "Desmarcar todos" : "Selecionar todos"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((ev) => {
                          const selected = selectedSet.has(ev.id);
                          return (
                            <button
                              key={ev.id}
                              type="button"
                              onClick={() => toggleEvent(ev.id)}
                              title={`${ev.id}\n${ev.description}${ev.admin_only ? "\n\n⚠ Apenas super admin" : ""}`}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95"
                              style={{
                                background: selected ? "#8b5cf6" : "var(--surface-2)",
                                color: selected ? "#fff" : "var(--text-2)",
                                border: `1px solid ${
                                  selected ? "#8b5cf6" : "var(--surface-border)"
                                }`,
                                boxShadow: selected
                                  ? "0 1px 2px rgba(139,92,246,0.3)"
                                  : "none",
                              }}
                            >
                              {selected && <Check className="w-3 h-3" strokeWidth={3} />}
                              {ev.admin_only && <Lock className="w-3 h-3" style={{ color: selected ? "#fff" : "#f59e0b" }} />}
                              {ev.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <p className="text-[10px] mt-2" style={{ color: "var(--text-3)" }}>
              Clique nos badges para selecionar. Passe o mouse para ver o ID e descrição.
            </p>
          </div>
        </div>

        <div
          className="flex justify-end gap-2 px-6 py-4 border-t"
          style={{ borderColor: "var(--surface-border)" }}
        >
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
          >
            Cancelar
          </button>
          <button
            onClick={() => onSave(draft)}
            disabled={!canSave}
            className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2"
            style={{ background: "#8b5cf6", color: "#fff" }}
          >
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
  secret,
  copied,
  onCopy,
  onClose,
}: {
  secret: string;
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
      <div
        className="w-full max-w-md rounded-2xl p-6"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--surface-border)",
        }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(34,197,94,0.15)" }}
          >
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

        <div
          className="rounded-xl p-3 flex items-center gap-2 mb-4"
          style={{
            background: "var(--surface-3)",
            border: "1px solid var(--surface-border)",
          }}
        >
          <code
            className="text-xs font-mono flex-1 break-all"
            style={{ color: "var(--text-1)" }}
          >
            {secret}
          </code>
          <button
            onClick={onCopy}
            className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
            style={{
              background: copied ? "rgba(34,197,94,0.15)" : "transparent",
              color: copied ? "#22c55e" : "var(--text-2)",
            }}
            title="Copiar"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "#8b5cf6", color: "#fff" }}
        >
          Entendi, fechar
        </button>
      </div>
    </div>
  );
}
