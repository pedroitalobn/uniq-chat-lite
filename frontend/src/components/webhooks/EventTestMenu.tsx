"use client";

import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Play, ChevronDown, Loader2, Search, X, Eye } from "lucide-react";
import { toast } from "sonner";
import { webhooksApi, globalWebhooksApi } from "@/lib/api";

interface SystemEvent {
  id: string;
  name: string;
  category: string;
  admin_only?: boolean;
}

type Scope = { kind: "global"; webhookId: string }
            | { kind: "instance"; instanceId: string; webhookId: string };

/**
 * EventTestMenu — botão "Play" que abre menu pra escolher qual evento
 * disparar como teste pro webhook. Mostra preview do payload antes de
 * enviar. Substitui o botão Play simples que só mandava "webhook.test".
 */
export function EventTestMenu({
  scope,
  enabledEvents,
  allEvents,
  disabled,
}: {
  scope: Scope;
  /** Eventos selecionados pelo webhook — sugeridos no topo */
  enabledEvents: string[];
  /** Catálogo completo (pra o user escolher qualquer um pra teste) */
  allEvents: SystemEvent[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [previewing, setPreviewing] = useState<string | null>(null);

  const testMut = useMutation({
    mutationFn: (eventId: string) => {
      if (scope.kind === "instance") {
        return webhooksApi.test(scope.instanceId, scope.webhookId, eventId);
      }
      return globalWebhooksApi.test(scope.webhookId, eventId);
    },
    onSuccess: (res, eventId) => {
      const d = res.data as { success: boolean; status: number; latency_ms: number; error?: string };
      if (d.success) {
        toast.success(`${eventId} · ${d.status} · ${d.latency_ms}ms`);
      } else {
        toast.error(`${eventId} · ${d.status || "—"} · ${d.error || "falhou"}`);
      }
    },
    onError: () => toast.error("Erro ao enviar teste"),
  });

  const grouped = useMemo(() => {
    const enabled = new Set(enabledEvents);
    const q = search.trim().toLowerCase();
    const filtered = allEvents.filter(
      e => !q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)
    );
    // Subscribed events primeiro (sugestão), resto agrupado por categoria
    const subscribed = filtered.filter(e => enabled.has(e.id));
    const others = filtered.filter(e => !enabled.has(e.id));
    return { subscribed, others };
  }, [allEvents, enabledEvents, search]);

  const handleTest = (eventId: string) => {
    testMut.mutate(eventId);
    setOpen(false);
  };

  return (
    <div className="relative">
      <div className="flex items-center">
        <button
          onClick={() => handleTest("webhook.test")}
          disabled={disabled || testMut.isPending}
          className="p-2 rounded-l-lg transition-colors disabled:opacity-40 hover:bg-white/5"
          style={{ color: "var(--text-2)" }}
          title="Enviar webhook.test"
        >
          {testMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
        </button>
        <button
          onClick={() => setOpen(!open)}
          disabled={disabled}
          className="p-1.5 rounded-r-lg transition-colors disabled:opacity-40 hover:bg-white/5 border-l"
          style={{ color: "var(--text-3)", borderColor: "var(--surface-border)" }}
          title="Escolher evento pra teste"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-10 z-40 w-80 rounded-xl shadow-xl"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--surface-border)",
              boxShadow: "var(--shadow-3)",
            }}
          >
            <div className="p-3 border-b" style={{ borderColor: "var(--surface-border)" }}>
              <p className="text-xs font-medium mb-2" style={{ color: "var(--text-1)" }}>
                Disparar como evento de teste
              </p>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--text-3)" }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar evento…"
                  className="w-full pl-8 pr-2 py-1.5 rounded-md text-xs outline-none"
                  style={{ background: "var(--surface-3)", color: "var(--text-1)", border: "1px solid var(--surface-border)" }}
                />
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto">
              {grouped.subscribed.length > 0 && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase font-medium" style={{ color: "var(--text-3)" }}>
                    Inscritos no webhook
                  </p>
                  {grouped.subscribed.map(e => (
                    <EventRow key={e.id} ev={e} onTest={() => handleTest(e.id)} onPreview={() => setPreviewing(e.id)} />
                  ))}
                </div>
              )}
              {grouped.others.length > 0 && (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[10px] uppercase font-medium" style={{ color: "var(--text-3)" }}>
                    Outros eventos
                  </p>
                  {grouped.others.map(e => (
                    <EventRow key={e.id} ev={e} onTest={() => handleTest(e.id)} onPreview={() => setPreviewing(e.id)} />
                  ))}
                </div>
              )}
              {grouped.subscribed.length === 0 && grouped.others.length === 0 && (
                <p className="px-3 py-4 text-xs italic text-center" style={{ color: "var(--text-3)" }}>
                  Nada encontrado
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {previewing && (
        <PayloadPreviewDialog eventId={previewing} onClose={() => setPreviewing(null)} />
      )}
    </div>
  );
}

