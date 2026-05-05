"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { platformAIApi, PlatformAIConfig } from "@/lib/api";
import {
  Bot,
  ChevronDown,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Save,
  Sparkles,
  TestTube2,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

// ─── Dark theme tokens (inline — avoids Tailwind CSS var conflicts) ──────────
const T = {
  bg:       "hsl(240 18% 6%)",
  card:     "hsl(240 14% 10%)",
  card2:    "hsl(240 12% 13%)",
  border:   "rgba(255,255,255,0.07)",
  text1:    "rgba(255,255,255,0.92)",
  text2:    "rgba(255,255,255,0.55)",
  text3:    "rgba(255,255,255,0.30)",
  violet:   "#8b5cf6",
  green:    "#00d46a",
  red:      "#f87171",
  input:    "hsl(240 12% 15%)",
} as const;

const PROVIDERS = [
  { value: "openai",     label: "OpenAI",            models: "gpt-4o,gpt-4o-mini,gpt-4-turbo,gpt-3.5-turbo" },
  { value: "anthropic",  label: "Anthropic (Claude)", models: "claude-opus-4-7,claude-sonnet-4-6,claude-haiku-4-5-20251001" },
  { value: "deepseek",   label: "DeepSeek",           models: "deepseek-chat,deepseek-reasoner" },
  { value: "groq",       label: "Groq",               models: "llama-3.3-70b-versatile,mixtral-8x7b-32768" },
  { value: "openrouter", label: "OpenRouter",         models: "" },
  { value: "google",     label: "Google Gemini",      models: "gemini-2.0-flash,gemini-1.5-pro" },
  { value: "mistral",    label: "Mistral",            models: "mistral-large-latest,mistral-small-latest" },
  { value: "cohere",     label: "Cohere",             models: "command-r-plus,command-r" },
  { value: "custom",     label: "Custom / Self-hosted", models: "" },
];

type FormState = {
  id?: string;
  provider: string;
  name: string;
  api_key: string;
  base_url: string;
  models: string;
  is_active: boolean;
};

function emptyForm(): FormState {
  return { provider: "openai", name: "Uniq AI", api_key: "", base_url: "", models: PROVIDERS[0].models, is_active: true };
}

function fromConfig(c: PlatformAIConfig): FormState {
  return {
    id: c.id,
    provider: c.provider || "openai",
    name: c.name || "Uniq AI",
    api_key: "",
    base_url: c.base_url || "",
    models: c.models || "",
    is_active: c.is_active ?? true,
  };
}

// ─── Status badges ────────────────────────────────────────────────────────────

function TestBadge({ status }: { status?: string }) {
  if (!status) return null;
  const ok = status === "ok";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "1px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600,
      background: ok ? "rgba(0,212,106,0.12)" : "rgba(248,113,113,0.12)",
      color: ok ? T.green : T.red,
      border: `1px solid ${ok ? "rgba(0,212,106,0.25)" : "rgba(248,113,113,0.25)"}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: ok ? T.green : T.red, display: "inline-block" }} />
      {ok ? "Conectado" : "Falhou"}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "1px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600,
      background: active ? "rgba(0,212,106,0.08)" : "rgba(255,255,255,0.05)",
      color: active ? T.green : T.text2,
      border: `1px solid ${active ? "rgba(0,212,106,0.20)" : T.border}`,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: active ? T.green : T.text3, display: "inline-block" }} />
      {active ? "Ativo" : "Inativo"}
    </span>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

function Input({ label, value, onChange, type = "text", placeholder, hint, suffix }: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; hint?: string; suffix?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.text2 }}>{label}</label>
      <div style={{ position: "relative" }}>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: suffix ? "8px 40px 8px 12px" : "8px 12px",
            borderRadius: 8, border: `1px solid ${T.border}`,
            background: T.input, color: T.text1, fontSize: 13,
            outline: "none",
          }}
          onFocus={(e) => (e.target.style.borderColor = T.violet + "88")}
          onBlur={(e) => (e.target.style.borderColor = T.border)}
        />
        {suffix && (
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)" }}>
            {suffix}
          </span>
        )}
      </div>
      {hint && <p style={{ fontSize: 11, color: T.text3 }}>{hint}</p>}
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: T.text2 }}>{label}</label>
      <div style={{ position: "relative" }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: "100%", appearance: "none",
            padding: "8px 36px 8px 12px",
            borderRadius: 8, border: `1px solid ${T.border}`,
            background: T.input, color: T.text1, fontSize: 13,
            outline: "none", cursor: "pointer",
          }}
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: T.text3, pointerEvents: "none" }} />
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 500, color: T.text1 }}>{label}</p>
        {hint && <p style={{ fontSize: 11, color: T.text3 }}>{hint}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        style={{
          position: "relative", display: "inline-flex", flexShrink: 0,
          width: 36, height: 20, borderRadius: 99,
          border: "none", cursor: "pointer",
          background: checked ? T.violet : "rgba(255,255,255,0.12)",
          transition: "background 0.2s",
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: checked ? 18 : 2,
          width: 16, height: 16, borderRadius: "50%",
          background: "white", transition: "left 0.2s",
        }} />
      </button>
    </div>
  );
}

// ─── Edit modal/panel ─────────────────────────────────────────────────────────

function EditPanel({
  form, onChange, isNew, onSave, onTest, onClose,
  saving, testing, existingConfig,
}: {
  form: FormState;
  onChange: (f: FormState) => void;
  isNew: boolean;
  onSave: () => void;
  onTest: () => void;
  onClose: () => void;
  saving: boolean;
  testing: boolean;
  existingConfig?: PlatformAIConfig;
}) {
  const [showKey, setShowKey] = useState(false);
  const selectedProvider = PROVIDERS.find((p) => p.value === form.provider);

  function handleProviderChange(v: string) {
    const p = PROVIDERS.find((pr) => pr.value === v);
    onChange({ ...form, provider: v, models: p?.models || form.models, base_url: v === "custom" ? form.base_url : "" });
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
    }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background: T.card, border: `1px solid ${T.border}`,
        borderRadius: 16, padding: 28, width: 480, maxWidth: "calc(100vw - 32px)",
        maxHeight: "calc(100vh - 48px)", overflowY: "auto",
        boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <div style={{ padding: 8, borderRadius: 10, background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)" }}>
            <Sparkles style={{ width: 16, height: 16, color: T.violet }} />
          </div>
          <p style={{ fontSize: 15, fontWeight: 600, color: T.text1 }}>
            {isNew ? "Nova config Uniq AI" : `Editar: ${existingConfig?.name || "Uniq AI"}`}
          </p>
          <button onClick={onClose} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.text3, padding: 4 }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Input
            label="Nome exibido"
            value={form.name}
            onChange={(v) => onChange({ ...form, name: v })}
            placeholder="Uniq AI"
          />

          <Select
            label="Provider LLM"
            value={form.provider}
            onChange={handleProviderChange}
            options={PROVIDERS.map((p) => ({ value: p.value, label: p.label }))}
          />

          <Input
            label="API Key"
            value={form.api_key}
            onChange={(v) => onChange({ ...form, api_key: v })}
            type={showKey ? "text" : "password"}
            placeholder={existingConfig?.has_api_key ? "••••••••• (chave salva)" : "Insira a API key"}
            hint={existingConfig?.has_api_key && !form.api_key ? "Deixe em branco para manter a chave atual" : undefined}
            suffix={
              <button type="button" onClick={() => setShowKey((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", color: T.text3, padding: 0, display: "flex" }}>
                {showKey ? <EyeOff style={{ width: 14, height: 14 }} /> : <Eye style={{ width: 14, height: 14 }} />}
              </button>
            }
          />

          {(form.provider === "custom" || form.provider === "openrouter" || !!form.base_url) && (
            <Input
              label="Base URL (opcional)"
              value={form.base_url}
              onChange={(v) => onChange({ ...form, base_url: v })}
              type="url"
              placeholder="https://api.seu-provider.com/v1"
            />
          )}

          <Input
            label="Modelos disponíveis (separados por vírgula)"
            value={form.models}
            onChange={(v) => onChange({ ...form, models: v })}
            placeholder={selectedProvider?.models || "modelo-1,modelo-2"}
            hint={selectedProvider?.models ? `Padrão: ${selectedProvider.models}` : undefined}
          />

          <div style={{ height: 1, background: T.border }} />

          <Toggle
            checked={form.is_active}
            onChange={(v) => onChange({ ...form, is_active: v })}
            label="Ativo"
            hint="Desativar oculta esta config para todos os usuários"
          />
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
          {!isNew && (
            <button
              type="button"
              onClick={onTest}
              disabled={testing || saving}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 14px", borderRadius: 8,
                border: `1px solid ${T.border}`, background: "transparent",
                color: T.text1, fontSize: 13, fontWeight: 500, cursor: "pointer",
                opacity: testing || saving ? 0.5 : 1,
              }}
            >
              {testing ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> : <TestTube2 style={{ width: 14, height: 14 }} />}
              Testar
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving || testing}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 16px", borderRadius: 8,
              border: "none", background: T.violet,
              color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer",
              opacity: saving || testing ? 0.5 : 1, marginLeft: "auto",
            }}
          >
            {saving ? <Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} /> : <Save style={{ width: 14, height: 14 }} />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlatformAIPage() {
  const qc = useQueryClient();
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [isNew, setIsNew] = useState(false);

  const { data: configs = [], isLoading } = useQuery<PlatformAIConfig[]>({
    queryKey: ["admin", "platform-ai"],
    queryFn: async () => {
      const res = await platformAIApi.list();
      return res.data;
    },
  });

  const createMut = useMutation({
    mutationFn: (f: FormState) =>
      platformAIApi.create({
        provider: f.provider, name: f.name,
        base_url: f.base_url || undefined, models: f.models || undefined,
        is_active: f.is_active, ...(f.api_key ? { api_key: f.api_key } : {}),
      }),
    onSuccess: () => {
      toast.success("Config criada");
      qc.invalidateQueries({ queryKey: ["admin", "platform-ai"] });
      setEditForm(null);
    },
    onError: () => toast.error("Erro ao criar config"),
  });

  const updateMut = useMutation({
    mutationFn: (f: FormState) =>
      platformAIApi.update(f.id!, {
        provider: f.provider, name: f.name,
        base_url: f.base_url || undefined, models: f.models || undefined,
        is_active: f.is_active, ...(f.api_key ? { api_key: f.api_key } : {}),
      }),
    onSuccess: () => {
      toast.success("Config salva");
      qc.invalidateQueries({ queryKey: ["admin", "platform-ai"] });
      setEditForm(null);
    },
    onError: () => toast.error("Erro ao salvar"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => platformAIApi.delete(id),
    onSuccess: () => {
      toast.success("Config removida");
      qc.invalidateQueries({ queryKey: ["admin", "platform-ai"] });
    },
    onError: () => toast.error("Erro ao remover"),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => platformAIApi.test(id),
    onSuccess: (res) => {
      if (res.data.ok) toast.success("Conexão OK");
      else toast.error(res.data.message || "Conexão falhou");
      qc.invalidateQueries({ queryKey: ["admin", "platform-ai"] });
    },
    onError: () => toast.error("Erro ao testar"),
  });

  function openNew() { setIsNew(true); setEditForm(emptyForm()); }
  function openEdit(c: PlatformAIConfig) { setIsNew(false); setEditForm(fromConfig(c)); }
  function closeEdit() { setEditForm(null); }

  function handleSave() {
    if (!editForm) return;
    if (isNew) createMut.mutate(editForm);
    else updateMut.mutate(editForm);
  }

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div style={{ padding: 10, borderRadius: 12, background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)" }}>
          <Sparkles style={{ width: 18, height: 18, color: T.violet }} />
        </div>
        <div>
          <h1 style={{ fontSize: 17, fontWeight: 700, color: T.text1, margin: 0 }}>Uniq AI</h1>
          <p style={{ fontSize: 12, color: T.text2, margin: 0 }}>
            Provedores de IA globais — disponíveis para todos os usuários da plataforma
          </p>
        </div>
        <button
          onClick={openNew}
          style={{
            marginLeft: "auto", display: "flex", alignItems: "center", gap: 6,
            padding: "8px 14px", borderRadius: 8,
            background: T.violet, border: "none",
            color: "white", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}
        >
          <Plus style={{ width: 14, height: 14 }} />
          Nova config
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
          <Loader2 style={{ width: 20, height: 20, color: T.text3, animation: "spin 1s linear infinite" }} />
        </div>
      ) : configs.length === 0 ? (
        <div style={{
          borderRadius: 12, border: `1px dashed ${T.border}`,
          padding: 48, textAlign: "center",
        }}>
          <Bot style={{ width: 32, height: 32, color: T.text3, margin: "0 auto 12px" }} />
          <p style={{ fontSize: 14, color: T.text2, margin: 0 }}>Nenhuma config configurada</p>
          <p style={{ fontSize: 12, color: T.text3, margin: "4px 0 0" }}>
            Clique em &ldquo;Nova config&rdquo; para adicionar um provedor LLM global
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {configs.map((c) => (
            <div key={c.id} style={{
              borderRadius: 12, border: `1px solid ${T.border}`,
              background: T.card, padding: "16px 20px",
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: T.text1, margin: 0 }}>{c.name}</p>
                  <ActiveBadge active={c.is_active} />
                  <TestBadge status={c.test_status} />
                </div>
                <p style={{ fontSize: 12, color: T.text3, margin: "3px 0 0" }}>
                  {PROVIDERS.find((p) => p.value === c.provider)?.label || c.provider}
                  {c.has_api_key ? " · chave configurada" : " · sem chave"}
                  {c.models ? ` · ${c.models.split(",").length} modelo(s)` : ""}
                </p>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => c.id && testMut.mutate(c.id)}
                  disabled={testMut.isPending}
                  title="Testar conexão"
                  style={{
                    padding: "6px 10px", borderRadius: 7, border: `1px solid ${T.border}`,
                    background: "transparent", color: T.text2, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 4, fontSize: 12,
                    opacity: testMut.isPending ? 0.5 : 1,
                  }}
                >
                  {testMut.isPending && testMut.variables === c.id
                    ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />
                    : <TestTube2 style={{ width: 12, height: 12 }} />
                  }
                </button>
                <button
                  onClick={() => openEdit(c)}
                  style={{
                    padding: "6px 12px", borderRadius: 7, border: `1px solid ${T.border}`,
                    background: "transparent", color: T.text1, cursor: "pointer",
                    fontSize: 12, fontWeight: 500,
                  }}
                >
                  Editar
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Remover "${c.name}"?`)) c.id && deleteMut.mutate(c.id);
                  }}
                  disabled={deleteMut.isPending}
                  style={{
                    padding: "6px 8px", borderRadius: 7, border: `1px solid rgba(248,113,113,0.20)`,
                    background: "rgba(248,113,113,0.08)", color: T.red, cursor: "pointer",
                    display: "flex", alignItems: "center",
                    opacity: deleteMut.isPending ? 0.5 : 1,
                  }}
                >
                  <Trash2 style={{ width: 12, height: 12 }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Info box */}
      <div style={{
        marginTop: 24, borderRadius: 10,
        border: "1px solid rgba(99,102,241,0.20)", background: "rgba(99,102,241,0.06)",
        padding: "14px 16px", display: "flex", gap: 12,
      }}>
        <Bot style={{ width: 14, height: 14, color: "#818cf8", marginTop: 1, flexShrink: 0 }} />
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#818cf8", margin: "0 0 4px" }}>Como funciona</p>
          <p style={{ fontSize: 11, color: T.text3, margin: 0, lineHeight: 1.6 }}>
            Cada config ativa aparece como opção no ModelSelector dos usuários. Você pode ter múltiplas
            configs ativas (ex: OpenAI + Claude), e o usuário escolhe qual usar. Somente configs com
            API key configurada e status &ldquo;Ativo&rdquo; são exibidas.
          </p>
        </div>
      </div>

      {/* Edit modal */}
      {editForm && (
        <EditPanel
          form={editForm}
          onChange={setEditForm}
          isNew={isNew}
          onSave={handleSave}
          onTest={() => editForm.id && testMut.mutate(editForm.id)}
          onClose={closeEdit}
          saving={saving}
          testing={testMut.isPending}
          existingConfig={configs.find((c) => c.id === editForm.id)}
        />
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
