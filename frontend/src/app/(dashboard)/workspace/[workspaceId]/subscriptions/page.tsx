"use client";

// Subscription Topics admin — CRUD de tópicos de comunicação do
// workspace. Inspirado em Customer.io subscription groups.

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Mail, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { subscriptionTopicsApi } from "@/lib/api";
import { WorkspaceTabs } from "@/components/workspace/WorkspaceTabs";

interface Topic {
  id: string;
  slug: string;
  name: string;
  description?: string;
  is_required: boolean;
  default_opt_in: boolean;
  is_active: boolean;
}

export default function SubscriptionsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Topic | "new" | null>(null);

  const { data, isLoading } = useQuery<{ data: Topic[] }>({
    queryKey: ["subscription-topics"],
    queryFn: () => subscriptionTopicsApi.list().then((r) => r.data),
  });
  const list = data?.data ?? [];

  const deleteMut = useMutation({
    mutationFn: (id: string) => subscriptionTopicsApi.delete(id),
    onSuccess: () => {
      toast.success("Tópico removido");
      qc.invalidateQueries({ queryKey: ["subscription-topics"] });
    },
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 lg:py-8 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>Tópicos de comunicação</h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Categorias que seus contatos podem ativar/desativar no Preference Center.
            Tópicos <strong>obrigatórios</strong> (transacionais) não podem ser desligados pelo cliente.
          </p>
        </div>
        <WorkspaceTabs workspaceId={workspaceId} />
      </div>

      <div className="flex items-center justify-end">
        <button onClick={() => setEditing("new")}
          className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
          style={{ background: "var(--green)", color: "var(--green-fg)" }}>
          <Plus className="w-3.5 h-3.5" /> Novo tópico
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} /></div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 rounded-2xl"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <Mail className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--text-3)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Nenhum tópico criado</p>
          <p className="text-xs mt-1 max-w-md mx-auto" style={{ color: "var(--text-3)" }}>
            Crie tópicos como "Promoções", "Novidades", "Suporte" pra dar controle granular ao cliente.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {list.map((t) => (
            <div key={t.id}
              className="rounded-2xl p-4"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{t.name}</p>
                  <p className="text-[10px] font-mono" style={{ color: "var(--text-3)" }}>{t.slug}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => setEditing(t)}
                    className="p-1.5 rounded-md" style={{ color: "var(--text-3)" }}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { if (confirm(`Remover "${t.name}"?`)) deleteMut.mutate(t.id); }}
                    className="p-1.5 rounded-md" style={{ color: "#f87171" }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {t.description && (
                <p className="text-xs mb-2" style={{ color: "var(--text-3)" }}>{t.description}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {t.is_required && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "rgba(251,191,36,0.12)", color: "#fbbf24" }}>
                    OBRIGATÓRIO
                  </span>
                )}
                {t.default_opt_in && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "var(--green-soft)", color: "var(--green)" }}>
                    OPT-IN AUTO
                  </span>
                )}
                {!t.is_active && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                    style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
                    INATIVO
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <TopicEditor topic={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["subscription-topics"] });
            setEditing(null);
          }} />
      )}
    </div>
  );
}

function TopicEditor({ topic, onClose, onSaved }: {
  topic: Topic | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    slug: topic?.slug || "",
    name: topic?.name || "",
    description: topic?.description || "",
    is_required: topic?.is_required ?? false,
    default_opt_in: topic?.default_opt_in ?? false,
    is_active: topic?.is_active ?? true,
  });

  const saveMut = useMutation({
    mutationFn: () => topic
      ? subscriptionTopicsApi.update(topic.id, form)
      : subscriptionTopicsApi.create(form),
    onSuccess: () => {
      toast.success(topic ? "Atualizado" : "Criado");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Erro"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl w-full max-w-md p-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            {topic ? "Editar tópico" : "Novo tópico"}
          </h3>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-3">
          <Field label="Nome (visível pro cliente)">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ex: Novidades e promoções" className="input-field w-full" />
          </Field>
          <Field label="Slug (identificador interno)">
            <input required value={form.slug} disabled={!!topic}
              onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "_") })}
              placeholder="ex: promo_news" className="input-field w-full font-mono" />
          </Field>
          <Field label="Descrição">
            <textarea value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2} className="input-field w-full"
              placeholder="O que o cliente vai receber se ativar." />
          </Field>
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: "var(--surface-border)" }}>
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-2)" }}>
              <input type="checkbox" checked={form.is_required}
                onChange={(e) => setForm({ ...form, is_required: e.target.checked })} />
              Obrigatório (cliente NÃO pode desativar — transacional)
            </label>
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-2)" }}>
              <input type="checkbox" checked={form.default_opt_in}
                onChange={(e) => setForm({ ...form, default_opt_in: e.target.checked })} />
              Opt-in automático (novos contatos entram inscritos por default)
            </label>
            <label className="flex items-center gap-2 text-xs" style={{ color: "var(--text-2)" }}>
              <input type="checkbox" checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
              Ativo (visível no Preference Center)
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="text-xs px-3 py-2 rounded-lg"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
              Cancelar
            </button>
            <button type="submit" disabled={saveMut.isPending}
              className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}>
              {saveMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {topic ? "Salvar" : "Criar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>{label}</label>
      {children}
    </div>
  );
}