function EventRow({
  ev,
  onTest,
  onPreview,
}: {
  ev: SystemEvent;
  onTest: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-1 py-0.5 group">
      <button
        onClick={onTest}
        className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors hover:bg-white/5"
      >
        <code className="font-mono shrink-0 text-[10px]" style={{ color: "#8b5cf6" }}>
          {ev.id}
        </code>
        <span className="flex-1 truncate" style={{ color: "var(--text-2)" }}>{ev.name}</span>
        {ev.admin_only && (
          <span className="text-[8px] px-1 py-0.5 rounded font-semibold" style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }} title="Apenas admin">
            ADM
          </span>
        )}
      </button>
      <button
        onClick={onPreview}
        className="p-1.5 rounded transition-opacity opacity-50 group-hover:opacity-100 hover:bg-white/5"
        style={{ color: "var(--text-3)" }}
        title="Ver payload exemplo"
      >
        <Eye className="w-3 h-3" />
      </button>
    </div>
  );
}

/**
 * PayloadPreviewDialog — busca o mock payload do backend e mostra
 * formatado em JSON. Útil pro user saber a estrutura antes de testar.
 */
function PayloadPreviewDialog({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [payload, setPayload] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useMemo(() => {
    setLoading(true);
    globalWebhooksApi
      .previewEvent(eventId)
      .then(r => setPayload(JSON.stringify(r.data, null, 2)))
      .catch(() => setError("Falha ao carregar preview"))
      .finally(() => setLoading(false));
  }, [eventId]);

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4" style={{ background: "var(--surface-overlay)" }} onClick={onClose}>
      <div
        className="w-full max-w-xl rounded-2xl flex flex-col max-h-[85vh]"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--surface-border)" }}>
          <div>
            <p className="text-xs uppercase font-medium" style={{ color: "var(--text-3)" }}>Payload exemplo</p>
            <code className="text-sm font-mono" style={{ color: "#8b5cf6" }}>{eventId}</code>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5" style={{ color: "var(--text-3)" }}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="py-12 text-center flex items-center justify-center gap-2" style={{ color: "var(--text-3)" }}>
              <Loader2 className="w-4 h-4 animate-spin" /> Gerando…
            </div>
          ) : error ? (
            <p className="text-xs text-center" style={{ color: "#ef4444" }}>{error}</p>
          ) : (
            <pre className="text-xs font-mono whitespace-pre-wrap break-all p-3 rounded-lg" style={{ background: "var(--surface-3)", color: "var(--text-1)" }}>
              {payload}
            </pre>
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: "var(--surface-border)" }}>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
            Este é só um exemplo. Em produção os campos exatos podem variar conforme o canal.
          </p>
          <button
            onClick={() => {
              if (payload) {
                navigator.clipboard.writeText(payload);
                toast.success("Copiado");
              }
            }}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{ background: "var(--surface-3)", color: "var(--text-2)", border: "1px solid var(--surface-border)" }}
            disabled={!payload}
          >
            Copiar
          </button>
        </div>
      </div>
    </div>
  );
}
