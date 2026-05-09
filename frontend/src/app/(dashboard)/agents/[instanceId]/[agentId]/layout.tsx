"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Settings, Sparkles, Loader2, Save, Power, MessageSquareDashed } from "lucide-react";
import { AgentFormProvider, useAgentFormContext } from "../../_shared/AgentFormContext";
import { ChatPreviewPanel } from "./_components/ChatPreviewPanel";

// Layout do escopo "agente" — engloba Studio (/) e Settings (/settings).
// O AgentFormProvider compartilha o form entre as 2 páginas: Save e o
// toggle de ativação ficam aqui no header e atuam sobre a edição em
// curso, independente da subpágina.
export default function AgentEditorLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ instanceId: string; agentId: string }>();
  return (
    <AgentFormProvider instanceId={params.instanceId} agentId={params.agentId}>
      <Inner>{children}</Inner>
    </AgentFormProvider>
  );
}

function Inner({ children }: { children: React.ReactNode }) {
  const params = useParams<{ instanceId: string; agentId: string }>();
  const pathname = usePathname();
  const { form, isLoading, dirty, save, isSaving, toggleActive, isToggling } =
    useAgentFormContext();
  const isPrimary = params.agentId === "primary";
  const isSettings = pathname.endsWith("/settings");
  const agentName = form.agent_name || (isPrimary ? "Agente primário" : "Agente");
  const active = !!form.is_active;
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <div className="flex flex-col h-full">
      {/* Header do agente — nome · tabs · save · toggle */}
      <div
        className="flex items-center gap-3 px-4 sm:px-6 py-3 flex-shrink-0 flex-wrap"
        style={{ borderBottom: "1px solid var(--surface-border)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--text-3)" }} />
          ) : (
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{
                background: "linear-gradient(135deg, rgba(124,58,237,0.30), rgba(99,102,241,0.20))",
                color: "#a5b4fc",
                border: "1px solid rgba(124,58,237,0.40)",
              }}
            >
              {agentName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="text-sm font-semibold truncate" style={{ color: "var(--text-1)" }}>
            {agentName}
          </span>
          {isPrimary && (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.10)", color: "#fbbf24" }}
            >
              primário
            </span>
          )}
          {dirty && (
            <span
              className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}
              title="Mudanças não salvas"
            >
              não salvo
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5 flex-wrap">
          <TabLink
            href={`/agents/${params.instanceId}/${params.agentId}`}
            active={!isSettings}
            icon={Sparkles}
            label="Studio"
          />
          <TabLink
            href={`/agents/${params.instanceId}/${params.agentId}/settings`}
            active={isSettings}
            icon={Settings}
            label="Settings"
          />

          <span className="hidden sm:block w-px h-5 mx-1" style={{ background: "var(--surface-border)" }} />

          {/* Botão Testar — abre o painel de preview ao vivo. Em
             mobile vira só ícone pra economizar espaço. */}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors"
            style={{
              background: previewOpen ? "rgba(0,212,106,0.12)" : "var(--surface-2)",
              border: `1px solid ${previewOpen ? "rgba(0,212,106,0.30)" : "var(--surface-border)"}`,
              color: previewOpen ? "var(--green)" : "var(--text-2)",
            }}
            title="Testar agente (preview ao vivo, sem persistir)"
            aria-label="Testar agente"
          >
            <MessageSquareDashed className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
            <span className="hidden sm:inline">Testar</span>
          </button>

          {/* Toggle de ativação — em mobile mostra só ícone + estado em chip */}
          <button
            type="button"
            onClick={() => toggleActive(!active)}
            disabled={isToggling}
            title={active ? "Desativar agente" : "Ativar agente"}
            aria-label={active ? "Desativar agente" : "Ativar agente"}
            className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            style={
              active
                ? {
                    background: "rgba(0,212,106,0.12)",
                    border: "1px solid rgba(0,212,106,0.30)",
                    color: "var(--green)",
                  }
                : {
                    background: "var(--surface-2)",
                    border: "1px solid var(--surface-border)",
                    color: "var(--text-3)",
                  }
            }
          >
            <Power className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
            <span className="hidden sm:inline">{active ? "Ativo" : "Inativo"}</span>
          </button>

          {/* Save — sempre com label porque é a ação primária */}
          <button
            type="button"
            onClick={() => save()}
            disabled={!dirty || isSaving}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-1.5 rounded-lg transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 sm:w-3 sm:h-3 animate-spin" /> : <Save className="w-3.5 h-3.5 sm:w-3 sm:h-3" />}
            Salvar
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">{children}</div>

      {/* Slide-over de preview — vive no layout pra Studio E Settings
         poderem abrir, e o estado da conversa não some ao trocar de
         tab (componente fica montado, painel só esconde via translate). */}
      <ChatPreviewPanel
        instanceId={params.instanceId}
        agentId={params.agentId}
        agentName={agentName}
        open={previewOpen}
        dirty={dirty}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
}

function TabLink({
  href,
  active,
  icon: Icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: typeof Sparkles;
  label: string;
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-label={label}
      className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-2.5 py-1.5 rounded-lg transition-colors"
      style={
        active
          ? {
              background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(99,102,241,0.35)",
              color: "#a5b4fc",
            }
          : {
              background: "var(--surface-2)",
              border: "1px solid var(--surface-border)",
              color: "var(--text-2)",
            }
      }
    >
      <Icon className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
}
