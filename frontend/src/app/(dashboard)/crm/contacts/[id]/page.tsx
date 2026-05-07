"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Phone, Mail, MapPin, Building2, Briefcase, Tag as TagIcon,
  Users, MessageSquare, Calendar, User as UserIcon,
} from "lucide-react";
import { crmApi, dealsApi, contactGroupsApi, conversationsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { EntityTasksMeetings } from "@/components/crm/DealTasksMeetings";
import { ContactTagPicker } from "@/components/crm/ContactTagPicker";
import { EntityCustomFieldsSection } from "@/components/crm/EntityCustomFieldsSection";
import { PERM, useWorkspacePermissions } from "@/contexts/WorkspacePermissionsContext";
import {
  formatCurrency, relativeTime, uniq, cardStyle, statusColor, statusLabel,
} from "@/components/crm/tokens";

interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  avatar_url?: string;
  source: string;
  company?: { id: string; name: string; logo_url?: string } | null;
  owner?: { id: string; name: string; email: string } | null;
  funnel?: string;
  stage?: string;
  journey?: string;
  external_id?: string;
  job_title?: string;
  department?: string;
  birthday?: string;
  linkedin_url?: string;
  instagram_handle?: string;
  city?: string;
  state?: string;
  country?: string;
  tags?: Array<{ id: string; name: string; color: string }>;
  deals_open?: number;
  deals_won?: number;
  last_contact_at?: string;
  created_at: string;
  custom_fields?: string | Record<string, unknown> | null;
}

interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  status: string;
  stage_change_at?: string;
}

interface GroupMembership {
  group_id: string;
  name: string;
  participant_count: number;
  role: string;
  joined_at: string;
  left_at?: string | null;
}

interface ConversationRow {
  id: string;
  channel_type: string;
  status: string;
  last_message_at?: string;
  last_message_preview?: string;
}

