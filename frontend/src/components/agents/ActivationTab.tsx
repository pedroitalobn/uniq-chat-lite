"use client";

// ActivationTab — controla quando o agente responde. Antes só tinha
// um toggle on/off; agora user pode dizer "só horário comercial",
// "só fora do expediente" (handoff humano de dia), "só primeiro contato"
// ou customizar grade. O backend tem um gate em resolveAgent que
// devolve mode=disabled quando o "agora" cai fora da janela — caindo
// limpo pra atendimento humano sem precisar tocar nada mais.

import { useMemo, useState } from "react";
import { Calendar, Clock, Copy, Hash, Plus, Trash2, UserPlus, Webhook, Zap, X } from "lucide-react";
import { toast } from "sonner";

type ScheduleRange = { from: string; to: string };
type Schedule = {
  timezone: string;
  days: Record<string, ScheduleRange[]>;
};

type ActivationMode = "always" | "business_hours" | "off_hours" | "new_contact_only" | "custom";
type TriggerMode = "any" | "keyword" | "webhook";
type ResponsePace = "instant" | "natural" | "thoughtful" | "very_human";
type ResponseLength = "concise" | "balanced" | "detailed";

type TriggerConfig = {
  mode: TriggerMode;
  keywords: string[];
  message_types: string[];
  webhook_slug: string;        // read-only, gerado pelo backend ao ativar webhook mode
  webhook_secret: string;
};

type PaceSettingsMap = Record<string, {
  ms_per_char?: number;
  jitter_pct?: number;
  min_delay?: number;
  max_delay?: number;
  cooldown_min?: number;
  cooldown_max?: number;
  first_msg_min?: number;
  first_msg_max?: number;
}>;

type ResponseStyleConfig = {
  pace: ResponsePace;
  length: ResponseLength;
  pace_settings: string;
};

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
  trigger,
  onChangeTrigger,
  responseStyle,
  onChangeResponseStyle,
  apiBase,
}: {
  mode: ActivationMode;
  schedule: Schedule;
  onChangeMode: (m: ActivationMode) => void;
  onChangeSchedule: (s: Schedule) => void;
  trigger: TriggerConfig;
  onChangeTrigger: (t: TriggerConfig) => void;
  responseStyle: ResponseStyleConfig;
  onChangeResponseStyle: (s: ResponseStyleConfig) => void;
  /** URL base do backend pra montar a URL completa do webhook (ex: https://api.uniq.chat) */
  apiBase?: string;
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

      {/* ── Trigger: em qual condição o agente INICIA/RESPONDE ── */}
      <TriggerSection trigger={trigger} onChange={onChangeTrigger} apiBase={apiBase} />

      {/* ── Ritmo + tamanho da resposta ── */}
      <ResponseStyleSection style={responseStyle} onChange={onChangeResponseStyle} />
    </div>
  );
}

// ─── Response style config ───────────────────────────────────────────────

const PACE_OPTIONS: Array<{ id: ResponsePace; title: string; desc: string }> = [
  { id: "instant",    title: "Instantâneo",  desc: "Mais rápido possível (mín ~600ms). Pode soar robótico — use só em FAQ/automação." },
  { id: "natural",    title: "Natural",      desc: "Padrão humano: digita ~300 chars/min com variação. Default recomendado." },
  { id: "thoughtful", title: "Pensativo",    desc: "Pausa pra pensar antes (~400ms/char). Bom pra vendas consultivas." },
  { id: "very_human", title: "Bem humano",   desc: "Devagar, longas pausas. Quase indistinguível de humano. Mais lento (até 25s)." },
];

const LENGTH_OPTIONS: Array<{ id: ResponseLength; title: string; desc: string }> = [
  { id: "concise",  title: "Curto e direto",   desc: "1-2 frases por mensagem. Sem explicações longas. Bom pra suporte rápido / FAQ." },
  { id: "balanced", title: "Equilibrado",      desc: "1-3 frases. Detalha quando precisa. Default — melhor pra maioria." },
  { id: "detailed", title: "Detalhado",        desc: "Pode explicar com profundidade. Bom pra suporte técnico ou onboarding educativo." },
];

function parsePaceSettings(raw: string): PaceSettingsMap {
  try {
    return JSON.parse(raw || "{}") as PaceSettingsMap;
  } catch {
    return {};
  }
}

function stringifyPaceSettings(map: PaceSettingsMap): string {
  return JSON.stringify(map);
}

