"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Check, Loader2, Mail, X, LogIn } from "lucide-react";
import { workspacesApi } from "@/lib/api";

// Página pública de aceite de convite. Fluxo:
// 1. Usuário clica no link recebido por email.
// 2. Se não está logado → manda pra /login?callbackUrl=/invite/<token>.
// 3. Se está logado com o mesmo email → aceita automaticamente e redireciona.
// 4. Se está logado com email diferente → avisa e oferece logout.
export default function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const { data: session, status } = useSession();
  const [state, setState] = useState<"idle" | "accepting" | "done" | "error" | "wrong_user">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      const cb = encodeURIComponent(`/invite/${token}`);
      router.replace(`/login?callbackUrl=${cb}`);
      return;
    }

    if (state !== "idle") return;
    setState("accepting");

    workspacesApi
      .acceptInvite(token)
      .then((r) => {
        setWorkspaceId(r.data?.workspace_id || null);
        setState("done");
      })
      .catch((err: unknown) => {
        const e = err as { response?: { status?: number; data?: { error?: string } } };
        const msg = e?.response?.data?.error || "";
        if (e?.response?.status === 403 && /outro email|for another/i.test(msg)) {
          setState("wrong_user");
          setErrorMsg(msg);
        } else {
          setState("error");
          setErrorMsg(msg || "Convite inválido ou expirado");
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const go = () => {
    if (workspaceId) {
      router.replace(`/workspace/${workspaceId}`);
    } else {
      router.replace("/workspace");
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{ background: "hsl(240 15% 4%)" }}
    >
      <div className="w-full max-w-md">
        <div
          className="rounded-2xl p-8 space-y-5 animate-fade-in-up"
          style={{
            background: "hsl(240 18% 6%)",
            border: "1px solid hsl(240 12% 13%)",
            boxShadow: "0 24px 60px -20px rgba(0,0,0,0.5)",
          }}
        >
          {(state === "idle" || state === "accepting" || status === "loading") && (
            <div className="flex flex-col items-center text-center space-y-3">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}
              >
                <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#818cf8" }} />
              </div>
              <h1 className="text-lg font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
                Processando convite…
              </h1>
              <p className="text-sm" style={{ color: "hsl(240 8% 55%)" }}>
                Só um instante.
              </p>
            </div>
          )}

          {state === "done" && (
            <div className="flex flex-col items-center text-center space-y-3">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.25)" }}
              >
                <Check className="h-7 w-7" style={{ color: "#4ade80" }} />
              </div>
              <h1 className="text-lg font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
                Convite aceito!
              </h1>
              <p className="text-sm" style={{ color: "hsl(240 8% 55%)" }}>
                Você já faz parte do workspace. Bora trabalhar.
              </p>
              <button
                onClick={go}
                className="btn-primary flex items-center gap-2 text-sm px-5 py-2.5 mt-2"
              >
                Entrar no workspace
              </button>
            </div>
          )}

          {state === "wrong_user" && (
            <div className="flex flex-col items-center text-center space-y-3">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.25)" }}
              >
                <Mail className="h-7 w-7" style={{ color: "#fb923c" }} />
              </div>
              <h1 className="text-lg font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
                Este convite é para outro email
              </h1>
              <p className="text-sm" style={{ color: "hsl(240 8% 55%)" }}>
                Você está logado como <strong style={{ color: "hsl(240 15% 82%)" }}>{session?.user?.email}</strong>.
                {" "}Saia da conta atual e entre com o email que recebeu o convite.
              </p>
              <button
                onClick={() => router.replace(`/login?callbackUrl=${encodeURIComponent(`/invite/${token}`)}`)}
                className="flex items-center gap-2 text-sm px-5 py-2.5 mt-2 rounded-xl transition-colors"
                style={{
                  background: "rgba(99,102,241,0.1)",
                  border: "1px solid rgba(99,102,241,0.25)",
                  color: "#a5b4fc",
                }}
              >
                <LogIn className="h-4 w-4" />
                Entrar com outra conta
              </button>
            </div>
          )}

          {state === "error" && (
            <div className="flex flex-col items-center text-center space-y-3">
              <div
                className="h-14 w-14 rounded-2xl flex items-center justify-center"
                style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
              >
                <X className="h-7 w-7" style={{ color: "#f87171" }} />
              </div>
              <h1 className="text-lg font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
                Não foi possível aceitar
              </h1>
              <p className="text-sm" style={{ color: "hsl(240 8% 55%)" }}>
                {errorMsg}
              </p>
              <button
                onClick={() => router.replace("/workspace")}
                className="text-sm px-5 py-2.5 mt-2 rounded-xl transition-colors"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "hsl(240 8% 70%)",
                }}
              >
                Ir para a plataforma
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
