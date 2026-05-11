"use client";

// TimezonePicker — autocomplete por cidade que devolve IANA TZ.
//
// Por que substitui o select de IANA names? Antes o user via
// "America/Sao_Paulo (BRT, UTC-3)" e ficava perdido se a cidade dele
// não estava na lista (Orlando, Vitória, etc.). Agora ele digita
// "orlando" → match em alias de America/New_York → seleciona.
//
// UX: input com placeholder "Buscar cidade…", dropdown com 10 results
// ordenados por relevância. Cada item mostra cidade · país · GMT offset
// + hora atual local (ajuda confirmar a TZ certa).

import { useEffect, useRef, useState } from "react";
import { Globe, Search, Check, X } from "lucide-react";
import {
  TIMEZONE_CITIES,
  type TimezoneCity,
  searchTimezones,
  findTimezoneCity,
  formatTimeInTimezone,
  currentOffsetLabel,
  detectBrowserTimezone,
} from "@/lib/timezones";

export function TimezonePicker({
  value,
  onChange,
  placeholder = "Buscar cidade…",
  showCurrentTime = true,
  size = "md",
}: {
  /** IANA TZ atual (controlado). "" = vazio. */
  value: string;
  /** Callback com a IANA TZ selecionada. */
  onChange: (tz: string) => void;
  placeholder?: string;
  /** Mostra hora atual no item selecionado e nos resultados — ajuda
   *  o user confirmar visualmente que escolheu a TZ certa. */
  showCurrentTime?: boolean;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = value ? findTimezoneCity(value) : undefined;
  const results = open
    ? searchTimezones(query, 12)
    : [];

  // Click outside fecha. Sem isso o dropdown ficaria visível mesmo
  // depois do user clicar fora (irritante).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const select = (c: TimezoneCity) => {
    onChange(c.tz);
    setOpen(false);
    setQuery("");
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(results.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = results[highlight];
      if (c) select(c);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const inputPad = size === "sm" ? "py-1.5 text-xs" : "py-2 text-sm";

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger / input */}
      <div className="relative">
        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
          style={{ color: "var(--text-3)" }} />
        <input
          ref={inputRef}
          type="text"
          value={open ? query : (selected ? selected.city + (selected.country ? `, ${selected.country}` : "") : "")}
          placeholder={placeholder}
          onFocus={() => { setOpen(true); setQuery(""); setHighlight(0); }}
          onChange={(e) => { setQuery(e.target.value); setHighlight(0); if (!open) setOpen(true); }}
          onKeyDown={onKey}
          className={`w-full pl-9 pr-9 rounded-lg outline-none ${inputPad}`}
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--surface-border)",
            color: "var(--text-1)",
          }}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-white/5"
            style={{ color: "var(--text-3)" }}
            title="Limpar"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Subtitulo: hora atual + offset da TZ selecionada */}
      {selected && showCurrentTime && !open && (
        <p className="text-[10px] mt-1.5 flex items-center gap-1.5" style={{ color: "var(--text-3)" }}>
          <span className="font-mono">{currentOffsetLabel(selected.tz)}</span>
          <span>·</span>
          <span>agora: <span className="font-mono tabular-nums" style={{ color: "var(--text-2)" }}>{formatTimeInTimezone(selected.tz)}</span></span>
        </p>
      )}

      {/* Dropdown de resultados */}
      {open && (
        <div
          className="absolute z-50 left-0 right-0 mt-1 rounded-lg overflow-hidden shadow-xl"
          style={{
            background: "hsl(240 18% 6.5%)",
            border: "1px solid var(--surface-border)",
            maxHeight: 320,
            overflowY: "auto",
          }}
        >
          {!query && (
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider"
              style={{ color: "var(--text-3)", borderBottom: "1px solid var(--surface-border)" }}>
              <Search className="w-3 h-3 inline mr-1" />
              Digite cidade ou país (ex: Orlando, Buenos Aires, London)
            </div>
          )}
          {results.length === 0 ? (
            <div className="px-3 py-4 text-xs text-center" style={{ color: "var(--text-3)" }}>
              Nenhuma cidade encontrada. Tenta o nome em inglês.
            </div>
          ) : (
            results.map((c, i) => (
              <button
                key={c.tz + i}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => select(c)}
                className="w-full flex items-center gap-3 px-3 py-2 text-left transition-colors"
                style={{
                  background: highlight === i ? "rgba(0,212,106,0.08)" : "transparent",
                  borderBottom: i < results.length - 1 ? "1px solid var(--input)" : undefined,
                }}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--text-1)" }}>
                    {c.city}
                  </p>
                  <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
                    {c.country} · <span className="font-mono">{currentOffsetLabel(c.tz)}</span>
                  </p>
                </div>
                <span className="text-[10px] font-mono tabular-nums" style={{ color: "var(--text-2)" }}>
                  {formatTimeInTimezone(c.tz)}
                </span>
                {value === c.tz && (
                  <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--green)" }} />
                )}
              </button>
            ))
          )}
          {!query && (
            <button
              type="button"
              onClick={() => select({ tz: detectBrowserTimezone(), city: "Detectado", country: "Browser" })}
              className="w-full flex items-center gap-2 px-3 py-2 text-[11px] hover:bg-white/5"
              style={{ color: "var(--green)", borderTop: "1px solid var(--surface-border)" }}
            >
              <Globe className="w-3 h-3" />
              Usar fuso do meu navegador ({detectBrowserTimezone()})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
