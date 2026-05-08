"use client";

import { Users, Lock } from "lucide-react";
import { CollapsibleCard } from "../../../_shared/CollapsibleCard";

// Acesso da equipe — quem do workspace pode editar este agente. Hoje
// é gerenciado globalmente por permissões (isOwner / isSuperAdmin),
// sem campo por agente. Esta seção é placeholder pra controle
// granular por agente; precisa de mudança no model + endpoint do
// backend antes de virar funcional.
export function TeamAccessCard() {
  return (
    <CollapsibleCard
      title="Acesso da equipe"
      icon={Users}
      accentColor="#a78bfa"
      defaultOpen={false}
      meta={
        <span
          className="text-[10px] px-2 py-0.5 rounded-full"
          style={{
            background: "var(--surface-2)",
            color: "var(--text-4)",
            border: "1px solid var(--surface-border)",
          }}
        >
          em breve
        </span>
      }
    >
      <div className="pt-3 space-y-3">
        <div
          className="rounded-xl p-4 flex items-start gap-3"
          style={{
            background: "rgba(167,139,250,0.04)",
            border: "1px dashed rgba(167,139,250,0.20)",
          }}
        >
          <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#a78bfa" }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
              Hoje: dono e admins do workspace
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
              Quem pode editar este agente segue as permissões globais do workspace
              (<code>agents:view</code> / <code>agents:manage</code>). Configurar isso por agente
              específico — ex: "só o time de Vendas pode mexer no agente de Vendas" — vai chegar
              em breve.
            </p>
          </div>
        </div>

        <ul className="text-[11px] space-y-1.5" style={{ color: "var(--text-3)" }}>
          <li>· Gerenciar permissões: <b>/workspace</b> → aba "Equipe"</li>
          <li>· Ver papéis disponíveis: <b>/workspace</b> → aba "Papéis"</li>
        </ul>
      </div>
    </CollapsibleCard>
  );
}
