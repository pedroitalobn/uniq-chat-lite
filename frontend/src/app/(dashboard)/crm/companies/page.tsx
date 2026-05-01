"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Building2, Users, Briefcase, X } from "lucide-react";
import { companiesApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import { formatCurrency, uniq, cardStyle } from "@/components/crm/tokens";

interface Company {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  city?: string;
  country?: string;
  contact_count: number;
  deal_count: number;
  open_deal_sum: number;
  currency?: string;
  owner?: { id: string; name: string } | null;
  logo_url?: string;
}

export default function CompaniesPage() {
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const qc = useQueryClient();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.companiesView) || hasPerm(PERM.crmView);
  const canCreate = hasPerm(PERM.companiesCreate) || hasPerm(PERM.crmCreate);

  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const listQ = useQuery({
    queryKey: ["companies", wsId, q],
    queryFn: () =>
      companiesApi.list(wsId as string, { q: q || undefined, limit: 100 }).then((r) =>
        r.data as { items: Company[]; total: number }
      ),
    enabled: !!wsId && canView,
  });

  if (!wsId || permsLoading) return <div className="p-6" style={{ color: uniq.textDim }}>Carregando…</div>;
  if (!canView) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-sm" style={{ color: uniq.textDim }}>
        Sem permissão para ver empresas.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col uniq-page">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 sm:px-6 py-3 sm:py-4" style={{ borderColor: uniq.borderSoft }}>
        <div className="flex items-center gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-medium" style={{ color: "hsl(240 8% 55%)" }}>
              Empresas
            </h2>
            <p className="text-xs" style={{ color: uniq.textFaint }}>
              {listQ.data?.total ?? 0} empresas cadastradas
            </p>
          </div>

        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5" style={{ color: uniq.textFaint }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nome, domínio, CNPJ…"
              className="w-60 rounded-lg py-1.5 pl-8 pr-3 text-xs outline-none"
              style={{ ...cardStyle, color: uniq.textPrimary }}
            />
          </div>
          {canCreate && (
            <button
              onClick={() => setNewOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: uniq.green, color: "#03170a" }}
            >
              <Plus className="h-3.5 w-3.5" />
              Nova empresa
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-4">
        {listQ.isLoading && <div className="text-sm" style={{ color: uniq.textDim }}>Carregando…</div>}
        {!listQ.isLoading && (listQ.data?.items.length ?? 0) === 0 && (
          <EmptyState onCreate={canCreate ? () => setNewOpen(true) : undefined} />
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {listQ.data?.items.map((co) => (
            <Link
              key={co.id}
              href={`/crm/companies/${co.id}`}
              className="rounded-xl p-4 transition-all hover:border-[rgba(0,212,106,0.3)]"
              style={cardStyle}
            >
              <div className="flex items-start gap-3">
                {co.logo_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={co.logo_url} alt="" className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <div
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
                    style={{ background: "rgba(0,212,106,0.08)" }}
                  >
                    <Building2 className="h-5 w-5" style={{ color: uniq.green }} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium" style={{ color: uniq.textStrong }}>
                    {co.name}
                  </h3>
                  <p className="truncate text-xs" style={{ color: uniq.textFaint }}>
                    {co.domain || co.industry || [co.city, co.country].filter(Boolean).join(", ") || "—"}
                  </p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[10px]">
                <StatPill icon={<Users className="h-3 w-3" />} value={co.contact_count} label="contatos" />
                <StatPill icon={<Briefcase className="h-3 w-3" />} value={co.deal_count} label="deals" />
                <StatPill value={formatCurrency(co.open_deal_sum, co.currency || "BRL")} label="em aberto" accent />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {newOpen && wsId && (
        <NewCompanyDialog
          wsId={wsId}
          onClose={() => setNewOpen(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ["companies", wsId] })}
        />
      )}
    </div>
  );
}

function StatPill({ icon, value, label, accent }: {
  icon?: React.ReactNode;
  value: number | string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div
      className="flex flex-col items-center rounded-md py-1.5"
      style={{ background: "var(--surface-2)" }}
    >
      <div
        className="flex items-center gap-0.5 text-xs font-medium"
        style={{ color: accent ? uniq.green : uniq.textPrimary }}
      >
        {icon}
        <span>{value}</span>
      </div>
      <span className="text-[9px]" style={{ color: uniq.textFaint }}>{label}</span>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
      <Building2 className="h-10 w-10" style={{ color: uniq.textFaint }} />
      <p className="text-sm" style={{ color: uniq.textDim }}>Ainda sem empresas cadastradas.</p>
      {onCreate && (
        <button
          onClick={onCreate}
          className="mt-1 rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ background: uniq.green, color: "#03170a" }}
        >
          Criar primeira empresa
        </button>
      )}
    </div>
  );
}

function NewCompanyDialog({
  wsId, onClose, onCreated,
}: {
  wsId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [industry, setIndustry] = useState("");
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("BR");

  const create = useMutation({
    mutationFn: () =>
      companiesApi.create(wsId, {
        name: name.trim(),
        domain: domain.trim() || undefined,
        industry: industry.trim() || undefined,
        city: city.trim() || undefined,
        country,
      }),
    onSuccess: () => {
      toast.success("Empresa criada");
      onCreated();
      onClose();
    },
    onError: () => toast.error("Falha ao criar empresa"),
  });

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: uniq.backdrop }}
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-md rounded-2xl p-6"
        style={{ background: uniq.bg, border: `1px solid ${uniq.border}` }}
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-base font-medium" style={{ color: uniq.textStrong }}>
            Nova empresa
          </h2>
          <button onClick={onClose} style={{ color: uniq.textFaint }}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <Labeled label="Nome *">
            <input
              className="w-full rounded-xl px-3 py-2 text-sm outline-none"
              style={{ ...cardStyle, color: uniq.textPrimary }}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Labeled>
          <div className="grid grid-cols-2 gap-3">
            <Labeled label="Domínio">
              <input
                placeholder="exemplo.com"
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ ...cardStyle, color: uniq.textPrimary }}
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
              />
            </Labeled>
            <Labeled label="Setor">
              <input
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ ...cardStyle, color: uniq.textPrimary }}
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </Labeled>
          </div>
          <div className="grid grid-cols-[1fr_80px] gap-3">
            <Labeled label="Cidade">
              <input
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ ...cardStyle, color: uniq.textPrimary }}
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </Labeled>
            <Labeled label="País">
              <input
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{ ...cardStyle, color: uniq.textPrimary }}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </Labeled>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs"
            style={{ background: "var(--surface-2)", color: uniq.textDim }}
          >
            Cancelar
          </button>
          <button
            onClick={() => create.mutate()}
            disabled={!name.trim() || create.isPending}
            className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            style={{ background: uniq.green, color: "#03170a" }}
          >
            Criar
          </button>
        </div>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium" style={{ color: uniq.textDim }}>
        {label}
      </span>
      {children}
    </label>
  );
}