export default function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { currentWorkspace } = useWorkspace();
  const { hasPerm, isLoading: permsLoading } = useWorkspacePermissions();
  const wsId = currentWorkspace?.id;
  const canView = hasPerm(PERM.crmView);

  const contactQ = useQuery({
    queryKey: ["contact", wsId, id],
    queryFn: () =>
      crmApi.getContact(id).then((r) => (r.data as { contact?: Contact }).contact ?? (r.data as Contact)),
    enabled: !!wsId && canView,
  });

  const dealsQ = useQuery({
    queryKey: ["contact-deals", wsId, id],
    queryFn: () =>
      dealsApi
        .list(wsId as string, { contact_id: id, status: "open,won,lost", limit: 100 })
        .then((r) => (r.data as { items: Deal[] }).items ?? []),
    enabled: !!wsId && canView,
  });

  const groupsQ = useQuery({
    queryKey: ["contact-groups", wsId, id],
    queryFn: () =>
      contactGroupsApi
        .contactGroups(wsId as string, id)
        .then((r) => (r.data as { items: GroupMembership[] }).items ?? []),
    enabled: !!wsId && canView,
  });

  const conversationsQ = useQuery({
    queryKey: ["contact-conversations", wsId, id],
    queryFn: () =>
      conversationsApi
        .list(wsId as string, { contact_id: id, limit: 50 })
        .then((r) => (r.data as { items: ConversationRow[] }).items ?? []),
    enabled: !!wsId && canView,
  });

  if (!wsId || permsLoading) return <div className="p-6" style={{ color: uniq.textDim }}>Carregando…</div>;
  if (!canView) {
    return <div className="p-6 text-sm" style={{ color: uniq.textDim }}>Sem permissão.</div>;
  }

  const c = contactQ.data;
  if (!c) return <div className="p-6" style={{ color: uniq.textDim }}>Carregando contato…</div>;

  const dealsOpen = (dealsQ.data ?? []).filter((d) => d.status === "open");
  const dealsWon = (dealsQ.data ?? []).filter((d) => d.status === "won");
  const openValue = dealsOpen.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex h-full flex-col">
      {/* Hero */}
      <header
        className="border-b px-5 py-4"
        style={{ borderColor: uniq.borderSoft }}
      >
        <div className="flex items-center gap-3">
          <Link
            href="/crm/contacts"
            className="rounded-md p-1.5 transition-opacity hover:opacity-70"
            style={{ color: uniq.textFaint }}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Avatar name={c.name} url={c.avatar_url} size={44} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-medium" style={{ color: uniq.textStrong }}>
              {c.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: uniq.textFaint }}>
              {c.job_title && <span>{c.job_title}</span>}
              {c.company && (
                <Link
                  href={`/crm/companies/${c.company.id}`}
                  className="inline-flex items-center gap-1 hover:underline"
                  style={{ color: uniq.green }}
                >
                  <Building2 className="h-3 w-3" />
                  {c.company.name}
                </Link>
              )}
              <span>· Canal: {c.source}</span>
              {c.last_contact_at && <span>· Último contato {relativeTime(c.last_contact_at)}</span>}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <Stat label="Deals abertos" value={String(dealsOpen.length)} accent={uniq.statusOpen} />
          <Stat label="Ganhos" value={String(dealsWon.length)} accent={uniq.statusWon} />
          <Stat label="Em aberto" value={formatCurrency(openValue, dealsOpen[0]?.currency ?? "BRL")} accent={uniq.green} />
          <Stat label="Grupos" value={String(groupsQ.data?.length ?? 0)} />
        </div>
      </header>

      <div className="grid flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Main column */}
        <section className="overflow-auto p-5">
          {/* Contact facts */}
          <Section title="Informações">
            <div className="grid grid-cols-2 gap-3">
              <Fact icon={<Phone className="h-3 w-3" />} label="Telefone" value={c.phone} />
              <Fact icon={<Mail className="h-3 w-3" />} label="Email" value={c.email} />
              <Fact icon={<Briefcase className="h-3 w-3" />} label="Cargo" value={c.job_title} />
              <Fact label="Departamento" value={c.department} />
              <Fact icon={<Calendar className="h-3 w-3" />} label="Aniversário" value={c.birthday ? new Date(c.birthday).toLocaleDateString("pt-BR") : undefined} />
              <Fact icon={<MapPin className="h-3 w-3" />} label="Localização" value={[c.city, c.state, c.country].filter(Boolean).join(", ") || undefined} />
              <Fact label="LinkedIn" value={c.linkedin_url} link />
              <Fact label="Instagram" value={c.instagram_handle ? `@${c.instagram_handle}` : undefined} />
              <Fact icon={<UserIcon className="h-3 w-3" />} label="Dono (agente)" value={c.owner?.name} />
              <Fact label="External ID" value={c.external_id} />
            </div>

            {c.notes && (
              <div className="mt-4 rounded-xl p-3" style={cardStyle}>
                <div className="mb-1 text-[10px] uppercase tracking-widest" style={{ color: uniq.textFaint }}>
                  Notas
                </div>
                <p className="whitespace-pre-wrap text-sm" style={{ color: uniq.textDim }}>
                  {c.notes}
                </p>
              </div>
            )}

            {/* Tags — picker editável (substitui display read-only) */}
            <div className="mt-4">
              <ContactTagPicker
                contactId={c.id}
                workspaceId={wsId as string | undefined}
                currentTags={c.tags ?? []}
              />
            </div>
          </Section>

          {/* Deals */}
          <Section title={`Deals (${dealsQ.data?.length ?? 0})`}>
            {dealsQ.data?.length === 0 && (
              <p className="text-xs" style={{ color: uniq.textFaint }}>Sem deals.</p>
            )}
            <div className="space-y-2">
              {dealsQ.data?.map((d) => (
                <Link
                  key={d.id}
                  href={`/crm/deals/${d.id}`}
                  className="flex items-center justify-between rounded-xl p-3 transition-colors hover:border-[rgba(0,212,106,0.3)]"
                  style={cardStyle}
                >
                  <div>
                    <div className="text-sm font-medium" style={{ color: uniq.textPrimary }}>{d.title}</div>
                    <div className="text-xs" style={{ color: uniq.textFaint }}>
                      {relativeTime(d.stage_change_at)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className="text-sm font-medium" style={{ color: uniq.green }}>
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
          </Section>

          {/* Groups */}
          <Section title={`Participação em grupos (${groupsQ.data?.length ?? 0})`}>
            {groupsQ.data?.length === 0 && (
              <p className="text-xs" style={{ color: uniq.textFaint }}>
                O contato não está em grupos monitorados.
              </p>
            )}
            <div className="space-y-2">
              {groupsQ.data?.map((g) => (
                <div
                  key={g.group_id}
                  className="flex items-center justify-between rounded-xl p-3"
                  style={cardStyle}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium" style={{ color: uniq.textPrimary }}>
                      <Users className="h-3.5 w-3.5" style={{ color: uniq.textFaint }} />
                      {g.name || "Grupo sem nome"}
                      {g.role !== "member" && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[9px]"
                          style={{ background: "rgba(0,212,106,0.1)", color: uniq.green }}
                        >
                          {g.role}
                        </span>
                      )}
                    </div>
                    <div className="text-xs" style={{ color: uniq.textFaint }}>
                      {g.participant_count} participantes · entrou {relativeTime(g.joined_at)}
                      {g.left_at && ` · saiu ${relativeTime(g.left_at)}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </section>

        {/* Sidebar: atendimentos + CRM fields */}
        <aside
          className="overflow-auto border-t p-5 lg:border-l lg:border-t-0 space-y-4"
          style={{ borderColor: uniq.borderSoft, background: uniq.bgElevated }}
        >
          {/* Tarefas e reuniões deste contato (cross-entity) */}
          <EntityTasksMeetings workspaceId={(wsId as string) || ""} scope={{ contactId: id }} />

          {wsId && (
            <EntityCustomFieldsSection
              workspaceId={wsId}
              entityType="contact"
              entityId={id}
              initialValue={c.custom_fields ?? null}
              onPatch={(cf) => crmApi.updateContact(id, { custom_fields: cf } as Record<string, unknown>)}
              invalidateKeys={[["contact", id], ["contacts"]]}
            />
          )}

          <SidebarLabel>Pipeline</SidebarLabel>
          <div className="mt-2 rounded-xl p-3 text-xs" style={cardStyle}>
            <div className="flex justify-between">
              <span style={{ color: uniq.textFaint }}>Funil</span>
              <span style={{ color: uniq.textPrimary }}>{c.funnel || "—"}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span style={{ color: uniq.textFaint }}>Estágio</span>
              <span style={{ color: uniq.textPrimary }}>{c.stage || "—"}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span style={{ color: uniq.textFaint }}>Jornada</span>
              <span style={{ color: uniq.textPrimary }}>{c.journey || "—"}</span>
            </div>
          </div>

          <SidebarLabel className="mt-6">Atendimentos recentes</SidebarLabel>
          <div className="mt-2 space-y-2">
            {conversationsQ.data?.length === 0 && (
              <p className="text-xs" style={{ color: uniq.textFaint }}>
                Sem conversas anteriores.
              </p>
            )}
            {conversationsQ.data?.slice(0, 10).map((conv) => (
              <Link
                key={conv.id}
                href={`/inbox/${conv.id}`}
                className="block rounded-xl p-2 text-xs transition-colors hover:bg-white/5"
                style={cardStyle}
              >
                <div className="flex items-center gap-1.5">
                  <MessageSquare className="h-3 w-3" style={{ color: uniq.textFaint }} />
                  <span
                    className="rounded-full px-1.5 py-0.5 text-[9px]"
                    style={{ background: "var(--surface-2)", color: uniq.textDim }}
                  >
                    {conv.channel_type}
                  </span>
                  <span style={{ color: uniq.textFaint }}>{conv.status}</span>
                  <span className="ml-auto" style={{ color: uniq.textFaint }}>
                    {relativeTime(conv.last_message_at)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-1" style={{ color: uniq.textDim }}>
                  {conv.last_message_preview || "—"}
                </p>
              </Link>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-widest" style={{ color: uniq.textFaint }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ icon, label, value, link }: {
  icon?: React.ReactNode;
  label: string;
  value?: string | null;
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
          {value}
        </a>
      ) : (
        <div className="mt-0.5 text-sm" style={{ color: uniq.textPrimary }}>{value}</div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      className="rounded-xl p-3"
      style={cardStyle}
    >
      <div className="text-[10px] uppercase tracking-widest" style={{ color: uniq.textFaint }}>{label}</div>
      <div className="mt-1 text-sm font-medium" style={{ color: accent || uniq.textStrong }}>{value}</div>
    </div>
  );
}

function SidebarLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={"text-[10px] font-medium uppercase tracking-widest " + (className ?? "")}
      style={{ color: uniq.textFaint }}
    >
      {children}
    </div>
  );
}

function Avatar({ name, url, size = 36 }: { name: string; url?: string; size?: number }) {
  if (url) {
    /* eslint-disable-next-line @next/next/no-img-element */
    return <img src={url} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const initials = name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-full font-medium"
      style={{
        width: size, height: size,
        background: "rgba(0,212,106,0.1)",
        color: uniq.green,
        fontSize: size * 0.32,
      }}
    >
      {initials || "?"}
    </div>
  );
}
