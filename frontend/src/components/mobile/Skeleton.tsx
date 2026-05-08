"use client";

// Skeleton — placeholder padronizado pra estados de loading. Substitui
// "Carregando..." textual por shimmer animado, padrão que os apps
// nativos usam pra dar percepção de velocidade (mesmo que a request
// não esteja mais rápida).
//
// Composto: <Skeleton.Line />, <Skeleton.Avatar />, <Skeleton.Card />
// pra montar layouts que espelham o conteúdo real.

import { cn } from "@/lib/utils";

const baseClass = "animate-pulse rounded-md";
const baseStyle: React.CSSProperties = {
  background: "linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.04) 100%)",
  backgroundSize: "200% 100%",
  animation: "skeleton-shimmer 1.4s ease-in-out infinite",
};

export function SkeletonLine({
  width = "100%",
  height = 12,
  className,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) {
  return (
    <div className={cn(baseClass, className)} style={{ ...baseStyle, width, height }} />
  );
}

export function SkeletonAvatar({
  size = 36,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(baseClass, className)}
      style={{ ...baseStyle, width: size, height: size, borderRadius: "50%" }}
    />
  );
}

export function SkeletonCard({ rows = 3, withAvatar = true }: { rows?: number; withAvatar?: boolean }) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-2xl"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
      {withAvatar && <SkeletonAvatar />}
      <div className="flex-1 space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonLine key={i} width={i === 0 ? "60%" : i === rows - 1 ? "30%" : "85%"} />
        ))}
      </div>
    </div>
  );
}

export function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

// Aglutina tudo em namespace pra import único.
export const Skeleton = {
  Line: SkeletonLine,
  Avatar: SkeletonAvatar,
  Card: SkeletonCard,
  List: SkeletonList,
};
