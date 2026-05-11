"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { integrationsApi } from "@/lib/api";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

// Anthropic redireciona para esta página com `?code=...&state=...` após o
// usuário autorizar na claude.ai. Completamos o token exchange automaticamente.
export default function ClaudeOAuthCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("Finalizando autenticação com Claude.ai…");

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setStatus("error");
      setMessage("Parâmetros inválidos — refaça o processo na página de integrações.");
      return;
    }
    integrationsApi
      .completeClaudeOAuth({ code, state })
      .then((r) => {
        setStatus("ok");
        setMessage(`Claude.ai conectado${r.data?.name ? `: ${r.data.name}` : ""}. Redirecionando…`);
        toast.success("Claude.ai conectado via OAuth");
        setTimeout(() => router.replace("/integrations"), 1500);
      })
      .catch((e) => {
        setStatus("error");
        setMessage(e?.response?.data?.error ?? "Falha ao concluir autorização. Tente novamente.");
      });
  }, [params, router]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div
        className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{ background: "var(--surface-solid)", border: "1px solid var(--border)" }}
      >
        {status === "loading" && (
          <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin" style={{ color: "#d97706" }} />
        )}
        {status === "ok" && (
          <CheckCircle2 className="mx-auto mb-4 h-10 w-10" style={{ color: "#d97706" }} />
        )}
        {status === "error" && (
          <XCircle className="mx-auto mb-4 h-10 w-10" style={{ color: "#ef4444" }} />
        )}
        <h1 className="mb-2 text-lg font-medium" style={{ color: "hsl(240 15% 93%)" }}>
          {status === "loading"
            ? "Conectando Claude.ai…"
            : status === "ok"
            ? "Conectado"
            : "Falha na conexão"}
        </h1>
        <p className="text-sm" style={{ color: "var(--text-3)" }}>{message}</p>
        {status === "error" && (
          <button
            onClick={() => router.replace("/integrations")}
            className="mt-6 rounded-xl px-4 py-2 text-sm font-medium"
            style={{ background: "#d97706", color: "#fff" }}
          >
            Voltar para integrações
          </button>
        )}
      </div>
    </div>
  );
}
