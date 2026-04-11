"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { instancesApi, webhooksApi, messagesApi, settingsApi, mcpApi, recoveryApi, instagramApi, tiktokApi, type WebhookPayload } from "@/lib/api";
import {
  Smartphone, ArrowLeft, Globe, AlertTriangle,
  QrCode, Power, Trash2, Plus, X, Send, ChevronRight,
  Webhook as WebhookIcon, Activity, Settings, Loader2, Copy, Check,
  RefreshCw, Bot, ChevronDown, ChevronUp, Image, FileText, Music,
  Video, MapPin, User, Smile, BarChart2, Sticker, MessageSquareText,
  MousePointerClick, ShieldAlert, Camera, Users, Phone, RotateCcw, Download,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { showConfirm } from "@/lib/confirm";
import type { Instance, InstanceSettings, MessageLog, InstanceProfile, Webhook } from "@/types";
import Link from "next/link";
import { QRCodeModal } from "@/components/instances/QRCodeModal";
import { ProxyConfigForm } from "@/components/instances/ProxyConfigForm";

type Tab = "geral" | "proxy" | "webhooks" | "logs" | "recovery" | "dm" | "actions" | "scraping";

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
            <a href="/settings/webhooks" className="text-[10px] px-2 py-1.5 rounded-lg" style={{ background: "hsl(240 12% 10%)", color: "hsl(240 8% 48)" }}>
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
  const [msgType, setMsgType] = useState<"text"|"image"|"document"|"audio"|"video"|"location"|"contact"|"reaction"|"poll"|"sticker"|"buttons">("text");
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
  const [btnItems, setBtnItems] = useState("Sim\nNão\nTalvez");
  // list

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
      case "buttons":  return !!btnBody.trim() && btnItems.split("\n").filter(Boolean).length >= 1;

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
          const buttons = btnItems.split("\n").filter(Boolean).slice(0, 3).map((t, i) => ({ id: `btn_${i}`, text: t.trim() }));
          await messagesApi.sendButtons(instanceId, { to: recipient, body: btnBody, footer: btnFooter || undefined, buttons });
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
                Instagram Beta
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
                Proxy {instance.proxy_status === "ok" ? "ativo" : "com erro"}
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
          {isSocial && instance.status !== "connected" && (
            <button
              onClick={() => reconnectMutation.mutate()}
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
          {instance.status === "connected" ? (
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
          )}
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
            <div className="space-y-2">
              <textarea value={btnBody} onChange={e => setBtnBody(e.target.value)}
                rows={2} placeholder="Texto da mensagem" className="input-field w-full resize-none" />
              <input value={btnFooter} onChange={e => setBtnFooter(e.target.value)}
                placeholder="Rodapé (opcional)" className="input-field w-full" />
              <textarea value={btnItems} onChange={e => setBtnItems(e.target.value)}
                rows={3} placeholder={"Sim\nNão\nTalvez"} className="input-field w-full resize-none" />
              <p className="text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>Um botão por linha · máximo 3</p>
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
    // Stop polling while deleting to avoid 404 race; poll faster while connecting
    enabled: !deleting,
    refetchInterval: (query) => {
      const status = (query.state.data as Instance | undefined)?.status;
      return status === "connecting" ? 2_000 : 10_000;
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
      { id: "scraping" as Tab, label: "Scraping", icon: <Download className="w-3.5 h-3.5" /> },
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
      </div>
    </div>
  );
}

// ─── Instagram/TikTok: DM Tab ───────────────────────────────────────────
function DMTab({ instance }: { instance: Instance }) {
  const channel = instance.channel || "whatsapp";
  const api = channel === "instagram" ? instagramApi : tiktokApi;
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const sendDM = async () => {
    if (!target.trim() || !message.trim()) return;
    setSending(true);
    try {
      await api.sendDM(instance.id, target.trim(), message.trim());
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
  const api = channel === "instagram" ? instagramApi : tiktokApi;
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);

  const handleAction = async (action: "follow" | "unfollow") => {
    if (!target.trim()) return;
    setLoading(true);
    try {
      if (action === "follow") {
        await api.follow(instance.id, target.trim());
        toast.success(`Seguiu @${target.trim()} com sucesso!`);
      } else {
        await api.unfollow(instance.id, target.trim());
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
  const api = channel === "instagram" ? instagramApi : tiktokApi;
  const [source, setSource] = useState<"followers" | "hashtag" | "post">("followers");
  const [target, setTarget] = useState("");
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const handleScrape = async () => {
    if (!target.trim()) return;
    setLoading(true);
    try {
      let res;
      if (source === "followers") {
        res = await api.scrapeFollowers(instance.id, target.trim(), limit);
      } else if (source === "hashtag") {
        res = await api.scrapeHashtag(instance.id, target.trim(), limit);
      } else {
        res = await (api as any).scrapePostLikers(instance.id, target.trim(), limit);
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
