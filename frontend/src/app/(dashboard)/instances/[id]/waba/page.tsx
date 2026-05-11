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

import { use, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CheckCircle2, Loader2, Phone, Plus, Send, Trash2, Webhook, Sparkles, AlertCircle, Copy, Pencil, Check, X,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { wabaApi, instancesApi, mediaUploadApi } from "@/lib/api";
import { TemplateMediaUpload } from "@/components/waba/TemplateMediaUpload";
import { WABAConnectButton } from "@/components/instances/WABAConnectButton";
import { showConfirm } from "@/lib/confirm";

interface WABAData {
  id: string;
  instance_id: string;
  waba_business_id: string;
  phone_number_id: string;
  phone_number: string;
  verified_name: string;
  status: string;
  code_verification: string;
  /** PIN do 2FA salvo após /register — exibido como chip no header pra
   *  o user lembrar ao reconectar/reativar o número. */
  pin?: string;
}

interface TemplateComponent {
  type: string;        // HEADER | BODY | FOOTER | BUTTONS
  format?: string;     // TEXT | IMAGE | VIDEO | DOCUMENT (for HEADER)
  text?: string;
  buttons?: Array<{ type: string; text: string; url?: string; phone_number?: string }>;
  example?: Record<string, unknown>;
}

interface Template {
  id?: string;         // Meta template ID (needed for edit)
  name: string;
  language: string;
  status: string;
  category: string;
  components: TemplateComponent[];
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

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {/* Lembrete do PIN 2FA ao lado do header — copy-to-clipboard
              fácil. Quando vazio mostra hint "registre 2FA" pra o user
              entender que precisa rodar o passo 2 abaixo. */}
          {waba.pin ? (
            <PinChip pin={waba.pin} />
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(245,158,11,0.10)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.25)" }}>
              PIN não registrado
            </span>
          )}
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
            Escolha um PIN de 6 dígitos. Ele é registrado na Meta como 2FA do
            número e ativa o envio na Cloud API. Anote — vai precisar se for
            reconectar o número no futuro.
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

      {/* Logs de envio — painel com status de cada mensagem outbound. */}
      <MessagesLogSection instanceId={id} />

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

function TemplateCard({ t, instanceId, qc }: { t: Template; instanceId: string; qc: ReturnType<typeof useQueryClient> }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);

  const body = t.components.find((c) => c.type === "BODY" || c.type === "body");
  const header = t.components.find((c) => c.type === "HEADER" || c.type === "header");
  const footer = t.components.find((c) => c.type === "FOOTER" || c.type === "footer");
  const buttonsComp = t.components.find((c) => c.type === "BUTTONS" || c.type === "buttons");
  const bodyText = body?.text || "";
  const preview = bodyText.length > 90 ? bodyText.slice(0, 90) + "…" : bodyText;

  const deleteMut = useMutation({
    mutationFn: () => wabaApi.deleteTemplate(instanceId, t.name),
    onSuccess: () => {
      toast.success("Template removido");
      qc.invalidateQueries({ queryKey: ["waba-templates", instanceId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao remover"),
  });

  return (
    <>
      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <button className="min-w-0 text-left flex-1" onClick={() => setExpanded((v) => !v)}>
            <p className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{t.name}</p>
            <p className="text-[11px] mb-1" style={{ color: "var(--text-3)" }}>
              {t.language} · {t.category} ·{" "}
              <span style={{ color: t.status === "APPROVED" ? "var(--green)" : "#fbbf24" }}>
                {t.status}
              </span>
            </p>
            {!expanded && bodyText && (
              <p className="text-xs" style={{ color: "var(--text-2)" }}>{preview}</p>
            )}
          </button>
          <div className="flex items-center gap-1 shrink-0">
            {t.id && (
              <button onClick={() => setEditing(true)}
                className="p-1.5 rounded-md hover:opacity-80" style={{ color: "var(--text-3)" }}
                title="Editar template">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={async () => { if (await showConfirm(`Remover template ${t.name}?`, { title: "Remover template", confirmLabel: "Remover" })) deleteMut.mutate(); }}
              className="p-1.5 rounded-md hover:opacity-80" style={{ color: "#f87171" }}>
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-3 rounded-xl overflow-hidden"
            style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
            {header?.text && (
              <div className="px-3 py-2 border-b" style={{ borderColor: "var(--surface-border)" }}>
                <p className="text-[10px] uppercase tracking-wider font-medium mb-0.5" style={{ color: "var(--text-3)" }}>Header</p>
                <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>{header.text}</p>
              </div>
            )}
            {header?.format && header.format !== "TEXT" && !header.text && (
              <div className="px-3 py-2 border-b" style={{ borderColor: "var(--surface-border)" }}>
                <p className="text-[10px] uppercase tracking-wider font-medium mb-0.5" style={{ color: "var(--text-3)" }}>Header</p>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>[{header.format}]</p>
              </div>
            )}
            {bodyText && (
              <div className="px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider font-medium mb-0.5" style={{ color: "var(--text-3)" }}>Body</p>
                <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--text-1)" }}>{bodyText}</p>
              </div>
            )}
            {footer?.text && (
              <div className="px-3 py-2 border-t" style={{ borderColor: "var(--surface-border)" }}>
                <p className="text-[10px] uppercase tracking-wider font-medium mb-0.5" style={{ color: "var(--text-3)" }}>Footer</p>
                <p className="text-xs" style={{ color: "var(--text-3)" }}>{footer.text}</p>
              </div>
            )}
            {buttonsComp?.buttons && buttonsComp.buttons.length > 0 && (
              <div className="px-3 py-2 border-t flex flex-wrap gap-1.5" style={{ borderColor: "var(--surface-border)" }}>
                {buttonsComp.buttons.map((b, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-full border"
                    style={{ borderColor: "var(--surface-border)", color: "var(--text-2)" }}>
                    {b.text}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {editing && t.id && (
        <EditTemplateModal
          instanceId={instanceId}
          template={t}
          onClose={() => setEditing(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["waba-templates", instanceId] });
            setEditing(false);
          }}
        />
      )}
    </>
  );
}

function EditTemplateModal({ instanceId, template, onClose, onSaved }: {
  instanceId: string;
  template: Template;
  onClose: () => void;
  onSaved: () => void;
}) {
  const bodyComp = template.components.find((c) => c.type === "BODY" || c.type === "body");
  const footerComp = template.components.find((c) => c.type === "FOOTER" || c.type === "footer");
  const buttonsComp = template.components.find((c) => c.type === "BUTTONS" || c.type === "buttons");

  const [bodyText, setBodyText] = useState(bodyComp?.text || "");
  const [footerText, setFooterText] = useState(footerComp?.text || "");

  const editMut = useMutation({
    mutationFn: () => {
      const components: Record<string, unknown>[] = [];
      const headerComp = template.components.find((c) => c.type === "HEADER" || c.type === "header");
      if (headerComp) components.push({ ...headerComp });
      components.push({ type: "BODY", text: bodyText });
      if (footerText.trim()) components.push({ type: "FOOTER", text: footerText.trim() });
      if (buttonsComp) components.push({ ...buttonsComp });
      return wabaApi.editTemplate(instanceId, template.id!, { components });
    },
    onSuccess: () => {
      toast.success("Template atualizado — voltará para PENDING enquanto a Meta revisa");
      onSaved();
    },
    onError: (e: any) => toast.error(e?.response?.data?.error || "Falha ao editar template"),
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl w-full max-w-lg flex flex-col"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)", maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: "var(--surface-border)" }}>
          <div>
            <h3 className="text-base font-medium" style={{ color: "var(--text-1)" }}>Editar template</h3>
            <p className="text-[11px] mt-0.5" style={{ color: "#fbbf24" }}>
              ⚠ Templates APPROVED voltarão para PENDING após edição
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4 overflow-y-auto">
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Body</label>
            <textarea
              rows={6}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="input-field w-full resize-none font-mono text-sm"
              placeholder="Texto do body. Use {{1}}, {{2}} para variáveis."
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-2)" }}>Footer (opcional)</label>
            <input
              value={footerText}
              onChange={(e) => setFooterText(e.target.value)}
              className="input-field w-full"
              placeholder="Texto do rodapé"
            />
          </div>
          <p className="text-[11px] rounded-lg px-3 py-2" style={{ background: "var(--surface-2)", color: "var(--text-3)" }}>
            Header e botões são preservados. Apenas body e footer podem ser editados aqui.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t shrink-0" style={{ borderColor: "var(--surface-border)" }}>
          <button type="button" onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg" style={{ color: "var(--text-2)" }}>
            Cancelar
          </button>
          <button
            onClick={() => editMut.mutate()}
            disabled={editMut.isPending || !bodyText.trim()}
            className="text-sm font-medium px-4 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}>
            {editMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplatesSection({ instanceId, templates, qc }: {
  instanceId: string;
  templates: Template[];
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [creating, setCreating] = useState(false);

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
            <TemplateCard key={`${t.name}-${t.language}`} t={t} instanceId={instanceId} qc={qc} />
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

function HeaderMediaUploader({
  instanceId, headerType, value, onChange,
}: {
  instanceId: string;
  headerType: "IMAGE" | "VIDEO" | "DOCUMENT";
  value: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [filename, setFilename] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = {
    IMAGE: "image/jpeg,image/png",
    VIDEO: "video/mp4,video/3gpp",
    DOCUMENT: "application/pdf",
  }[headerType];

  const limitMB = { IMAGE: 5, VIDEO: 16, DOCUMENT: 100 }[headerType];

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > limitMB * 1024 * 1024) {
      toast.error(`Arquivo maior que ${limitMB}MB — limite Meta para ${headerType.toLowerCase()}`);
      return;
    }
    setUploading(true);
    try {
      const r = await mediaUploadApi.upload(instanceId, file);
      const url = (r.data as { url?: string })?.url;
      if (!url) throw new Error("upload sem url");
      onChange(url);
      setFilename(file.name);
      toast.success("Mídia enviada");
    } catch (err) {
      const e = err as { message?: string };
      toast.error(e.message || "Falha no upload");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <input ref={inputRef} type="file" hidden accept={accept} onChange={onFile} />
      {value ? (
        <div className="flex items-center gap-2 rounded-md p-2"
          style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
          {headerType === "IMAGE" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="preview" className="w-12 h-12 rounded object-cover" />
          ) : (
            <div className="w-12 h-12 rounded flex items-center justify-center text-[10px] uppercase"
              style={{ background: "var(--surface-3)", color: "var(--text-3)" }}>
              {headerType === "VIDEO" ? "VID" : "DOC"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs truncate" style={{ color: "var(--text-2)" }}>
              {filename || "Mídia carregada"}
            </p>
            <p className="text-[10px] truncate font-mono" style={{ color: "var(--text-3)" }}>
              {value}
            </p>
          </div>
          <button type="button" onClick={() => { onChange(""); setFilename(""); }}
            className="rounded p-1 shrink-0" style={{ color: "#f87171" }}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-full rounded-md py-3 text-xs font-medium border-2 border-dashed disabled:opacity-50"
          style={{ borderColor: "var(--surface-border)", color: "var(--text-3)", background: "var(--surface-1)" }}>
          {uploading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Enviando...
            </span>
          ) : (
            <>📎 Selecionar {headerType === "IMAGE" ? "imagem (JPG/PNG)" : headerType === "VIDEO" ? "vídeo (MP4)" : "documento (PDF)"} · max {limitMB}MB</>
          )}
        </button>
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

  // Header: tipo + conteúdo (texto OU exemplo de mídia via URL)
  const [headerType, setHeaderType] = useState<"NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT" | "LOCATION">("NONE");
  const [headerText, setHeaderText] = useState("");
  const [headerExampleURL, setHeaderExampleURL] = useState("");

  // Buttons: array com até 10 items. Tipos suportados pela Meta:
  //   QUICK_REPLY (resposta rápida) — só texto, max 25 chars
  //   URL (acessar site) — texto + url (pode ter {{1}} dinâmico)
  //   PHONE_NUMBER (ligar) — texto + phone_number
  //   COPY_CODE (copiar código) — só example com o código pré-aprovado
  type ButtonType = "QUICK_REPLY" | "URL" | "PHONE_NUMBER" | "COPY_CODE";
  interface TemplateButton {
    id: string;
    type: ButtonType;
    text: string;
    url?: string;
    phone_number?: string;
    example?: string;
  }
  const [buttons, setButtons] = useState<TemplateButton[]>([]);

  const addButton = (type: ButtonType) => {
    if (buttons.length >= 10) {
      toast.error("Máximo 10 botões");
      return;
    }
    setButtons((prev) => [
      ...prev,
      { id: Math.random().toString(36).slice(2, 8), type, text: "", url: "", phone_number: "", example: "" },
    ]);
  };
  const updateButton = (id: string, patch: Partial<TemplateButton>) => {
    setButtons((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };
  const removeButton = (id: string) => setButtons((prev) => prev.filter((b) => b.id !== id));

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

      // HEADER (opcional)
      if (headerType !== "NONE") {
        const headerComp: Record<string, unknown> = { type: "HEADER", format: headerType };
        if (headerType === "TEXT") {
          headerComp.text = headerText;
          // Header text pode ter UMA variável {{1}}
          const headerVars = Array.from(headerText.matchAll(/\{\{(\d+)\}\}/g)).map((m) => m[1]);
          if (headerVars.length > 0) {
            headerComp.example = { header_text: [headerExampleURL || "exemplo"] };
          }
        } else if (headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") {
          // Pra mídia, Meta exige um example com URL pública (handle ou link).
          if (headerExampleURL) {
            headerComp.example = { header_handle: [headerExampleURL] };
          }
        }
        components.push(headerComp);
      }

      // BODY (sempre)
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

      // FOOTER (opcional)
      if (footerText.trim()) {
        components.push({ type: "FOOTER", text: footerText.trim() });
      }

      // BUTTONS (opcional, até 10)
      if (buttons.length > 0) {
        components.push({
          type: "BUTTONS",
          buttons: buttons.map((b) => {
            const out: Record<string, unknown> = { type: b.type };
            if (b.type === "QUICK_REPLY") {
              out.text = b.text;
            } else if (b.type === "URL") {
              out.text = b.text;
              out.url = b.url || "";
              if (b.url && b.url.includes("{{1}}")) {
                out.example = [b.example || ""];
              }
            } else if (b.type === "PHONE_NUMBER") {
              out.text = b.text;
              out.phone_number = b.phone_number || "";
            } else if (b.type === "COPY_CODE") {
              out.example = b.example || "";
            }
            return out;
          }),
        });
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
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="rounded-2xl w-full max-w-2xl flex flex-col"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)", maxHeight: "92vh" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: "var(--surface-border)" }}>
          <div>
            <h3 className="text-base font-medium" style={{ color: "var(--text-1)" }}>Criar template HSM</h3>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--text-3)" }}>
              Será enviado pra revisão da Meta após criar
            </p>
          </div>
          <button type="button" onClick={onClose}
            className="rounded-md p-1" style={{ color: "var(--text-3)" }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4 px-5 py-4 overflow-y-auto">
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
                <option value="UTILITY">UTILITY — confirmações, alertas, atualizações</option>
                <option value="MARKETING">MARKETING — promoções, novidades, ofertas</option>
                <option value="AUTHENTICATION">AUTHENTICATION — códigos OTP, 2FA</option>
              </select>
            </div>
          </div>

          {/* HEADER opcional */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                Cabeçalho (opcional)
              </label>
              <select value={headerType} onChange={(e) => setHeaderType(e.target.value as any)}
                className="input-field text-xs" style={{ width: "auto" }}>
                <option value="NONE">— Sem cabeçalho —</option>
                <option value="TEXT">Texto</option>
                <option value="IMAGE">Imagem</option>
                <option value="VIDEO">Vídeo</option>
                <option value="DOCUMENT">Documento</option>
                <option value="LOCATION">Localização</option>
              </select>
            </div>
            {headerType === "TEXT" && (
              <input value={headerText} onChange={(e) => setHeaderText(e.target.value)}
                placeholder="Ex: Olá {{1}} ou texto fixo (max 60 chars)"
                maxLength={60}
                className="input-field w-full text-sm" />
            )}
            {(headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") && (
              <HeaderMediaUploader
                instanceId={instanceId}
                headerType={headerType}
                value={headerExampleURL}
                onChange={setHeaderExampleURL}
              />
            )}
            {headerType === "LOCATION" && (
              <p className="text-[11px]" style={{ color: "var(--text-3)" }}>
                Localização não tem conteúdo aqui — você passa lat/long no envio.
              </p>
            )}
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

          {/* BOTÕES (até 10) */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium" style={{ color: "var(--text-2)" }}>
                Botões (opcional, até 10)
              </label>
              <span className="text-[10px]" style={{ color: "var(--text-3)" }}>{buttons.length}/10</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <button type="button" onClick={() => addButton("QUICK_REPLY")} disabled={buttons.length >= 10}
                className="text-[10px] px-2 py-1 rounded-md disabled:opacity-40"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                + Resposta rápida
              </button>
              <button type="button" onClick={() => addButton("URL")} disabled={buttons.length >= 10}
                className="text-[10px] px-2 py-1 rounded-md disabled:opacity-40"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                + Acessar site
              </button>
              <button type="button" onClick={() => addButton("PHONE_NUMBER")} disabled={buttons.length >= 10}
                className="text-[10px] px-2 py-1 rounded-md disabled:opacity-40"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                + Ligar
              </button>
              <button type="button" onClick={() => addButton("COPY_CODE")} disabled={buttons.length >= 10}
                className="text-[10px] px-2 py-1 rounded-md disabled:opacity-40"
                style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
                + Copiar código
              </button>
            </div>
            {buttons.map((b, idx) => (
              <div key={b.id} className="rounded-md p-2 space-y-1.5"
                style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
                <div className="flex items-center justify-between text-[10px]" style={{ color: "var(--text-3)" }}>
                  <span className="font-medium">
                    #{idx + 1} ·{" "}
                    {b.type === "QUICK_REPLY" ? "Resposta rápida"
                      : b.type === "URL" ? "Acessar site"
                      : b.type === "PHONE_NUMBER" ? "Ligar"
                      : "Copiar código"}
                  </span>
                  <button type="button" onClick={() => removeButton(b.id)}
                    className="rounded p-0.5" style={{ color: "#f87171" }}>
                    <X className="w-3 h-3" />
                  </button>
                </div>
                {(b.type === "QUICK_REPLY" || b.type === "URL" || b.type === "PHONE_NUMBER") && (
                  <input value={b.text} onChange={(e) => updateButton(b.id, { text: e.target.value })}
                    placeholder="Texto do botão (max 25 chars)" maxLength={25}
                    className="input-field w-full text-xs" />
                )}
                {b.type === "URL" && (
                  <input value={b.url || ""} onChange={(e) => updateButton(b.id, { url: e.target.value })}
                    placeholder="https://exemplo.com/oferta ou https://site.com/{{1}}"
                    className="input-field w-full text-xs font-mono" />
                )}
                {b.type === "URL" && b.url?.includes("{{1}}") && (
                  <input value={b.example || ""} onChange={(e) => updateButton(b.id, { example: e.target.value })}
                    placeholder="Exemplo de valor pra {{1}} (ex: produto-123)"
                    className="input-field w-full text-xs" />
                )}
                {b.type === "PHONE_NUMBER" && (
                  <input value={b.phone_number || ""} onChange={(e) => updateButton(b.id, { phone_number: e.target.value })}
                    placeholder="+5511999999999 (E.164)"
                    className="input-field w-full text-xs font-mono" />
                )}
                {b.type === "COPY_CODE" && (
                  <input value={b.example || ""} onChange={(e) => updateButton(b.id, { example: e.target.value })}
                    placeholder="Código de exemplo (ex: PROMO20)"
                    className="input-field w-full text-xs font-mono" />
                )}
              </div>
            ))}
          </div>

          {/* Preview tipo WhatsApp */}
          {bodyText && (
            <div className="rounded-lg p-3" style={{ background: "#0b1f0e" }}>
              <p className="text-[10px] uppercase mb-1" style={{ color: "rgba(255,255,255,0.5)" }}>
                Preview
              </p>
              <div className="rounded-lg p-3 max-w-[280px]" style={{ background: "#1f2c34", color: "#e9edef" }}>
                {headerType === "TEXT" && headerText && (
                  <p className="text-sm font-bold mb-1.5">{headerText.replace(/\{\{1\}\}/g, headerExampleURL || "[var]")}</p>
                )}
                {(headerType === "IMAGE" || headerType === "VIDEO" || headerType === "DOCUMENT") && (
                  <div className="mb-1.5 rounded h-20 flex items-center justify-center text-[10px] uppercase tracking-wider"
                    style={{ background: "var(--border-subtle)", color: "rgba(255,255,255,0.4)" }}>
                    [{headerType.toLowerCase()}]
                  </div>
                )}
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
                {buttons.length > 0 && (
                  <div className="mt-2 -mx-3 -mb-3 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                    {buttons.map((b) => (
                      <div key={b.id} className="px-3 py-2 text-center text-[13px] font-medium border-b last:border-b-0"
                        style={{ color: "#53bdeb", borderColor: "var(--border-subtle)" }}>
                        {b.type === "PHONE_NUMBER" && "📞 "}
                        {b.type === "URL" && "🔗 "}
                        {b.type === "COPY_CODE" && "📋 "}
                        {b.text || (b.type === "COPY_CODE" ? `Copiar ${b.example || "código"}` : "(sem texto)")}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </form>
        <div className="flex justify-end gap-2 px-5 py-3 border-t shrink-0"
          style={{ borderColor: "var(--surface-border)", background: "var(--surface-1)" }}>
          <button type="button" onClick={onClose}
            className="text-xs px-3 py-2 rounded-lg"
            style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending || isMixed || !name.trim() || !bodyText.trim()}
            className="text-xs font-medium px-4 py-2 rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}>
            {create.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            {isMixed ? "Conserte as variáveis" : "Enviar pra aprovação"}
          </button>
        </div>
      </div>
    </div>
  );
}

function extractTemplateVars(tpl: Template | undefined): string[] {
  if (!tpl?.components) return [];
  const rx = /\{\{\s*(\d+)\s*\}\}/g;
  const set = new Set<string>();
  for (const comp of tpl.components) {
    if (!comp.text) continue;
    // Header de mídia (IMAGE/VIDEO/DOC) tem `text` vazio, mas se vier
    // populado por engano não devemos tratar como variável textual.
    if (comp.type === "HEADER" && comp.format && comp.format.toUpperCase() !== "TEXT") continue;
    let m;
    while ((m = rx.exec(comp.text)) !== null) set.add(m[1]);
  }
  return Array.from(set).sort((a, b) => Number(a) - Number(b));
}

type TemplateMedia = {
  url: string;
  filename: string;
  latitude: string;
  longitude: string;
  name: string;
  address: string;
};

const emptyTemplateMedia: TemplateMedia = {
  url: "",
  filename: "",
  latitude: "",
  longitude: "",
  name: "",
  address: "",
};

function getHeaderFormat(tpl: Template | undefined): string {
  const h = tpl?.components?.find((c) => c.type === "HEADER");
  return (h?.format || "TEXT").toUpperCase();
}

// buildTemplateComponents — gera o payload do "components" no formato
// que a Meta espera. Suporta TODOS os formatos de header (TEXT, IMAGE,
// VIDEO, DOCUMENT, LOCATION) + body com variáveis. Sem isso, templates
// com header de mídia voltavam erro 132012 ("expected IMAGE, received
// UNKNOWN").
function buildTemplateComponents(
  tpl: Template | undefined,
  vars: Record<string, string>,
  media: TemplateMedia,
): Array<Record<string, unknown>> {
  if (!tpl?.components) return [];
  const out: Array<Record<string, unknown>> = [];

  const headerComp = tpl.components.find((c) => c.type === "HEADER");
  if (headerComp) {
    const fmt = (headerComp.format || "TEXT").toUpperCase();
    if (fmt === "TEXT" && headerComp.text) {
      const headerVars = (headerComp.text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) =>
        m.replace(/[{}\s]/g, ""),
      );
      if (headerVars.length > 0) {
        out.push({
          type: "header",
          parameters: headerVars.map((k) => ({ type: "text", text: vars[k] ?? "" })),
        });
      }
    } else if (fmt === "IMAGE" && media.url.trim()) {
      out.push({ type: "header", parameters: [{ type: "image", image: { link: media.url.trim() } }] });
    } else if (fmt === "VIDEO" && media.url.trim()) {
      out.push({ type: "header", parameters: [{ type: "video", video: { link: media.url.trim() } }] });
    } else if (fmt === "DOCUMENT" && media.url.trim()) {
      const doc: Record<string, string> = { link: media.url.trim() };
      if (media.filename.trim()) doc.filename = media.filename.trim();
      out.push({ type: "header", parameters: [{ type: "document", document: doc }] });
    } else if (fmt === "LOCATION" && media.latitude.trim() && media.longitude.trim()) {
      const loc: Record<string, unknown> = {
        latitude: parseFloat(media.latitude),
        longitude: parseFloat(media.longitude),
      };
      if (media.name.trim()) loc.name = media.name.trim();
      if (media.address.trim()) loc.address = media.address.trim();
      out.push({ type: "header", parameters: [{ type: "location", location: loc }] });
    }
  }

  const bodyComp = tpl.components.find((c) => c.type === "BODY");
  if (bodyComp?.text) {
    const bodyVars = (bodyComp.text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) =>
      m.replace(/[{}\s]/g, ""),
    );
    if (bodyVars.length > 0) {
      out.push({
        type: "body",
        parameters: bodyVars.map((k) => ({ type: "text", text: vars[k] ?? "" })),
      });
    }
  }
  return out;
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
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});
  const [templateMedia, setTemplateMedia] = useState<TemplateMedia>(emptyTemplateMedia);
  const [templateName, templateLang] = templateKey.split("|");

  const selectedTpl = approved.find((t) => t.name === templateName && t.language === templateLang);
  const tplVarKeys = extractTemplateVars(selectedTpl);
  const headerFormat = getHeaderFormat(selectedTpl);
  const needsMedia = headerFormat === "IMAGE" || headerFormat === "VIDEO" || headerFormat === "DOCUMENT";
  const needsLocation = headerFormat === "LOCATION";

  // Reset variables when template changes
  const handleTemplateChange = (key: string) => {
    setTemplateKey(key);
    setTemplateVars({});
    setTemplateMedia(emptyTemplateMedia);
  };

  const canSend = mode === "text"
    ? !!to && !!text
    : !!to &&
      !!templateName &&
      !!templateLang &&
      tplVarKeys.every((k) => (templateVars[k] ?? "").trim().length > 0) &&
      (!needsMedia || templateMedia.url.trim().length > 0) &&
      (!needsLocation || (templateMedia.latitude.trim() !== "" && templateMedia.longitude.trim() !== ""));

  const send = useMutation({
    mutationFn: () => {
      if (mode === "text") {
        return wabaApi.sendMessage(instanceId, { to, type: "text", text: { body: text } });
      }
      const components = buildTemplateComponents(selectedTpl, templateVars, templateMedia);
      return wabaApi.sendMessage(instanceId, {
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang },
          ...(components.length > 0 ? { components } : {}),
        },
      });
    },
    onSuccess: (r: any) => {
      const d = r.data ?? {};
      setSentId(d.message_id || d.id || "");
      if (d.status === "failed") {
        toast.error(d.error || "Falha na entrega", { duration: 10000 });
      } else {
        toast.success("Mensagem enviada para a Meta — aguarde confirmação de entrega no WhatsApp do destinatário");
      }
    },
    onError: (e: any) => {
      const raw: string = e?.response?.data?.error || "";
      // Erros de entrega retornados após poll (422)
      if (e?.response?.status === 422) {
        toast.error(raw || "Falha na entrega — verifique a conta no Meta Business Manager", { duration: 10000 });
        return;
      }
      // Erros sincrônicos da Cloud API
      if (raw.includes("133010") || raw.includes("Account not registered")) {
        toast.error("Número não registrado. Use o card '2. Register phone' acima com seu PIN 2FA antes de enviar.", { duration: 8000 });
      } else if (raw.includes("131042") || raw.includes("eligibility payment")) {
        toast.error("Problema de pagamento na conta WhatsApp Business. Verifique o faturamento no Meta Business Manager.", { duration: 10000 });
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
        toast.error(raw || "Falha ao enviar", { duration: 8000 });
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
            onChange={(e) => handleTemplateChange(e.target.value)}
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
      {/* Inputs de header mídia (IMAGE/VIDEO/DOCUMENT) — sem isso a Meta
         devolve 132012 "expected IMAGE, received UNKNOWN" porque o
         template foi aprovado com mídia mas o request omite o param. */}
      {mode === "template" && needsMedia && (
        <div className="mt-2 rounded-lg p-3 space-y-2"
          style={{ background: "rgba(96,165,250,0.06)", border: "1px solid rgba(96,165,250,0.20)" }}>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: "#60a5fa" }}>
            Header · {headerFormat.toLowerCase()}
          </p>
          <div className="flex items-center gap-2">
            <input
              value={templateMedia.url}
              onChange={(e) => setTemplateMedia((p) => ({ ...p, url: e.target.value }))}
              placeholder={
                headerFormat === "IMAGE"
                  ? "https://exemplo.com/imagem.jpg"
                  : headerFormat === "VIDEO"
                  ? "https://exemplo.com/video.mp4"
                  : "https://exemplo.com/arquivo.pdf"
              }
              className="input-field flex-1"
            />
            <TemplateMediaUpload
              instanceId={instanceId}
              templateName={templateName}
              templateLanguage={templateLang}
              format={headerFormat as "IMAGE" | "VIDEO" | "DOCUMENT"}
              saveAsDefault
              onUploaded={(url) => setTemplateMedia((p) => ({ ...p, url }))}
            />
          </div>
          {headerFormat === "DOCUMENT" && (
            <input
              value={templateMedia.filename}
              onChange={(e) => setTemplateMedia((p) => ({ ...p, filename: e.target.value }))}
              placeholder="Nome do arquivo (opcional, ex: Contrato.pdf)"
              className="input-field w-full"
            />
          )}
        </div>
      )}
      {mode === "template" && needsLocation && (
        <div className="mt-2 rounded-lg p-3 space-y-2"
          style={{ background: "rgba(0,212,106,0.06)", border: "1px solid rgba(0,212,106,0.20)" }}>
          <p className="text-[10px] uppercase tracking-wider" style={{ color: "var(--green)" }}>
            Header · localização
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={templateMedia.latitude}
              onChange={(e) => setTemplateMedia((p) => ({ ...p, latitude: e.target.value }))}
              placeholder="Latitude"
              className="input-field w-full"
            />
            <input
              value={templateMedia.longitude}
              onChange={(e) => setTemplateMedia((p) => ({ ...p, longitude: e.target.value }))}
              placeholder="Longitude"
              className="input-field w-full"
            />
          </div>
          <input
            value={templateMedia.name}
            onChange={(e) => setTemplateMedia((p) => ({ ...p, name: e.target.value }))}
            placeholder="Nome do local (opcional)"
            className="input-field w-full"
          />
          <input
            value={templateMedia.address}
            onChange={(e) => setTemplateMedia((p) => ({ ...p, address: e.target.value }))}
            placeholder="Endereço (opcional)"
            className="input-field w-full"
          />
        </div>
      )}
      {/* Variable inputs for templates with {{N}} params */}
      {mode === "template" && tplVarKeys.length > 0 && (
        <div className="mt-2 grid sm:grid-cols-2 gap-2">
          {tplVarKeys.map((k) => (
            <div key={k}>
              <label className="block text-[10px] mb-1" style={{ color: "var(--text-3)" }}>
                {`{{${k}}}`}
              </label>
              <input
                value={templateVars[k] ?? ""}
                onChange={(e) => setTemplateVars((prev) => ({ ...prev, [k]: e.target.value }))}
                placeholder={`Valor para {{${k}}}`}
                className="input-field w-full"
              />
            </div>
          ))}
        </div>
      )}
      {mode === "template" && approved.length > 0 && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-3)" }}>
          Apenas templates com status <span style={{ color: "var(--green)" }}>APPROVED</span> aparecem.
          Os <span style={{ color: "#fbbf24" }}>PENDING</span> não podem ser enviados ainda.
        </p>
      )}
      <button
        onClick={() => send.mutate()}
        disabled={!canSend || send.isPending}
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

// PinChip — chip clicável no header da WABA mostrando o PIN 2FA salvo.
// Click copia pra clipboard com feedback visual (Check verde por 1.5s).
// Mascara o PIN por padrão (••••••) — clica no olho pra revelar antes de
// copiar, evita expor em screenshot acidental sem comprometer praticidade.
function PinChip({ pin }: { pin: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pin);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("PIN copiado");
    } catch {
      toast.error("Não consegui copiar");
    }
  };
  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full pl-2.5 pr-1 py-1"
      style={{
        background: "rgba(0,212,106,0.10)",
        border: "1px solid rgba(0,212,106,0.30)",
        color: "var(--green)",
      }}
      title="PIN 2FA do registro WABA — necessário pra reconectar este número no futuro"
    >
      <span className="text-[10px] font-medium uppercase tracking-wider">PIN</span>
      <span className="text-xs font-mono tabular-nums" style={{ color: "var(--text-1)" }}>
        {revealed ? pin : "••••••"}
      </span>
      <button
        type="button"
        onClick={() => setRevealed((v) => !v)}
        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/5"
        title={revealed ? "Ocultar" : "Mostrar"}
      >
        {revealed ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
      </button>
      <button
        type="button"
        onClick={copy}
        className="w-6 h-6 rounded-full flex items-center justify-center hover:bg-white/5"
        title="Copiar PIN"
      >
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      </button>
    </div>
  );
}

// MessagesLogSection — painel de logs de envio. Mostra cada mensagem
// outbound desta instância WABA com status (sent/delivered/read/failed),
// destinatário, timestamp e erro quando aplicável. Filtro por status,
// busca por número/nome, paginação. Stats no header pra ver de relance
// taxa de entrega das últimas 24h.
type LogItem = {
  id: string;
  conversation_id?: string;
  type: string;
  to_jid: string;
  contact_name: string;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  external_message_id?: string;
  delivery_error?: string;
  content?: string;
  delivered_at?: string;
  read_at?: string;
  created_at: string;
};
type LogStats = {
  pending: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  total_24h: number;
};

function MessagesLogSection({ instanceId }: { instanceId: string }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 25;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isLoading, refetch } = useQuery<{
    items: LogItem[];
    total: number;
    stats: LogStats;
  }>({
    queryKey: ["waba-messages-log", instanceId, statusFilter, debouncedQ, offset],
    queryFn: () => wabaApi.messagesLog(instanceId, {
      status: statusFilter,
      q: debouncedQ || undefined,
      limit,
      offset,
    }).then((r) => r.data),
    refetchInterval: 30_000, // poll leve a cada 30s pra status evoluir sozinho
  });

  const items = data?.items ?? [];
  const stats = data?.stats ?? { pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, total_24h: 0 };
  const total = data?.total ?? 0;

  const deliveryRate = stats.total_24h > 0
    ? Math.round(((stats.delivered + stats.read) / stats.total_24h) * 100)
    : 0;

  return (
    <div className="rounded-2xl p-4"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Send className="w-4 h-4" style={{ color: "var(--green)" }} />
          <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>
            Logs de envio
          </h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <StatChip label="Últ. 24h" value={String(stats.total_24h)} />
          <StatChip label="Entregues" value={`${stats.delivered + stats.read}`} color="var(--green)" />
          <StatChip label="Falhas" value={String(stats.failed)} color="#ef4444" />
          <StatChip label="Taxa" value={`${deliveryRate}%`} color={deliveryRate >= 90 ? "var(--green)" : deliveryRate >= 70 ? "#f59e0b" : "#ef4444"} />
          <button
            onClick={() => refetch()}
            className="text-[10px] px-2 py-1 rounded-md inline-flex items-center gap-1"
            style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
            title="Atualizar"
          >
            <Loader2 className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
            {isLoading ? "" : "Atualizar"}
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(["all", "sent", "delivered", "read", "failed", "pending"] as const).map((s) => {
          const count = s === "all" ? total : stats[s as keyof LogStats] ?? 0;
          return (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setOffset(0); }}
              className="text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors"
              style={statusFilter === s ? {
                background: "rgba(0,212,106,0.18)",
                color: "var(--green)",
                border: "1px solid rgba(0,212,106,0.35)",
              } : {
                background: "var(--surface-3)",
                color: "var(--text-2)",
                border: "1px solid var(--surface-border)",
              }}
            >
              {STATUS_LABELS[s]} {count > 0 && <span className="opacity-60">· {count}</span>}
            </button>
          );
        })}
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOffset(0); }}
          placeholder="Buscar telefone ou nome…"
          className="text-xs px-3 py-1.5 rounded-lg outline-none ml-auto"
          style={{
            background: "var(--surface-3)",
            border: "1px solid var(--surface-border)",
            color: "var(--text-1)",
            width: 200,
          }}
        />
      </div>

      {/* Lista */}
      {items.length === 0 ? (
        <div className="text-xs text-center py-8" style={{ color: "var(--text-3)" }}>
          {isLoading ? "Carregando…" : "Nenhum envio registrado neste filtro."}
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden"
          style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}>
          {items.map((it, i) => (
            <LogRow key={it.id} item={it} divider={i > 0} />
          ))}
        </div>
      )}

      {/* Paginação */}
      {total > limit && (
        <div className="flex items-center justify-between gap-2 mt-3 text-xs" style={{ color: "var(--text-3)" }}>
          <span>{offset + 1}–{Math.min(offset + limit, total)} de {total}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-2.5 py-1 rounded-md disabled:opacity-40"
              style={{ background: "var(--surface-3)" }}
            >Anterior</button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              className="px-2.5 py-1 rounded-md disabled:opacity-40"
              style={{ background: "var(--surface-3)" }}
            >Próxima</button>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  all: "Todos",
  pending: "Pendentes",
  sent: "Enviadas",
  delivered: "Entregues",
  read: "Lidas",
  failed: "Falhas",
};

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  pending:   { bg: "rgba(245,158,11,0.10)", color: "#f59e0b", label: "Pendente" },
  sent:      { bg: "rgba(96,165,250,0.10)", color: "#60a5fa", label: "Enviada" },
  delivered: { bg: "rgba(0,212,106,0.10)",  color: "var(--green)", label: "Entregue" },
  read:      { bg: "rgba(0,212,106,0.18)",  color: "var(--green)", label: "Lida" },
  failed:    { bg: "rgba(239,68,68,0.10)",  color: "#ef4444", label: "Falhou" },
};

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px]"
      style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span className="font-semibold tabular-nums" style={{ color: color || "var(--text-1)" }}>{value}</span>
    </span>
  );
}

function LogRow({ item, divider }: { item: LogItem; divider: boolean }) {
  const st = STATUS_STYLES[item.status] || STATUS_STYLES.sent;
  const phone = (item.to_jid || "").split("@")[0] || item.to_jid;
  const time = new Date(item.created_at);
  const timeStr = time.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const previewBody = previewFromContent(item.content);

  return (
    <div
      className="flex items-start gap-3 px-3 py-2.5"
      style={divider ? { borderTop: "1px solid var(--surface-border)" } : undefined}
    >
      <div className="flex-shrink-0">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
          style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}33` }}>
          {st.label}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="font-medium" style={{ color: "var(--text-1)" }}>
            {item.contact_name || phone}
          </span>
          {item.contact_name && (
            <span className="font-mono text-[11px]" style={{ color: "var(--text-3)" }}>{phone}</span>
          )}
          <span className="ml-auto text-[10px] tabular-nums" style={{ color: "var(--text-3)" }}>
            {timeStr}
          </span>
        </div>
        <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--text-3)" }}>
          <span className="uppercase tracking-wider mr-1.5">[{item.type}]</span>
          {previewBody}
        </div>
        {item.delivery_error && (
          <div className="text-[10px] mt-0.5 truncate" style={{ color: "#ef4444" }} title={item.delivery_error}>
            ⚠ {item.delivery_error}
          </div>
        )}
      </div>
    </div>
  );
}

// previewFromContent — extrai um preview legível do MessageLog.Content
// (que é um JSON string serializado). Pra texto retorna "body"; pra mídia
// retorna caption ou label do tipo. Falha graciosa se não for JSON.
function previewFromContent(content?: string): string {
  if (!content) return "—";
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === "string") return parsed.slice(0, 80);
    if (parsed?.body) return String(parsed.body).slice(0, 80);
    if (parsed?.text?.body) return String(parsed.text.body).slice(0, 80);
    if (parsed?.caption) return String(parsed.caption).slice(0, 80);
    if (parsed?.template_name) return `Template: ${parsed.template_name}`;
    return "—";
  } catch {
    return content.slice(0, 80);
  }
}