const DEFAULT_PACE_PROFILES: Record<ResponsePace, Required<NonNullable<PaceSettingsMap[string]>>> = {
  instant: { ms_per_char: 40, jitter_pct: 30, min_delay: 600, max_delay: 4000, cooldown_min: 400, cooldown_max: 900, first_msg_min: 2000, first_msg_max: 4000 },
  natural: { ms_per_char: 220, jitter_pct: 25, min_delay: 1200, max_delay: 12000, cooldown_min: 1500, cooldown_max: 3000, first_msg_min: 4000, first_msg_max: 8000 },
  thoughtful: { ms_per_char: 400, jitter_pct: 25, min_delay: 2200, max_delay: 18000, cooldown_min: 2500, cooldown_max: 4500, first_msg_min: 5000, first_msg_max: 12000 },
  very_human: { ms_per_char: 600, jitter_pct: 30, min_delay: 3500, max_delay: 25000, cooldown_min: 3500, cooldown_max: 7000, first_msg_min: 8000, first_msg_max: 20000 },
};

function ResponseStyleSection({
  style, onChange,
}: {
  style: ResponseStyleConfig;
  onChange: (s: ResponseStyleConfig) => void;
}) {
  const [showModal, setShowModal] = useState(false);
  const settings = parsePaceSettings(style.pace_settings);
  const current = settings[style.pace] || {};
  const defaults = DEFAULT_PACE_PROFILES[style.pace];

  const updateField = (key: keyof typeof defaults, val: number) => {
    const next: PaceSettingsMap = { ...settings, [style.pace]: { ...current, [key]: val } };
    onChange({ ...style, pace_settings: stringifyPaceSettings(next) });
  };

  const resetToDefaults = () => {
    const next: PaceSettingsMap = { ...settings, [style.pace]: { ...defaults } };
    onChange({ ...style, pace_settings: stringifyPaceSettings(next) });
  };

  return (
    <div className="space-y-4 pt-2 border-t" style={{ borderColor: "var(--surface-border)" }}>
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--text-1)" }}>Como o agente responde</h2>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Ritmo do envio e tamanho da resposta. Ajuste pra parecer mais humano e evitar banimento por &quot;robô óbvio&quot;.
        </p>
      </div>

      {/* Pace */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--text-2)" }}>Ritmo (delay de digitação)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {PACE_OPTIONS.map((p) => {
            const active = style.pace === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange({ ...style, pace: p.id })}
                className="text-left rounded-xl p-3 transition"
                style={{
                  background: active ? "rgba(0,212,106,0.06)" : "var(--surface-2)",
                  border: `1px solid ${active ? "rgba(0,212,106,0.25)" : "var(--surface-border)"}`,
                }}
              >
                <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{p.title}</p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>{p.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Length */}
      <div>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--text-2)" }}>Tamanho da resposta</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {LENGTH_OPTIONS.map((l) => {
            const active = style.length === l.id;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onChange({ ...style, length: l.id })}
                className="text-left rounded-xl p-3 transition"
                style={{
                  background: active ? "rgba(99,102,241,0.06)" : "var(--surface-2)",
                  border: `1px solid ${active ? "rgba(99,102,241,0.25)" : "var(--surface-border)"}`,
                }}
              >
                <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{l.title}</p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>{l.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ajustes finos de delay */}
      <div className="flex items-center justify-between rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Ajustes finos de delay</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
            Edite ms/char, delays mín/máx, cooldowns e primeiro delay.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="text-xs font-medium rounded-lg px-3 py-1.5"
          style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa", border: "1px solid rgba(59,130,246,0.25)" }}
        >
          Editar
        </button>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="w-full max-w-lg rounded-xl border p-5 max-h-[90vh] overflow-auto" style={{ background: "hsl(240 12% 8%)", borderColor: "rgba(255,255,255,0.08)" }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Ajustes finos — {PACE_OPTIONS.find(p => p.id === style.pace)?.title}</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-white/5">
                <X className="w-4 h-4" style={{ color: "var(--text-3)" }} />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="ms por caractere" value={current.ms_per_char ?? defaults.ms_per_char} onChange={v => updateField("ms_per_char", v)} />
                <NumberField label="Jitter (%)" value={current.jitter_pct ?? defaults.jitter_pct} onChange={v => updateField("jitter_pct", v)} />
                <NumberField label="Delay mínimo (ms)" value={current.min_delay ?? defaults.min_delay} onChange={v => updateField("min_delay", v)} />
                <NumberField label="Delay máximo (ms)" value={current.max_delay ?? defaults.max_delay} onChange={v => updateField("max_delay", v)} />
                <NumberField label="Cooldown mín (ms)" value={current.cooldown_min ?? defaults.cooldown_min} onChange={v => updateField("cooldown_min", v)} />
                <NumberField label="Cooldown máx (ms)" value={current.cooldown_max ?? defaults.cooldown_max} onChange={v => updateField("cooldown_max", v)} />
                <NumberField label="Primeira msg mín (ms)" value={current.first_msg_min ?? defaults.first_msg_min} onChange={v => updateField("first_msg_min", v)} />
                <NumberField label="Primeira msg máx (ms)" value={current.first_msg_max ?? defaults.first_msg_max} onChange={v => updateField("first_msg_max", v)} />
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={resetToDefaults}
                  className="text-xs font-medium rounded-lg px-3 py-2"
                  style={{ background: "rgba(248,113,113,0.10)", color: "#f87171", border: "1px solid rgba(248,113,113,0.22)" }}
                >
                  Restaurar padrão
                </button>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-xs font-medium rounded-lg px-4 py-2"
                  style={{ background: "rgba(59,130,246,0.18)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.30)" }}
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <label className="block text-[11px] mb-1" style={{ color: "var(--text-3)" }}>{label}</label>
      <input
        type="number"
        min={0}
        step={100}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
        className="w-full rounded-lg px-2.5 py-1.5 text-xs outline-none"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.10)", color: "hsl(240 15% 90%)" }}
      />
    </div>
  );
}

