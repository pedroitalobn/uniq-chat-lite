"use client";

// PlatformVoicePanel — gestão de providers globais de TTS (Qchat Voice).
// Espelha o pattern do PlatformAIPanel mas pra voz. Workspaces que têm
// allow_voice no plano e nenhum VoiceProvider próprio caem aqui.
//
// Embedável dentro de /admin/providers?tab=voice. Sem subrouting próprio
// — todo o estado vive no painel.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mic2, Plus, Loader2, Trash2, Edit2, Zap, Eye, EyeOff } from "lucide-react";
import { platformVoiceApi, PlatformVoiceConfig } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";

const PROVIDERS = [
  { id: "openai_tts",   label: "OpenAI TTS",  hint: "tts-1, tts-1-hd · 6 vozes default" },
  { id: "elevenlabs",   label: "ElevenLabs",  hint: "Multi-língua, clonagem de voz" },
  { id: "qwen_tts",     label: "Qwen TTS",    hint: "Alibaba Cloud DashScope" },
  { id: "azure_tts",    label: "Azure TTS",   hint: "Cognitive Services Speech" },
];

type Form = Partial<PlatformVoiceConfig> & { api_key?: string };

const empty = (): Form => ({ provider: "openai_tts", name: "Qchat Voice", is_active: true });

