"use client";

// VariableInsertButton — botão "+ Variável" que abre dropdown com as
// variáveis Liquid disponíveis pra essa campanha em particular.
// As variáveis são DINÂMICAS conforme a origem da audiência (CSV
// detecta colunas, CRM expõe campos do contato, "colar contatos" só
// expõe phone/name se o user usou o formato `<phone>,<nome>` por linha).

import { useEffect, useRef, useState } from "react";
import { Braces, ChevronDown } from "lucide-react";

type VarDef = { token: string; label: string; example?: string };
type VarGroup = { title: string; vars: VarDef[] };

// Catálogo de campos CRM expostos pra campanhas que disparam por
// segmentos CRM. Espelha o que o backend templatesvc devolve em
// BuildCampaignLiquidVars (campaigns_waba_helpers.go).
const CRM_VARS: VarDef[] = [
  { token: "{{contact.name}}",        label: "Nome completo",   example: "João da Silva" },
  { token: "{{contact.first_name}}",  label: "Primeiro nome",   example: "João" },
  { token: "{{contact.last_name}}",   label: "Sobrenome",       example: "Silva" },
  { token: "{{contact.email}}",       label: "Email",           example: "joao@empresa.com" },
  { token: "{{contact.phone}}",       label: "Telefone",        example: "+55 11 98888-7777" },
  { token: "{{contact.company}}",     label: "Empresa",         example: "Uniq" },
  { token: "{{contact.job_title}}",   label: "Cargo",           example: "Diretor de Vendas" },
  { token: "{{contact.city}}",        label: "Cidade",          example: "São Paulo" },
  { token: "{{contact.state}}",       label: "Estado",          example: "SP" },
  { token: "{{contact.country}}",     label: "País",            example: "BR" },
  { token: "{{contact.instagram}}",   label: "Instagram",       example: "@joao" },
  { token: "{{contact.linkedin}}",    label: "LinkedIn",        example: "linkedin.com/in/joao" },
  { token: "{{contact.tags}}",        label: "Tags (lista)",    example: "vip, comprador" },
  { token: "{{contact.funnel}}",      label: "Funil",           example: "Vendas" },
  { token: "{{contact.stage}}",       label: "Estágio do funil", example: "Proposta" },
  { token: "{{contact.owner_name}}",  label: "Owner",           example: "Maria (vendas)" },
];

const CRM_CUSTOM_HINT: VarDef = {
  token: "{{contact.custom_fields.SEU_CAMPO}}",
  label: "Campo customizado",
  example: "Use o nome do campo definido no CRM",
};

const DATE_VARS: VarDef[] = [
  { token: "{{date}}", label: "Data atual",    example: "21-05-2026" },
  { token: "{{time}}", label: "Hora atual",    example: "14:32 UTC" },
  { token: "{{now}}",  label: "Timestamp ISO", example: "2026-05-21T14:32:00Z" },
];

export type AudienceSource = "crm" | "csv" | "contacts" | "groups" | "followers" | "following" | "other";

