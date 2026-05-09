// timezones.ts — lista curada de cidades populares mapeadas pra IANA TZ.
//
// Por que curar em vez de listar 400+ IANA names?
//   • IANA names ("America/Los_Angeles") nem sempre batem com cidade
//     que o user procura ("Orlando" → não existe; é America/New_York).
//   • Browsers expõem `Intl.supportedValuesOf("timeZone")` mas isso
//     dá centenas de zonas e o usuário se perde.
//   • Uma lista curada de ~150 cidades populares cobre 99% dos casos
//     reais (capitais + grandes mercados US/EU/LATAM/APAC).
//
// Search: bate em city, country e aliases (Spanish/Portuguese variants
// pra usuário BR/ES procurar "São Paulo" ou "Nueva York").

export interface TimezoneCity {
  /** IANA timezone (America/New_York, Europe/Paris, etc) */
  tz: string;
  /** Cidade primária */
  city: string;
  /** País (display) */
  country: string;
  /** Aliases adicionais pra busca: variações de língua, cidades agrupadas
   *  na mesma TZ ("Orlando" → America/New_York). */
  aliases?: string[];
}

export const TIMEZONE_CITIES: TimezoneCity[] = [
  // ── Brasil ───────────────────────────────────────────────────────
  { tz: "America/Sao_Paulo",     city: "São Paulo",      country: "Brasil",
    aliases: ["sao paulo", "sp", "brasilia", "rio de janeiro", "rio", "belo horizonte", "bh", "curitiba", "porto alegre", "florianopolis", "salvador", "vitoria"] },
  { tz: "America/Fortaleza",     city: "Fortaleza",      country: "Brasil",
    aliases: ["recife", "natal", "joao pessoa", "maceio", "aracaju", "teresina", "sao luis"] },
  { tz: "America/Manaus",        city: "Manaus",         country: "Brasil",
    aliases: ["amazonas", "porto velho", "campo grande", "cuiaba"] },
  { tz: "America/Belem",         city: "Belém",          country: "Brasil",
    aliases: ["para", "macapa"] },
  { tz: "America/Rio_Branco",    city: "Rio Branco",     country: "Brasil",
    aliases: ["acre"] },
  { tz: "America/Noronha",       city: "Fernando de Noronha", country: "Brasil" },

  // ── América do Norte ──────────────────────────────────────────────
  { tz: "America/New_York",      city: "New York",       country: "EUA",
    aliases: ["nyc", "manhattan", "nueva york", "boston", "miami", "orlando", "atlanta", "washington", "philadelphia", "tampa", "jacksonville", "charlotte"] },
  { tz: "America/Chicago",       city: "Chicago",        country: "EUA",
    aliases: ["dallas", "houston", "austin", "san antonio", "minneapolis", "kansas city", "memphis", "nashville", "new orleans", "milwaukee"] },
  { tz: "America/Denver",        city: "Denver",         country: "EUA",
    aliases: ["salt lake city", "albuquerque", "el paso"] },
  { tz: "America/Phoenix",       city: "Phoenix",        country: "EUA",
    aliases: ["arizona"] },
  { tz: "America/Los_Angeles",   city: "Los Angeles",    country: "EUA",
    aliases: ["la", "san francisco", "sf", "san diego", "seattle", "portland", "san jose", "sacramento", "las vegas", "california"] },
  { tz: "America/Anchorage",     city: "Anchorage",      country: "EUA (Alaska)" },
  { tz: "Pacific/Honolulu",      city: "Honolulu",       country: "EUA (Hawaii)",
    aliases: ["hawaii"] },
  { tz: "America/Toronto",       city: "Toronto",        country: "Canadá",
    aliases: ["ottawa", "montreal"] },
  { tz: "America/Vancouver",     city: "Vancouver",      country: "Canadá",
    aliases: ["calgary", "edmonton"] },
  { tz: "America/Mexico_City",   city: "Cidade do México", country: "México",
    aliases: ["mexico city", "guadalajara", "monterrey", "puebla", "cdmx"] },
  { tz: "America/Tijuana",       city: "Tijuana",        country: "México" },
  { tz: "America/Cancun",        city: "Cancún",         country: "México" },

  // ── América Latina ────────────────────────────────────────────────
  { tz: "America/Bogota",        city: "Bogotá",         country: "Colômbia",
    aliases: ["medellin", "cali", "barranquilla", "cartagena", "colombia"] },
  { tz: "America/Lima",          city: "Lima",           country: "Peru",
    aliases: ["arequipa", "cusco"] },
  { tz: "America/Caracas",       city: "Caracas",        country: "Venezuela",
    aliases: ["maracaibo", "valencia"] },
  { tz: "America/Santiago",      city: "Santiago",       country: "Chile",
    aliases: ["valparaiso", "concepcion"] },
  { tz: "America/Argentina/Buenos_Aires", city: "Buenos Aires", country: "Argentina",
    aliases: ["cordoba", "rosario", "mendoza", "argentina"] },
  { tz: "America/Montevideo",    city: "Montevidéu",     country: "Uruguai",
    aliases: ["uruguay", "uruguai"] },
  { tz: "America/Asuncion",      city: "Assunção",       country: "Paraguai",
    aliases: ["asuncion", "paraguay", "paraguai"] },
  { tz: "America/La_Paz",        city: "La Paz",         country: "Bolívia",
    aliases: ["santa cruz", "bolivia"] },
  { tz: "America/Guayaquil",     city: "Guayaquil",      country: "Equador",
    aliases: ["quito", "ecuador", "equador"] },
  { tz: "America/Panama",        city: "Cidade do Panamá", country: "Panamá",
    aliases: ["panama city", "panama"] },
  { tz: "America/Havana",        city: "Havana",         country: "Cuba" },
  { tz: "America/Santo_Domingo", city: "Santo Domingo",  country: "Rep. Dominicana" },
  { tz: "America/Puerto_Rico",   city: "San Juan",       country: "Porto Rico" },
  { tz: "America/Costa_Rica",    city: "San José",       country: "Costa Rica" },
  { tz: "America/Guatemala",     city: "Cidade da Guatemala", country: "Guatemala" },
  { tz: "America/El_Salvador",   city: "San Salvador",   country: "El Salvador" },

  // ── Europa ────────────────────────────────────────────────────────
  { tz: "Europe/London",         city: "Londres",        country: "Reino Unido",
    aliases: ["london", "uk", "manchester", "edinburgh", "liverpool", "dublin", "ireland"] },
  { tz: "Europe/Lisbon",         city: "Lisboa",         country: "Portugal",
    aliases: ["lisbon", "porto", "portugal"] },
  { tz: "Europe/Madrid",         city: "Madrid",         country: "Espanha",
    aliases: ["barcelona", "valencia", "seville", "spain", "espana"] },
  { tz: "Europe/Paris",          city: "Paris",          country: "França",
    aliases: ["france", "marseille", "lyon", "nice", "toulouse"] },
  { tz: "Europe/Berlin",         city: "Berlim",         country: "Alemanha",
    aliases: ["berlin", "munich", "frankfurt", "hamburg", "germany"] },
  { tz: "Europe/Rome",           city: "Roma",           country: "Itália",
    aliases: ["milan", "naples", "venice", "italy"] },
  { tz: "Europe/Amsterdam",      city: "Amsterdã",       country: "Holanda",
    aliases: ["amsterdam", "rotterdam", "netherlands"] },
  { tz: "Europe/Brussels",       city: "Bruxelas",       country: "Bélgica",
    aliases: ["brussels", "antwerp"] },
  { tz: "Europe/Zurich",         city: "Zurique",        country: "Suíça",
    aliases: ["zurich", "geneva", "switzerland"] },
  { tz: "Europe/Vienna",         city: "Viena",          country: "Áustria",
    aliases: ["vienna", "austria"] },
  { tz: "Europe/Stockholm",      city: "Estocolmo",      country: "Suécia",
    aliases: ["stockholm", "sweden"] },
  { tz: "Europe/Oslo",           city: "Oslo",           country: "Noruega" },
  { tz: "Europe/Copenhagen",     city: "Copenhague",     country: "Dinamarca",
    aliases: ["copenhagen"] },
  { tz: "Europe/Helsinki",       city: "Helsinque",      country: "Finlândia",
    aliases: ["helsinki"] },
  { tz: "Europe/Warsaw",         city: "Varsóvia",       country: "Polônia",
    aliases: ["warsaw", "krakow", "poland"] },
  { tz: "Europe/Athens",         city: "Atenas",         country: "Grécia",
    aliases: ["athens", "greece"] },
  { tz: "Europe/Istanbul",       city: "Istambul",       country: "Turquia",
    aliases: ["istanbul", "ankara"] },
  { tz: "Europe/Moscow",         city: "Moscou",         country: "Rússia",
    aliases: ["moscow", "saint petersburg"] },
  { tz: "Europe/Bucharest",      city: "Bucareste",      country: "Romênia" },
  { tz: "Europe/Prague",         city: "Praga",          country: "República Tcheca",
    aliases: ["prague"] },

  // ── África ────────────────────────────────────────────────────────
  { tz: "Africa/Lagos",          city: "Lagos",          country: "Nigéria",
    aliases: ["nigeria"] },
  { tz: "Africa/Cairo",          city: "Cairo",          country: "Egito",
    aliases: ["egypt"] },
  { tz: "Africa/Johannesburg",   city: "Joanesburgo",    country: "África do Sul",
    aliases: ["johannesburg", "cape town", "south africa"] },
  { tz: "Africa/Nairobi",        city: "Nairóbi",        country: "Quênia",
    aliases: ["nairobi", "kenya"] },
  { tz: "Africa/Casablanca",     city: "Casablanca",     country: "Marrocos",
    aliases: ["morocco"] },
  { tz: "Africa/Algiers",        city: "Argel",          country: "Argélia" },
  { tz: "Africa/Accra",          city: "Acra",           country: "Gana" },

  // ── Oriente Médio ────────────────────────────────────────────────
  { tz: "Asia/Dubai",            city: "Dubai",          country: "Emirados Árabes",
    aliases: ["abu dhabi", "uae"] },
  { tz: "Asia/Riyadh",           city: "Riade",          country: "Arábia Saudita",
    aliases: ["riyadh", "jeddah"] },
  { tz: "Asia/Tehran",           city: "Teerã",          country: "Irã",
    aliases: ["tehran", "iran"] },
  { tz: "Asia/Jerusalem",        city: "Jerusalém",      country: "Israel",
    aliases: ["tel aviv", "israel"] },
  { tz: "Asia/Baghdad",          city: "Bagdá",          country: "Iraque" },

  // ── Ásia ──────────────────────────────────────────────────────────
  { tz: "Asia/Kolkata",          city: "Mumbai",         country: "Índia",
    aliases: ["delhi", "bangalore", "kolkata", "chennai", "hyderabad", "india", "pune"] },
  { tz: "Asia/Karachi",          city: "Karachi",        country: "Paquistão",
    aliases: ["lahore", "islamabad", "pakistan"] },
  { tz: "Asia/Dhaka",            city: "Daca",           country: "Bangladesh",
    aliases: ["dhaka"] },
  { tz: "Asia/Bangkok",          city: "Bangkok",        country: "Tailândia",
    aliases: ["thailand"] },
  { tz: "Asia/Jakarta",          city: "Jacarta",        country: "Indonésia",
    aliases: ["jakarta", "surabaya", "indonesia"] },
  { tz: "Asia/Singapore",        city: "Singapura",      country: "Singapura",
    aliases: ["singapore"] },
  { tz: "Asia/Kuala_Lumpur",     city: "Kuala Lumpur",   country: "Malásia",
    aliases: ["malaysia"] },
  { tz: "Asia/Manila",           city: "Manila",         country: "Filipinas",
    aliases: ["philippines", "cebu"] },
  { tz: "Asia/Hong_Kong",        city: "Hong Kong",      country: "Hong Kong" },
  { tz: "Asia/Taipei",           city: "Taipei",         country: "Taiwan" },
  { tz: "Asia/Shanghai",         city: "Xangai",         country: "China",
    aliases: ["shanghai", "beijing", "guangzhou", "shenzhen", "china"] },
  { tz: "Asia/Tokyo",            city: "Tóquio",         country: "Japão",
    aliases: ["tokyo", "osaka", "kyoto", "nagoya", "japan"] },
  { tz: "Asia/Seoul",            city: "Seul",           country: "Coreia do Sul",
    aliases: ["seoul", "busan", "south korea"] },
  { tz: "Asia/Ho_Chi_Minh",      city: "Ho Chi Minh",    country: "Vietnã",
    aliases: ["saigon", "hanoi", "vietnam"] },

  // ── Oceania ──────────────────────────────────────────────────────
  { tz: "Australia/Sydney",      city: "Sydney",         country: "Austrália",
    aliases: ["melbourne", "brisbane", "canberra", "australia"] },
  { tz: "Australia/Perth",       city: "Perth",          country: "Austrália" },
  { tz: "Australia/Adelaide",    city: "Adelaide",       country: "Austrália" },
  { tz: "Pacific/Auckland",      city: "Auckland",       country: "Nova Zelândia",
    aliases: ["wellington", "new zealand"] },
  { tz: "Pacific/Fiji",          city: "Suva",           country: "Fiji" },

  // ── UTC ───────────────────────────────────────────────────────────
  { tz: "UTC",                   city: "UTC",            country: "Universal",
    aliases: ["gmt", "zulu"] },
];

