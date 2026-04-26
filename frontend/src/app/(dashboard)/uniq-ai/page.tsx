"use client";

// Uniq AI — tela inicial estilo Claude/GPT. Chat ao centro que interage
// com TODOS os módulos da plataforma via linguagem natural.
// Hoje: cria/edita/lista jornadas, mostra instâncias.
// Em breve (v2): cria campanhas, dispara mensagens em /inbox, cria deals
// no /crm — tudo via intent router que generaliza o pending_journey atual.

import { UniqAIChatPanel } from "@/features/uniq-ai/chat-panel";

export default function UniqAIPage() {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0 rounded-2xl overflow-hidden border" style={{ borderColor: "var(--surface-border)" }}>
        <UniqAIChatPanel />
      </div>
    </div>
  );
}
