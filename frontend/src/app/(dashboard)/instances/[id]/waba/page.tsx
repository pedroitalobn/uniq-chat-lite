"use client";

// WhatsApp API (WABA) — gestão da instância:
//   - Status da conexão + register phone (PIN)
//   - Subscribe webhooks
//   - Templates HSM (list / create / delete)
//   - Test send (enviar mensagem de texto)
//
// Pra video Meta:
//   1. whatsapp_business_messaging  → "Test send" envia mensagem visível
//      no app WhatsApp do destinatário.
//   2. whatsapp_business_management → "Criar template" cria HSM novo.

import { use, useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, Loader2, Phone, Plus, Send, Trash2, Webhook, Sparkles, AlertCircle, Copy,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { wabaApi } from "@/lib/api";
import { WABAConnectButton } from "@/components/instances/WABAConnectButton";

interface WABAData {
  id: string;
  instance_id: string;
  waba_business_id: string;
  phone_number_id: string;
  phone_number: string;
  verified_name: string;
  status: string;
  code_verification: string;
}

interface Template {
  name: string;
  language: string;
  status: string;
  category: string;
  components: any[];
}

export default function WABAManagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();

  // Quando voltamos do callback OAuth com ?waba_connected=1 pode ser que
  // ainda tenhamos cache stale de connected:false. Invalida e limpa o param.
  useEffect(() => {
    if (searchParams.get("waba_connected") === "1") {
      qc.invalidateQueries({ queryKey: ["waba", id] });
      qc.invalidateQueries({ queryKey: ["instance", id] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      toast.success("WhatsApp API conectado!");
      router.replace(`/instances/${id}/waba`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const { data: wabaResp, isLoading } = useQuery<WABAData | { connected: false; instance_id: string }>({
    queryKey: ["waba", id],
    queryFn: () => wabaApi.get(id).then((r) => r.data),
    retry: false,
  });
  const waba: WABAData | undefined =
    wabaResp && "connected" in wabaResp && wabaResp.connected === false
      ? undefined
      : (wabaResp as WABAData | undefined);

  const { data: templatesRes } = useQuery<{ items: Template[] }>({
    queryKey: ["waba-templates", id],
    queryFn: () => wabaApi.templates(id).then((r) => r.data),
    enabled: !!waba,
  });
  const templates = templatesRes?.items || [];

  const subscribeMut = useMutation({
    mutationFn: () => wabaApi.subscribe(id),
    onSuccess: () => toast.success("Webhook subscriado na Meta"),
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao subscribir"),
  });

  const [registerPin, setRegisterPin] = useState("");
  const registerMut = useMutation({
    mutationFn: () => wabaApi.register(id, registerPin),
    onSuccess: () => {
      toast.success("Número registrado — pode enviar mensagens");
      setRegisterPin("");
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha no register"),
  });

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  if (!waba) {
    return (
      <div className="space-y-5 px-4 sm:px-6 py-6 lg:py-8 max-w-2xl mx-auto">
        <Link href="/instances"
          className="inline-flex items-center gap-1.5 text-xs"
          style={{ color: "var(--text-3)" }}>
          <ArrowLeft className="w-3.5 h-3.5" /> Voltar para instâncias
        </Link>

        <div>
          <h1 className="text-xl font-medium mb-1" style={{ color: "var(--text-1)" }}>
            Conectar WhatsApp API
          </h1>
          <p className="text-sm" style={{ color: "var(--text-3)" }}>
            Faça o Embedded Signup com a Meta para vincular sua conta WhatsApp
            Business e número de telefone a esta instância.
          </p>
        </div>

        <div className="rounded-2xl p-6 space-y-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <WABAConnectButton instanceId={id} />
          <p className="text-[11px] text-center" style={{ color: "var(--text-3)" }}>
            Já tentou e falhou? Você pode <button onClick={() => qc.invalidateQueries({ queryKey: ["waba", id] })} className="underline" style={{ color: "var(--text-2)" }}>recarregar a página</button> ou clicar em &quot;Conectar&quot; novamente.
          </p>
        </div>

        <div className="rounded-xl p-4 text-xs leading-relaxed space-y-1.5"
          style={{ background: "var(--surface-2)", border: "1px dashed var(--surface-border)", color: "var(--text-3)" }}>
          <p className="font-medium" style={{ color: "var(--text-2)" }}>
            O que vai acontecer:
          </p>
          <p>1. Popup da Meta abre — login Facebook + seleciona Business Manager</p>
          <p>2. Cria/seleciona conta WhatsApp Business e número de telefone</p>
          <p>3. Verifica número via SMS/voz e define PIN 2FA</p>
          <p>4. Esta instância passa para status &quot;Conectada&quot;</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 px-4 sm:px-6 py-6 lg:py-8">
      <Link href={`/instances/${id}`}
        className="inline-flex items-center gap-1.5 text-xs"
        style={{ color: "var(--text-3)" }}>
        <ArrowLeft className="w-3.5 h-3.5" /> Voltar pra instância
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>
              WhatsApp API
            </h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(0,136,255,0.12)", color: "#0088ff" }}>
              CLOUD API OFICIAL META
            </span>
          </div>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            {waba.verified_name} · {waba.phone_number}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <ReconnectButton instanceId={id} />
        </div>
      </div>

      {/* Status cards */}
      <div className="grid sm:grid-cols-3 gap-3">
        <StatusCard
          icon={Phone}
          label="Phone Number ID"
          value={waba.phone_number_id}
          mono
        />
        <StatusCard
          icon={CheckCircle2}
          label="Verificação"
          value={waba.code_verification}
          color="var(--green)"
        />
        <StatusCard
          icon={Webhook}
          label="Status"
          value={waba.status}
          color={waba.status === "active" ? "var(--green)" : "#fbbf24"}
        />
      </div>

      {/* Subscribe + Register */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="rounded-2xl p-4"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Webhook className="w-4 h-4" style={{ color: "var(--green)" }} />
            <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>1. Subscribe webhook</h3>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-3)" }}>
            Pede pra Meta começar a entregar mensagens recebidas no nosso webhook.
            Já chamado automaticamente após Embedded Signup; clique aqui pra re-tentar se houve erro.
          </p>
          <button
            onClick={() => subscribeMut.mutate()}
            disabled={subscribeMut.isPending}
            className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}>
            {subscribeMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />}
            Subscribe
          </button>
        </div>

        <div className="rounded-2xl p-4"
          style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
          <div className="flex items-center gap-2 mb-2">
            <Phone className="w-4 h-4" style={{ color: "#0088ff" }} />
            <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>2. Register phone (2FA)</h3>
          </div>
          <p className="text-xs mb-3" style={{ color: "var(--text-3)" }}>
            Ativa o número pra envio. Defina um PIN de 6 dígitos na sua conta Meta Business
            (Settings → 2FA → SMS PIN) e cole abaixo.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={registerPin}
              onChange={(e) => setRegisterPin(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="input-field flex-1 text-center font-mono"
            />
            <button
              onClick={() => registerMut.mutate()}
              disabled={registerPin.length !== 6 || registerMut.isPending}
              className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-40"
              style={{ background: "#0088ff", color: "white" }}>
              {registerMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Registrar
            </button>
          </div>
        </div>
      </div>

      {/* Templates section */}
      <TemplatesSection instanceId={id} templates={templates} qc={qc} />

      {/* Test send */}
      <TestSendSection instanceId={id} wabaStatus={waba.status} />

      {/* Diagnóstico Meta */}
      <div className="rounded-xl p-3 flex items-start gap-2"
        style={{ background: "rgba(0,136,255,0.08)", border: "1px solid rgba(0,136,255,0.22)" }}>
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#0088ff" }} />
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          <p className="font-medium mb-0.5" style={{ color: "var(--text-1)" }}>Vídeos pra Meta</p>
          <p>
            <strong>whatsapp_business_messaging</strong>: grave o "Enviar mensagem de teste" abaixo
            mostrando a app enviando + WhatsApp recebendo no celular.<br />
            <strong>whatsapp_business_management</strong>: grave a criação de um template (botão "Criar template" abaixo).
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ icon: Icon, label, value, color, mono }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  color?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-2xl p-3"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-medium mb-1"
        style={{ color: "var(--text-3)" }}>
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <p className={mono ? "text-xs font-mono break-all" : "text-sm font-medium"}
        style={{ color: color || "var(--text-1)" }}>
        {value}
      </p>
    </div>
  );
}

function TemplatesSection({ instanceId, templates, qc }: {
  instanceId: string;
  templates: Template[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [creating, setCreating] = useState(false);

  const deleteMut = useMutation({
    mutationFn: (name: string) => wabaApi.deleteTemplate(instanceId, name),
    onSuccess: () => {
      toast.success("Template removido");
      qc.invalidateQueries({ queryKey: ["waba-templates", instanceId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao remover"),
  });

  return (
    <div className="rounded-2xl"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: "var(--surface-border)" }}>
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4" style={{ color: "#a78bfa" }} />
          <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            Templates HSM ({templates.length})
          </h3>
        </div>
        <button onClick={() => setCreating(true)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5"
          style={{ background: "var(--green)", color: "var(--green-fg)" }}>
          <Plus className="w-3.5 h-3.5" /> Criar template
        </button>
      </div>
      {templates.length === 0 ? (
        <div className="text-center py-8 px-4">
          <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhum template aprovado ainda.</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Crie um pra começar conversas fora da janela de 24h.
          </p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: "var(--surface-border)" }}>
          {templates.map((t) => (
            <div key={`${t.name}-${t.language}`} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{t.name}</p>
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  {t.language} · {t.category} ·{" "}
                  <span style={{ color: t.status === "APPROVED" ? "var(--green)" : "#fbbf24" }}>
                    {t.status}
                  </span>
                </p>
              </div>
              <button onClick={() => { if (confirm(`Remover template ${t.name}?`)) deleteMut.mutate(t.name); }}
                className="p-1.5 rounded-md" style={{ color: "#f87171" }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {creating && (
        <CreateTemplateModal instanceId={instanceId}
          onClose={() => setCreating(false)}
          onCreated={() => {
            qc.invalidateQueries({ queryKey: ["waba-templates", instanceId] });
            setCreating(false);
          }} />
      )}
    </div>
  );
}

function CreateTemplateModal({ instanceId, onClose, onCreated }: {
  instanceId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("pt_BR");
  const [category, setCategory] = useState<"MARKETING" | "UTILITY" | "AUTHENTICATION">("UTILITY");
  const [bodyText, setBodyText] = useState("");

  const create = useMutation({
    mutationFn: () => wabaApi.createTemplate(instanceId, {
      name: name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      language,
      category,
      components: [{ type: "BODY", text: bodyText }],
    }),
    onSuccess: () => {
      toast.success("Template enviado pra aprovação Meta");
      onCreated();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao criar"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl w-full max-w-lg p-5"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
        <h3 className="text-sm font-medium mb-4" style={{ color: "var(--text-1)" }}>Criar template HSM</h3>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Nome (lowercase, _)</label>
            <input required value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="hello_world" className="input-field w-full font-mono" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Idioma</label>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} className="input-field w-full">
                <option value="pt_BR">Português (BR)</option>
                <option value="en_US">English (US)</option>
                <option value="es_ES">Español</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Categoria</label>
              <select value={category} onChange={(e) => setCategory(e.target.value as any)} className="input-field w-full">
                <option value="UTILITY">UTILITY</option>
                <option value="MARKETING">MARKETING</option>
                <option value="AUTHENTICATION">AUTHENTICATION</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>
              Body (use {`{{1}}`}, {`{{2}}`} pra variáveis)
            </label>
            <textarea required rows={4} value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Olá {{1}}, sua compra foi confirmada!"
              className="input-field w-full" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="text-xs px-3 py-2 rounded-lg"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
              Cancelar
            </button>
            <button type="submit" disabled={create.isPending}
              className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}>
              {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Enviar pra aprovação
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TestSendSection({ instanceId }: { instanceId: string; wabaStatus?: string }) {
  const [to, setTo] = useState("");
  const [text, setText] = useState("Olá! Mensagem de teste enviada via Uniq Chat.");
  const [sentId, setSentId] = useState("");
  const [mode, setMode] = useState<"text" | "template">("template");
  const [templateName, setTemplateName] = useState("hello_world");
  const [templateLang, setTemplateLang] = useState("en_US");

  const send = useMutation({
    mutationFn: () =>
      mode === "text"
        ? wabaApi.sendMessage(instanceId, {
            to,
            type: "text",
            text: { body: text },
          })
        : wabaApi.sendMessage(instanceId, {
            to,
            type: "template",
            template: {
              name: templateName,
              language: { code: templateLang },
            },
          }),
    onSuccess: (r: any) => {
      const msgId = r.data?.messages?.[0]?.id || r.data?.id || "";
      setSentId(msgId);
      toast.success("Mensagem enviada — confira o WhatsApp do destinatário");
    },
    onError: (e: any) => {
      const raw = e?.response?.data?.error || "";
      // Detecta erros comuns da Cloud API e dá instrução clara
      if (raw.includes("133010") || raw.includes("Account not registered")) {
        toast.error("Número não registrado. Use o card '2. Register phone' acima com seu PIN 2FA antes de enviar.", { duration: 8000 });
      } else if (raw.includes("131056") || raw.includes("Pair not allowed")) {
        toast.error("Destinatário não está na lista de testes da Meta. Adicione em Meta Business → WhatsApp → API Setup → 'To'.", { duration: 8000 });
      } else if (raw.includes("132000") || raw.includes("template")) {
        toast.error("Template inválido ou não aprovado pela Meta. Verifique nome/idioma exato.", { duration: 6000 });
      } else {
        toast.error(raw || "Falha ao enviar");
      }
    },
  });

  return (
    <div className="rounded-2xl p-4"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center gap-2 mb-3">
        <Send className="w-4 h-4" style={{ color: "var(--green)" }} />
        <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>Enviar mensagem de teste</h3>
      </div>
      <div className="flex gap-2 mb-2 text-xs">
        <button
          onClick={() => setMode("template")}
          className="px-2.5 py-1 rounded-md font-medium"
          style={{
            background: mode === "template" ? "var(--green)" : "var(--surface-3)",
            color: mode === "template" ? "var(--green-fg)" : "var(--text-2)",
          }}>
          Template (1º envio)
        </button>
        <button
          onClick={() => setMode("text")}
          className="px-2.5 py-1 rounded-md font-medium"
          style={{
            background: mode === "text" ? "var(--green)" : "var(--surface-3)",
            color: mode === "text" ? "var(--green-fg)" : "var(--text-2)",
          }}>
          Texto livre (janela 24h)
        </button>
      </div>
      <div className="grid sm:grid-cols-3 gap-2">
        <input value={to} onChange={(e) => setTo(e.target.value)}
          placeholder="+5511987654321" className="input-field" />
        {mode === "text" ? (
          <input value={text} onChange={(e) => setText(e.target.value)}
            placeholder="Texto" className="input-field sm:col-span-2" />
        ) : (
          <>
            <input value={templateName} onChange={(e) => setTemplateName(e.target.value)}
              placeholder="hello_world" className="input-field" />
            <input value={templateLang} onChange={(e) => setTemplateLang(e.target.value)}
              placeholder="en_US" className="input-field" />
          </>
        )}
      </div>
      {mode === "template" && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
          Para o primeiro contato fora da janela de 24h, use template aprovado.
          Padrão: <code className="font-mono">hello_world</code> (en_US) — vem
          pré-aprovado em todas as WABAs novas.
        </p>
      )}
      <button
        onClick={() => send.mutate()}
        disabled={!to || (mode === "text" && !text) || (mode === "template" && !templateName) || send.isPending}
        className="mt-3 text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
        style={{ background: "var(--green)", color: "var(--green-fg)" }}>
        {send.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
        Enviar
      </button>
      {sentId && (
        <div className="mt-2 text-[11px] font-mono flex items-center gap-2" style={{ color: "var(--text-3)" }}>
          msg_id: {sentId}
          <button onClick={() => navigator.clipboard.writeText(sentId)}>
            <Copy className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}

// Reconectar = abre o popup de Embedded Signup novamente.
// Útil quando o token expirou, o WABA foi reassociado ou houve qualquer
// erro durante o flow inicial. Reusa WABAConnectButton em modo botão.
function ReconnectButton({ instanceId }: { instanceId: string }) {
  return (
    <div className="inline-block">
      <WABAConnectButton instanceId={instanceId} className="[&>button]:!py-2 [&>button]:!px-3 [&>button]:!text-xs [&>button>span]:!text-xs" />
    </div>
  );
}
