"use client";

import Link from "next/link";
import { AlertTriangle, Calendar, Building2, TrendingUp } from "lucide-react";
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

const PRIORITY_COLOR: Record<string, string> = {
  low: "#6b7280",
  normal: "#3b82f6",
  high: "#f59e0b",
  urgent: "#ef4444",
};

const PRIORITY_LABEL: Record<string, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

const AVATAR_COLORS = ["#7c3aed", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function ContactAvatar({ name, size = 22 }: { name: string; size?: number }) {
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
  return (
    <span
      className="flex-shrink-0 flex items-center justify-center rounded-full text-[9px] font-bold"
      style={{
        width: size, height: size,
        background: `${color}22`,
        border: `1px solid ${color}44`,
        color,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function DealCard({ deal, isDragging = false }: { deal: DealCardData; isDragging?: boolean }) {
  const hasStagnated =
    deal.stage_change_at && Date.now() - new Date(deal.stage_change_at).getTime() > 7 * 86400_000;
  const priorityColor = PRIORITY_COLOR[deal.priority ?? "normal"] ?? PRIORITY_COLOR.normal;
  const isOverdue = deal.expected_close_date && new Date(deal.expected_close_date) < new Date();
  const prob = typeof deal.probability === "number" ? deal.probability : null;
  const circumference = 2 * Math.PI * 10;

  return (
    <Link
      href={`/crm/deals/${deal.id}`}
      className="group block rounded-xl overflow-hidden transition-all hover:scale-[1.01]"
      style={{
        background: isDragging ? "rgba(0,212,106,0.08)" : uniq.panel,
        border: `1px solid ${isDragging ? uniq.greenBorder : uniq.borderFaint}`,
        borderLeft: `3px solid ${priorityColor}80`,
        boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.35)" : undefined,
      }}
    >
      <div className="p-3">
        {/* Title row + priority badge */}
        <div className="flex items-start gap-2 mb-2">
          <h4 className="flex-1 line-clamp-2 text-sm font-medium leading-tight" style={{ color: uniq.textPrimary }}>
            {deal.title}
          </h4>
          {deal.priority && deal.priority !== "normal" && (
            <span
              className="flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold"
              style={{ background: `${priorityColor}18`, color: priorityColor, border: `1px solid ${priorityColor}30` }}
            >
              {PRIORITY_LABEL[deal.priority]}
            </span>
          )}
        </div>

        {/* Value + probability ring */}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-semibold" style={{ color: uniq.green }}>
            {formatCurrency(deal.value, deal.currency)}
          </span>
          {prob !== null && prob > 0 && (
            <span className="flex items-center gap-1 ml-auto">
              <svg width="26" height="26" viewBox="0 0 26 26" className="flex-shrink-0 -rotate-90">
                <circle cx="13" cy="13" r="10" fill="none" stroke="var(--border-default)" strokeWidth="2.5" />
                <circle
                  cx="13" cy="13" r="10" fill="none"
                  stroke={prob >= 70 ? "#10b981" : prob >= 40 ? "#f59e0b" : "#ef4444"}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - prob / 100)}
                />
              </svg>
              <span className="text-[10px] font-medium" style={{ color: uniq.textFaint }}>
                {prob}%
              </span>
            </span>
          )}
        </div>

        {/* Contact + company */}
        <div className="space-y-1 mb-2">
          {deal.contact && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: uniq.textDim }}>
              <ContactAvatar name={deal.contact.name} />
              <span className="truncate">{deal.contact.name}</span>
            </div>
          )}
          {deal.company && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: uniq.textDim }}>
              <Building2 className="h-3 w-3 flex-shrink-0" style={{ color: uniq.textFaint }} />
              <span className="truncate">{deal.company.name}</span>
            </div>
          )}
          {deal.expected_close_date && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: isOverdue ? "#ef4444" : uniq.textDim }}>
              <Calendar className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">
                {new Date(deal.expected_close_date).toLocaleDateString("pt-BR")}
                {isOverdue && <span className="ml-1 text-[10px]">• vencido</span>}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between border-t pt-2 text-[10px]"
          style={{ borderColor: uniq.borderFaint, color: uniq.textFaint }}
        >
          <span>{deal.owner?.name ? deal.owner.name.split(" ")[0] : "Sem dono"}</span>
          <span className="flex items-center gap-1" style={{ color: hasStagnated ? "#f59e0b" : uniq.textFaint }}>
            {hasStagnated && <AlertTriangle className="w-2.5 h-2.5" />}
            {deal.stage_change_at ? relativeTime(deal.stage_change_at) : ""}
          </span>
        </div>
      </div>
    </Link>
  );
}
