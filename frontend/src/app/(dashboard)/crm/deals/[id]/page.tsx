"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DealTasksMeetings } from "@/components/crm/DealTasksMeetings";
import {
  ArrowLeft, Check, X, RotateCcw, Briefcase, Building2, User as UserIcon,
  Calendar, DollarSign, Tag as TagIcon, StickyNote, Send, ChevronDown,
} from "lucide-react";
import { dealsApi, crmApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import {
  formatCurrency, relativeTime, uniq, statusColor, statusLabel, cardStyle,
} from "@/components/crm/tokens";

interface Deal {
  id: string;
  title: string;
  description?: string;
  value: number;
  currency: string;
  probability?: number | null;
  status: string;
  funnel_id: string;
  stage_id: string;
  contact_id: string;
  company_id?: string | null;
  conversation_id?: string | null;
  owner?: { id: string; name: string; email: string } | null;
  contact?: { id: string; name: string; phone?: string; email?: string; avatar_url?: string } | null;
  company?: { id: string; name: string; logo_url?: string } | null;
  stage_change_at?: string | null;
  won_at?: string | null;
  lost_at?: string | null;
  lost_reason?: string;
  expected_close_date?: string | null;
  created_at: string;
  priority: string;
}

interface Stage {
  id: string;
  name: string;
  order: number;
  probability: number;
  is_won: boolean;
  is_lost: boolean;
}

interface TimelineItem {
  id: string;
  type: string;
  title?: string;
  body?: string;
  payload?: string;
  created_at: string;
  actor_user_id?: string;
}

export default function DealDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;

  const canView = hasPerm(PERM.dealsView) || hasPerm(PERM.crmView);
  const canEdit = hasPerm(PERM.dealsEdit);
  const canMove = hasPerm(PERM.dealsMoveStage) || canEdit;

  const dealQ = useQuery({
    queryKey: ["deal", wsId, id],
    queryFn: () => dealsApi.get(wsId as string, id).then((r) => r.data as Deal),
    enabled: !!wsId && canView,
    refetchInterval: 20_000,
  });

  const stagesQ = useQuery({
    queryKey: ["funnel-stages", dealQ.data?.funnel_id],
    queryFn: () =>
      crmApi.listFunnelStages(dealQ.data!.funnel_id).then((r) => {
        const raw = r.data as { items?: Stage[] } | Stage[];
        return Array.isArray(raw) ? raw : raw.items ?? [];
      }),
    enabled: !!dealQ.data?.funnel_id,
  });

  const timelineQ = useQuery({
    queryKey: ["deal-timeline", wsId, id],
    queryFn: () =>
      dealsApi.timeline(wsId as string, id).then((r) => (r.data as { items: TimelineItem[] }).items),
    enabled: !!wsId && canView,
    refetchInterval: 15_000,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["deal", wsId, id] });
    qc.invalidateQueries({ queryKey: ["deal-timeline", wsId, id] });
    qc.invalidateQueries({ queryKey: ["deals", wsId] });
  };

  const move = useMutation({
    mutationFn: (stageId: string) => dealsApi.move(wsId as string, id, stageId),
    onSuccess: () => { toast.success("Estágio alterado"); refresh(); },
    onError: () => toast.error("Falha ao mover"),
  });

  const winDeal = useMutation({
    mutationFn: () => dealsApi.win(wsId as string, id),
    onSuccess: () => { toast.success("🎉 Deal ganho!"); refresh(); },
  });

  const loseDeal = useMutation({
    mutationFn: (reason: string) => dealsApi.lose(wsId as string, id, reason),
    onSuccess: () => { toast.success("Deal marcado como perdido"); refresh(); },
  });

  const reopen = useMutation({
    mutationFn: () => dealsApi.reopen(wsId as string, id),
    onSuccess: () => { toast.success("Deal reaberto"); refresh(); },
  });

  const [noteBody, setNoteBody] = useState("");
  const addNote = useMutation({
    mutationFn: () => dealsApi.addNote(wsId as string, id, noteBody.trim()),
    onSuccess: () => {
      toast.success("Nota adicionada");
      setNoteBody("");
      qc.invalidateQueries({ queryKey: ["deal-timeline", wsId, id] });
    },
  });

  if (!wsId || permsLoading) return <div className="p-6" style={{ color: uniq.textDim }}>Carregando…</div>;
  if (!canView) {
    return <div className="p-6 text-sm" style={{ color: uniq.textDim }}>Sem permissão.</div>;
  }

  const deal = dealQ.data;
  if (!deal) return <div className="p-6" style={{ color: uniq.textDim }}>Carregando deal…</div>;

  const currentStage = stagesQ.data?.find((s) => s.id === deal.stage_id);
  const sortedStages = [...(stagesQ.data ?? [])].sort((a, b) => a.order - b.order);

  return (
    <div className="flex h-full min-h-0">
      {/* Main column */}
      <section className="flex flex-1 min-w-0 flex-col">
        <header
          className="flex items-center gap-3 border-b px-5 py-3"
          style={{ borderColor: uniq.borderSoft }}
        >
          <Link
            href="/crm/deals"
            className="rounded-md p-1.5 transition-opacity hover:opacity-70"
            style={{ color: uniq.textFaint }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Briefcase className="h-4 w-4" style={{ color: uniq.textFaint }} />
              <h1 className="truncate text-base font-medium" style={{ color: uniq.textStrong }}>
                {deal.title}
              </h1>
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: statusColor(deal.status) + "22", color: statusColor(deal.status) }}
              >
                {statusLabel(deal.status)}
              </span>
            </div>
            <p className="truncate text-xs" style={{ color: uniq.textFaint }}>
              Criado {relativeTime(deal.created_at)} · Estágio atual: {currentStage?.name ?? "—"}
            </p>
          </div>
        </header>

        {/* Pipeline stepper */}
        {deal.status === "open" && (
          <div className="border-b px-5 py-3" style={{ borderColor: uniq.borderSoft }}>
            <StageStepper
              stages={sortedStages}
              currentStageId={deal.stage_id}
              disabled={!canMove}
              onSelect={(sid) => sid !== deal.stage_id && move.mutate(sid)}
            />
          </div>
        )}

        {/* Deal summary strip */}
        <div
          className="grid grid-cols-4 gap-3 border-b p-5"
          style={{ borderColor: uniq.borderSoft, background: uniq.bgElevated }}
        >
          <SummaryTile
            label="Valor"
            value={formatCurrency(deal.value, deal.currency)}
            accent={uniq.green}
            icon={<DollarSign className="h-3.5 w-3.5" />}
          />
          <SummaryTile
            label="Probabilidade"
            value={deal.probability != null ? `${deal.probability}%` : "—"}
            accent={uniq.statusOpen}
          />
          <SummaryTile
            label="Prev. fechamento"
            value={
              deal.expected_close_date
                ? new Date(deal.expected_close_date).toLocaleDateString("pt-BR")
                : "—"
            }
          />
          <SummaryTile
            label="Dono"
            value={deal.owner?.name ?? "Sem dono"}
          />
        </div>

        {/* Timeline + note composer */}
        <div className="flex-1 overflow-auto p-5">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest" style={{ color: uniq.textFaint }}>
            Linha do tempo
          </h2>

          {canEdit && (
            <div
              className="mb-4 rounded-xl p-3"
              style={{ ...cardStyle }}
            >
              <textarea
                rows={2}
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="Registrar nota rápida sobre este deal…"
                className="w-full resize-y bg-transparent text-sm outline-none"
                style={{ color: uniq.textPrimary }}
              />
              <div className="mt-2 flex justify-end">
                <button
                  onClick={() => addNote.mutate()}
                  disabled={!noteBody.trim() || addNote.isPending}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50"
                  style={{ background: uniq.green, color: "#03170a" }}
                >
                  <Send className="h-3 w-3" />
                  Adicionar nota
                </button>
              </div>
            </div>
          )}

          <ol className="space-y-2">
            {(timelineQ.data ?? []).map((e) => (
              <TimelineItemRow key={e.id} item={e} />
            ))}
            {(timelineQ.data?.length ?? 0) === 0 && (
              <li className="text-xs" style={{ color: uniq.textFaint }}>
                Sem atividades ainda.
              </li>
            )}
          </ol>
        </div>
      </section>

      {/* Sidebar */}
      <aside
        className="hidden w-80 flex-col border-l lg:flex overflow-y-auto"
        style={{ borderColor: uniq.borderSoft, background: uniq.bgElevated }}
      >
        {/* Tarefas e reuniões deste deal — embed inline com create rápido */}
        <div className="border-b p-5 space-y-3" style={{ borderColor: uniq.borderSoft }}>
          <DealTasksMeetings
            workspaceId={(wsId as string) || ""}
            dealId={id}
            contactId={deal.contact?.id}
          />
        </div>
        <div className="border-b p-5" style={{ borderColor: uniq.borderSoft }}>
          <SidebarSectionLabel>Contato</SidebarSectionLabel>
          {deal.contact ? (
            <Link
              href={`/crm/contacts/${deal.contact.id}`}
              className="mt-1 flex items-center gap-2 rounded-lg p-2 transition-colors hover:bg-white/5"
            >
              <UserIcon className="h-4 w-4" style={{ color: uniq.textFaint }} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium" style={{ color: uniq.textPrimary }}>
                  {deal.contact.name}
                </div>
                <div className="truncate text-xs" style={{ color: uniq.textFaint }}>
                  {deal.contact.phone || deal.contact.email || "—"}
                </div>
              </div>
            </Link>
          ) : (
            <p className="mt-1 text-xs" style={{ color: uniq.textFaint }}>Sem contato vinculado.</p>
          )}
        </div>

        <div className="border-b p-5" style={{ borderColor: uniq.borderSoft }}>
          <SidebarSectionLabel>Empresa</SidebarSectionLabel>
          {deal.company ? (
            <Link
              href={`/crm/companies/${deal.company.id}`}
              className="mt-1 flex items-center gap-2 rounded-lg p-2 transition-colors hover:bg-white/5"
            >
              <Building2 className="h-4 w-4" style={{ color: uniq.textFaint }} />
              <span className="truncate text-sm" style={{ color: uniq.textPrimary }}>
                {deal.company.name}
              </span>
            </Link>
          ) : (
            <p className="mt-1 text-xs" style={{ color: uniq.textFaint }}>Nenhuma empresa vinculada.</p>
          )}
        </div>

        {deal.conversation_id && (
          <div className="border-b p-5" style={{ borderColor: uniq.borderSoft }}>
            <SidebarSectionLabel>Atendimento vinculado</SidebarSectionLabel>
            <Link
              href={`/inbox/${deal.conversation_id}`}
              className="mt-1 flex items-center gap-2 rounded-lg p-2 text-xs transition-colors hover:bg-white/5"
              style={{ color: uniq.textDim }}
            >
              Abrir conversa →
            </Link>
          </div>
        )}

        <div className="space-y-1 p-3">
          {deal.status === "open" && canEdit && (
            <>
              <ActionBtn onClick={() => winDeal.mutate()} tone="win" icon={<Check className="h-4 w-4" />}>
                Marcar como ganho
              </ActionBtn>
              <ActionBtn
                onClick={() => {
                  const reason = prompt("Motivo da perda (opcional)") ?? "";
                  loseDeal.mutate(reason);
                }}
                tone="lose"
                icon={<X className="h-4 w-4" />}
              >
                Marcar como perdido
              </ActionBtn>
            </>
          )}
          {(deal.status === "won" || deal.status === "lost") && canEdit && (
            <ActionBtn onClick={() => reopen.mutate()} icon={<RotateCcw className="h-4 w-4" />}>
              Reabrir deal
            </ActionBtn>
          )}
        </div>

        {deal.lost_reason && (
          <div className="p-5">
            <SidebarSectionLabel>Motivo da perda</SidebarSectionLabel>
            <p className="mt-1 text-xs" style={{ color: uniq.textDim }}>{deal.lost_reason}</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function StageStepper({ stages, currentStageId, onSelect, disabled }: {
  stages: Stage[];
  currentStageId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const currentIdx = stages.findIndex((s) => s.id === currentStageId);
  return (
    <div className="flex items-center gap-0.5 overflow-x-auto">
      {stages.map((s, i) => {
        const reached = i <= currentIdx;
        const isCurrent = s.id === currentStageId;
        const chipColor =
          s.is_won ? uniq.statusWon
          : s.is_lost ? uniq.statusLost
          : reached ? uniq.green : uniq.textFaint;
        return (
          <button
            key={s.id}
            disabled={disabled}
            onClick={() => onSelect(s.id)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-[11px] font-medium transition-all disabled:cursor-default"
            style={{
              background: isCurrent ? "rgba(0,212,106,0.1)" : "transparent",
              color: chipColor,
              border: `1px solid ${isCurrent ? "rgba(0,212,106,0.25)" : "transparent"}`,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: chipColor }}
            />
            {s.name}
          </button>
        );
      })}
    </div>
  );
}

function SummaryTile({ label, value, accent, icon }: {
  label: string;
  value: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl p-3"
      style={{ background: uniq.panel, border: `1px solid ${uniq.borderFaint}` }}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest" style={{ color: uniq.textFaint }}>
        {icon}
        {label}
      </div>
      <div
        className="mt-1 text-sm font-medium"
        style={{ color: accent ?? uniq.textPrimary }}
      >
        {value}
      </div>
    </div>
  );
}

function SidebarSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-medium uppercase tracking-widest" style={{ color: uniq.textFaint }}>
      {children}
    </div>
  );
}

function ActionBtn({ children, onClick, tone, icon }: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "win" | "lose";
  icon?: React.ReactNode;
}) {
  const cls =
    tone === "win" ? { color: uniq.statusWon, bg: "rgba(16,185,129,0.08)" }
    : tone === "lose" ? { color: uniq.statusLost, bg: "rgba(239,68,68,0.08)" }
    : { color: uniq.textDim, bg: "var(--surface-2)" };
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors"
      style={{ color: cls.color, background: cls.bg }}
    >
      {icon}
      {children}
    </button>
  );
}

