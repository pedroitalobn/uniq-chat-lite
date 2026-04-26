"use client";

// Builder simples de botões interativos pro WhatsApp.
// Suporta até 3 botões por mensagem (limite do protocolo). Tipos:
//   reply (quick reply) — retorna ID quando clicado
//   url                 — abre URL externa
//   call                — disca número
//   copy                — copia código pra clipboard
//
// Mantém o estado lá em cima (controlado), pra que a tela de envio
// (ConversationDetail / Campanha / Jornada) possa serializar pro
// payload da messagesApi.sendButtons quando o user clica em enviar.

import { ExternalLink, MessageCircle, Phone, Plus, Trash2, X, Copy as CopyIcon } from "lucide-react";

export type MessageButtonType = "reply" | "url" | "call" | "copy";

export interface MessageButton {
  id: string;
  text: string;
  type: MessageButtonType;
  url?: string;
  phone?: string;
  copy_code?: string;
}

const MAX_BUTTONS = 3;

const TYPES: { id: MessageButtonType; label: string; icon: React.ElementType; color: string }[] = [
  { id: "reply", label: "Resposta",  icon: MessageCircle, color: "#00d46a" },
  { id: "url",   label: "Link",      icon: ExternalLink,  color: "#3b82f6" },
  { id: "call",  label: "Ligar",     icon: Phone,         color: "#a78bfa" },
  { id: "copy",  label: "Copiar",    icon: CopyIcon,      color: "#fbbf24" },
];

export function makeButton(): MessageButton {
  return { id: crypto.randomUUID(), text: "", type: "reply" };
}

export function MessageButtonsBuilder({
  buttons,
  onChange,
  onClose,
}: {
  buttons: MessageButton[];
  onChange: (next: MessageButton[]) => void;
  onClose?: () => void;
}) {
  const update = (id: string, patch: Partial<MessageButton>) => {
    onChange(buttons.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };
  const remove = (id: string) => onChange(buttons.filter((b) => b.id !== id));
  const add = () => {
    if (buttons.length >= MAX_BUTTONS) return;
    onChange([...buttons, makeButton()]);
  };

  return (
    <div className="rounded-xl p-3 space-y-2.5" style={{ background: "var(--surface-3)", border: "1px solid var(--surface-border)" }}>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold" style={{ color: "var(--text-1)" }}>Botões interativos</h3>
          <p className="text-[10px]" style={{ color: "var(--text-3)" }}>Até {MAX_BUTTONS} por mensagem</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-3)" }}
            title="Remover todos os botões"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {buttons.map((b, idx) => {
          const meta = TYPES.find((t) => t.id === b.type) ?? TYPES[0];
          const Icon = meta.icon;
          return (
            <div
              key={b.id}
              className="rounded-lg p-2.5 space-y-2"
              style={{ background: "var(--surface-2)", border: "1px solid var(--surface-border)" }}
            >
              {/* Type pills */}
              <div className="flex items-center gap-1 flex-wrap">
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "var(--text-3)" }}>
                  {idx + 1}.
                </span>
                {TYPES.map((t) => {
                  const active = b.type === t.id;
                  const TIcon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => update(b.id, { type: t.id })}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors"
                      style={{
                        background: active ? `${t.color}26` : "transparent",
                        color: active ? t.color : "var(--text-3)",
                        border: `1px solid ${active ? `${t.color}55` : "transparent"}`,
                      }}
                    >
                      <TIcon className="w-3 h-3" />
                      {t.label}
                    </button>
                  );
                })}
                <div className="flex-1" />
                <button
                  onClick={() => remove(b.id)}
                  className="p-1 rounded-md hover:bg-red-500/10"
                  style={{ color: "var(--text-3)" }}
                  title="Remover botão"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* Display text */}
              <div className="flex items-center gap-2">
                <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: meta.color }} />
                <input
                  value={b.text}
                  onChange={(e) => update(b.id, { text: e.target.value })}
                  placeholder="Texto do botão (até 20 caracteres)"
                  maxLength={20}
                  className="flex-1 text-xs bg-transparent outline-none border-b py-1"
                  style={{ color: "var(--text-1)", borderColor: "var(--surface-border)" }}
                />
              </div>

              {/* Type-specific field */}
              {b.type === "url" && (
                <input
                  value={b.url ?? ""}
                  onChange={(e) => update(b.id, { url: e.target.value })}
                  placeholder="https://exemplo.com"
                  className="w-full text-xs bg-transparent outline-none border-b py-1"
                  style={{ color: "var(--text-1)", borderColor: "var(--surface-border)" }}
                />
              )}
              {b.type === "call" && (
                <input
                  value={b.phone ?? ""}
                  onChange={(e) => update(b.id, { phone: e.target.value })}
                  placeholder="+55 11 99999-9999"
                  className="w-full text-xs bg-transparent outline-none border-b py-1"
                  style={{ color: "var(--text-1)", borderColor: "var(--surface-border)" }}
                />
              )}
              {b.type === "copy" && (
                <input
                  value={b.copy_code ?? ""}
                  onChange={(e) => update(b.id, { copy_code: e.target.value })}
                  placeholder="Código a ser copiado"
                  className="w-full text-xs bg-transparent outline-none border-b py-1"
                  style={{ color: "var(--text-1)", borderColor: "var(--surface-border)" }}
                />
              )}
              {b.type === "reply" && (
                <input
                  value={b.id ?? ""}
                  onChange={(e) => update(b.id, { id: e.target.value || crypto.randomUUID() })}
                  placeholder="ID retornado quando clicado (opcional)"
                  className="w-full text-xs bg-transparent outline-none border-b py-1"
                  style={{ color: "var(--text-1)", borderColor: "var(--surface-border)" }}
                />
              )}
            </div>
          );
        })}
      </div>

      {buttons.length < MAX_BUTTONS && (
        <button
          onClick={add}
          className="flex items-center justify-center gap-1 w-full py-1.5 rounded-lg text-[11px] font-medium transition-colors"
          style={{ background: "rgba(0,212,106,0.08)", border: "1px dashed rgba(0,212,106,0.3)", color: "var(--green)" }}
        >
          <Plus className="w-3 h-3" />
          Adicionar botão ({buttons.length}/{MAX_BUTTONS})
        </button>
      )}
    </div>
  );
}

// Validação básica antes do envio. Retorna mensagem de erro ou null.
export function validateButtons(buttons: MessageButton[]): string | null {
  if (buttons.length === 0) return "Adicione pelo menos um botão.";
  for (const b of buttons) {
    if (!b.text.trim()) return "Todo botão precisa de texto.";
    if (b.type === "url" && !b.url?.trim()) return "Botão de link precisa de URL.";
    if (b.type === "call" && !b.phone?.trim()) return "Botão de ligar precisa de telefone.";
    if (b.type === "copy" && !b.copy_code?.trim()) return "Botão de copiar precisa de código.";
  }
  return null;
}
