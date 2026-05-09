"use client";

import { useParams, useRouter } from "next/navigation";
import { usePreferences } from "@/lib/preferences";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { campaignsApi } from "@/lib/api";
import { Campaign, CampaignRecipient } from "@/types";
import {
  ArrowLeft, Play, Pause, X, Trash2, Users, CheckCircle2,
  AlertCircle, Clock, Loader2, Calendar, MessageSquare,
  Timer, Users2, FileText, Image, Mic, File, FileVideo, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { showConfirm } from "@/lib/confirm";
import Link from "next/link";
import { cn } from "@/lib/utils";

function fmtDate(s: string) {
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}
function fmtDateTime(s: string) {
  const d = new Date(s);
  return `${fmtDate(s)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  draft:     { label: "Rascunho",  color: "#64748b", bg: "rgba(100,116,139,0.1)", icon: Clock },
  scheduled: { label: "Agendada",  color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: Calendar },
  running:   { label: "Executando",color: "#00d46a", bg: "rgba(0,212,106,0.1)",   icon: Loader2 },
  paused:    { label: "Pausada",   color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: Pause },
  completed: { label: "Concluída", color: "#00d46a", bg: "rgba(0,212,106,0.1)",   icon: CheckCircle2 },
  failed:    { label: "Cancelada", color: "#ef4444", bg: "rgba(239,68,68,0.1)",   icon: AlertCircle },
};

const RECIPIENT_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Pendente", color: "#64748b" },
  sent:    { label: "Enviado",  color: "#00d46a" },
  failed:  { label: "Falhou",   color: "#ef4444" },
};

const MSG_ICON: Record<string, React.ElementType> = {
  text: FileText, image: Image, video: FileVideo, audio: Mic, document: File,
};

function StatCard({ label, value, sub, color }: { label: string; value: number; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl p-4" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
      <p className="text-xs mb-1" style={{ color: "hsl(240 8% 46%)" }}>{label}</p>
      <p className="text-2xl font-semibold" style={{ color: color || "hsl(240 15% 93%)" }}>{value}</p>
      {sub && <p className="text-[11px] mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>{sub}</p>}
    </div>
  );
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { timezone } = usePreferences();

  const { data: campaign, isLoading } = useQuery<Campaign>({
    queryKey: ["campaign", id],
    queryFn: () => campaignsApi.get(id).then((r) => r.data),
    refetchInterval: (data) =>
      data?.state?.data?.status === "running" ? 3000 : 10000,
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-48 rounded-xl" />
        <div className="skeleton h-32 rounded-2xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="text-center py-20">
        <p style={{ color: "hsl(240 8% 46%)" }}>Campanha não encontrada</p>
        <Link href="/campaigns" className="text-sm mt-2 inline-block" style={{ color: "var(--green)" }}>
          Voltar
        </Link>
      </div>
    );
  }

  const s = STATUS_MAP[campaign.status] ?? STATUS_MAP.draft;
  const StatusIcon = s.icon;
  const progress = campaign.total_count > 0
    ? Math.round(((campaign.sent_count + campaign.failed_count) / campaign.total_count) * 100)
    : 0;

  const handleStart = async () => {
    try {
      await campaignsApi.start(id);
      toast.success("Campanha iniciada!");
      queryClient.invalidateQueries({ queryKey: ["campaign", id] });
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
    } catch (e: unknown) {
      toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao iniciar");
    }
  };

  const handlePause = async () => {
    try {
      await campaignsApi.pause(id);
      toast.success("Campanha pausada");
      queryClient.invalidateQueries({ queryKey: ["campaign", id] });
    } catch {
      toast.error("Erro ao pausar");
    }
  };

  const handleCancel = async () => {
    if (!await showConfirm("A campanha será cancelada e não poderá ser retomada.", { title: "Cancelar campanha", confirmLabel: "Cancelar campanha" })) return;
    try {
      await campaignsApi.cancel(id);
      toast.success("Campanha cancelada");
      queryClient.invalidateQueries({ queryKey: ["campaign", id] });
    } catch {
      toast.error("Erro ao cancelar");
    }
  };

  const handleDelete = async () => {
    if (!await showConfirm("Deletar esta campanha permanentemente? Esta ação é irreversível.", { title: "Deletar campanha", confirmLabel: "Deletar" })) return;
    try {
      await campaignsApi.delete(id);
      toast.success("Campanha removida");
      router.push("/campaigns");
    } catch {
      toast.error("Erro ao remover");
    }
  };

  const recipients: CampaignRecipient[] = campaign.recipients ?? [];

  return (
    <div className="space-y-6">
      {/* Back + Title */}
      <div className="flex items-center gap-3">
        <Link href="/campaigns"
          className="p-2 rounded-xl transition-all"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "hsl(240 8% 46%)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 15% 90%)")}
          onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 46%)")}
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
              {campaign.name}
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
              style={{ background: s.bg, color: s.color }}>
              <StatusIcon className={cn("w-3 h-3", campaign.status === "running" && "animate-spin")} />
              {s.label}
            </span>
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex gap-2">
          {(campaign.status === "draft" || campaign.status === "paused") && (
            <button onClick={handleStart}
              className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-xl transition-all"
              style={{ background: "var(--green)", color: "#03170a" }}>
              <Play className="w-3.5 h-3.5" />
              Iniciar
            </button>
          )}
          {campaign.status === "running" && (
            <button onClick={handlePause}
              className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-xl transition-all"
              style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", color: "#f59e0b" }}>
              <Pause className="w-3.5 h-3.5" />
              Pausar
            </button>
          )}
          {/* Diagnose + run-now: ajuda quando a campanha está em
              "scheduled" mas nada dispara — endpoint mostra cada
              filtro do scheduler e por que pulou. */}
          {["scheduled", "running"].includes(campaign.status) && (
            <CampaignDiagnoseButton campaignId={id} />
          )}
          {["scheduled", "running"].includes(campaign.status) && (
            <button onClick={async () => {
              try {
                await campaignsApi.runNow(id);
                toast.success("Tick disparado — verifique os destinatários em alguns segundos.");
                queryClient.invalidateQueries({ queryKey: ["campaign", id] });
              } catch (e: unknown) {
                const err = e as { response?: { data?: { error?: string; reason?: string } } };
                toast.error(err?.response?.data?.reason || err?.response?.data?.error || "Erro ao executar.");
              }
            }}
              className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-xl transition-all"
              style={{ background: "rgba(96,165,250,0.10)", border: "1px solid rgba(96,165,250,0.20)", color: "#60a5fa" }}>
              <Play className="w-3.5 h-3.5" />
              Executar agora
            </button>
          )}
          {["draft", "scheduled", "running", "paused"].includes(campaign.status) && (
            <button onClick={handleCancel}
              className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-xl transition-all"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: "#ef4444" }}>
              <X className="w-3.5 h-3.5" />
              Cancelar
            </button>
          )}
          <button onClick={handleDelete}
            className="p-2 rounded-xl transition-all"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "#64748b" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)"; (e.currentTarget as HTMLElement).style.color = "#ef4444"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLElement).style.color = "#64748b"; }}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={campaign.total_count} />
        <StatCard label="Enviados" value={campaign.sent_count} color="var(--green)" />
        <StatCard label="Falhos" value={campaign.failed_count} color={campaign.failed_count > 0 ? "#ef4444" : undefined} />
        <StatCard label="Pendentes" value={campaign.total_count - campaign.sent_count - campaign.failed_count} />
      </div>

      {/* Progress bar */}
      <div className="rounded-2xl p-5" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
        <div className="flex justify-between items-center mb-3">
          <p className="text-sm font-medium" style={{ color: "hsl(240 15% 90%)" }}>Progresso</p>
          <span className="text-sm font-semibold" style={{ color: "var(--green)" }}>{progress}%</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: "hsl(240 12% 12%)" }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${progress}%`,
              background: campaign.failed_count > campaign.sent_count
                ? "linear-gradient(90deg, #ef4444, #f59e0b)"
                : "linear-gradient(90deg, var(--green), #00a854)",
            }} />
        </div>

        {/* Message + schedule info */}
        <div className="mt-4 pt-4 border-t space-y-3" style={{ borderColor: "hsl(240 12% 11%)" }}>
          <div className="flex items-start gap-3">
            {(() => { const MsgIcon = MSG_ICON[campaign.message_type] ?? MessageSquare; return <MsgIcon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }} />; })()}
            <div className="flex-1 min-w-0">
              <p className="text-xs mb-1" style={{ color: "hsl(240 8% 46%)" }}>
                Mensagem · {campaign.message_type}
                {campaign.recipient_type === "groups" && (
                  <span className="ml-2 inline-flex items-center gap-1" style={{ color: "#a78bfa" }}>
                    <Users2 className="w-3 h-3" /> grupos
                  </span>
                )}
              </p>
              <p className="text-sm" style={{ color: "hsl(240 15% 80%)" }}>
                {campaign.caption || campaign.message_text || <span style={{ color: "hsl(240 8% 36%)" }}>(mídia)</span>}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-1.5">
              <Timer className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 38%)" }} />
              <span className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>Intervalo: {campaign.delay_seconds}s</span>
            </div>
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 38%)" }} />
              <span className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>
                {campaign.times_total}× total · {campaign.times_per_day}×/dia
              </span>
            </div>
            {campaign.start_date && (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 38%)" }} />
                <span className="text-xs" style={{ color: "hsl(240 8% 46%)" }}>
                  {fmtDate(campaign.start_date)}
                  {campaign.end_date && ` → ${fmtDate(campaign.end_date)}`}
                </span>
              </div>
            )}
            {(() => {
              try {
                const hours: number[] = JSON.parse(campaign.schedule_hours ?? "[]");
                if (hours.length > 0) return (
                  <span className="text-xs font-mono" style={{ color: "hsl(240 8% 46%)" }}>
                    ⏰ {hours.map((h) => `${h}h`).join(" ")}
                  </span>
                );
              } catch { /* noop */ }
              return null;
            })()}
            {(campaign.start_date || campaign.schedule_hours) && (
              <span className="text-[10px] px-2 py-0.5 rounded-lg font-mono flex items-center gap-1"
                style={{ background: "rgba(96,165,250,0.08)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.15)" }}>
                🕐 {campaign.time_zone || timezone}
                {campaign.time_zone && campaign.time_zone !== timezone && (
                  <span className="opacity-60">(disparo)</span>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Recipients table */}
      <div>
        <h2 className="text-sm font-medium mb-3" style={{ color: "hsl(240 15% 90%)" }}>
          Destinatários ({recipients.length})
        </h2>
        <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
          {/* Header */}
          <div className="grid grid-cols-[1fr_80px_60px_auto] gap-4 px-5 py-2.5 text-[11px] font-medium uppercase tracking-widest"
            style={{ background: "var(--surface-2)", borderBottom: "1px solid hsl(240 12% 11%)", color: "hsl(240 8% 40%)" }}>
            <span>Destinatário</span>
            <span>Status</span>
            <span>Envios</span>
            <span>Último</span>
          </div>

          {recipients.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: "hsl(240 8% 38%)" }}>
              Nenhum destinatário
            </p>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              {recipients.map((r, i) => {
                const rs = RECIPIENT_STATUS[r.status] ?? RECIPIENT_STATUS.pending;
                // Pra grupos (JID @g.us) e contatos (@s.whatsapp.net),
                // o nome vai em destaque e o JID/phone fica como
                // metadata pequena. Antes o phone vinha grande e o
                // nome (que existia) ficava em chip secundário —
                // user via "558587808924-1508601567@g.us" sem saber
                // qual grupo era.
                const isJID = r.phone.includes("@");
                const primary = r.name?.trim() || (isJID ? r.phone.split("@")[0] : r.phone);
                const secondary = r.name?.trim() ? r.phone : "";
                return (
                  <div
                    key={r.id}
                    className="grid grid-cols-[1fr_80px_60px_auto] gap-4 px-5 py-3 transition-colors hover:bg-white/[0.015]"
                    style={{ borderTop: i > 0 ? "1px solid hsl(240 12% 10%)" : undefined }}
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate flex items-center gap-1.5" style={{ color: "hsl(240 15% 88%)" }}>
                        {isJID && r.phone.endsWith("@g.us") && (
                          <Users className="w-3 h-3 flex-shrink-0" style={{ color: "#a78bfa" }} />
                        )}
                        {primary}
                      </p>
                      {secondary && (
                        <p className="text-[10px] font-mono mt-0.5 truncate" style={{ color: "hsl(240 8% 38%)" }}>
                          {secondary}
                        </p>
                      )}
                      {r.error && <p className="text-[10px] mt-0.5 truncate" style={{ color: "#f87171" }} title={r.error}>{r.error}</p>}
                    </div>
                    <div className="flex items-center">
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-lg"
                        style={{ background: rs.color + "18", color: rs.color }}>
                        {rs.label}
                      </span>
                    </div>
                    <span className="text-xs self-center font-mono" style={{ color: "hsl(240 8% 46%)" }}>
                      {r.send_count ?? 0}
                    </span>
                    <span className="text-xs self-center" style={{ color: "hsl(240 8% 38%)" }}>
                      {r.sent_at ? fmtDateTime(r.sent_at) : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CampaignDiagnoseButton({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{
    name: string; would_run: boolean; checks: Array<{ check: string; ok: boolean; detail: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const res = await campaignsApi.diagnose(campaignId);
      setData(res.data);
      setOpen(true);
    } catch {
      toast.error("Falha ao diagnosticar.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button onClick={run} disabled={loading}
        className="flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-xl transition-all disabled:opacity-60"
        style={{ background: "rgba(168,139,250,0.10)", border: "1px solid rgba(168,139,250,0.20)", color: "#a78bfa" }}
        title="Por que a campanha não está disparando?">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
        Diagnosticar
      </button>

      {open && data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg rounded-2xl p-5 max-h-[85vh] overflow-y-auto"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-base font-semibold" style={{ color: "var(--text-1)" }}>Diagnóstico do scheduler</h3>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>{data.name}</p>
              </div>
              <span className="px-2 py-1 rounded-lg text-[11px] font-semibold"
                style={data.would_run
                  ? { background: "rgba(0,212,106,0.10)", color: "#00d46a", border: "1px solid rgba(0,212,106,0.25)" }
                  : { background: "rgba(248,113,113,0.10)", color: "#f87171", border: "1px solid rgba(248,113,113,0.25)" }}>
                {data.would_run ? "Pronta pra rodar" : "Bloqueada"}
              </span>
            </div>
            <div className="space-y-2 mt-4">
              {data.checks.map((ck) => (
                <div key={ck.check} className="flex items-start gap-2.5 px-3 py-2 rounded-lg"
                  style={{ background: ck.ok ? "rgba(0,212,106,0.04)" : "rgba(248,113,113,0.04)",
                          border: `1px solid ${ck.ok ? "rgba(0,212,106,0.15)" : "rgba(248,113,113,0.20)"}` }}>
                  <span className="text-sm flex-shrink-0 mt-0.5" style={{ color: ck.ok ? "#00d46a" : "#f87171" }}>
                    {ck.ok ? "✓" : "✗"}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium" style={{ color: "var(--text-2)" }}>{ck.check}</p>
                    <p className="text-[11px] mt-0.5 break-words" style={{ color: "var(--text-3)" }}>{ck.detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-5">
              <button onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-xl text-sm" style={{ color: "var(--text-2)" }}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
