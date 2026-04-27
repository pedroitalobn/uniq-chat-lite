// CRM v2 design tokens — preservam a identidade Uniq.chat (tons HSL escuros,
// accent verde, cantos arredondados). Todos os componentes do CRM usam estes
// valores em inline-styles para evitar depender de tailwind classes custom.

export const uniq = {
  // Superfícies
  bg: "hsl(240 18% 6%)",
  bgElevated: "hsl(240 18% 7.5%)",
  panel: "var(--border-subtle)",
  hover: "var(--border-default)",

  // Bordas
  border: "hsl(240 12% 14%)",
  borderSoft: "hsl(240 12% 16%)",
  borderFaint: "var(--border-default)",

  // Texto
  textStrong: "hsl(240 15% 93%)",
  textPrimary: "hsl(240 15% 90%)",
  textMuted: "hsl(240 8% 52%)",
  textFaint: "hsl(240 8% 38%)",
  textDim: "hsl(240 8% 46%)",

  // Accent (verde Uniq)
  green: "#00d46a",
  greenBg: "rgba(0,212,106,0.08)",
  greenBgSoft: "rgba(0,212,106,0.04)",
  greenBorder: "rgba(0,212,106,0.25)",

  // Status de deal
  statusOpen: "#3b82f6",
  statusWon: "#10b981",
  statusLost: "#ef4444",
  statusArchived: "#6b7280",

  // Overlay
  backdrop: "rgba(0,0,0,0.6)",
} as const;

export const surface = (opts?: { elevated?: boolean }): React.CSSProperties => ({
  background: opts?.elevated ? uniq.bgElevated : uniq.bg,
  border: `1px solid ${uniq.borderSoft}`,
});

export const cardStyle: React.CSSProperties = {
  background: uniq.panel,
  border: `1px solid ${uniq.borderFaint}`,
};

export const buttonPrimary: React.CSSProperties = {
  background: uniq.green,
  color: "#03170a",
};

export const buttonGhost: React.CSSProperties = {
  background: "var(--border-default)",
  border: `1px solid ${uniq.borderFaint}`,
  color: uniq.textDim,
};

export function formatCurrency(valueMinor: number, currency = "BRL"): string {
  const major = valueMinor / 100;
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(major);
  } catch {
    return `R$ ${major.toFixed(0)}`;
  }
}

export function relativeTime(iso?: string): string {
  if (!iso) return "";
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return "agora";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}min`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function statusColor(status: string): string {
  switch (status) {
    case "won": return uniq.statusWon;
    case "lost": return uniq.statusLost;
    case "archived": return uniq.statusArchived;
    default: return uniq.statusOpen;
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "won": return "Ganho";
    case "lost": return "Perdido";
    case "archived": return "Arquivado";
    default: return "Aberto";
  }
}