// ─── Trigger config ──────────────────────────────────────────────────────

const TRIGGER_PRESETS: Array<{ id: TriggerMode; title: string; desc: string; icon: any }> = [
  { id: "any",     title: "Toda mensagem inbound",        desc: "Default — responde qualquer mensagem que cair na instância (respeitando a janela acima).", icon: Zap },
  { id: "keyword", title: "Por palavra-chave",            desc: "Só responde se a mensagem do cliente CONTIVER alguma das palavras configuradas.",          icon: Hash },
  { id: "webhook", title: "Por webhook (integração)",     desc: "Não responde mensagens normais. Inicia conversa ao receber POST no endpoint dedicado.",     icon: Webhook },
];

const MESSAGE_TYPE_OPTIONS: Array<{ id: string; label: string; desc: string }> = [
  { id: "text", label: "Texto", desc: "Mensagens comuns e respostas digitadas." },
  { id: "image", label: "Imagem", desc: "Fotos com ou sem legenda." },
  { id: "video", label: "Vídeo", desc: "Vídeos recebidos pelo WhatsApp." },
  { id: "audio", label: "Áudio", desc: "Áudios e voice notes." },
  { id: "document", label: "Documento", desc: "PDFs, arquivos e anexos." },
  { id: "sticker", label: "Sticker", desc: "Figurinhas." },
  { id: "location", label: "Localização", desc: "Localização fixa." },
  { id: "contact", label: "Contato", desc: "Cartões de contato/vCard." },
  { id: "poll", label: "Enquete", desc: "Votações e polls." },
];