export function PlatformVoicePanel() {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const { data: configs = [], isLoading } = useQuery<PlatformVoiceConfig[]>({
    queryKey: ["admin", "platform-voice"],
    queryFn: () => platformVoiceApi.list().then(r => r.data),
  });

  const createMut = useMutation({
    mutationFn: (f: Form) => platformVoiceApi.create(f),
    onSuccess: () => {
      toast.success("Provider criado");
      qc.invalidateQueries({ queryKey: ["admin", "platform-voice"] });
      setForm(null);
    },
    onError: () => toast.error("Erro ao criar"),
  });
  const updateMut = useMutation({
    mutationFn: (f: Form) => platformVoiceApi.update(f.id!, f),
    onSuccess: () => {
      toast.success("Provider salvo");
      qc.invalidateQueries({ queryKey: ["admin", "platform-voice"] });
      setForm(null);
    },
    onError: () => toast.error("Erro ao salvar"),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => platformVoiceApi.delete(id),
    onSuccess: () => {
      toast.success("Provider removido");
      qc.invalidateQueries({ queryKey: ["admin", "platform-voice"] });
    },
  });
  const testMut = useMutation({
    mutationFn: (id: string) => platformVoiceApi.test(id),
    onSuccess: (r) => {
      if (r.data.ok) toast.success("Conexão OK");
      else toast.error(r.data.message || "Conexão falhou");
      qc.invalidateQueries({ queryKey: ["admin", "platform-voice"] });
    },
  });

  const openNew = () => { setIsNew(true); setForm(empty()); setShowKey(false); };
  const openEdit = (c: PlatformVoiceConfig) => {
    setIsNew(false);
    setForm({ ...c, api_key: "" });
    setShowKey(false);
  };
  const save = () => {
    if (!form) return;
    if (!form.provider) return toast.error("Provider é obrigatório");
    if (isNew && !form.api_key) return toast.error("API key é obrigatória");
    isNew ? createMut.mutate(form) : updateMut.mutate(form);
  };

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto" }}>
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl"
          style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <Mic2 className="w-4 h-4" style={{ color: "#f59e0b" }} />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Qchat Voice</h2>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            Provedores TTS globais — disponíveis pra workspaces com allow_voice no plano
          </p>
        </div>
        <button
          onClick={openNew}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: "#f59e0b", color: "#1f1300" }}
        >
          <Plus className="w-3.5 h-3.5" />
          Novo provider
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--text-3)" }} /></div>
      ) : configs.length === 0 ? (
        <div className="rounded-xl py-12 text-center"
          style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)" }}>
          <Mic2 className="w-8 h-8 mx-auto mb-2 opacity-40" style={{ color: "var(--text-3)" }} />
          <p className="text-sm" style={{ color: "var(--text-2)" }}>Nenhum provider configurado</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Adicione OpenAI TTS, ElevenLabs ou outro pra ativar Qchat Voice
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {configs.map((c) => {
            const meta = PROVIDERS.find(p => p.id === c.provider);
            return (
              <div key={c.id}
                className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{c.name || meta?.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{
                        background: c.is_active ? "rgba(37, 99, 235,0.12)" : "var(--input)",
                        color: c.is_active ? "var(--green)" : "var(--text-3)",
                        border: `1px solid ${c.is_active ? "rgba(37, 99, 235,0.25)" : "var(--surface-border)"}`,
                      }}>
                      {c.is_active ? "Ativo" : "Inativo"}
                    </span>
                    {c.test_status === "ok" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(37, 99, 235,0.10)", color: "var(--green)" }}>✓ testado</span>
                    )}
                    {c.test_status === "failed" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: "rgba(239,68,68,0.10)", color: "#ef4444" }}>⚠ falhou</span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
                    {meta?.label || c.provider} · {c.has_api_key ? "API key configurada" : "⚠ sem API key"}
                  </p>
                </div>
                <button
                  onClick={() => testMut.mutate(c.id!)}
                  disabled={testMut.isPending || !c.has_api_key}
                  className="p-2 rounded-lg disabled:opacity-40"
                  style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
                  title="Testar conexão"
                >
                  {testMut.isPending && testMut.variables === c.id
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Zap className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => openEdit(c)}
                  className="p-2 rounded-lg"
                  style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
                  title="Editar"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={async () => {
                    if (!await showConfirm(`Remover provider "${c.name}"?`, { title: "Remover", confirmLabel: "Remover" })) return;
                    deleteMut.mutate(c.id!);
                  }}
                  className="p-2 rounded-lg"
                  style={{ background: "rgba(239,68,68,0.10)", color: "#ef4444" }}
                  title="Remover"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Edit/Create modal — overlay simples sem framer-motion pra não
          puxar mais 1 dep no admin. Mesma vibe do PlatformAIPanel. */}
      {form && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4"
          style={{ background: "var(--surface-overlay)", backdropFilter: "blur(8px)" }}
          onClick={() => setForm(null)}>
          <div className="w-full max-w-md rounded-2xl p-5 space-y-4"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
            onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
              {isNew ? "Novo provider Qchat Voice" : "Editar provider"}
            </h3>

            <Field label="Provider">
              <select
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                className="input-field w-full text-sm"
              >
                {PROVIDERS.map(p => (
                  <option key={p.id} value={p.id} style={{ background: "#111" }}>{p.label}</option>
                ))}
              </select>
              <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
                {PROVIDERS.find(p => p.id === form.provider)?.hint}
              </p>
            </Field>

            <Field label="Nome (visível pro user como)">
              <input
                value={form.name || ""}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Qchat Voice"
                className="input-field w-full text-sm"
              />
            </Field>

            <Field label="API Key">
              <div className="relative">
                <input
                  value={form.api_key || ""}
                  onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                  placeholder={isNew ? "Cole sua API key" : (form.has_api_key ? "Mantém atual se vazio" : "Cole sua API key")}
                  type={showKey ? "text" : "password"}
                  className="input-field w-full text-sm pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1"
                  style={{ color: "var(--text-3)" }}
                >
                  {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </Field>

            <Field label="Base URL (opcional)">
              <input
                value={form.base_url || ""}
                onChange={(e) => setForm({ ...form, base_url: e.target.value })}
                placeholder="Padrão do provider"
                className="input-field w-full text-sm"
              />
            </Field>

            <Field label="Vozes (JSON opcional)">
              <textarea
                value={form.voices || ""}
                onChange={(e) => setForm({ ...form, voices: e.target.value })}
                placeholder={`[{"id":"alloy","name":"Alloy","language":"en","gender":"neutral"}]`}
                rows={3}
                className="input-field w-full text-xs font-mono"
                style={{ resize: "vertical" }}
              />
              <p className="text-[10px] mt-1" style={{ color: "var(--text-3)" }}>
                Lista pré-cadastrada de vozes. Vazio = users escolhem ID livre.
              </p>
            </Field>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_active ?? true}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              <span className="text-xs" style={{ color: "var(--text-2)" }}>Ativo (workspaces podem usar)</span>
            </label>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setForm(null)}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: "var(--surface-2)", color: "var(--text-2)" }}
              >Cancelar</button>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
                style={{ background: "#f59e0b", color: "#1f1300" }}
              >
                {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                {isNew ? "Criar" : "Salvar"}
              </button>
            </div>
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
