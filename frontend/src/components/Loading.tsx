"use client";

export function LoadingScreen({ message = "Carregando..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="relative w-10 h-10">
        <div className="absolute inset-0 rounded-full border-2 opacity-20" style={{ borderColor: "var(--green)" }} />
        <div className="absolute inset-0 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--green)" }} />
      </div>
      <span className="text-sm" style={{ color: "var(--text-3)" }}>{message}</span>
    </div>
  );
}

export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-6 h-6",
    lg: "w-8 h-8",
  };
  return (
    <div className={`relative ${sizeClasses[size]}`}>
      <div className="absolute inset-0 rounded-full border-2 opacity-20" style={{ borderColor: "var(--green)" }} />
      <div className="absolute inset-0 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "var(--green)" }} />
    </div>
  );
}

export function LoadingCard() {
  return (
    <div className="animate-pulse rounded-xl" style={{ background: "var(--surface-3)" }}>
      <div className="h-full w-full" />
    </div>
  );
}

export function LoadingList({ count = 3, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-xl" style={{ background: "var(--surface-3)", height: "60px" }} />
      ))}
    </div>
  );
}
