"use client";

import { Plug } from "lucide-react";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";
import type { AgentForm } from "../../../_shared/types";

type Props = {
  form: AgentForm;
  update: (updater: (prev: AgentForm) => AgentForm) => void;
};

// Integrações avançadas — webhook custom + MCP server URL. Power-user
// only, fica colapsado por padrão pra não poluir o Settings.
export function AdvancedCard({ form, update }: Props) {
  const hasAny = !!form.webhook_url || !!form.mcp_server_url;
  return (
    <CollapsibleCard
      title="Integrações avançadas"
      icon={Plug}
      accentColor="#9ca3af"
      defaultOpen={false}
      meta={
        hasAny && (
          <span
            className="text-[10px] px-2 py-0.5 rounded-full"
            style={{
              background: "rgba(156,163,175,0.10)",
              color: "var(--text-3)",
              border: "1px solid rgba(156,163,175,0.20)",
            }}
          >
            configurado
          </span>
        )
      }
    >
      <div className="pt-3 space-y-3">
        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
            Webhook custom (saída)
          </label>
          <input
            type="text"
            value={form.webhook_url}
            onChange={(e) => update((p) => ({ ...p, webhook_url: e.target.value }))}
            placeholder="https://api.exemplo.com/uniq-events"
            style={inputStyle}
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
            URL pra onde o agente posta eventos das conversas. Use o secret abaixo pra HMAC.
          </p>
        </div>

        {form.webhook_url && (
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
              Webhook secret (HMAC-SHA256)
            </label>
            <input
              type="text"
              value={form.webhook_secret}
              onChange={(e) => update((p) => ({ ...p, webhook_secret: e.target.value }))}
              placeholder="32+ caracteres aleatórios"
              style={inputStyle}
            />
          </div>
        )}

        <div>
          <label className="block text-[11px] font-medium mb-1" style={{ color: "var(--text-2)" }}>
            MCP Server URL
          </label>
          <input
            type="text"
            value={form.mcp_server_url}
            onChange={(e) => update((p) => ({ ...p, mcp_server_url: e.target.value }))}
            placeholder="https://mcp.exemplo.com"
            style={inputStyle}
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-4)" }}>
            Servidor MCP custom que adiciona tools ao agente. Quando vazio, usa só as ações nativas.
          </p>
        </div>
      </div>
    </CollapsibleCard>
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
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
};
