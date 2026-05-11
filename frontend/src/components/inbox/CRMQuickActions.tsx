"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Briefcase, Building2, Tag, CheckSquare, CalendarDays, Users,
  UserCog, ChevronDown, ChevronUp, ArrowRight,
} from "lucide-react";
import { crmApi, dealsApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import Link from "next/link";

interface CRMQuickActionsProps {
  conversationId: string;
  contactId?: string | null;
}

function GlassCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {children}
    </div>
  );
}

export default function CRMQuickActions({ contactId }: CRMQuickActionsProps) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";
  const [open, setOpen] = useState(true);

  const contactQ = useQuery({
    queryKey: ["inbox-contact-crm", contactId],
    queryFn: () => crmApi.getContact(contactId!).then((r) => r.data as any),
    enabled: !!contactId,
  });

  const dealsQ = useQuery({
    queryKey: ["inbox-contact-deals", wsId, contactId],
    queryFn: () =>
      dealsApi.list(wsId, { contact_id: contactId, status: "open", limit: 5 }).then(
        (r) => (r.data as any)?.items ?? []
      ),
    enabled: !!wsId && !!contactId,
  });

  const contact = contactQ.data;
  const deals = dealsQ.data ?? [];

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)" }}>
            <Briefcase className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-1)" }}>CRM</h3>
            <p className="text-[10px]" style={{ color: "var(--text-4)" }}>Ações e dados do contato</p>
          </div>
        </div>
        {open ? <ChevronUp className="w-4 h-4" style={{ color: "var(--text-3)" }} /> : <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {/* CRM Info Cards */}
              {contactId && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Funil</p>
                    <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: "var(--text-1)" }}>{contact?.funnel || "—"}</p>
                    <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>{contact?.stage || ""}</p>
                  </div>
                  <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Deals</p>
                    <p className="text-xs font-semibold mt-0.5" style={{ color: "var(--text-1)" }}>{deals.length}</p>
                    <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>{deals[0]?.title || ""}</p>
                  </div>
                  <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Tags</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {contact?.tags?.slice(0, 3).map((t: any) => (
                        <span key={t.id} className="text-[9px] px-1.5 py-0.5 rounded-md" style={{ background: `${t.color}15`, color: t.color, border: `1px solid ${t.color}30` }}>
                          {t.name}
                        </span>
                      )) || <span className="text-[10px]" style={{ color: "var(--text-3)" }}>—</span>}
                    </div>
                  </div>
                  <div className="rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <p className="text-[9px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Jornada</p>
                    <p className="text-xs font-semibold mt-0.5 truncate" style={{ color: "var(--text-1)" }}>{contact?.journey || "—"}</p>
                  </div>
                </div>
              )}

              {/* Quick Action Buttons */}
              <div>
                <label className="text-[10px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-4)" }}>Ações rápidas</label>
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href={contactId ? `/crm/deals?contact_id=${contactId}` : "/crm/deals"}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
                    style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.15)", color: "#fbbf24" }}
                  >
                    <Briefcase className="w-3 h-3" />
                    Negociações
                    <ArrowRight className="w-3 h-3 ml-auto" />
                  </Link>
                  <Link
                    href={contactId ? `/crm/contacts/${contactId}` : "/crm/contacts"}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
                    style={{ background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.15)", color: "#38bdf8" }}
                  >
                    <UserCog className="w-3 h-3" />
                    Contato
                    <ArrowRight className="w-3 h-3 ml-auto" />
                  </Link>
                  <Link
                    href={contactId ? `/crm/contacts/${contactId}` : "/crm/contacts"}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
                    style={{ background: "rgba(0,212,106,0.08)", border: "1px solid rgba(0,212,106,0.15)", color: "#00d46a" }}
                  >
                    <Tag className="w-3 h-3" />
                    Tags
                    <ArrowRight className="w-3 h-3 ml-auto" />
                  </Link>
                  <Link
                    href="/crm/tasks"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
                    style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", color: "#f59e0b" }}
                  >
                    <CheckSquare className="w-3 h-3" />
                    Tarefas
                    <ArrowRight className="w-3 h-3 ml-auto" />
                  </Link>
                  <Link
                    href="/crm/meetings"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
                    style={{ background: "rgba(167,139,250,0.08)", border: "1px solid rgba(167,139,250,0.15)", color: "#a78bfa" }}
                  >
                    <CalendarDays className="w-3 h-3" />
                    Reuniões
                    <ArrowRight className="w-3 h-3 ml-auto" />
                  </Link>
                  <Link
                    href="/crm/segments"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-medium transition-all hover:brightness-110"
                    style={{ background: "rgba(225,48,108,0.08)", border: "1px solid rgba(225,48,108,0.15)", color: "#e1306c" }}
                  >
                    <Users className="w-3 h-3" />
                    Segmentos
                    <ArrowRight className="w-3 h-3 ml-auto" />
                  </Link>
                </div>
              </div>

              {/* Deals list */}
              {deals.length > 0 && (
                <div>
                  <label className="text-[10px] font-medium uppercase tracking-wider mb-2 block" style={{ color: "var(--text-4)" }}>Negociações abertas</label>
                  <div className="space-y-1.5">
                    {deals.map((d: any) => (
                      <Link
                        key={d.id}
                        href={`/crm/deals/${d.id}`}
                        className="flex items-center justify-between p-2.5 rounded-lg transition-all hover:bg-white/[0.03]"
                        style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium truncate" style={{ color: "var(--text-1)" }}>{d.title}</p>
                          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>{d.stage_name || d.stage || ""}</p>
                        </div>
                        {d.value > 0 && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md flex-shrink-0" style={{ background: "rgba(251,191,36,0.08)", color: "#fbbf24" }}>
                            {new Intl.NumberFormat("pt-BR", { style: "currency", currency: d.currency || "BRL" }).format(d.value)}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
