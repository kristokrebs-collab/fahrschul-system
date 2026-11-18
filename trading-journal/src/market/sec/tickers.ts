/**
 * Ticker → CIK from SEC's `company_tickers.json` (`{ "0": { cik_str, ticker, title }, … }`). Pure and alias-free.
 * Class shares are written with a dash or a dot depending on who writes them (`BRK-B` / `BRK.B`): both find the same entry.
 */

export interface TickerEntry {
  ticker: string;
  /** 10 digits */
  cik: string;
  title: string;
}

const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,9}$/;

/** `" brk.b "` → `"BRK.B"`; anything that cannot be a ticker → `null`. */
export function normalizeTicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  return TICKER.test(t) ? t : null;
}

const loose = (t: string): string => `~${t.replace(/[.-]/g, "")}`;

/** Both lookup keys of one entry: the exact ticker and the dash/dot-free form (the first company to claim a key keeps it). */
export function buildTickerIndex(json: unknown): Map<string, TickerEntry> {
  const out = new Map<string, TickerEntry>();
  const list = Array.isArray(json) ? json : json && typeof json === "object" ? Object.values(json as Record<string, unknown>) : [];
  for (const v of list) {
    if (!v || typeof v !== "object") continue;
    const { cik_str: cikRaw, ticker, title } = v as Record<string, unknown>;
    const t = normalizeTicker(ticker);
    const cikNum = typeof cikRaw === "number" ? cikRaw : typeof cikRaw === "string" ? Number(cikRaw) : NaN;
    if (!t || !Number.isInteger(cikNum) || cikNum <= 0) continue;
    const entry: TickerEntry = { ticker: t, cik: String(cikNum).padStart(10, "0"), title: typeof title === "string" ? title.replace(/\s*\/[A-Z]{2,5}\/?\s*$/, "").trim() : "" };
    if (!out.has(t)) out.set(t, entry);
    const l = loose(t);
    if (!out.has(l)) out.set(l, entry);
  }
  return out;
}

/** The entry of a ticker (exact first, then without dashes and dots), or `null`. */
export function findTicker(index: ReadonlyMap<string, TickerEntry>, ticker: string): TickerEntry | null {
  const t = normalizeTicker(ticker);
  if (!t) return null;
  return index.get(t) ?? index.get(loose(t)) ?? null;
}

/** A 10-digit CIK from user input (`320193`, `0000320193`), or `null`. */
export function normalizeCik(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim();
  if (!/^\d{1,10}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? String(n).padStart(10, "0") : null;
}
