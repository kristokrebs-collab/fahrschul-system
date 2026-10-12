/**
 * CSV basics for the exchange importers (P11) – pure, no DOM.
 * - `parseCsv`: RFC-4180-ish tokenizer (quotes, doubled quotes, CR/LF, BOM), delimiter detected from the header line
 *   (`,` `;` tab `|`), duplicate header names get `_2`, `_3` (MT4/5 reports repeat "Time" / "Price").
 * - `parseNum`: "1,234.56", "1.234,56", "−12,5 USDT", "(3.10)", "12%", "1e-4" → number.
 * - `parseTime`: ISO, "2026-10-05 07:30:12", "05.10.2026 09:30", "10/05/2026 07:30", "20261005;093012", epoch s / ms →
 *   epoch ms (UTC unless the string carries a zone or `assume: "local"`).
 * - `toWallClock`: epoch ms → the journal's local wall clock `YYYY-MM-DDTHH:mm` (this browser's zone).
 */

export interface CsvTable {
  header: string[];
  rows: string[][];
  delimiter: string;
}

const DELIMS = [",", ";", "\t", "|"] as const;

function countOutsideQuotes(line: string, d: string): number {
  let n = 0;
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (!q && c === d) n++;
  }
  return n;
}

export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  let best: string = ",";
  let bestN = 0;
  for (const d of DELIMS) {
    const n = countOutsideQuotes(first, d);
    if (n > bestN) {
      best = d;
      bestN = n;
    }
  }
  return best;
}

/** Tokenises `text` into rows of cells (trimmed); empty lines are dropped. */
export function tokenize(text: string, delimiter: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (q) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
      continue;
    }
    if (c === '"' && cell.trim() === "") {
      q = true;
      cell = "";
    } else if (c === delimiter) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x !== "")) rows.push(row);
  return rows;
}

/** Header names made unique: the second "Time" becomes "Time_2". */
export function uniqueHeader(raw: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h) => {
    const name = h.replace(/\s+/g, " ").trim();
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name}_${n}`;
  });
}

/**
 * Parses a CSV export. Leading lines before the real header (report titles, "Trades" section names) are skipped: the
 * header is the first line with at least 3 cells and the most cells among the first 10 lines.
 */
export function parseCsv(text: string): CsvTable {
  const delimiter = detectDelimiter(text);
  const all = tokenize(text, delimiter);
  if (!all.length) return { header: [], rows: [], delimiter };
  let hi = 0;
  let best = 0;
  for (let i = 0; i < Math.min(10, all.length); i++) {
    const filled = all[i]!.filter((c) => c !== "").length;
    if (filled >= 3 && filled > best) {
      best = filled;
      hi = i;
    }
  }
  const header = uniqueHeader(all[hi]!);
  const rows = all.slice(hi + 1).filter((r) => r.length >= Math.min(2, header.length));
  return { header, rows, delimiter };
}

/** Case/space-insensitive header lookup: first header matching one of the patterns. */
export function findCol(header: readonly string[], ...patterns: RegExp[]): number {
  for (const p of patterns) {
    const i = header.findIndex((h) => p.test(h.trim()));
    if (i >= 0) return i;
  }
  return -1;
}

export const cell = (row: readonly string[], i: number): string => (i >= 0 ? (row[i] ?? "").trim() : "");

/**
 * Number from an export cell. Decimal separator: the LAST of `.` / `,` when both occur; a lone `,` is decimal when
 * `decimalComma` (semicolon files, German exports) or when it is followed by 1–2 digits only… else thousands.
 */
export function parseNum(raw: string, decimalComma = false): number | null {
  let s = raw.trim();
  if (!s || s === "-" || s === "–" || s === "--") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[\u2212\u2013]/g, "-").replace(/[\s\u00a0']/g, "");
  s = s.replace(/[A-Za-z$€£%]+$/g, "").replace(/^[A-Za-z$€£]+/g, "");
  if (!s) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    const decimals = s.length - lastComma - 1;
    const commas = s.split(",").length - 1;
    const zeroInt = /^-?0$/.test(s.slice(0, lastComma));
    s = decimalComma || zeroInt || (commas === 1 && decimals !== 3) ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

export interface TimeOptions {
  /** How to read a time WITHOUT zone: "utc" (exchange exports) or "local" (MT4/5, TradingView in chart zone). */
  assume?: "utc" | "local";
  /** Day-first for `dd/mm/yyyy` (default: `.`-dates are day-first, `/`-dates month-first). */
  dayFirst?: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");

function fromParts(y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number, assume: "utc" | "local"): number {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 60) return NaN;
  return assume === "utc" ? Date.UTC(y, mo - 1, d, h, mi, s, ms) : new Date(y, mo - 1, d, h, mi, s, ms).getTime();
}

/** Epoch ms of an export time, or null. */
export function parseTime(raw: string, opts: TimeOptions = {}): number | null {
  const s = raw.trim();
  if (!s) return null;
  const assume = opts.assume ?? "utc";
  if (/^\d{10}(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  if (/^\d{13}$/.test(s)) return Number(s);
  // ISO with zone
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : null;
  }
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[ T,;]*(?:(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,6}))?)?)?\s*(?:\(?UTC([+-]\d{1,2})?\)?)?$/i.exec(s);
  if (m) {
    const ms = m[7] ? Math.round(Number(`0.${m[7]}`) * 1000) : 0;
    const off = m[8] ? Number(m[8]) : null;
    const t = fromParts(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), ms, off !== null ? "utc" : assume);
    return Number.isFinite(t) ? t - (off ?? 0) * 3_600_000 : null;
  }
  m = /^(\d{4})(\d{2})(\d{2})[;, ]?(\d{2})?:?(\d{2})?:?(\d{2})?$/.exec(s);
  if (m) {
    const t = fromParts(+m[1]!, +m[2]!, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0), 0, assume);
    return Number.isFinite(t) ? t : null;
  }
  m = /^(\d{1,2})([./-])(\d{1,2})\2(\d{2,4})[ T,]*(?:(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(s);
  if (m) {
    const dayFirst = opts.dayFirst ?? m[2] === ".";
    const a = +m[1]!;
    const b = +m[3]!;
    const y = m[4]!.length === 2 ? 2000 + +m[4]! : +m[4]!;
    let h = +(m[5] ?? 0);
    if (m[8]) h = (h % 12) + (/pm/i.test(m[8]) ? 12 : 0);
    const t = fromParts(y, dayFirst ? b : a, dayFirst ? a : b, h, +(m[6] ?? 0), +(m[7] ?? 0), 0, assume);
    return Number.isFinite(t) ? t : null;
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Epoch ms → journal wall clock in this browser's zone (`YYYY-MM-DDTHH:mm`, `seconds` adds `:ss`). */
export function toWallClock(ms: number, seconds = false): string {
  const d = new Date(ms);
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${base}:${pad(d.getSeconds())}` : base;
}

