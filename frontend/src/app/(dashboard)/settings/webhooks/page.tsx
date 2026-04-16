"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Webhook, Plus, Trash2, Play, CheckCircle2, XCircle, Search, Globe } from "lucide-react";
import { globalWebhooksApi } from "@/lib/api";
import { toast } from "sonner";

interface SystemEvent {
  id: string;
  name: string;
  description: string;
}

interface GlobalWebhook {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  events: string[];
  created_at: string;
}

const SYSTEM_EVENTS: SystemEvent[] = [
  { id: "user.registered", name: "Usuário Registrado", description: "Quando um novo usuário se registra" },
  { id: "user.login", name: "Login", description: "Quando um usuário faz login" },
  { id: "user.logout", name: "Logout", description: "Quando um usuário faz logout" },
  { id: "instance.created", name: "Instância Criada", description: "Quando uma nova instância é criada" },
  { id: "instance.connected", name: "Instância Conectada", description: "Quando uma instância conecta ao WhatsApp" },
  { id: "instance.disconnected", name: "Instância Desconectada", description: "Quando uma instância desconecta" },
  { id: "workspace.created", name: "Workspace Criado", description: "Quando um novo workspace é criado" },
  { id: "workspace.member_added", name: "Membro Adicionado", description: "Quando um membro é adicionado a um workspace" },
  { id: "payment.success", name: "Pagamento Succedido", description: "Quando um pagamento é confirmado" },
  { id: "payment.failed", name: "Pagamento Falhou", description: "Quando um pagamento falha" },
];

export default function WebhooksPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newWebhook, setNewWebhook] = useState({ name: "", url: "", events: [] as string[] });

  const { data: events = [] } = useQuery<SystemEvent[]>({
    queryKey: ["system-events"],
    queryFn: () => globalWebhooksApi.listEvents().then(r => r.data),
  });

  const { data: webhooks = [], isLoading } = useQuery<GlobalWebhook[]>({
    queryKey: ["global-webhooks"],
    queryFn: () => globalWebhooksApi.list().then(r => r.data),
  });

  const createMut = useMutation({
    mutationFn: () => globalWebhooksApi.create(newWebhook),
    onSuccess: (res) => {
      toast.success("Webhook criado! Secret: " + res.data.secret);
      setShowCreate(false);
      setNewWebhook({ name: "", url: "", events: [] });
      qc.invalidateQueries({ queryKey: ["global-webhooks"] });
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao criar"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => globalWebhooksApi.delete(id),
    onSuccess: () => {
      toast.success("Webhook deletado");
      qc.invalidateQueries({ queryKey: ["global-webhooks"] });
    },
    onError: () => toast.error("Erro ao deletar"),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => globalWebhooksApi.test(id),
    onSuccess: (res) => {
      if (res.data.success) {
        toast.success("Teste enviado com sucesso!");
      } else {
        toast.error("Teste falhou: " + res.data.message);
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "Erro ao testar"),
  });

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <a href="/settings" className="text-xs px-2 py-1.5 rounded-lg" style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 48)" }}>
            ← <span className="hidden sm:inline">Voltar</span>
          </a>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-3" style={{ color: "var(--text-1)" }}>
              <Webhook className="w-5 sm:w-6 h-5 sm:h-6" style={{ color: "#8b5cf6" }} />
              <span className="hidden sm:inline">Webhooks Globais</span>
              <span className="sm:hidden">Webhooks</span>
            </h1>
            <p className="text-sm mt-1 hidden sm:block" style={{ color: "var(--text-3)" }}>
              Receba eventos da plataforma (usuários, pagamentos, workspaces)
            </p>
          </div>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "#8b5cf6", color: "#fff" }}>
          <Plus className="w-4 h-4" />
          Novo Webhook
        </button>
      </div>

      {/* Event Available */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-2)" }}>
          Eventos Disponíveis
        </h2>
        <div className="flex flex-wrap gap-2">
          {SYSTEM_EVENTS.map(e => (
            <span key={e.id} className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
              {e.name}
            </span>
          ))}
        </div>
      </div>

      {/* Webhooks List */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: "var(--text-2)" }}>
          Meus Webhooks
        </h2>
        {isLoading ? (
          <div className="text-center py-8" style={{ color: "var(--text-3)" }}>Carregando...</div>
        ) : webhooks.length === 0 ? (
          <div className="rounded-2xl border border-dashed py-12 flex flex-col items-center gap-3"
            style={{ borderColor: "var(--surface-border)" }}>
            <Globe className="w-8 h-8" style={{ color: "var(--text-3)", opacity: 0.5 }} />
            <p className="text-sm" style={{ color: "var(--text-2)" }}>Nenhum webhook configurado</p>
            <p className="text-xs" style={{ color: "var(--text-3)" }}>Crie um para receber eventos do sistema</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map(wh => (
              <div key={wh.id} className="p-4 rounded-xl border"
                style={{ background: "var(--surface-2)", borderColor: "var(--surface-border)" }}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {wh.is_active ? (
                      <CheckCircle2 className="w-5 h-5" style={{ color: "#22c55e" }} />
                    ) : (
                      <XCircle className="w-5 h-5" style={{ color: "#ef4444" }} />
                    )}
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{wh.name}</p>
                      <p className="text-xs" style={{ color: "var(--text-3)" }}>{wh.url}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => testMut.mutate(wh.id)}
                      className="p-2 rounded-lg hover:bg-white/5"
                      style={{ color: "var(--text-2)" }}
                      title="Enviar teste">
                      <Play className="w-4 h-4" />
                    </button>
                    <button onClick={() => deleteMut.mutate(wh.id)}
                      className="p-2 rounded-lg hover:bg-white/5"
                      style={{ color: "#ef4444" }}
                      title="Deletar">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1 mt-3">
                  {wh.events.map(e => (
                    <span key={e} className="px-2 py-0.5 rounded text-[10px]"
                      style={{ background: "#8b5cf620", color: "#8b5cf6" }}>
                      {SYSTEM_EVENTS.find(se => se.id === e)?.name || e}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowCreate(false)}>
          <div className="w-[500px] p-6 rounded-2xl"
            style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
            onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4" style={{ color: "var(--text-1)" }}>
              Criar Webhook
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-2)" }}>Nome</label>
                <input value={newWebhook.name} onChange={e => setNewWebhook({...newWebhook, name: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
                  placeholder="Meu Webhook" />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: "var(--text-2)" }}>URL</label>
                <input value={newWebhook.url} onChange={e => setNewWebhook({...newWebhook, url: e.target.value})}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
                  placeholder="https://seu-site.com/webhook" />
              </div>
              <div>
                <label className="text-xs font-medium mb-2 block" style={{ color: "var(--text-2)" }}>Eventos</label>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                  {SYSTEM_EVENTS.map(e => (
                    <label key={e.id} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={newWebhook.events.includes(e.id)}
                        onChange={ev => {
                          if (ev.target.checked) {
                            setNewWebhook({...newWebhook, events: [...newWebhook.events, e.id]});
                          } else {
                            setNewWebhook({...newWebhook, events: newWebhook.events.filter(e2 => e2 !== e.id)});
                          }
                        }}
                        className="rounded" />
                      <span className="text-xs" style={{ color: "var(--text-2)" }}>{e.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreate(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                Cancelar
              </button>
              <button onClick={() => createMut.mutate()}
                disabled={!newWebhook.name || !newWebhook.url || newWebhook.events.length === 0}
                className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
                style={{ background: "#8b5cf6", color: "#fff" }}>
                Criar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}