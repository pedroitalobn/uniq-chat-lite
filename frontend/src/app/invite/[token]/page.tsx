"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Mail, X, LogIn, UserPlus, Building2, Crown } from "lucide-react";
import { workspacesApi } from "@/lib/api";
import { Logo } from "@/components/Logo";

// Página pública de aceite de convite. Fluxo:
//   1. Consulta /v1/workspaces/invites/preview/:token (público) pra descobrir
//      o email do convite, nome do workspace, quem convidou e se a conta já
//      existe.
//   2. Se NÃO logado:
//        - user_exists=true  → manda pra /login?callbackUrl=/invite/<token>
//        - user_exists=false → manda pra /register?workspace_invite=<token>
//          (a página de cadastro pre-preenche o email e trava)
//   3. Se logado com o email do convite → aceita automaticamente e vai pro
//      workspace.
//   4. Se logado com email diferente → oferece trocar de conta.
//
// A rota nunca mostra um botão "Fazer login" como ação principal pra quem
// não tem conta — isso era o bug anterior.

interface Preview {
  email: string;
  workspace_name: string;
  inviter_name: string;
  role_name: string;
  user_exists: boolean;
  expires_at: string;
}

export default function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();
  const { data: session, status } = useSession();
  const queryClient = useQueryClient();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [state, setState] = useState<"idle" | "accepting" | "done" | "error" | "wrong_user" | "route_register" | "route_login">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  // Step 1: preview.
  useEffect(() => {
    workspacesApi
      .previewInvite(token)
      .then((r) => setPreview(r.data as Preview))
      .catch((err: unknown) => {
        const e = err as { response?: { data?: { error?: string }; status?: number } };
        if (e?.response?.status === 410) setPreviewError("Este convite expirou.");
        else if (e?.response?.status === 404) setPreviewError("Convite inválido ou já utilizado.");
        else setPreviewError(e?.response?.data?.error || "Não foi possível carregar o convite.");
      })
      .finally(() => setLoadingPreview(false));
  }, [token]);

  // Step 2/3: decide roteamento baseado no preview + sessão.
  useEffect(() => {
    if (loadingPreview || !preview) return;
    if (status === "loading") return;

    const cbInvite = `/invite/${token}`;
    // Sem sessão: não existe conta → cadastro; existe conta → login.
    if (status === "unauthenticated") {
      if (preview.user_exists) {
        setState("route_login");
        router.replace(`/login?callbackUrl=${encodeURIComponent(cbInvite)}&email=${encodeURIComponent(preview.email)}`);
      } else {
        setState("route_register");
        router.replace(`/register?workspace_invite=${encodeURIComponent(token)}&email=${encodeURIComponent(preview.email)}`);
      }
      return;
    }

    // Logado mas email não bate — oferece trocar.
    if (session?.user?.email && session.user.email.toLowerCase() !== preview.email.toLowerCase()) {
      setState("wrong_user");
      return;
    }

    // Logado com email certo — aceita.
    if (state !== "idle") return;
    setState("accepting");
    workspacesApi
      .acceptInvite(token)
      .then((r) => {
        setWorkspaceId(r.data?.workspace_id || null);
        // Invalida cache de workspaces — sem isso o seletor da Sidebar fica
        // mostrando só o workspace antigo (staleTime=5min) até refresh manual.
        queryClient.invalidateQueries({ queryKey: ["workspaces"] });
        setState("done");
      })
      .catch((err: unknown) => {
        const e = err as { response?: { status?: number; data?: { error?: string } } };
        const msg = e?.response?.data?.error || "Convite inválido ou expirado";
        setState("error");
        setErrorMsg(msg);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingPreview, preview, status]);

  const go = () => {
    if (workspaceId) router.replace(`/workspace/${workspaceId}`);
    else router.replace("/inbox");
  };

  const renderShell = (inner: React.ReactNode) => (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-12"
      style={{ background: "var(--surface-solid)" }}
    >
      {/* Ambient glow */}
      <div
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] pointer-events-none"
        style={{ background: "radial-gradient(ellipse at bottom, rgba(37, 99, 235,0.06) 0%, transparent 70%)" }}
      />
      <div className="w-full max-w-md relative animate-fade-in-up">
        <div className="flex flex-col items-center mb-6">
          <Logo height={38} />
        </div>
        <div
          className="rounded-2xl p-7 space-y-5"
          style={{
            background: "var(--surface-solid)",
            boxShadow: "0 0 0 1px var(--border-default), 0 24px 64px rgba(0,0,0,0.5)",
          }}
        >
          {inner}
        </div>
      </div>
    </div>
  );

  // ─── Loading preview ──────────────────────────────────────────────────
  if (loadingPreview) {
    return renderShell(
      <div className="flex flex-col items-center text-center space-y-3 py-4">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#2563EB" }} />
        <p className="text-sm" style={{ color: "var(--text-3)" }}>Carregando convite…</p>
      </div>,
    );
  }

  // ─── Preview falhou ───────────────────────────────────────────────────
  if (previewError || !preview) {
    return renderShell(
      <div className="flex flex-col items-center text-center space-y-3">
        <div
          className="h-14 w-14 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <X className="h-7 w-7" style={{ color: "#f87171" }} />
        </div>
        <h1 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>
          Convite indisponível
        </h1>
        <p className="text-sm" style={{ color: "var(--text-3)" }}>
          {previewError}
        </p>
        <button
          onClick={() => router.replace("/login")}
          className="text-sm px-5 py-2.5 mt-2 rounded-xl transition-colors"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
            color: "hsl(240 8% 70%)",
          }}
        >
          Ir para a plataforma
        </button>
      </div>,
    );
  }

  // ─── Info banner (aparece em quase todos os estados) ──────────────────
  const inviteBanner = (
    <div
      className="rounded-xl p-4 space-y-2.5"
      style={{ background: "rgba(37, 99, 235,0.04)", border: "1px solid rgba(37, 99, 235,0.15)" }}
    >
      <div className="flex items-center gap-2">
        <Building2 className="h-4 w-4" style={{ color: "#2563EB" }} />
        <span className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
          {preview.workspace_name}
        </span>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
        <strong style={{ color: "var(--text-2)" }}>{preview.inviter_name}</strong> convidou
        você como{" "}
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
          style={{ background: "rgba(99,102,241,0.12)", color: "#a5b4fc" }}
        >
          <Crown className="h-3 w-3" />
          {preview.role_name}
        </span>
      </p>
    </div>
  );

  // ─── Estados de roteamento (enquanto o router.replace não aconteceu) ──
  if (state === "route_register" || state === "route_login") {
    const isRegister = state === "route_register";
    return renderShell(
      <>
        {inviteBanner}
        <div className="flex flex-col items-center text-center space-y-3 pt-2">
          <div
            className="h-12 w-12 rounded-2xl flex items-center justify-center"
            style={{
              background: isRegister ? "rgba(37, 99, 235,0.1)" : "rgba(99,102,241,0.1)",
              border: `1px solid ${isRegister ? "rgba(37, 99, 235,0.25)" : "rgba(99,102,241,0.25)"}`,
            }}
          >
            {isRegister ? (
              <UserPlus className="h-5 w-5" style={{ color: "#2563EB" }} />
            ) : (
              <LogIn className="h-5 w-5" style={{ color: "#a5b4fc" }} />
            )}
          </div>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>
            {isRegister ? "Redirecionando para o cadastro…" : "Redirecionando para o login…"}
          </p>
        </div>
      </>,
    );
  }

  // ─── Já logado, processando aceite ────────────────────────────────────
  if (state === "idle" || state === "accepting") {
    return renderShell(
      <>
        {inviteBanner}
        <div className="flex flex-col items-center text-center space-y-3 pt-2">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#2563EB" }} />
          <p className="text-sm" style={{ color: "var(--text-3)" }}>Processando convite…</p>
        </div>
      </>,
    );
  }

  // ─── Sucesso ──────────────────────────────────────────────────────────
  if (state === "done") {
    return renderShell(
      <>
        {inviteBanner}
        <div className="flex flex-col items-center text-center space-y-3 pt-2">
          <div
            className="h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(37, 99, 235,0.12)", border: "1px solid rgba(37, 99, 235,0.3)" }}
          >
            <Check className="h-7 w-7" style={{ color: "#2563EB" }} />
          </div>
          <h1 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>
            Você faz parte de {preview.workspace_name}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>
            Bora começar a trabalhar.
          </p>
          <button
            onClick={go}
            className="flex items-center gap-2 text-sm font-medium px-5 py-2.5 mt-2 rounded-xl transition-colors"
            style={{ background: "#2563EB", color: "#0a0a0f" }}
          >
            Entrar no workspace
          </button>
        </div>
      </>,
    );
  }

  // ─── Email da sessão diferente do convite ─────────────────────────────
  if (state === "wrong_user") {
    return renderShell(
      <>
        {inviteBanner}
        <div className="flex flex-col items-center text-center space-y-3 pt-2">
          <div
            className="h-14 w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.25)" }}
          >
            <Mail className="h-7 w-7" style={{ color: "#fb923c" }} />
          </div>
          <h1 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>
            Este convite é para outro email
          </h1>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>
            Você está logado como{" "}
            <strong style={{ color: "var(--text-2)" }}>{session?.user?.email}</strong>, mas o
            convite é para{" "}
            <strong style={{ color: "var(--text-2)" }}>{preview.email}</strong>.
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
      </>,
    );
  }

  // ─── Erro no accept ───────────────────────────────────────────────────
  return renderShell(
    <>
      {inviteBanner}
      <div className="flex flex-col items-center text-center space-y-3 pt-2">
        <div
          className="h-14 w-14 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <X className="h-7 w-7" style={{ color: "#f87171" }} />
        </div>
        <h1 className="text-lg font-medium" style={{ color: "var(--text-1)" }}>
          Não foi possível aceitar
        </h1>
        <p className="text-sm" style={{ color: "var(--text-3)" }}>{errorMsg}</p>
        <button
          onClick={() => router.replace("/inbox")}
          className="text-sm px-5 py-2.5 mt-2 rounded-xl transition-colors"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
            color: "hsl(240 8% 70%)",
          }}
        >
          Ir para a plataforma
        </button>
      </div>
    </>,
  );
}
