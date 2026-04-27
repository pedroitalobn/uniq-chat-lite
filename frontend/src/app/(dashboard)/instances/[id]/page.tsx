"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { instancesApi, webhooksApi, messagesApi, settingsApi, mcpApi, recoveryApi, tiktokApi, type WebhookPayload } from "@/lib/api";
import {
  Smartphone, ArrowLeft, Globe, AlertTriangle,
  QrCode, Power, Trash2, Plus, X, Send, ChevronRight,
  Webhook as WebhookIcon, Activity, Settings, Loader2, Copy, Check,
  RefreshCw, Bot, ChevronDown, ChevronUp, Image, FileText, Music,
  Video, MapPin, User, Smile, BarChart2, Sticker, MessageSquareText,
  MousePointerClick, ShieldAlert, Camera, Users, Phone, RotateCcw, Download,
  Eye, EyeOff, Lock, LogIn, List, LayoutGrid, Banknote,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { showConfirm } from "@/lib/confirm";
import type { Instance, InstanceSettings, MessageLog, InstanceProfile, InstanceContactLookup, Webhook } from "@/types";
import Link from "next/link";
import { MessageButtonsBuilder, type MessageButton, validateButtons } from "@/components/messages/MessageButtonsBuilder";
import { QRCodeModal } from "@/components/instances/QRCodeModal";
import ProxyConfigForm from "@/components/instances/ProxyConfigForm";

type Tab = "geral" | "proxy" | "webhooks" | "logs" | "recovery" | "dm" | "actions" | "scraping" | "posts" | "stories" | "media";

const STATUS_MAP: Record<string, { label: string; dot: string; bg: string; color: string }> = {
  connected:    { label: "Conectado",    dot: "#00d46a", bg: "rgba(0,212,106,0.08)",   color: "#00d46a" },
  connecting:   { label: "Conectando",   dot: "#fbbf24", bg: "rgba(251,191,36,0.08)",  color: "#fbbf24" },
  disconnected: { label: "Desconectado", dot: "#64748b", bg: "rgba(100,116,139,0.08)", color: "#64748b" },
  banned:       { label: "Banido",       dot: "#ef4444", bg: "rgba(239,68,68,0.08)",   color: "#ef4444" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.disconnected;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ background: s.bg, color: s.color, border: `1px solid ${s.dot}30` }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

// ─── Shared helpers ───────────────────────────────────────────────────────────
const ALL_EVENTS = [
  // Mensagens
  "message.received", "message.sent", "message.status",
  "message.reaction", "message.edited", "message.deleted",
  // Instância / Conexão
  "instance.connected", "instance.disconnected", "instance.qr",
  "instance.paired", "instance.banned",
  // Presença
  "presence.update", "chat.presence",
  // Grupos
  "group.join", "group.update",
  // Chamadas
  "call.incoming", "call.accepted", "call.terminate", "call.rejected",
  // Contatos / Perfil
  "contact.update", "contact.pushname", "picture.update",
  // Newsletter
  "newsletter.join", "newsletter.leave", "newsletter.update",
  // Histórico
  "history.sync",
];

const EVENT_GROUPS = [
  { label: "Mensagens", events: ["message.received","message.sent","message.status","message.reaction","message.edited","message.deleted"] },
  { label: "Conexão", events: ["instance.connected","instance.disconnected","instance.qr","instance.paired","instance.banned"] },
  { label: "Presença", events: ["presence.update","chat.presence"] },
  { label: "Grupos", events: ["group.join","group.update"] },
  { label: "Chamadas", events: ["call.incoming","call.accepted","call.terminate","call.rejected"] },
  { label: "Contatos", events: ["contact.update","contact.pushname","picture.update"] },
  { label: "Newsletter", events: ["newsletter.join","newsletter.leave","newsletter.update"] },
  { label: "Histórico", events: ["history.sync"] },
];

const DEFAULT_EVENTS = ["message.received","message.sent","message.status","instance.connected","instance.disconnected"];

function CheckboxField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <div
        className="w-4 h-4 rounded flex-shrink-0 transition-all"
        style={{
          border: checked ? "1px solid rgba(96,165,250,0.5)" : "1px solid hsl(240 12% 22%)",
          background: checked ? "rgba(96,165,250,0.15)" : "transparent",
        }}
        onClick={() => onChange(!checked)}
      >
        {checked && <svg className="w-full h-full p-0.5" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
      </div>
      <span className="text-xs" style={{ color: "hsl(240 8% 52%)" }}>{label}</span>
    </label>
  );
}

// ─── Bridge toggle helper ─────────────────────────────────────────────────────
function BridgeToggle({ label, color, enabled, onToggle, children }: {
  label: string; color: string; enabled: boolean;
  onToggle: () => void; children?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${enabled ? color + "30" : "hsl(240 12% 13%)"}` }}>
      <div className="flex items-center justify-between px-3 py-2.5"
        style={{ background: enabled ? color + "08" : "rgba(255,255,255,0.02)" }}>
        <span className="text-xs font-semibold" style={{ color: enabled ? color : "hsl(240 8% 42%)" }}>{label}</span>
        <button onClick={onToggle}
          className="relative flex-shrink-0 rounded-full transition-colors"
          style={{ background: enabled ? color : "hsl(240 12% 18%)", width: "2rem", height: "1.125rem" }}>
          <span className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform"
            style={{ transform: enabled ? "translateX(0.875rem)" : "translateX(0)" }} />
        </button>
      </div>
      {enabled && children && (
        <div className="px-3 pb-3 pt-1 space-y-2" style={{ background: "rgba(255,255,255,0.01)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Build a complete webhook payload from current data + overrides (prevents full-replace wipe)
function toPayload(wh: Webhook, overrides: WebhookPayload = {}): WebhookPayload {
  let events: string[] = [];
  try { events = JSON.parse(wh.events); } catch { /* empty */ }
  return {
    name: wh.name, url: wh.url, events, is_active: wh.is_active,
    ignore_groups: wh.ignore_groups, ignore_self: wh.ignore_self, ignore_api_sent: wh.ignore_api_sent,
    rabbitmq_enabled: wh.rabbitmq_enabled, amqp_url: wh.amqp_url, exchange: wh.exchange, routing_key: wh.routing_key,
    nats_enabled: wh.nats_enabled, nats_url: wh.nats_url, nats_subject: wh.nats_subject,
    ws_enabled: wh.ws_enabled, ws_client_url: wh.ws_client_url,
    ...overrides,
  };
}

// ─── WebhookCard ──────────────────────────────────────────────────────────────
function WebhookCard({ wh, instanceId, onDelete }: { wh: Webhook; instanceId: string; onDelete: () => void }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  // Bridge state — initialized from current webhook data
  const [rmq, setRmq] = useState({ url: wh.amqp_url || "", exchange: wh.exchange || "uniqchat", key: wh.routing_key || "" });
  const [nats, setNats] = useState({ url: wh.nats_url || "", subject: wh.nats_subject || "", token: "" });
  const [ws, setWs] = useState({ url: wh.ws_client_url || "", token: "" });

  const evList: string[] = (() => { try { return JSON.parse(wh.events); } catch { return []; } })();

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof webhooksApi.update>[2]) =>
      webhooksApi.update(instanceId, wh.id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["webhooks", instanceId] }),
    onError: () => toast.error("Erro ao atualizar webhook"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => webhooksApi.delete(instanceId, wh.id),
    onSuccess: () => {
      toast.success("Webhook removido");
      onDelete();
    },
  });

  const labelStyle = { color: "hsl(240 8% 48%)" };

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(240 18% 5.5%)", border: "1px solid hsl(240 12% 13%)" }}>
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {wh.name && <span className="text-sm font-semibold" style={{ color: "hsl(240 15% 88%)" }}>{wh.name}</span>}
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
              style={{ background: "rgba(96,165,250,0.08)", color: "#60a5fa" }}>HTTP</span>
            {wh.rabbitmq_enabled && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: "rgba(249,115,22,0.08)", color: "#fb923c" }}>RMQ</span>}
            {wh.nats_enabled && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: "rgba(167,139,250,0.08)", color: "#a78bfa" }}>NATS</span>}
            {wh.ws_enabled && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase" style={{ background: "rgba(52,211,153,0.08)", color: "#34d399" }}>WS</span>}
          </div>
          <p className="text-xs font-mono truncate" style={{ color: "hsl(240 8% 44%)" }}>{wh.url}</p>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {evList.slice(0, 5).map(ev => (
              <span key={ev} className="text-[9px] px-1.5 py-0.5 rounded font-mono"
                style={{ background: "rgba(255,255,255,0.04)", color: "hsl(240 8% 38%)" }}>{ev}</span>
            ))}
            {evList.length > 5 && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono"
              style={{ background: "rgba(255,255,255,0.04)", color: "hsl(240 8% 38%)" }}>+{evList.length - 5}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Active toggle */}
          <button onClick={() => updateMutation.mutate(toPayload(wh, { is_active: !wh.is_active }))}
            className="relative flex-shrink-0 rounded-full transition-colors"
            style={{ background: wh.is_active ? "var(--green)" : "hsl(240 12% 18%)", width: "2rem", height: "1.125rem" }}>
            <span className="absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform"
              style={{ transform: wh.is_active ? "translateX(0.875rem)" : "translateX(0)" }} />
          </button>
          <button onClick={() => setExpanded(e => !e)} className="p-1.5 rounded-lg"
            style={{ color: "hsl(240 8% 38%)" }}>
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}
            className="p-1.5 rounded-lg transition-colors" style={{ color: "hsl(240 8% 38%)" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
            onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded bridge config */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t" style={{ borderColor: "hsl(240 12% 11%)" }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider mt-3 mb-2" style={{ color: "hsl(240 8% 36%)" }}>
            Bridges — também enviar para:
          </p>

          {/* RabbitMQ bridge */}
          <BridgeToggle label="RabbitMQ" color="#fb923c"
            enabled={wh.rabbitmq_enabled}
            onToggle={() => updateMutation.mutate(toPayload(wh, { rabbitmq_enabled: !wh.rabbitmq_enabled, amqp_url: rmq.url, exchange: rmq.exchange, routing_key: rmq.key }))}>
            <input className="input-field w-full text-xs" placeholder="amqp://user:pass@host:5672/" value={rmq.url}
              onChange={e => setRmq(p => ({ ...p, url: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field w-full text-xs" placeholder="Exchange" value={rmq.exchange}
                onChange={e => setRmq(p => ({ ...p, exchange: e.target.value }))} />
              <input className="input-field w-full text-xs" placeholder="Routing Key (evento)" value={rmq.key}
                onChange={e => setRmq(p => ({ ...p, key: e.target.value }))} />
            </div>
            <button className="text-[10px] px-2 py-1 rounded-lg transition-all"
              style={{ background: "rgba(249,115,22,0.1)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.2)" }}
              onClick={() => updateMutation.mutate(toPayload(wh, { rabbitmq_enabled: true, amqp_url: rmq.url, exchange: rmq.exchange, routing_key: rmq.key }))}>
              Salvar configuração
            </button>
          </BridgeToggle>

          {/* NATS bridge */}
          <BridgeToggle label="NATS" color="#a78bfa"
            enabled={wh.nats_enabled}
            onToggle={() => updateMutation.mutate(toPayload(wh, { nats_enabled: !wh.nats_enabled, nats_url: nats.url, nats_subject: nats.subject }))}>
            <input className="input-field w-full text-xs" placeholder="nats://host:4222" value={nats.url}
              onChange={e => setNats(p => ({ ...p, url: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <input className="input-field w-full text-xs" placeholder="Subject" value={nats.subject}
                onChange={e => setNats(p => ({ ...p, subject: e.target.value }))} />
              <input className="input-field w-full text-xs" type="password" placeholder="Token (opcional)" value={nats.token}
                onChange={e => setNats(p => ({ ...p, token: e.target.value }))} />
            </div>
            <button className="text-[10px] px-2 py-1 rounded-lg transition-all"
              style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa", border: "1px solid rgba(167,139,250,0.2)" }}
              onClick={() => updateMutation.mutate(toPayload(wh, { nats_enabled: true, nats_url: nats.url, nats_subject: nats.subject, nats_token: nats.token || undefined }))}>
              Salvar configuração
            </button>
          </BridgeToggle>

          {/* WebSocket bridge */}
          <BridgeToggle label="WebSocket Client" color="#34d399"
            enabled={wh.ws_enabled}
            onToggle={() => updateMutation.mutate(toPayload(wh, { ws_enabled: !wh.ws_enabled, ws_client_url: ws.url }))}>
            <input className="input-field w-full text-xs" placeholder="https://servidor.com/events" value={ws.url}
              onChange={e => setWs(p => ({ ...p, url: e.target.value }))} />
            <input className="input-field w-full text-xs" type="password" placeholder="Token Bearer (opcional)" value={ws.token}
              onChange={e => setWs(p => ({ ...p, token: e.target.value }))} />
            <button className="text-[10px] px-2 py-1 rounded-lg transition-all"
              style={{ background: "rgba(52,211,153,0.1)", color: "#34d399", border: "1px solid rgba(52,211,153,0.2)" }}
              onClick={() => updateMutation.mutate(toPayload(wh, { ws_enabled: true, ws_client_url: ws.url, ws_client_token: ws.token || undefined }))}>
              Salvar configuração
            </button>
          </BridgeToggle>
        </div>
      )}
    </div>
  );
}

// ─── Integrações tab ──────────────────────────────────────────────────────────
function WebhooksTab({ instanceId, instance }: { instanceId: string; instance: Instance }) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [ignoreGroups, setIgnoreGroups] = useState(false);
  const [ignoreSelf, setIgnoreSelf] = useState(false);
  const [ignoreAPISent, setIgnoreAPISent] = useState(false);
  const [copiedMCP, setCopiedMCP] = useState(false);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
  const mcpSSEUrl = `${apiBaseUrl}/instances/${instanceId}/mcp/sse?token=<API_KEY>`;
  const claudeConfig = JSON.stringify({
    mcpServers: {
      whatsapp: {
        url: `${apiBaseUrl}/instances/${instanceId}/mcp/sse?token=<API_KEY>`,
      }
    }
  }, null, 2);

  const { data: webhooks = [], isLoading } = useQuery<Webhook[]>({
    queryKey: ["webhooks", instanceId],
    queryFn: () => webhooksApi.list(instanceId).then((r) => r.data),
  });

  const { data: tools } = useQuery<{ tools: unknown[] }>({
    queryKey: ["mcp-tools", instanceId],
    queryFn: () => mcpApi.tools(instanceId).then((r) => r.data),
    enabled: instance.mcp_enabled,
    retry: false,
  });

  const createMutation = useMutation({
    mutationFn: () => webhooksApi.create(instanceId, {
      name, url, events: selectedEvents,
      ignore_groups: ignoreGroups, ignore_self: ignoreSelf, ignore_api_sent: ignoreAPISent,
    }),
    onSuccess: () => {
      toast.success("Webhook criado!");
      queryClient.invalidateQueries({ queryKey: ["webhooks", instanceId] });
      setCreating(false); setName(""); setUrl(""); setSelectedEvents(DEFAULT_EVENTS);
      setIgnoreGroups(false); setIgnoreSelf(false); setIgnoreAPISent(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao criar webhook";
      toast.error(msg);
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (data: Partial<InstanceSettings>) => settingsApi.update(instanceId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["instance", instanceId] }),
    onError: () => toast.error("Erro ao salvar"),
  });

  const toggleEvent = (e: string) =>
    setSelectedEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e]);
  const toggleGroup = (evs: string[]) => {
    const allSel = evs.every(e => selectedEvents.includes(e));
    setSelectedEvents(prev => allSel ? prev.filter(e => !evs.includes(e)) : [...new Set([...prev, ...evs])]);
  };

  const labelStyle = { color: "hsl(240 8% 52%)" };
  const cardStyle = { background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 15%)" };

  if (isLoading) return <div className="skeleton h-40 rounded-2xl" />;

  return (
    <div className="space-y-6 animate-fade-in-up">

      {/* ── Webhooks section ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "hsl(240 15% 85%)" }}>Webhooks da Instância</h3>
            <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 40%)" }}>
              Receba eventos específicos desta instância (mensagens, status, conexões)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a href="/integrations?tab=webhook" className="text-[10px] px-2 py-1.5 rounded-lg" style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 48)" }}>
              Ver globais
            </a>
            <button
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl transition-all"
              style={{ background: "var(--green)", color: "#03170a" }}
              onMouseEnter={e => (e.currentTarget.style.filter = "brightness(1.1)")}
              onMouseLeave={e => (e.currentTarget.style.filter = "none")}
            >
              <Plus className="w-3.5 h-3.5" /> Novo
            </button>
          </div>
        </div>

        <div className="rounded-xl p-3 mb-3" style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.14)" }}>
          <p className="text-[11px]" style={{ color: "hsl(217, 91%, 78%)" }}>
            Na criação do webhook, a API retorna o <span className="font-mono">secret</span> uma única vez. As entregas HTTP saem assinadas com o header <span className="font-mono">X-Webhook-Signature: sha256=...</span>.
          </p>
        </div>

        {creating && (
          <div className="rounded-2xl p-5 space-y-4 mb-3 animate-fade-in-up" style={cardStyle}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold" style={{ color: "hsl(240 15% 90%)" }}>Novo Webhook</h4>
              <button onClick={() => setCreating(false)} style={{ color: "hsl(240 8% 42%)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={labelStyle}>Nome (opcional)</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Meu webhook" className="input-field w-full" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={labelStyle}>URL *</label>
              <input type="url" value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://servidor.com/webhook" className="input-field w-full" />
            </div>
            {/* Events */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-xs font-medium" style={labelStyle}>Eventos</label>
                <div className="flex gap-2">
                  <button className="text-[10px] px-2.5 py-1.5 rounded-lg font-medium transition-colors" style={{ background: "var(--green)", color: "#03170a" }} onClick={() => setSelectedEvents(ALL_EVENTS)}>Todos</button>
                  <button className="text-[10px] px-2.5 py-1.5 rounded-lg font-medium transition-colors" style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444" }} onClick={() => setSelectedEvents([])}>Limpar</button>
                </div>
              </div>
              <div className="space-y-3">
                {EVENT_GROUPS.map(group => {
                  const allSel = group.events.every(e => selectedEvents.includes(e));
                  const noneSel = group.events.every(e => !selectedEvents.includes(e));
                  return (
                    <div key={group.label}>
                      <div className="flex items-center justify-between mb-2">
                        <button onClick={() => toggleGroup(group.events)}
                          className="text-[11px] font-semibold uppercase tracking-wider px-2 py-1 rounded-lg transition-all"
                          style={{ 
                            background: allSel ? "var(--green)" : noneSel ? "hsl(240 12% 12%)" : "rgba(251,191,36,0.15)", 
                            color: allSel ? "#03170a" : noneSel ? "hsl(240 8% 48)" : "#fbbf24" 
                          }}>
                          {allSel ? "✓ Todos" : noneSel ? "Nenhum" : "Parcial"}
                        </button>
                        <span className="text-[10px]" style={{ color: "hsl(240 8% 38)" }}>
                          {group.events.filter(e => selectedEvents.includes(e)).length}/{group.events.length}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.events.map(ev => {
                          const isSelected = selectedEvents.includes(ev);
                          return (
                            <button key={ev} type="button" onClick={() => toggleEvent(ev)}
                              className="text-[11px] py-1.5 rounded-lg font-mono transition-all"
                              style={isSelected
                                ? { background: "var(--green)", border: "1px solid var(--green)", color: "#03170a" }
                                : { background: "hsl(240 12% 10%)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 8% 48)" }}>
                              {ev}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Filters */}
            <div className="space-y-2">
              <CheckboxField label="Ignorar mensagens de grupos" checked={ignoreGroups} onChange={setIgnoreGroups} />
              <CheckboxField label="Ignorar ações do próprio número" checked={ignoreSelf} onChange={setIgnoreSelf} />
              <CheckboxField label="Anti-loop: ignorar mensagens enviadas via API" checked={ignoreAPISent} onChange={setIgnoreAPISent} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setCreating(false)} className="btn-ghost flex-1 py-2 text-sm">Cancelar</button>
              <button onClick={() => createMutation.mutate()} disabled={!url.trim() || selectedEvents.length === 0 || createMutation.isPending}
                className="btn-primary flex-1 py-2 text-sm disabled:opacity-40">
                {createMutation.isPending ? "Criando..." : "Criar"}
              </button>
            </div>
          </div>
        )}

        {webhooks.length === 0 && !creating ? (
          <div className="rounded-2xl p-8 text-center" style={{ background: "hsl(240 18% 5.5%)", border: "1px dashed hsl(240 12% 14%)" }}>
            <WebhookIcon className="w-6 h-6 mx-auto mb-2" style={{ color: "hsl(240 8% 28%)" }} />
            <p className="text-xs" style={{ color: "hsl(240 8% 40%)" }}>Nenhum webhook. Clique em Novo para criar.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {webhooks.map(wh => (
              <WebhookCard key={wh.id} wh={wh} instanceId={instanceId}
                onDelete={() => queryClient.invalidateQueries({ queryKey: ["webhooks", instanceId] })} />
            ))}
          </div>
        )}
      </div>

      {/* ── MCP section ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Bot className="w-4 h-4" style={{ color: "hsl(240 8% 50%)" }} />
          <div className="flex-1">
            <h3 className="text-sm font-semibold" style={{ color: "hsl(240 15% 85%)" }}>MCP para IA</h3>
            <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 40%)" }}>
              Conecte IAs (Claude, GPT, etc.) ao WhatsApp via Model Context Protocol
            </p>
          </div>
          <button
            onClick={() => settingsMutation.mutate({ mcp_enabled: !instance.mcp_enabled } as Partial<InstanceSettings>)}
            disabled={settingsMutation.isPending}
            className="relative flex-shrink-0 rounded-full transition-colors disabled:opacity-50"
            style={{ background: instance.mcp_enabled ? "var(--green)" : "hsl(240 12% 18%)", width: "2.5rem", height: "1.375rem" }}>
            <span className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
              style={{ transform: instance.mcp_enabled ? "translateX(1.125rem)" : "translateX(0)" }} />
          </button>
        </div>

        {instance.mcp_enabled && (
          <div className="rounded-2xl p-4 space-y-4" style={cardStyle}>
            {/* SSE Endpoint */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "hsl(240 8% 40%)" }}>
                Endpoint SSE
              </label>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid hsl(240 12% 14%)" }}>
                <code className="text-[10px] flex-1 truncate font-mono" style={{ color: "#60a5fa" }}>{mcpSSEUrl}</code>
                <button onClick={() => { navigator.clipboard.writeText(mcpSSEUrl); setCopiedMCP(true); setTimeout(() => setCopiedMCP(false), 2000); }}>
                  {copiedMCP ? <Check className="w-3.5 h-3.5" style={{ color: "var(--green)" }} /> : <Copy className="w-3.5 h-3.5" style={{ color: "hsl(240 8% 40%)" }} />}
                </button>
              </div>
              <p className="text-[10px] mt-1" style={{ color: "hsl(240 8% 34%)" }}>
                Substitua &lt;API_KEY&gt; por uma chave de API válida
              </p>
            </div>

            {/* Tools list */}
            {tools && (tools.tools as Array<{ name: string; description: string }>).length > 0 && (
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(240 8% 40%)" }}>
                  Ferramentas disponíveis
                </label>
                <div className="space-y-1.5">
                  {(tools.tools as Array<{ name: string; description: string }>).map(t => (
                    <div key={t.name} className="flex items-start gap-2 px-2 py-1.5 rounded-lg"
                      style={{ background: "rgba(255,255,255,0.02)" }}>
                      <code className="text-[10px] font-mono font-semibold flex-shrink-0" style={{ color: "#a78bfa" }}>{t.name}</code>
                      <span className="text-[10px]" style={{ color: "hsl(240 8% 44%)" }}>{t.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Claude Desktop config */}
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1.5" style={{ color: "hsl(240 8% 40%)" }}>
                Config Claude Desktop / claude_desktop_config.json
              </label>
              <pre className="text-[9px] p-3 rounded-xl overflow-x-auto font-mono"
                style={{ background: "rgba(0,0,0,0.3)", color: "hsl(240 8% 56%)", border: "1px solid hsl(240 12% 12%)" }}>
                {claudeConfig}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Logs tab ─────────────────────────────────────────────────────────────────
function LogsTab({ instanceId }: { instanceId: string }) {
  const { data, isLoading } = useQuery<{ data: MessageLog[]; total: number }>({
    queryKey: ["messages", instanceId],
    queryFn: () => messagesApi.list(instanceId, { limit: 50 }).then((r) => r.data),
    refetchInterval: 10_000,
  });

  const messages = data?.data ?? [];

  if (isLoading) return <div className="skeleton h-40 rounded-2xl" />;

  return (
    <div className="space-y-2 animate-fade-in-up">
      {messages.length === 0 ? (
        <div
          className="rounded-2xl p-10 text-center"
          style={{ background: "hsl(240 18% 6%)", border: "1px dashed hsl(240 12% 16%)" }}
        >
          <Activity className="w-7 h-7 mx-auto mb-3" style={{ color: "hsl(240 8% 30%)" }} />
          <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Nenhuma mensagem registrada</p>
        </div>
      ) : (
        messages.map((msg) => (
          <div
            key={msg.id}
            className="rounded-xl p-4 flex items-start gap-3"
            style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
              style={{
                background: msg.direction === "in" ? "rgba(96,165,250,0.08)" : "rgba(0,212,106,0.08)",
                border: msg.direction === "in" ? "1px solid rgba(96,165,250,0.15)" : "1px solid rgba(0,212,106,0.15)",
              }}
            >
              {msg.direction === "in"
                ? <ChevronRight className="w-3.5 h-3.5" style={{ color: "#60a5fa" }} />
                : <Send className="w-3.5 h-3.5" style={{ color: "var(--green)" }} />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-medium" style={{ color: "hsl(240 8% 52%)" }}>
                  {msg.direction === "in" ? "Recebida" : "Enviada"}
                </span>
                <span style={{ color: "hsl(240 8% 25%)" }}>·</span>
                <span className="text-xs font-mono" style={{ color: "hsl(240 8% 38%)" }}>{msg.to_jid}</span>
              </div>
              <p className="text-sm truncate" style={{ color: "hsl(240 15% 80%)" }}>{msg.content}</p>
            </div>
            <div className="text-xs flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }}>
              {new Date(msg.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Geral tab ────────────────────────────────────────────────────────────────
function GeralTab({ instance, instanceId }: { instance: Instance; instanceId: string }) {
  const queryClient = useQueryClient();
  const [showQR, setShowQR] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [tokenVisible, setTokenVisible] = useState(false);
  const [igUsername, setIgUsername] = useState("");
  const [igPassword, setIgPassword] = useState("");
  const [igPasswordVisible, setIgPasswordVisible] = useState(false);
  const [showIgLogin, setShowIgLogin] = useState(false);
  // Challenge states
  const [igChallenge, setIgChallenge] = useState<{ api_path: string; options: string[]; challenge_type: string; phone_mask?: string; email_mask?: string; can_resend?: boolean; external_verification?: boolean; message?: string } | null>(null);
  const [igChallengeCode, setIgChallengeCode] = useState("");
  const [igChallengeMethod, setIgChallengeMethod] = useState<"email" | "phone">("phone");
  const [igChallengeLoading, setIgChallengeLoading] = useState(false);
  const [msgType, setMsgType] = useState<"text"|"image"|"document"|"audio"|"video"|"location"|"contact"|"reaction"|"poll"|"sticker"|"buttons"|"template"|"list"|"carousel"|"pix">("text");
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  // per-type fields
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");
  const [filename, setFilename] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locationName, setLocationName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [reactionMsgId, setReactionMsgId] = useState("");
  const [emoji, setEmoji] = useState("❤️");
  const [pollQuestion, setPollQuestion] = useState("");
  const [pollOptions, setPollOptions] = useState("Opção 1\nOpção 2");
  // buttons
  const [btnBody, setBtnBody] = useState("");
  const [btnFooter, setBtnFooter] = useState("");
  // Builder visual substituiu o textarea legado (formato `texto|tipo:valor`).
  // Default: 2 botões de quick reply pra dar onboarding visual ao novo usuário.
  const [btnButtons, setBtnButtons] = useState<MessageButton[]>([
    { id: crypto.randomUUID(), text: "Sim", type: "reply" },
    { id: crypto.randomUUID(), text: "Não", type: "reply" },
  ]);
  // pix (review_and_pay)
  const [pixHeader, setPixHeader] = useState("Pagamento via PIX");
  const [pixBody, setPixBody] = useState("");
  const [pixFooter, setPixFooter] = useState("");
  const [pixMerchant, setPixMerchant] = useState("");
  const [pixKey, setPixKey] = useState("");
  const [pixKeyType, setPixKeyType] = useState<"CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP">("CPF");
  // template
  const [templateContent, setTemplateContent] = useState("");
  const [templateFooter, setTemplateFooter] = useState("");
  const [templateButtons, setTemplateButtons] = useState("Yes|quickreply|yes\nNo|quickreply|no\nVisit Site|url|https://www.fop2.com\nLlamame|call|1155554444");
  // list
  const [listText, setListText] = useState("");
  const [listButton, setListButton] = useState("Ver opções");
  const [listFooter, setListFooter] = useState("");
  const [listChoices, setListChoices] = useState("[Seção 1]\nItem 1|id1|Descrição 1\nItem 2|id2|Descrição 2\n[Seção 2]\nItem 3|id3");
  // carousel
  const [carouselText, setCarouselText] = useState("");
  const [carouselFooter, setCarouselFooter] = useState("");
  const [carouselChoices, setCarouselChoices] = useState("[Cartão 1]\n{https://exemplo.com/imagem1.jpg}\nVer mais|https://exemplo.com\n[Cartão 2]\n{https://exemplo.com/imagem2.jpg}\nComprar|https://loja.exemplo.com");
  const [lookupTarget, setLookupTarget] = useState("");
  const [contactLookup, setContactLookup] = useState<InstanceContactLookup | null>(null);

  const isWhatsApp = !instance?.channel || instance.channel === "whatsapp";
  const isInstagram = instance?.channel === "instagram";
  const isTikTok = instance?.channel === "tiktok";
  const isSocial = isInstagram || isTikTok;
  const channelColor = isWhatsApp ? "#25d366" : isInstagram ? "#e1306c" : "#ff0050";

  const { data: profile } = useQuery<InstanceProfile>({
    queryKey: ["profile", instanceId],
    queryFn: () => instancesApi.profile(instanceId).then((r) => r.data),
    enabled: instance.status === "connected",
    refetchInterval: 30_000,
  });

  const { data: settings, refetch: refetchSettings } = useQuery<InstanceSettings>({
    queryKey: ["settings", instanceId],
    queryFn: () => settingsApi.get(instanceId).then((r) => r.data),
  });

  const settingsMutation = useMutation({
    mutationFn: (data: Partial<InstanceSettings>) => settingsApi.update(instanceId, data),
    onSuccess: () => {
      refetchSettings();
      queryClient.invalidateQueries({ queryKey: ["instance", instanceId] });
    },
    onError: () => toast.error("Erro ao salvar configuração"),
  });

  const toggleSetting = (key: keyof InstanceSettings) => {
    if (!settings) return;
    settingsMutation.mutate({ [key]: !settings[key] });
  };

  const buildLookupPayload = (value: string) => {
    const target = value.trim();
    return target.includes("@") ? { jid: target } : { phone: target };
  };

  const disconnectMutation = useMutation({
    mutationFn: () => instancesApi.disconnect(instanceId),
    onSuccess: () => {
      toast.success("Desconectado com sucesso");
      queryClient.invalidateQueries({ queryKey: ["instance", instanceId] });
    },
    onError: () => toast.error("Erro ao desconectar"),
  });

  const reconnectMutation = useMutation({
    mutationFn: () => instancesApi.reconnect(instanceId),
    onSuccess: () => {
      toast.success("Reconectando...");
      queryClient.invalidateQueries({ queryKey: ["instance", instanceId] });
    },
    onError: () => toast.error("Erro ao reconectar"),
  });

  const instagramLoginMutation = useMutation({
    mutationFn: (creds: { username: string; password: string }) =>
      instancesApi.instagramLogin(instanceId, creds),
    onSuccess: (res) => {
      // Check if it's a challenge response
      const data = res as unknown as { data?: { challenge_type?: string; api_path?: string; options?: string[]; phone_mask?: string; email_mask?: string; can_resend?: boolean; external_verification?: boolean; message?: string } };
      if (data?.data?.challenge_type) {
        const options = data.data.options || ["phone"];
        setIgChallengeMethod(options.includes("phone") ? "phone" : "email");
        setIgChallenge({
          challenge_type: data.data.challenge_type,
          api_path: data.data.api_path || "",
          options,
          phone_mask: data.data.phone_mask,
          email_mask: data.data.email_mask,
          can_resend: data.data.can_resend,
          external_verification: data.data.external_verification,
          message: data.data.message,
        });
        toast.info(data.data.external_verification ? "Verificação externa necessária" : "Verificação necessária - inserir código");
      } else {
        toast.success("Conectado ao Instagram!");
        queryClient.invalidateQueries({ queryKey: ["instance", instanceId] });
        setShowIgLogin(false);
        setIgUsername("");
        setIgPassword("");
        setIgChallenge(null);
      }
    },
    onError: (err: unknown) => {
      const errData = err as { response?: { data?: { error?: string; data?: Record<string, unknown> } } };
      const errMsg = errData?.response?.data?.error;
      const challengeData = errData?.response?.data?.data;
      // Check if it's a challenge error
      if (errMsg === "challenge_required" && challengeData) {
        const options = (challengeData.options as string[]) || ["phone"];
        const isExternal = (challengeData.external_verification as boolean) || 
                          (challengeData.challenge_type === "external" || challengeData.challenge_type === "email_recovery");
        setIgChallengeMethod(options.includes("phone") ? "phone" : "email");
        setIgChallenge({
          challenge_type: (challengeData.challenge_type as string) || "code",
          api_path: (challengeData.api_path as string) || "",
          options,
          phone_mask: challengeData.phone_mask as string | undefined,
          email_mask: challengeData.email_mask as string | undefined,
          can_resend: challengeData.can_resend as boolean | undefined,
          external_verification: isExternal,
          message: challengeData.message as string | undefined,
        });
        toast.info(isExternal ? "Verificação externa necessária" : "Verificação necessária - inserir código");
      } else {
        const msg = errMsg || "Erro ao conectar";
        toast.error(msg);
      }
    },
  });

  const instagramChallengeMutation = useMutation({
    mutationFn: (data: { api_path: string; code: string; method?: string }) =>
      instancesApi.instagramChallenge(instanceId, data),
    onSuccess: () => {
      toast.success("Verificado com sucesso!");
      queryClient.invalidateQueries({ queryKey: ["instance", instanceId] });
      setShowIgLogin(false);
      setIgChallenge(null);
      setIgChallengeCode("");
      setIgUsername("");
      setIgPassword("");
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Código incorreto";
      toast.error(msg);
    },
  });

  const instagramChallengeResendMutation = useMutation({
    mutationFn: (data: { api_path: string; method?: string }) =>
      instancesApi.instagramChallengeResend(instanceId, data),
    onSuccess: () => {
      toast.success("Código reenviado");
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao reenviar código";
      toast.error(msg);
    },
  });

  const canSend = (): boolean => {
    if (!recipient.trim()) return false;
    switch (msgType) {
      case "text":     return !!text.trim();
      case "image": case "audio": case "video": case "sticker": return !!mediaUrl.trim();
      case "document": return !!mediaUrl.trim();
      case "location": return !!lat.trim() && !!lng.trim();
      case "contact":  return !!contactName.trim() && !!contactPhone.trim();
      case "reaction": return !!reactionMsgId.trim() && !!emoji.trim();
      case "poll":     return !!pollQuestion.trim() && pollOptions.split("\n").filter(Boolean).length >= 2;
      case "buttons":  return !!btnBody.trim() && btnButtons.length >= 1 && validateButtons(btnButtons) === null;
      case "pix":      return !!pixHeader.trim() && !!pixBody.trim() && !!pixMerchant.trim() && !!pixKey.trim();
      case "template": return !!templateContent.trim() && templateButtons.split("\n").filter(Boolean).length >= 1;
      case "list":     return !!listText.trim() && listChoices.split("\n").filter(Boolean).length >= 1;
      case "carousel": return !!carouselText.trim() && carouselChoices.split("\n").filter(Boolean).length >= 1;
      default:         return true;
    }
  };

  const handleSend = async () => {
    if (!canSend()) return;
    setSending(true);
    try {
      switch (msgType) {
        case "text":
          await messagesApi.sendText(instanceId, recipient, text);
          break;
        case "image":
          await messagesApi.sendImage(instanceId, { to: recipient, url: mediaUrl, caption: mediaCaption || undefined });
          break;
        case "document":
          await messagesApi.sendDocument(instanceId, { to: recipient, url: mediaUrl, filename: filename || undefined, caption: mediaCaption || undefined });
          break;
        case "audio":
          await messagesApi.sendAudio(instanceId, { to: recipient, url: mediaUrl });
          break;
        case "video":
          await messagesApi.sendVideo(instanceId, { to: recipient, url: mediaUrl, caption: mediaCaption || undefined });
          break;
        case "location":
          await messagesApi.sendLocation(instanceId, { to: recipient, latitude: parseFloat(lat), longitude: parseFloat(lng), name: locationName || undefined });
          break;
        case "contact":
          await messagesApi.sendContact(instanceId, { to: recipient, display_name: contactName, phone: contactPhone });
          break;
        case "reaction":
          await messagesApi.sendReaction(instanceId, { to: recipient, message_id: reactionMsgId, emoji });
          break;
        case "poll":
          await messagesApi.sendPoll(instanceId, { to: recipient, question: pollQuestion, options: pollOptions.split("\n").filter(Boolean) });
          break;
        case "sticker":
          await messagesApi.sendSticker(instanceId, { to: recipient, url: mediaUrl });
          break;
        case "buttons": {
          const validationError = validateButtons(btnButtons);
          if (validationError) {
            toast.error(validationError);
            return;
          }
          // Serializa do builder visual pro payload aceito pelo backend.
          // Mantém o id interno do builder só pra React keys, não envia.
          const buttons = btnButtons.slice(0, 3).map((b, i) => ({
            id: b.type === "reply" ? (b.id || `btn_${i}`) : undefined,
            text: b.text.trim(),
            type: b.type,
            url: b.type === "url" ? b.url?.trim() : undefined,
            phone: b.type === "call" ? b.phone?.trim() : undefined,
            copy_code: b.type === "copy" ? b.copy_code?.trim() : undefined,
          }));
          await messagesApi.sendButtons(instanceId, { to: recipient, body: btnBody, footer: btnFooter || undefined, buttons });
          break;
        }
        case "pix": {
          await messagesApi.sendPix(instanceId, {
            to: recipient,
            header_title: pixHeader,
            body_text: pixBody,
            footer_text: pixFooter || undefined,
            merchant_name: pixMerchant,
            pix_key: pixKey,
            key_type: pixKeyType,
          });
          break;
        }
        case "template": {
          const buttons = templateButtons
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, i) => {
              const [displayTextPart, typePart, valuePart] = line.split("|");
              const displayText = (displayTextPart || "").trim();
              const typeValue = ((typePart || "").trim().toLowerCase() || "quickreply") as "quickreply" | "url" | "call";
              const value = (valuePart || "").trim();
              if (!displayText) return null;
              if (typeValue === "url") {
                return { display_text: displayText, type: "url" as const, url: value };
              }
              if (typeValue === "call") {
                return { display_text: displayText, type: "call" as const, phone_number: value };
              }
              return { display_text: displayText, type: "quickreply" as const, id: value || `template_btn_${i}` };
            })
            .filter((button): button is NonNullable<typeof button> => Boolean(button?.display_text));
          await messagesApi.sendTemplate(instanceId, {
            to: recipient,
            content: templateContent,
            footer: templateFooter || undefined,
            buttons,
          });
          break;
        }
        case "list": {
          const choices = listChoices.split("\n").filter(Boolean);
          await messagesApi.sendMenu(instanceId, {
            number: recipient,
            type: "list",
            text: listText,
            choices,
            listButton: listButton || "Ver opções",
            footerText: listFooter || undefined,
          });
          break;
        }
        case "carousel": {
          // Parse do formato textarea pra cards estruturados:
          //   [Título do card 1]
          //   {https://imagem1.jpg}     ← image_url do header (opcional)
          //   Texto|https://link.com    ← botão URL (auto-detecta http/tel/copy)
          //   Texto|+5511999999999      ← botão call (telefone)
          //   Texto|reply:btn_id        ← botão reply (id explícito)
          //   [Título do card 2]
          //   ...
          type CardDraft = {
            header: { title: string; image_url?: string };
            body: string;
            buttons: { id?: string; text: string; type?: "reply" | "url" | "call" | "copy"; url?: string; phone?: string; copy_code?: string }[];
          };
          const cards: CardDraft[] = [];
          let current: CardDraft | null = null;
          for (const raw of carouselChoices.split("\n")) {
            const line = raw.trim();
            if (!line) continue;
            if (line.startsWith("[") && line.endsWith("]")) {
              if (current) cards.push(current);
              current = { header: { title: line.slice(1, -1).trim() }, body: carouselText || "", buttons: [] };
            } else if (line.startsWith("{") && line.endsWith("}")) {
              if (!current) current = { header: { title: "" }, body: carouselText || "", buttons: [] };
              current.header.image_url = line.slice(1, -1).trim();
            } else {
              if (!current) current = { header: { title: "" }, body: carouselText || "", buttons: [] };
              const [textPart, valuePart] = line.split("|");
              const text = (textPart || "").trim();
              const value = (valuePart || "").trim();
              if (!text) continue;
              if (/^https?:\/\//i.test(value)) {
                current.buttons.push({ text, type: "url", url: value });
              } else if (value.startsWith("+") || /^\d{10,}$/.test(value)) {
                current.buttons.push({ text, type: "call", phone: value });
              } else if (value.startsWith("reply:")) {
                current.buttons.push({ text, type: "reply", id: value.slice(6) });
              } else if (value) {
                current.buttons.push({ text, type: "copy", copy_code: value });
              } else {
                current.buttons.push({ text, type: "reply", id: text.toLowerCase().replace(/\s+/g, "_") });
              }
            }
          }
          if (current) cards.push(current);
          if (cards.length === 0) {
            toast.error("Adicione ao menos um card no carrossel");
            return;
          }
          await messagesApi.sendCarousel(instanceId, { to: recipient, cards });
          break;
        }
      }
      toast.success("Mensagem enviada!");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao enviar mensagem";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  const copyId = () => {
    navigator.clipboard.writeText(instanceId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const copyToken = () => {
    navigator.clipboard.writeText(instance.token || "");
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
  const serverSlug = instance.server?.slug;
  const v1Url = serverSlug && instance.slug
    ? `${apiBase}/v1/${serverSlug}/${instance.slug}`
    : instance.slug
      ? `${apiBase}/v1/{server-slug}/${instance.slug}`
      : `${apiBase}/v1/{server-slug}/{instance-slug}`;

  const copyUrl = () => {
    navigator.clipboard.writeText(v1Url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const regenTokenMutation = useMutation({
    mutationFn: () => instancesApi.regenerateToken(instanceId),
    onSuccess: (res) => {
      toast.success("Token regenerado! Atualize suas integrações.");
      queryClient.invalidateQueries({ queryKey: ["instance", instanceId] });
    },
    onError: () => toast.error("Erro ao regenerar token"),
  });

  const contactInfoMutation = useMutation({
    mutationFn: (target: string) => instancesApi.contactInfo(instanceId, buildLookupPayload(target)),
    onSuccess: (res) => setContactLookup(res.data),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao consultar contato";
      toast.error(msg);
    },
  });

  const contactAvatarMutation = useMutation({
    mutationFn: (target: string) => instancesApi.contactAvatar(instanceId, buildLookupPayload(target)),
    onSuccess: (res) => {
      const data = res.data as InstanceContactLookup;
      setContactLookup((prev) => ({
        query: data.query || prev?.query || lookupTarget.trim(),
        exists: data.exists,
        jid: data.jid || prev?.jid,
        phone: prev?.phone,
        name: prev?.name,
        push_name: prev?.push_name,
        avatar_url: data.avatar_url || prev?.avatar_url,
      }));
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao buscar avatar";
      toast.error(msg);
    },
  });

  const cardStyle = {
    background: "hsl(240 18% 6%)",
    border: "1px solid hsl(240 12% 13%)",
  };

  const labelStyle = { color: "hsl(240 8% 42%)" };
  const valueStyle = { color: "hsl(240 15% 80%)" };

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Info card */}
      <div className="rounded-2xl p-5 space-y-5" style={cardStyle}>
        <div className="flex items-center gap-4">
          {/* Profile photo */}
          {profile?.profile_pic_url ? (
            <img
              src={profile.profile_pic_url}
              alt="Foto de perfil"
              className="w-14 h-14 rounded-full object-cover flex-shrink-0"
              style={{ border: `2px solid ${channelColor}30` }}
            />
          ) : (
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: `${channelColor}15`, border: `1px solid ${channelColor}25` }}
            >
              {isWhatsApp ? <Smartphone className="w-6 h-6" style={{ color: channelColor }} /> :
               isInstagram ? <Camera className="w-6 h-6" style={{ color: channelColor }} /> :
               <Video className="w-6 h-6" style={{ color: channelColor }} />}
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold" style={{ color: "hsl(240 15% 93%)" }}>{instance.name}</h3>
            <p className="text-xs font-mono mt-0.5" style={{ color: "hsl(240 8% 52%)" }}>
              {isWhatsApp ? (profile?.phone_number || instance.phone_number || "Sem número") :
               isInstagram ? `@${instance.name}` :
               `@${instance.name}`}
            </p>
            {profile?.conversations !== undefined && isWhatsApp && (
              <p className="text-xs mt-1" style={{ color: "hsl(240 8% 40%)" }}>
                {profile.conversations} conversa{profile.conversations !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        </div>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
          Informações
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <p className="text-xs mb-1.5" style={labelStyle}>Status</p>
            <StatusBadge status={instance.status} />
          </div>
          {isWhatsApp && (
            <div>
              <p className="text-xs mb-1.5" style={labelStyle}>Número</p>
              <p className="text-sm font-mono" style={valueStyle}>{profile?.phone_number || instance.phone_number || "—"}</p>
            </div>
          )}
          {isInstagram && (
            <div>
              <p className="text-xs mb-1.5" style={labelStyle}>Canal</p>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(225,48,108,0.1)", color: "#e1306c", border: "1px solid rgba(225,48,108,0.2)" }}>
                Instagram
              </span>
            </div>
          )}
          {isTikTok && (
            <div>
              <p className="text-xs mb-1.5" style={labelStyle}>Canal</p>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: "rgba(255,0,80,0.1)", color: "#ff0050", border: "1px solid rgba(255,0,80,0.2)" }}>
                TikTok Beta
              </span>
            </div>
          )}
          <div>
            <p className="text-xs mb-1.5" style={labelStyle}>Criado em</p>
            <p className="text-sm" style={valueStyle}>{new Date(instance.created_at).toLocaleDateString("pt-BR")}</p>
          </div>
          {instance.connected_at && (
            <div>
              <p className="text-xs mb-1.5" style={labelStyle}>Conectado em</p>
              <p className="text-sm" style={valueStyle}>{new Date(instance.connected_at).toLocaleDateString("pt-BR")}</p>
            </div>
          )}
        </div>

        {/* API Credentials */}
        <div className="space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
            API v1 — Credenciais
          </p>

          {/* v1 base URL */}
          <div>
            <p className="text-[10px] mb-1" style={labelStyle}>Base URL</p>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
              <code className="text-xs flex-1 font-mono truncate" style={{ color: serverSlug ? "hsl(240 8% 55%)" : "hsl(240 8% 36%)" }}>
                {v1Url}
              </code>
              <button onClick={copyUrl} className="transition-colors flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
                onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
                {copiedUrl ? <Check className="w-3.5 h-3.5" style={{ color: "var(--green)" }} /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
            {!serverSlug && (
              <p className="text-[10px] mt-1.5" style={{ color: "hsl(240 8% 36%)" }}>
                Vincule esta instância a um Server para obter a URL completa da API v1
              </p>
            )}
          </div>

          {/* Instance slug */}
          <div>
            <p className="text-[10px] mb-1" style={labelStyle}>Instance ID (slug)</p>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
              <code className="text-xs flex-1 font-mono" style={{ color: "#a78bfa" }}>{instance.slug || "—"}</code>
              <button onClick={copyId} className="transition-colors flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
                onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
                {copiedId ? <Check className="w-3.5 h-3.5" style={{ color: "var(--green)" }} /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Token */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px]" style={labelStyle}>Token (Authorization: Bearer)</p>
              <button
                onClick={async () => {
                  if (!await showConfirm("Regenerar o token invalida todas as integrações atuais.", { title: "Regenerar token", confirmLabel: "Regenerar", danger: true })) return;
                  regenTokenMutation.mutate();
                }}
                className="text-[10px] transition-colors"
                style={{ color: "hsl(240 8% 34%)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#f87171")}
                onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 34%)")}
              >
                {regenTokenMutation.isPending ? "Regenerando..." : "Regenerar"}
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-xl px-3 py-2"
              style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
              <code className="text-xs flex-1 font-mono truncate" style={{ color: "hsl(240 8% 55%)" }}>
                {instance.token
                  ? (tokenVisible ? instance.token : instance.token.slice(0, 8) + "••••••••••••••••••••••••••••••••••••••••••••••••••••••••")
                  : "—"}
              </code>
              <button onClick={() => setTokenVisible(v => !v)} className="transition-colors flex-shrink-0"
                style={{ color: "hsl(240 8% 38%)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
                onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
                {tokenVisible
                  ? <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
              <button onClick={copyToken} className="transition-colors flex-shrink-0" style={{ color: "hsl(240 8% 38%)" }}
                onMouseEnter={e => (e.currentTarget.style.color = "hsl(240 8% 62%)")}
                onMouseLeave={e => (e.currentTarget.style.color = "hsl(240 8% 38%)")}>
                {copiedToken ? <Check className="w-3.5 h-3.5" style={{ color: "var(--green)" }} /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {instance.proxy_enabled && (
          <div
            className="flex items-center gap-2.5 p-3 rounded-xl"
            style={instance.proxy_status === "ok"
              ? { background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.12)" }
              : { background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.12)" }
            }
          >
            <Globe className="w-4 h-4 flex-shrink-0" style={{ color: instance.proxy_status === "ok" ? "#60a5fa" : "#fb923c" }} />
            <div>
              <p className="text-xs font-medium" style={{ color: "hsl(240 15% 80%)" }}>
                {instance.use_global_proxy ? `Proxy Global (${instance.global_proxy?.name || "global"})` : `Proxy ${instance.proxy_status === "ok" ? "ativo" : "com erro"}`}
              </p>
              {instance.proxy_status === "ok" && instance.proxy_external_ip && (
                <p className="text-xs font-mono" style={{ color: "hsl(240 8% 46%)" }}>IP: {instance.proxy_external_ip}</p>
              )}
              {instance.proxy_error && (
                <p className="text-xs" style={{ color: "#f87171" }}>{instance.proxy_error}</p>
              )}
            </div>
          </div>
        )}

        {isWhatsApp && instance.status === "connected" && (
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
              Consulta rápida
            </h3>
            <div className="rounded-2xl p-4 space-y-3" style={{ background: "hsl(240 20% 3.5%)", border: "1px solid hsl(240 12% 10%)" }}>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={lookupTarget}
                  onChange={(e) => setLookupTarget(e.target.value)}
                  placeholder="5511999999999 ou 5511999999999@s.whatsapp.net"
                  className="input-field flex-1"
                />
                <button
                  onClick={() => contactInfoMutation.mutate(lookupTarget)}
                  disabled={!lookupTarget.trim() || contactInfoMutation.isPending}
                  className="px-3 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-40"
                  style={{ background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.25)", color: "#60a5fa" }}
                >
                  {contactInfoMutation.isPending ? "Consultando..." : "Consultar info"}
                </button>
                <button
                  onClick={() => contactAvatarMutation.mutate(lookupTarget)}
                  disabled={!lookupTarget.trim() || contactAvatarMutation.isPending}
                  className="px-3 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-40"
                  style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.22)", color: "#34d399" }}
                >
                  {contactAvatarMutation.isPending ? "Buscando..." : "Buscar avatar"}
                </button>
              </div>
              <p className="text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>
                Valide número ou JID canônico, nome exibido e avatar vistos pela instância conectada.
              </p>

              {contactLookup && (
                <div className="rounded-xl p-3 flex gap-3 items-start" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  {contactLookup.avatar_url ? (
                    <img src={contactLookup.avatar_url} alt="Avatar do contato" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <User className="w-5 h-5" style={{ color: "hsl(240 8% 45%)" }} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold" style={{ color: "hsl(240 15% 88%)" }}>
                        {contactLookup.push_name || contactLookup.name || "Contato sem nome disponível"}
                      </span>
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                        style={contactLookup.exists
                          ? { background: "rgba(0,212,106,0.1)", color: "var(--green)", border: "1px solid rgba(0,212,106,0.2)" }
                          : { background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}
                      >
                        {contactLookup.exists ? "Existe no WhatsApp" : "Não encontrado"}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono break-all" style={{ color: "hsl(240 8% 46%)" }}>
                      Consulta: {contactLookup.query}
                    </p>
                    {contactLookup.jid && (
                      <p className="text-[11px] font-mono break-all" style={{ color: "hsl(240 8% 46%)" }}>
                        JID: {contactLookup.jid}
                      </p>
                    )}
                    {contactLookup.phone && (
                      <p className="text-[11px] font-mono" style={{ color: "hsl(240 8% 46%)" }}>
                        Número: {contactLookup.phone}
                      </p>
                    )}
                    {!contactLookup.avatar_url && contactLookup.exists && (
                      <p className="text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>
                        Nenhum avatar disponível para este contato no momento.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="rounded-2xl p-5 space-y-3" style={cardStyle}>
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>Ações</h3>
        <div className="grid grid-cols-2 gap-2">
          {isWhatsApp && instance.status !== "connected" && (
            <button
              onClick={() => setShowQR(true)}
              className="flex items-center justify-center gap-2 text-sm font-medium py-2.5 px-4 rounded-xl transition-all"
              style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.15)", color: "var(--green)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,212,106,0.14)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(0,212,106,0.08)")}
            >
              <QrCode className="w-4 h-4" />
              QR Code
            </button>
          )}
          {/* Instagram/TikTok - Connect button */}
          {isSocial && instance.status !== "connected" && !isWhatsApp && (
            <button
              onClick={() => isInstagram ? setShowIgLogin(true) : reconnectMutation.mutate()}
              disabled={reconnectMutation.isPending}
              className="flex items-center justify-center gap-2 text-sm font-medium py-2.5 px-4 rounded-xl transition-all disabled:opacity-50"
              style={{ background: `${channelColor}15`, border: `1px solid ${channelColor}25`, color: channelColor }}
            >
              {reconnectMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Power className="w-4 h-4" />
              }
              Conectar
            </button>
          )}
          {isWhatsApp && (instance.status === "connected" ? (
            <button
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="flex items-center justify-center gap-2 text-sm font-medium py-2.5 px-4 rounded-xl transition-all disabled:opacity-50 col-span-2"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: "#f87171" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.14)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(239,68,68,0.08)")}
            >
              {disconnectMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Power className="w-4 h-4" />
              }
              Desconectar
            </button>
          ) : (
            <button
              onClick={() => reconnectMutation.mutate()}
              disabled={reconnectMutation.isPending}
              className="flex items-center justify-center gap-2 text-sm font-medium py-2.5 px-4 rounded-xl transition-all disabled:opacity-50"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "hsl(240 8% 62%)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")}
            >
              {reconnectMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />
              }
              Reconectar
            </button>
          ))}
        </div>
      </div>

      {/* Quick send */}
      {instance.status === "connected" && (
        <div className="rounded-2xl p-5 space-y-4" style={cardStyle}>
          <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "hsl(240 8% 42%)" }}>
            Envio rápido
          </h3>

          {/* Recipient */}
          <div>
            <label className="text-xs font-medium block mb-1.5" style={labelStyle}>Destinatário</label>
            <input type="text" value={recipient} onChange={e => setRecipient(e.target.value)}
              placeholder="5511999999999" className="input-field w-full" />
          </div>

          {/* Message type tabs */}
          <div>
            <label className="text-xs font-medium block mb-2" style={labelStyle}>Tipo de mensagem</label>
            <div className="flex flex-wrap gap-1.5">
              {([
                { id: "text",     label: "Texto",      icon: MessageSquareText },
                { id: "image",    label: "Imagem",     icon: Image },
                { id: "document", label: "Documento",  icon: FileText },
                { id: "audio",    label: "Áudio",      icon: Music },
                { id: "video",    label: "Vídeo",      icon: Video },
                { id: "location", label: "Localização",icon: MapPin },
                { id: "contact",  label: "Contato",    icon: User },
                { id: "reaction", label: "Reação",     icon: Smile },
                { id: "poll",     label: "Enquete",    icon: BarChart2 },
                { id: "sticker",  label: "Sticker",    icon: Sticker },
                { id: "buttons",  label: "Botões",     icon: MousePointerClick },
                { id: "pix",      label: "PIX",        icon: Banknote },
                { id: "template", label: "Template",   icon: MousePointerClick },
                { id: "list",     label: "Lista",      icon: List },
                { id: "carousel", label: "Carrossel",  icon: LayoutGrid },
              ] as { id: typeof msgType; label: string; icon: React.ElementType }[]).map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setMsgType(id)}
                  className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-lg transition-all"
                  style={msgType === id
                    ? { background: "rgba(96,165,250,0.12)", border: "1px solid rgba(96,165,250,0.3)", color: "#60a5fa" }
                    : { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", color: "hsl(240 8% 44%)" }}>
                  <Icon className="w-3 h-3" />{label}
                </button>
              ))}
            </div>
          </div>

          {/* Type-specific fields */}
          {msgType === "text" && (
            <textarea value={text} onChange={e => setText(e.target.value)}
              rows={3} placeholder="Digite sua mensagem..." className="input-field w-full resize-none" />
          )}
          {(msgType === "image" || msgType === "audio" || msgType === "video" || msgType === "sticker") && (
            <div className="space-y-2">
              <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
                placeholder="URL da mídia (https://...)" className="input-field w-full" />
              {(msgType === "image" || msgType === "video") && (
                <input value={mediaCaption} onChange={e => setMediaCaption(e.target.value)}
                  placeholder="Legenda (opcional)" className="input-field w-full" />
              )}
            </div>
          )}
          {msgType === "document" && (
            <div className="space-y-2">
              <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
                placeholder="URL do documento (https://...)" className="input-field w-full" />
              <input value={filename} onChange={e => setFilename(e.target.value)}
                placeholder="Nome do arquivo (ex: relatorio.pdf)" className="input-field w-full" />
              <input value={mediaCaption} onChange={e => setMediaCaption(e.target.value)}
                placeholder="Legenda (opcional)" className="input-field w-full" />
            </div>
          )}
          {msgType === "location" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={lat} onChange={e => setLat(e.target.value)}
                  placeholder="Latitude (-23.550520)" className="input-field w-full" />
                <input value={lng} onChange={e => setLng(e.target.value)}
                  placeholder="Longitude (-46.633308)" className="input-field w-full" />
              </div>
              <input value={locationName} onChange={e => setLocationName(e.target.value)}
                placeholder="Nome do local (opcional)" className="input-field w-full" />
            </div>
          )}
          {msgType === "contact" && (
            <div className="space-y-2">
              <input value={contactName} onChange={e => setContactName(e.target.value)}
                placeholder="Nome do contato" className="input-field w-full" />
              <input value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                placeholder="Telefone (5511999999999)" className="input-field w-full" />
            </div>
          )}
          {msgType === "reaction" && (
            <div className="space-y-2">
              <input value={reactionMsgId} onChange={e => setReactionMsgId(e.target.value)}
                placeholder="ID da mensagem" className="input-field w-full" />
              <input value={emoji} onChange={e => setEmoji(e.target.value)}
                placeholder="Emoji (ex: ❤️)" className="input-field w-full" />
            </div>
          )}
          {msgType === "poll" && (
            <div className="space-y-2">
              <input value={pollQuestion} onChange={e => setPollQuestion(e.target.value)}
                placeholder="Pergunta da enquete" className="input-field w-full" />
              <textarea value={pollOptions} onChange={e => setPollOptions(e.target.value)}
                rows={4} placeholder={"Opção 1\nOpção 2\nOpção 3"} className="input-field w-full resize-none" />
              <p className="text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>Uma opção por linha</p>
            </div>
          )}
          {msgType === "buttons" && (
            <div className="space-y-3">
              <textarea value={btnBody} onChange={e => setBtnBody(e.target.value)}
                rows={2} placeholder="Texto da mensagem" className="input-field w-full resize-none" />
              <input value={btnFooter} onChange={e => setBtnFooter(e.target.value)}
                placeholder="Rodapé (opcional)" className="input-field w-full" />
              <MessageButtonsBuilder buttons={btnButtons} onChange={setBtnButtons} />
            </div>
          )}
          {msgType === "pix" && (
            <div className="space-y-2">
              <input value={pixHeader} onChange={e => setPixHeader(e.target.value)}
                placeholder="Título do card (ex: Pagamento)" className="input-field w-full" />
              <textarea value={pixBody} onChange={e => setPixBody(e.target.value)}
                rows={2} placeholder="Descrição do pagamento" className="input-field w-full resize-none" />
              <input value={pixFooter} onChange={e => setPixFooter(e.target.value)}
                placeholder="Rodapé (opcional)" className="input-field w-full" />
              <input value={pixMerchant} onChange={e => setPixMerchant(e.target.value)}
                placeholder="Nome do beneficiário" className="input-field w-full" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select value={pixKeyType} onChange={e => setPixKeyType(e.target.value as typeof pixKeyType)}
                  className="input-field">
                  <option value="CPF">CPF</option>
                  <option value="CNPJ">CNPJ</option>
                  <option value="EMAIL">E-mail</option>
                  <option value="PHONE">Telefone</option>
                  <option value="EVP">Aleatória (EVP)</option>
                </select>
                <input value={pixKey} onChange={e => setPixKey(e.target.value)}
                  placeholder="Chave PIX" className="input-field sm:col-span-2" />
              </div>
              <div className="rounded-lg p-2.5" style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.2)" }}>
                <p className="text-[10px]" style={{ color: "rgb(110 231 183)" }}>
                  Card "Pagar" interativo — o cliente confirma o valor no app. Default exibido: R$ 0,01 (limitação atual do protocolo).
                </p>
              </div>
            </div>
          )}
          {msgType === "template" && (
            <div className="space-y-3">
              <textarea value={templateContent} onChange={e => setTemplateContent(e.target.value)}
                rows={2} placeholder="Template content" className="input-field w-full resize-none" />
              <input value={templateFooter} onChange={e => setTemplateFooter(e.target.value)}
                placeholder="Some footer text" className="input-field w-full" />
              <textarea value={templateButtons} onChange={e => setTemplateButtons(e.target.value)}
                rows={5} placeholder={"Yes|quickreply|yes\nNo|quickreply|no\nVisit Site|url|https://www.fop2.com\nLlamame|call|1155554444"} className="input-field w-full resize-none font-mono text-xs" />
              <div className="rounded-lg p-2.5" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
                <p className="text-[10px]" style={{ color: "rgb(253 186 116)" }}>
                  Formato: <span className="font-mono">DisplayText|quickreply|id</span>, <span className="font-mono">DisplayText|url|https://...</span> ou <span className="font-mono">DisplayText|call|5511...</span>.
                </p>
              </div>
            </div>
          )}
          {msgType === "list" && (
            <div className="space-y-3">
              <textarea value={listText} onChange={e => setListText(e.target.value)}
                rows={2} placeholder="Texto principal da mensagem" className="input-field w-full resize-none" />
              <div className="flex gap-2">
                <input value={listButton} onChange={e => setListButton(e.target.value)}
                  placeholder="Texto do botão" className="input-field flex-1" />
                <input value={listFooter} onChange={e => setListFooter(e.target.value)}
                  placeholder="Rodapé (opcional)" className="input-field flex-1" />
              </div>
              <textarea value={listChoices} onChange={e => setListChoices(e.target.value)}
                rows={6} placeholder={"[Seção 1]\nItem 1|id1|Descrição 1\nItem 2|id2\n[Seção 2]\nItem 3|id3|Descrição 3"} className="input-field w-full resize-none font-mono text-xs" />
              <div className="rounded-lg p-2.5" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}>
                <p className="text-[10px]" style={{ color: "hsl(217, 91%, 75%)" }}>
                  Formato via <span className="font-mono">/messages/menu</span>: <span className="font-mono">[Título da Seção]</span> para seções e <span className="font-mono">titulo|id|descricao</span> para itens.
                </p>
              </div>
            </div>
          )}
          {msgType === "carousel" && (
            <div className="space-y-3">
              <textarea value={carouselText} onChange={e => setCarouselText(e.target.value)}
                rows={2} placeholder="Texto principal do carrossel" className="input-field w-full resize-none" />
              <input value={carouselFooter} onChange={e => setCarouselFooter(e.target.value)}
                placeholder="Rodapé (opcional)" className="input-field w-full" />
              <textarea value={carouselChoices} onChange={e => setCarouselChoices(e.target.value)}
                rows={8} placeholder={"[Cartão 1 - Título]\n{https://exemplo.com/imagem.jpg}\nVer mais|https://exemplo.com\nComprar|call:+5511999999999\n[Cartão 2]\n{https://exemplo.com/img2.jpg}\nInfo|https://loja.exemplo.com"} className="input-field w-full resize-none font-mono text-xs" />
              <div className="rounded-lg p-2.5" style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)" }}>
                <p className="text-[10px]" style={{ color: "hsl(271, 91%, 75%)" }}>
                  Formato via <span className="font-mono">/messages/menu</span>: <span className="font-mono">[Título]</span> para cartão, <span className="font-mono">{"{url}"}</span> para imagem e <span className="font-mono">texto|url</span> ou <span className="font-mono">texto|call:numero</span> para ações.
                </p>
              </div>
            </div>
          )}

          <button onClick={handleSend} disabled={sending || !canSend()}
            className="w-full flex items-center justify-center gap-2 text-sm font-semibold py-2.5 rounded-xl transition-all disabled:opacity-40"
            style={{ background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", color: "#60a5fa" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(96,165,250,0.16)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(96,165,250,0.1)")}
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Enviar
          </button>
        </div>
      )}

      {/* Advanced settings */}
      <div className="rounded-2xl p-5 space-y-1" style={cardStyle}>
        <h3 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "hsl(240 8% 42%)" }}>
          Configurações Avançadas
        </h3>
        {([
          { key: "always_online", label: "Always Online", desc: "Manter sempre online no WhatsApp" },
          { key: "reject_calls", label: "Reject Call", desc: "Rejeitar chamadas automaticamente" },
          { key: "read_messages", label: "Read Messages", desc: "Marcar mensagens como lidas" },
          { key: "ignore_groups", label: "Ignore Groups", desc: "Ignorar mensagens de grupos" },
          { key: "ignore_status", label: "Ignore Status", desc: "Ignorar atualizações de status" },
        ] as { key: keyof InstanceSettings; label: string; desc: string }[]).map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between py-3"
            style={{ borderBottom: "1px solid hsl(240 12% 10%)" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "hsl(240 15% 80%)" }}>{label}</p>
              <p className="text-xs mt-0.5" style={{ color: "hsl(240 8% 38%)" }}>{desc}</p>
            </div>
            <button
              role="switch"
              aria-checked={settings?.[key] ?? false}
              onClick={() => toggleSetting(key)}
              disabled={settingsMutation.isPending}
              className="relative flex-shrink-0 rounded-full transition-colors disabled:opacity-50"
              style={{
                background: settings?.[key] ? "var(--green)" : "hsl(240 12% 18%)",
                width: "2.5rem",
                height: "1.375rem",
              }}
            >
              <span
                className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                style={{ transform: settings?.[key] ? "translateX(1.125rem)" : "translateX(0)" }}
              />
            </button>
          </div>
        ))}
      </div>

      {showQR && (
        <QRCodeModal
          instanceId={instanceId}
          onClose={() => {
            setShowQR(false);
            queryClient.invalidateQueries({ queryKey: ["instance", instanceId] });
          }}
          onConnected={() => queryClient.invalidateQueries({ queryKey: ["instance", instanceId] })}
        />
      )}

      {showIgLogin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 backdrop-blur-sm" style={{ background: "rgba(0,0,0,0.7)" }} onClick={() => setShowIgLogin(false)} />
          <div className="relative w-full max-w-sm rounded-2xl p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 14%)" }}>
            {/* Header com ícone Instagram */}
            <div className="flex flex-col items-center mb-5">
              <button 
                onClick={() => setShowIgLogin(false)} 
                className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                style={{ color: "hsl(240 8% 40%)" }}
              >
                <X className="w-5 h-5" />
              </button>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: "rgba(225,48,108,0.15)" }}>
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="#e1306c">
                  <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                </svg>
              </div>
              <h2 className="text-base font-semibold" style={{ color: "hsl(240 15% 93%)" }}>Login no Instagram</h2>
              <p className="text-xs mt-1 text-center" style={{ color: "hsl(240 8% 48%)" }}>
                Digite as credenciais da conta que deseja conectar
              </p>
            </div>
            <div className="space-y-4">
              {/* Credentials inputs */}
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>Usuário</label>
                <div className="relative">
                  <input
                    type="text"
                    value={igUsername}
                    onChange={(e) => setIgUsername(e.target.value)}
                    placeholder="seu_usuario"
                    autoComplete="username"
                    className="w-full text-sm rounded-xl px-3 py-2.5 pl-10 outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }}
                  />
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(240 8% 40%)" }} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(240 8% 55%)" }}>Senha</label>
                <div className="relative">
                  <input
                    type={igPasswordVisible ? "text" : "password"}
                    value={igPassword}
                    onChange={(e) => setIgPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full text-sm rounded-xl px-3 py-2.5 pl-10 pr-10 outline-none"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid hsl(240 12% 16%)", color: "hsl(240 15% 90%)" }}
                  />
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "hsl(240 8% 40%)" }} />
                  <button
                    type="button"
                    onClick={() => setIgPasswordVisible(!igPasswordVisible)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1"
                    style={{ color: "hsl(240 8% 40%)" }}
                  >
                    {igPasswordVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {!igChallenge && (
                <button
                  onClick={() => instagramLoginMutation.mutate({ username: igUsername.trim(), password: igPassword })}
                  disabled={!igUsername.trim() || !igPassword.trim() || instagramLoginMutation.isPending}
                  className="w-full text-sm font-semibold py-3 rounded-xl transition-all disabled:opacity-40 flex items-center justify-center gap-2 mt-2"
                  style={{ background: "#e1306c", color: "white" }}
                >
                  {instagramLoginMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                  {instagramLoginMutation.isPending ? "Conectando..." : "Conectar"}
                </button>
              )}

              {/* Challenge code input */}
              {igChallenge && (
                <div className="space-y-3 pt-4 mt-4" style={{ borderTop: "1px solid hsl(240 12% 16%)" }}>
                  {/* Challenge Header */}
                  <div className="flex items-start gap-3 p-3 rounded-xl" style={{ background: "rgba(225,48,108,0.08)", border: "1px solid rgba(225,48,108,0.2)" }}>
                    <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "rgba(225,48,108,0.15)" }}>
                      {igChallenge.external_verification ? (
                        <ShieldAlert className="w-4 h-4" style={{ color: "#e1306c" }} />
                      ) : igChallenge.challenge_type === "email" ? (
                        <svg className="w-4 h-4" style={{ color: "#e1306c" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      ) : igChallenge.challenge_type === "phone" || igChallenge.challenge_type === "sms" ? (
                        <Phone className="w-4 h-4" style={{ color: "#e1306c" }} />
                      ) : (
                        <Lock className="w-4 h-4" style={{ color: "#e1306c" }} />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold mb-0.5" style={{ color: "#e1306c" }}>
                        {igChallenge.external_verification ? "Verificação externa necessária" : "Código de verificação necessário"}
                      </p>
                      <p className="text-xs leading-relaxed" style={{ color: "hsl(240 8% 62%)" }}>
                        {igChallenge.external_verification
                          ? "O Instagram exige que você verifique sua identidade diretamente no app ou site do Instagram."
                          : igChallenge.challenge_type === "email"
                          ? `Enviamos um código de 6 dígitos para o email ${igChallenge.email_mask || "cadastrado"}.`
                          : igChallenge.challenge_type === "phone" || igChallenge.challenge_type === "sms"
                          ? `Enviamos um código de 6 dígitos para o telefone ${igChallenge.phone_mask || "cadastrado"}.`
                          : igChallenge.message || "O Instagram pediu confirmação de segurança."}
                      </p>
                    </div>
                  </div>

                  {/* External verification - no code input, just instructions */}
                  {igChallenge.external_verification ? (
                    <>
                      <div className="rounded-xl p-3 space-y-2" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid hsl(240 12% 16%)" }}>
                        <p className="text-xs font-medium" style={{ color: "hsl(240 15% 85%)" }}>
                          📱 Como verificar sua conta:
                        </p>
                        <ol className="text-xs space-y-1.5 list-decimal list-inside" style={{ color: "hsl(240 8% 58%)" }}>
                          <li>Abra o app do Instagram ou acesse <span className="font-mono" style={{ color: "#e1306c" }}>instagram.com</span></li>
                          <li>Faça login com suas credenciais</li>
                          <li>Siga as instruções de verificação na tela</li>
                          <li>Após concluir, volte aqui e clique em "Tentar novamente"</li>
                        </ol>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setIgChallenge(null); setIgChallengeCode(""); }}
                        className="w-full text-sm font-semibold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
                        style={{ background: "rgba(255,255,255,0.08)", color: "hsl(240 15% 90%)" }}
                      >
                        <RotateCcw className="w-4 h-4" />
                        Tentar novamente
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Regular challenge - code input */}
                      {/* Method selector if multiple options */}
                      {igChallenge.options && igChallenge.options.length > 1 && (
                        <div>
                          <label className="text-xs font-medium block mb-2" style={{ color: "hsl(240 8% 55%)" }}>
                            Enviar código por:
                          </label>
                          <div className="flex gap-2">
                            {igChallenge.options.includes("phone") && (
                              <button
                                type="button"
                                onClick={() => setIgChallengeMethod("phone")}
                                className="flex-1 text-xs py-2 px-3 rounded-lg transition-all font-medium"
                                style={{
                                  background: igChallengeMethod === "phone" ? "rgba(225,48,108,0.15)" : "rgba(255,255,255,0.04)",
                                  color: igChallengeMethod === "phone" ? "#e1306c" : "hsl(240 8% 58%)",
                                  border: igChallengeMethod === "phone" ? "1px solid rgba(225,48,108,0.3)" : "1px solid transparent",
                                }}
                              >
                                📱 SMS
                              </button>
                            )}
                            {igChallenge.options.includes("email") && (
                              <button
                                type="button"
                                onClick={() => setIgChallengeMethod("email")}
                                className="flex-1 text-xs py-2 px-3 rounded-lg transition-all font-medium"
                                style={{
                                  background: igChallengeMethod === "email" ? "rgba(225,48,108,0.15)" : "rgba(255,255,255,0.04)",
                                  color: igChallengeMethod === "email" ? "#e1306c" : "hsl(240 8% 58%)",
                                  border: igChallengeMethod === "email" ? "1px solid rgba(225,48,108,0.3)" : "1px solid transparent",
                                }}
                              >
                                ✉️ Email
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Single option info */}
                      {igChallenge.options && igChallenge.options.length === 1 && (
                        <p className="text-xs px-3 py-2 rounded-lg" style={{ color: "hsl(240 8% 52%)", background: "rgba(255,255,255,0.03)" }}>
                          {igChallenge.options[0] === "email"
                            ? `ℹ️ O Instagram só permitiu verificação por email para ${igChallenge.email_mask || "este email"}.`
                            : `ℹ️ O Instagram só permitiu verificação por SMS para ${igChallenge.phone_mask || "este telefone"}.`}
                        </p>
                      )}

                      {/* Code input field */}
                      <div>
                        <label className="text-xs font-medium block mb-2" style={{ color: "hsl(240 8% 55%)" }}>
                          Código de verificação
                        </label>
                        <input
                          type="text"
                          value={igChallengeCode}
                          onChange={(e) => setIgChallengeCode(e.target.value.replace(/\D/g, ""))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && igChallengeCode.length === 6 && !instagramChallengeMutation.isPending) {
                              e.preventDefault();
                              instagramChallengeMutation.mutate({ api_path: igChallenge.api_path, code: igChallengeCode, method: igChallengeMethod });
                            }
                          }}
                          placeholder="000000"
                          className="w-full text-sm rounded-xl px-3 py-3 outline-none"
                          style={{
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid hsl(240 12% 16%)",
                            color: "hsl(240 15% 90%)",
                            letterSpacing: "0.4em",
                            textAlign: "center" as React.CSSProperties["textAlign"],
                            fontSize: "1.25rem",
                          }}
                          maxLength={6}
                        />
                        <p className="text-xs mt-1.5 text-center" style={{ color: "hsl(240 8% 45%)" }}>
                          Digite os 6 dígitos recebidos
                        </p>
                      </div>

                      {/* Verify button */}
                      <button
                        onClick={() => instagramChallengeMutation.mutate({ api_path: igChallenge.api_path, code: igChallengeCode, method: igChallengeMethod })}
                        disabled={igChallengeCode.length < 6 || instagramChallengeMutation.isPending || igChallengeLoading}
                        className="w-full text-sm font-semibold py-3 rounded-xl transition-all disabled:opacity-40 flex items-center justify-center gap-2"
                        style={{ background: "#e1306c", color: "white" }}
                      >
                        {instagramChallengeMutation.isPending || igChallengeLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        {instagramChallengeMutation.isPending || igChallengeLoading ? "Verificando..." : "Verificar código"}
                      </button>

                      {/* Resend button */}
                      {igChallenge.can_resend && !!igChallenge.api_path && igChallenge.options && igChallenge.options.length > 1 && (
                        <button
                          type="button"
                          onClick={() => instagramChallengeResendMutation.mutate({ api_path: igChallenge.api_path, method: igChallengeMethod })}
                          disabled={instagramChallengeResendMutation.isPending}
                          className="w-full text-xs py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
                          style={{ color: "hsl(240 8% 58%)", background: "rgba(255,255,255,0.04)" }}
                        >
                          {instagramChallengeResendMutation.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          {instagramChallengeResendMutation.isPending ? "Reenviando..." : `Reenviar código via ${igChallengeMethod === "email" ? "email" : "SMS"}`}
                        </button>
                      )}

                      {/* Back to login button */}
                      <button
                        type="button"
                        onClick={() => { setIgChallenge(null); setIgChallengeCode(""); }}
                        className="w-full text-xs py-2.5 rounded-lg transition-all flex items-center justify-center gap-2"
                        style={{ color: "hsl(240 8% 48%)", background: "transparent" }}
                      >
                        <ArrowLeft className="w-3 h-3" />
                        Voltar ao login
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
// ─── Recovery Tab ─────────────────────────────────────────────────────────────

interface GroupSnapshot { jid: string; name: string; description: string; member_count: number; is_admin: boolean; invite_link?: string; }
interface ContactEntry  { jid: string; phone: string; message_count: number; last_message: string; }
interface RecoveryData  { status: string; snapshot_at: string; schedule: "" | "daily" | "weekly"; groups: GroupSnapshot[]; contacts: ContactEntry[]; }

function RecoveryTab({ instanceId, instance }: { instanceId: string; instance: Instance }) {
  const [copiedJid, setCopiedJid] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery<RecoveryData>({
    queryKey: ["recovery", instanceId],
    queryFn: () => recoveryApi.get(instanceId).then(r => r.data),
  });

  const snapshotMutation = useMutation({
    mutationFn: () => recoveryApi.snapshot(instanceId),
    onSuccess: () => { toast.success("Snapshot salvo!"); refetch(); queryClient.invalidateQueries({ queryKey: ["recovery", instanceId] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao tirar snapshot"),
  });

  const resetMutation = useMutation({
    mutationFn: () => recoveryApi.reset(instanceId),
    onSuccess: () => { toast.success("Sessão resetada — conecte o novo número"); queryClient.invalidateQueries({ queryKey: ["instance", instanceId] }); },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao resetar"),
  });

  const scheduleMutation = useMutation({
    mutationFn: (schedule: "" | "daily" | "weekly") => recoveryApi.setSchedule(instanceId, schedule),
    onSuccess: (_, schedule) => {
      const label = { "": "desativado", daily: "diário", weekly: "semanal" }[schedule];
      toast.success(`Backup automático ${label}`);
      queryClient.invalidateQueries({ queryKey: ["recovery", instanceId] });
    },
    onError: (e: unknown) => toast.error((e as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao salvar agendamento"),
  });

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedJid(key);
    setTimeout(() => setCopiedJid(null), 2000);
  };

  const isBanned = instance.status === "banned";
  const snapshotAt = data?.snapshot_at ? new Date(data.snapshot_at) : null;
  const hasSnapshot = snapshotAt && snapshotAt.getFullYear() > 2000;
  const currentSchedule = data?.schedule ?? "";

  const cardStyle = { background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" };
  const dimText = { color: "hsl(240 8% 42%)" };
  const valText = { color: "hsl(240 15% 88%)" };

  const scheduleOptions: { value: "" | "daily" | "weekly"; label: string; desc: string }[] = [
    { value: "",       label: "Manual",  desc: "Apenas quando você solicitar" },
    { value: "daily",  label: "Diário",  desc: "Automático 1× ao dia" },
    { value: "weekly", label: "Semanal", desc: "Automático 1× por semana" },
  ];

  return (
    <div className="space-y-5">
      {/* Status banner */}
      {isBanned && (
        <div className="rounded-2xl p-4 flex items-start gap-3"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <ShieldAlert className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: "#ef4444" }} />
          <div>
            <p className="font-semibold text-sm" style={{ color: "#ef4444" }}>Número banido pelo WhatsApp</p>
            <p className="text-xs mt-0.5" style={dimText}>
              Conecte um novo número para retomar as conversas. Seu histórico de mensagens e grupos salvos permanecem intactos.
            </p>
          </div>
        </div>
      )}

      {/* Actions row */}
      <div className="flex flex-wrap gap-2">
        {instance.status === "connected" && (
          <button onClick={() => snapshotMutation.mutate()} disabled={snapshotMutation.isPending}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl transition-all disabled:opacity-50"
            style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", color: "#60a5fa" }}>
            {snapshotMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Salvar snapshot agora
          </button>
        )}
        {isBanned && (
          <button onClick={async () => { if (await showConfirm("Isso vai desconectar o número atual e permitir conectar um novo.", { title: "Resetar instância", confirmLabel: "Resetar" })) resetMutation.mutate(); }}
            disabled={resetMutation.isPending}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-xl transition-all disabled:opacity-50"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#ef4444" }}>
            {resetMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
            Resetar sessão e conectar novo número
          </button>
        )}
      </div>

      {/* Schedule selector */}
      <div className="rounded-2xl" style={cardStyle}>
        <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid hsl(240 12% 13%)" }}>
          <RotateCcw className="w-4 h-4" style={{ color: "#f59e0b" }} />
          <span className="font-semibold text-sm" style={valText}>Backup automático de grupos</span>
        </div>
        <div className="p-4 grid grid-cols-3 gap-2">
          {scheduleOptions.map(opt => {
            const active = currentSchedule === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => scheduleMutation.mutate(opt.value)}
                disabled={scheduleMutation.isPending}
                className="flex flex-col items-start gap-0.5 p-3 rounded-xl transition-all text-left disabled:opacity-50"
                style={active ? {
                  background: "rgba(245,158,11,0.1)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  color: "#f59e0b",
                } : {
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  color: "hsl(240 8% 42%)",
                }}>
                <span className="text-sm font-medium" style={active ? { color: "#f59e0b" } : valText}>{opt.label}</span>
                <span className="text-[11px]">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
      ) : (
        <>
          {/* Groups snapshot */}
          <div className="rounded-2xl" style={cardStyle}>
            <div className="p-4 flex items-center justify-between" style={{ borderBottom: "1px solid hsl(240 12% 13%)" }}>
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4" style={{ color: "#60a5fa" }} />
                <span className="font-semibold text-sm" style={valText}>Grupos salvos</span>
                {data?.groups?.length ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-md font-mono" style={{ background: "rgba(96,165,250,0.1)", color: "#60a5fa" }}>
                    {data.groups.length}
                  </span>
                ) : null}
              </div>
              {hasSnapshot && (
                <span className="text-[10px]" style={dimText}>
                  Salvo em {snapshotAt!.toLocaleDateString("pt-BR")} {snapshotAt!.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>

            {!data?.groups?.length ? (
              <div className="p-6 text-center">
                <Camera className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm" style={dimText}>Nenhum snapshot salvo.</p>
                <p className="text-xs mt-1" style={dimText}>Com a instância conectada, clique em "Salvar snapshot de grupos".</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "hsl(240 12% 13%)" }}>
                {data.groups.map(g => (
                  <div key={g.jid} className="p-3.5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: g.is_admin ? "rgba(251,191,36,0.1)" : "rgba(255,255,255,0.04)", border: g.is_admin ? "1px solid rgba(251,191,36,0.2)" : "1px solid rgba(255,255,255,0.06)" }}>
                      <Users className="w-3.5 h-3.5" style={{ color: g.is_admin ? "#fbbf24" : "hsl(240 8% 42%)" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={valText}>{g.name || g.jid}</p>
                      <p className="text-[11px] mt-0.5" style={dimText}>{g.member_count} membros{g.is_admin ? " · admin" : ""}</p>
                    </div>
                    {g.invite_link ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => copy(g.invite_link!, g.jid)}
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition-all"
                          style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.2)", color: "#00d46a" }}>
                          {copiedJid === g.jid ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedJid === g.jid ? "Copiado" : "Link"}
                        </button>
                        <a href={g.invite_link} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition-all"
                          style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.2)", color: "#60a5fa" }}>
                          <ChevronRight className="w-3 h-3" />Abrir
                        </a>
                      </div>
                    ) : (
                      <span className="text-[11px] flex-shrink-0" style={dimText}>Sem link</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Contact history */}
          <div className="rounded-2xl" style={cardStyle}>
            <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid hsl(240 12% 13%)" }}>
              <Phone className="w-4 h-4" style={{ color: "#a78bfa" }} />
              <span className="font-semibold text-sm" style={valText}>Histórico de contatos</span>
              {data?.contacts?.length ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded-md font-mono" style={{ background: "rgba(167,139,250,0.1)", color: "#a78bfa" }}>
                  {data.contacts.length}
                </span>
              ) : null}
            </div>

            {!data?.contacts?.length ? (
              <div className="p-6 text-center">
                <Phone className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p className="text-sm" style={dimText}>Nenhuma conversa enviada ainda.</p>
              </div>
            ) : (
              <div className="divide-y" style={{ borderColor: "hsl(240 12% 13%)" }}>
                {data.contacts.map(c => (
                  <div key={c.jid} className="p-3.5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.15)" }}>
                      <User className="w-3.5 h-3.5" style={{ color: "#a78bfa" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium font-mono" style={valText}>+{c.phone}</p>
                      <p className="text-[11px] mt-0.5" style={dimText}>
                        {c.message_count} mensagem{c.message_count !== 1 ? "s" : ""} ·{" "}
                        {new Date(c.last_message).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <button onClick={() => copy(c.phone, "phone_" + c.jid)}
                      className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg transition-all flex-shrink-0"
                      style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.2)", color: "#a78bfa" }}>
                      {copiedJid === "phone_" + c.jid ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedJid === "phone_" + c.jid ? "Copiado" : "Número"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function InstanceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const instanceId = params.id as string;
  const [activeTab, setActiveTab] = useState<Tab>("geral");
  const [deleting, setDeleting] = useState(false);

  const { data: instance, isLoading } = useQuery<Instance>({
    queryKey: ["instance", instanceId],
    queryFn: () => instancesApi.get(instanceId).then((r) => r.data),
    // Stop polling while deleting to avoid 404 race
    enabled: !deleting,
    // Poll while connecting only for WhatsApp; Instagram connection lifecycle is manual/login-driven
    refetchInterval: (query) => {
      const data = query.state.data as Instance | undefined;
      const status = data?.status;
      const channel = data?.channel;
      if (status === "connecting" && (!channel || channel === "whatsapp")) return 2_000;
      return 10_000;
    },
  });

  const handleDelete = async () => {
    if (!await showConfirm(`Remover a instância "${instance?.name}"? Esta ação é irreversível.`, { title: "Remover instância", confirmLabel: "Remover" })) return;
    setDeleting(true);
    try {
      await instancesApi.delete(instanceId);
      toast.success("Instância removida");
      queryClient.invalidateQueries({ queryKey: ["instances"] });
      router.push("/instances");
    } catch {
      toast.error("Erro ao remover instância");
      setDeleting(false);
    }
  };

  const isWhatsApp = !instance?.channel || instance.channel === "whatsapp";
  const isInstagram = instance?.channel === "instagram";
  const isTikTok = instance?.channel === "tiktok";
  const isSocial = isInstagram || isTikTok;

  const needsIgLogin = isInstagram && !instance.instagram_username && instance.status !== "connected";

  const tabs: { id: Tab; label: string; icon: React.ReactNode; alert?: boolean }[] = [
    // WhatsApp-specific tabs
    ...(isWhatsApp ? [
      { id: "geral" as Tab, label: "Geral", icon: <Settings className="w-3.5 h-3.5" /> },
      { id: "proxy" as Tab, label: "Proxy", icon: <Globe className="w-3.5 h-3.5" /> },
      { id: "webhooks" as Tab, label: "Webhooks", icon: <WebhookIcon className="w-3.5 h-3.5" /> },
      { id: "logs" as Tab, label: "Logs", icon: <Activity className="w-3.5 h-3.5" /> },
      { id: "recovery" as Tab, label: "Recovery", icon: <ShieldAlert className="w-3.5 h-3.5" />, alert: instance?.status === "banned" },
    ] : []),
    // Instagram-specific tabs
    ...(isInstagram ? [
      { id: "geral" as Tab, label: "Geral", icon: <Settings className="w-3.5 h-3.5" /> },
      { id: "dm" as Tab, label: "Mensagens", icon: <MessageSquareText className="w-3.5 h-3.5" /> },
      { id: "actions" as Tab, label: "Ações", icon: <Users className="w-3.5 h-3.5" /> },
      { id: "posts" as Tab, label: "Publicar", icon: <Camera className="w-3.5 h-3.5" /> },
      { id: "stories" as Tab, label: "Stories", icon: <Video className="w-3.5 h-3.5" /> },
      { id: "media" as Tab, label: "Mídia", icon: <Image className="w-3.5 h-3.5" /> },
      { id: "proxy" as Tab, label: "Proxy", icon: <Globe className="w-3.5 h-3.5" /> },
      { id: "webhooks" as Tab, label: "Webhooks", icon: <WebhookIcon className="w-3.5 h-3.5" /> },
      { id: "logs" as Tab, label: "Logs", icon: <Activity className="w-3.5 h-3.5" /> },
    ] : []),
    // TikTok-specific tabs
    ...(isTikTok ? [
      { id: "geral" as Tab, label: "Geral", icon: <Settings className="w-3.5 h-3.5" /> },
      { id: "dm" as Tab, label: "Mensagens", icon: <MessageSquareText className="w-3.5 h-3.5" /> },
      { id: "actions" as Tab, label: "Ações", icon: <Users className="w-3.5 h-3.5" /> },
      { id: "scraping" as Tab, label: "Scraping", icon: <Download className="w-3.5 h-3.5" /> },
      { id: "proxy" as Tab, label: "Proxy", icon: <Globe className="w-3.5 h-3.5" /> },
      { id: "webhooks" as Tab, label: "Webhooks", icon: <WebhookIcon className="w-3.5 h-3.5" /> },
      { id: "logs" as Tab, label: "Logs", icon: <Activity className="w-3.5 h-3.5" /> },
    ] : []),
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-9 w-56 rounded-xl" />
        <div className="skeleton h-64 rounded-2xl" />
      </div>
    );
  }

  if (!instance && !deleting) {
    return (
      <div className="text-center py-20">
        <p className="text-sm" style={{ color: "hsl(240 8% 42%)" }}>Instância não encontrada.</p>
        <Link href="/instances" className="mt-3 inline-block text-sm transition-colors" style={{ color: "var(--green)" }}>
          Voltar para instâncias
        </Link>
      </div>
    );
  }

  const isConnected = instance.status === "connected";

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/instances"
            className="w-9 h-9 flex items-center justify-center rounded-xl transition-all flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "hsl(240 8% 52%)" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.07)";
              (e.currentTarget as HTMLElement).style.color = "hsl(240 15% 93%)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
              (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 52%)";
            }}
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{
                  background: isConnected ? "rgba(0,212,106,0.1)" : "rgba(255,255,255,0.04)",
                  border: isConnected ? "1px solid rgba(0,212,106,0.2)" : "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <Smartphone className="w-4 h-4" style={{ color: isConnected ? "var(--green)" : "hsl(240 8% 38%)" }} />
              </div>
              <h1 className="text-xl font-bold tracking-tight" style={{ color: "hsl(240 15% 93%)" }}>
                {instance.name}
              </h1>
              <StatusBadge status={instance.status} />
              {instance.proxy_enabled && instance.proxy_status === "ok" && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.18)", color: "#60a5fa" }}
                >
                  <Globe className="w-3 h-3" />Proxy
                </span>
              )}
              {instance.proxy_enabled && instance.proxy_status === "failed" && (
                <span
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                  style={{ background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.18)", color: "#fb923c" }}
                >
                  <AlertTriangle className="w-3 h-3" />Proxy erro
                </span>
              )}
            </div>
            <p className="text-sm mt-1" style={{ color: "hsl(240 8% 42%)" }}>
              {instance.phone_number || "Sem número vinculado"}
            </p>
          </div>
        </div>

        <button
          onClick={handleDelete}
          disabled={deleting}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-xl transition-all disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", color: "hsl(240 8% 42%)" }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(239,68,68,0.08)";
            (e.currentTarget as HTMLElement).style.color = "#ef4444";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(239,68,68,0.15)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)";
            (e.currentTarget as HTMLElement).style.color = "hsl(240 8% 42%)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)";
          }}
        >
          {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
          Remover
        </button>
      </div>

      {/* Tabs */}
      <div
        className="flex gap-0.5 p-1 rounded-xl w-fit"
        style={{ background: "hsl(240 18% 5%)", border: "1px solid hsl(240 12% 11%)" }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center gap-2 text-xs font-medium px-3.5 py-2 rounded-lg transition-all"
              style={active ? {
                background: "rgba(255,255,255,0.07)",
                color: "hsl(240 15% 93%)",
                boxShadow: "inset 1px 0 0 0 var(--green), inset 0 0 0 1px rgba(255,255,255,0.06)",
              } : {
                color: "hsl(240 8% 42%)",
              }}
            >
              <span style={active ? { color: "var(--green)" } : undefined}>{tab.icon}</span>
              {tab.label}
              {tab.alert && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red-500" />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "geral"    && <GeralTab instance={instance} instanceId={instanceId} />}
        {activeTab === "proxy"    && <ProxyConfigForm instanceId={instanceId} />}
        {activeTab === "webhooks" && <WebhooksTab instanceId={instanceId} instance={instance} />}
        {activeTab === "logs"     && <LogsTab instanceId={instanceId} />}
        {activeTab === "recovery" && <RecoveryTab instance={instance} instanceId={instanceId} />}
        {activeTab === "dm"       && <DMTab instance={instance} />}
        {activeTab === "actions"  && <ActionsTab instance={instance} />}
        {activeTab === "scraping" && <ScrapingTab instance={instance} />}
        {activeTab === "posts"    && <PostsTab instance={instance} />}
        {activeTab === "stories"  && <StoriesTab instance={instance} />}
        {activeTab === "media"    && <MediaTab instance={instance} />}
      </div>
    </div>
  );
}

// ─── Instagram/TikTok: DM Tab ───────────────────────────────────────────
function DMTab({ instance }: { instance: Instance }) {
  const channel = instance.channel || "whatsapp";
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const sendDM = async () => {
    if (!target.trim() || !message.trim()) return;
    setSending(true);
    try {
      if (channel === "instagram") {
        await instancesApi.instagramSendDM(instance.id, { recipient: target.trim(), message: message.trim() });
      } else {
        await tiktokApi.sendDM(instance.id, target.trim(), message.trim());
      }
      toast.success("DM enviado com sucesso!");
      setMessage("");
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Erro ao enviar DM");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl p-5 space-y-5" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
      <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "hsl(240 15% 93%)" }}>
        <MessageSquareText className="w-4 h-4" style={{ color: channel === "instagram" ? "#e1306c" : "#ff0050" }} />
        Enviar DM
      </h3>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>Usuário destino</label>
          <input type="text" value={target} onChange={e => setTarget(e.target.value)} placeholder="username" className="input-field w-full" />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>Mensagem</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="Digite sua mensagem..." className="input-field w-full resize-none" />
        </div>
        <button onClick={sendDM} disabled={sending || !target.trim() || !message.trim()}
          className="btn-primary flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-40">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Enviar DM
        </button>
      </div>
    </div>
  );
}

// ─── Instagram/TikTok: Actions Tab (Follow/Unfollow) ─────────────────────
function ActionsTab({ instance }: { instance: Instance }) {
  const channel = instance.channel || "whatsapp";
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAction = async (action: "follow" | "unfollow") => {
    if (!target.trim()) return;
    setLoading(true);
    try {
      if (action === "follow") {
        if (channel === "instagram") {
          await instancesApi.instagramFollow(instance.id, target.trim());
        } else {
          await tiktokApi.follow(instance.id, target.trim());
        }
        toast.success(`Seguiu @${target.trim()} com sucesso!`);
      } else {
        if (channel === "instagram") {
          await instancesApi.instagramUnfollow(instance.id, target.trim());
        } else {
          await tiktokApi.unfollow(instance.id, target.trim());
        }
        toast.success(`Deixou de seguir @${target.trim()} com sucesso!`);
      }
      setTarget("");
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Erro ao executar ação");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl p-5 space-y-5" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
      <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "hsl(240 15% 93%)" }}>
        <Users className="w-4 h-4" style={{ color: channel === "instagram" ? "#e1306c" : "#ff0050" }} />
        Ações de Seguimento
      </h3>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>Usuário destino</label>
          <input type="text" value={target} onChange={e => setTarget(e.target.value)} placeholder="username" className="input-field w-full" />
        </div>
        <div className="flex gap-2">
          <button onClick={() => handleAction("follow")} disabled={loading || !target.trim()}
            className="btn-primary flex-1 flex items-center justify-center gap-2 py-2 text-sm disabled:opacity-40">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            Seguir
          </button>
          <button onClick={() => handleAction("unfollow")} disabled={loading || !target.trim()}
            className="btn-ghost flex-1 flex items-center justify-center gap-2 py-2 text-sm disabled:opacity-40">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <User className="w-4 h-4" />}
            Deixar de Seguir
          </button>
        </div>
      </div>

      <div className="border-t pt-4" style={{ borderColor: "hsl(240 12% 13%)" }}>
        <p className="text-xs mb-2" style={{ color: "hsl(240 8% 46%)" }}>Filtros avançados (Insomniac)</p>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" placeholder="Mín. seguidores" className="input-field text-xs" />
          <input type="number" placeholder="Máx. seguindo" className="input-field text-xs" />
          <input type="number" placeholder="Mín. posts" className="input-field text-xs" />
          <input type="number" placeholder="Razão mín. (followers/following)" className="input-field text-xs" />
        </div>
      </div>
    </div>
  );
}

// ─── Instagram/TikTok: Scraping Tab ─────────────────────────────────────
function ScrapingTab({ instance }: { instance: Instance }) {
  const channel = instance.channel || "whatsapp";
  const [source, setSource] = useState<"followers" | "hashtag" | "post">("followers");
  const [target, setTarget] = useState("");
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const handleScrape = async () => {
    if (!target.trim()) return;
    if (channel === "instagram") {
      toast.error("Scraping Instagram foi removido desta integração.");
      return;
    }
    setLoading(true);
    try {
      let res;
      if (source === "followers") {
        res = await tiktokApi.scrapeFollowers(instance.id, target.trim(), limit);
      } else if (source === "hashtag") {
        res = await tiktokApi.scrapeHashtag(instance.id, target.trim(), limit);
      } else {
        res = await (tiktokApi as any).scrapePostLikers(instance.id, target.trim(), limit);
      }
      setResults(res.data?.users || []);
      toast.success(`Scraped ${res.data?.scraped || 0} perfis (${res.data?.saved || 0} salvos)`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Erro ao fazer scraping");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl p-5 space-y-5" style={{ background: "hsl(240 18% 6%)", border: "1px solid hsl(240 12% 13%)" }}>
      <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "hsl(240 15% 93%)" }}>
        <Download className="w-4 h-4" style={{ color: channel === "instagram" ? "#e1306c" : "#ff0050" }} />
        Scraping de Perfis
      </h3>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>Fonte</label>
          <div className="flex gap-2">
            {[
              { id: "followers", label: "Seguidores" },
              { id: "hashtag", label: "Hashtag" },
              { id: "post", label: "Post (likers)" },
            ].map(s => (
              <button key={s.id} onClick={() => setSource(s.id as any)}
                className="flex-1 py-2 text-xs font-medium rounded-lg transition-colors"
                style={source === s.id
                  ? { background: "rgba(0,212,106,0.1)", border: "1px solid rgba(0,212,106,0.2)", color: "#00d46a" }
                  : { background: "hsl(240 12% 10%)", border: "1px solid hsl(240 12% 15%)", color: "hsl(240 8% 50%)" }
                }>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>
            {source === "followers" ? "Nome de usuário" : source === "hashtag" ? "Hashtag (sem #)" : "URL do post"}
          </label>
          <input type="text" value={target} onChange={e => setTarget(e.target.value)}
            placeholder={source === "followers" ? "@username" : source === "hashtag" ? "instagram" : "https://www.instagram.com/p/..."}
            className="input-field w-full" />
        </div>
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>Limite</label>
          <input type="number" value={limit} onChange={e => setLimit(Number(e.target.value))} min={1} max={500}
            className="input-field w-full" />
        </div>
        <button onClick={handleScrape} disabled={loading || !target.trim()}
          className="btn-primary w-full flex items-center justify-center gap-2 py-2 text-sm disabled:opacity-40">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Iniciar Scraping
        </button>
      </div>

      {results.length > 0 && (
        <div className="border-t pt-4" style={{ borderColor: "hsl(240 12% 13%)" }}>
          <p className="text-xs font-medium mb-2" style={{ color: "hsl(240 8% 55%)" }}>
            Resultados ({results.length})
          </p>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {results.slice(0, 20).map((u, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
                style={{ background: "hsl(240 12% 10%)" }}>
                <span style={{ color: "hsl(240 15% 80%)" }}>{u.username}</span>
                {u.followers > 0 && (
                  <span style={{ color: "hsl(240 8% 40%)" }}>{u.followers} seguidores</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ─── Instagram: Posts Tab ────────────────────────────────────────────────────
function PostsTab({ instance }: { instance: Instance }) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; message?: string } | null>(null);

  const handlePublish = async () => {
    if (!mediaUrl.trim()) return;
    setSending(true);
    setResult(null);
    try {
      await instancesApi.instagramPublishPost(instance.id, { image_url: mediaUrl.trim(), caption: caption.trim() });
      setResult({ success: true, message: "Post publicado com sucesso!" });
      setMediaUrl("");
      setCaption("");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao publicar";
      setResult({ success: false, message: msg });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>
        Publique fotos/vídeos no Instagram da conta conectada.
      </p>
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>URL da imagem/vídeo</label>
        <input type="text" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
          placeholder="https://exemplo.com/imagem.jpg"
          className="input-field w-full" />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>Legenda</label>
        <textarea value={caption} onChange={e => setCaption(e.target.value)}
          placeholder="Sua legenda..."
          rows={3}
          className="input-field w-full" />
      </div>
      <button onClick={handlePublish} disabled={sending || !mediaUrl.trim()}
        className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-40"
        style={{ background: "#e1306c", color: "white" }}>
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        Publicar
      </button>
      {result && (
        <div className={`p-3 rounded-xl text-sm ${result.success ? "bg-green-900/20 text-green-400" : "bg-red-900/20 text-red-400"}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}

// ─── Instagram: Stories Tab ───────────────────────────────────────────────────
function StoriesTab({ instance }: { instance: Instance }) {
  const [mediaUrl, setMediaUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ success?: boolean; message?: string } | null>(null);

  const handlePublish = async () => {
    if (!mediaUrl.trim()) return;
    setSending(true);
    setResult(null);
    try {
      await instancesApi.instagramUploadStory(instance.id, { image_url: mediaUrl.trim(), caption: caption.trim() });
      setResult({ success: true, message: "Story publicado com sucesso!" });
      setMediaUrl("");
      setCaption("");
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || "Erro ao publicar story";
      setResult({ success: false, message: msg });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>
        Publique stories (foto/vídeo) que desaparecem em 24h.
      </p>
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>URL da mídia</label>
        <input type="text" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
          placeholder="https://exemplo.com/video.mp4"
          className="input-field w-full" />
      </div>
      <div>
        <label className="text-xs font-medium block mb-1" style={{ color: "hsl(240 8% 55%)" }}>Texto (opcional)</label>
        <input type="text" value={caption} onChange={e => setCaption(e.target.value)}
          placeholder="Texto sobre a imagem..."
          className="input-field w-full" />
      </div>
      <button onClick={handlePublish} disabled={sending || !mediaUrl.trim()}
        className="btn-primary w-full flex items-center justify-center gap-2 py-2.5 text-sm disabled:opacity-40"
        style={{ background: "#e1306c", color: "white" }}>
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />}
        Publicar Story
      </button>
      {result && (
        <div className={`p-3 rounded-xl text-sm ${result.success ? "bg-green-900/20 text-green-400" : "bg-red-900/20 text-red-400"}`}>
          {result.message}
        </div>
      )}
    </div>
  );
}

// ─── Instagram: Media Tab ───────────────────────────────────────────────────
function MediaTab({ instance }: { instance: Instance }) {
  const [targetUser, setTargetUser] = useState("");
  const [media, setMedia] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchMedia = async () => {
    if (!targetUser.trim()) return;
    setLoading(true);
    try {
      const res = await instancesApi.instagramGetUserMedia(instance.id, targetUser.trim());
      setMedia(res.data?.users?.[0]?.media || []);
    } catch (err: unknown) {
      toast.error("Erro ao buscar mídia");
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async (mediaId: string) => {
    try {
      await instancesApi.instagramLikeMedia(instance.id, mediaId);
      toast.success("Post liked!");
    } catch (err: unknown) {
      toast.error("Erro ao dar like");
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "hsl(240 8% 42%)" }}>
        Veja mídia de usuários e interaja com posts.
      </p>
      <div className="flex gap-2">
        <input type="text" value={targetUser} onChange={e => setTargetUser(e.target.value)}
          placeholder="@username"
          className="input-field flex-1" />
        <button onClick={fetchMedia} disabled={loading || !targetUser.trim()}
          className="btn-primary px-4 py-2 text-sm disabled:opacity-40">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Buscar"}
        </button>
      </div>

      {media.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mt-4">
          {media.slice(0, 9).map((m: any, i: number) => (
            <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-gray-800 group">
              {m.media_type === "VIDEO" ? (
                <Video className="w-6 h-6 absolute center" />
              ) : (
                <img src={m.image_versions2?.candidates?.[0]?.url || ""} alt="" className="w-full h-full object-cover" />
              )}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button onClick={() => handleLike(m.id)} className="p-2 bg-white/20 rounded-full">
                  <Smile className="w-4 h-4 text-white" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
