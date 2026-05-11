"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Mic, Plus, Trash2, RefreshCw, Volume2, Eye, EyeOff,
  ChevronDown, ChevronRight, Loader2, Play, X,
} from "lucide-react";
import { voicesApi, platformVoiceApi, PlatformVoiceConfig } from "@/lib/api";
import { toast } from "sonner";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { cn } from "@/lib/utils";
import { showConfirm } from "@/lib/confirm";

interface VoiceProvider {
  id: string;
  provider: "elevenlabs" | "qwen_tts" | "openai_tts";
  name: string;
  masked_key: string;
  is_active: boolean;
  created_at: string;
}

interface WorkspaceVoice {
  id: string;
  external_id: string;
  name: string;
  preview_url: string;
  category: string;
  language: string;
  gender: string;
  description: string;
  is_active: boolean;
  voice_provider_id: string;
  provider?: VoiceProvider;
}

const PROVIDER_META = {
  elevenlabs: { label: "ElevenLabs", color: "#f5a623", bg: "rgba(245,166,35,0.08)", border: "rgba(245,166,35,0.2)" },
  qwen_tts: { label: "Qwen TTS", color: "#ff6a00", bg: "rgba(255,106,0,0.08)", border: "rgba(255,106,0,0.2)" },
  openai_tts: { label: "OpenAI TTS", color: "#10a37f", bg: "rgba(16,163,127,0.08)", border: "rgba(16,163,127,0.2)" },
} as const;

type ProviderType = keyof typeof PROVIDER_META;

