/**
 * Read-path normalisers. `normalizeSettings` is the bundle's `qM` with identical semantics:
 * unknown keys survive, an empty `setups` array stays empty, per-setup `name`/`color`/`id` are NOT defaulted.
 */
import type { HyblockReading, Rule, Settings, Setup, Trade } from "./types";
import { DEFAULT_BACKTEST, DEFAULT_HYBLOCK, DEFAULT_MARKET, defaultSettings } from "./defaults";
import { parseNumber } from "@/lib/parse";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

/** Bundle `qM(raw)`. Accepts anything (null, partial, stringified numbers) and returns full Settings. */
export function normalizeSettings(raw: unknown): Settings {
  const t = defaultSettings();
  const r: Raw = isObj(raw) ? raw : {};
  const capital = isObj(r.capital) ? r.capital : {};
  const setups = Array.isArray(r.setups)
    ? (r.setups as Raw[]).map((s) => ({ checklist: [], account: "both", desc: "", ...s }) as unknown as Setup)
    : t.setups;
  const rules = Array.isArray(r.rules) ? (r.rules as Rule[]) : t.rules;
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
    market: { ...DEFAULT_MARKET, ...(isObj(r.market) ? r.market : {}) },
    hyblock: { ...DEFAULT_HYBLOCK, ...(isObj(r.hyblock) ? r.hyblock : {}) },
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
 * `enrichTrade` recomputes them.
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
    chart: str(r.chart),
    pnl: numOrNull(r.pnl),
    r: numOrNull(r.r),
    createdAt: str(r.createdAt),
    updatedAt: str(r.updatedAt),
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

/** Bundle read order for `tj2-hyblock`: `a.at.localeCompare(b.at)`. */
export function sortReadings(list: readonly HyblockReading[]): HyblockReading[] {
  return [...list].sort((a, b) => a.at.localeCompare(b.at));
}

export const qM = normalizeSettings;