function TimelineItemRow({ item }: { item: TimelineItem }) {
  const label = LABELS[item.type] ?? item.type;
  const body = item.body || parseBody(item.payload);
  return (
    <li
      className="rounded-xl p-3"
      style={cardStyle}
    >
      <div className="flex items-center justify-between text-[10px]" style={{ color: uniq.textFaint }}>
        <span className="rounded-full px-1.5 py-0.5" style={{ background: "var(--surface-2)", color: uniq.textDim }}>
          {label}
        </span>
        <span>{relativeTime(item.created_at)}</span>
      </div>
      {item.title && (
        <div className="mt-1 text-sm font-medium" style={{ color: uniq.textPrimary }}>
          {item.title}
        </div>
      )}
      {body && (
        <p className="mt-1 whitespace-pre-wrap text-xs" style={{ color: uniq.textDim }}>
          {body}
        </p>
      )}
    </li>
  );
}

const LABELS: Record<string, string> = {
  created: "Criado",
  stage_changed: "Estágio alterado",
  value_changed: "Valor atualizado",
  owner_changed: "Dono alterado",
  won: "🎉 Ganho",
  lost: "Perdido",
  reopened: "Reaberto",
  note_added: "Nota interna",
  call_logged: "Ligação registrada",
  email_logged: "Email registrado",
  task_created: "Tarefa criada",
  contact_linked: "Contato vinculado",
  company_linked: "Empresa vinculada",
  tag_added: "Tag adicionada",
  tag_removed: "Tag removida",
};

function parseBody(payload?: string): string {
  if (!payload) return "";
  try {
    const p = JSON.parse(payload);
    if (typeof p === "string") return p;
    return "";
  } catch {
    return payload;
  }
}
