"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiKeysApi } from "@/lib/api";
import { Key, Plus, Trash2, Copy, Check, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { showConfirm } from "@/lib/confirm";
import type { APIKey } from "@/types";

interface CreatedKey {
  key: string;
  name: string;
}

export default function ApiKeysPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const { data: keys = [], isLoading } = useQuery<APIKey[]>({
    queryKey: ["api-keys"],
    queryFn: () => apiKeysApi.list().then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => apiKeysApi.create(name.trim()),
    onSuccess: (res) => {
      setCreatedKey({ key: res.data.key, name: res.data.name });
      setName("");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar chave";
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiKeysApi.delete(id),
    onSuccess: () => {
      toast.success("Chave removida");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: () => toast.error("Erro ao remover chave"),
  });

  const copyKey = () => {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const cardStyle = {
    background: "hsl(240 18% 6%)",
    border: "1px solid hsl(240 12% 13%)",
  };

  return (
    <div className="space-y-7">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
          API Keys
        </h1>
        <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
          Gerencie chaves de API para integrar o Uniq.chat com seus sistemas.
        </p>
      </div>

      {/* Create key */}
      <div className="rounded-2xl p-5 space-y-4 animate-fade-in-up" style={cardStyle}>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.15)" }}
          >
            <Key className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
          </div>
          <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>Criar nova chave</h2>
        </div>

        <div className="flex gap-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && createMutation.mutate()}
            placeholder="Nome da chave (ex: Produção, n8n)"
            className="input-field flex-1"
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!name.trim() || createMutation.isPending}
            className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {createMutation.isPending
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Plus className="w-4 h-4" />
            }
            Criar
          </button>
        </div>

        {createdKey && (
          <div
            className="rounded-xl p-4 space-y-3 animate-fade-in-up"
            style={{ background: "rgba(0,212,106,0.05)", border: "1px solid rgba(0,212,106,0.15)" }}
          >
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 flex-shrink-0" style={{ color: "var(--green)" }} />
              <p className="text-sm font-medium" style={{ color: "#86efac" }}>
                Chave <strong>{createdKey.name}</strong> criada! Copie agora — não será exibida novamente.
              </p>
            </div>
            <div
              className="flex items-center gap-2 rounded-xl px-3 py-2.5"
              style={{ background: "hsl(240 18% 4%)", border: "1px solid hsl(240 12% 11%)" }}
            >
              <code className="flex-1 text-sm font-mono truncate" style={{ color: "hsl(240 15% 80%)" }}>
                {showKey ? createdKey.key : createdKey.key.replace(/(?<=^.{12}).+(?=.{4}$)/, "•".repeat(24))}
              </code>
              <button
                onClick={() => setShowKey(!showKey)}
                className="transition-colors flex-shrink-0"
                style={{ color: "hsl(240 8% 38%)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
                onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
              <button
                onClick={copyKey}
                className="transition-colors flex-shrink-0"
                style={{ color: "hsl(240 8% 38%)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
                onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}
              >
                {copied ? <Check className="w-4 h-4" style={{ color: "var(--green)" }} /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <button
              onClick={() => setCreatedKey(null)}
              className="text-xs transition-colors"
              style={{ color: "hsl(240 8% 38%)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 52%)")}
              onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}
            >
              Já copiei, fechar
            </button>
          </div>
        )}
      </div>

      {/* Keys list */}
      <div className="rounded-2xl overflow-hidden animate-fade-in-up" style={cardStyle}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid hsl(240 12% 11%)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
            {keys.length} chave{keys.length !== 1 ? "s" : ""} ativa{keys.length !== 1 ? "s" : ""}
          </h2>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-2">
            {[1, 2].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}
          </div>
        ) : keys.length === 0 ? (
          <div className="p-12 text-center">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}
            >
              <Key className="w-5 h-5" style={{ color: "hsl(240 8% 28%)" }} />
            </div>
            <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Nenhuma chave criada</p>
          </div>
        ) : (
          <div>
            {keys.map((k, i) => (
              <div
                key={k.id}
                className="px-5 py-4 flex items-center gap-4 transition-colors"
                style={{
                  borderBottom: i < keys.length - 1 ? "1px solid var(--border-default)" : undefined,
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}
                >
                  <Key className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 42%)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: "hsl(240 15% 80%)" }}>{k.name}</p>
                  <p className="text-xs font-mono mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>{k.masked_key}</p>
                </div>
                <div className="text-right flex-shrink-0 hidden sm:block">
                  {k.last_used_at ? (
                    <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>
                      Usado {new Date(k.last_used_at).toLocaleDateString("pt-BR")}
                    </p>
                  ) : (
                    <p className="text-xs" style={{ color: "hsl(240 8% 30%)" }}>Nunca usada</p>
                  )}
                  <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 30%)" }}>
                    Criada {new Date(k.created_at).toLocaleDateString("pt-BR")}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    if (!await showConfirm(`Remover a chave "${k.name}"? Integrações que usam essa chave pararão de funcionar.`, { title: "Remover API key", confirmLabel: "Remover" })) return;
                    deleteMutation.mutate(k.id);
                  }}
                  className="p-2 rounded-lg transition-colors flex-shrink-0"
                  style={{ color: "hsl(240 8% 32%)" }}
                  onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Usage docs */}
      <div className="rounded-2xl p-5 space-y-4 animate-fade-in-up" style={{ ...cardStyle, animationDelay: "100ms", animationFillMode: "both" }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
          Como usar
        </h2>
        <div className="space-y-4">
          <div>
            <p className="text-xs mb-2" style={{ color: "hsl(240 8% 42%)" }}>Header de autenticação</p>
            <div
              className="rounded-xl px-4 py-3"
              style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}
            >
              <code className="text-xs font-mono" style={{ color: "var(--green)" }}>
                Authorization: Bearer sc_...
              </code>
            </div>
          </div>
          <div>
            <p className="text-xs mb-2" style={{ color: "hsl(240 8% 42%)" }}>Exemplo com curl</p>
            <div
              className="rounded-xl px-4 py-3"
              style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}
            >
              <code className="text-xs font-mono whitespace-pre" style={{ color: "hsl(240 8% 62%)" }}>{`curl -X POST \\
  ${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"}/instances/:id/messages/text \\
  -H "Authorization: Bearer sc_..." \\
  -H "Content-Type: application/json" \\
  -d '{"to":"5511999999999","text":"Olá!"}'`}</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
