"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { workspacesApi } from "@/lib/api";
import { Building2, Plus, Loader2, Users, Crown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { showConfirm } from "@/lib/confirm";
import type { Workspace } from "@/types";

export default function WorkspacePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const { data: workspaces = [], isLoading } = useQuery<Workspace[]>({
    queryKey: ["workspaces"],
    queryFn: () => workspacesApi.list().then((r) => r.data.workspaces || r.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string }) => workspacesApi.create(data),
    onSuccess: (res) => {
      toast.success("Workspace criado");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setName("");
      setShowCreate(false);
      const workspaceId = res.data.workspace?.id || res.data.id;
      if (workspaceId) {
        router.push(`/workspace/${workspaceId}/team`);
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar workspace";
      toast.error(msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => workspacesApi.delete(id),
    onSuccess: () => {
      toast.success("Workspace removido");
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
    },
    onError: () => toast.error("Erro ao remover workspace"),
  });

  const cardStyle = {
    background: "hsl(240 18% 6%)",
    border: "1px solid hsl(240 12% 13%)",
  };

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
            Workspaces
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
            Gerencie seus workspaces e times.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5"
        >
          <Plus className="w-4 h-4" />
          Novo Workspace
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-2xl p-5 space-y-4 animate-fade-in-up" style={cardStyle}>
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)" }}
            >
              <Building2 className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
            </div>
            <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>Criar novo workspace</h2>
          </div>

          <div className="flex gap-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && createMutation.mutate({ name: name.trim() })}
              placeholder="Nome do workspace (ex: Minha Empresa)"
              className="input-field flex-1"
            />
            <button
              onClick={() => createMutation.mutate({ name: name.trim() })}
              disabled={!name.trim() || createMutation.isPending}
              className="btn-primary flex items-center gap-2 text-sm px-4 py-2.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {createMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Plus className="w-4 h-4" />
              }
              Criar
            </button>
            <button
              onClick={() => { setShowCreate(false); setName(""); }}
              className="btn-secondary text-sm px-4 py-2.5"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Workspaces list */}
      <div className="rounded-2xl overflow-hidden animate-fade-in-up" style={cardStyle}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid hsl(240 12% 11%)" }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
            {workspaces.length} workspace{workspaces.length !== 1 ? "s" : ""}
          </h2>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-2">
            {[1, 2].map((i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
          </div>
        ) : workspaces.length === 0 ? (
          <div className="p-12 text-center">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}
            >
              <Building2 className="w-5 h-5" style={{ color: "hsl(240 8% 28%)" }} />
            </div>
            <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Nenhum workspace criado</p>
            <p className="text-xs mt-1" style={{ color: "hsl(240 8% 32%)" }}>
              Clique em "Novo Workspace" para começar
            </p>
          </div>
        ) : (
          <div>
            {workspaces.map((ws, i) => (
              <div
                key={ws.id}
                className="px-5 py-4 flex items-center gap-4 transition-colors cursor-pointer"
                style={{
                  borderBottom: i < workspaces.length - 1 ? "1px solid var(--border-default)" : undefined,
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
                onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                onClick={() => router.push(`/workspace/${ws.id}/team`)}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(124,58,237,0.1)", border: "1px solid rgba(124,58,237,0.2)" }}
                >
                  <Building2 className="w-5 h-5" style={{ color: "#a78bfa" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium" style={{ color: "hsl(240 15% 80%)" }}>{ws.name}</p>
                    {ws.is_owner && (
                      <span
                        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                        style={{ background: "rgba(234,179,8,0.1)", color: "#fbbf24" }}
                      >
                        <Crown className="w-3 h-3" />
                        Proprietário
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    {ws.role && (
                      <span className="text-xs" style={{ color: "hsl(240 8% 38%)" }}>
                        {ws.role.name}
                      </span>
                    )}
                    <span className="text-xs" style={{ color: "hsl(240 8% 28%" }}>
                      Criado {new Date(ws.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: "hsl(240 8% 28%)" }} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Info card */}
      <div
        className="rounded-2xl p-5 space-y-3 animate-fade-in-up"
        style={{ ...cardStyle, animationDelay: "100ms", animationFillMode: "both" }}
      >
        <h3 className="text-sm font-medium" style={{ color: "hsl(240 15% 85%)" }}>
          O que é um Workspace?
        </h3>
        <p className="text-sm" style={{ color: "hsl(240 8% 50%)" }}>
          Workspaces permitem organizar seus projetos e times. Cada workspace tem suas próprias instâncias, 
          contatos e configurações. Você pode convidar membros e definir permissões personalizadas para cada time.
        </p>
        <div className="flex items-center gap-4 pt-2">
          <div className="flex items-center gap-2 text-xs" style={{ color: "hsl(240 8% 42%)" }}>
            <Building2 className="w-4 h-4" />
            <span>Múltiplos projetos</span>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: "hsl(240 8% 42%)" }}>
            <Users className="w-4 h-4" />
            <span>Times colaborativos</span>
          </div>
          <div className="flex items-center gap-2 text-xs" style={{ color: "hsl(240 8% 42%)" }}>
            <Crown className="w-4 h-4" />
            <span>Permissões customizadas</span>
          </div>
        </div>
      </div>
    </div>
  );
}
