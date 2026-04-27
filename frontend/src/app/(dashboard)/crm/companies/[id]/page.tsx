"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft, Building2, Globe, Phone, Mail, MapPin, Users, Briefcase,
  Pencil, Check, X,
} from "lucide-react";
import { companiesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { formatCurrency, relativeTime, uniq, cardStyle, statusColor, statusLabel } from "@/components/crm/tokens";

interface Company {
  id: string;
  name: string;
  legal_name?: string;
  domain?: string;
  website?: string;
  phone?: string;
  email?: string;
  industry?: string;
  size?: string;
  description?: string;
  address_line?: string;
  city?: string;
  state?: string;
  country?: string;
  postal_code?: string;
  tax_id?: string;
  logo_url?: string;
  contact_count: number;
  deal_count: number;
  open_deal_sum: number;
  currency?: string;
  owner?: { id: string; name: string; email: string } | null;
  created_at: string;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  avatar_url?: string;
  owner?: { name: string } | null;
}

interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  status: string;
  stage_change_at?: string;
  contact?: { name: string };
}

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.companiesView) || hasPerm(PERM.crmView);
  const canEdit = hasPerm(PERM.companiesEdit) || hasPerm(PERM.crmEdit);

  const [editing, setEditing] = useState<"overview" | null>(null);

  const companyQ = useQuery({
    queryKey: ["company", wsId, id],
    queryFn: () => companiesApi.get(wsId as string, id).then((r) => r.data as Company),
    enabled: !!wsId && canView,
  });

  const contactsQ = useQuery({
    queryKey: ["company-contacts", wsId, id],
    queryFn: () =>
      companiesApi.contacts(wsId as string, id).then((r) => (r.data as { items: Contact[] }).items ?? []),
    enabled: !!wsId && canView,
  });

  const dealsQ = useQuery({
    queryKey: ["company-deals", wsId, id],
    queryFn: () =>
      companiesApi.deals(wsId as string, id).then((r) => (r.data as { items: Deal[] }).items ?? []),
    enabled: !!wsId && canView,
  });

  if (!wsId || permsLoading) return <div className="p-6" style={{ color: uniq.textDim }}>Carregando…</div>;
  if (!canView) {
    return <div className="p-6 text-sm" style={{ color: uniq.textDim }}>Sem permissão.</div>;
  }

  const c = companyQ.data;
  if (!c) return <div className="p-6" style={{ color: uniq.textDim }}>Carregando empresa…</div>;

  const openDealSum = c.open_deal_sum;

  return (
    <div className="flex h-full flex-col">
      <header
        className="flex items-center gap-3 border-b px-5 py-3"
        style={{ borderColor: uniq.borderSoft }}
      >
        <Link
          href="/crm/companies"
          className="rounded-md p-1.5 transition-opacity hover:opacity-70"
          style={{ color: uniq.textFaint }}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        {c.logo_url ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={c.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
        ) : (
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: "rgba(0,212,106,0.08)" }}
          >
            <Building2 className="h-4 w-4" style={{ color: uniq.green }} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold" style={{ color: uniq.textStrong }}>
            {c.name}
          </h1>
          <p className="truncate text-xs" style={{ color: uniq.textFaint }}>
            {c.industry || c.domain || "—"} · Criada {relativeTime(c.created_at)}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing(editing === "overview" ? null : "overview")}
            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs"
            style={{ background: "var(--surface-2)", color: uniq.textDim }}
          >
            <Pencil className="h-3 w-3" />
            {editing === "overview" ? "Fechar" : "Editar"}
          </button>
        )}
      </header>

      {/* Hero strip */}
      <div
        className="grid grid-cols-3 gap-3 border-b p-5"
        style={{ borderColor: uniq.borderSoft, background: uniq.bgElevated }}
      >
        <Metric
          icon={<Users className="h-4 w-4" />}
          label="Contatos"
          value={String(c.contact_count)}
        />
        <Metric
          icon={<Briefcase className="h-4 w-4" />}
          label="Deals"
          value={String(c.deal_count)}
        />
        <Metric
          label="Em aberto"
          value={formatCurrency(openDealSum, c.currency || "BRL")}
          accent={uniq.green}
        />
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: details + identity */}
        <section className="flex-1 overflow-auto p-5">
          {editing === "overview" && canEdit ? (
            <EditOverview
              company={c}
              wsId={wsId}
              onClose={() => setEditing(null)}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ["company", wsId, id] });
                setEditing(null);
              }}
            />
          ) : (
            <>
              {c.description && (
                <p className="mb-6 text-sm" style={{ color: uniq.textDim }}>
                  {c.description}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Row label="Razão social" value={c.legal_name} />
                <Row label="CNPJ / Tax ID" value={c.tax_id} />
                <Row label="Site" value={c.website} link />
                <Row label="Domínio" value={c.domain} />
                <Row label="Telefone" value={c.phone} icon={<Phone className="h-3 w-3" />} />
                <Row label="Email" value={c.email} icon={<Mail className="h-3 w-3" />} />
                <Row label="Setor" value={c.industry} />
                <Row label="Tamanho" value={c.size} />
                <Row
                  label="Endereço"
                  value={[c.address_line, c.city, c.state, c.country, c.postal_code].filter(Boolean).join(", ") || undefined}
                  icon={<MapPin className="h-3 w-3" />}
                />
              </div>
            </>
          )}

          {/* Deals */}
          <h2 className="mt-8 mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: uniq.textFaint }}>
            Deals ({dealsQ.data?.length ?? 0})
          </h2>
          {dealsQ.data?.length === 0 && (
            <p className="text-xs" style={{ color: uniq.textFaint }}>
              Sem deals vinculados ainda.
            </p>
          )}
          <div className="space-y-2">
            {dealsQ.data?.map((d) => (
              <Link
                key={d.id}
                href={`/crm/deals/${d.id}`}
                className="flex items-center justify-between rounded-xl p-3 transition-colors hover:border-[rgba(0,212,106,0.3)]"
                style={cardStyle}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium" style={{ color: uniq.textPrimary }}>{d.title}</div>
                  <div className="text-xs" style={{ color: uniq.textFaint }}>
                    {d.contact?.name || "—"} · {relativeTime(d.stage_change_at)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-sm font-semibold" style={{ color: uniq.green }}>
                    {formatCurrency(d.value, d.currency)}
                  </span>
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[10px]"
                    style={{ background: statusColor(d.status) + "22", color: statusColor(d.status) }}
                  >
                    {statusLabel(d.status)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Right: contacts */}
        <aside
          className="hidden w-80 flex-col border-l overflow-auto p-5 lg:flex"
          style={{ borderColor: uniq.borderSoft, background: uniq.bgElevated }}
        >
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest" style={{ color: uniq.textFaint }}>
            Contatos ({contactsQ.data?.length ?? 0})
          </h2>
          <div className="space-y-2">
            {contactsQ.data?.map((ct) => (
              <Link
                key={ct.id}
                href={`/crm/contacts/${ct.id}`}
                className="flex items-center gap-2 rounded-xl p-2 transition-colors hover:bg-white/5"
              >
                <Avatar name={ct.name} url={ct.avatar_url} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm" style={{ color: uniq.textPrimary }}>{ct.name}</div>
                  <div className="truncate text-xs" style={{ color: uniq.textFaint }}>
                    {ct.email || ct.phone || "—"}
                  </div>
                </div>
              </Link>
            ))}
            {contactsQ.data?.length === 0 && (
              <p className="text-xs" style={{ color: uniq.textFaint }}>
                Nenhum contato vinculado ainda.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function EditOverview({ company, wsId, onClose, onSaved }: {
  company: Company;
  wsId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, setState] = useState({
    name: company.name, legal_name: company.legal_name ?? "", domain: company.domain ?? "",
    website: company.website ?? "", phone: company.phone ?? "", email: company.email ?? "",
    industry: company.industry ?? "", size: company.size ?? "", description: company.description ?? "",
    city: company.city ?? "", state: company.state ?? "", country: company.country ?? "",
    postal_code: company.postal_code ?? "", tax_id: company.tax_id ?? "",
  });
  const save = useMutation({
    mutationFn: () => companiesApi.patch(wsId, company.id, state),
    onSuccess: () => { toast.success("Atualizado"); onSaved(); },
    onError: () => toast.error("Falha ao salvar"),
  });
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: uniq.textFaint }}>
          Editar
        </h3>
        <button onClick={onClose} className="p-1" style={{ color: uniq.textFaint }}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {([
          ["name", "Nome"],
          ["legal_name", "Razão social"],
          ["domain", "Domínio"],
          ["website", "Website"],
          ["phone", "Telefone"],
          ["email", "Email"],
          ["industry", "Setor"],
          ["size", "Tamanho"],
          ["tax_id", "Tax ID"],
          ["city", "Cidade"],
          ["state", "Estado"],
          ["country", "País"],
        ] as const).map(([k, label]) => (
          <label key={k} className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest" style={{ color: uniq.textFaint }}>
              {label}
            </span>
            <input
              className="w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{ ...cardStyle, color: uniq.textPrimary }}
              value={(state as Record<string, string>)[k]}
              onChange={(e) => setState((prev) => ({ ...prev, [k]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block text-[10px] uppercase tracking-widest" style={{ color: uniq.textFaint }}>
          Descrição
        </span>
        <textarea
          rows={3}
          className="w-full resize-y rounded-xl px-3 py-2 text-sm outline-none"
          style={{ ...cardStyle, color: uniq.textPrimary }}
          value={state.description}
          onChange={(e) => setState((prev) => ({ ...prev, description: e.target.value }))}
        />
      </label>
      <div className="flex justify-end">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
          style={{ background: uniq.green, color: "#03170a" }}
        >
          <Check className="h-3 w-3" />
          Salvar
        </button>
      </div>
    </div>
  );
}

function Metric({ icon, label, value, accent }: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div
      className="rounded-xl p-3"
      style={cardStyle}
    >
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest" style={{ color: uniq.textFaint }}>
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold" style={{ color: accent || uniq.textStrong }}>{value}</div>
    </div>
  );
}

function Row({ label, value, icon, link }: {
  label: string;
  value?: string | null;
  icon?: React.ReactNode;
  link?: boolean;
}) {
  if (!value) {
    return (
      <div>
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest" style={{ color: uniq.textFaint }}>
          {icon}
          {label}
        </div>
        <div className="mt-0.5 text-sm" style={{ color: uniq.textFaint }}>—</div>
      </div>
    );
  }
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest" style={{ color: uniq.textFaint }}>
        {icon}
        {label}
      </div>
      {link ? (
        <a
          href={value.startsWith("http") ? value : `https://${value}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-0.5 block text-sm hover:underline"
          style={{ color: uniq.green }}
        >
          <Globe className="mr-1 inline h-3 w-3" />
          {value}
        </a>
      ) : (
        <div className="mt-0.5 text-sm" style={{ color: uniq.textPrimary }}>{value}</div>
      )}
    </div>
  );
}

function Avatar({ name, url }: { name: string; url?: string }) {
  if (url) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={url} alt="" className="h-8 w-8 rounded-full object-cover" />;
  }
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{ background: "rgba(0,212,106,0.08)", color: uniq.green }}
    >
      {initials || "?"}
    </div>
  );
}
