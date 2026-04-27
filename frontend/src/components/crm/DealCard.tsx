"use client";

import Link from "next/link";
import { Calendar, Building2, User as UserIcon, TrendingUp } from "lucide-react";
import { formatCurrency, relativeTime, uniq } from "./tokens";

export interface DealCardData {
  id: string;
  title: string;
  value: number;
  currency: string;
  probability?: number | null;
  expected_close_date?: string | null;
  contact?: { id: string; name: string; avatar_url?: string } | null;
  company?: { id: string; name: string; logo_url?: string } | null;
  owner?: { id: string; name: string; email: string } | null;
  stage_change_at?: string | null;
  priority?: string;
}

const PRIORITY_DOT: Record<string, string> = {
  low: "#6b7280",
  normal: "#3b82f6",
  high: "#f59e0b",
  urgent: "#ef4444",
};

export function DealCard({ deal, isDragging = false }: { deal: DealCardData; isDragging?: boolean }) {
  const hasStagnated =
    deal.stage_change_at && Date.now() - new Date(deal.stage_change_at).getTime() > 7 * 86400_000;

  return (
    <Link
      href={`/crm/deals/${deal.id}`}
      className="block rounded-xl p-3 transition-all"
      style={{
        background: isDragging ? "rgba(0,212,106,0.08)" : uniq.panel,
        border: `1px solid ${isDragging ? uniq.greenBorder : uniq.borderFaint}`,
        boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.35)" : undefined,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4
          className="line-clamp-2 text-sm font-medium leading-tight"
          style={{ color: uniq.textPrimary }}
        >
          {deal.title}
        </h4>
        {deal.priority && (
          <span
            className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full"
            style={{ background: PRIORITY_DOT[deal.priority] ?? PRIORITY_DOT.normal }}
            title={deal.priority}
          />
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: uniq.green }}>
        {formatCurrency(deal.value, deal.currency)}
        {typeof deal.probability === "number" && deal.probability > 0 && (
          <span className="flex items-center gap-0.5 text-[10px] font-normal" style={{ color: uniq.textFaint }}>
            <TrendingUp className="h-2.5 w-2.5" /> {deal.probability}%
          </span>
        )}
      </div>

      <div className="mt-2 space-y-1 text-xs" style={{ color: uniq.textDim }}>
        {deal.contact && (
          <div className="flex items-center gap-1.5">
            <UserIcon className="h-3 w-3 flex-shrink-0" style={{ color: uniq.textFaint }} />
            <span className="truncate">{deal.contact.name}</span>
          </div>
        )}
        {deal.company && (
          <div className="flex items-center gap-1.5">
            <Building2 className="h-3 w-3 flex-shrink-0" style={{ color: uniq.textFaint }} />
            <span className="truncate">{deal.company.name}</span>
          </div>
        )}
        {deal.expected_close_date && (
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3 flex-shrink-0" style={{ color: uniq.textFaint }} />
            <span className="truncate">
              {new Date(deal.expected_close_date).toLocaleDateString("pt-BR")}
            </span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between border-t pt-2 text-[10px]" style={{ borderColor: uniq.borderFaint, color: uniq.textFaint }}>
        <span>{deal.owner?.name ? deal.owner.name.split(" ")[0] : "Sem dono"}</span>
        <span className={hasStagnated ? "text-amber-500/80" : ""}>
          {deal.stage_change_at ? relativeTime(deal.stage_change_at) : ""}
        </span>
      </div>
    </Link>
  );
}
