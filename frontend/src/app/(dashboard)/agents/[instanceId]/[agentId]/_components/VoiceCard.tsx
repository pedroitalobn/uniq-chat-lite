"use client";

import { useQuery } from "@tanstack/react-query";
import { Mic2, Volume2 } from "lucide-react";
import { voicesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";
import type { AgentForm } from "../../../_shared/types";

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
};

// Card de Voz — toggle de áudio + seletor de voz do workspace + sliders
// fine-grained (estabilidade, similaridade, estilo, velocidade). Antes
// vivia dividido entre Personality e Voice Studio; agora consolidado.
// Vozes são gerenciadas em /admin/providers ou /workspace.
export function VoiceCard({ form, update }: Props) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";

  const voicesQuery = useQuery({
    queryKey: ["voices", wsId],
    queryFn: () =>
      voicesApi
        .listVoices(wsId)
        .then(
          (r) =>
            r.data as Array<{
              id: string;
              name: string;
              language: string;
              gender: string;
              provider?: { provider: string };
            }>,
        ),
    enabled: !!wsId,
  });

  const voices = voicesQuery.data || [];
  const selectedVoice = voices.find((v) => v.id === form.voice.workspace_voice_id);
  const enabled = !!form.voice.audio_enabled;

  return (
    <CollapsibleCard
      title="Voz"
      icon={Mic2}
      accentColor="#f59e0b"
      defaultOpen={false}
      meta={
        <span
          className="text-[10px] px-2 py-0.5 rounded-full font-medium"
          style={
            enabled
              ? {
                  background: "rgba(245,158,11,0.12)",
                  color: "#f59e0b",
                  border: "1px solid rgba(245,158,11,0.25)",
                }
              : {
                  background: "var(--surface-2)",
                  color: "var(--text-4)",
                  border: "1px solid var(--surface-border)",
                }
          }
        >
          {enabled ? (selectedVoice?.name || "ligado") : "desligado"}
        </span>
      }
    >
      <div className="space-y-4 pt-3">
        {/* Toggle */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              update((p) => ({
                ...p,
                voice: { ...p.voice, audio_enabled: e.target.checked },
              }))
            }
            className="mt-0.5"
          />
          <div>
            <p className="text-xs font-medium" style={{ color: "var(--text-1)" }}>
              Habilitar áudio
            </p>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-4)" }}>
              Quando ligado, o agente envia áudio (TTS) em vez de só texto
            </p>
          </div>
        </label>

        {enabled && (
          <>
            {/* Seletor de voz */}
            <div>
              <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
                Voz
              </label>
              {voices.length === 0 ? (
                <div
                  className="rounded-lg px-3 py-2.5 text-xs"
                  style={{
                    background: "rgba(245,158,11,0.06)",
                    border: "1px solid rgba(245,158,11,0.20)",
                    color: "#fbbf24",
                  }}
                >
                  Nenhuma voz cadastrada no workspace. Configure em <b>/workspace</b> ou
                  <b> /admin/providers</b>.
                </div>
              ) : (
                <select
                  value={form.voice.workspace_voice_id || ""}
                  onChange={(e) =>
                    update((p) => ({
                      ...p,
                      voice: { ...p.voice, workspace_voice_id: e.target.value },
                    }))
                  }
                  style={selectStyle}
                >
                  <option value="">— Selecionar voz —</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.language}{v.provider?.provider ? ` · ${v.provider.provider}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Sliders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Slider
                label="Estabilidade"
                hint="Mais alto = mais consistente, mais baixo = mais expressivo"
                min={0}
                max={1}
                step={0.05}
                value={form.voice.stability}
                onChange={(v) =>
                  update((p) => ({ ...p, voice: { ...p.voice, stability: v } }))
                }
              />
              <Slider
                label="Similaridade"
                hint="Quanto a voz se mantém fiel ao timbre original"
                min={0}
                max={1}
                step={0.05}
                value={form.voice.similarity}
                onChange={(v) =>
                  update((p) => ({ ...p, voice: { ...p.voice, similarity: v } }))
                }
              />
              <Slider
                label="Estilo"
                hint="Intensidade emocional"
                min={0}
                max={1}
                step={0.05}
                value={form.voice.style}
                onChange={(v) => update((p) => ({ ...p, voice: { ...p.voice, style: v } }))}
              />
              <Slider
                label="Velocidade"
                hint={`${form.voice.speed.toFixed(2)}× — natural ≈ 1.00`}
                min={0.7}
                max={1.2}
                step={0.05}
                value={form.voice.speed}
                onChange={(v) => update((p) => ({ ...p, voice: { ...p.voice, speed: v } }))}
              />
            </div>
          </>
        )}
      </div>
    </CollapsibleCard>
  );
}

function Slider({
  label,
  hint,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-[11px] font-medium" style={{ color: "var(--text-2)" }}>
          {label}
        </label>
        <span
          className="text-[10px] font-mono tabular-nums"
          style={{ color: "var(--text-3)" }}
        >
          {value.toFixed(2)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full mt-1 accent-amber-500"
      />
      {hint && (
        <p className="text-[9px] mt-0.5" style={{ color: "var(--text-4)" }}>
          {hint}
        </p>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--surface-2)",
  border: "1px solid var(--surface-border)",
  borderRadius: 10,
  color: "var(--text-1)",
  fontSize: 13,
  outline: "none",
};
