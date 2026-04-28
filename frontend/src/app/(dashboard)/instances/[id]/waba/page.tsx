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
  ArrowLeft, CheckCircle2, Loader2, Phone, Plus, Send, Trash2, Webhook, Sparkles, AlertCircle, Copy, Pencil, Check, X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { wabaApi, instancesApi } from "@/lib/api";
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
      <Link href="/instances"
        className="inline-flex items-center gap-1.5 text-xs"
        style={{ color: "var(--text-3)" }}>
        <ArrowLeft className="w-3.5 h-3.5" /> Voltar para instâncias
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <EditableInstanceName instanceId={id} />
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
              style={{ background: "rgba(0,136,255,0.12)", color: "#0088ff" }}>
              WABA
            </span>
          </div>
          <p className="text-xs" style={{ color: "var(--text-3)" }}>
            {waba.verified_name} · {waba.phone_number}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
      <TestSendSection instanceId={id} wabaStatus={waba.status} templates={templates} />

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
          <p className="text-sm" style={{ color: "var(--text-3)" }}>Nenhum template ainda.</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Crie um pra começar conversas fora da janela de 24h. Templates novos
            aparecem aqui como <span style={{ color: "#fbbf24" }}>PENDING</span> até a Meta aprovar.
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
  const [footerText, setFooterText] = useState("");
  const [examples, setExamples] = useState<string[]>([]);

  // Detecta variáveis no body. Meta suporta DOIS formatos:
  //   - Posicionais: {{1}}, {{2}}  → example: { body_text: [["valor1", "valor2"]] }
  //   - Nomeadas:    {{customer}}, {{order}} → example: { body_text_named_params: [{param_name, example}] }
  // Os formatos NÃO podem ser misturados no mesmo template.
  const rawMatches = Array.from(bodyText.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)).map((m) => m[1]);
  const uniqueVars = rawMatches.filter((v, i, a) => a.indexOf(v) === i);
  const hasPositional = uniqueVars.some((v) => /^\d+$/.test(v));
  const hasNamed = uniqueVars.some((v) => !/^\d+$/.test(v));
  const isMixed = hasPositional && hasNamed;
  const isNamed = hasNamed && !hasPositional;
  // Pra posicionais ordena numericamente; pra nomeadas mantém ordem de aparição
  const variables = isNamed
    ? uniqueVars
    : uniqueVars.sort((a, b) => parseInt(a) - parseInt(b));

  useEffect(() => {
    setExamples((prev) => {
      const next = variables.map((_, i) => prev[i] || "");
      if (next.length !== prev.length || next.some((v, i) => v !== prev[i])) {
        return next;
      }
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variables.length, isNamed]);

  const create = useMutation({
    mutationFn: () => {
      const components: Array<Record<string, unknown>> = [];

      const bodyComp: Record<string, unknown> = { type: "BODY", text: bodyText };
      if (variables.length > 0) {
        if (isNamed) {
          bodyComp.example = {
            body_text_named_params: variables.map((name, i) => ({
              param_name: name,
              example: examples[i] || "",
            })),
          };
        } else {
          bodyComp.example = { body_text: [examples] };
        }
      }
      components.push(bodyComp);

      if (footerText.trim()) {
        components.push({ type: "FOOTER", text: footerText.trim() });
      }

      return wabaApi.createTemplate(instanceId, {
        name: name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
        language,
        category,
        components,
      });
    },
    onSuccess: () => {
      toast.success("Template enviado pra aprovação Meta — status PENDING (5min a 24h)");
      onCreated();
    },
    onError: (e: any) => {
      const raw = e?.response?.data?.error || "";
      if (raw.includes("Body text contains variables but no examples")) {
        toast.error("Preencha os exemplos pra cada variável {{N}} no body.", { duration: 8000 });
      } else if (raw.includes("does not match")) {
        toast.error("Nome inválido — use apenas letras minúsculas, números e _", { duration: 6000 });
      } else if (raw.includes("already exists")) {
        toast.error("Já existe um template com esse nome+idioma. Use outro nome ou exclua o anterior.", { duration: 8000 });
      } else {
        toast.error(raw || "Falha ao criar template");
      }
    },
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
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                Body
              </label>
              <div className="flex items-center gap-1 text-[10px]" style={{ color: "var(--text-3)" }}>
                <span>Aceita</span>
                <button
                  type="button"
                  onClick={() => setBodyText((t) => t + (t && !t.endsWith(" ") ? " " : "") + `{{${(uniqueVars.filter(v => /^\d+$/.test(v)).length || 0) + 1}}}`)}
                  className="px-1.5 py-0.5 rounded font-mono hover:brightness-110"
                  style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                  {`{{1}}`}
                </button>
                <span>ou</span>
                <button
                  type="button"
                  onClick={() => setBodyText((t) => t + (t && !t.endsWith(" ") ? " " : "") + `{{nome}}`)}
                  className="px-1.5 py-0.5 rounded font-mono hover:brightness-110"
                  style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                  {`{{nome}}`}
                </button>
              </div>
            </div>
            <textarea required rows={4} value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="Olá {{1}}, sua compra foi confirmada!  —  ou  —  Olá {{nome}}, sua compra foi confirmada!"
              className="input-field w-full"
              style={isMixed ? { borderColor: "#f87171" } : undefined} />
            {isMixed && (
              <p className="text-[11px] mt-1" style={{ color: "#f87171" }}>
                ⚠️ Não misture {`{{1}}`} (posicional) com {`{{nome}}`} (nomeado) no mesmo template — Meta rejeita. Escolha um dos formatos.
              </p>
            )}
          </div>

          {variables.length > 0 && !isMixed && (
            <div className="space-y-2 rounded-lg p-3" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
              <div className="flex items-center justify-between">
                <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                  {variables.length} variável{variables.length > 1 ? "is" : ""} {isNamed ? "nomeada" : "posicional"}{variables.length > 1 ? "s" : ""} — preencha um exemplo pra cada (Meta exige na revisão)
                </p>
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full uppercase shrink-0"
                  style={{
                    background: isNamed ? "rgba(168,85,247,0.15)" : "rgba(34,197,94,0.15)",
                    color: isNamed ? "#a855f7" : "#22c55e",
                  }}>
                  {isNamed ? "Nomeado" : "Posicional"}
                </span>
              </div>
              {variables.map((v, i) => (
                <div key={v} className="flex items-center gap-2">
                  <code className="text-[11px] font-mono shrink-0" style={{ color: "var(--text-2)", minWidth: "5.5rem" }}>
                    {`{{${v}}}`}
                  </code>
                  <input
                    required
                    value={examples[i] || ""}
                    onChange={(e) => {
                      const next = [...examples];
                      next[i] = e.target.value;
                      setExamples(next);
                    }}
                    placeholder={isNamed ? `Exemplo p/ ${v}` : `Exemplo p/ var ${v}`}
                    className="input-field flex-1 text-xs"
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>
              Footer (opcional, max 60 chars)
            </label>
            <input value={footerText}
              maxLength={60}
              onChange={(e) => setFooterText(e.target.value)}
              placeholder="Uniq Chat • Atendimento 24/7"
              className="input-field w-full" />
          </div>

          {/* Preview tipo WhatsApp */}
          {bodyText && (
            <div className="rounded-lg p-3" style={{ background: "#0b1f0e" }}>
              <p className="text-[10px] uppercase mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>
                Preview
              </p>
              <div className="rounded-lg p-3 max-w-[280px]" style={{ background: "#1f2c34", color: "#e9edef" }}>
                <p className="text-sm whitespace-pre-wrap">
                  {bodyText.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_, n) => {
                    const i = variables.indexOf(n);
                    return examples[i] || `[${n}]`;
                  })}
                </p>
                {footerText && (
                  <p className="text-[11px] mt-1.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                    {footerText}
                  </p>
                )}
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="text-xs px-3 py-2 rounded-lg"
              style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
              Cancelar
            </button>
            <button type="submit" disabled={create.isPending || isMixed}
              className="text-xs font-medium px-3 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: "var(--green)", color: "var(--green-fg)" }}>
              {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              {isMixed ? "Conserte as variáveis" : "Enviar pra aprovação"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TestSendSection({ instanceId, templates = [] }: {
  instanceId: string;
  wabaStatus?: string;
  templates?: Template[];
}) {
  const approved = templates.filter((t) => t.status === "APPROVED");
  const [to, setTo] = useState("");
  const [text, setText] = useState("Olá! Mensagem de teste enviada via Uniq Chat.");
  const [sentId, setSentId] = useState("");
  const [mode, setMode] = useState<"text" | "template">("template");
  // selecionado como "name|language" pra cobrir templates do mesmo nome em idiomas diferentes
  const [templateKey, setTemplateKey] = useState<string>(
    approved[0] ? `${approved[0].name}|${approved[0].language}` : "",
  );
  const [templateName, templateLang] = templateKey.split("|");

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
      } else if (raw.includes("131058") || raw.includes("Hello World templates can only")) {
        toast.error(
          "hello_world só funciona em número de teste da Meta. Pro seu número, crie um template próprio (botão 'Criar template' acima) e aguarde aprovação.",
          { duration: 10000 },
        );
      } else if (raw.includes("132001") || raw.includes("Template name does not exist")) {
        toast.error("Template não existe nessa WABA ou está com nome/idioma errado.", { duration: 8000 });
      } else if (raw.includes("132000") || raw.includes("template")) {
        toast.error("Template inválido ou não aprovado pela Meta. Verifique nome/idioma exato.", { duration: 6000 });
      } else if (raw.includes("131026") || raw.includes("Message undeliverable")) {
        toast.error("Mensagem não entregue. Verifique se o destinatário tem WhatsApp ativo.", { duration: 6000 });
      } else if (raw.includes("131051")) {
        toast.error("Tipo de mensagem não suportado.", { duration: 6000 });
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
        ) : approved.length === 0 ? (
          <div className="sm:col-span-2 input-field flex items-center text-xs" style={{ color: "var(--text-3)" }}>
            Nenhum template APPROVED ainda — crie um na seção Templates acima.
          </div>
        ) : (
          <select
            value={templateKey}
            onChange={(e) => setTemplateKey(e.target.value)}
            className="input-field sm:col-span-2"
          >
            <option value="">— Selecione um template —</option>
            {approved.map((t) => (
              <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                {t.name} ({t.language}) · {t.category}
              </option>
            ))}
          </select>
        )}
      </div>
      {mode === "template" && approved.length > 0 && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
          Apenas templates com status <span style={{ color: "var(--green)" }}>APPROVED</span> aparecem.
          Os <span style={{ color: "#fbbf24" }}>PENDING</span> não podem ser enviados ainda.
        </p>
      )}
      <button
        onClick={() => send.mutate()}
        disabled={!to || (mode === "text" && !text) || (mode === "template" && (!templateName || !templateLang)) || send.isPending}
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

// Edição inline do nome da instância. Click no Pencil → input + Check/X.
function EditableInstanceName({ instanceId }: { instanceId: string }) {
  const qc = useQueryClient();
  const { data: inst } = useQuery<{ id: string; name: string }>({
    queryKey: ["instance", instanceId],
    queryFn: () => instancesApi.get(instanceId).then((r) => r.data),
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const save = useMutation({
    mutationFn: () => instancesApi.update(instanceId, { name: draft.trim() }),
    onSuccess: () => {
      toast.success("Nome atualizado");
      qc.invalidateQueries({ queryKey: ["instance", instanceId] });
      qc.invalidateQueries({ queryKey: ["instances"] });
      setEditing(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao renomear"),
  });

  if (!inst) {
    return <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>WhatsApp API</h1>;
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save.mutate();
            if (e.key === "Escape") setEditing(false);
          }}
          maxLength={80}
          className="text-xl font-medium bg-transparent border-b outline-none px-1"
          style={{ color: "var(--text-1)", borderColor: "var(--green)" }}
        />
        <button onClick={() => save.mutate()} disabled={save.isPending || !draft.trim()}
          className="rounded p-1 disabled:opacity-50" style={{ color: "var(--green)" }}>
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        </button>
        <button onClick={() => setEditing(false)}
          className="rounded p-1" style={{ color: "var(--text-3)" }}>
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group">
      <h1 className="text-xl font-medium truncate" style={{ color: "var(--text-1)" }}>
        {inst.name}
      </h1>
      <button
        onClick={() => { setDraft(inst.name); setEditing(true); }}
        className="opacity-0 group-hover:opacity-100 rounded p-1 transition-opacity"
        title="Editar nome"
        style={{ color: "var(--text-3)" }}>
        <Pencil className="w-3.5 h-3.5" />
      </button>
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
