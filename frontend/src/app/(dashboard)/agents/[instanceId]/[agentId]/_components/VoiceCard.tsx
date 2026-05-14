"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  ExternalLink,
  Loader2,
  Mic2,
  Play,
  Plus,
  RefreshCw,
  Upload,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { platformVoiceApi, voicesApi, type PlatformVoiceConfig } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { cn } from "@/lib/utils";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";
import type { AgentForm } from "../../../_shared/types";

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
};

type VoiceProvider = {
  id: string;
  provider: "elevenlabs" | "qwen_tts" | "openai_tts";
  name: string;
  masked_key?: string;
  is_active: boolean;
};

type WorkspaceVoice = {
  id: string;
  external_id: string;
  name: string;
  preview_url?: string;
  category?: string;
  language?: string;
  gender?: string;
  description?: string;
  is_active: boolean;
  voice_provider_id: string;
  platform_voice_id?: string;
  source?: "workspace_provider" | "uniq_voice";
  provider?: VoiceProvider;
};

type VoiceOption = {
  id: string;
  name: string;
  source: "uniq" | "workspace";
  provider?: string;
  language?: string;
  gender?: string;
  category?: string;
  previewUrl?: string;
  raw?: WorkspaceVoice;
};

type PlatformVoiceItem = {
  id?: string;
  voice_id?: string;
  name?: string;
  language?: string;
  gender?: string;
  category?: string;
  preview_url?: string;
};

const PROVIDER_LABEL: Record<string, string> = {
  elevenlabs: "ElevenLabs",
  qwen_tts: "Qwen TTS",
  openai_tts: "OpenAI TTS",
  uniq: "Qchat Voice",
};