// detectBrowserTimezone — devolve a IANA TZ do browser. Útil pra default.
export function detectBrowserTimezone(): string {
  if (typeof Intl === "undefined") return "America/Sao_Paulo";
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
  } catch {
    return "America/Sao_Paulo";
  }
}

// findTimezoneCity — acha a entrada que melhor representa uma IANA TZ.
// Útil pra mostrar "Salvar em São Paulo (BRT)" quando o user já tem uma
// TZ setada e queremos mostrar o label amigável.
export function findTimezoneCity(tz: string): TimezoneCity | undefined {
  return TIMEZONE_CITIES.find(c => c.tz === tz);
}

// searchTimezones — busca por nome de cidade, país ou alias. Case-
// insensitive, sem acento (normaliza pra ASCII). Retorna ranqueado:
// match exato em city/country primeiro, depois alias, depois prefix
// match. Limita a `limit` resultados.
export function searchTimezones(query: string, limit = 20): TimezoneCity[] {
  const q = norm(query);
  if (!q) return TIMEZONE_CITIES.slice(0, limit);
  const scored: Array<{ c: TimezoneCity; score: number }> = [];
  for (const c of TIMEZONE_CITIES) {
    const city = norm(c.city);
    const country = norm(c.country);
    let score = 0;
    if (city === q || country === q) score = 100;
    else if (city.startsWith(q)) score = 80;
    else if (country.startsWith(q)) score = 70;
    else if (city.includes(q)) score = 60;
    else if (country.includes(q)) score = 50;
    else if (c.aliases?.some(a => norm(a) === q)) score = 90;
    else if (c.aliases?.some(a => norm(a).startsWith(q))) score = 75;
    else if (c.aliases?.some(a => norm(a).includes(q))) score = 55;
    else if (norm(c.tz).includes(q)) score = 40;
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.c);
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// formatTimezoneLabel — devolve "São Paulo · Brasil · GMT-3"
// pra exibir no picker. Calcula offset em runtime via Intl.
export function formatTimezoneLabel(c: TimezoneCity): string {
  const off = currentOffsetLabel(c.tz);
  return `${c.city} · ${c.country} · ${off}`;
}

// currentOffsetLabel — devolve "GMT-3" ou "GMT+5:30" pra uma IANA TZ.
// Usa Intl.DateTimeFormat com timeZoneName: "longOffset" — disponível
// em browsers modernos; fallback computa diff via Date.
export function currentOffsetLabel(tz: string): string {
  if (typeof Intl === "undefined") return "";
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" });
    const parts = fmt.formatToParts(new Date());
    const off = parts.find(p => p.type === "timeZoneName")?.value;
    if (off) return off; // "GMT-3", "GMT+5:30"
  } catch {
    // fallthrough
  }
  return "";
}

