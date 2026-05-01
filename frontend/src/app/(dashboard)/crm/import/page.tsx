"use client";

// CRM Import — bulk import via CSV pra Contatos / Empresas / Deals.
// 1 file picker por entidade, mostra hint das colunas, retorna stats.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, Loader2, CheckCircle2, AlertCircle, FileText, Building2, Briefcase, Contact as ContactIcon } from "lucide-react";
import { toast } from "sonner";
import { crmImportApi } from "@/lib/api";

type Stat = { created: number; updated: number; skipped: number; errors?: string[] };

type Entity = "contacts" | "companies" | "deals";

const HINTS: Record<Entity, { title: string; cols: string[]; icon: typeof ContactIcon; color: string }> = {
  contacts:  { title: "Contatos",  icon: ContactIcon, color: "var(--green)",
               cols: ["phone (obrigatório)", "name", "email", "funnel", "stage", "tags (vírgula)", "company"] },
  companies: { title: "Empresas",  icon: Building2,   color: "#60a5fa",
               cols: ["name (obrigatório)", "website", "phone", "email", "industry", "size"] },
  deals:     { title: "Deals",     icon: Briefcase,   color: "#a78bfa",
               cols: ["title (obrigatório)", "contact_phone (obrigatório)", "value", "currency", "description"] },
};

export default function CRMImportPage() {
  return (
    <div className="px-4 sm:px-6 py-6 lg:py-8 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-medium" style={{ color: "var(--text-1)" }}>Importar CSV</h1>
          <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
            Bulk import de Contatos, Empresas e Deals. Idempotente — re-import atualiza ao invés de duplicar.
          </p>
        </div>

      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <ImportCard entity="contacts" />
        <ImportCard entity="companies" />
        <ImportCard entity="deals" />
      </div>

      <div className="rounded-xl p-4 flex items-start gap-3"
        style={{ background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.18)" }}>
        <FileText className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#60a5fa" }} />
        <div className="text-xs" style={{ color: "var(--text-2)" }}>
          <p className="font-medium mb-1" style={{ color: "var(--text-1)" }}>Formato do CSV</p>
          <p>Primeira linha = cabeçalho com nome das colunas (case-insensitive). UTF-8. Vírgula como separador. Tags separadas por vírgula no MESMO campo.</p>
        </div>
      </div>
    </div>
  );
}

function ImportCard({ entity }: { entity: Entity }) {
  const meta = HINTS[entity];
  const [file, setFile] = useState<File | null>(null);
  const [stats, setStats] = useState<Stat | null>(null);

  const mut = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("sem arquivo");
      const fn = entity === "contacts" ? crmImportApi.contacts
              : entity === "companies" ? crmImportApi.companies
              : crmImportApi.deals;
      return fn(file).then((r) => r.data as Stat);
    },
    onSuccess: (data) => {
      setStats(data);
      toast.success(`${data.created} criados, ${data.updated} atualizados`);
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error || "Erro ao importar";
      toast.error(msg);
    },
  });

  return (
    <div className="rounded-2xl p-4"
      style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center gap-2 mb-2">
        <meta.icon className="w-4 h-4" style={{ color: meta.color }} />
        <h3 className="text-sm font-medium" style={{ color: "var(--text-1)" }}>{meta.title}</h3>
      </div>
      <p className="text-[11px] mb-3" style={{ color: "var(--text-3)" }}>
        Colunas: {meta.cols.join(" · ")}
      </p>

      <label className="flex items-center justify-center gap-2 py-3 rounded-lg cursor-pointer text-xs font-medium transition-colors"
        style={{ background: "var(--surface-3)", color: "var(--text-2)" }}>
        {file ? file.name : "Escolher arquivo CSV"}
        <input type="file" accept=".csv,text/csv" className="hidden"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setStats(null); }} />
      </label>

      <button
        onClick={() => mut.mutate()}
        disabled={!file || mut.isPending}
        className="mt-2 w-full text-xs font-medium py-2 rounded-lg inline-flex items-center justify-center gap-1.5 disabled:opacity-40"
        style={{ background: meta.color, color: meta.color === "var(--green)" ? "var(--green-fg)" : "white" }}>
        {mut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        Importar
      </button>

      {stats && (
        <div className="mt-3 p-2 rounded-md text-[11px] space-y-0.5"
          style={{ background: "var(--green-soft)" }}>
          <p style={{ color: "var(--green)" }}><CheckCircle2 className="w-3 h-3 inline mr-1" /> {stats.created} criados</p>
          {stats.updated > 0 && <p style={{ color: "var(--text-2)" }}>{stats.updated} atualizados</p>}
          {stats.skipped > 0 && <p style={{ color: "var(--text-3)" }}>{stats.skipped} pulados</p>}
          {(stats.errors || []).length > 0 && (
            <p className="flex items-start gap-1" style={{ color: "#f87171" }}>
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" /> {stats.errors!.length} erros
            </p>
          )}
        </div>
      )}
    </div>
  );
}