function TriggerSection({
  trigger, onChange, apiBase,
}: {
  trigger: TriggerConfig;
  onChange: (t: TriggerConfig) => void;
  apiBase?: string;
}) {
  const [keywordInput, setKeywordInput] = useState("");
  const fullWebhookURL = trigger.webhook_slug
    ? `${(apiBase || "https://api.uniq.chat").replace(/\/$/, "")}/v1/webhooks/agent-trigger/${trigger.webhook_slug}`
    : "";

  const addKeyword = () => {
    const k = keywordInput.trim().toLowerCase();
    if (!k) return;
    if (trigger.keywords.some((x) => x.toLowerCase() === k)) {
      setKeywordInput("");
      return;
    }
    onChange({ ...trigger, keywords: [...trigger.keywords, k] });
    setKeywordInput("");
  };
  const removeKeyword = (i: number) =>
    onChange({ ...trigger, keywords: trigger.keywords.filter((_, idx) => idx !== i) });
  const selectedTypes = trigger.message_types.length ? trigger.message_types : ["text"];
  const toggleType = (id: string) => {
    const current = new Set(selectedTypes);
    if (current.has(id)) {
      current.delete(id);
    } else {
      current.add(id);
    }
    const next = MESSAGE_TYPE_OPTIONS.map((o) => o.id).filter((type) => current.has(type));
    onChange({ ...trigger, message_types: next.length ? next : ["text"] });
  };

  const copyURL = async () => {
    if (!fullWebhookURL) return;
    try {
      await navigator.clipboard.writeText(fullWebhookURL);
      toast.success("URL copiada");
    } catch {
      toast.error("Não consegui copiar — selecione manualmente");
    }
  };

  return (
    <div className="space-y-4 pt-2 border-t" style={{ borderColor: "var(--surface-border)" }}>
      <div>
        <h2 className="text-base font-semibold mb-1" style={{ color: "var(--text-1)" }}>O que dispara o agente</h2>
        <p className="text-xs" style={{ color: "var(--text-3)" }}>
          Define em qual <em>evento</em> o agente entra em ação. Combina com a janela acima — o agente só responde se ambos passarem.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {TRIGGER_PRESETS.map((p) => {
          const active = trigger.mode === p.id;
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange({ ...trigger, mode: p.id })}
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

      {trigger.mode !== "webhook" && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Tipos de mensagem que o agente atende</h3>
            <span className="text-[11px] whitespace-nowrap" style={{ color: "var(--text-3)" }}>
              {selectedTypes.length} ativo{selectedTypes.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {MESSAGE_TYPE_OPTIONS.map((option) => {
              const active = selectedTypes.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleType(option.id)}
                  className="text-left rounded-lg p-3 transition"
                  style={{
                    background: active ? "rgba(0,212,106,0.07)" : "var(--surface-3)",
                    border: `1px solid ${active ? "rgba(0,212,106,0.28)" : "var(--surface-border)"}`,
                  }}
                >
                  <p className="text-xs font-medium" style={{ color: "var(--text-1)" }}>{option.label}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>{option.desc}</p>
                </button>
              );
            })}
          </div>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
            Status do WhatsApp nunca dispara agente. Se nada for selecionado, o backend mantém Texto como padrão.
          </p>
        </div>
      )}

      {/* ── Keyword config ── */}
      {trigger.mode === "keyword" && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Palavras-chave</h3>
            <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
              {trigger.keywords.length} cadastrada{trigger.keywords.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(); } }}
              placeholder="ex: preço, comprar, orçamento"
              className="input-field text-xs flex-1"
            />
            <button
              type="button"
              onClick={addKeyword}
              className="text-[11px] px-2 py-1.5 rounded-md inline-flex items-center gap-1"
              style={{ background: "rgba(0,212,106,0.1)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.25)" }}
            >
              <Plus className="w-3 h-3" />
              Adicionar
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {trigger.keywords.length === 0 && (
              <span className="text-[11px]" style={{ color: "var(--text-3)" }}>
                Nenhuma palavra cadastrada — adicione pelo menos uma pra o agente disparar.
              </span>
            )}
            {trigger.keywords.map((k, i) => (
              <span
                key={`${i}-${k}`}
                className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md"
                style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
              >
                {k}
                <button
                  type="button"
                  onClick={() => removeKeyword(i)}
                  className="hover:opacity-60"
                  style={{ color: "#f87171" }}
                  title="Remover"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
            Match por substring case-insensitive. Ex: <code>preço</code> casa &quot;qual o preço?&quot; e &quot;preço amanhã&quot;.
          </p>
        </div>
      )}

      {/* ── Webhook config ── */}
      {trigger.mode === "webhook" && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Endpoint do webhook</h3>
          {fullWebhookURL ? (
            <>
              <div className="rounded-lg p-2.5 flex items-center gap-2"
                style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
                <code className="text-[11px] font-mono flex-1 truncate" style={{ color: "var(--text-1)" }}>
                  POST {fullWebhookURL}
                </code>
                <button
                  type="button"
                  onClick={copyURL}
                  className="p-1 rounded hover:bg-white/5"
                  style={{ color: "var(--text-3)" }}
                  title="Copiar URL"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
              <pre className="text-[10px] p-2 rounded overflow-x-auto"
                style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}>
{`Body JSON:
{
  "to": "5511999999999",
  "message": "Lead novo do site — interessado em automação",
  "from_name": "João da Silva",
  "variables": { "campanha": "black-friday" }
}`}
              </pre>
            </>
          ) : (
            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
              Salve o agente pra gerar a URL do webhook automaticamente.
            </p>
          )}

          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>
              Secret (opcional, recomendado em produção)
            </label>
            <input
              type="text"
              value={trigger.webhook_secret}
              onChange={(e) => onChange({ ...trigger, webhook_secret: e.target.value })}
              placeholder="Cole/gere um secret de 32+ caracteres"
              className="input-field text-xs w-full"
            />
            <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
              Quando preenchido, o webhook exige header <code>X-Uniq-Signature: hex(HMAC-SHA256(body, secret))</code>.
              Sem secret, a URL por si só é o token (slug de 32 chars random).
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
