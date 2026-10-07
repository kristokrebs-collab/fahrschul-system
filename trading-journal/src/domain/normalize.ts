/**
 * Read-path normalisers. `normalizeSettings` is the bundle's `qM` with identical semantics:
 * unknown keys survive, an empty `setups` array stays empty, per-setup `name`/`color`/`id` are NOT defaulted.
 * Additive on top (both idempotent, lossless):
 * - `mistakes` defaults to `DEFAULT_MISTAKES`; `signals` is passed through untouched (parsed by the signal module).
 * - Settings from before the multi-TF era (no `mistakes`, no `signals` key) get the `s_mtf` setup appended once –
 *   the same guard the other journal version uses (an empty `setups` array stays empty, bundle semantics); after the first save `mistakes` is persisted, so a user who
 *   deletes `s_mtf` later does not get it back.
 * - `market.symbol` of another venue (`BITSTAMP:BTCUSD`, the other version's default) is mapped to the Binance
 *   USDⓈ-M symbol the live market can serve (`BINANCE:BTCUSDT`); the original is kept in `market.sourceSymbol`.
 */
import type { DayNote, DayNotes, HyblockReading, Rule, Settings, Setup, Trade } from "./types";
import { DEFAULT_BACKTEST, DEFAULT_HYBLOCK, DEFAULT_MARKET, DEFAULT_MISTAKES, defaultSettings, MTF_SETUP, MTF_SETUP_ID } from "./defaults";
import { parseNumber, sanitizeUrl } from "@/lib/parse";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Non-empty strings of `v` (trimmed), first occurrence wins; anything that is not an array → `null`. */
function stringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * Stablecoin quotes that also end in "USD" (`BTCFDUSD` is not `BTCFD` + USD). TUSD is deliberately absent:
 * `XBTUSD` / `DOTUSD` are USD pairs.
 */
const USD_STABLES = /(?:BUSD|FDUSD|USDUSD|PYUSD|USDPUSD)$/;

/**
 * TradingView symbol → the Binance USDⓈ-M symbol the live market can serve, in TradingView notation.
 * `BITSTAMP:BTCUSD` / `COINBASE:BTCUSD` / `KRAKEN:XBTUSD` / bare `BTCUSD` → `BINANCE:BTCUSDT`. Everything else
 * (`BINANCE:BTCUSDT`, `BYBIT:ETHUSDT`, …) is returned unchanged. `changed` tells whether a mapping happened.
 */
export function mapToBinanceSymbol(raw: string): { symbol: string; changed: boolean } {
  const s = raw.trim();
  const idx = s.lastIndexOf(":");
  const prefix = idx > 0 ? s.slice(0, idx).toUpperCase() : null;
  const bare = (idx >= 0 ? s.slice(idx + 1) : s).replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!bare || prefix === "BINANCE" || !/^[A-Z0-9]{2,12}USD$/.test(bare) || USD_STABLES.test(bare)) return { symbol: raw, changed: false };
  const base = bare.slice(0, -3).replace(/^XBT$/, "BTC");
  return { symbol: `BINANCE:${base}USDT`, changed: true };
}

/** Bundle `qM(raw)`. Accepts anything (null, partial, stringified numbers) and returns full Settings. */
export function normalizeSettings(raw: unknown): Settings {
  const t = defaultSettings();
  const r: Raw = isObj(raw) ? raw : {};
  const capital = isObj(r.capital) ? r.capital : {};
  let setups = Array.isArray(r.setups)
    ? (r.setups as Raw[]).map((s) => ({ checklist: [], account: "both", desc: "", ...s }) as unknown as Setup)
    : t.setups;
  // Additive, once: settings written before `s_mtf` existed (neither `mistakes` nor `signals` persisted yet).
  if (Array.isArray(r.setups) && r.setups.length > 0 && !("mistakes" in r) && !("signals" in r) && !setups.some((s) => s?.id === MTF_SETUP_ID)) {
    setups = [...setups, { ...MTF_SETUP, checklist: MTF_SETUP.checklist.map((c) => ({ ...c })) }];
  }
  const rules = Array.isArray(r.rules) ? (r.rules as Rule[]) : t.rules;
  const market = { ...DEFAULT_MARKET, ...(isObj(r.market) ? r.market : {}) };
  if (typeof market.symbol === "string") {
    const mapped = mapToBinanceSymbol(market.symbol);
    if (mapped.changed) {
      const m = market as typeof market & { sourceSymbol?: unknown };
      if (typeof m.sourceSymbol !== "string") m.sourceSymbol = market.symbol;
      market.symbol = mapped.symbol;
    }
  }
  return {
    ...r,
    currency: (r.currency as string) || t.currency,
    pair: (r.pair as string) || t.pair,
    startDate: (r.startDate as string) || "",
    capital: {
      makro: parseNumber(capital.makro) ?? t.capital.makro,
      scalp: parseNumber(capital.scalp) ?? t.capital.scalp,
    },
    setups,
    rules,
    backtest: { ...DEFAULT_BACKTEST, ...(isObj(r.backtest) ? r.backtest : {}) },
    market,
    hyblock: { ...DEFAULT_HYBLOCK, ...(isObj(r.hyblock) ? r.hyblock : {}) },
    mistakes: stringList(r.mistakes) ?? [...DEFAULT_MISTAKES],
  } as Settings;
}

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  return parseNumber(v);
};
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : v == null ? fallback : String(v));