export function VariableInsertButton({
  textareaRef,
  value,
  onChange,
  source = "crm",
  csvColumns = [],
  contactsHaveName = false,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
  /** Origem da audiência — define quais variáveis ficam disponíveis. */
  source?: AudienceSource;
  /** Colunas detectadas no CSV (lowercased). Só usadas quando source="csv". */
  csvColumns?: string[];
  /** Para source="contacts": true se o user colou em formato `<phone>,<nome>` (parsed name disponível). */
  contactsHaveName?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Monta a lista de grupos conforme a origem da audiência.
  const groups: VarGroup[] = (() => {
    const out: VarGroup[] = [];
    if (source === "crm") {
      out.push({ title: "Contato (CRM)", vars: CRM_VARS });
      out.push({ title: "Campo customizado", vars: [CRM_CUSTOM_HINT] });
    } else if (source === "csv") {
      const csvVars: VarDef[] = [];
      // O backend sempre tem phone/name normalizado mesmo quando vem
      // de CSV. Mostramos primeiro pra UX.
      csvVars.push({ token: "{{contact.phone}}", label: "Telefone (phone)", example: "+55 11 98888-7777" });
      csvVars.push({ token: "{{contact.name}}",  label: "Nome (name)",     example: "João Silva" });
      for (const col of csvColumns) {
        if (!col) continue;
        csvVars.push({ token: `{{csv.${col}}}`, label: `Coluna “${col}”`, example: `valor da coluna ${col}` });
      }
      out.push({
        title: csvColumns.length > 0
          ? `CSV — ${csvColumns.length + 2} coluna(s) detectada(s)`
          : "CSV — colunas padrão",
        vars: csvVars,
      });
    } else if (source === "contacts") {
      const vars: VarDef[] = [{ token: "{{contact.phone}}", label: "Telefone", example: "+55 11 98888-7777" }];
      if (contactsHaveName) {
        vars.push({ token: "{{contact.name}}", label: "Nome (do colado)", example: "João Silva" });
      }
      out.push({
        title: contactsHaveName ? "Contatos colados" : "Contatos colados (apenas telefone)",
        vars,
      });
    } else if (source === "groups" || source === "followers" || source === "following") {
      out.push({
        title: source === "groups" ? "Grupos" : "Lista do Instagram",
        vars: [{ token: "{{contact.phone}}", label: "Identificador", example: "JID/handle" }],
      });
    }
    out.push({ title: "Data e hora", vars: DATE_VARS });
    return out;
  })();

  const insert = (token: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      onChange(value + token);
    } else {
      const start = ta.selectionStart ?? value.length;
      const end = ta.selectionEnd ?? value.length;
      const next = value.slice(0, start) + token + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
      });
    }
    setOpen(false);
  };

  // Quando não há nenhuma variável significativa disponível (caso
  // dos contatos só-numéricos sem nome), o botão fica desabilitado
  // com tooltip explicando.
  const hasAny = groups.some((g) => g.vars.length > 0);
  if (!hasAny) {
    return (
      <button
        type="button"
        disabled
        className="text-[11px] font-medium px-2 py-1 rounded-md inline-flex items-center gap-1 opacity-50 cursor-not-allowed"
        style={{ background: "rgba(99,102,241,0.06)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.12)" }}
        title="Sem variáveis disponíveis nesta origem de audiência"
      >
        <Braces className="w-3 h-3" /> Sem variáveis
      </button>
    );
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-medium px-2 py-1 rounded-md inline-flex items-center gap-1 transition"
        style={{ background: "rgba(99,102,241,0.1)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.2)" }}
        title="Inserir variável"
      >
        <Braces className="w-3 h-3" />
        Inserir variável
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden uniq-fade-in"
          style={{
            width: 320,
            background: "var(--surface-1)",
            border: "1px solid var(--surface-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div className="max-h-80 overflow-y-auto">
            {groups.map((g) => (
              <div key={g.title}>
                <div
                  className="px-3 py-2 text-[10px] uppercase font-semibold tracking-wider"
                  style={{ color: "var(--text-3)", borderBottom: "1px solid var(--surface-border)" }}
                >
                  {g.title}
                </div>
                <div className="py-1">
                  {g.vars.map((v) => (
                    <button
                      key={v.token}
                      type="button"
                      onClick={() => insert(v.token)}
                      className="w-full text-left px-3 py-2 hover:bg-white/5 transition"
                    >
                      <div className="text-xs font-medium" style={{ color: "var(--text-1)" }}>{v.label}</div>
                      <div className="text-[10px] font-mono" style={{ color: "#a5b4fc" }}>{v.token}</div>
                      {v.example && (
                        <div className="text-[10px]" style={{ color: "var(--text-3)" }}>ex: {v.example}</div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
