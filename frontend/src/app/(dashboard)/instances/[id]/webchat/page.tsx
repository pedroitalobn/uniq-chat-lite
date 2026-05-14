"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowLeft, Check, Code2, Copy, Loader2, MessageSquare, Save,
} from "lucide-react";
import { toast } from "sonner";
import { webChatApi, type WebChatConfig } from "@/lib/helpdesk-api";

// ─── Style helpers ─────────────────────────────────────────────────────────

const glassCard: CSSProperties = {
  background: "linear-gradient(135deg, var(--border-subtle) 0%, rgba(255,255,255,0.02) 100%)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid var(--border-default)",
  borderRadius: "20px",
};

const inp: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid var(--surface-border)",
  background: "var(--surface-3)",
  color: "var(--text-1)",
  padding: "10px 14px",
  fontSize: 14,
  outline: "none",
};

// ─── Toggle Switch ──────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0"
      style={{
        background: checked ? "#2563EB" : "var(--border-strong)",
        border: `1px solid ${checked ? "rgba(37, 99, 235,0.50)" : "var(--border-strong)"}`,
      }}
    >
      <span
        className="inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform"
        style={{ transform: checked ? "translateX(22px)" : "translateX(2px)" }}
      />
    </button>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function WebChatConfigPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const instanceId = params.id as string;

  const [form, setForm] = useState<Partial<WebChatConfig>>({
    display_name: "",
    greeting: "Olá! Como posso ajudar?",
    primary_color: "#2563EB",
    position: "bottom-right",
    avatar_url: "",
    whatsapp_redirect_number: "",
    help_desk_enabled: false,
  });
  const [copied, setCopied] = useState(false);
  const snippetRef = useRef<HTMLPreElement>(null);

  // Load existing config
  const configQuery = useQuery({
    queryKey: ["webchat-config", instanceId],
    queryFn: async () => (await webChatApi.getConfig(instanceId)).data,
    enabled: !!instanceId,
    retry: 1,
  });

  const snippetQuery = useQuery({
    queryKey: ["webchat-snippet", instanceId],
    queryFn: async () => (await webChatApi.getSnippet(instanceId)).data,
    enabled: !!instanceId,
    retry: 1,
  });

  useEffect(() => {
    if (configQuery.data) {
      setForm({
        display_name: configQuery.data.display_name ?? "",
        greeting: configQuery.data.greeting ?? "",
        primary_color: configQuery.data.primary_color ?? "#2563EB",
        position: configQuery.data.position ?? "bottom-right",
        avatar_url: configQuery.data.avatar_url ?? "",
        whatsapp_redirect_number: configQuery.data.whatsapp_redirect_number ?? "",
        help_desk_enabled: configQuery.data.help_desk_enabled ?? false,
      });
    }
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => webChatApi.upsertConfig(instanceId, form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["webchat-config", instanceId] });
      qc.invalidateQueries({ queryKey: ["webchat-snippet", instanceId] });
      toast.success("Configurações salvas.");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao salvar."),
  });

  const handleCopy = () => {
    const snippet = snippetQuery.data?.snippet ?? "";
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Código copiado!");
    });
  };

  const primaryColor = form.primary_color ?? "#2563EB";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push(`/instances/${instanceId}`)}
          className="inline-flex items-center gap-1.5 text-xs mb-3 px-2.5 py-1.5 rounded-lg transition-all"
          style={{ color: "var(--text-3)", background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}
        >
          <ArrowLeft className="w-3 h-3" />
          Instância
        </button>
        <h1 className="text-xl sm:text-2xl font-medium flex items-center gap-2.5" style={{ color: "var(--text-1)" }}>
          <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6" style={{ color: primaryColor }} />
          WebChat Widget
        </h1>
        <p className="text-xs sm:text-sm mt-1" style={{ color: "var(--text-3)" }}>
          Configure e incorpore o chat em qualquer site.
        </p>
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-5 items-start">
        {/* LEFT — Config form */}
        <div style={{ ...glassCard, padding: 24 }} className="space-y-5">
          <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Configurações do widget</h2>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Nome de exibição</label>
            <input
              value={form.display_name ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, display_name: e.target.value }))}
              placeholder="Ex: Suporte Qchat"
              style={inp}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Mensagem de boas-vindas</label>
            <textarea
              value={form.greeting ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, greeting: e.target.value }))}
              placeholder="Olá! Como posso ajudar hoje?"
              style={{ ...inp, minHeight: 80, resize: "vertical" }}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Cor principal</label>
              <div className="flex gap-2 items-center">
                <input
                  type="color"
                  value={form.primary_color ?? "#2563EB"}
                  onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))}
                  className="h-10 w-12 rounded-lg cursor-pointer border-0 bg-transparent"
                />
                <input
                  value={form.primary_color ?? "#2563EB"}
                  onChange={(e) => setForm((p) => ({ ...p, primary_color: e.target.value }))}
                  placeholder="#2563EB"
                  style={{ ...inp, fontFamily: "monospace", fontSize: 13 }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>Posição</label>
              <select
                value={form.position ?? "bottom-right"}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    position: e.target.value as "bottom-right" | "bottom-left",
                  }))
                }
                style={inp}
              >
                <option value="bottom-right">Direita</option>
                <option value="bottom-left">Esquerda</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>URL do avatar (opcional)</label>
            <input
              value={form.avatar_url ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, avatar_url: e.target.value }))}
              placeholder="https://..."
              style={inp}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--text-2)" }}>
              🇧🇷 Número WhatsApp (redirecionamento)
            </label>
            <input
              value={form.whatsapp_redirect_number ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, whatsapp_redirect_number: e.target.value }))}
              placeholder="+55 11 99999-9999"
              style={inp}
            />
            <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
              Exibe botão para continuar no WhatsApp quando preenchido.
            </p>
          </div>

          <div className="flex items-center justify-between py-3 px-4 rounded-2xl" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Help Desk integrado</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-3)" }}>Exibe artigos de ajuda no widget</p>
            </div>
            <Toggle
              checked={form.help_desk_enabled ?? false}
              onChange={(v) => setForm((p) => ({ ...p, help_desk_enabled: v }))}
            />
          </div>

          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-all"
            style={{
              background: "linear-gradient(135deg, rgba(37, 99, 235,0.20), rgba(37, 99, 235,0.08))",
              color: "#2563EB",
              border: "1px solid rgba(37, 99, 235,0.30)",
              boxShadow: "0 4px 16px rgba(37, 99, 235,0.12)",
              opacity: saveMutation.isPending ? 0.7 : 1,
            }}
          >
            {saveMutation.isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Salvando...</>
            ) : (
              <><Save className="w-4 h-4" /> Salvar configurações</>
            )}
          </button>
        </div>

        {/* RIGHT — Embed + preview */}
        <div className="space-y-4">
          {/* Embed code */}
          <div style={{ ...glassCard, padding: 20 }} className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: "var(--text-1)" }}>
                <Code2 className="w-4 h-4" style={{ color: "var(--text-3)" }} />
                Código de incorporação
              </h2>
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
                style={{
                  background: copied ? "rgba(37, 99, 235,0.12)" : "var(--surface-3)",
                  color: copied ? "#2563EB" : "var(--text-2)",
                  border: `1px solid ${copied ? "rgba(37, 99, 235,0.25)" : "var(--surface-border)"}`,
                }}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copiado!" : "Copiar"}
              </button>
            </div>

            {snippetQuery.isLoading ? (
              <div className="h-24 rounded-xl animate-pulse" style={{ background: "var(--surface-3)" }} />
            ) : (
              <pre
                ref={snippetRef}
                className="text-xs overflow-x-auto p-4 rounded-xl leading-relaxed"
                style={{
                  background: "rgba(0,0,0,0.35)",
                  color: "#a78bfa",
                  border: "1px solid var(--border-subtle)",
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {snippetQuery.data?.snippet ?? "<!-- Salve as configurações para gerar o snippet -->"}
              </pre>
            )}

            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
              Cole este código antes do <code>&lt;/body&gt;</code> do seu site.
            </p>
          </div>

          {/* Preview */}
          <div style={{ ...glassCard, padding: 20 }} className="space-y-4">
            <h2 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Prévia</h2>

            <div
              className="relative rounded-2xl overflow-hidden flex items-end justify-end"
              style={{ background: "rgba(0,0,0,0.25)", minHeight: 200, padding: 20 }}
            >
              {/* Decorative dots */}
              <div className="absolute inset-0 opacity-10" style={{
                backgroundImage: "radial-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1px)",
                backgroundSize: "24px 24px",
              }} />

              {/* Mock floating button */}
              <div className="relative flex flex-col items-end gap-3">
                {/* Greeting bubble */}
                <motion.div
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: 0.3 }}
                  className="px-4 py-2.5 rounded-2xl rounded-br-sm text-sm max-w-[200px] text-right"
                  style={{
                    background: "white",
                    color: "#111",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.25)",
                    fontSize: 13,
                  }}
                >
                  {form.greeting || "Olá! Como posso ajudar?"}
                </motion.div>

                {/* Floating button */}
                <motion.button
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.96 }}
                  className="w-14 h-14 rounded-full flex items-center justify-center shadow-lg"
                  style={{
                    background: primaryColor,
                    boxShadow: `0 6px 24px ${primaryColor}60`,
                  }}
                >
                  {form.avatar_url ? (
                    <img
                      src={form.avatar_url}
                      alt="avatar"
                      className="w-8 h-8 rounded-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                  ) : (
                    <MessageSquare className="w-6 h-6 text-white" />
                  )}
                </motion.button>
              </div>
            </div>

            <p className="text-[11px] text-center" style={{ color: "var(--text-3)" }}>
              Prévia do botão — posição: {form.position === "bottom-right" ? "inferior direita" : "inferior esquerda"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