// formatTimeInTimezone — devolve string "HH:MM" da hora atual na TZ.
// Usado pro side-by-side preview "10:00 em Orlando = 12:00 no seu horário".
export function formatTimeInTimezone(tz: string, date = new Date()): string {
  if (typeof Intl === "undefined") return "";
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "";
  }
}

// convertHHMMBetweenTimezones — recebe "10:00" no fromTz e devolve
// "HH:MM" equivalente em toTz pra HOJE. Útil pro preview "horário
// configurado no fuso da campanha = horário equivalente no fuso da conta".
//
// Implementação: cria Date hoje na fromTz com aquela hora, depois formata
// na toTz. Usa o trick do offset via formatToParts pra evitar libs.
export function convertHHMMBetweenTimezones(hhmm: string, fromTz: string, toTz: string): string {
  if (!hhmm || !fromTz || !toTz || fromTz === toTz) return hhmm;
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(hhmm);
  if (!m) return hhmm;
  const hour = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const minute = Math.max(0, Math.min(59, parseInt(m[2], 10)));

  // Pega o ponto no tempo em UTC equivalente a "hoje hh:mm na fromTz".
  // Truque: monta string ISO sem TZ no fuso fromTz e calcula o offset.
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = (today.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = today.getUTCDate().toString().padStart(2, "0");
  const isoNaive = `${yyyy}-${mm}-${dd}T${pad2(hour)}:${pad2(minute)}:00`;
  // Calcula o offset da fromTz em ms agora.
  const fromOffsetMs = tzOffsetMs(fromTz, today);
  const utcMs = Date.parse(isoNaive + "Z") - fromOffsetMs;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: toTz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(utcMs));
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

// tzOffsetMs — offset (ms) da TZ no instante `at`. Positivo a leste de
// Greenwich (BRT = -3h = -10800000).
function tzOffsetMs(tz: string, at: Date): number {
  // Trick: formatToParts em UTC vs na TZ, calcula diff.
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(at);
    const get = (k: string) => parseInt(parts.find(p => p.type === k)?.value || "0", 10);
    const yyyy = get("year");
    const mm = get("month");
    const dd = get("day");
    let hh = get("hour");
    if (hh === 24) hh = 0; // some browsers return 24
    const mi = get("minute");
    const ss = get("second");
    const local = Date.UTC(yyyy, mm - 1, dd, hh, mi, ss);
    return local - at.getTime();
  } catch {
    return 0;
  }
}
