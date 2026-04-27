"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { X, Search, Sparkles } from "lucide-react";
import { wabaApi, conversationsApi } from "@/lib/api";

// Meta message template model (simplified — o backend devolve o payload
// bruto da Graph API):
//   { name, language, category, components: [
//       { type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS",
//         text?: "olá {{1}}, seu pedido…", example?: {...}, buttons?: [...] }
//   ] }
//
// O componente extrai as {{N}} de BODY e HEADER(text) e gera campos de
// variáveis. Ao enviar, monta o `components` no formato que a Meta aceita:
//   [{ type: "body", parameters: [{type:"text", text:"<valor>"}, ...] }]
interface MetaTemplate {
  name: string;
  language: string;
  status: string;
  category?: string;
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    example?: Record<string, unknown>;
    buttons?: Array<{ type: string; text: string }>;
  }>;
}

export function TemplatePicker({
  wsId,
  conversationId,
  instanceId,
  onClose,
  onSent,
}: {
  wsId: string;
  conversationId: string;
  instanceId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<MetaTemplate | null>(null);
  const [variables, setVariables] = useState<Record<string, string>>({});

  const templatesQ = useQuery({
    queryKey: ["waba-templates", instanceId],
    queryFn: () =>
      wabaApi.templates(instanceId).then((r) => (r.data as { items: MetaTemplate[] }).items ?? []),
  });

  const send = useMutation({
    mutationFn: () => {
      if (!selected) throw new Error("no template");
      const components = buildMetaComponents(selected, variables);
      return conversationsApi.sendMessage(wsId, conversationId, {
        type: "template",
        template_name: selected.name,
        template_language: selected.language,
        template_components: components,
      });
    },
    onSuccess: () => {
      toast.success("Template enviado");
      onSent();
      onClose();
    },
    onError: () => toast.error("Falha ao enviar template"),
  });

  const templates = useMemo(() => {
    const raw = templatesQ.data ?? [];
    if (!q) return raw;
    const t = q.toLowerCase();
    return raw.filter(
      (tpl) =>
        tpl.name.toLowerCase().includes(t) ||
        (tpl.category ?? "").toLowerCase().includes(t) ||
        getBodyText(tpl).toLowerCase().includes(t),
    );
  }, [templatesQ.data, q]);

  const vars = useMemo(() => (selected ? extractVariables(selected) : []), [selected]);

  useEffect(() => {
    if (selected) setVariables({});
  }, [selected]);

  const canSend = selected && vars.every((v) => (variables[v] ?? "").trim().length > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 uniq-fade-in"
        style={{ background: "var(--surface-overlay)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />
      <div
        className="relative flex h-[640px] w-full max-w-3xl overflow-hidden rounded-2xl shadow-2xl uniq-scale-in"
        style={{
          background: "hsl(240 18% 6%)",
          border: "1px solid hsl(240 12% 14%)",
        }}
      >
        {/* List */}
        <aside
          className="flex w-80 flex-shrink-0 flex-col"
          style={{ borderRight: "1px solid hsl(240 12% 16%)" }}
        >
          <div
            className="flex items-center gap-2 px-4 py-3"
            style={{ borderBottom: "1px solid hsl(240 12% 16%)" }}
          >
            <Sparkles className="h-4 w-4" style={{ color: "#00d46a" }} />
            <h2 className="text-sm font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
              Templates aprovados
            </h2>
          </div>
          <div className="px-3 py-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5"
                style={{ color: "hsl(240 8% 38%)" }}
              />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar…"
                className="w-full rounded-md py-1.5 pl-8 pr-3 text-xs outline-none"
                style={{
                  background: "var(--surface-2)",
                  border: "1px solid hsl(240 12% 16%)",
                  color: "hsl(240 15% 90%)",
                }}
              />
            </div>
          </div>
          <ul className="flex-1 overflow-auto">
            {templatesQ.isLoading && (
              <li className="px-4 py-6 text-xs" style={{ color: "hsl(240 8% 48%)" }}>
                Carregando templates…
              </li>
            )}
            {templatesQ.isError && (
              <li className="px-4 py-6 text-xs" style={{ color: "#ef4444" }}>
                Falha ao buscar templates. Verifique se esta instância é WABA e
                se o business_id + access_token estão configurados.
              </li>
            )}
            {!templatesQ.isLoading && templates.length === 0 && (
              <li className="px-4 py-6 text-xs" style={{ color: "hsl(240 8% 48%)" }}>
                Nenhum template aprovado.
              </li>
            )}
            {templates.map((tpl) => {
              const active = selected?.name === tpl.name && selected.language === tpl.language;
              return (
                <li key={`${tpl.name}-${tpl.language}`}>
                  <button
                    onClick={() => setSelected(tpl)}
                    className="block w-full px-4 py-3 text-left hover:bg-white/5"
                    style={{
                      background: active ? "rgba(0,212,106,0.06)" : "transparent",
                      borderLeft: active ? "2px solid #00d46a" : "2px solid transparent",
                    }}
                  >
                    <div
                      className="flex items-center gap-1.5 text-xs font-medium"
                      style={{ color: active ? "#00d46a" : "hsl(240 15% 90%)" }}
                    >
                      {tpl.name}
                      <span
                        className="rounded px-1 text-[9px]"
                        style={{ background: "var(--surface-2)", color: "hsl(240 8% 58%)" }}
                      >
                        {tpl.language}
                      </span>
                    </div>
                    {tpl.category && (
                      <div className="mt-0.5 text-[10px]" style={{ color: "hsl(240 8% 38%)" }}>
                        {tpl.category}
                      </div>
                    )}
                    <div
                      className="mt-1 line-clamp-2 text-[11px]"
                      style={{ color: "hsl(240 8% 52%)" }}
                    >
                      {getBodyText(tpl) || "—"}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Detail + vars */}
        <main className="flex flex-1 flex-col">
          <div
            className="flex items-center justify-between px-4 py-3"
            style={{ borderBottom: "1px solid hsl(240 12% 16%)" }}
          >
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold" style={{ color: "hsl(240 15% 93%)" }}>
                {selected?.name ?? "Selecione um template"}
              </h3>
              {selected && (
                <p className="text-[10px]" style={{ color: "hsl(240 8% 44%)" }}>
                  Idioma {selected.language} · {selected.category ?? "marketing"}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 hover:bg-white/5"
              style={{ color: "hsl(240 8% 48%)" }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 overflow-auto p-5">
            {!selected && (
              <div
                className="flex h-full items-center justify-center text-center text-xs"
                style={{ color: "hsl(240 8% 44%)" }}
              >
                Use templates aprovados para iniciar conversa fora da janela
                de 24h ou para mensagens promocionais sem o agente digitar
                todo o texto.
              </div>
            )}

            {selected && (
              <>
                <TemplatePreview tpl={selected} variables={variables} />
                {vars.length > 0 && (
                  <div
                    className="mt-4 rounded-xl p-4"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid hsl(240 12% 16%)",
                    }}
                  >
                    <h4
                      className="mb-2 text-[10px] font-semibold uppercase tracking-widest"
                      style={{ color: "hsl(240 8% 44%)" }}
                    >
                      Variáveis
                    </h4>
                    <div className="space-y-2">
                      {vars.map((v) => (
                        <label key={v} className="block">
                          <span
                            className="mb-1 block text-[10px]"
                            style={{ color: "hsl(240 8% 52%)" }}
                          >
                            {`{{${v}}}`}
                          </span>
                          <input
                            value={variables[v] ?? ""}
                            onChange={(e) =>
                              setVariables((prev) => ({ ...prev, [v]: e.target.value }))
                            }
                            placeholder={`Valor para {{${v}}}`}
                            className="w-full rounded-md px-3 py-2 text-xs outline-none"
                            style={{
                              background: "var(--surface-2)",
                              border: "1px solid hsl(240 12% 16%)",
                              color: "hsl(240 15% 90%)",
                            }}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div
            className="flex items-center justify-end gap-2 px-4 py-3"
            style={{ borderTop: "1px solid hsl(240 12% 16%)" }}
          >
            <button
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-xs"
              style={{
                background: "var(--surface-2)",
                border: "1px solid hsl(240 12% 16%)",
                color: "hsl(240 8% 62%)",
              }}
            >
              Cancelar
            </button>
            <button
              onClick={() => send.mutate()}
              disabled={!canSend || send.isPending}
              className="rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{ background: "#00d46a", color: "#03170a" }}
            >
              {send.isPending ? "Enviando…" : "Enviar template"}
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

function TemplatePreview({ tpl, variables }: { tpl: MetaTemplate; variables: Record<string, string> }) {
  const headerText = renderText(
    tpl.components?.find((c) => c.type === "HEADER" && c.format === "TEXT")?.text,
    variables,
  );
  const bodyText = renderText(
    tpl.components?.find((c) => c.type === "BODY")?.text,
    variables,
  );
  const footerText = tpl.components?.find((c) => c.type === "FOOTER")?.text;
  const buttons = tpl.components?.find((c) => c.type === "BUTTONS")?.buttons ?? [];
  return (
    <div
      className="mx-auto max-w-md rounded-2xl p-3 shadow-sm"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-default)",
        borderBottomLeftRadius: 6,
        color: "hsl(240 15% 92%)",
      }}
    >
      {headerText && (
        <div className="mb-2 text-sm font-semibold" style={{ color: "#00d46a" }}>
          {headerText}
        </div>
      )}
      {bodyText && <p className="whitespace-pre-wrap text-sm">{bodyText}</p>}
      {footerText && (
        <div className="mt-2 text-[10px]" style={{ color: "hsl(240 8% 44%)" }}>
          {footerText}
        </div>
      )}
      {buttons.length > 0 && (
        <div className="mt-3 space-y-1">
          {buttons.map((b, i) => (
            <div
              key={i}
              className="rounded-md px-3 py-1.5 text-center text-xs font-medium"
              style={{
                background: "rgba(0,212,106,0.08)",
                color: "#00d46a",
                border: "1px solid rgba(0,212,106,0.2)",
              }}
            >
              {b.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── utils ──────────────────────────────────────────────────────────────────

function getBodyText(tpl: MetaTemplate): string {
  return tpl.components?.find((c) => c.type === "BODY")?.text ?? "";
}

function extractVariables(tpl: MetaTemplate): string[] {
  const rx = /\{\{\s*(\d+)\s*\}\}/g;
  const set = new Set<string>();
  (tpl.components ?? []).forEach((c) => {
    if (!c.text) return;
    let m;
    while ((m = rx.exec(c.text)) !== null) set.add(m[1]);
  });
  return Array.from(set).sort((a, b) => Number(a) - Number(b));
}

function renderText(text: string | undefined, variables: Record<string, string>): string {
  if (!text) return "";
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, k) => variables[k] || `{{${k}}}`);
}

// buildMetaComponents converte { "1": "olá", "2": "João" } no formato que
// a Meta aceita:
//   [{ type: "body", parameters: [{type:"text", text:"olá"}, {type:"text",text:"João"}] }]
// Apenas BODY por enquanto — header/button params raramente precisam ser
// preenchidos no operador; se o template tem {{N}} no header text, o valor
// vai no component type:"header".
function buildMetaComponents(tpl: MetaTemplate, variables: Record<string, string>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  const headerComp = tpl.components?.find((c) => c.type === "HEADER" && c.format === "TEXT");
  if (headerComp?.text) {
    const headerVars = (headerComp.text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) =>
      m.replace(/[{}\s]/g, ""),
    );
    if (headerVars.length > 0) {
      out.push({
        type: "header",
        parameters: headerVars.map((k) => ({ type: "text", text: variables[k] ?? "" })),
      });
    }
  }

  const bodyComp = tpl.components?.find((c) => c.type === "BODY");
  if (bodyComp?.text) {
    const bodyVars = (bodyComp.text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) =>
      m.replace(/[{}\s]/g, ""),
    );
    if (bodyVars.length > 0) {
      out.push({
        type: "body",
        parameters: bodyVars.map((k) => ({ type: "text", text: variables[k] ?? "" })),
      });
    }
  }
  return out;
}
