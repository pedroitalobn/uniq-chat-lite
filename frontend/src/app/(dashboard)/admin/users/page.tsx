"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { adminApi } from "@/lib/api";
import {
  Users, Shield, User as UserIcon, Trash2, Ban, CheckCircle2,
  Loader2, Plus, X, Eye, EyeOff, Clock, Search, RotateCcw,
  ChevronDown, Lock, Ticket,
} from "lucide-react";
import { toast } from "sonner";
import { showConfirm } from "@/lib/confirm";
import { cn } from "@/lib/utils";
import type { User, Plan } from "@/types";
import { useState, useEffect } from "react";

// ─── Create User Modal ────────────────────────────────────────────────────────
function CreateUserModal({ plans, onClose, onCreated }: {
  plans: Plan[]; onClose: () => void; onCreated: () => void;
}) {
  const [form, setForm] = useState({
    name: "", email: "", username: "", password: "", role: "customer", plan_id: "",
  });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.password) {
      setError("Name, email e password são obrigatórios");
      return;
    }
    if (form.password.length < 8) {
      setError("Senha deve ter ao menos 8 caracteres");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await adminApi.createUser({
        name: form.name, email: form.email,
        username: form.username || undefined,
        password: form.password,
        role: form.role,
        plan_id: form.plan_id || undefined,
      });
      toast.success("Customer criado com sucesso!");
      onCreated();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar usuário";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const f = (key: string) => (v: string) => setForm(p => ({ ...p, [key]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl p-6 animate-fade-in-up"
        style={{ background: "hsl(240 18% 6%)", boxShadow: "0 0 0 1px hsl(240 12% 14%), 0 32px 80px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <Plus className="w-4 h-4" style={{ color: "var(--green)" }} />
            </div>
            <h2 className="text-base font-semibold" style={{ color: "hsl(240 15% 93%)" }}>Novo usuário</h2>
          </div>
          <button onClick={onClose} style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-xl px-3.5 py-2.5 text-xs text-red-400"
            style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.18)" }}>
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <LabelInput label="Nome *" value={form.name} onChange={f("name")} placeholder="João Silva" />
            <LabelInput label="Username" value={form.username} onChange={f("username")} placeholder="@joao" />
          </div>
          <LabelInput label="Email *" value={form.email} onChange={f("email")} placeholder="joao@empresa.com" type="email" />
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>Senha *</label>
            <div className="relative">
              <input value={form.password} onChange={e => f("password")(e.target.value)}
                type={showPass ? "text" : "password"} placeholder="Mínimo 8 caracteres"
                className="input-field w-full pr-10" />
              <button type="button" onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(240 8% 38%)" }}>
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>Role</label>
              <select value={form.role} onChange={e => f("role")(e.target.value)} className="input-field w-full">
                <option value="customer">Customer</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>Plano</label>
              <select value={form.plan_id} onChange={e => f("plan_id")(e.target.value)} className="input-field w-full">
                <option value="">Auto (Free)</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">Cancelar</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-40">
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Criar usuário"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Reset Password Modal ─────────────────────────────────────────────────────
function ResetPasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error("Mínimo 8 caracteres"); return; }
    setLoading(true);
    try {
      await adminApi.resetPassword(user.id, password);
      toast.success("Senha redefinida com sucesso!");
      onClose();
    } catch {
      toast.error("Erro ao redefinir senha");
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl p-6 animate-fade-in-up"
        style={{ background: "hsl(240 18% 6%)", boxShadow: "0 0 0 1px hsl(240 12% 14%), 0 24px 64px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.18)" }}>
            <Lock className="w-4 h-4" style={{ color: "#fbbf24" }} />
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 93%)" }}>Redefinir senha</h2>
            <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>{user.email}</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="relative">
            <input value={password} onChange={e => setPassword(e.target.value)}
              type={show ? "text" : "password"} placeholder="Nova senha (mín. 8 chars)"
              className="input-field w-full pr-10" autoFocus />
            <button type="button" onClick={() => setShow(!show)}
              className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(240 8% 38%)" }}>
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">Cancelar</button>
            <button type="submit" disabled={loading || password.length < 8}
              className="flex-1 py-2.5 text-sm rounded-xl font-semibold transition-all disabled:opacity-40"
              style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Redefinir"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Block Modal ──────────────────────────────────────────────────────────────
function BlockModal({ user, onClose, onConfirm }: {
  user: User; onClose: () => void; onConfirm: (until: string | null) => void;
}) {
  const [type, setType] = useState<"perm" | "temp">("temp");
  const [days, setDays] = useState("7");

  const confirm = () => {
    if (type === "perm") {
      onConfirm(null); // is_active = false
    } else {
      const d = parseInt(days) || 7;
      const until = new Date(Date.now() + d * 86400000).toISOString();
      onConfirm(until);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl p-6 animate-fade-in-up"
        style={{ background: "hsl(240 18% 6%)", boxShadow: "0 0 0 1px hsl(240 12% 14%), 0 24px 64px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.18)" }}>
            <Ban className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 93%)" }}>Bloquear usuário</h2>
            <p className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>{user.email}</p>
          </div>
        </div>

        <div className="space-y-3 mb-5">
          {(["temp", "perm"] as const).map(t => (
            <button key={t} onClick={() => setType(t)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all"
              style={{
                background: type === t ? "rgba(239,68,68,0.06)" : "var(--surface-2)",
                border: type === t ? "1px solid rgba(239,68,68,0.2)" : "1px solid var(--border-default)",
              }}>
              <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                style={{ borderColor: type === t ? "#f87171" : "hsl(240 8% 30%)" }}>
                {type === t && <div className="w-2 h-2 rounded-full bg-red-400" />}
              </div>
              <div>
                <p className="text-xs font-medium" style={{ color: "hsl(240 15% 82%)" }}>
                  {t === "temp" ? "Bloqueio temporário" : "Bloquear permanentemente"}
                </p>
                <p className="text-[10px]" style={{ color: "hsl(240 8% 42%)" }}>
                  {t === "temp" ? "Define data de expiração automática" : "Requer reativação manual"}
                </p>
              </div>
            </button>
          ))}
          {type === "temp" && (
            <div className="flex items-center gap-2 px-1">
              <label className="text-xs" style={{ color: "hsl(240 8% 55%)" }}>Duração:</label>
              <select value={days} onChange={e => setDays(e.target.value)} className="input-field text-xs py-1.5">
                <option value="1">1 dia</option>
                <option value="3">3 dias</option>
                <option value="7">7 dias</option>
                <option value="14">14 dias</option>
                <option value="30">30 dias</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-ghost flex-1 py-2.5 text-sm">Cancelar</button>
          <button onClick={confirm}
            className="flex-1 py-2.5 text-sm rounded-xl font-semibold text-red-400 transition-all"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
            Bloquear
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function LabelInput({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} className="input-field w-full" />
    </div>
  );
}

function planBadge(plan?: Plan) {
  if (!plan) return { bg: "var(--surface-2)", color: "hsl(240 8% 46%)" };
  if (plan.name === "Enterprise") return { bg: "rgba(167,139,250,0.08)", color: "#a78bfa" };
  if (plan.name === "Pro") return { bg: "rgba(96,165,250,0.08)", color: "#60a5fa" };
  return { bg: "var(--surface-2)", color: "hsl(240 8% 46%)" };
}

// ─── Invite System Toggle ─────────────────────────────────────────────────────
function InviteSystemToggle() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "https://api.uniq.chat") + "/v1";

  useEffect(() => {
    fetch(`${API_BASE}/invites/status`)
      .then(r => r.json())
      .then(d => setEnabled(d.enabled))
      .catch(() => {});
  }, []);

  const toggle = async () => {
    setLoading(true);
    try {
      const { getSession } = await import("next-auth/react");
      const session = await getSession();
      const t = (session as unknown as { accessToken?: string })?.accessToken;
      const res = await fetch(`${API_BASE}/admin/invites/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const data = await res.json();
      if (res.ok) {
        setEnabled(data.enabled);
        toast.success(data.enabled ? "Sistema de convites ativado" : "Sistema de convites desativado");
      }
    } catch {
      toast.error("Erro ao alterar sistema de convites");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between px-5 py-4 rounded-2xl"
      style={{ background: "hsl(240 18% 6%)", border: `1px solid ${enabled ? "rgba(0,212,106,0.3)" : "hsl(240 12% 13%)"}` }}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center"
          style={{ background: enabled ? "rgba(0,212,106,0.1)" : "var(--surface-3)" }}>
          <Ticket className="w-5 h-5" style={{ color: enabled ? "var(--green)" : "hsl(240 8% 40%)" }} />
        </div>
        <div>
          <p className="text-sm font-semibold" style={{ color: "hsl(240 15% 92%)" }}>
            Sistema de Convites
          </p>
          <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 46%)" }}>
            {enabled
              ? "Cadastro apenas via código de convite"
              : "Cadastro liberado para todos"}
          </p>
        </div>
      </div>
      <button onClick={toggle} disabled={loading}
        className="relative w-12 h-7 rounded-full transition-all duration-200 disabled:opacity-50"
        style={{ background: enabled ? "var(--green)" : "hsl(240 12% 15%)" }}>
        <span className="absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all duration-200"
          style={{ left: enabled ? "26px" : "4px" }} />
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "super_admin";
  const [search, setSearch]       = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [resetUser, setResetUser]   = useState<User | null>(null);
  const [blockUser, setBlockUser]   = useState<User | null>(null);
  const [actionId, setActionId]     = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: users = [], isLoading } = useQuery<User[]>({
    queryKey: ["admin-users"],
    queryFn: () => adminApi.listUsers().then((r) => r.data),
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ["admin-plans"],
    queryFn: () => adminApi.listPlans().then((r) => r.data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      adminApi.updateUser(id, data),
    onSuccess: () => {
      toast.success("Customer atualizado");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setActionId(null);
    },
    onError: () => { toast.error("Erro ao atualizar"); setActionId(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteUser(id),
    onSuccess: () => {
      toast.success("Customer removido");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setActionId(null);
    },
    onError: () => { toast.error("Erro ao remover"); setActionId(null); },
  });

  const handleDelete = async (user: User) => {
    if (!await showConfirm(`Remover permanentemente o usuário "${user.email}"? Esta ação é irreversível.`, { title: "Remover usuário", confirmLabel: "Remover" })) return;
    setActionId(user.id);
    deleteMutation.mutate(user.id);
  };

  const handleUnblock = (user: User) => {
    setActionId(user.id);
    updateMutation.mutate({ id: user.id, data: { is_active: true, blocked_until: "null" } });
  };

  const handleBlock = (until: string | null) => {
    if (!blockUser) return;
    setActionId(blockUser.id);
    if (until === null) {
      updateMutation.mutate({ id: blockUser.id, data: { is_active: false } });
    } else {
      updateMutation.mutate({ id: blockUser.id, data: { blocked_until: until } });
    }
    setBlockUser(null);
  };

  const handlePlanChange = (user: User, planId: string) => {
    updateMutation.mutate({ id: user.id, data: { plan_id: planId } });
  };

  const handleRoleToggle = async (user: User) => {
    const newRole = user.role === "super_admin" ? "customer" : "super_admin";
    if (!await showConfirm(`Alterar o role de "${user.email}" para ${newRole}?`, { title: "Alterar permissão", confirmLabel: "Confirmar", danger: false })) return;
    updateMutation.mutate({ id: user.id, data: { role: newRole } });
  };

  const handleBetaToggle = async (user: User) => {
    if (!isSuperAdmin) return;
    const newBeta = !user.is_beta;
    if (!await showConfirm(`${newBeta ? "Liberar" : "Remover"} acesso beta de "${user.email}"?`, { title: "Acesso Beta", confirmLabel: "Confirmar", danger: false })) return;
    updateMutation.mutate({ id: user.id, data: { is_beta: newBeta } });
  };

  const filtered = users.filter(u =>
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    u.name.toLowerCase().includes(search.toLowerCase())
  );

  const isBlocked = (u: User) =>
    !u.is_active || (!!u.blocked_until && new Date(u.blocked_until) > new Date());

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>Customers</h1>
          <p className="text-sm mt-1" style={{ color: "hsl(240 8% 46%)" }}>
            {users.length} usuário{users.length !== 1 ? "s" : ""} cadastrado{users.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
            style={{ background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.15)" }}>
            <Shield className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />
            <span className="text-xs font-semibold hidden sm:inline" style={{ color: "#fbbf24" }}>Super Admin</span>
            <span className="text-xs font-semibold sm:hidden" style={{ color: "#fbbf24" }}>Admin</span>
          </div>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)", color: "var(--green)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,106,0.16)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,212,106,0.1)")}>
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Novo usuário</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(240 8% 36%)" }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome ou email..."
          className="input-field w-full pl-9" />
      </div>

      {/* Invite System Toggle */}
      <InviteSystemToggle />

      {/* Table */}
      <div className="rounded-2xl overflow-hidden animate-fade-in-up"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto] gap-4 px-5 py-3 text-[10px] font-semibold uppercase tracking-widest"
          style={{ color: "hsl(240 8% 36%)", borderBottom: "1px solid hsl(240 12% 10%)" }}>
          <span>Customer</span>
          <span className="text-center">Plano</span>
          <span className="text-center">Status</span>
          <span className="text-center">Role</span>
          <span className="text-center">Último Acesso</span>
          <span>Ações</span>
        </div>

        {isLoading ? (
          <div className="p-5 space-y-2">
            {[1,2,3].map(i => <div key={i} className="skeleton h-14 rounded-xl" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-3"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)" }}>
              <Users className="w-5 h-5" style={{ color: "hsl(240 8% 28%)" }} />
            </div>
            <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>
              {search ? "Nenhum usuário encontrado" : "Nenhum usuário cadastrado"}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map((user, i) => {
              const blocked = isBlocked(user);
              const isExpanded = expandedId === user.id;
              const isPending = actionId === user.id && updateMutation.isPending;

              return (
                <div key={user.id}>
                  <div
                    className={cn("grid gap-4 items-center px-5 py-3.5 transition-colors cursor-pointer",
                      blocked && "opacity-60")}
                    style={{ borderBottom: i < filtered.length - 1 || isExpanded ? "1px solid var(--border-default)" : undefined, gridTemplateColumns: "1fr auto auto auto auto auto" }}
                    onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "var(--surface-2)")}
                    onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "transparent")}
                    onClick={() => setExpandedId(isExpanded ? null : user.id)}
                  >
                    {/* User info */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-xl flex items-center justify-center border flex-shrink-0"
                        style={user.role === "super_admin" ? {
                          background: "rgba(251,191,36,0.08)", borderColor: "rgba(251,191,36,0.18)",
                        } : { background: "var(--surface-2)", borderColor: "var(--border-default)" }}>
                        {user.role === "super_admin"
                          ? <Shield className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />
                          : <UserIcon className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 42%)" }} />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" style={{ color: "hsl(240 15% 80%)" }}>
                          {user.name}
                          {user.is_beta && (
                            <span className="ml-2 text-xs font-medium px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400 border border-purple-500/20">
                              BETA
                            </span>
                          )}
                          {isSuperAdmin && user.role !== "super_admin" && !user.is_beta && (
                            <button
                              onClick={() => handleBetaToggle(user)}
                              className="ml-2 text-xs font-medium px-1.5 py-0.5 rounded bg-white/5 text-white/40 border border-white/10 hover:bg-white/10 hover:text-white/60 transition-colors"
                              title="Clique para dar acesso beta"
                            >
                              +BETA
                            </button>
                          )}
                        </p>
                        <p className="text-xs mt-0.5 truncate" style={{ color: "hsl(240 8% 40%)" }}>
                          {user.email}
                          {user.blocked_until && new Date(user.blocked_until) > new Date() && (
                            <span className="ml-2 text-amber-500/70">
                              até {new Date(user.blocked_until).toLocaleDateString("pt-BR")}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Plan */}
                    <div className="text-center">
                      <span className="text-xs font-medium px-2.5 py-1 rounded-lg"
                        style={planBadge(user.plan)}>
                        {user.plan?.name || "—"}
                      </span>
                    </div>

                    {/* Status */}
                    <div className="text-center">
                      <span className="text-xs font-medium px-2.5 py-1 rounded-lg"
                        style={blocked ? { background: "rgba(239,68,68,0.08)", color: "#f87171" }
                          : { background: "rgba(0,212,106,0.08)", color: "#00d46a" }}>
                        {blocked ? (user.blocked_until && new Date(user.blocked_until) > new Date() ? "Temp" : "Bloqueado") : "Ativo"}
                      </span>
                    </div>

                    {/* Role */}
                    <div className="text-center">
                      <span className="text-xs font-medium px-2.5 py-1 rounded-lg"
                        style={user.role === "super_admin"
                          ? { background: "rgba(251,191,36,0.08)", color: "#fbbf24" }
                          : { background: "var(--surface-2)", color: "hsl(240 8% 50%)" }}>
                        {user.role}
                      </span>
                    </div>

                    {/* Last Login */}
                    <div className="text-center">
                      <span className="text-xs" style={{ color: "hsl(240 8% 50%)" }}>
                        {user.last_login_at 
                          ? (() => {
                              const date = new Date(user.last_login_at);
                              const tz = user.timezone || "America/Sao_Paulo";
                              return date.toLocaleString("pt-BR", { 
                                timeZone: tz,
                                day: "2-digit", 
                                month: "2-digit",
                                hour: "2-digit",
                                minute: "2-digit"
                              });
                            })()
                          : "—"}
                      </span>
                    </div>

                    {/* Expand indicator */}
                    <div className="flex items-center justify-end">
                      {isPending
                        ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(240 8% 40%)" }} />
                        : <ChevronDown className={cn("w-4 h-4 transition-transform", isExpanded && "rotate-180")}
                            style={{ color: "hsl(240 8% 32%)" }} />
                      }
                    </div>
                  </div>

                  {/* Expanded actions */}
                  {isExpanded && (
                    <div className="px-5 py-3 flex items-center gap-2 flex-wrap"
                      style={{ background: "var(--surface-2)", borderBottom: i < filtered.length - 1 ? "1px solid var(--border-default)" : undefined }}>

                      {/* Plan change */}
                      <select
                        defaultValue={user.plan?.id || ""}
                        onChange={e => handlePlanChange(user, e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="text-xs rounded-lg px-2.5 py-1.5 outline-none"
                        style={{ background: "hsl(240 12% 9%)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 72%)" }}>
                        <option value="">Sem plano</option>
                        {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>

                      {/* Toggle role (non-self protection built in backend) */}
                      {user.role !== "super_admin" && (
                        <ActionBtn
                          icon={<Shield className="w-3.5 h-3.5" />}
                          label="Tornar Super Admin"
                          color="#fbbf24"
                          onClick={(e) => { e.stopPropagation(); handleRoleToggle(user); }}
                        />
                      )}
                      {user.role === "super_admin" && (
                        <ActionBtn
                          icon={<UserIcon className="w-3.5 h-3.5" />}
                          label="Rebaixar para User"
                          color="hsl(240 8% 55%)"
                          onClick={(e) => { e.stopPropagation(); handleRoleToggle(user); }}
                        />
                      )}

                      {/* Reset password */}
                      <ActionBtn
                        icon={<RotateCcw className="w-3.5 h-3.5" />}
                        label="Resetar senha"
                        color="#60a5fa"
                        onClick={(e) => { e.stopPropagation(); setResetUser(user); }}
                      />

                      {/* Block / Unblock */}
                      {blocked ? (
                        <ActionBtn
                          icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                          label="Desbloquear"
                          color="var(--green)"
                          onClick={(e) => { e.stopPropagation(); handleUnblock(user); }}
                        />
                      ) : (
                        <ActionBtn
                          icon={<Clock className="w-3.5 h-3.5" />}
                          label="Bloquear"
                          color="#f87171"
                          onClick={(e) => { e.stopPropagation(); setBlockUser(user); }}
                        />
                      )}

                      {/* Delete */}
                      {user.role !== "super_admin" && (
                        <ActionBtn
                          icon={<Trash2 className="w-3.5 h-3.5" />}
                          label="Remover"
                          color="#f87171"
                          danger
                          onClick={(e) => { e.stopPropagation(); handleDelete(user); }}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreate && (
        <CreateUserModal
          plans={plans}
          onClose={() => setShowCreate(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["admin-users"] })}
        />
      )}
      {resetUser && <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} />}
      {blockUser && <BlockModal user={blockUser} onClose={() => setBlockUser(null)} onConfirm={handleBlock} />}
    </div>
  );
}

function ActionBtn({ icon, label, color, danger, onClick }: {
  icon: React.ReactNode; label: string; color: string; danger?: boolean; onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
      style={{
        background: danger ? "rgba(239,68,68,0.06)" : "var(--surface-2)",
        border: `1px solid ${danger ? "rgba(239,68,68,0.15)" : "var(--border-default)"}`,
        color,
      }}
      onMouseEnter={e => (e.currentTarget.style.opacity = "0.8")}
      onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>
      {icon}{label}
    </button>
  );
}
