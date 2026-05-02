"use client";

import React, { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { campaignsApi, instancesApi, groupsApi, wabaApi } from "@/lib/api";
import { Campaign, Instance } from "@/types";
import {
  Plus, Megaphone, Play, Pause, X, Trash2, Clock, CheckCircle2,
  AlertCircle, Loader2, Users, Calendar, FileText, Image, Mic,
  File, ChevronLeft, ChevronRight, Users2, Database, UserCheck,
  MessageCircle, UserPlus, UserMinus, Heart, Send, Shield,
  Upload, Hash, AtSign, Shuffle,
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

// ─── Channel definitions ──────────────────────────────────────────────────────

const CHANNEL_META: Record<string, { label: string; color: string; gradient: string; icon: React.ElementType }> = {
  whatsapp: { label: "WhatsApp",       color: "#25d366", gradient: "from-[#25d366]/20 to-[#128c7e]/10", icon: MessageCircle },
  waba:     { label: "WhatsApp API",   color: "#0088ff", gradient: "from-[#0088ff]/20 to-[#0055cc]/10", icon: Send },
  instagram:{ label: "Instagram",      color: "#e1306c", gradient: "from-[#e1306c]/20 to-[#833ab4]/10", icon: AtSign },
  telegram: { label: "Telegram",       color: "#2ca5e0", gradient: "from-[#2ca5e0]/20 to-[#1a6699]/10", icon: Send },
};

const CHANNEL_ACTIONS: Record<string, Array<{ id: string; label: string; description: string; icon: React.ElementType; color: string }>> = {
  whatsapp: [
    { id: "send_message", label: "Enviar mensagem",   description: "Texto, imagem, áudio ou documento", icon: MessageCircle, color: "#25d366" },
  ],
  waba: [
    { id: "send_message", label: "Enviar template",   description: "Template aprovado pela Meta",        icon: Send,          color: "#0088ff" },
  ],
  instagram: [
    { id: "send_message", label: "Enviar DM",          description: "Direct message para contas",        icon: MessageCircle, color: "#e1306c" },
    { id: "follow",       label: "Seguir",              description: "Seguir perfis automaticamente",     icon: UserPlus,      color: "#a855f7" },
    { id: "unfollow",     label: "Deixar de seguir",    description: "Unfollow em massa com segurança",   icon: UserMinus,     color: "#f59e0b" },
    { id: "like",         label: "Curtir post",         description: "Curtir posts de um perfil/hashtag", icon: Heart,         color: "#ef4444" },
    { id: "comment",      label: "Comentar",            description: "Comentar posts com texto variável", icon: MessageCircle, color: "#06b6d4" },
  ],
  telegram: [
    { id: "send_message", label: "Enviar mensagem",   description: "Texto ou mídia para contatos",       icon: MessageCircle, color: "#2ca5e0" },
  ],
};

const AUDIENCE_TYPES: Record<string, Array<{ id: string; label: string; icon: React.ElementType }>> = {
  whatsapp: [
    { id: "crm",      label: "CRM",               icon: Database },
    { id: "contacts", label: "Colar contatos",     icon: Users },
    { id: "csv",      label: "Upload CSV",         icon: Upload },
    { id: "groups",   label: "Grupos",             icon: Users2 },
  ],
  waba: [
    { id: "crm",      label: "CRM",               icon: Database },
    { id: "contacts", label: "Colar contatos",     icon: Users },
    { id: "csv",      label: "Upload CSV",         icon: Upload },
  ],
  instagram: [
    { id: "crm",       label: "CRM",               icon: Database },
    { id: "contacts",  label: "Colar handles",     icon: AtSign },
    { id: "csv",       label: "Upload CSV",         icon: Upload },
    { id: "followers", label: "Seguidores",         icon: Users },
    { id: "following", label: "Quem você segue",   icon: UserPlus },
  ],
  telegram: [
    { id: "crm",      label: "CRM",               icon: Database },
    { id: "contacts", label: "Colar contatos",     icon: Users },
    { id: "csv",      label: "Upload CSV",         icon: Upload },
  ],
};

// ─── Create Campaign Modal ────────────────────────────────────────────────────

interface Group { id: string; name: string; jid: string; participant_count?: number; is_admin?: boolean }

interface CrmFilter {
  funnel?: string;
  stage?: string;
  journey?: string;
  tags?: string[];
  owner?: string;
  external_id?: string;
  segment_id?: string;
  purchased_shop_id?: string;
  purchased_since_days?: number;
  purchased_min_total?: number;
  purchased_status?: string;
  never_purchased?: boolean;
  passed_agent_id?: string;
  // Inbox behavior
  inbox_assigned_to?: string;
  inbox_department?: string;
  inbox_team?: string;
  inbox_queue?: string;
  inbox_response_time_max?: number;
  inbox_conversation_count_min?: number;
  inbox_last_contact_after?: string;
  // Campaign participation
  participated_campaign_id?: string;
}

function CreateCampaignModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { currentWorkspace } = useWorkspace();
  const [step, setStep] = useState(1);

  // Step 1
  const [name, setName] = useState("");

  // Step 2: Channel selection
  const [channel, setChannel]       = useState("");
  const [instanceId, setInstanceId] = useState("");

  // Step 3: Action type
  const [actionType, setActionType] = useState("send_message");

  // Step 4: Audience
  const [audienceTab, setAudienceTab] = useState("crm");
  const [recipientsText, setRecipientsText] = useState("");
  const [csvFile, setCsvFile]             = useState<File | null>(null);
  const [csvRecipients, setCsvRecipients] = useState<Array<{ phone: string; name: string }>>([]);
  const [selectedGroups, setSelectedGroups] = useState<Group[]>([]);
  const [groupSearch, setGroupSearch]       = useState("");
  const [groupSort, setGroupSort]           = useState<"name" | "members">("name");
  const [groupAdminOnly, setGroupAdminOnly] = useState(false);
  const csvRef   = useRef<HTMLInputElement>(null);
  const fileRef  = useRef<HTMLInputElement>(null);

  // CRM filters
  const [crmFilter, setCrmFilter] = useState<CrmFilter>({});
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // Instagram channel config (post URL for like/comment; username for followers/following)
  const [igPostUrl, setIgPostUrl]     = useState("");
  const [igUsername, setIgUsername]   = useState("");

  // Step 5: Content
  const [msgType, setMsgType]   = useState<"text" | "image" | "audio" | "document">("text");
  const [msgText, setMsgText]   = useState("");
  const [caption, setCaption]   = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  // WABA template
  const [tplKey, setTplKey]         = useState("");
  const [tplVars, setTplVars]       = useState<Record<string, string>>({});
  const [tplHeaderURL, setTplHeaderURL] = useState("");

  // Step 6: Schedule & safety
  const [startDate, setStartDate]         = useState("");
  const [endDate, setEndDate]             = useState("");
  const [timesTotal, setTimesTotal]       = useState(1);
  const [timesPerDay, setTimesPerDay]     = useState(1);
  const [selectedHours, setSelectedHours] = useState<number[]>([]);
  const [delayMin, setDelayMin]           = useState(5);
  const [delayMax, setDelayMax]           = useState(15);
  const [dailyLimit, setDailyLimit]       = useState(0);

  const [saving, setSaving] = useState(false);

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: instances = [] } = useQuery<Instance[]>({
    queryKey: ["instances", currentWorkspace?.id],
    queryFn: () => instancesApi.list(undefined, currentWorkspace?.id).then((r) => r.data),
  });
  const connectedInstances = instances.filter((i) => i.status === "connected");

  // Instances grouped by channel
  const channelInstances = (ch: string) =>
    connectedInstances.filter((i) => {
      if (ch === "whatsapp") return !i.channel || i.channel === "whatsapp";
      return i.channel === ch;
    });

  // Available channels (only ones with connected instances)
  const availableChannels = Object.keys(CHANNEL_META).filter(
    (ch) => channelInstances(ch).length > 0
  );

  const selectedInstance = instances.find((i) => i.id === instanceId);
  const isWABA = selectedInstance?.channel === "waba" || channel === "waba";

  const { data: groups = [], isLoading: groupsLoading } = useQuery<Group[]>({
    queryKey: ["groups", instanceId],
    queryFn: () => groupsApi.list(instanceId).then((r) => r.data.groups ?? []),
    enabled: !!instanceId && audienceTab === "groups",
  });

  const { data: wabaTemplatesRes } = useQuery<{ items: Array<{ name: string; language: string; status: string; category: string; components: any[] }> }>({
    queryKey: ["waba-templates", instanceId],
    queryFn: () => wabaApi.templates(instanceId).then((r) => r.data),
    enabled: !!instanceId && isWABA,
  });
  const approvedTemplates = (wabaTemplatesRes?.items || []).filter((t) => t.status === "APPROVED");
  const selectedTpl = approvedTemplates.find((t) => `${t.name}|${t.language}` === tplKey);
  const tplBodyText: string = (() => {
    if (!selectedTpl) return "";
    const body = selectedTpl.components?.find((c: any) => c.type === "BODY");
    return body?.text || "";
  })();
  const tplBodyVars = Array.from(tplBodyText.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g))
    .map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  const tplHasMediaHeader: boolean = (() => {
    if (!selectedTpl) return false;
    const h = selectedTpl.components?.find((c: any) => c.type === "HEADER");
    return h && ["IMAGE", "VIDEO", "DOCUMENT"].includes(h.format);
  })();

  const { data: segmentOptions } = useQuery({
    queryKey: ["segment-options"],
    queryFn: () => campaignsApi.segmentOptions().then((r) => r.data),
    enabled: audienceTab === "crm",
  });
  const { data: segmentPreview } = useQuery({
    queryKey: ["segment-preview", { ...crmFilter, tags: selectedTags }],
    queryFn: () => campaignsApi.segmentPreview({ ...crmFilter, tags: selectedTags.length > 0 ? selectedTags : undefined }).then((r) => r.data),
    enabled: audienceTab === "crm" && (Object.values(crmFilter).some(Boolean) || selectedTags.length > 0),
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const parseContacts = useCallback(() =>
    recipientsText.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [phone, ...rest] = l.split(",");
      return { phone: phone.trim(), name: rest.join(",").trim() || "" };
    }), [recipientsText]);

  const handleCsvUpload = async (file: File) => {
    setCsvFile(file);
    const text = await file.text();
    const lines = text.split("\n").slice(1); // skip header
    const parsed = lines.map((l) => {
      const [phone, name] = l.split(",").map((s) => s.trim().replace(/^"|"$/g, ""));
      return { phone, name: name || "" };
    }).filter((r) => r.phone);
    setCsvRecipients(parsed);
    toast.success(`${parsed.length} contatos carregados do CSV`);
  };

  const toggleHour = (h: number) =>
    setSelectedHours((prev) => prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h].sort((a, b) => a - b));

  const toggleGroup = (g: Group) =>
    setSelectedGroups((prev) => prev.find((x) => x.jid === g.jid) ? prev.filter((x) => x.jid !== g.jid) : [...prev, g]);

  // ── Step count & labels ──────────────────────────────────────────────────────

  const needsContent = actionType === "send_message";
  const totalSteps   = needsContent ? 6 : 5;
  const stepLabels   = needsContent
    ? ["Nome", "Canal", "Ação", "Audiência", "Conteúdo", "Agendamento"]
    : ["Nome", "Canal", "Ação", "Audiência", "Agendamento"];

  // Logical step index (content step may be skipped)
  const contentStep = 5;
  const scheduleStep = needsContent ? 6 : 5;

  // ── Validation ────────────────────────────────────────────────────────────────

  const canNext1 = name.trim().length > 0;
  const canNext2 = !!channel && !!instanceId;
  const canNext3 = !!actionType;
  const canNext4 = (() => {
    if (audienceTab === "contacts") return parseContacts().length > 0;
    if (audienceTab === "csv") return csvRecipients.length > 0;
    if (audienceTab === "groups") return selectedGroups.length > 0;
    if (audienceTab === "followers" || audienceTab === "following") return igUsername.trim().length > 0;
    return true; // CRM always valid
  })();
  const canNext5 = (() => {
    if (!needsContent) return true;
    if (isWABA) return !!selectedTpl && tplBodyVars.every((v) => (tplVars[v] || "").trim().length > 0) && (!tplHasMediaHeader || !!tplHeaderURL);
    return msgType === "text" ? msgText.trim().length > 0 : !!mediaFile;
  })();

  const canNext = (s: number) => {
    if (s === 1) return canNext1;
    if (s === 2) return canNext2;
    if (s === 3) return canNext3;
    if (s === 4) return canNext4;
    if (s === contentStep && needsContent) return canNext5;
    return true;
  };

  const handleNext = () => {
    // Skip content step for non-messaging actions
    if (step === 4 && !needsContent) {
      setStep(scheduleStep);
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (step === scheduleStep && !needsContent) {
      setStep(4);
    } else {
      setStep((s) => s - 1);
    }
  };

  // ── Submit ────────────────────────────────────────────────────────────────────

  const handleCreate = async () => {
    setSaving(true);
    try {
      let mediaBase64: string | undefined;
      let mediaMime: string | undefined;
      let mediaName: string | undefined;
      if (mediaFile) {
        mediaBase64 = await toBase64(mediaFile);
        mediaMime   = mediaFile.type;
        mediaName   = mediaFile.name;
      }

      let recipients: Array<{ phone: string; name: string }> = [];
      let recipientType = audienceTab;

      if (audienceTab === "contacts") {
        recipients = parseContacts();
        recipientType = "contacts";
      } else if (audienceTab === "csv") {
        recipients = csvRecipients;
        recipientType = "contacts";
      } else if (audienceTab === "groups") {
        recipients = selectedGroups.map((g) => ({ phone: g.jid, name: g.name }));
        recipientType = "groups";
      } else if (audienceTab === "followers" || audienceTab === "following") {
        recipientType = audienceTab;
      } else {
        recipientType = "crm";
      }

      const [tplName, tplLang] = (tplKey || "|").split("|");

      const channelConfig: Record<string, string> = {};
      if (igPostUrl)    channelConfig.post_url  = igPostUrl;
      if (igUsername)   channelConfig.ig_username = igUsername;

      await campaignsApi.create({
        workspace_id:         currentWorkspace?.id,
        instance_id:          instanceId,
        name:                 name.trim(),
        action_type:          actionType,
        recipient_type:       recipientType,
        channel_config:       JSON.stringify(channelConfig),
        message_type:         isWABA ? "template" : msgType,
        message_text:         isWABA ? "" : msgText.trim(),
        caption:              isWABA ? undefined : (caption.trim() || undefined),
        media_base64:         mediaBase64,
        media_mime:           mediaMime,
        media_name:           mediaName,
        template_name:        isWABA ? tplName : undefined,
        template_language:    isWABA ? tplLang : undefined,
        template_variables:   isWABA ? tplVars : undefined,
        template_header_url:  isWABA && tplHasMediaHeader ? tplHeaderURL : undefined,
        start_date:           startDate ? new Date(startDate).toISOString() : undefined,
        end_date:             endDate   ? new Date(endDate).toISOString()   : undefined,
        times_total:          timesTotal,
        times_per_day:        timesPerDay,
        schedule_hours:       JSON.stringify(selectedHours),
        delay_seconds:        delayMin,
        delay_min_seconds:    delayMin,
        delay_max_seconds:    delayMax,
        daily_limit_per_account: dailyLimit,
        recipients,
        segment_filter: audienceTab === "crm" ? {
          funnel:               crmFilter.funnel || undefined,
          stage:                crmFilter.stage || undefined,
          journey:              crmFilter.journey || undefined,
          owner:                crmFilter.owner || undefined,
          external_id:          crmFilter.external_id || undefined,
          segment_id:           crmFilter.segment_id || undefined,
          tags:                 selectedTags.length > 0 ? selectedTags : undefined,
          purchased_shop_id:    crmFilter.purchased_shop_id || undefined,
          purchased_since_days: crmFilter.purchased_since_days || undefined,
          purchased_min_total:  crmFilter.purchased_min_total || undefined,
          purchased_status:     crmFilter.purchased_status || undefined,
          never_purchased:      crmFilter.never_purchased || undefined,
          passed_agent_id:      crmFilter.passed_agent_id || undefined,
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

  // ── Render ────────────────────────────────────────────────────────────────────

  const progressPct = (step / totalSteps) * 100;

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
              <p className="text-[11px]" style={{ color: "hsl(240 8% 40%)" }}>
                Passo {step} de {totalSteps} — {stepLabels[step - 1]}
              </p>
            </div>
          </div>
          <button onClick={onClose} style={{ color: "hsl(240 8% 38%)" }} className="hover:opacity-70 transition-opacity">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-0.5 mx-6 mt-0" style={{ background: "hsl(240 12% 12%)" }}>
          <div className="h-full rounded-full transition-all duration-300"
            style={{ width: `${progressPct}%`, background: "var(--green)" }} />
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">

          {/* ── Step 1: Nome ─────────────────────────────────────────────────── */}
          {step === 1 && (
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Nome da campanha *</label>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Black Friday 2025" className="input-field w-full" autoFocus />
            </div>
          )}

          {/* ── Step 2: Canal ────────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3">
              {availableChannels.length === 0 && (
                <div className="rounded-xl p-4 text-center" style={{ border: "1px dashed hsl(240 12% 18%)" }}>
                  <p className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>Nenhuma instância conectada. Conecte uma em Instâncias.</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                {availableChannels.map((ch) => {
                  const meta = CHANNEL_META[ch];
                  const Icon = meta.icon;
                  const isSelected = channel === ch;
                  const chInstances = channelInstances(ch);
                  return (
                    <button key={ch} type="button"
                      onClick={() => {
                        setChannel(ch);
                        // Auto-select instance if only one
                        if (chInstances.length === 1) setInstanceId(chInstances[0].id);
                        else setInstanceId("");
                        // Reset action to first available
                        setActionType(CHANNEL_ACTIONS[ch]?.[0]?.id ?? "send_message");
                        setAudienceTab(AUDIENCE_TYPES[ch]?.[0]?.id ?? "crm");
                      }}
                      className={`flex flex-col gap-2.5 p-4 rounded-xl border text-left transition-all`}
                      style={isSelected
                        ? { background: `rgba(${meta.color === "#25d366" ? "37,211,102" : meta.color === "#0088ff" ? "0,136,255" : meta.color === "#e1306c" ? "225,48,108" : "44,165,224"},0.1)`, borderColor: meta.color + "40", boxShadow: `0 0 0 1px ${meta.color}25` }
                        : { background: "var(--surface-2)", borderColor: "hsl(240 12% 14%)" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                          style={{ background: meta.color + "20" }}>
                          <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                        </div>
                        <span className="text-xs font-medium" style={{ color: isSelected ? meta.color : "hsl(240 15% 80%)" }}>
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-[10px]" style={{ color: "hsl(240 8% 42%)" }}>
                        {chInstances.length} instância{chInstances.length !== 1 ? "s" : ""} conectada{chInstances.length !== 1 ? "s" : ""}
                      </p>
                    </button>
                  );
                })}
              </div>

              {/* Instance selector (if multiple) */}
              {channel && channelInstances(channel).length > 1 && (
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>
                    Selecione a instância *
                  </label>
                  <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)}
                    className="input-field w-full text-xs">
                    <option value="">— Selecione —</option>
                    {channelInstances(channel).map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}{i.phone_number ? ` · ${i.phone_number}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Tipo de ação ─────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-2">
              <p className="text-[11px] mb-3" style={{ color: "hsl(240 8% 42%)" }}>
                Selecione o que esta campanha vai fazer para cada destinatário:
              </p>
              {(CHANNEL_ACTIONS[channel] ?? CHANNEL_ACTIONS.whatsapp).map((action) => {
                const Icon = action.icon;
                const isSelected = actionType === action.id;
                return (
                  <button key={action.id} type="button"
                    onClick={() => {
                      setActionType(action.id);
                      // Reset audience tab to first valid option for this channel
                      setAudienceTab(AUDIENCE_TYPES[channel]?.[0]?.id ?? "crm");
                    }}
                    className="w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all"
                    style={isSelected
                      ? { background: action.color + "12", borderColor: action.color + "35" }
                      : { background: "var(--surface-2)", borderColor: "hsl(240 12% 14%)" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: action.color + "20" }}>
                      <Icon className="w-4 h-4" style={{ color: action.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium" style={{ color: isSelected ? action.color : "hsl(240 15% 85%)" }}>
                        {action.label}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: "hsl(240 8% 46%)" }}>
                        {action.description}
                      </p>
                    </div>
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: action.color + "25", border: `1px solid ${action.color}50` }}>
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: action.color }} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Step 4: Audiência ────────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-4">
              {/* Audience type tabs */}
              <div className="flex gap-1.5 flex-wrap">
                {(AUDIENCE_TYPES[channel] ?? AUDIENCE_TYPES.whatsapp).map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button"
                    onClick={() => setAudienceTab(id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={audienceTab === id
                      ? { background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.25)", color: "var(--green)" }
                      : { background: "var(--surface-2)", border: "1px solid hsl(240 12% 14%)", color: "hsl(240 8% 48%)" }}>
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* CRM tab */}
              {audienceTab === "crm" && (
                <div className="space-y-3">
                  <div className="rounded-xl px-3.5 py-2.5" style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.12)" }}>
                    <p className="text-xs flex items-center gap-2" style={{ color: "#a855f7" }}>
                      <Database className="w-3.5 h-3.5" />
                      Segmente contatos do CRM — deixe vazio para todos
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Funil</label>
                      <select value={crmFilter.funnel || ""} onChange={(e) => setCrmFilter({ ...crmFilter, funnel: e.target.value || undefined })}
                        className="input-field w-full text-xs">
                        <option value="">Qualquer</option>
                        {(segmentOptions?.funnels || []).map((f: string) => <option key={f} value={f}>{f}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Estágio</label>
                      <select value={crmFilter.stage || ""} onChange={(e) => setCrmFilter({ ...crmFilter, stage: e.target.value || undefined })}
                        className="input-field w-full text-xs">
                        <option value="">Qualquer</option>
                        {(segmentOptions?.stages || []).map((s: string) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Jornada</label>
                      <select value={crmFilter.journey || ""} onChange={(e) => setCrmFilter({ ...crmFilter, journey: e.target.value || undefined })}
                        className="input-field w-full text-xs">
                        <option value="">Qualquer</option>
                        {(segmentOptions?.journeys || []).map((j: string) => <option key={j} value={j}>{j}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Segmento</label>
                      <select value={crmFilter.segment_id || ""} onChange={(e) => setCrmFilter({ ...crmFilter, segment_id: e.target.value || undefined })}
                        className="input-field w-full text-xs">
                        <option value="">Qualquer</option>
                        {(segmentOptions?.segments || []).map((s: { id: string; name: string }) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="text-xs font-medium block mb-2" style={{ color: "hsl(240 8% 50%)" }}>Tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {(segmentOptions?.tags || []).length === 0
                        ? <p className="text-[11px]" style={{ color: "hsl(240 8% 36%)" }}>Nenhuma tag criada</p>
                        : (segmentOptions?.tags || []).map((tag: { id: string; name: string }) => {
                          const sel = selectedTags.includes(tag.name);
                          return (
                            <button key={tag.id} type="button"
                              onClick={() => setSelectedTags(sel ? selectedTags.filter((t) => t !== tag.name) : [...selectedTags, tag.name])}
                              className="text-[11px] px-2.5 py-1 rounded-full border transition-all"
                              style={sel
                                ? { background: "rgba(168,85,247,0.15)", borderColor: "rgba(168,85,247,0.3)", color: "#a855f7" }
                                : { background: "var(--surface-2)", borderColor: "hsl(240 12% 14%)", color: "hsl(240 8% 52%)" }}>
                              {tag.name}
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  {/* Purchase filters */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Comprou nos últimos N dias</label>
                      <input type="number" min="0" placeholder="ex: 30"
                        value={crmFilter.purchased_since_days || ""}
                        onChange={(e) => setCrmFilter({ ...crmFilter, purchased_since_days: parseInt(e.target.value) || undefined })}
                        className="input-field w-full text-xs" />
                    </div>
                    <div>
                      <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Compras totais ≥ R$</label>
                      <input type="number" min="0" step="0.01" placeholder="ex: 100"
                        value={crmFilter.purchased_min_total || ""}
                        onChange={(e) => setCrmFilter({ ...crmFilter, purchased_min_total: parseFloat(e.target.value) || undefined })}
                        className="input-field w-full text-xs" />
                    </div>
                    <div className="col-span-2">
                      <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: "hsl(240 8% 50%)" }}>
                        <input type="checkbox" checked={!!crmFilter.never_purchased}
                          onChange={(e) => setCrmFilter({ ...crmFilter, never_purchased: e.target.checked || undefined })} />
                        Apenas contatos que <strong>nunca compraram</strong>
                      </label>
                    </div>
                  </div>

                  {/* Inbox behavior filters */}
                  <div>
                    <p className="text-xs font-medium mb-2" style={{ color: "hsl(240 8% 50%)" }}>Comportamento no Inbox</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 42%)" }}>Atendido pelo atendente (ID)</label>
                        <input type="text" placeholder="UUID do atendente"
                          value={crmFilter.inbox_assigned_to || ""}
                          onChange={(e) => setCrmFilter({ ...crmFilter, inbox_assigned_to: e.target.value || undefined })}
                          className="input-field w-full text-xs" />
                      </div>
                      <div>
                        <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 42%)" }}>Departamento (ID)</label>
                        <input type="text" placeholder="UUID do departamento"
                          value={crmFilter.inbox_department || ""}
                          onChange={(e) => setCrmFilter({ ...crmFilter, inbox_department: e.target.value || undefined })}
                          className="input-field w-full text-xs" />
                      </div>
                      <div>
                        <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 42%)" }}>Equipe (ID)</label>
                        <input type="text" placeholder="UUID da equipe"
                          value={crmFilter.inbox_team || ""}
                          onChange={(e) => setCrmFilter({ ...crmFilter, inbox_team: e.target.value || undefined })}
                          className="input-field w-full text-xs" />
                      </div>
                      <div>
                        <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 42%)" }}>Fila (ID)</label>
                        <input type="text" placeholder="UUID da fila"
                          value={crmFilter.inbox_queue || ""}
                          onChange={(e) => setCrmFilter({ ...crmFilter, inbox_queue: e.target.value || undefined })}
                          className="input-field w-full text-xs" />
                      </div>
                      <div>
                        <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 42%)" }}>Tempo de resp. ≤ N segundos</label>
                        <input type="number" min="0" placeholder="ex: 300"
                          value={crmFilter.inbox_response_time_max || ""}
                          onChange={(e) => setCrmFilter({ ...crmFilter, inbox_response_time_max: parseInt(e.target.value) || undefined })}
                          className="input-field w-full text-xs" />
                      </div>
                      <div>
                        <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 42%)" }}>Nº de conversas ≥</label>
                        <input type="number" min="0" placeholder="ex: 3"
                          value={crmFilter.inbox_conversation_count_min || ""}
                          onChange={(e) => setCrmFilter({ ...crmFilter, inbox_conversation_count_min: parseInt(e.target.value) || undefined })}
                          className="input-field w-full text-xs" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-xs block mb-1" style={{ color: "hsl(240 8% 42%)" }}>Último contato após</label>
                        <input type="date"
                          value={crmFilter.inbox_last_contact_after || ""}
                          onChange={(e) => setCrmFilter({ ...crmFilter, inbox_last_contact_after: e.target.value || undefined })}
                          className="input-field w-full text-xs" />
                      </div>
                    </div>
                  </div>

                  {/* Campaign participation */}
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Participou da campanha (ID)</label>
                    <input type="text" placeholder="UUID da campanha"
                      value={crmFilter.participated_campaign_id || ""}
                      onChange={(e) => setCrmFilter({ ...crmFilter, participated_campaign_id: e.target.value || undefined })}
                      className="input-field w-full text-xs" />
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
                            <p key={c.id} className="text-[10px]" style={{ color: "hsl(240 8% 50%)" }}>{c.name} · {c.phone}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl p-3 text-center" style={{ background: "var(--surface-2)", border: "1px dashed hsl(240 12% 14%)" }}>
                      <p className="text-xs" style={{ color: "hsl(240 8% 36%)" }}>Aplique filtros para prévia de contatos</p>
                    </div>
                  )}
                </div>
              )}

              {/* Paste contacts tab */}
              {audienceTab === "contacts" && (
                <div className="space-y-2">
                  <div className="rounded-xl px-3.5 py-2.5" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)" }}>
                    <p className="text-xs" style={{ color: "#60a5fa" }}>
                      {channel === "instagram"
                        ? "Um handle por linha: @perfil ou perfil, Nome"
                        : "Um por linha: 5511999999999 ou 5511999999999, Nome"}
                    </p>
                  </div>
                  <textarea value={recipientsText} onChange={(e) => setRecipientsText(e.target.value)}
                    placeholder={channel === "instagram"
                      ? "@perfil1\n@perfil2, Maria\nperfil3"
                      : "5511999999999\n5511888888888, João"}
                    rows={7} className="input-field w-full resize-none font-mono text-xs" />
                  {parseContacts().length > 0 && (
                    <p className="text-[11px]" style={{ color: "var(--green)" }}>{parseContacts().length} detectados</p>
                  )}
                </div>
              )}

              {/* CSV upload tab */}
              {audienceTab === "csv" && (
                <div className="space-y-3">
                  <div className="rounded-xl px-3.5 py-2.5" style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.12)" }}>
                    <p className="text-xs" style={{ color: "#60a5fa" }}>
                      CSV com colunas: <code className="font-mono">phone,name</code> (header obrigatório)
                    </p>
                  </div>
                  <div
                    className="rounded-xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all"
                    style={{ border: `2px dashed ${csvFile ? "var(--green)" : "hsl(240 12% 18%)"}`, background: csvFile ? "rgba(0,212,106,0.04)" : "var(--surface-2)" }}
                    onClick={() => csvRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleCsvUpload(f); }}>
                    {csvFile ? (
                      <>
                        <CheckCircle2 className="w-6 h-6" style={{ color: "var(--green)" }} />
                        <p className="text-xs font-medium" style={{ color: "hsl(240 15% 85%)" }}>{csvFile.name}</p>
                        <p className="text-[11px]" style={{ color: "var(--green)" }}>{csvRecipients.length} contatos carregados</p>
                      </>
                    ) : (
                      <>
                        <Upload className="w-6 h-6" style={{ color: "hsl(240 8% 36%)" }} />
                        <p className="text-xs" style={{ color: "hsl(240 8% 48%)" }}>Clique ou arraste o arquivo CSV</p>
                      </>
                    )}
                    <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleCsvUpload(e.target.files[0])} />
                  </div>
                </div>
              )}

              {/* Groups tab (WhatsApp) */}
              {audienceTab === "groups" && (() => {
                const filtered = groups
                  .filter((g) => !groupAdminOnly || g.is_admin)
                  .filter((g) => !groupSearch || g.name.toLowerCase().includes(groupSearch.toLowerCase()))
                  .sort((a, b) => groupSort === "members"
                    ? (b.participant_count ?? 0) - (a.participant_count ?? 0)
                    : a.name.localeCompare(b.name));
                return (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)}
                        placeholder="Pesquisar grupos..." className="input-field flex-1 text-xs py-2" />
                      <select value={groupSort} onChange={(e) => setGroupSort(e.target.value as "name" | "members")}
                        className="input-field text-xs py-1.5">
                        <option value="name">Nome</option>
                        <option value="members">Membros</option>
                      </select>
                    </div>
                    {groupsLoading ? (
                      <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "hsl(240 8% 40%)" }} /></div>
                    ) : filtered.length === 0 ? (
                      <div className="rounded-xl py-6 text-center" style={{ border: "1px dashed hsl(240 12% 16%)" }}>
                        <p className="text-xs" style={{ color: "hsl(240 8% 40%)" }}>Nenhum grupo encontrado</p>
                      </div>
                    ) : (
                      <div className="space-y-1 max-h-52 overflow-y-auto">
                        <div className="flex justify-between items-center mb-1">
                          <p className="text-[11px]" style={{ color: "hsl(240 8% 46%)" }}>{selectedGroups.length} selecionados</p>
                          <button onClick={() => setSelectedGroups(
                            filtered.every((g) => selectedGroups.find((x) => x.jid === g.jid))
                              ? selectedGroups.filter((x) => !filtered.find((g) => g.jid === x.jid))
                              : [...selectedGroups.filter((x) => !filtered.find((g) => g.jid === x.jid)), ...filtered]
                          )} className="text-[11px]" style={{ color: "var(--green)" }}>
                            Selecionar todos
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
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate" style={{ color: "hsl(240 15% 85%)" }}>{g.name}</p>
                                <p className="text-[10px] font-mono truncate" style={{ color: "hsl(240 8% 36%)" }}>{g.jid}</p>
                              </div>
                              {g.participant_count != null && (
                                <span className="text-[10px] font-mono flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }}>
                                  {g.participant_count}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Followers / Following (Instagram) */}
              {(audienceTab === "followers" || audienceTab === "following") && (
                <div className="space-y-3">
                  <div className="rounded-xl px-3.5 py-2.5" style={{ background: "rgba(225,48,108,0.06)", border: "1px solid rgba(225,48,108,0.12)" }}>
                    <p className="text-xs" style={{ color: "#e1306c" }}>
                      {audienceTab === "followers"
                        ? "A campanha será disparada para os seguidores do perfil informado."
                        : "A campanha será disparada para os perfis que a conta segue."}
                    </p>
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>
                      Username do perfil * (sem @)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "hsl(240 8% 40%)" }}>@</span>
                      <input value={igUsername} onChange={(e) => setIgUsername(e.target.value.replace("@", ""))}
                        placeholder="meu_perfil" className="input-field w-full pl-7 text-xs font-mono" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 5: Conteúdo (send_message only) ─────────────────────────── */}
          {step === contentStep && needsContent && (
            <>
              {isWABA ? (
                <div className="space-y-3">
                  <div className="rounded-lg p-3 text-xs" style={{ background: "rgba(0,136,255,0.08)", border: "1px solid rgba(0,136,255,0.25)", color: "hsl(240 8% 75%)" }}>
                    <strong style={{ color: "#0088ff" }}>WhatsApp API:</strong> mensagens devem usar template aprovado pela Meta.
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
                        ⚠️ Nenhum template APPROVED. Crie em Instâncias &gt; WABA.
                      </p>
                    )}
                  </div>
                  {selectedTpl && tplBodyText && (
                    <div className="rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid hsl(240 12% 14%)" }}>
                      <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "hsl(240 8% 50%)" }}>Body</p>
                      <p className="text-xs whitespace-pre-wrap" style={{ color: "hsl(240 15% 80%)" }}>{tplBodyText}</p>
                    </div>
                  )}
                  {tplBodyVars.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-medium" style={{ color: "hsl(240 8% 70%)" }}>Variáveis</p>
                      {tplBodyVars.map((v) => (
                        <div key={v} className="flex items-center gap-2">
                          <code className="text-[11px] font-mono shrink-0" style={{ color: "hsl(240 8% 70%)", minWidth: "5rem" }}>{`{{${v}}}`}</code>
                          <input value={tplVars[v] || ""}
                            onChange={(e) => setTplVars((p) => ({ ...p, [v]: e.target.value }))}
                            placeholder={v === "1" || v === "name" ? "{{contact.name}}" : "valor ou {{contact.xxx}}"}
                            className="input-field flex-1 text-xs font-mono" />
                        </div>
                      ))}
                    </div>
                  )}
                  {tplHasMediaHeader && (
                    <div>
                      <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>URL da mídia do header *</label>
                      <input value={tplHeaderURL} onChange={(e) => setTplHeaderURL(e.target.value)}
                        placeholder="https://..." className="input-field w-full text-xs font-mono" />
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs font-medium block mb-2" style={{ color: "hsl(240 8% 50%)" }}>Tipo</label>
                    <div className="grid grid-cols-4 gap-2">
                      {MSG_TYPES.map(({ value, label, icon: Icon }) => (
                        <button key={value} type="button" onClick={() => { setMsgType(value); setMediaFile(null); }}
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
                        placeholder={"Digite a mensagem...\n\nSuporta Liquid: {{contact.name}}"}
                        rows={5} className="input-field w-full resize-none" />
                    </div>
                  )}

                  {(msgType === "image" || msgType === "audio" || msgType === "document") && (
                    <div>
                      <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>
                        {msgType === "image" ? "Imagem *" : msgType === "audio" ? "Áudio *" : "Documento *"}
                      </label>
                      <div
                        className="rounded-xl p-4 flex flex-col items-center gap-2 cursor-pointer"
                        style={{ border: `2px dashed ${mediaFile ? "var(--green)" : "hsl(240 12% 16%)"}`, background: mediaFile ? "rgba(0,212,106,0.04)" : "var(--surface-2)" }}
                        onClick={() => fileRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setMediaFile(f); }}>
                        {mediaFile ? (
                          <>
                            <CheckCircle2 className="w-5 h-5" style={{ color: "var(--green)" }} />
                            <p className="text-xs font-medium" style={{ color: "hsl(240 15% 80%)" }}>{mediaFile.name}</p>
                          </>
                        ) : (
                          <>
                            {msgType === "image" ? <Image className="w-5 h-5" style={{ color: "hsl(240 8% 36%)" }} /> : msgType === "audio" ? <Mic className="w-5 h-5" style={{ color: "hsl(240 8% 36%)" }} /> : <File className="w-5 h-5" style={{ color: "hsl(240 8% 36%)" }} />}
                            <p className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>Clique ou arraste</p>
                          </>
                        )}
                        <input ref={fileRef} type="file" className="hidden"
                          accept={msgType === "image" ? "image/*" : msgType === "audio" ? "audio/*" : "*"}
                          onChange={(e) => e.target.files?.[0] && setMediaFile(e.target.files[0])} />
                      </div>
                    </div>
                  )}

                  {msgType === "image" && (
                    <div>
                      <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Legenda (opcional)</label>
                      <textarea value={caption} onChange={(e) => setCaption(e.target.value)}
                        rows={2} className="input-field w-full resize-none" />
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── Step 6 / 5: Agendamento & Segurança ─────────────────────────── */}
          {step === scheduleStep && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Data de início</label>
                  <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input-field w-full text-xs" />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Data de fim</label>
                  <input type="datetime-local" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input-field w-full text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Ações totais / destinatário</label>
                  <input type="number" min={1} max={999} value={timesTotal}
                    onChange={(e) => setTimesTotal(Math.max(1, Number(e.target.value)))} className="input-field w-full" />
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 50%)" }}>Ações por dia</label>
                  <input type="number" min={1} max={99} value={timesPerDay}
                    onChange={(e) => setTimesPerDay(Math.max(1, Number(e.target.value)))} className="input-field w-full" />
                </div>
              </div>

              {/* Safety block */}
              <div className="rounded-xl p-3.5 space-y-3" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)" }}>
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-3.5 h-3.5" style={{ color: "#f59e0b" }} />
                  <span className="text-xs font-medium" style={{ color: "#f59e0b" }}>Segurança & Delays</span>
                  {channel === "instagram" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "rgba(225,48,108,0.12)", color: "#e1306c" }}>
                      Instagram — use delays generosos
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Delay mínimo (seg)</label>
                    <input type="number" min={1} max={3600} value={delayMin}
                      onChange={(e) => { const v = Math.max(1, Number(e.target.value)); setDelayMin(v); if (delayMax < v) setDelayMax(v + 5); }}
                      className="input-field w-full" />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>Delay máximo (seg)</label>
                    <input type="number" min={delayMin} max={3600} value={delayMax}
                      onChange={(e) => setDelayMax(Math.max(delayMin, Number(e.target.value)))}
                      className="input-field w-full" />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[10px]" style={{ color: "hsl(240 8% 40%)" }}>
                  <Shuffle className="w-3 h-3" />
                  Delay aleatório entre {delayMin}s e {delayMax}s por ação
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 50%)" }}>
                    Limite diário por conta <span className="font-normal" style={{ color: "hsl(240 8% 36%)" }}>(0 = ilimitado)</span>
                  </label>
                  <input type="number" min={0} max={9999} value={dailyLimit}
                    onChange={(e) => setDailyLimit(Math.max(0, Number(e.target.value)))}
                    className="input-field w-full" />
                </div>
              </div>

              {/* Schedule hours */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium" style={{ color: "hsl(240 8% 50%)" }}>
                    Horários de envio
                    {selectedHours.length > 0 && (
                      <span className="ml-1.5" style={{ color: "var(--green)" }}>({selectedHours.map((h) => `${h}h`).join(" ")})</span>
                    )}
                  </label>
                  <div className="flex gap-2">
                    <button className="text-[10px]" style={{ color: "hsl(240 8% 42%)" }} onClick={() => setSelectedHours([])}>qualquer hora</button>
                    <button className="text-[10px]" style={{ color: "hsl(240 8% 42%)" }} onClick={() => setSelectedHours([8, 9, 10, 11, 14, 15, 16, 17])}>comercial</button>
                  </div>
                </div>
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

        {/* Footer */}
        <div className="flex gap-2 px-6 pb-5">
          {step > 1 ? (
            <button onClick={handleBack}
              className="flex items-center gap-1.5 text-sm px-4 py-2.5 rounded-xl transition-all"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "hsl(240 8% 52%)" }}>
              <ChevronLeft className="w-3.5 h-3.5" /> Voltar
            </button>
          ) : (
            <button onClick={onClose}
              className="flex-1 text-sm py-2.5 rounded-xl"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-default)", color: "hsl(240 8% 52%)" }}>
              Cancelar
            </button>
          )}

          {step < totalSteps ? (
            <button onClick={handleNext} disabled={!canNext(step)}
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

// ─── Glass style constants ─────────────────────────────────────────────────────

const glassCard: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)",
  backdropFilter: "blur(20px) saturate(180%)",
  WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "20px",
  boxShadow: "0 8px 24px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.10)",
  transition: "all 0.35s cubic-bezier(0.16,1,0.3,1)",
};

const glassPill: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: "10px",
};

const glassBtn: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(0,212,106,0.20), rgba(0,212,106,0.08))",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid rgba(0,212,106,0.30)",
  boxShadow: "0 4px 16px rgba(0,212,106,0.18), inset 0 1px 0 rgba(255,255,255,0.12)",
};

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
    if (!await showConfirm(`Deletar "${campaign.name}"?`, { title: "Deletar campanha", confirmLabel: "Deletar" })) return;
    try { await campaignsApi.delete(campaign.id); toast.success("Campanha removida"); onAction(); }
    catch { toast.error("Erro ao remover"); }
  };

  const msgIconMap: Record<string, React.ElementType> = { text: FileText, image: Image, audio: Mic, document: File };
  const MsgIcon = msgIconMap[campaign.message_type] ?? FileText;

  // Channel color/icon
  const chMeta = CHANNEL_META[campaign.channel ?? "whatsapp"] ?? CHANNEL_META.whatsapp;
  const ChIcon = chMeta.icon;

  const actionLabels: Record<string, string> = {
    send_message: "mensagem", follow: "seguir", unfollow: "unfollow", like: "curtir", comment: "comentar",
  };

  const [hovered, setHovered] = React.useState(false);

  return (
    <div className="rounded-2xl overflow-hidden relative"
      style={{
        ...glassCard,
        ...(hovered ? {
          transform: "translateY(-2px)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.40), 0 0 0 1px rgba(0,212,106,0.08), inset 0 1px 0 rgba(255,255,255,0.12)",
        } : {}),
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="absolute top-0 left-0 right-0 h-px pointer-events-none"
        style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)" }} />
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-medium text-sm truncate" style={{ color: "hsl(240 15% 93%)" }}>{campaign.name}</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 text-[10px]" style={{ color: chMeta.color }}>
                <ChIcon className="w-3 h-3" />
                {chMeta.label}
              </span>
              <span className="flex items-center gap-1 text-[10px]" style={{ color: "hsl(240 8% 40%)" }}>
                <MsgIcon className="w-3 h-3" />
                {actionLabels[campaign.action_type as string] ?? campaign.message_type}
              </span>
              <span className="flex items-center gap-1 text-[10px]" style={{ color: "hsl(240 8% 40%)" }}>
                {campaign.recipient_type === "groups" ? <Users2 className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                {campaign.recipient_type}
              </span>
            </div>
          </div>
          <span className="ml-3 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium flex-shrink-0"
            style={{ ...glassPill, color: s.color, border: `1px solid ${s.color}30` }}>
            <StatusIcon className={cn("w-3 h-3", campaign.status === "running" && "animate-spin")} />
            {s.label}
          </span>
        </div>

        {(campaign.start_date || campaign.end_date || campaign.times_total > 1) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {campaign.start_date && (
              <span className="text-[10px] px-2 py-0.5 rounded font-mono" style={{ background: "var(--surface-2)", color: "hsl(240 8% 40%)" }}>
                {fmtDate(campaign.start_date)}
              </span>
            )}
            {campaign.end_date && (
              <span className="text-[10px] px-2 py-0.5 rounded font-mono" style={{ background: "var(--surface-2)", color: "hsl(240 8% 40%)" }}>
                até {fmtDate(campaign.end_date)}
              </span>
            )}
            {campaign.times_total > 1 && (
              <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: "rgba(167,139,250,0.08)", color: "#a78bfa" }}>
                {campaign.times_total}× total · {campaign.times_per_day}×/dia
              </span>
            )}
            {hours.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded font-mono" style={{ background: "rgba(96,165,250,0.08)", color: "#60a5fa" }}>
                {hours.map((h) => `${h}h`).join(" ")}
              </span>
            )}
          </div>
        )}

        <div className="mb-3">
          <div className="flex justify-between text-[11px] mb-1.5" style={{ color: "hsl(240 8% 46%)" }}>
            <span className="flex items-center gap-1">
              <Users className="w-3 h-3" /> {campaign.total_count} destinatários
            </span>
            <span>{campaign.sent_count} ok · {campaign.failed_count} falhos</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progress}%`, background: campaign.failed_count > 0 ? "#f59e0b" : "var(--green)" }} />
          </div>
        </div>

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
              className="flex items-center gap-1.5 text-xs font-medium py-2 px-3 rounded-xl"
              style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.15)", color: "var(--green)" }}>
              <Play className="w-3 h-3" /> Iniciar
            </button>
          )}
          {campaign.status === "running" && (
            <button onClick={handlePause}
              className="flex items-center gap-1.5 text-xs font-medium py-2 px-3 rounded-xl"
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
            style={{ ...glassBtn, color: "var(--green)", borderRadius: "12px" }}>
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
          <div className="mb-6 opacity-60">
            <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
              <path d="M24 48 L24 72 L40 72 L68 86 L68 34 L40 48 Z" stroke="var(--text-3)" strokeWidth="2.5" strokeLinejoin="round" fill="none" />
              <rect x="16" y="50" width="8" height="20" rx="3" stroke="var(--text-3)" strokeWidth="2" fill="none" />
              <path d="M76 50 Q84 60 76 70" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" fill="none" opacity="0.9" />
              <path d="M84 44 Q96 60 84 76" stroke="var(--green)" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6" />
              <path d="M92 38 Q108 60 92 82" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" fill="none" opacity="0.4" />
              <circle cx="46" cy="60" r="3" fill="var(--green)" opacity="0.6" />
            </svg>
          </div>
          <h3 className="text-base font-semibold mb-2" style={{ color: "var(--text-1)" }}>Nenhuma campanha criada</h3>
          <p className="text-sm mb-6 max-w-xs" style={{ color: "var(--text-3)" }}>
            Dispare mensagens em massa para sua base de contatos
          </p>
          <button onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
            style={{ background: "var(--green-dim)", color: "var(--green)", border: "1px solid var(--green-border)" }}>
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
