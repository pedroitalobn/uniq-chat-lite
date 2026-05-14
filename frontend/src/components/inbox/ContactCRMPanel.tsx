"use client";

// ContactCRMPanel — sidepanel mini-CRM exibido dentro do ConversationDetail.
// Mostra deals abertos, tags atuais e última jornada do contato — info que
// antes só vivia em /crm/contacts/[id], obrigando o atendente a abrir nova
// aba só pra saber se o cara tem deal ativo.
//
// Ações inline disponíveis: adicionar tag (combo), abrir deal no kanban.
// Criar deal continua sendo via CreateDealModal já existente no detail
// (o botão Sparkles abre).

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, X, Briefcase, Route, Tag as TagIcon } from "lucide-react";
import { crmApi, dealsApi } from "@/lib/api";

interface DealRow { id: string; title: string; stage_id: string; status: string; value: number; currency: string; }
interface ContactDetail {
  id: string;
  name?: string;
  phone?: string;
  funnel?: string;
  stage?: string;
  journey?: string;
  tags?: Array<{ id: string; name: string; color: string }>;
}
interface TagOpt { id: string; name: string; color: string; }

export function ContactCRMPanel({ workspaceId, contactId }: { workspaceId: string; contactId: string }) {
  const qc = useQueryClient();

  const contactQ = useQuery({
    queryKey: ["inbox-contact-crm", contactId],
    queryFn: () => crmApi.getContact(contactId).then((r) => r.data as ContactDetail),
    enabled: !!contactId,
    staleTime: 15_000,
  });

  const dealsQ = useQuery({
    queryKey: ["inbox-contact-deals", workspaceId, contactId],
    queryFn: () =>
      dealsApi
        .list(workspaceId, { contact_id: contactId, status: "open,won,lost", limit: 10 })
        .then((r) => {
          const raw = r.data as { items?: DealRow[]; data?: DealRow[] };
          return (raw.items ?? raw.data ?? []) as DealRow[];
        }),
    enabled: !!workspaceId && !!contactId,
    staleTime: 15_000,
  });

  const tagsQ = useQuery({
    queryKey: ["tags", workspaceId],
    queryFn: () => crmApi.listTags(workspaceId).then((r) => r.data as TagOpt[]),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });

  const setTags = useMutation({
    mutationFn: (tagIds: string[]) => crmApi.assignTags(contactId, tagIds),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox-contact-crm", contactId] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: () => toast.error("Erro ao atualizar tags"),
  });

  const contact = contactQ.data;
  const deals = dealsQ.data ?? [];
  const allTags = tagsQ.data ?? [];
  const currentTagIds = useMemo(() => new Set((contact?.tags ?? []).map((t) => t.id)), [contact]);

  const [showTagPicker, setShowTagPicker] = useState(false);

  const toggleTag = (id: string) => {
    const next = new Set(currentTagIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setTags.mutate([...next]);
  };

  if (!contactId) return null;

  return (
    <div
      className="rounded-xl p-2.5 space-y-2"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[8px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-4)" }}>
          CRM
        </p>
        <Link
          href={`/crm/contacts/${contactId}`}
          className="text-[9px] underline"
          style={{ color: "var(--text-3)" }}
        >
          Abrir contato
        </Link>
      </div>

      {/* Funnel/Stage/Journey resumo */}
      {(contact?.funnel || contact?.stage || contact?.journey) && (
        <div className="grid grid-cols-1 gap-1 text-[10px]">
          {contact?.funnel && <KV label="Funil" value={contact.funnel} />}
          {contact?.stage && <KV label="Estágio" value={contact.stage} />}
          {contact?.journey && (
            <KV label="Jornada" value={
              <span className="inline-flex items-center gap-1">
                <Route className="w-2.5 h-2.5" /> {contact.journey}
              </span>
            } />
          )}
        </div>
      )}

      {/* Deals */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[8px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-4)" }}>
            Deals
          </span>
          <span className="text-[9px]" style={{ color: "var(--text-3)" }}>{deals.length}</span>
        </div>
        {deals.length === 0 ? (
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>Nenhum deal vinculado.</p>
        ) : (
          <div className="space-y-1">
            {deals.map((d) => (
              <Link
                key={d.id}
                href={`/crm/deals/${d.id}`}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/5"
                style={{ background: "var(--input)" }}
              >
                <Briefcase className="w-2.5 h-2.5 flex-shrink-0" style={{ color: dealStatusColor(d.status) }} />
                <span className="text-[10px] truncate flex-1" style={{ color: "var(--text-1)" }}>{d.title}</span>
                <span className="text-[9px] flex-shrink-0" style={{ color: "var(--text-3)" }}>
                  {formatMoney(d.value, d.currency)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Tags */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[8px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-4)" }}>
            Tags
          </span>
          <button
            type="button"
            onClick={() => setShowTagPicker((v) => !v)}
            className="text-[9px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded"
            style={{ color: "var(--green)", background: "rgba(37, 99, 235,0.08)" }}
          >
            {showTagPicker ? <><X className="w-2.5 h-2.5" /> Fechar</> : <><Plus className="w-2.5 h-2.5" /> Editar</>}
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {(contact?.tags ?? []).length === 0 && !showTagPicker && (
            <p className="text-[10px]" style={{ color: "var(--text-3)" }}>Sem tags.</p>
          )}
          {(contact?.tags ?? []).map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px]"
              style={{ background: t.color + "22", color: t.color, border: `1px solid ${t.color}44` }}
            >
              <TagIcon className="w-2.5 h-2.5" />
              {t.name}
            </span>
          ))}
        </div>
        {showTagPicker && (
          <div className="mt-2 flex flex-wrap gap-1">
            {allTags.length === 0 && (
              <p className="text-[10px]" style={{ color: "var(--text-3)" }}>
                Sem tags criadas. Crie em <Link href="/crm/properties" className="underline">Propriedades</Link>.
              </p>
            )}
            {allTags.map((t) => {
              const on = currentTagIds.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTag(t.id)}
                  className="px-1.5 py-0.5 rounded-full text-[9px] transition-colors"
                  style={{
                    background: on ? t.color + "22" : "var(--input)",
                    color: on ? t.color : "var(--text-3)",
                    border: `1px solid ${on ? t.color + "44" : "var(--border-default)"}`,
                  }}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <span className="truncate" style={{ color: "var(--text-1)" }}>{value}</span>
    </div>
  );
}

function dealStatusColor(s: string) {
  if (s === "won") return "#2563EB";
  if (s === "lost") return "#ef4444";
  return "#3b82f6";
}

function formatMoney(value: number, currency: string) {
  if (!value) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL", maximumFractionDigits: 0 }).format(value / 100);
  } catch {
    return `${currency} ${(value / 100).toFixed(0)}`;
  }
}
