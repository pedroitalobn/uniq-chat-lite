"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { integrationsApi } from "@/lib/api";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

// OpenRouter PKCE redireciona para esta página com `?code=...&state=...` após o
// usuário autorizar. Trocamos code por uma API key persistente via backend.
export default function OpenRouterCallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("Trocando código por API key…");

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      setStatus("error");
      setMessage("Parâmetros inválidos — refaça o processo na página de integrações.");
      return;
    }
    integrationsApi
      .completeOpenRouterOAuth({ code, state })
      .then((r) => {
        setStatus("ok");
        setMessage(`Integração criada: ${r.data?.name ?? "OpenRouter"}. Redirecionando…`);
        toast.success("OpenRouter conectado");
        setTimeout(() => router.replace("/integrations"), 1500);
      })
      .catch((e) => {
        setStatus("error");
        setMessage(e?.response?.data?.error ?? "Falha ao concluir autorização.");
      });
  }, [params, router]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl p-8 text-center"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}>
        {status === "loading" && <Loader2 className="mx-auto mb-4 h-10 w-10 animate-spin" style={{ color: "var(--green)" }} />}
        {status === "ok"      && <CheckCircle2 className="mx-auto mb-4 h-10 w-10" style={{ color: "var(--green)" }} />}
        {status === "error"   && <XCircle className="mx-auto mb-4 h-10 w-10" style={{ color: "#ef4444" }} />}
        <h1 className="mb-2 text-lg font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
          {status === "loading" ? "Conectando OpenRouter…" : status === "ok" ? "Conectado" : "Falha na conexão"}
        </h1>
        <p className="text-sm" style={{ color: "hsl(240 8% 60%)" }}>{message}</p>
        {status === "error" && (
          <button
            onClick={() => router.replace("/integrations")}
            className="mt-6 rounded-xl px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--green)", color: "#03170a" }}
          >
            Voltar para integrações
          </button>
        )}
      </div>
    </div>
  );
}
