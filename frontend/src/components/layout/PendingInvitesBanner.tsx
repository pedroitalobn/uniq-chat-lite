"use client";

// PendingInvitesBanner — alerta in-app pra users que já tinham conta na
//  Qchat quando alguém os convida pra outro workspace. Antes o convite só
// chegava por email; se o user não abrisse o email não tinha como saber.
// Polling leve (30s + refetchOnFocus) cobre o caso "convite criado em
// outra sessão" sem precisar de WebSocket.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { workspacesApi } from "@/lib/api";

type PendingInvite = {
  token: string;
  workspace_id: string;
  workspace_name: string;
  role_name: string;
  inviter_name: string;
  inviter_email: string;
  expires_at: string;
};

export function PendingInvitesBanner() {
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const { data } = useQuery<{ invites: PendingInvite[] }>({
    queryKey: ["my-pending-invites"],
    queryFn: () => workspacesApi.myPendingInvites().then((r) => r.data),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const acceptMut = useMutation({
    mutationFn: (token: string) => workspacesApi.acceptInvite(token),
    onSuccess: () => {
      toast.success("Você entrou no workspace");
      qc.invalidateQueries({ queryKey: ["my-pending-invites"] });
      qc.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || "Não foi possível aceitar o convite");
    },
  });

  const invites = (data?.invites || []).filter((i) => !dismissed.has(i.token));
  if (invites.length === 0) return null;

  return (
    <div className="space-y-2 px-4 sm:px-6 pt-3">
      {invites.map((inv) => (
        <div
          key={inv.token}
          className="rounded-xl p-3 sm:p-4 flex items-center gap-3 flex-wrap"
          style={{
            background: "rgba(37, 99, 235,0.06)",
            border: "1px solid rgba(37, 99, 235,0.2)",
          }}
        >
          <span
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "rgba(37, 99, 235,0.12)" }}
          >
            <Building2 className="w-4 h-4" style={{ color: "#2563EB" }} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
              <strong>{inv.inviter_name || inv.inviter_email}</strong> convidou você para{" "}
              <strong>{inv.workspace_name}</strong>
            </p>
            <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
              Função: {inv.role_name || "Membro"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => acceptMut.mutate(inv.token)}
              disabled={acceptMut.isPending}
              className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "#2563EB", color: "#0a0a0f" }}
            >
              {acceptMut.isPending && acceptMut.variables === inv.token ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Aceitar
            </button>
            <button
              onClick={() => setDismissed((s) => new Set(s).add(inv.token))}
              className="p-1.5 rounded-lg"
              style={{ color: "var(--text-3)" }}
              title="Dispensar (continua disponível em /workspace)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
