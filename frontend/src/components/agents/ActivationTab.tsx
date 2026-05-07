"use client";

// ActivationTab — controla quando o agente responde. Antes só tinha
// um toggle on/off; agora user pode dizer "só horário comercial",
// "só fora do expediente" (handoff humano de dia), "só primeiro contato"
// ou customizar grade. O backend tem um gate em resolveAgent que
// devolve mode=disabled quando o "agora" cai fora da janela — caindo
// limpo pra atendimento humano sem precisar tocar nada mais.

import { useMemo } from "react";
import { Calendar, Clock, Plus, Trash2, UserPlus, Zap } from "lucide-react";

type ScheduleRange = { from: string; to: string };
type Schedule = {
  timezone: string;
  days: Record<string, ScheduleRange[]>;
};

type ActivationMode = "always" | "business_hours" | "off_hours" | "new_contact_only" | "custom";

const DAYS: Array<{ key: string; label: string }> = [
  { key: "mon", label: "Segunda" },
  { key: "tue", label: "Terça" },
  { key: "wed", label: "Quarta" },
  { key: "thu", label: "Quinta" },
  { key: "fri", label: "Sexta" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
];

const PRESETS: Array<{ id: ActivationMode; title: string; desc: string; icon: any }> = [
  { id: "always",            title: "Sempre ativo",          desc: "24/7 enquanto o agente estiver ligado.",                                  icon: Zap },
  { id: "business_hours",    title: "Horário comercial",     desc: "Só responde dentro da grade configurada — fora dela cai pra humano.",     icon: Clock },
  { id: "off_hours",         title: "Fora do expediente",    desc: "O oposto: responde só FORA da grade. Útil pra cobrir noite/fim de semana.", icon: Calendar },
  { id: "new_contact_only",  title: "Só primeiro contato",   desc: "Responde apenas se for a primeira mensagem do cliente. Depois, humano.",   icon: UserPlus },
];

export function ActivationTab({
  mode,
  schedule,
  onChangeMode,
  onChangeSchedule,
}: {
  mode: ActivationMode;
  schedule: Schedule;
  onChangeMode: (m: ActivationMode) => void;
  onChangeSchedule: (s: Schedule) => void;
}) {
  const showSchedule = mode === "business_hours" || mode === "off_hours" || mode === "custom";

  const setTimezone = (tz: string) => onChangeSchedule({ ...schedule, timezone: tz });

  const addRange = (day: string) => {
    const ranges = [...(schedule.days[day] || []), { from: "09:00", to: "18:00" }];
    onChangeSchedule({ ...schedule, days: { ...schedule.days, [day]: ranges } });
  };

  const updateRange = (day: string, idx: number, patch: Partial<ScheduleRange>) => {
    const ranges = (schedule.days[day] || []).map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChangeSchedule({ ...schedule, days: { ...schedule.days, [day]: ranges } });
  };

  const removeRange = (day: string, idx: number) => {
    const ranges = (schedule.days[day] || []).filter((_, i) => i !== idx);
    onChangeSchedule({ ...schedule, days: { ...schedule.days, [day]: ranges } });
  };

  const applyToAllWeekdays = (sample: ScheduleRange[]) => {
    const days = { ...schedule.days };
    ["mon", "tue", "wed", "thu", "fri"].forEach((d) => { days[d] = sample.map((r) => ({ ...r })); });
    onChangeSchedule({ ...schedule, days });
  };

  const totalActiveDays = useMemo(
    () => DAYS.filter((d) => (schedule.days[d.key] || []).length > 0).length,
    [schedule.days],
  );

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--text-1)" }}>Quando o agente responde</h2>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Fora da janela escolhida, a conversa cai automaticamente pra atendimento humano (sem mensagem do bot).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PRESETS.map((p) => {
          const active = mode === p.id;
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChangeMode(p.id)}
              className="text-left rounded-2xl p-4 transition"
              style={{
                background: active ? "rgba(0,212,106,0.08)" : "var(--surface-2)",
                border: `1px solid ${active ? "rgba(0,212,106,0.3)" : "var(--surface-border)"}`,
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <Icon className="w-4 h-4" style={{ color: active ? "var(--green)" : "var(--text-3)" }} />
                <span className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{p.title}</span>
              </div>
              <p className="text-[11px]" style={{ color: "var(--text-3)" }}>{p.desc}</p>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onChangeMode("custom")}
        className="text-left rounded-2xl p-3 w-full transition"
        style={{
          background: mode === "custom" ? "rgba(99,102,241,0.08)" : "var(--surface-2)",
          border: `1px solid ${mode === "custom" ? "rgba(99,102,241,0.3)" : "var(--surface-border)"}`,
        }}
      >
        <span className="text-xs font-medium" style={{ color: "var(--text-1)" }}>Customizado</span>
        <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
          Configure ranges por dia da semana — atalho pra grade não-comercial-padrão (ex: 06:00–22:00 todos os dias).
        </p>
      </button>

      {showSchedule && (
        <div className="rounded-2xl p-4 space-y-4" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
              Grade {mode === "off_hours" ? "(o agente responde FORA dela)" : ""}
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                {totalActiveDays} dia{totalActiveDays !== 1 ? "s" : ""} configurado{totalActiveDays !== 1 ? "s" : ""}
              </span>
              <button
                type="button"
                onClick={() => applyToAllWeekdays([{ from: "09:00", to: "18:00" }])}
                className="text-[11px] px-2 py-1 rounded-md"
                style={{ background: "rgba(99,102,241,0.1)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.2)" }}
              >
                Aplicar 9h–18h em dias úteis
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Fuso horário</label>
            <select
              value={schedule.timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="input-field text-xs w-full sm:w-64"
            >
              <option value="America/Sao_Paulo">America/Sao_Paulo (BRT)</option>
              <option value="America/Recife">America/Recife</option>
              <option value="America/Manaus">America/Manaus</option>
              <option value="America/Belem">America/Belem</option>
              <option value="America/Fortaleza">America/Fortaleza</option>
              <option value="UTC">UTC</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="Europe/Lisbon">Europe/Lisbon</option>
            </select>
          </div>

          <div className="space-y-2">
            {DAYS.map((d) => {
              const ranges = schedule.days[d.key] || [];
              return (
                <div key={d.key} className="flex items-start gap-3 py-2 border-b" style={{ borderColor: "var(--surface-border)" }}>
                  <div className="w-20 shrink-0 pt-1">
                    <span className="text-xs font-medium" style={{ color: "var(--text-2)" }}>{d.label}</span>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {ranges.length === 0 && (
                      <span className="text-[11px]" style={{ color: "var(--text-3)" }}>Fechado</span>
                    )}
                    {ranges.map((r, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={r.from}
                          onChange={(e) => updateRange(d.key, idx, { from: e.target.value })}
                          className="input-field text-xs w-24"
                        />
                        <span style={{ color: "var(--text-3)" }}>até</span>
                        <input
                          type="time"
                          value={r.to}
                          onChange={(e) => updateRange(d.key, idx, { to: e.target.value })}
                          className="input-field text-xs w-24"
                        />
                        <button
                          type="button"
                          onClick={() => removeRange(d.key, idx)}
                          className="p-1.5 rounded-md"
                          style={{ color: "#f87171" }}
                          title="Remover intervalo"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => addRange(d.key)}
                      className="text-[11px] px-2 py-1 rounded-md inline-flex items-center gap-1"
                      style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
                    >
                      <Plus className="w-3 h-3" />
                      Adicionar intervalo
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
