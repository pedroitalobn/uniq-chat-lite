"use client";

// Error boundary do segmento dashboard. Captura erros de páginas individuais
// (inbox, crm, instances, etc) sem derrubar o layout (sidebar, presence WS).
// Auto-reload em chunk errors (deploy stale).

import { useEffect } from "react";
import { RefreshCw, ArrowLeft } from "lucide-react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    const isChunkError =
      error.name === "ChunkLoadError" ||
      /Loading chunk \d+ failed/i.test(error.message) ||
      /Failed to fetch dynamically imported module/i.test(error.message) ||
      /Importing a module script failed/i.test(error.message);

    if (isChunkError) {
      const reloaded = sessionStorage.getItem("uniq:auto-reloaded");
      if (!reloaded) {
        sessionStorage.setItem("uniq:auto-reloaded", "1");
        window.location.reload();
        return;
      }
    } else {
      sessionStorage.removeItem("uniq:auto-reloaded");
    }
    // Log silencioso pra debug futuro
    console.error("[dashboard-error]", error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="text-center max-w-md">
        <h1 className="text-base font-medium mb-1" style={{ color: "var(--text-1)" }}>
          Não foi possível carregar essa página
        </h1>
        <p className="text-xs mb-4" style={{ color: "var(--text-3)" }}>
          {error.message || "Erro inesperado. Tente novamente em alguns segundos."}
        </p>
        <div className="flex gap-2 justify-center">
          <button
            onClick={reset}
            className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Tentar novamente
          </button>
          <button
            onClick={() => window.history.back()}
            className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
            style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Voltar
          </button>
        </div>
        {error.digest && (
          <p className="text-[10px] mt-3 font-mono" style={{ color: "var(--text-3)" }}>
            ref: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
