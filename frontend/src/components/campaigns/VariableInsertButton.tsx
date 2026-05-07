"use client";

// VariableInsertButton — botão "+ Variável" que abre dropdown com as
// variáveis Liquid suportadas em campanhas. Insere `{{contact.X}}` na
// posição do cursor do textarea referenciado. Sem isso o user precisava
// decorar a sintaxe Liquid e digitar à mão.

import { useEffect, useRef, useState } from "react";
import { Braces, ChevronDown } from "lucide-react";

type VarDef = { token: string; label: string; example: string };

const CONTACT_VARS: VarDef[] = [
  { token: "{{contact.name}}",        label: "Nome completo",   example: "João da Silva" },
  { token: "{{contact.first_name}}",  label: "Primeiro nome",   example: "João" },
  { token: "{{contact.email}}",       label: "Email",           example: "joao@empresa.com" },
  { token: "{{contact.phone}}",       label: "Telefone",        example: "+55 11 98888-7777" },
  { token: "{{contact.tags}}",        label: "Tags (lista)",    example: "vip, comprador" },
];

const CUSTOM_HINT: VarDef = {
  token: "{{contact.custom_fields.SEU_CAMPO}}",
  label: "Campo customizado",
  example: "Use o nome do campo definido no CRM",
};

export function VariableInsertButton({
  textareaRef,
  value,
  onChange,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (v: string) => void;
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

  const insert = (token: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      onChange(value + token);
    } else {
      const start = ta.selectionStart ?? value.length;
      const end = ta.selectionEnd ?? value.length;
      const next = value.slice(0, start) + token + value.slice(end);
      onChange(next);
      // Recoloca cursor depois do token inserido.
      requestAnimationFrame(() => {
        ta.focus();
        const pos = start + token.length;
        ta.setSelectionRange(pos, pos);
      });
    }
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-medium px-2 py-1 rounded-md inline-flex items-center gap-1 transition"
        style={{ background: "rgba(99,102,241,0.1)", color: "#a5b4fc", border: "1px solid rgba(99,102,241,0.2)" }}
        title="Inserir variável de contato"
      >
        <Braces className="w-3 h-3" />
        Inserir variável
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-lg overflow-hidden uniq-fade-in"
          style={{
            width: 280,
            background: "var(--surface-1)",
            border: "1px solid var(--surface-border)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          <div className="px-3 py-2 text-[10px] uppercase font-semibold tracking-wider"
            style={{ color: "var(--text-3)", borderBottom: "1px solid var(--surface-border)" }}>
            Contato
          </div>
          <div className="py-1 max-h-72 overflow-y-auto">
            {CONTACT_VARS.map((v) => (
              <button
                key={v.token}
                type="button"
                onClick={() => insert(v.token)}
                className="w-full text-left px-3 py-2 hover:bg-white/5 transition"
              >
                <div className="text-xs font-medium" style={{ color: "var(--text-1)" }}>{v.label}</div>
                <div className="text-[10px] font-mono" style={{ color: "#a5b4fc" }}>{v.token}</div>
                <div className="text-[10px]" style={{ color: "var(--text-3)" }}>ex: {v.example}</div>
              </button>
            ))}
            <div className="px-3 py-2 border-t" style={{ borderColor: "var(--surface-border)" }}>
              <button
                type="button"
                onClick={() => insert(CUSTOM_HINT.token)}
                className="w-full text-left"
              >
                <div className="text-xs font-medium" style={{ color: "var(--text-1)" }}>{CUSTOM_HINT.label}</div>
                <div className="text-[10px] font-mono" style={{ color: "#a5b4fc" }}>{CUSTOM_HINT.token}</div>
                <div className="text-[10px]" style={{ color: "var(--text-3)" }}>{CUSTOM_HINT.example}</div>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