export function VoicesSection() {
  const { currentWorkspace } = useWorkspace();
  const workspaceId = currentWorkspace?.id ?? "";
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [testingVoice, setTestingVoice] = useState<string | null>(null);
  const [previewAudio, setPreviewAudio] = useState<HTMLAudioElement | null>(null);

  const { data: providers = [], isLoading: loadingProviders } = useQuery<VoiceProvider[]>({
    queryKey: ["voice-providers", workspaceId],
    queryFn: () => voicesApi.listProviders(workspaceId).then(r => r.data),
    enabled: !!workspaceId,
  });

  // Uniq Voice: TTS gerenciado pela plataforma. Se o super admin
  // configurou + o plano do user libera, mostramos um card destaque
  // permitindo usar sem precisar configurar provider próprio.
  // Backend faz o gating real (plan.allow_voice + active config); aqui
  // só consultamos o endpoint público que já filtra ativos.
  const { data: platformVoices = [] } = useQuery<PlatformVoiceConfig[]>({
    queryKey: ["platform-voice-public"],
    queryFn: () => platformVoiceApi.listPublic().then(r => r.data),
  });
  const uniqVoice = platformVoices[0];

  const { data: allVoices = [] } = useQuery<WorkspaceVoice[]>({
    queryKey: ["voices", workspaceId],
    queryFn: () => voicesApi.listVoices(workspaceId, { active: "all" }).then(r => r.data),
    enabled: !!workspaceId,
  });

  const deleteProvider = useMutation({
    mutationFn: (id: string) => voicesApi.deleteProvider(workspaceId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice-providers", workspaceId] });
      qc.invalidateQueries({ queryKey: ["voices", workspaceId] });
      toast.success("Provider removido");
    },
  });

  const syncVoices = useMutation({
    mutationFn: (providerId: string) => voicesApi.syncVoices(workspaceId, providerId),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["voices", workspaceId] });
      toast.success(`${res.data.synced} vozes sincronizadas`);
    },
    onError: () => toast.error("Falha ao sincronizar vozes"),
  });

  const toggleVoice = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      voicesApi.toggleVoice(workspaceId, id, is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["voices", workspaceId] }),
  });

  const handleTestVoice = async (voice: WorkspaceVoice) => {
    if (testingVoice) return;
    setTestingVoice(voice.id);
    try {
      const res = await voicesApi.testTTS(workspaceId, voice.id);
      const blob = new Blob([res.data], { type: "audio/mpeg" });
      const url = URL.createObjectURL(blob);
      if (previewAudio) { previewAudio.pause(); URL.revokeObjectURL(previewAudio.src); }
      const audio = new Audio(url);
      setPreviewAudio(audio);
      audio.play();
      audio.onended = () => { URL.revokeObjectURL(url); setPreviewAudio(null); };
    } catch {
      toast.error("Falha ao gerar áudio de teste");
    } finally {
      setTestingVoice(null);
    }
  };

  const voicesByProvider = (providerId: string) =>
    allVoices.filter(v => v.voice_provider_id === providerId);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Vozes & TTS</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>
            Conecte provedores de Text-to-Speech e ative vozes para seus agentes.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all hover:opacity-90"
          style={{ background: "var(--green)", color: "#000" }}>
          <Plus className="w-3.5 h-3.5" />
          Adicionar provider
        </button>
      </div>

      {/* Uniq Voice — card destaque quando platform tem voice configurado.
          Aparece antes da lista de providers próprios. Não requer setup —
          se o plano libera + super admin configurou, agentes já podem usar. */}
      {uniqVoice && (
        <div
          className="rounded-2xl p-4 flex items-start gap-3"
          style={{
            background: "linear-gradient(135deg, rgba(245,158,11,0.10), rgba(0,212,106,0.06))",
            border: "1px solid rgba(245,158,11,0.30)",
          }}
        >
          <div className="p-2.5 rounded-xl flex-shrink-0"
            style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.30)" }}>
            <Volume2 className="w-4 h-4" style={{ color: "#f59e0b" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
                Uniq Voice
              </h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ background: "rgba(0,212,106,0.12)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.25)" }}>
                Disponível
              </span>
            </div>
            <p className="text-xs mt-1" style={{ color: "var(--text-2)" }}>
              TTS gerenciado pela plataforma — sem precisar configurar provider próprio. Já pode ser usado direto pelos seus agentes.
            </p>
            <p className="text-[11px] mt-1.5" style={{ color: "var(--text-3)" }}>
              Quer usar API key própria? Adicione um provider abaixo (ElevenLabs, OpenAI TTS, etc.) — ele tem prioridade sobre o Uniq Voice.
            </p>
          </div>
        </div>
      )}

      {/* Providers list */}
      {loadingProviders ? (
        <div className="flex items-center gap-2 py-8 justify-center" style={{ color: "var(--text-3)" }}>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Carregando...</span>
        </div>
      ) : providers.length === 0 ? (
        <EmptyState onAdd={() => setShowAdd(true)} />
      ) : (
        <div className="space-y-3">
          {providers.map((p) => {
            const meta = PROVIDER_META[p.provider as ProviderType] ?? { label: p.provider, color: "#64748b", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.2)" };
            const voices = voicesByProvider(p.id);
            const activeVoices = voices.filter(v => v.is_active).length;
            const isExpanded = expandedProvider === p.id;

            return (
              <div key={p.id} className="rounded-2xl overflow-hidden"
                style={{ border: `1px solid ${meta.border}`, background: meta.bg }}>
                {/* Provider header */}
                <div className="flex items-center gap-3 p-4">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: `${meta.color}20`, border: `1px solid ${meta.color}40` }}>
                    <Mic className="w-4 h-4" style={{ color: meta.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{p.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-3)" }}>
                      {meta.label} · {activeVoices} voz{activeVoices !== 1 ? "es" : ""} ativa{activeVoices !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => syncVoices.mutate(p.id)}
                      disabled={syncVoices.isPending}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                      style={{ background: `${meta.color}15`, color: meta.color }}
                      title="Sincronizar vozes">
                      <RefreshCw className={cn("w-3 h-3", syncVoices.isPending && "animate-spin")} />
                      Sincronizar
                    </button>
                    <button
                      onClick={() => setExpandedProvider(isExpanded ? null : p.id)}
                      className="p-1.5 rounded-lg transition-all hover:opacity-70"
                      style={{ color: "var(--text-3)" }}>
                      {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={async () => { if (await showConfirm(`Remover "${p.name}"?`, { title: "Remover provider", confirmLabel: "Remover" })) deleteProvider.mutate(p.id); }}
                      className="p-1.5 rounded-lg transition-all hover:opacity-70"
                      style={{ color: "#ef4444" }}
                      title="Remover provider">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Voices list */}
                {isExpanded && (
                  <div className="border-t" style={{ borderColor: meta.border }}>
                    {voices.length === 0 ? (
                      <div className="py-6 text-center">
                        <p className="text-xs" style={{ color: "var(--text-3)" }}>
                          Nenhuma voz sincronizada. Clique em "Sincronizar" para buscar vozes do provider.
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 divide-y sm:divide-y-0"
                        style={{ borderColor: meta.border }}>
                        {voices.map((v) => (
                          <div key={v.id} className="flex items-center gap-2 px-4 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>{v.name}</p>
                              <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
                                {[v.language, v.gender, v.category].filter(Boolean).join(" · ")}
                              </p>
                            </div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {/* Test button */}
                              <button
                                onClick={() => handleTestVoice(v)}
                                disabled={testingVoice === v.id}
                                className="p-1 rounded-md transition-all hover:opacity-70"
                                style={{ color: meta.color }}
                                title="Ouvir preview">
                                {testingVoice === v.id
                                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  : <Play className="w-3.5 h-3.5" />}
                              </button>
                              {/* Toggle */}
                              <button
                                onClick={() => toggleVoice.mutate({ id: v.id, is_active: !v.is_active })}
                                className="p-1 rounded-md transition-all hover:opacity-70"
                                style={{ color: v.is_active ? meta.color : "var(--text-3)" }}
                                title={v.is_active ? "Desativar" : "Ativar"}>
                                {v.is_active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add provider modal */}
      {showAdd && <AddProviderModal onClose={() => setShowAdd(false)} workspaceId={workspaceId} />}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 rounded-2xl"
      style={{ border: "1px dashed var(--surface-border)", background: "var(--surface-2)" }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
        <Volume2 className="w-6 h-6" style={{ color: "var(--text-3)" }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Nenhum provider de voz configurado</p>
        <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>Adicione ElevenLabs, Qwen TTS ou OpenAI TTS para habilitar respostas em áudio nos agentes.</p>
      </div>
      <button onClick={onAdd}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all hover:opacity-90"
        style={{ background: "var(--green)", color: "#000" }}>
        <Plus className="w-4 h-4" />
        Adicionar provider
      </button>
    </div>
  );
}

// ─── Add Provider Modal ───────────────────────────────────────────────────────

function AddProviderModal({ onClose, workspaceId }: { onClose: () => void; workspaceId: string }) {
  const qc = useQueryClient();
  const [provider, setProvider] = useState<ProviderType>("elevenlabs");
  const [name, setName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);

  const API_KEY_LINKS: Record<ProviderType, { href: string; label: string }> = {
    elevenlabs: { href: "https://elevenlabs.io/settings/api-keys", label: "elevenlabs.io/settings/api-keys" },
    qwen_tts: { href: "https://dashscope.console.aliyun.com/apiKey", label: "dashscope.console.aliyun.com/apiKey" },
    openai_tts: { href: "https://platform.openai.com/api-keys", label: "platform.openai.com/api-keys" },
  };

  const create = useMutation({
    mutationFn: () => voicesApi.createProvider(workspaceId, { provider, name: name || PROVIDER_META[provider].label, api_key: apiKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["voice-providers", workspaceId] });
      toast.success("Provider adicionado");
      onClose();
    },
    onError: (e: { response?: { data?: { error?: string } } }) => toast.error(e?.response?.data?.error ?? "Erro ao criar provider"),
  });

  const keyLink = API_KEY_LINKS[provider];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4"
      style={{ background: "var(--surface-overlay)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md rounded-2xl p-6 space-y-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Adicionar provider de voz</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:opacity-70" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Provider selector */}
        <div>
          <label className="text-xs font-medium block mb-2" style={{ color: "var(--text-2)" }}>Provider</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.entries(PROVIDER_META) as [ProviderType, typeof PROVIDER_META[ProviderType]][]).map(([id, meta]) => (
              <button key={id} onClick={() => setProvider(id)}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl border text-center transition-all"
                style={{
                  background: provider === id ? meta.bg : "var(--surface-2)",
                  borderColor: provider === id ? meta.color : "var(--surface-border)",
                }}>
                <Mic className="w-4 h-4" style={{ color: provider === id ? meta.color : "var(--text-3)" }} />
                <span className="text-[10px] font-medium" style={{ color: provider === id ? meta.color : "var(--text-2)" }}>
                  {meta.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="text-xs font-medium block mb-1.5" style={{ color: "var(--text-2)" }}>
            Nome (opcional)
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={PROVIDER_META[provider].label}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
          />
        </div>

        {/* API Key */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>API Key</label>
            <a href={keyLink.href} target="_blank" rel="noopener noreferrer"
              className="text-[10px] hover:underline" style={{ color: "var(--green)" }}>
              {keyLink.label} →
            </a>
          </div>
          <div className="relative">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-••••••••••••••••••••••"
              className="w-full px-3 py-2.5 pr-10 rounded-xl text-sm outline-none transition-all"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)", color: "var(--text-1)" }}
            />
            <button onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-70"
              style={{ color: "var(--text-3)" }}>
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <button
          onClick={() => create.mutate()}
          disabled={!apiKey.trim() || create.isPending}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all hover:opacity-90 disabled:opacity-40"
          style={{ background: "var(--green)", color: "#000" }}>
          {create.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Conectar
        </button>
      </div>
    </div>
  );
}