/** Long / short from the many spellings of the exports. */
export function parseSide(raw: string): "long" | "short" | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (/^(long|buy|b|kauf|kaufen|open long|close long|entry long|exit long|bot)$/.test(s) || /\blong\b/.test(s)) return "long";
  if (/^(short|sell|s|verkauf|verkaufen|open short|close short|entry short|exit short|sld)$/.test(s) || /\bshort\b/.test(s)) return "short";
  return null;
}

/** Buy / sell of a fill. */
export function parseBuySell(raw: string): "buy" | "sell" | null {
  const s = raw.trim().toLowerCase();
  if (/^(buy|b|bot|kauf|long|open long|close short)$/.test(s) || /\bbuy\b/.test(s)) return "buy";
  if (/^(sell|s|sld|verkauf|short|open short|close long)$/.test(s) || /\bsell\b/.test(s)) return "sell";
  return null;
}

/** 32-bit FNV-1a as 8 hex chars – deterministic ids for re-imports. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** `BTC/USDT`, `BTCUSDT`, `BTC-USDT-SWAP`, `BINANCE:BTCUSDT.P`, `XBTUSD`, `EURUSD` → journal pair. */
export function normalizePair(raw: string): string {
  let s = raw.trim().toUpperCase();
  if (s.includes(":")) s = s.slice(s.indexOf(":") + 1);
  s = s
    .replace(/\.P$/, "")
    .replace(/-?(SWAP|PERP|PERPETUAL)$/, "")
    .replace(/^PF_/, "")
    .replace(/^PI_/, "");
  if (s.includes("/")) return s;
  if (/^[A-Z0-9]+-[A-Z0-9]+$/.test(s)) return s.replace("-", "/");
  s = s.replace(/[^A-Z0-9]/g, "");
  // Kraken legacy codes: XXBTZUSD, XETHZEUR
  const legacy = /^X([A-Z]{3})Z([A-Z]{3})$/.exec(s);
  if (legacy) return `${legacy[1] === "XBT" ? "BTC" : legacy[1]}/${legacy[2]}`;
  if (s.startsWith("XBT")) s = `BTC${s.slice(3)}`;
  for (const q of ["USDT", "USDC", "FDUSD", "BUSD", "TUSD", "USD", "EUR", "GBP", "JPY", "CHF", "BTC", "ETH"]) {
    if (s.length > q.length + 1 && s.endsWith(q)) return `${s.slice(0, -q.length)}/${q}`;
  }
  return s;
}
