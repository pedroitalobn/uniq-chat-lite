"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

// Cabeçalho compartilhado das páginas de gestão da inbox (Filas / Equipes /
// Departamentos / Respostas Rápidas). Garante consistência visual com o
// tema dark do app e expõe o link de "voltar para o inbox" — sem ele o
// usuário ficava preso na página de configuração depois de entrar via
// kebab menu.
export function InboxSettingsHeader({
  title, description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header
      className="space-y-3"
      style={{ color: "var(--text-1)" }}
    >
      <Link
        href="/inbox"
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--border-subtle)",
          color: "var(--text-3)",
          width: "fit-content",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0,212,106,0.08)";
          e.currentTarget.style.borderColor = "rgba(0,212,106,0.22)";
          e.currentTarget.style.color = "#00d46a";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
          e.currentTarget.style.color = "var(--text-3)";
        }}
      >
        <ArrowLeft className="h-3 w-3" />
        Voltar ao inbox
      </Link>
      <div>
        <h1 className="text-2xl font-medium" style={{ color: "var(--text-1)" }}>
          {title}
        </h1>
        {description && (
          <p className="text-sm mt-1" style={{ color: "var(--text-3)" }}>
            {description}
          </p>
        )}
      </div>
    </header>
  );
}
