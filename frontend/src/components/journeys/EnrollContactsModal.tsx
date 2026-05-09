"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { X, Loader2, UserPlus, AlertCircle, Check } from "lucide-react";
import { toast } from "sonner";
import { journeysApi } from "@/lib/api";

// EnrollContactsModal — interface manual de enrollment (Fase 2 do
// redesign). User cola lista de telefones (1 por linha) ou IDs e
// opcionalmente agenda pra rodar no futuro.
//
// Caso típico: "tenho 50 leads novos da feira de ontem, quero
// enrolá-los na jornada de aquecimento começando amanhã 9h".
//
// Backend resolve phones → contacts no workspace e cria
// JourneyEnrollment pendente. Worker dispara quando scheduled_at <= now.
export function EnrollContactsModal({
  journeyId,
  journeyName,
  onClose,
  onEnrolled,
}: {
  journeyId: string;
  journeyName: string;
  onClose: () => void;
  onEnrolled?: (count: number) => void;
}) {
  const [phonesText, setPhonesText] = useState("");
  const [scheduleNow, setScheduleNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState("");

  const phones = phonesText
    .split(/[\n,;]/)
    .map((p) => p.replace(/[^\d+]/g, "").trim())
    .filter((p) => p.length >= 8);

  const enrollMut = useMutation({
    mutationFn: () =>
      journeysApi.enroll(journeyId, {
        phones,
        scheduled_at:
          !scheduleNow && scheduledAt
            ? new Date(scheduledAt).toISOString()
            : undefined,
      }),
    onSuccess: (r) => {
      const data = r.data;
      const lines = [`${data.enrolled} contato${data.enrolled !== 1 ? "s" : ""} enrolado${data.enrolled !== 1 ? "s" : ""}`];
      if (data.duplicates > 0) lines.push(`${data.duplicates} já estava${data.duplicates > 1 ? "m" : ""} inscrito${data.duplicates > 1 ? "s" : ""}`);
      if (data.skipped.length > 0) lines.push(`${data.skipped.length} sem cadastro no CRM`);
      toast.success(lines.join(" · "));
      onEnrolled?.(data.enrolled);
      onClose();
    },
    onError: (e: any) =>
      toast.error(e?.response?.data?.error || "Falha ao enrolar contatos"),
  });

  const canSubmit = phones.length > 0 && !enrollMut.isPending && (scheduleNow || !!scheduledAt);

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{ background: "var(--surface-1)", border: "1px solid var(--surface-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-3 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--surface-border)" }}
        >
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              background: "rgba(0,212,106,0.12)",
              border: "1px solid rgba(0,212,106,0.30)",
              color: "var(--green)",
            }}
          >
            <UserPlus className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: "var(--text-1)" }}>
              Enrolar contatos
            </p>
            <p className="text-[10px] truncate" style={{ color: "var(--text-3)" }}>
              {journeyName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/5"
            style={{ color: "var(--text-3)" }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="block text-[11px] font-medium mb-1.5" style={{ color: "var(--text-2)" }}>
              Telefones (1 por linha)
            </label>
            <textarea
              value={phonesText}
              onChange={(e) => setPhonesText(e.target.value)}
              placeholder="5511999999999&#10;5521988888888&#10;5511777777777"
              rows={6}
              className="w-full px-3 py-2 rounded-lg outline-none resize-none font-mono text-xs"
              style={{
                background: "var(--surface-2)",
                border: "1px solid var(--surface-border)",
                color: "var(--text-1)",
              }}
            />
            <div className="flex items-center justify-between mt-1.5 text-[10px]">
              <span style={{ color: "var(--text-4)" }}>
                Aceita vírgula, ponto-e-vírgula ou quebra de linha como separador.
              </span>
              <span style={{ color: phones.length > 0 ? "var(--green)" : "var(--text-4)" }}>
                {phones.length} válido{phones.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          <div>
            <p className="block text-[11px] font-medium mb-2" style={{ color: "var(--text-2)" }}>
              Quando começar
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={scheduleNow}
                  onChange={() => setScheduleNow(true)}
                />
                <span className="text-xs" style={{ color: "var(--text-1)" }}>
                  Agora
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  checked={!scheduleNow}
                  onChange={() => setScheduleNow(false)}
                />
                <span className="text-xs" style={{ color: "var(--text-1)" }}>
                  Agendar pra
                </span>
                {!scheduleNow && (
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    className="text-xs px-2 py-1 rounded-md"
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--surface-border)",
                      color: "var(--text-1)",
                    }}
                  />
                )}
              </label>
            </div>
            <p className="text-[10px] mt-2" style={{ color: "var(--text-4)" }}>
              Hora interpretada no fuso do seu navegador. Worker checa a cada 60s.
            </p>
          </div>

          <div
            className="rounded-lg p-3 flex items-start gap-2"
            style={{
              background: "rgba(96,165,250,0.06)",
              border: "1px solid rgba(96,165,250,0.20)",
            }}
          >
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: "#60a5fa" }} />
            <p className="text-[11px]" style={{ color: "var(--text-2)" }}>
              Apenas telefones <b>já cadastrados como contato</b> no CRM serão enrolados. Telefones
              sem cadastro vão na lista de <em>skipped</em> no resultado. A jornada respeita a
              regra de re-entry — contatos que já estão num flow ativo são ignorados.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 px-5 py-3 flex-shrink-0"
          style={{ borderTop: "1px solid var(--surface-border)", background: "var(--surface-2)" }}
        >
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-lg"
            style={{ background: "var(--surface-3)", color: "var(--text-2)" }}
          >
            Cancelar
          </button>
          <button
            onClick={() => enrollMut.mutate()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40"
            style={{ background: "var(--green)", color: "var(--green-fg)" }}
          >
            {enrollMut.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            Enrolar {phones.length > 0 ? `(${phones.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
