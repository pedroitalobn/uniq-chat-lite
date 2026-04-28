"use client";

// Error boundary global do app — captura erros que escapam dos layouts.
// O caso mais comum é "ChunkLoadError" / "Loading chunk failed" depois de
// deploy: o browser tem cache do RSC payload antigo apontando pra chunks
// que sumiram. Auto-reload resolve sem o user precisar clicar.

import { useEffect } from "react";

export default function GlobalError({
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
      // Hard reload pra puxar HTML/JS frescos
      const reloaded = sessionStorage.getItem("uniq:auto-reloaded");
      if (!reloaded) {
        sessionStorage.setItem("uniq:auto-reloaded", "1");
        window.location.reload();
        return;
      }
    } else {
      // Limpa flag se foi outro erro qualquer pra próximo deploy ter chance
      sessionStorage.removeItem("uniq:auto-reloaded");
    }
  }, [error]);

  return (
    <html>
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", background: "#0a0a0f", color: "#e5e5e5" }}>
        <div style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          textAlign: "center",
        }}>
          <h1 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>Algo deu errado</h1>
          <p style={{ fontSize: 13, color: "#888", marginBottom: 16, maxWidth: 420 }}>
            {error.message || "Erro inesperado ao carregar a página."}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => reset()}
              style={{
                background: "#00d46a",
                color: "#03170a",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Tentar novamente
            </button>
            <button
              onClick={() => window.location.href = "/"}
              style={{
                background: "transparent",
                color: "#e5e5e5",
                border: "1px solid #333",
                borderRadius: 8,
                padding: "8px 16px",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Ir para início
            </button>
          </div>
          {error.digest && (
            <p style={{ fontSize: 10, color: "#555", marginTop: 16, fontFamily: "monospace" }}>
              ref: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
