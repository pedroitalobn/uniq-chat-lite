"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Megaphone, Route, ChevronDown, ChevronUp, Plus, ArrowRight,
} from "lucide-react";
import { campaignsApi, journeysApi } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import Link from "next/link";

interface CampaignJourneyPanelProps {
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

export default function CampaignJourneyPanel({ contactId }: CampaignJourneyPanelProps) {
  const { currentWorkspace } = useWorkspace();
  const wsId = currentWorkspace?.id ?? "";
  const [open, setOpen] = useState(false);

  const campaignsQ = useQuery({
    queryKey: ["campaigns", wsId],
    queryFn: () => campaignsApi.list(wsId).then((r) => {
      const data = r.data as any;
      return (data.items ?? data.data ?? []).slice(0, 5);
    }),
    enabled: !!wsId,
  });

  const journeysQ = useQuery({
    queryKey: ["journeys", wsId],
    queryFn: () => journeysApi.list(wsId).then((r) => {
      const data = r.data as any;
      return (data.items ?? data.data ?? []).slice(0, 5);
    }),
    enabled: !!wsId,
  });

  const campaigns = campaignsQ.data ?? [];
  const journeys = journeysQ.data ?? [];

  return (
    <GlassCard className="overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-4 text-left transition-colors hover:bg-white/[0.02]"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(37, 99, 235,0.08)", border: "1px solid rgba(37, 99, 235,0.15)" }}>
            <Megaphone className="w-3.5 h-3.5" style={{ color: "#2563EB" }} />
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--text-1)" }}>Campanhas & Jornadas</h3>
            <p className="text-[10px]" style={{ color: "var(--text-4)" }}>Engajamento e automação</p>
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
            <div className="px-4 pb-4">
              <div className="grid grid-cols-2 gap-3">
                {/* Campaigns */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Campanhas</span>
                    <Link
                      href="/campaigns/new"
                      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-all hover:brightness-110"
                      style={{ background: "rgba(37, 99, 235,0.08)", border: "1px solid rgba(37, 99, 235,0.15)", color: "#2563EB" }}
                    >
                      <Plus className="w-3 h-3" />
                      Nova
                    </Link>
                  </div>
                  {campaigns.length === 0 && (
                    <p className="text-[10px] py-2" style={{ color: "var(--text-4)" }}>Nenhuma campanha.</p>
                  )}
                  {campaigns.map((c: any) => (
                    <Link
                      key={c.id}
                      href={`/campaigns/${c.id}`}
                      className="flex items-center gap-2 p-2 rounded-lg transition-all hover:bg-white/[0.03]"
                      style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      <Megaphone className="w-3 h-3 flex-shrink-0" style={{ color: "#2563EB" }} />
                      <span className="text-[11px] truncate" style={{ color: "var(--text-1)" }}>{c.name}</span>
                    </Link>
                  ))}
                </div>

                {/* Journeys */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: "var(--text-4)" }}>Jornadas</span>
                    <Link
                      href="/journeys/new"
                      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md transition-all hover:brightness-110"
                      style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", color: "#f59e0b" }}
                    >
                      <Plus className="w-3 h-3" />
                      Nova
                    </Link>
                  </div>
                  {journeys.length === 0 && (
                    <p className="text-[10px] py-2" style={{ color: "var(--text-4)" }}>Nenhuma jornada.</p>
                  )}
                  {journeys.map((j: any) => (
                    <Link
                      key={j.id}
                      href={`/journeys/${j.id}`}
                      className="flex items-center gap-2 p-2 rounded-lg transition-all hover:bg-white/[0.03]"
                      style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)" }}
                    >
                      <Route className="w-3 h-3 flex-shrink-0" style={{ color: "#f59e0b" }} />
                      <span className="text-[11px] truncate" style={{ color: "var(--text-1)" }}>{j.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