// Voz do agente: seleção rápida + Voice Studio embutido. O Studio reaproveita
// as APIs já existentes de provider, sync e clone, mas fica acessível no fluxo
// natural do builder.
export function VoiceCard({ form, update }: Props) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";
  const [studioOpen, setStudioOpen] = useState(false);
  const [testingVoice, setTestingVoice] = useState<string | null>(null);

  const voicesQuery = useQuery({
    queryKey: ["voices", wsId],
    queryFn: () => voicesApi.listVoices(wsId).then((r) => r.data as WorkspaceVoice[]),
    enabled: !!wsId,
  });

  const platformQuery = useQuery({
    queryKey: ["platform-voice-public"],
    queryFn: () => platformVoiceApi.listPublic().then((r) => r.data as PlatformVoiceConfig[]),
  });

  const localVoices = voicesQuery.data || [];
  const platformVoice = platformQuery.data?.[0];
  const uniqVoices = useMemo(() => parseUniqVoiceOptions(platformVoice), [platformVoice]);
  const voiceOptions = useMemo<VoiceOption[]>(
    () => [
      ...uniqVoices,
      ...localVoices.map((v) => ({
        id: v.id,
        name: v.name,
        source: v.source === "uniq_voice" ? ("uniq" as const) : ("workspace" as const),
        provider: v.source === "uniq_voice" ? "uniq" : v.provider?.provider,
        language: v.language,
        gender: v.gender,
        category: v.category,
        previewUrl: v.preview_url,
        raw: v,
      })),
    ],
    [localVoices, uniqVoices],
  );

  const selectedVoice = voiceOptions.find((v) => v.id === form.voice.workspace_voice_id);
  const enabled = !!form.voice.audio_enabled;

  const selectVoice = (voiceId: string) => {
    update((p) => ({
      ...p,
      voice: { ...p.voice, audio_enabled: !!voiceId || p.voice.audio_enabled, workspace_voice_id: voiceId },
    }));
  };

  const handlePreview = async (voice: VoiceOption) => {
    if (testingVoice) return;
    if (voice.previewUrl) {
      new Audio(voice.previewUrl).play().catch(() => toast.error("Não foi possível tocar o preview."));
      return;
    }
    if (voice.source === "uniq") {
      toast.info("Essa voz Qchat Voice não possui preview público configurado.");
      return;
    }
    setTestingVoice(voice.id);
    try {
      const res = await voicesApi.testTTS(wsId, voice.id, "Olá! Esta é uma demonstração da voz configurada no agente.");
      const blob = new Blob([res.data], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      toast.error("Falha ao gerar áudio de teste.");
    } finally {
      setTestingVoice(null);
    }
  };

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
          {enabled ? selectedVoice?.name || "ligado" : "desligado"}
        </span>
      }
    >
      <div className="space-y-4 pt-3">
        <div
          className="rounded-xl p-3"
          style={{
            background: "linear-gradient(135deg, rgba(245,158,11,0.10), rgba(16,185,129,0.05))",
            border: "1px solid rgba(245,158,11,0.22)",
          }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
                Quando responder em áudio
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
                Se voz não estiver configurada quando precisar enviar áudio, o agente cai pra texto automaticamente.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {([
                  { id: "text", label: "Sempre texto", desc: "Nunca usa áudio" },
                  { id: "match_input", label: "Espelhar cliente", desc: "Áudio responde áudio · texto responde texto" },
                  { id: "audio", label: "Sempre áudio", desc: "Tenta TTS em toda resposta" },
                ] as const).map((opt) => {
                  const active = form.audio_reply_mode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        update((p) => ({
                          ...p,
                          audio_reply_mode: opt.id,
                          // Liga audio_enabled automático quando user pede áudio,
                          // pra UI da voz e a config de TTS ficarem coerentes.
                          voice: { ...p.voice, audio_enabled: opt.id !== "text" },
                        }))
                      }
                      title={opt.desc}
                      className="text-[11px] px-2.5 py-1.5 rounded-lg transition"
                      style={{
                        background: active ? "rgba(245,158,11,0.14)" : "var(--surface-2)",
                        color: active ? "#f59e0b" : "var(--text-2)",
                        border: `1px solid ${active ? "rgba(245,158,11,0.35)" : "var(--surface-border)"}`,
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setStudioOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all hover:opacity-90"
              style={{
                background: "var(--surface-1)",
                color: "#f59e0b",
                border: "1px solid rgba(245,158,11,0.25)",
              }}
            >
              <Wand2 className="w-3.5 h-3.5" />
              Voice Studio
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {enabled && (
          <>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[11px] font-medium" style={{ color: "var(--text-2)" }}>
                  Voz do agente
                </label>
                <Link
                  href="/integrations?tab=voices"
                  className="inline-flex items-center gap-1 text-[10px] hover:underline"
                  style={{ color: "var(--green)" }}
                >
                  Biblioteca completa
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {voiceOptions.length === 0 ? (
                <div
                  className="rounded-lg px-3 py-2.5 text-xs"
                  style={{
                    background: "rgba(245,158,11,0.06)",
                    border: "1px solid rgba(245,158,11,0.20)",
                    color: "#fbbf24",
                  }}
                >
                  Nenhuma voz disponível. Abra o Voice Studio para conectar um provider, sincronizar ou clonar uma voz.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {voiceOptions.map((voice) => {
                    const isSelected = voice.id === form.voice.workspace_voice_id;
                    return (
                      <button
                        key={voice.id}
                        type="button"
                        onClick={() => selectVoice(voice.id)}
                        className="group text-left rounded-xl p-3 transition-all"
                        style={{
                          background: isSelected ? "rgba(245,158,11,0.10)" : "var(--surface-2)",
                          border: isSelected
                            ? "1px solid rgba(245,158,11,0.45)"
                            : "1px solid var(--surface-border)",
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{
                              background: voice.source === "uniq" ? "rgba(245,158,11,0.14)" : "rgba(96,165,250,0.10)",
                              color: voice.source === "uniq" ? "#f59e0b" : "#60a5fa",
                            }}
                          >
                            <Volume2 className="w-4 h-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold truncate" style={{ color: "var(--text-1)" }}>
                              {voice.name}
                            </span>
                            <span className="block text-[10px] truncate" style={{ color: "var(--text-3)" }}>
                              {voice.source === "uniq" ? "Qchat Voice" : PROVIDER_LABEL[voice.provider || ""] || voice.provider}
                              {[voice.language, voice.gender, voice.category].filter(Boolean).length > 0
                                ? ` · ${[voice.language, voice.gender, voice.category].filter(Boolean).join(" · ")}`
                                : ""}
                            </span>
                          </span>
                          {isSelected && <Check className="w-4 h-4 flex-shrink-0" style={{ color: "#f59e0b" }} />}
                        </div>
                        <div className="flex items-center justify-between mt-2">
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded"
                            style={{
                              background: "var(--surface-1)",
                              color: voice.source === "uniq" ? "#f59e0b" : "var(--text-3)",
                              border: "1px solid var(--surface-border)",
                            }}
                          >
                            {voice.source === "uniq" ? "pré-configurada" : "workspace"}
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePreview(voice);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                handlePreview(voice);
                              }
                            }}
                            className="inline-flex items-center gap-1 text-[10px] hover:opacity-80"
                            style={{ color: "#f59e0b" }}
                          >
                            {testingVoice === voice.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Play className="w-3 h-3" />
                            )}
                            Preview
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Slider
                label="Estabilidade"
                hint="Mais alto = mais consistente, mais baixo = mais expressivo"
                min={0}
                max={1}
                step={0.05}
                value={form.voice.stability}
                onChange={(v) => update((p) => ({ ...p, voice: { ...p.voice, stability: v } }))}
              />
              <Slider
                label="Similaridade"
                hint="Quanto a voz se mantém fiel ao timbre original"
                min={0}
                max={1}
                step={0.05}
                value={form.voice.similarity}
                onChange={(v) => update((p) => ({ ...p, voice: { ...p.voice, similarity: v } }))}
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
                hint={`${form.voice.speed.toFixed(2)}x - natural perto de 1.00`}
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

      {studioOpen && (
        <VoiceStudioModal
          workspaceId={wsId}
          selectedVoiceId={form.voice.workspace_voice_id || ""}
          onClose={() => setStudioOpen(false)}
          onSelectVoice={selectVoice}
          onCreatedVoice={(voiceId) => {
            selectVoice(voiceId);
            update((p) => ({ ...p, voice: { ...p.voice, audio_enabled: true, workspace_voice_id: voiceId } }));
          }}
        />
      )}
    </CollapsibleCard>
  );
}

function VoiceStudioModal({
  workspaceId,
  selectedVoiceId,
  onClose,
  onSelectVoice,
  onCreatedVoice,
}: {
  workspaceId: string;
  selectedVoiceId: string;
  onClose: () => void;
  onSelectVoice: (voiceId: string) => void;
  onCreatedVoice: (voiceId: string) => void;
}) {
  const qc = useQueryClient();
  const [providerName, setProviderName] = useState("ElevenLabs");
  const [apiKey, setApiKey] = useState("");
  const [cloneProviderId, setCloneProviderId] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [cloneDescription, setCloneDescription] = useState("");
  const [cloneFiles, setCloneFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const providersQuery = useQuery({
    queryKey: ["voice-providers", workspaceId],
    queryFn: () => voicesApi.listProviders(workspaceId).then((r) => r.data as VoiceProvider[]),
    enabled: !!workspaceId,
  });

  const voicesQuery = useQuery({
    queryKey: ["voices", workspaceId],
    queryFn: () => voicesApi.listVoices(workspaceId, { active: "all" }).then((r) => r.data as WorkspaceVoice[]),
    enabled: !!workspaceId,
  });

  const providers = providersQuery.data || [];
  const voices = voicesQuery.data || [];
  const elevenLabsProviders = providers.filter((p) => p.provider === "elevenlabs");
  const cloneProvider = cloneProviderId || "uniq";

  const createProvider = useMutation({
    mutationFn: () =>
      voicesApi.createProvider(workspaceId, {
        provider: "elevenlabs",
        name: providerName.trim() || "ElevenLabs",
        api_key: apiKey.trim(),
      }),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["voice-providers", workspaceId] });
      setApiKey("");
      setProviderName("ElevenLabs");
      toast.success("Provider conectado.");
      const id = (res.data as VoiceProvider).id;
      if (id) syncVoices.mutate(id);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Falha ao conectar provider."),
  });

  const syncVoices = useMutation({
    mutationFn: (providerId: string) => voicesApi.syncVoices(workspaceId, providerId),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["voices", workspaceId] });
      toast.success(`${res.data?.synced ?? 0} vozes sincronizadas.`);
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Falha ao sincronizar vozes."),
  });

  const cloneVoice = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("name", cloneName.trim());
      form.append("description", cloneDescription.trim());
      form.append("labels", JSON.stringify({ source: "uniq_agent_builder" }));
      cloneFiles.forEach((file) => form.append("files", file));
      if (cloneProvider === "uniq") return voicesApi.cloneUniqVoice(workspaceId, form);
      return voicesApi.cloneVoice(workspaceId, cloneProvider, form);
    },
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ["voices", workspaceId] });
      const id = res.data?.id as string | undefined;
      if (id) onCreatedVoice(id);
      setCloneName("");
      setCloneDescription("");
      setCloneFiles([]);
      toast.success("Voz clonada e selecionada no agente.");
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || "Falha ao clonar voz."),
  });

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-5"
      style={{ background: "var(--surface-overlay)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-4xl max-h-[88vh] overflow-hidden rounded-2xl"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--surface-border)" }}>
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(245,158,11,0.14)", color: "#f59e0b" }}
            >
              <Mic2 className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                Voice Studio do agente
              </h3>
              <p className="text-[11px] truncate" style={{ color: "var(--text-3)" }}>
                Conecte provider, sincronize vozes, clone timbres e selecione a voz deste agente.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:opacity-70" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-4 max-h-[calc(88vh-66px)]">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
                    Vozes do workspace
                  </p>
                  <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                    As vozes abaixo podem ser usadas por qualquer agente deste workspace.
                  </p>
                </div>
                <Link
                  href="/integrations?tab=voices"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold"
                  style={{ background: "var(--surface-2)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}
                >
                  Biblioteca
                  <ExternalLink className="w-3 h-3" />
                </Link>
              </div>

              {voices.length === 0 ? (
                <div
                  className="rounded-xl p-5 text-center"
                  style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)" }}
                >
                  <Volume2 className="w-6 h-6 mx-auto mb-2" style={{ color: "var(--text-4)" }} />
                  <p className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                    Nenhuma voz própria ainda.
                  </p>
                  <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
                    Conecte ElevenLabs e sincronize ou clone uma voz nova.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {voices.map((voice) => {
                    const isSelected = selectedVoiceId === voice.id;
                    return (
                      <button
                        key={voice.id}
                        type="button"
                        onClick={() => onSelectVoice(voice.id)}
                        className="rounded-xl p-3 text-left transition-all"
                        style={{
                          background: isSelected ? "rgba(245,158,11,0.10)" : "var(--surface-2)",
                          border: isSelected ? "1px solid rgba(245,158,11,0.45)" : "1px solid var(--surface-border)",
                        }}
                      >
                        <div className="flex items-start gap-2">
                          <Volume2 className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#f59e0b" }} />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold truncate" style={{ color: "var(--text-1)" }}>
                              {voice.name}
                            </p>
                            <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
                              {PROVIDER_LABEL[voice.provider?.provider || ""] || voice.provider?.provider || "Provider"}
                              {[voice.language, voice.gender, voice.category].filter(Boolean).length > 0
                                ? ` · ${[voice.language, voice.gender, voice.category].filter(Boolean).join(" · ")}`
                                : ""}
                            </p>
                          </div>
                          {isSelected && <Check className="w-4 h-4 flex-shrink-0" style={{ color: "#f59e0b" }} />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <aside className="space-y-3">
              <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
                  Provider próprio
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
                  Opcional: use sua própria conta ElevenLabs, Qwen ou OpenAI TTS.
                </p>
                <input
                  value={providerName}
                  onChange={(e) => setProviderName(e.target.value)}
                  placeholder="Nome do provider"
                  style={inputStyle}
                  className="mt-3"
                />
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="API key ElevenLabs"
                  type="password"
                  style={inputStyle}
                  className="mt-2"
                />
                <button
                  type="button"
                  disabled={!apiKey.trim() || createProvider.isPending}
                  onClick={() => createProvider.mutate()}
                  className="mt-2 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold disabled:opacity-40"
                  style={{ background: "var(--green)", color: "var(--green-fg)" }}
                >
                  {createProvider.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Conectar e sincronizar
                </button>
              </div>

              <div className="rounded-xl p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
                    Providers
                  </p>
                  {providersQuery.isLoading && <Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--text-3)" }} />}
                </div>
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2 rounded-lg px-2 py-2" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)" }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold truncate" style={{ color: "var(--text-1)" }}>
                        Qchat Voice
                      </p>
                      <p className="text-[9px]" style={{ color: "#f59e0b" }}>
                        Presetado pela plataforma
                      </p>
                    </div>
                    <Check className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
                  </div>
                  {providers.length === 0 ? (
                    <p className="text-[10px]" style={{ color: "var(--text-4)" }}>
                      Nenhum provider próprio conectado.
                    </p>
                  ) : (
                    providers.map((provider) => (
                      <div key={provider.id} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium truncate" style={{ color: "var(--text-2)" }}>
                            {provider.name}
                          </p>
                          <p className="text-[9px]" style={{ color: "var(--text-4)" }}>
                            {PROVIDER_LABEL[provider.provider] || provider.provider}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => syncVoices.mutate(provider.id)}
                          disabled={syncVoices.isPending}
                          className="p-1.5 rounded-md hover:opacity-80 disabled:opacity-40"
                          style={{ color: "#f59e0b" }}
                          title="Sincronizar vozes"
                        >
                          <RefreshCw className={cn("w-3.5 h-3.5", syncVoices.isPending && "animate-spin")} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-xl p-3" style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.24)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>
                  Clonar voz
                </p>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-3)" }}>
                  Envie uma ou mais amostras de áudio limpas para criar um timbre novo.
                </p>

                <select
                  value={cloneProvider}
                  onChange={(e) => setCloneProviderId(e.target.value)}
                  style={inputStyle}
                  className="mt-3"
                >
                  <option value="uniq">Qchat Voice - provider da plataforma</option>
                  {elevenLabsProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} - ElevenLabs próprio
                    </option>
                  ))}
                </select>

                <input
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  placeholder="Nome da voz"
                  style={inputStyle}
                  className="mt-2"
                />
                <textarea
                  value={cloneDescription}
                  onChange={(e) => setCloneDescription(e.target.value)}
                  placeholder="Descrição opcional"
                  style={{ ...inputStyle, minHeight: 66, resize: "vertical" }}
                  className="mt-2"
                />

                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*"
                  multiple
                  className="hidden"
                  onChange={(e) => setCloneFiles(Array.from(e.target.files || []))}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="mt-2 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold"
                  style={{ background: "var(--surface-1)", color: "var(--text-2)", border: "1px dashed var(--surface-border)" }}
                >
                  <Upload className="w-3.5 h-3.5" />
                  {cloneFiles.length > 0 ? `${cloneFiles.length} arquivo(s) selecionado(s)` : "Selecionar amostras"}
                </button>

                <button
                  type="button"
                  disabled={!cloneProvider || !cloneName.trim() || cloneFiles.length === 0 || cloneVoice.isPending}
                  onClick={() => cloneVoice.mutate()}
                  className="mt-2 w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold disabled:opacity-40"
                  style={{ background: "#f59e0b", color: "#111827" }}
                >
                  {cloneVoice.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                  Criar voz e usar no agente
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseUniqVoiceOptions(platformVoice?: PlatformVoiceConfig): VoiceOption[] {
  if (!platformVoice?.voices) return [];
  try {
    const parsed = JSON.parse(platformVoice.voices) as PlatformVoiceItem[];
    return parsed
      .map((voice, idx) => {
        const externalId = voice.id || voice.voice_id;
        if (!externalId) return null;
        return {
          id: `uniq:${externalId}`,
          name: voice.name || `Qchat Voice ${idx + 1}`,
          source: "uniq" as const,
          provider: "uniq",
          language: voice.language,
          gender: voice.gender,
          category: voice.category,
          previewUrl: voice.preview_url,
        };
      })
      .filter(Boolean) as VoiceOption[];
  } catch {
    return [];
  }
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
        <span className="text-[10px] font-mono tabular-nums" style={{ color: "var(--text-3)" }}>
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--surface-1)",
  border: "1px solid var(--surface-border)",
  borderRadius: 10,
  color: "var(--text-1)",
  fontSize: 12,
  outline: "none",
};
