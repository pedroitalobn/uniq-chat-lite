"use client";

// Workspace Messaging Settings — caps de frequência + quiet hours +
// timezone. Inspirado em Customer.io workspace settings.
//
// Estes campos viram safety guards aplicados antes de cada outbound em
// jornadas e campanhas (anti-banimento WhatsApp + LGPD).

import { use, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Save, Clock, Shield, Info } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

interface Workspace {
  id: string;
  name: string;
  timezone?: string;
  quiet_hours?: string;
  freq_cap_per_hour?: number;
  freq_cap_per_day?: number;
  freq_cap_per_week?: number;
}

const TZ_OPTIONS = [
  "America/Sao_Paulo",
  "America/New_York",
  "America/Mexico_City",
  "America/Buenos_Aires",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Madrid",
  "UTC",
];

export default function WorkspaceMessagingPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  const qc = useQueryClient();

  const { data: ws, isLoading } = useQuery<Workspace>({
    queryKey: ["workspace", workspaceId],
    queryFn: () => api.get(`/v1/workspaces/${workspaceId}`).then((r) => r.data),
  });

  const [form, setForm] = useState({
    timezone: "America/Sao_Paulo",
    quiet_hours: "",
    freq_cap_per_hour: 0,
    freq_cap_per_day: 0,
    freq_cap_per_week: 0,
  });

  useEffect(() => {
    if (ws) {
      setForm({
        timezone: ws.timezone || "America/Sao_Paulo",
        quiet_hours: ws.quiet_hours || "",
        freq_cap_per_hour: ws.freq_cap_per_hour || 0,
        freq_cap_per_day: ws.freq_cap_per_day || 0,
        freq_cap_per_week: ws.freq_cap_per_week || 0,
      });
    }
  }, [ws]);

  const saveMut = useMutation({
    mutationFn: () => api.put(`/v1/workspaces/${workspaceId}`, form),
    onSuccess: () => {
      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    },
    onError: () => toast.error("Erro ao salvar"),
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--green)" }} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 lg:py-8 space-y-5">
      <div>
        <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>Mensageria</h1>
        <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
          Limites e janelas que protegem suas instâncias e seus contatos. Aplicados em
          jornadas e campanhas antes de cada envio.
        </p>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); saveMut.mutate(); }} className="space-y-5">
        {/* Quiet Hours */}
        <div className="rounded-2xl p-5"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4" style={{ color: "var(--green)" }} />
            <h2 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Janela de silêncio</h2>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-3)" }}>
            Mensagens outbound não saem dentro dessa janela (horário LOCAL do contato).
            Formato HH:MM-HH:MM. Ex: <code className="font-mono">20:00-08:00</code> silencia da noite até manhã. Vazio = sem silêncio.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Janela (HH:MM-HH:MM)">
              <input value={form.quiet_hours} placeholder="20:00-08:00"
                onChange={(e) => setForm({ ...form, quiet_hours: e.target.value })}
                className="input-field w-full font-mono" maxLength={11} />
            </Field>
            <Field label="Timezone padrão (fallback)">
              <select value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                className="input-field w-full">
                {TZ_OPTIONS.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
              </select>
            </Field>
          </div>
        </div>

        {/* Frequency Caps */}
        <div className="rounded-2xl p-5"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4" style={{ color: "var(--green)" }} />
            <h2 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Frequency Caps (anti-banimento)</h2>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-3)" }}>
            Máximo de mensagens outbound por contato em cada janela.
            <strong> 0 = sem limite</strong>. Recomendado: 3/h, 10/dia, 30/semana.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Por hora">
              <input type="number" min="0" value={form.freq_cap_per_hour}
                onChange={(e) => setForm({ ...form, freq_cap_per_hour: parseInt(e.target.value) || 0 })}
                className="input-field w-full font-mono" />
            </Field>
            <Field label="Por dia">
              <input type="number" min="0" value={form.freq_cap_per_day}
                onChange={(e) => setForm({ ...form, freq_cap_per_day: parseInt(e.target.value) || 0 })}
                className="input-field w-full font-mono" />
            </Field>
            <Field label="Por semana">
              <input type="number" min="0" value={form.freq_cap_per_week}
                onChange={(e) => setForm({ ...form, freq_cap_per_week: parseInt(e.target.value) || 0 })}
                className="input-field w-full font-mono" />
            </Field>
          </div>
        </div>

        {/* Info */}
        <div className="rounded-xl p-3 flex items-start gap-2"
          style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.18)" }}>
          <Info className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#60a5fa" }} />
          <p className="text-xs" style={{ color: "var(--text-2)" }}>
            Caps usam o timezone do <strong>contato</strong> primeiro. Se o contato não tiver timezone,
            usa o fallback definido aqui. Mensagens bloqueadas por cap ou janela ficam pendentes e tentam de novo no próximo tick — não são perdidas.
          </p>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={saveMut.isPending}
            className="text-sm font-medium px-4 py-2 rounded-lg inline-flex items-center gap-2 disabled:opacity-50"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}>
            {saveMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Salvar configurações
          </button>
        </div>
      </form>
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