/**
 * Normalises a persisted trade record into the `Trade` shape (legacy records may miss fields).
 * `account` stays absent when missing (read path treats it as "scalp"); `pnl`/`r` are kept as stored —
 * `enrichTrade` recomputes them. `chart` goes through `sanitizeUrl` (only `http(s)://` links survive).
 */
export function normalizeTrade(raw: unknown): Trade {
  const r: Raw = isObj(raw) ? raw : {};
  const checksRaw = isObj(r.checks) ? r.checks : {};
  const checks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(checksRaw)) if (v) checks[k] = true;
  const conv = numOrNull(r.conviction);
  const status = r.status === "open" ? "open" : "closed";
  const out: Trade = {
    ...r,
    id: str(r.id),
    side: r.side === "short" ? "short" : "long",
    status,
    date: str(r.date),
    pair: str(r.pair),
    timeframe: str(r.timeframe),
    entry: numOrNull(r.entry),
    stop: numOrNull(r.stop),
    target: numOrNull(r.target),
    exit: status === "open" ? null : numOrNull(r.exit),
    size: numOrNull(r.size),
    leverage: numOrNull(r.leverage),
    fees: numOrNull(r.fees),
    pnlManual: numOrNull(r.pnlManual),
    setups: Array.isArray(r.setups) ? (r.setups as unknown[]).filter((s): s is string => typeof s === "string") : [],
    checks,
    conviction: conv != null && conv >= 1 && conv <= 5 && Number.isInteger(conv) ? (conv as Trade["conviction"]) : null,
    followedPlan: typeof r.followedPlan === "boolean" ? r.followedPlan : null,
    emotion: str(r.emotion),
    reason: str(r.reason),
    notes: str(r.notes),
    chart: sanitizeUrl(r.chart),
    pnl: numOrNull(r.pnl),
    r: numOrNull(r.r),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
    mistakes: stringList(r.mistakes) ?? [],
  };
  if (r.account === "makro" || r.account === "scalp") out.account = r.account;
  else delete (out as Partial<Trade>).account;
  return out;
}

/** Normalises a persisted Hyblock reading ("Ablesung"). */
export function normalizeReading(raw: unknown): HyblockReading {
  const r: Raw = isObj(raw) ? raw : {};
  return {
    ...r,
    id: str(r.id),
    at: str(r.at),
    longPct: parseNumber(r.longPct) ?? 0,
    delta: parseNumber(r.delta) ?? 0,
    deltaCandles: Math.max(0, Math.round(parseNumber(r.deltaCandles) ?? 0)),
    structure: !!r.structure,
    rsi: !!r.rsi,
    note: str(r.note),
  };
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a `tj2-days` key (`YYYY-MM-DD`). */
export function isDayKey(key: string): boolean {
  return DAY_KEY.test(key);
}

/** One `tj2-days` entry: `note` always a string, `plan`/`review` only when strings, `mood` 1–5 or `null`; unknown keys survive. */
export function normalizeDayNote(raw: unknown): DayNote {
  const r: Raw = isObj(raw) ? raw : {};
  const out: DayNote = { ...r, note: str(r.note), updatedAt: str(r.updatedAt) };
  if (typeof r.plan !== "string") delete out.plan;
  if (typeof r.review !== "string") delete out.review;
  if ("mood" in r) {
    const m = numOrNull(r.mood);
    out.mood = m != null && Number.isInteger(m) && m >= 1 && m <= 5 ? (m as DayNote["mood"]) : null;
  }
  return out;
}

/** `tj2-days` read path: object of `YYYY-MM-DD` → entry; other keys / non-object values are skipped (left in storage). */
export function normalizeDayNotes(raw: unknown): DayNotes {
  const out: DayNotes = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (isDayKey(k) && isObj(v)) out[k] = normalizeDayNote(v);
  return out;
}

/** True when a day entry carries nothing worth keeping (no text, no mood, no extra keys). */
export function isEmptyDayNote(d: DayNote): boolean {
  const known = new Set(["note", "plan", "review", "mood", "updatedAt"]);
  if (Object.keys(d).some((k) => !known.has(k))) return false;
  return !d.note.trim() && !(d.plan ?? "").trim() && !(d.review ?? "").trim() && d.mood == null;
}

/** Bundle read order for `tj2-hyblock`: `a.at.localeCompare(b.at)`. */
export function sortReadings(list: readonly HyblockReading[]): HyblockReading[] {
  return [...list].sort((a, b) => a.at.localeCompare(b.at));
}

export const qM = normalizeSettings;
