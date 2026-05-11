"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Plus, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { integrationsApi } from "@/lib/api";

type Props = {
  instanceId: string;
  onClose: () => void;
  onCreated?: (id: string) => void;
};

const ROLE_PRESETS: Array<{
  id: string;
  label: string;
  emoji: string;
  description: string;
  defaultSkills: string;
}> = [
  {
    id: "support",
    label: "Suporte",
    emoji: "🎧",
    description: "Pós-venda, dúvidas e problemas",
    defaultSkills: "duvida, problema, suporte, ajuda",
  },
  {
    id: "closing",
    label: "Fechamento",
    emoji: "💰",
    description: "Conduz objeções e fecha vendas",
    defaultSkills: "fechar, contratar, comprar, finalizar",
  },
  {
    id: "billing",
    label: "Cobrança",
    emoji: "💳",
    description: "Cancelamentos, reembolso, boletos",
    defaultSkills: "cancelar, reembolso, boleto, fatura",
  },
  {
    id: "scheduling",
    label: "Agendamento",
    emoji: "📅",
    description: "Marca consultas e reuniões",
    defaultSkills: "agendar, marcar, horario, consulta",
  },
  {
    id: "post_sale",
    label: "Pós-venda",
    emoji: "🤝",
    description: "Acompanhamento e fidelização",
    defaultSkills: "feedback, satisfacao, recompra",
  },
  {
    id: "custom",
    label: "Customizado",
    emoji: "✨",
    description: "Configure manualmente",
    defaultSkills: "",
  },
];

// Modal de criação de agente secundário — primeiro escolhe um preset
// (ou custom), depois nome + skills. Skills ficam pré-preenchidas
// pelo preset pra economizar digitação. Após criar, redireciona pro
// Studio do novo agente.
export function NewAgentModal({ instanceId, onClose, onCreated }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"preset" | "details">("preset");
  const [preset, setPreset] = useState<(typeof ROLE_PRESETS)[number] | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [skillsText, setSkillsText] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      integrationsApi.createAgent(instanceId, {
        agent_name: name.trim(),
        role: role.trim().toLowerCase(),
        handoff_skills: skillsText
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ["instance-agents", instanceId] });
      toast.success("Agente criado.");
      onCreated?.(r?.data?.id || "");
      onClose();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Não foi possível criar."),
  });

  const choosePreset = (p: (typeof ROLE_PRESETS)[number]) => {
    setPreset(p);
    setName((prev) => prev || (p.id === "custom" ? "" : p.label));
    setRole(p.id === "custom" ? "" : p.id);
    setSkillsText(p.defaultSkills);
    setStep("details");
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-3"
          style={{ borderBottom: "1px solid var(--surface-border)" }}
        >
          <Sparkles className="w-4 h-4" style={{ color: "var(--green)" }} />
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
            Novo agente
          </h2>
          <span
            className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
            style={{ background: "var(--surface-2)", color: "var(--text-3)" }}
          >
            passo {step === "preset" ? "1" : "2"} / 2
          </span>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg hover:bg-white/5"
            style={{ color: "var(--text-3)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {step === "preset" && (
            <>
              <p className="text-xs" style={{ color: "var(--text-3)" }}>
                Que tipo de agente você quer adicionar à jornada?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ROLE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => choosePreset(p)}
                    className="flex items-start gap-2.5 p-3 rounded-xl text-left transition-all"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--surface-border)",
                    }}
                  >
                    <span style={{ fontSize: 18 }}>{p.emoji}</span>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                        {p.label}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
                        {p.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === "details" && preset && (
            <>
              <div
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid var(--surface-border)",
                }}
              >
                <span style={{ fontSize: 18 }}>{preset.emoji}</span>
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
                    {preset.label}
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                    {preset.description}
                  </p>
                </div>
                <button
                  onClick={() => setStep("preset")}
                  className="ml-auto text-[10px] px-2 py-1 rounded"
                  style={{
                    background: "var(--surface-3)",
                    color: "var(--text-2)",
                    border: "1px solid var(--surface-border)",
                  }}
                >
                  Trocar
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
                  Nome do agente
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Closer de vendas"
                  style={inputStyle}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
                  Função (role) — identificador curto
                </label>
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder="ex: closing"
                  style={inputStyle}
                />
                <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
                  Outros agentes usam isto em <code>[[handoff:role]]</code> pra transferir.
                </p>
              </div>

              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
                  Quando ativar este agente
                </label>
                <input
                  value={skillsText}
                  onChange={(e) => setSkillsText(e.target.value)}
                  placeholder="palavras separadas por vírgula"
                  style={inputStyle}
                />
                <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
                  Quando o cliente mencionar uma destas palavras, a conversa cai pra cá.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {step === "details" && (
          <div
            className="px-5 py-3 flex items-center justify-end gap-2"
            style={{
              borderTop: "1px solid var(--surface-border)",
              background: "var(--surface-2)",
            }}
          >
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
            >
              Cancelar
            </button>
            <button
              onClick={() => createMut.mutate()}
              disabled={!name.trim() || createMut.isPending}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}
            >
              {createMut.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Plus className="w-3 h-3" />
              )}
              Criar agente
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--surface-2)",
  border: "1px solid var(--surface-border)",
  borderRadius: 10,
  color: "var(--text-1)",
  fontSize: 13,
  outline: "none",
};
