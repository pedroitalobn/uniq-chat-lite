"use client";

// Suppression List admin — visualiza e remove bloqueios outbound por
// contato. Inspirado em Customer.io suppression lists.

import { use, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, ShieldOff, Search } from "lucide-react";
import { toast } from "sonner";
import { suppressionsApi } from "@/lib/api";
import { WorkspaceTabs } from "@/components/workspace/WorkspaceTabs";
import { showConfirm } from "@/lib/confirm";

interface Suppression {
  id: string;
  key: string;
  channel: string;
  reason: string;
  note?: string;
  created_at: string;
}

export default function SuppressionsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ key: "", channel: "all", reason: "manual_admin", note: "" });

  const { data, isLoading } = useQuery<{ data: Suppression[] }>({
    queryKey: ["suppressions", search],
    queryFn: () => suppressionsApi.list({ q: search }).then((r) => r.data),
  });
  const list = data?.data ?? [];

  const createMut = useMutation({
    mutationFn: () => suppressionsApi.create(form),
    onSuccess: () => {
      toast.success("Bloqueio adicionado");
      setCreating(false);
      setForm({ key: "", channel: "all", reason: "manual_admin", note: "" });
      qc.invalidateQueries({ queryKey: ["suppressions"] });
    },
    onError: () => toast.error("Erro ao adicionar"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => suppressionsApi.delete(id),
    onSuccess: () => {
      toast.success("Removido");
      qc.invalidateQueries({ queryKey: ["suppressions"] });
    },
  });

  const REASONS: Record<string, { label: string; color: string }> = {
    user_optout: { label: "Opt-out usuário", color: "var(--green)" },
    bounced: { label: "Bounce", color: "#fbbf24" },
    complained: { label: "Reclamação", color: "#f87171" },
    manual_admin: { label: "Manual", color: "#60a5fa" },
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 lg:py-8 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>Suppression List</h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Contatos bloqueados de receber mensagens outbound (LGPD opt-out, bounces, reclamações).
            Aplicado em jornadas e campanhas antes do envio.
          </p>
        </div>
        <WorkspaceTabs workspaceId={workspaceId} />
      </div>

      <div className="flex items-center justify-end">
        <button onClick={() => setCreating(true)}
          className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
          style={{ background: "var(--green)", color: "var(--green-fg)" }}>
          <Plus className="w-3.5 h-3.5" /> Adicionar bloqueio
        </button>
      </div>

      <div className="relative max-w-md">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por phone/email" className="input-field w-full pl-9" />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} /></div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 rounded-2xl"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <ShieldOff className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--text-3)" }} />
          <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Nenhum bloqueio</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Bloqueios aparecem aqui quando um contato pede pra parar de receber, ou quando você adiciona manualmente.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl overflow-hidden"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider"
                style={{ color: "var(--text-3)", background: "var(--surface-3)" }}>
                <th className="text-left px-4 py-2 font-medium">Chave</th>
                <th className="text-left px-4 py-2 font-medium">Canal</th>
                <th className="text-left px-4 py-2 font-medium">Motivo</th>
                <th className="text-left px-4 py-2 font-medium">Quando</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const r = REASONS[s.reason] || { label: s.reason, color: "var(--text-3)" };
                return (
                  <tr key={s.id} className="border-t" style={{ borderColor: "var(--surface-border)" }}>
                    <td className="px-4 py-2 font-mono text-xs" style={{ color: "var(--text-1)" }}>{s.key}</td>
                    <td className="px-4 py-2 text-xs" style={{ color: "var(--text-2)" }}>{s.channel}</td>
                    <td className="px-4 py-2">
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ background: `color-mix(in oklab, ${r.color} 12%, transparent)`, color: r.color }}>
                        {r.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs" style={{ color: "var(--text-3)" }}>
                      {new Date(s.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={async () => { if (await showConfirm(`Remover bloqueio de ${s.key}?`, { title: "Remover bloqueio", confirmLabel: "Remover" })) deleteMut.mutate(s.id); }}
                        className="p-1.5 rounded-md" style={{ color: "#f87171" }}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
          <div className="rounded-2xl w-full max-w-md p-5"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
            <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-1)" }}>Adicionar bloqueio</h3>
            <form onSubmit={(e) => { e.preventDefault(); createMut.mutate(); }} className="space-y-3">
              <Field label="Chave (telefone E.164 ou email)">
                <input required value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value })}
                  placeholder="+5511987654321 ou user@example.com" className="input-field w-full" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Canal">
                  <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}
                    className="input-field w-full">
                    <option value="all">Todos</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="instagram">Instagram</option>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                </Field>
                <Field label="Motivo">
                  <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    className="input-field w-full">
                    <option value="manual_admin">Manual</option>
                    <option value="user_optout">Opt-out usuário</option>
                    <option value="bounced">Bounce</option>
                    <option value="complained">Reclamação</option>
                  </select>
                </Field>
              </div>
              <Field label="Nota (opcional)">
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                  className="input-field w-full" />
              </Field>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setCreating(false)}
                  className="text-xs px-3 py-2 rounded-lg" style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                  Cancelar
                </button>
                <button type="submit" disabled={createMut.isPending}
                  className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
                  style={{ background: "var(--green)", color: "var(--green-fg)" }}>
                  {createMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Adicionar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
