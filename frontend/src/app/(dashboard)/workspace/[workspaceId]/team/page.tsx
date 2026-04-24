"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter, useParams } from "next/navigation";
import { workspacesApi, rolesApi } from "@/lib/api";
import { Users, Plus, Mail, Loader2, Crown, X, Copy, Check, UserMinus, ChevronLeft } from "lucide-react";
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
  const [showInvite, setShowInvite] = useState(false);

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

  const { data: roles = [] } = useQuery<Role[]>({
    queryKey: ["workspace-roles", workspaceId],
    queryFn: () => rolesApi.list(workspaceId).then((r) => r.data.roles || r.data),
    enabled: !!workspaceId,
  });

  const createInviteMutation = useMutation({
    mutationFn: (data: { email: string; role_id: string }) =>
      workspacesApi.createInvite(workspaceId, data),
    onSuccess: (res) => {
      toast.success("Convite enviado");
      queryClient.invalidateQueries({ queryKey: ["workspace-invites", workspaceId] });
      setInviteEmail("");
      setInviteRoleId("");
      setShowInvite(false);
      const invite = res.data.invite;
      if (invite) {
        const link = `${window.location.origin}/invite/${invite.token}`;
        navigator.clipboard.writeText(link);
        setCopiedLink(link);
        setTimeout(() => setCopiedLink(null), 5000);
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar convite";
      toast.error(msg);
    },
  });

  const removeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => workspacesApi.revokeInvite(workspaceId, inviteId),
    onSuccess: () => {
      toast.success("Convite revogado");
      queryClient.invalidateQueries({ queryKey: ["workspace-invites", workspaceId] });
    },
    onError: () => toast.error("Erro ao revogar convite"),
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
    background: "hsl(240 18% 6%)",
    border: "1px solid hsl(240 12% 13%)",
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending": return { bg: "rgba(59,130,246,0.1)", color: "#60a5fa" };
      case "accepted": return { bg: "rgba(0,212,106,0.1)", color: "#4ade80" };
      case "expired": return { bg: "rgba(251,146,60,0.1)", color: "#fb923c" };
      case "revoked": return { bg: "rgba(239,68,68,0.1)", color: "#f87171" };
      default: return { bg: "rgba(255,255,255,0.05)", color: "hsl(240 8% 50%)" };
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
            style={{ color: "hsl(240 8% 50%)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
              {workspace?.name || "Team"}
            </h1>
            <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
              Gerencie membros e convites do workspace.
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
        >
          <Mail className="w-4 h-4" />
          Convidar
        </button>
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
              <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>Convidar membro</h2>
            </div>
            <button
              onClick={() => { setShowInvite(false); setInviteEmail(""); setInviteRoleId(""); }}
              className="p-1 rounded"
              style={{ color: "hsl(240 8% 40%)" }}
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
            >
              <option value="">Selecione uma função</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </select>
          </div>

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
              className="rounded-xl p-3 flex items-center gap-2 animate-fade-in-up"
              style={{ background: "rgba(0,212,106,0.05)", border: "1px solid rgba(0,212,106,0.15)" }}
            >
              <Check className="w-4 h-4" style={{ color: "var(--green)" }} />
              <span className="text-sm" style={{ color: "#86efac" }}>
                Link copiado para a área de transferência!
              </span>
            </div>
          )}
        </div>
      )}

      {/* Members */}
      <div className="rounded-2xl overflow-hidden animate-fade-in-up" style={cardStyle}>
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid hsl(240 12% 11%)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
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
                  borderBottom: i < members.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)")}
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
                  <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>
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
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
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
        <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid hsl(240 12% 11%)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
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
                    borderBottom: i < invites.length - 1 ? "1px solid rgba(255,255,255,0.04)" : undefined,
                  }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)")}
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
                        <span className="text-xs" style={{ color: "hsl(240 8% 38%)" }}>{invite.role.name}</span>
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
                  {invite.status === "pending" && (
                    <button
                      onClick={async () => {
                        if (!await showConfirm(`Revogar convite para ${invite.email}?`, { title: "Revogar convite", confirmLabel: "Revogar" })) return;
                        removeInviteMutation.mutate(invite.id);
                      }}
                      className="p-2 rounded-lg transition-colors"
                      style={{ color: "hsl(240 8% 32%)" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 32%)")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
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
          style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)", color: "hsl(240 8% 60%)" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "hsl(240 12% 20%)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "hsl(240 12% 13%)"; }}
        >
          Gerenciar Funções
        </button>
      </div>
    </div>
  );
}
