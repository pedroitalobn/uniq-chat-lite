"use client";

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { campaignsApi, instancesApi, groupsApi, wabaApi } from "@/lib/api";
import { Campaign, Instance } from "@/types";
import {
  Plus, Megaphone, Play, Pause, X, Trash2, Clock, CheckCircle2,
  AlertCircle, Loader2, Users, Calendar, FileText, Image, Mic,
  File, ChevronLeft, ChevronRight, Users2, Database, UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { showConfirm } from "@/lib/confirm";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { usePreferences } from "@/lib/preferences";
import { useWorkspace } from "@/contexts/WorkspaceContext";

function fmtDate(s: string) {
  const d = new Date(s);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// ─── Status config ─────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  draft:     { label: "Rascunho",   color: "#64748b", bg: "rgba(100,116,139,0.1)", icon: Clock },
  scheduled: { label: "Agendada",   color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: Calendar },
  running:   { label: "Executando", color: "#00d46a", bg: "rgba(0,212,106,0.1)",   icon: Loader2 },
  paused:    { label: "Pausada",    color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: Pause },
  completed: { label: "Concluída",  color: "#00d46a", bg: "rgba(0,212,106,0.1)",   icon: CheckCircle2 },
  failed:    { label: "Cancelada",  color: "#ef4444", bg: "rgba(239,68,68,0.1)",   icon: AlertCircle },
};

const MSG_TYPES = [
  { value: "text",     label: "Texto",     icon: FileText },
  { value: "image",    label: "Imagem",    icon: Image },
  { value: "audio",    label: "Áudio",     icon: Mic },
  { value: "document", label: "Documento", icon: File },
] as const;

const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function parseHours(json: string): number[] {
  try { return JSON.parse(json); } catch { return []; }
}

// ─── Create Campaign Modal ─────────────────────────────────────────────────────

interface Group { id: string; name: string; jid: string; participant_count?: number; is_admin?: boolean }

function CreateCampaignModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { currentWorkspace } = useWorkspace();
  const [step, setStep] = useState(1);

  // Step 1 – basics
  const [name, setName]             = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [recipientType, setRecipientType] = useState<"contacts" | "groups" | "crm">("contacts");

  // Step 2 – recipients
  const [recipientsText, setRecipientsText] = useState(""); // contacts
  const [selectedGroups, setSelectedGroups] = useState<Group[]>([]); // groups
  const [groupSearch, setGroupSearch]       = useState("");
  const [groupSort, setGroupSort]           = useState<"name" | "members">("name");
  const [groupAdminOnly, setGroupAdminOnly] = useState(false);

  // Step 2 – CRM filters
  const [crmFilter, setCrmFilter] = useState<{
    funnel?: string;
    stage?: string;
    journey?: string;
    tags?: string[];
    owner?: string;
    external_id?: string;
    // Shop / Purchase history filters (Fase 10 do roadmap):
    purchased_shop_id?: string;
    purchased_since_days?: number;
    purchased_min_total?: number;
    purchased_status?: string;
    never_purchased?: boolean;
    // Agente IA: contatos que conversaram com agente específico:
    passed_agent_id?: string;
  }>({});
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Step 3 – message
  const [msgType, setMsgType]   = useState<"text" | "image" | "audio" | "document">("text");
  const [msgText, setMsgText]   = useState("");
  const [caption, setCaption]   = useState("");
  const [file, setFile]         = useState<File | null>(null);
  const fileRef                 = useRef<HTMLInputElement>(null);

  // Step 3 – WABA template (usado quando selectedInstance.channel = "waba")
  const [tplKey, setTplKey] = useState<string>(""); // "name|language"
  const [tplVars, setTplVars] = useState<Record<string, string>>({});
  const [tplHeaderURL, setTplHeaderURL] = useState("");

  // Step 4 – schedule
  const [startDate, setStartDate]       = useState("");
  const [endDate, setEndDate]           = useState("");
  const [timesTotal, setTimesTotal]     = useState(1);
  const [timesPerDay, setTimesPerDay]   = useState(1);
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [delaySeconds, setDelaySeconds] = useState(3);

  const [saving, setSaving] = useState(false);

  const { data: instances = [] } = useQuery<Instance[]>({
    queryKey: ["instances", currentWorkspace?.id],
    queryFn: () => instancesApi.list(undefined, currentWorkspace?.id).then((r) => r.data),
  });
  const connectedInstances = instances.filter((i) => i.status === "connected");
  const selectedInstance = instances.find((i) => i.id === instanceId);
  const isWABA = selectedInstance?.channel === "waba";

  const { data: groups = [], isLoading: groupsLoading } = useQuery<Group[]>({
    queryKey: ["groups", instanceId],
    queryFn: () => groupsApi.list(instanceId).then((r) => r.data.groups ?? []),
    enabled: !!instanceId && recipientType === "groups",
  });

  // Templates aprovados da WABA — só busca quando instância é WABA
  const { data: wabaTemplatesRes } = useQuery<{ items: Array<{ name: string; language: string; status: string; category: string; components: any[] }> }>({
    queryKey: ["waba-templates", instanceId],
    queryFn: () => wabaApi.templates(instanceId).then((r) => r.data),
    enabled: !!instanceId && isWABA,
  });
  const approvedTemplates = (wabaTemplatesRes?.items || []).filter((t) => t.status === "APPROVED");
  const selectedTpl = approvedTemplates.find(
    (t) => `${t.name}|${t.language}` === tplKey,
  );

  // Detecta variáveis do body do template selecionado
  const tplBodyText: string = (() => {
    if (!selectedTpl) return "";
    const body = selectedTpl.components?.find((c: any) => c.type === "BODY");
    return body?.text || "";
  })();
  const tplBodyVars = Array.from(tplBodyText.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g))
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);

  const tplHasMediaHeader: boolean = (() => {
    if (!selectedTpl) return false;
    const h = selectedTpl.components?.find((c: any) => c.type === "HEADER");
    return h && ["IMAGE", "VIDEO", "DOCUMENT"].includes(h.format);
  })();

  // CRM segment options
  const { data: segmentOptions } = useQuery({
    queryKey: ["segment-options"],
    queryFn: () => campaignsApi.segmentOptions().then((r) => r.data),
    enabled: recipientType === "crm",
  });

  // CRM segment preview
  const { data: segmentPreview } = useQuery({
    queryKey: ["segment-preview", crmFilter],
    queryFn: () => campaignsApi.segmentPreview(crmFilter).then((r) => r.data),
    enabled: recipientType === "crm" && Object.keys(crmFilter).some(k => crmFilter[k as keyof typeof crmFilter]),
  });

  const parseContacts = () =>
    recipientsText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [phone, ...rest] = l.split(",");
      return { phone: phone.trim(), name: rest.join(",").trim() || undefined };
    });

  const toggleHour = (h: number) =>
    setSelectedHours((prev) => prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h].sort((a, b) => a - b));

  const toggleGroup = (g: Group) =>
    setSelectedGroups((prev) => prev.find((x) => x.jid === g.jid) ? prev.filter((x) => x.jid !== g.jid) : [...prev, g]);

  const canNext1 = name.trim() && instanceId;
  const canNext2 = recipientType === "contacts" ? parseContacts().length > 0 :
                   recipientType === "groups" ? selectedGroups.length > 0 :
                   true; // CRM always valid (filters can be empty = all contacts)
  const canNext3 = isWABA
    ? !!selectedTpl && tplBodyVars.every((v) => (tplVars[v] || "").trim().length > 0) && (!tplHasMediaHeader || !!tplHeaderURL)
    : msgType === "text" ? msgText.trim().length > 0 : !!file;

  const handleCreate = async () => {
    setSaving(true);
    try {
      let mediaBase64: string | undefined;
      let mediaMime: string | undefined;
      let mediaName: string | undefined;
      if (file) {
        mediaBase64 = await toBase64(file);
        mediaMime = file.type;
        mediaName = file.name;
      }

      const recipients = recipientType === "contacts"
        ? parseContacts()
        : selectedGroups.map((g) => ({ phone: g.jid, name: g.name }));

      const [tplName, tplLang] = (tplKey || "|").split("|");
      await campaignsApi.create({
        workspace_id:   currentWorkspace?.id,
        instance_id:    instanceId,
        name:           name.trim(),
        recipient_type: recipientType,
        message_type:   isWABA ? "template" : msgType,
        message_text:   isWABA ? "" : msgText.trim(),
        caption:        isWABA ? undefined : (caption.trim() || undefined),
        media_base64:   mediaBase64,
        media_mime:     mediaMime,
        media_name:     mediaName,
        template_name:     isWABA ? tplName : undefined,
        template_language: isWABA ? tplLang : undefined,
        template_variables: isWABA ? tplVars : undefined,
        template_header_url: isWABA && tplHasMediaHeader ? tplHeaderURL : undefined,
        start_date:     startDate ? new Date(startDate).toISOString() : undefined,
        end_date:       endDate   ? new Date(endDate).toISOString()   : undefined,
        times_total:    timesTotal,
        times_per_day:  timesPerDay,
        schedule_hours: JSON.stringify(selectedHours),
        delay_seconds:  delaySeconds,
        recipients,
        segment_filter: recipientType === "crm" ? {
          funnel: crmFilter.funnel || undefined,
          stage: crmFilter.stage || undefined,
          journey: crmFilter.journey || undefined,
          owner: crmFilter.owner || undefined,
          external_id: crmFilter.external_id || undefined,
          tags: selectedTags.length > 0 ? selectedTags : undefined,
          purchased_shop_id: crmFilter.purchased_shop_id || undefined,
          purchased_since_days: crmFilter.purchased_since_days || undefined,
          purchased_min_total: crmFilter.purchased_min_total || undefined,
          purchased_status: crmFilter.purchased_status || undefined,
          never_purchased: crmFilter.never_purchased || undefined,
          passed_agent_id: crmFilter.passed_agent_id || undefined,
        } : undefined,
      });
      toast.success("Campanha criada!");
      onCreated();
      onClose();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar campanha");
    } finally {
      setSaving(false);
    }
  };

  const stepLabel = ["Básico", "Destinatários", "Mensagem", "Agendamento"];
  const stepLabelFull = recipientType === "crm" 
    ? ["Básico", "Filtros CRM", "Mensagem", "Agendamento"]
    : ["Básico", "Destinatários", "Mensagem", "Agendamento"];

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "var(--surface-overlay)" }} onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl shadow-2xl animate-fade-in-up"
        style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: "hsl(240 12% 12%)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)" }}>
              <Megaphone className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
            </div>
              <div>
              <h2 className="text-sm font-medium" style={{ color: "hsl(240 15% 93%)" }}>Nova Campanha</h2>
              <p className="text-[11px]" style={{ color: "hsl(240 8% 40%)" }}>Passo {step} de 4 — {stepLabelFull[step - 1]}</p>
              </div>
          </div>
          <button onClick={onClose} style={{ color: "hsl(240 8% 38%)" }} className="hover:opacity-70 transition-opacity">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 mx-6 mt-0" style={{ background: "hsl(240 12% 12%)" }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${(step / 4) * 100}%`, background: "var(--green)" }} />
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* ── Step 1: Basics ── */}
          {step === 1 && (
            <>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Nome da campanha *</label>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Black Friday 2025" className="input-field w-full" autoFocus />
              </div>

              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Instância *</label>
                <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)} className="input-field w-full">
                  <option value="">Selecione uma instância conectada</option>
                  {connectedInstances.map((i) => {
                    const ch = i.channel === "waba" ? "WABA · Cloud API"
                      : i.channel === "whatsapp" || !i.channel ? "WhatsApp Business"
                      : i.channel === "instagram" ? "Instagram"
                      : i.channel === "tiktok" ? "TikTok"
                      : i.channel;
                    return (
                      <option key={i.id} value={i.id}>
                        [{ch}] {i.name}{i.phone_number ? ` · ${i.phone_number}` : ""}
                      </option>
                    );
                  })}
                </select>
                {connectedInstances.length === 0 && (
                  <p className="text-xs mt-1" style={{ color: "#f87171" }}>Nenhuma instância conectada</p>
                )}
                {isWABA && (
                  <p className="text-[11px] mt-1.5" style={{ color: "#0088ff" }}>
                    📡 WABA selecionada — campanha enviará via templates aprovados Meta.
                  </p>
                )}
              </div>

              <div>
                <label className="text-xs font-medium block mb-2" style={{ color: "hsl(240 8% 50%)" }}>Tipo de destinatário</label>
                <div className="grid grid-cols-3 gap-2">
                  {([["contacts", "Contatos", Users], ["groups", "Grupos", Users2], ["crm", "CRM", Database]] as const).map(([val, lbl, Icon]) => (
                    <button key={val} type="button" onClick={() => setRecipientType(val)}
                      className="flex items-center gap-2 px-3 py-3 rounded-xl border text-xs font-medium transition-all"
                      style={recipientType === val
                        ? { background: "rgba(0,212,106,0.08)", borderColor: "rgba(0,212,106,0.25)", color: "var(--green)" }
                        : { background: "var(--surface-2)", borderColor: "hsl(240 12% 14%)", color: "hsl(240 8% 52%)" }}>
                      <Icon className="w-4 h-4" />
                      {lbl}
                    </button>
                  ))}
                </div>
                {recipientType === "crm" && (
                  <p className="text-[10px] mt-1.5" style={{ color: "hsl(240 8% 42%)" }}>
                    Filtra contatos do CRM por funil, estágio, jornada, tags e mais
                  </p>
                )}
              </div>
            </>
          )}

          {/* ── Step 2: Recipients ── */}
          {step === 2 && recipientType === "contacts" && (
            <>
              <div className="rounded-xl px-3.5 py-2.5" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)" }}>
                <p className="text-xs" style={{ color: "#60a5fa" }}>
                  Um por linha: <code className="font-mono">5511999999999</code> ou <code className="font-mono">5511999999999, João</code>
                </p>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>
                  Contatos *{" "}
                  {parseContacts().length > 0 && (
                    <span style={{ color: "var(--green)" }}>({parseContacts().length} detectados)</span>
                  )}
                </label>
                <textarea value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)}
                  placeholder={"5511999999999\n5511888888888, Maria\n5511777777777, Pedro"}
                  rows={8} className="input-field w-full resize-none font-mono text-xs" />
              </div>
            </>
          )}

          {step === 2 && recipientType === "groups" && (() => {
            const filtered = groups
              .filter((g) => !groupAdminOnly || g.is_admin)
              .filter((g) => !groupSearch || g.name.toLowerCase().includes(groupSearch.toLowerCase()))
              .sort((a, b) => groupSort === "members"
                ? (b.participant_count ?? 0) - (a.participant_count ?? 0)
                : a.name.localeCompare(b.name));
            return (
              <>
                {/* Toolbar: search + sort + admin filter */}
                <div className="space-y-2">
                  <div className="relative">
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color: "hsl(240 8% 38%)" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="Pesquisar grupos..." className="input-field w-full pl-8 text-xs py-2" />
                  </div>
                  <div className="flex gap-2">
                    <select value={groupSort} onChange={(e) => setGroupSort(e.target.value as "name" | "members")}
                      className="input-field text-xs py-1.5 flex-1">
                      <option value="name">Ordenar por nome</option>
                      <option value="members">Ordenar por membros</option>
                    </select>
                    <button type="button" onClick={() => setGroupAdminOnly((v) => !v)}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-all flex-shrink-0"
                      style={groupAdminOnly
                        ? { background: "rgba(167,139,250,0.12)", borderColor: "rgba(167,139,250,0.3)", color: "#a78bfa" }
                        : { background: "var(--surface-2)", borderColor: "hsl(240 12% 16%)", color: "hsl(240 8% 46%)" }}>
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                      Admin
                    </button>
                  </div>
                </div>

                {groupsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(240 8% 40%)" }} />
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="rounded-xl py-8 text-center" style={{ border: "1px dashed hsl(240 12% 16%)" }}>
                    <Users2 className="w-6 h-6 mx-auto mb-2" style={{ color: "hsl(240 8% 28%)" }} />
                    <p className="text-xs" style={{ color: "hsl(240 8% 40%)" }}>
                      {groups.length === 0 ? "Nenhum grupo encontrado para esta instância" : "Nenhum grupo corresponde aos filtros"}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-52 overflow-y-auto pr-0.5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-medium" style={{ color: "hsl(240 8% 50%)" }}>
                        {selectedGroups.length} selecionado{selectedGroups.length !== 1 ? "s" : ""} · {filtered.length} exibido{filtered.length !== 1 ? "s" : ""}
                      </p>
                      <button onClick={() => setSelectedGroups(
                        filtered.every((g) => selectedGroups.find((x) => x.jid === g.jid))
                          ? selectedGroups.filter((x) => !filtered.find((g) => g.jid === x.jid))
                          : [...selectedGroups.filter((x) => !filtered.find((g) => g.jid === x.jid)), ...filtered]
                      )} className="text-xs" style={{ color: "var(--green)" }}>
                        {filtered.every((g) => selectedGroups.find((x) => x.jid === g.jid)) ? "Desmarcar visíveis" : "Selecionar visíveis"}
                      </button>
                    </div>
                    {filtered.map((g) => {
                      const sel = !!selectedGroups.find((x) => x.jid === g.jid);
                      return (
                        <button key={g.jid} type="button" onClick={() => toggleGroup(g)}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all"
                          style={sel
                            ? { background: "rgba(0,212,106,0.06)", borderColor: "rgba(0,212,106,0.2)" }
                            : { background: "var(--surface-2)", borderColor: "hsl(240 12% 13%)" }}>
                          <div className="w-4 h-4 rounded flex-shrink-0 flex items-center justify-center"
                            style={sel
                              ? { background: "rgba(0,212,106,0.2)", border: "1px solid rgba(0,212,106,0.4)" }
                              : { background: "transparent", border: "1px solid hsl(240 12% 22%)" }}>
                            {sel && <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="var(--green)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-medium truncate" style={{ color: "hsl(240 15% 85%)" }}>{g.name}</p>
                              {g.is_admin && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "rgba(167,139,250,0.12)", color: "#a78bfa" }}>admin</span>
                              )}
                            </div>
                            <p className="text-[10px] font-mono truncate" style={{ color: "hsl(240 8% 36%)" }}>{g.jid}</p>
                          </div>
                          {g.participant_count != null && (
                            <span className="ml-auto text-[10px] flex-shrink-0 font-mono" style={{ color: "hsl(240 8% 38%)" }}>
                              {g.participant_count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}

          {/* ── Step 2: CRM Recipients ── */}
          {step === 2 && recipientType === "crm" && (
            <>
              <div className="rounded-xl px-3.5 py-2.5" style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.12)" }}>
                <p className="text-xs flex items-center gap-2" style={{ color: "#a855f7" }}>
                  <Database className="w-3.5 h-3.5" />
                  Filtros do CRM — deixe vazio para selecionar todos os contatos
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Funil */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Funil</label>
                  <select value={crmFilter.funnel || ""} onChange={(e) => setCrmFilter({...crmFilter, funnel: e.target.value || undefined})}
                    className="input-field w-full text-xs">
                    <option value="">Qualquer funil</option>
                    {(segmentOptions?.funnels || []).map((f: string) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>

                {/* Estágio */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Estágio</label>
                  <select value={crmFilter.stage || ""} onChange={(e) => setCrmFilter({...crmFilter, stage: e.target.value || undefined})}
                    className="input-field w-full text-xs">
                    <option value="">Qualquer estágio</option>
                    {(segmentOptions?.stages || []).map((s: string) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>

                {/* Jornada */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Jornada</label>
                  <select value={crmFilter.journey || ""} onChange={(e) => setCrmFilter({...crmFilter, journey: e.target.value || undefined})}
                    className="input-field w-full text-xs">
                    <option value="">Qualquer jornada</option>
                    {(segmentOptions?.journeys || []).map((j: string) => (
                      <option key={j} value={j}>{j}</option>
                    ))}
                  </select>
                </div>

                {/* Responsável */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Responsável</label>
                  <select value={crmFilter.owner || ""} onChange={(e) => setCrmFilter({...crmFilter, owner: e.target.value || undefined})}
                    className="input-field w-full text-xs">
                    <option value="">Qualquer responsável</option>
                    {(segmentOptions?.owners || []).map((o: string) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>

                {/* ID Externo */}
                <div className="col-span-2">
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>ID Externo</label>
                  <select value={crmFilter.external_id || ""} onChange={(e) => setCrmFilter({...crmFilter, external_id: e.target.value || undefined})}
                    className="input-field w-full text-xs">
                    <option value="">Qualquer ID externo</option>
                    {(segmentOptions?.external_ids || []).map((id: string) => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                </div>

                {/* Compras: filtro por histórico no Shop */}
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Comprou nos últimos N dias</label>
                  <input type="number" min="0" placeholder="ex: 30"
                    value={crmFilter.purchased_since_days || ""}
                    onChange={(e) => setCrmFilter({...crmFilter, purchased_since_days: parseInt(e.target.value) || undefined})}
                    className="input-field w-full text-xs" />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Compras totais ≥ R$</label>
                  <input type="number" min="0" step="0.01" placeholder="ex: 100"
                    value={crmFilter.purchased_min_total || ""}
                    onChange={(e) => setCrmFilter({...crmFilter, purchased_min_total: parseFloat(e.target.value) || undefined})}
                    className="input-field w-full text-xs" />
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs" style={{ color: "hsl(240 8% 50%)" }}>
                    <input type="checkbox"
                      checked={!!crmFilter.never_purchased}
                      onChange={(e) => setCrmFilter({...crmFilter, never_purchased: e.target.checked || undefined})} />
                    Apenas contatos que <strong>nunca compraram</strong>
                  </label>
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="text-xs font-medium block mb-2" style={{ color: "hsl(240 8% 50%)" }}>Tags</label>
                <div className="flex flex-wrap gap-1.5">
                  {(segmentOptions?.tags || []).map((tag: { id: string; name: string; color?: string }) => {
                    const isSelected = selectedTags.includes(tag.name);
                    return (
                      <button key={tag.id} type="button"
                        onClick={() => setSelectedTags(isSelected ? selectedTags.filter((t) => t !== tag.name) : [...selectedTags, tag.name])}
                        className="text-[11px] px-2.5 py-1 rounded-full border transition-all"
                        style={{
                          background: isSelected ? "rgba(168,85,247,0.15)" : "var(--surface-2)",
                          borderColor: isSelected ? "rgba(168,85,247,0.3)" : "hsl(240 12% 14%)",
                          color: isSelected ? "#a855f7" : "hsl(240 8% 52%)",
                        }}>
                        {tag.name}
                      </button>
                    );
                  })}
                  {(segmentOptions?.tags || []).length === 0 && (
                    <p className="text-[11px]" style={{ color: "hsl(240 8% 36%)" }}>Nenhuma tag criada no CRM</p>
                  )}
                </div>
              </div>

              {/* Preview */}
              {segmentPreview ? (
                <div className="rounded-xl p-3" style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.12)" }}>
                  <p className="text-xs font-medium flex items-center gap-2" style={{ color: "#a855f7" }}>
                    <UserCheck className="w-3.5 h-3.5" />
                    {segmentPreview.total} contato{segmentPreview.total !== 1 ? "s" : ""} selecionado{segmentPreview.total !== 1 ? "s" : ""}
                  </p>
                  {segmentPreview.sample?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {segmentPreview.sample.slice(0, 3).map((c: { id: string; name: string; phone: string }) => (
                        <p key={c.id} className="text-[10px]" style={{ color: "hsl(240 8% 50%)" }}>
                          {c.name} · {c.phone}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface-2)", border: "1px dashed hsl(240 12% 14%)" }}>
                  <p className="text-xs" style={{ color: "hsl(240 8% 36%)" }}>
                    Aplique filtros para ver a prévia de contatos
                  </p>
                </div>
              )}
            </>
          )}

          {/* ── Step 3: Message ── */}
          {step === 3 && (
            <>
              {isWABA ? (
                <div className="space-y-3">
                  <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(0,136,255,0.08)", border: "1px solid rgba(0,136,255,0.25)", color: "hsl(240 8% 75%)" }}>
                    <strong style={{ color: "#0088ff" }}>Canal WhatsApp API:</strong> mensagens precisam ser
                    enviadas via <strong>template aprovado</strong> pela Meta (regra obrigatória da Cloud API
                    fora da janela 24h).
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Template *</label>
                    <select value={tplKey} onChange={(e) => { setTplKey(e.target.value); setTplVars({}); }}
                      className="input-field w-full">
                      <option value="">— Selecione um template aprovado —</option>
                      {approvedTemplates.map((t) => (
                        <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                          {t.name} ({t.language}) · {t.category}
                        </option>
                      ))}
                    </select>
                    {approvedTemplates.length === 0 && (
                      <p className="text-[11px] mt-1.5" style={{ color: "#fbbf24" }}>
                        ⚠️ Nenhum template APPROVED encontrado. Crie um em /instances/[id]/waba antes.
                      </p>
                    )}
                  </div>

                  {selectedTpl && tplBodyText && (
                    <div className="rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid hsl(240 12% 14%)" }}>
                      <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 50%)" }}>
                        Body do template
                      </p>
                      <p className="text-xs whitespace-pre-wrap" style={{ color: "hsl(240 15% 80%)" }}>
                        {tplBodyText}
                      </p>
                    </div>
                  )}

                  {tplBodyVars.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium" style={{ color: "hsl(240 8% 70%)" }}>
                        Mapeamento de variáveis
                      </p>
                      <p className="text-[11px]" style={{ color: "hsl(240 8% 50%)" }}>
                        Use Liquid pra puxar do CRM: <code className="font-mono">{`{{contact.name}}`}</code>,{" "}
                        <code className="font-mono">{`{{contact.phone}}`}</code> ou texto fixo.
                      </p>
                      {tplBodyVars.map((v) => (
                        <div key={v} className="flex items-center gap-2">
                          <code className="text-[11px] font-mono shrink-0" style={{ color: "hsl(240 8% 70%)", minWidth: "5rem" }}>
                            {`{{${v}}}`}
                          </code>
                          <input value={tplVars[v] || ""}
                            onChange={(e) => setTplVars((prev) => ({ ...prev, [v]: e.target.value }))}
                            placeholder={v === "1" || v === "name" ? "{{contact.name}}" : "valor ou {{contact.xxx}}"}
                            className="input-field flex-1 text-xs font-mono" />
                        </div>
                      ))}
                    </div>
                  )}

                  {tplHasMediaHeader && (
                    <div>
                      <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>
                        URL da mídia do header (image/video/document) *
                      </label>
                      <input value={tplHeaderURL} onChange={(e) => setTplHeaderURL(e.target.value)}
                        placeholder="https://exemplo.com/imagem.jpg"
                        className="input-field w-full text-xs font-mono" />
                      <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 50%)" }}>
                        URL pública da mídia que será exibida no header do template.
                        Pode usar Liquid: <code className="font-mono">{`{{contact.custom.banner}}`}</code>
                      </p>
                    </div>
                  )}
                </div>
              ) : (
              <>
              <div>
                <label className="text-xs font-medium block mb-2" style={{ color: "hsl(240 8% 50%)" }}>Tipo de mensagem</label>
                <div className="grid grid-cols-4 gap-2">
                  {MSG_TYPES.map(({ value, label, icon: Icon }) => (
                    <button key={value} type="button" onClick={() => { setMsgType(value); setFile(null); }}
                      className="flex flex-col items-center gap-1.5 py-2.5 px-2 rounded-xl border text-xs font-medium transition-all"
                      style={msgType === value
                        ? { background: "rgba(0,212,106,0.08)", borderColor: "rgba(0,212,106,0.25)", color: "var(--green)" }
                        : { background: "var(--surface-2)", borderColor: "hsl(240 12% 14%)", color: "hsl(240 8% 48%)" }}>
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {msgType === "text" && (
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Mensagem *</label>
                  <textarea value={msgText} onChange={(e) => setMsgText(e.target.value)}
                    placeholder="Digite a mensagem que será enviada..." rows={5}
                    className="input-field w-full resize-none" />
                </div>
              )}

              {(msgType === "image" || msgType === "audio" || msgType === "document") && (
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>
                    {msgType === "image" ? "Imagem *" : msgType === "audio" ? "Áudio *" : "Documento *"}
                  </label>
                  <div
                    className="rounded-xl p-4 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
                    style={{ border: "2px dashed hsl(240 12% 16%)", background: file ? "rgba(0,212,106,0.04)" : "var(--surface-2)" }}
                    onClick={() => fileRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}>
                    {file ? (
                      <>
                        <CheckCircle2 className="w-5 h-5" style={{ color: "var(--green)" }} />
                        <p className="text-xs font-medium" style={{ color: "hsl(240 15% 80%)" }}>{file.name}</p>
                        <p className="text-[10px]" style={{ color: "hsl(240 8% 40%)" }}>{(file.size / 1024).toFixed(0)} KB</p>
                      </>
                    ) : (
                      <>
                        {msgType === "image" ? <Image className="w-5 h-5" style={{ color: "hsl(240 8% 36%)" }} />
                          : msgType === "audio" ? <Mic className="w-5 h-5" style={{ color: "hsl(240 8% 36%)" }} />
                          : <File className="w-5 h-5" style={{ color: "hsl(240 8% 36%)" }} />}
                        <p className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>Clique ou arraste o arquivo</p>
                      </>
                    )}
                    <input ref={fileRef} type="file" className="hidden"
                      accept={msgType === "image" ? "image/*" : msgType === "audio" ? "audio/*" : "*"}
                      onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
                  </div>
                </div>
              )}

              {msgType === "image" && (
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Legenda (opcional)</label>
                  <textarea value={caption} onChange={(e) => setCaption(e.target.value)}
                    placeholder="Texto que aparece abaixo da imagem..." rows={2}
                    className="input-field w-full resize-none" />
                </div>
              )}
              </>
              )}
            </>
          )}

          {/* ── Step 4: Schedule ── */}
          {step === 4 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Data de início</label>
                  <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                    className="input-field w-full text-xs" />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Data de fim</label>
                  <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                    className="input-field w-full text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Envios totais</label>
                  <input type="number" min={1} max={999} value={timesTotal}
                    onChange={(e) => setTimesTotal(Math.max(1, Number(e.target.value)))}
                    className="input-field w-full" />
                  <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 34%)" }}>por destinatário</p>
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Envios por dia</label>
                  <input type="number" min={1} max={99} value={timesPerDay}
                    onChange={(e) => setTimesPerDay(Math.max(1, Number(e.target.value)))}
                    className="input-field w-full" />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Intervalo (s)</label>
                  <input type="number" min={1} max={300} value={delaySeconds}
                    onChange={(e) => setDelaySeconds(Math.max(1, Number(e.target.value)))}
                    className="input-field w-full" />
                  <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 34%)" }}>entre envios</p>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium" style={{ color: "hsl(240 8% 50%)" }}>
                    Horários de envio
                    {selectedHours.length > 0 && (
                      <span className="ml-1.5" style={{ color: "var(--green)" }}>
                        ({selectedHours.map((h) => `${h}h`).join(", ")})
                      </span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <button className="text-[10px]" style={{ color: "hsl(240 8% 42%)" }}
                      onClick={() => setSelectedHours([])}>
                      qualquer hora
                    </button>
                    <button className="text-[10px]" style={{ color: "hsl(240 8% 42%)" }}
                      onClick={() => setSelectedHours([8, 9, 10, 11, 14, 15, 16, 17])}>
                      horário comercial
                    </button>
                  </div>
                </div>
                <p className="text-[10px] mb-2" style={{ color: "hsl(240 8% 34%)" }}>
                  Deixe vazio para enviar em qualquer horário. Clique nos horários desejados:
                </p>
                <div className="grid grid-cols-8 gap-1">
                  {ALL_HOURS.map((h) => (
                    <button key={h} type="button" onClick={() => toggleHour(h)}
                      className="text-[11px] py-1.5 rounded-lg font-mono transition-all"
                      style={selectedHours.includes(h)
                        ? { background: "rgba(0,212,106,0.12)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.25)" }
                        : { background: "var(--surface-2)", color: "hsl(240 8% 40%)", border: "1px solid hsl(240 12% 13%)" }}>
                      {h}h
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex gap-2 px-6 pb-5">
          {step > 1 ? (
            <button onClick={() => setStep(s => s - 1)}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-xl transition-all"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "hsl(240 8% 52%)" }}>
              <ChevronLeft className="w-3.5 h-3.5" /> Voltar
            </button>
          ) : (
            <button onClick={onClose}
              className="flex-1 text-sm py-2.5 rounded-xl transition-all"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "hsl(240 8% 52%)" }}>
              Cancelar
            </button>
          )}

          {step < 4 ? (
            <button onClick={() => setStep(s => s + 1)}
              disabled={step === 1 ? !canNext1 : step === 2 ? !canNext2 : !canNext3}
              className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium py-2.5 rounded-xl transition-all disabled:opacity-40"
              style={{ background: "var(--green)", color: "#03170a" }}>
              Próximo <ChevronRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button onClick={handleCreate} disabled={saving}
              className="flex-1 text-sm font-medium py-2.5 rounded-xl transition-all disabled:opacity-40"
              style={{ background: "var(--green)", color: "#03170a" }}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Criar Campanha"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Campaign Card ─────────────────────────────────────────────────────────────

function CampaignCard({ campaign, onAction }: { campaign: Campaign; onAction: () => void }) {
  const s = STATUS_MAP[campaign.status] ?? STATUS_MAP.draft;
  const StatusIcon = s.icon;
  const progress = campaign.total_count > 0
    ? Math.round(((campaign.sent_count + campaign.failed_count) / campaign.total_count) * 100)
    : 0;

  const hours = parseHours(campaign.schedule_hours ?? "[]");

  const handleStart = async () => {
    try { await campaignsApi.start(campaign.id); toast.success("Campanha iniciada!"); onAction(); }
    catch (e: unknown) { toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao iniciar"); }
  };
  const handlePause = async () => {
    try { await campaignsApi.pause(campaign.id); toast.success("Campanha pausada"); onAction(); }
    catch { toast.error("Erro ao pausar"); }
  };
  const handleDelete = async () => {
    if (!await showConfirm(`Deletar a campanha "${campaign.name}"? Esta ação é irreversível.`, { title: "Deletar campanha", confirmLabel: "Deletar" })) return;
    try { await campaignsApi.delete(campaign.id); toast.success("Campanha removida"); onAction(); }
    catch { toast.error("Erro ao remover"); }
  };

  const msgIconMap: Record<string, React.ElementType> = { text: FileText, image: Image, audio: Mic, document: File };
  const MsgIcon = msgIconMap[campaign.message_type] ?? FileText;

  return (
    <div className="rounded-2xl overflow-hidden transition-all duration-200"
      style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-medium text-sm truncate" style={{ color: "hsl(240 15% 93%)" }}>{campaign.name}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[10px]" style={{ color: "hsl(240 8% 40%)" }}>
                <MsgIcon className="w-3 h-3" />
                {campaign.message_type}
              </span>
              <span className="flex items-center gap-1 text-[10px]" style={{ color: "hsl(240 8% 40%)" }}>
                {campaign.recipient_type === "groups" ? <Users2 className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                {campaign.recipient_type === "groups" ? "grupos" : "contatos"}
              </span>
            </div>
          </div>
          <span className="ml-3 inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium flex-shrink-0"
            style={{ background: s.bg, color: s.color }}>
            <StatusIcon className={cn("w-3 h-3", campaign.status === "running" && "animate-spin")} />
            {s.label}
          </span>
        </div>

        {/* Schedule info */}
        {(campaign.start_date || campaign.end_date || campaign.times_total > 1) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {campaign.start_date && (
              <span className="text-[10px] px-2 py-0.5 rounded font-mono"
                style={{ background: "var(--surface-2)", color: "hsl(240 8% 40%)" }}>
                {fmtDate(campaign.start_date)}
              </span>
            )}
            {campaign.end_date && (
              <span className="text-[10px] px-2 py-0.5 rounded font-mono"
                style={{ background: "var(--surface-2)", color: "hsl(240 8% 40%)" }}>
                até {fmtDate(campaign.end_date)}
              </span>
            )}
            {campaign.times_total > 1 && (
              <span className="text-[10px] px-2 py-0.5 rounded"
                style={{ background: "rgba(167,139,250,0.08)", color: "#a78bfa" }}>
                {campaign.times_total}× total · {campaign.times_per_day}×/dia
              </span>
            )}
            {hours.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded font-mono"
                style={{ background: "rgba(96,165,250,0.08)", color: "#60a5fa" }}>
                {hours.map((h) => `${h}h`).join(" ")}
              </span>
            )}
          </div>
        )}

        {/* Progress */}
        <div className="mb-3">
          <div className="flex justify-between text-[11px] mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" /> {campaign.total_count} destinatários
            </span>
            <span>{campaign.sent_count} ok · {campaign.failed_count} falhos</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(240 12% 12%)" }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: campaign.failed_count > 0 ? "#f59e0b" : "var(--green)" }} />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Link href={`/campaigns/${campaign.id}`}
            className="flex-1 text-center text-xs font-medium py-2 px-3 rounded-xl transition-all"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "hsl(240 8% 62%)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface-3)"; (e.currentTarget as HTMLElement).style.color = "hsl(240 15% 90%)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 62%)"; }}>
            Detalhes
          </Link>
          {(campaign.status === "draft" || campaign.status === "paused") && (
            <button onClick={handleStart}
              className="flex items-center gap-1.5 text-xs font-medium py-2 px-3 rounded-xl transition-all"
              style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.15)", color: "var(--green)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,106,0.14)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,212,106,0.08)")}>
              <Play className="w-3 h-3" /> Iniciar
            </button>
          )}
          {campaign.status === "running" && (
            <button onClick={handlePause}
              className="flex items-center gap-1.5 text-xs font-medium py-2 px-3 rounded-xl transition-all"
              style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", color: "#f59e0b" }}>
              <Pause className="w-3 h-3" /> Pausar
            </button>
          )}
          <button onClick={handleDelete}
            className="p-2 rounded-xl transition-all"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "#64748b" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)"; (e.currentTarget as HTMLElement).style.color = "#ef4444"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface-2)"; (e.currentTarget as HTMLElement).style.color = "#64748b"; }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const { currentWorkspace } = useWorkspace();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { t, timezone } = usePreferences();

  const { data, isLoading } = useQuery({
    queryKey: ["campaigns", currentWorkspace?.id],
    queryFn: () => campaignsApi.list(currentWorkspace?.id).then((r) => r.data),
    refetchInterval: 5000,
  });
  const campaigns: Campaign[] = data?.data ?? [];

  const running   = campaigns.filter((c) => c.status === "running").length;
  const completed = campaigns.filter((c) => c.status === "completed").length;

  return (
    <div className="space-y-7">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>Campanhas</h1>
          <p className="text-sm mt-1.5" style={{ color: "hsl(240 8% 46%)" }}>
            {campaigns.length} campanha{campaigns.length !== 1 ? "s" : ""}
            {running > 0 && <span> · <span style={{ color: "var(--green)" }}>{running} em execução</span></span>}
            {completed > 0 && <span> · {completed} concluída{completed !== 1 ? "s" : ""}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] px-2 py-1 rounded-lg font-mono hidden sm:inline-flex items-center gap-1"
            style={{ background: "rgba(96,165,250,0.08)", color: "#60a5fa", border: "1px solid rgba(96,165,250,0.15)" }}>
            🕐 {timezone}
          </span>
          <button onClick={() => setCreateOpen(true)} 
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ 
              background: "rgba(0, 212, 106, 0.12)", 
              border: "1px solid rgba(0, 212, 106, 0.3)", 
              color: "var(--green)", 
              backdropFilter: "blur(8px)" 
            }}>
            <Plus className="w-4 h-4" /> <span className="hidden sm:inline">{t("campaigns_new")}</span>
            <span className="sm:hidden">Nova</span>
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-52 rounded-2xl" />)}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center animate-fade-in-up">
          {/* SVG: megafone com ondas de sinal */}
          <div className="mb-6 opacity-60">
            <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
              {/* Corpo do megafone */}
              <path d="M24 48 L24 72 L40 72 L68 86 L68 34 L40 48 Z" stroke="var(--text-3)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
              {/* Cabo / boca */}
              <rect x="16" y="50" width="8" height="20" rx="3" stroke="var(--text-3)" strokeWidth="2" fill="none" />
              {/* Ondas de sinal */}
              <path d="M76 50 Q84 60 76 70" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.9" />
              <path d="M84 44 Q96 60 84 76" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6" />
              <path d="M92 38 Q108 60 92 82" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4" />
              {/* Ponto focal do megafone */}
              <circle cx="46" cy="60" r="3" fill="var(--green)" opacity="0.6" />
            </svg>
          </div>
          <h3 className="text-base font-semibold mb-2" style={{ color: "var(--text-1)" }}>
            Nenhuma campanha criada
          </h3>
          <p className="text-sm mb-6 max-w-xs" style={{ color: "var(--text-3)" }}>
            Dispare mensagens em massa para sua base de contatos
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.97]"
            style={{ background: "var(--green-dim)", color: "var(--green)", border: "1px solid var(--green-border)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(0,212,106,0.18)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "var(--green-dim)"; }}
          >
            <Plus className="w-4 h-4" />
            Nova campanha
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map((campaign) => (
            <CampaignCard key={campaign.id} campaign={campaign}
              onAction={() => queryClient.invalidateQueries({ queryKey: ["campaigns"] })} />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateCampaignModal
          onClose={() => setCreateOpen(false)}
          onCreated={() => queryClient.invalidateQueries({ queryKey: ["campaigns"] })} />
      )}
    </div>
  );
}
