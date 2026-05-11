"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { workspacesApi, rolesApi } from "@/lib/api";
import { WorkspaceTabs } from "@/components/workspace/WorkspaceTabs";
import { Users, Plus, Mail, Loader2, Crown, X, Copy, Check, UserMinus, ChevronLeft, Send } from "lucide-react";
import { toast } from "sonner";
import { showConfirm } from "@/lib/confirm";
import type { Workspace, UserWorkspace, Role, Invite } from "@/types";

export default function TeamPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspaceId = params.workspaceId as string;

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState("");
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const inviteLink = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/invite/${token}`;

  const copyInviteLink = async (invite: Invite) => {
    try {
      const link = inviteLink(invite.token);
      await navigator.clipboard.writeText(link);
      setCopiedInviteId(invite.id);
      toast.success("Link de convite copiado");
      setTimeout(() => setCopiedInviteId((v) => (v === invite.id ? null : v)), 2500);
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  };

  const { data: workspace } = useQuery<Workspace>({
    queryKey: ["workspace", workspaceId],
    queryFn: () => workspacesApi.get(workspaceId).then((r) => r.data.workspace || r.data),
    enabled: !!workspaceId,
  });

  const { data: members = [], isLoading: membersLoading } = useQuery<UserWorkspace[]>({
    queryKey: ["workspace-members", workspaceId],
    queryFn: () => workspacesApi.listMembers(workspaceId).then((r) => r.data.members || r.data),
    enabled: !!workspaceId,
  });

  const { data: invites = [], isLoading: invitesLoading } = useQuery<Invite[]>({
    queryKey: ["workspace-invites", workspaceId],
    queryFn: () => workspacesApi.listInvites(workspaceId).then((r) => r.data.invites || r.data),
    enabled: !!workspaceId,
  });

  const rolesQuery = useQuery<Role[]>({
    queryKey: ["workspace-roles", workspaceId],
    queryFn: () => rolesApi.list(workspaceId).then((r) => (r.data.roles ?? r.data ?? []) as Role[]),
    enabled: !!workspaceId,
  });
  const roles = rolesQuery.data ?? [];

  const createInviteMutation = useMutation({
    mutationFn: (data: { email: string; role_id: string }) =>
      workspacesApi.createInvite(workspaceId, data),
    onSuccess: (res) => {
      toast.success("Convite criado — email enviado e link copiado");
      queryClient.invalidateQueries({ queryKey: ["workspace-invites", workspaceId] });
      setInviteEmail("");
      setInviteRoleId("");
      // Mantém o form aberto pra exibir o link copiável — o usuário fecha manualmente.
      const invite = res.data.invite;
      if (invite) {
        const link = `${window.location.origin}/invite/${invite.token}`;
        navigator.clipboard.writeText(link).catch(() => {});
        setCopiedLink(link);
        setTimeout(() => setCopiedLink(null), 30000);
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar convite";
      toast.error(msg);
    },
  });

  const resendInviteMutation = useMutation({
    mutationFn: (inviteId: string) => workspacesApi.resendInvite(workspaceId, inviteId),
    onSuccess: () => {
      toast.success("Email de convite reenviado");
      queryClient.invalidateQueries({ queryKey: ["workspace-invites", workspaceId] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string; accept_url?: string } } };
      const msg = e?.response?.data?.error || "Erro ao reenviar email";
      const acceptURL = e?.response?.data?.accept_url;
      if (acceptURL) {
        navigator.clipboard.writeText(acceptURL).catch(() => {});
        toast.error(`${msg} — link copiado pra área de transferência`);
      } else {
        toast.error(msg);
      }
    },
  });

  const removeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => workspacesApi.revokeInvite(workspaceId, inviteId),
    onMutate: async (inviteId: string) => {
      // Remove a linha da UI imediatamente — sensação de resposta instantânea.
      await queryClient.cancelQueries({ queryKey: ["workspace-invites", workspaceId] });
      const prev = queryClient.getQueryData<Invite[]>(["workspace-invites", workspaceId]);
      queryClient.setQueryData<Invite[]>(
        ["workspace-invites", workspaceId],
        (old = []) => old.filter((i) => i.id !== inviteId),
      );
      return { prev };
    },
    onError: (_err, _inviteId, ctx) => {
      // Rollback se o backend rejeitar.
      if (ctx?.prev) {
        queryClient.setQueryData(["workspace-invites", workspaceId], ctx.prev);
      }
      toast.error("Erro ao revogar convite");
    },
    onSuccess: () => {
      toast.success("Convite revogado");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-invites", workspaceId] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId: string) => workspacesApi.removeMember(workspaceId, memberId),
    onSuccess: () => {
      toast.success("Membro removido");
      queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
    },
    onError: () => toast.error("Erro ao remover membro"),
  });

  const updateMemberRoleMutation = useMutation({
    mutationFn: ({ memberId, roleId }: { memberId: string; roleId: string | null }) =>
      workspacesApi.updateMember(workspaceId, memberId, { role_id: roleId }),
    onSuccess: () => {
      toast.success("Função atualizada");
      queryClient.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
    },
    onError: (err) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
        || "Falha ao alterar função";
      toast.error(msg);
    },
  });

  // Apenas owner e super-admin podem trocar role de um membro já no workspace.
  // Se o backend aceitar, o mutation apenas sobe 403 e a UI mostra o toast
  // (então aqui deixamos habilitado por default — o backend é o árbitro).
  const canManageRoles = true;

  const cardStyle = {
    background: "var(--surface-solid)",
    border: "1px solid var(--border)",
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return { bg: "rgba(59,130,246,0.1)", color: "#60a5fa" };
      case "accepted": return { bg: "rgba(0,212,106,0.1)", color: "#4ade80" };
      case "expired": return { bg: "rgba(251,146,60,0.1)", color: "#fb923c" };
      case "revoked": return { bg: "rgba(239,68,68,0.1)", color: "#f87171" };
      default: return { bg: "var(--surface-2)", color: "var(--text-3)" };
    }
  };

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/workspace")}
            className="p-2 rounded-lg transition-colors"
            style={{ color: "var(--text-3)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-2)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
              {workspace?.name || "Team"}
            </h1>
            <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
              Gerencie membros e convites do workspace.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <WorkspaceTabs workspaceId={workspaceId} />
          <button
            onClick={() => setShowInvite(true)}
            className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
          >
            <Mail className="w-4 h-4" />
            Convidar
          </button>
        </div>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="rounded-2xl p-5 space-y-4 animate-fade-in-up" style={cardStyle}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)" }}
              >
                <Mail className="w-3.5 h-3.5" style={{ color: "#60a5fa" }} />
              </div>
              <h2 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Convidar membro</h2>
            </div>
            <button
              onClick={() => { setShowInvite(false); setInviteEmail(""); setInviteRoleId(""); }}
              className="p-1 rounded"
              style={{ color: "var(--text-4)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Email do membro"
              className="input-field"
            />
            <select
              value={inviteRoleId}
              onChange={(e) => setInviteRoleId(e.target.value)}
              className="input-field"
              disabled={rolesQuery.isLoading || rolesQuery.isError || roles.length === 0}
            >
              <option value="">
                {rolesQuery.isLoading
                  ? "Carregando funções…"
                  : rolesQuery.isError
                    ? "Erro ao carregar funções"
                    : roles.length === 0
                      ? "Nenhuma função disponível"
                      : "Selecione uma função"}
              </option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>
          {!rolesQuery.isLoading && !rolesQuery.isError && roles.length === 0 && (
            <p className="-mt-2 text-xs" style={{ color: "hsl(240 8% 52%)" }}>
              Nenhuma função criada neste workspace.{" "}
              <Link
                href={`/workspace/${workspaceId}/roles`}
                className="underline"
                style={{ color: "#00d46a" }}
              >
                Criar a primeira função →
              </Link>
            </p>
          )}
          {rolesQuery.isError && (
            <p className="-mt-2 text-xs" style={{ color: "#ef4444" }}>
              Não consegui carregar as funções. Verifique se você tem acesso a este workspace.
            </p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => createInviteMutation.mutate({ email: inviteEmail, role_id: inviteRoleId })}
              disabled={!inviteEmail || !inviteRoleId || createInviteMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {createInviteMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Mail className="w-4 h-4" />
              }
              Enviar convite
            </button>
          </div>

          {copiedLink && (
            <div
              className="rounded-xl p-4 space-y-3 animate-fade-in-up"
              style={{ background: "rgba(0,212,106,0.05)", border: "1px solid rgba(0,212,106,0.2)" }}
            >
              <div className="flex items-center gap-2">
                <Check className="w-4 h-4" style={{ color: "var(--green, #00d46a)" }} />
                <span className="text-sm font-medium" style={{ color: "#86efac" }}>
                  Convite criado. Link copiado — envie também por onde quiser.
                </span>
              </div>
              <div
                className="flex items-center gap-2 rounded-lg px-3 py-2"
                style={{ background: "var(--surface-overlay)", border: "1px solid var(--border-default)" }}
              >
                <code className="flex-1 text-xs truncate" style={{ color: "hsl(240 15% 80%)" }}>
                  {copiedLink}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(copiedLink).then(() => {
                      toast.success("Link copiado");
                    });
                  }}
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors"
                  style={{ background: "var(--surface-2)", color: "hsl(240 15% 80%)" }}
                >
                  <Copy className="w-3.5 h-3.5" /> Copiar
                </button>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`Você foi convidado para o workspace ${workspace?.name || ""}: ${copiedLink}`)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors"
                  style={{ background: "rgba(0,212,106,0.1)", color: "#4ade80" }}
                >
                  WhatsApp
                </a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Members */}
      <div className="rounded-2xl overflow-hidden animate-fade-in-up" style={cardStyle}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-xs font-medium uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
            {members.length} membro{members.length !== 1 ? "s" : ""}
          </h2>
        </div>

        {membersLoading ? (
          <div className="p-5 space-y-2">
            {[1, 2].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />)}
          </div>
        ) : members.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-8 h-8 mx-auto mb-3" style={{ color: "hsl(240 8% 28%)" }} />
            <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Nenhum membro</p>
          </div>
        ) : (
          <div>
            {members.map((member, i) => (
              <div
                key={member.id}
                className="px-5 py-4 flex items-center gap-4 transition-colors"
                style={{
                  borderBottom: i < members.length - 1 ? "1px solid var(--border-default)" : undefined,
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)" }}
                >
                  <span className="text-sm font-medium" style={{ color: "#a78bfa" }}>
                    {member.user?.name?.charAt(0)?.toUpperCase() || member.user?.email?.charAt(0)?.toUpperCase() || "?"}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium" style={{ color: "hsl(240 15% 80%)" }}>{member.user?.name || "Usuário"}</p>
                    {member.is_owner && (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(234,179,8,0.1)", color: "#fbbf24" }}
                      >
                        <Crown className="w-3 h-3" />
                        Proprietário
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-4)" }}>
                    {member.user?.email}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {member.is_owner ? (
                    <span
                      className="rounded-lg px-2 py-1 text-xs"
                      style={{ background: "rgba(234,179,8,0.08)", color: "#fbbf24" }}
                    >
                      Acesso total
                    </span>
                  ) : (
                    <select
                      value={member.role?.id ?? ""}
                      onChange={(e) =>
                        updateMemberRoleMutation.mutate({
                          memberId: member.user_id,
                          roleId: e.target.value || null,
                        })
                      }
                      disabled={!canManageRoles || updateMemberRoleMutation.isPending}
                      className="rounded-lg px-2 py-1 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      style={{
                        background: "var(--surface-2)",
                        border: "1px solid var(--border-default)",
                        color: "hsl(240 8% 85%)",
                      }}
                    >
                      <option value="" style={{ background: "#111" }}>
                        — Sem função —
                      </option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id} style={{ background: "#111" }}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {!member.is_owner && (
                    <button
                      onClick={async () => {
                        if (!await showConfirm(`Remover ${member.user?.name || "este membro"} do workspace?`, { title: "Remover membro", confirmLabel: "Remover" })) return;
                        removeMemberMutation.mutate(member.user_id);
                      }}
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: "hsl(240 8% 32%)" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}
                    >
                      <UserMinus className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending invites */}
      <div className="rounded-2xl overflow-hidden animate-fade-in-up" style={{ ...cardStyle, animationDelay: "50ms", animationFillMode: "both" }}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <h2 className="text-xs font-medium uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
            {invites.filter(i => i.status === "pending").length} convite{invites.filter(i => i.status === "pending").length !== 1 ? "s" : ""} pendente{invites.filter(i => i.status === "pending").length !== 1 ? "s" : ""}
          </h2>
        </div>

        {invitesLoading ? (
          <div className="p-5 space-y-2">
            {[1, 2].map((i) => <div key={i} className="skeleton h-14 rounded-xl" />)}
          </div>
        ) : invites.length === 0 ? (
          <div className="p-12 text-center">
            <Mail className="w-8 h-8 mx-auto mb-3" style={{ color: "hsl(240 8% 28%)" }} />
            <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Nenhum convite pendente</p>
          </div>
        ) : (
          <div>
            {invites.map((invite, i) => {
              const statusStyle = getStatusColor(invite.status);
              return (
                <div
                  key={invite.id}
                  className="px-5 py-4 flex items-center gap-4 transition-colors"
                  style={{
                    borderBottom: i < invites.length - 1 ? "1px solid var(--border-default)" : undefined,
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                >
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)" }}
                  >
                    <Mail className="w-4 h-4" style={{ color: "#60a5fa" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" style={{ color: "hsl(240 15% 80%)" }}>{invite.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {invite.role && (
                        <span className="text-xs" style={{ color: "var(--text-4)" }}>{invite.role.name}</span>
                      )}
                      <span className="text-xs" style={{ color: "hsl(240 8% 28%)" }}>
                        Enviado {new Date(invite.created_at).toLocaleDateString("pt-BR")}
                      </span>
                    </div>
                  </div>
                  <span
                    className="text-xs px-2 py-1 rounded-lg capitalize"
                    style={{ background: statusStyle.bg, color: statusStyle.color }}
                  >
                    {invite.status}
                  </span>
                  <button
                    onClick={() => copyInviteLink(invite)}
                    title="Copiar link de convite"
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                    style={{
                      background: copiedInviteId === invite.id ? "rgba(0,212,106,0.1)" : "var(--surface-2)",
                      border: `1px solid ${copiedInviteId === invite.id ? "rgba(0,212,106,0.25)" : "var(--border-default)"}`,
                      color: copiedInviteId === invite.id ? "#4ade80" : "hsl(240 8% 65%)",
                    }}
                  >
                    {copiedInviteId === invite.id ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copiar link
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => resendInviteMutation.mutate(invite.id)}
                    disabled={resendInviteMutation.isPending}
                    title="Reenviar email de convite"
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                    style={{
                      background: "rgba(99,102,241,0.08)",
                      border: "1px solid rgba(99,102,241,0.2)",
                      color: "#a5b4fc",
                    }}
                  >
                    {resendInviteMutation.isPending && resendInviteMutation.variables === invite.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    Reenviar
                  </button>
                  <button
                    onClick={async () => {
                      if (!await showConfirm(`Revogar convite para ${invite.email}?`, { title: "Revogar convite", confirmLabel: "Revogar" })) return;
                      removeInviteMutation.mutate(invite.id);
                    }}
                    title="Revogar convite"
                    className="p-2 rounded-lg transition-colors"
                    style={{ color: "hsl(240 8% 32%)" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                    onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div className="flex items-center gap-4 animate-fade-in-up" style={{ animationDelay: "100ms", animationFillMode: "both" }}>
        <button
          onClick={() => router.push(`/workspace/${workspaceId}/roles`)}
          className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl transition-colors"
          style={{ background: "var(--surface-solid)", border: "1px solid var(--border)", color: "var(--text-3)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "hsl(240 12% 20%)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-default)"; }}
        >
          Gerenciar Funções
        </button>
      </div>
    </div>
  );
}
