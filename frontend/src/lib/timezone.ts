// Helpers de conversão entre datetime-local (string sem TZ) e UTC ISO,
// considerando que o usuário escolheu o horário "naquele TZ específico"
// — não no TZ do navegador.
//
// Por que importa: <input type="datetime-local"> devolve string como
// "2026-05-10T09:00" (sem TZ). new Date(str).toISOString() interpreta
// isso como TZ DO BROWSER. Quando o user está num TZ diferente do
// workspace (ex: morando em Lisboa, agendando campanha pra time de
// São Paulo), a conversão direta sai errada.

// zonedTimeToUTC — recebe um string datetime-local + TZ alvo, devolve
// a Date em UTC equivalente. Funciona usando Intl.DateTimeFormat pra
// derivar o offset do TZ no momento exato (cobre DST automaticamente).
//
// Ex: zonedTimeToUTC("2026-05-10T09:00", "America/Sao_Paulo")
//     → Date de 2026-05-10T12:00:00.000Z (BRT é UTC-3)
export function zonedTimeToUTC(dateLocalStr: string, timezone: string): Date {
  // Parse manual pra evitar interpretação de TZ do browser. Se o
  // string vier com Z ou offset, é caso aberrante — devolve direto.
  if (dateLocalStr.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(dateLocalStr)) {
    return new Date(dateLocalStr);
  }

  // Trata o input como se fosse UTC pra obter o "wall clock" desejado.
  const asUTC = new Date(dateLocalStr + "Z");
  if (isNaN(asUTC.getTime())) return new Date(NaN);

  // Calcula o offset do TZ alvo nesse momento.
  const offsetMs = getTimezoneOffsetMs(asUTC, timezone);

  // O wall-clock que queremos é asUTC; pra ele acontecer NESSE TZ,
  // o tempo UTC real precisa ser asUTC - offset.
  return new Date(asUTC.getTime() - offsetMs);
}

// utcToZonedDateLocal — inverso. Recebe Date em UTC e devolve string
// no formato datetime-local (YYYY-MM-DDTHH:mm) representando a hora
// LOCAL no TZ alvo. Útil pra hidratar input quando edita campanha.
export function utcToZonedDateLocal(d: Date, timezone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(d)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  // en-CA usa YYYY-MM-DD; alguns nodes podem ainda renderizar hour como "24"
  // pra meia-noite — normaliza pra "00".
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

// getTimezoneOffsetMs — diferença em ms entre o TZ alvo e UTC no
// instante d (cobre DST). Retorna positivo pra TZs à frente de UTC,
// negativo pra TZs atrás. Ex: São Paulo = -10800000 (-3h).
function getTimezoneOffsetMs(d: Date, timezone: string): number {
  const tzString = d.toLocaleString("en-US", { timeZone: timezone });
  const utcString = d.toLocaleString("en-US", { timeZone: "UTC" });
  return new Date(tzString).getTime() - new Date(utcString).getTime();
}

// detectBrowserTimezone — fallback quando o workspace não expõe TZ.
export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

// formatTimezoneLabel — devolve string compacta tipo "America/Sao_Paulo (UTC-3)"
// pra exibir no UI do user na hora de agendar.
export function formatTimezoneLabel(timezone: string, at: Date = new Date()): string {
  const offsetMs = getTimezoneOffsetMs(at, timezone);
  const offsetMin = offsetMs / 60000;
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const offsetStr = m === 0 ? `${sign}${h}` : `${sign}${h}:${String(m).padStart(2, "0")}`;
  return `${timezone} (UTC${offsetStr})`;
}
