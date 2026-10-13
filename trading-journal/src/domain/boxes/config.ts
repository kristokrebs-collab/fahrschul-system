/**
 * Box-zu-Box settings (`settings.boxes`, passthrough like `settings.signals`): what the live boxes, the alerts and the
 * watchlist scanner do. `boxesCfgOf(raw)` is the sanitiser (every field defaulted / clamped, never throws);
 * `withBoxesSettings(raw, patch)` writes a patch while keeping every unknown key; `boxesCfgKey` fingerprints the cfg so
 * the live store re-evaluates only on a real change. Also the Binance top-trader read the setups grade with
 * (`traderBiasOf`). Pure – no React, no I/O.
 */
import { DEFAULT_WHALE_CFG, type WhaleCfg } from "../signals/config";
import { deltaMet } from "../signals/traders";
import { DEFAULT_BOX_CFG, type BoxCfg } from "./engine";
import type { Grade, TraderBias } from "./setups";

/** Timeframes the boxes run on (higher timeframes only — owner rule). */
export type BoxTf = "4h" | "1d" | "1w";
export const BOX_TFS: readonly BoxTf[] = ["4h", "1d", "1w"];
/** Higher timeframe used to grade a timeframe's setups (1D for 4h, 1W for 1D). */
export const HTF_OF: Readonly<Record<BoxTf, BoxTf | null>> = { "4h": "1d", "1d": "1w", "1w": null };
export const BOX_TF_LABEL: Readonly<Record<BoxTf, string>> = { "4h": "4h", "1d": "1D", "1w": "1W" };
/** Bar length per timeframe (ms). Weekly bars open Monday 00:00 UTC (Binance). */
export const BOX_TF_MS: Readonly<Record<BoxTf, number>> = { "4h": 4 * 3_600_000, "1d": 86_400_000, "1w": 7 * 86_400_000 };

/** Grades that count as "the best" (trade the best, fuck the rest). */
export type MinGrade = Extract<Grade, "A+" | "A">;

export interface BoxesCfg {
  /** live boxes on (store + alerts); off = nothing is computed */
  on: boolean;
  /** toast on a phase change at the candle close (breakout, retest, failed, target) and on a new A+/A setup */
  alerts: boolean;
  /** additionally a browser notification (needs the permission) */
  notify: boolean;
  /** lowest grade that alerts / is listed as best */
  minGrade: MinGrade;
  /** watchlist scanner on (one scan per 4h close) */
  scanner: boolean;
  /** Binance USDT perpetuals the scanner checks (venue symbols, e.g. `ETHUSDT`) */
  watchlist: string[];
  /** engine tuning (the calibrated defaults; only a few knobs are exposed) */
  box: BoxCfg;
}

/** About ten liquid USDT perpetuals (Binance futures). */
export const DEFAULT_WATCHLIST: readonly string[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "SUIUSDT"];
/** The scanner budget allows this many symbols (≤ 20 weight / min, 4 weight per symbol). */
export const WATCHLIST_MAX = 20;

export const DEFAULT_BOXES_CFG: Readonly<BoxesCfg> = Object.freeze({
  on: true,
  alerts: true,
  notify: false,
  minGrade: "A",
  scanner: true,
  watchlist: [...DEFAULT_WATCHLIST],
  box: { ...DEFAULT_BOX_CFG },
});

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/**
 * A watchlist entry as a Binance USDT-perp symbol: `binance:ethusdt.p` → `ETHUSDT`, `eth` → `ETHUSDT`, `ETH/USDT` →
 * `ETHUSDT`. `null` for anything that is not letters / digits.
 */
export function normalizeWatchSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim().toUpperCase();
  if (s.includes(":")) s = s.split(":").pop() ?? "";
  s = s.replace(/\.P$/, "").replace(/[/\-_\s]/g, "");
  if (!/^[A-Z0-9]{2,20}$/.test(s)) return null;
  if (!/(USDT|USDC|BUSD)$/.test(s)) s = `${s}USDT`;
  return s.length <= 24 ? s : null;
}

/** Unique, normalised, at most `WATCHLIST_MAX`. */
export function sanitizeWatchlist(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WATCHLIST];
  const out: string[] = [];
  for (const r of raw) {
    const s = normalizeWatchSymbol(r);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= WATCHLIST_MAX) break;
  }
  return out;
}

/** Sanitised engine knobs (the rest keeps the calibrated defaults). */
function boxCfgOf(raw: unknown): BoxCfg {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_BOX_CFG;
  return {
    pivotLen: Math.round(num(r.pivotLen, d.pivotLen, 2, 6)),
    tolAtr: num(r.tolAtr, d.tolAtr, 0.3, 2),
    minTouches: Math.round(num(r.minTouches, d.minTouches, 2, 5)),
    minBars: Math.round(num(r.minBars, d.minBars, 6, 60)),
    minHeightAtr: num(r.minHeightAtr, d.minHeightAtr, 0.5, 6),
    maxHeightAtr: num(r.maxHeightAtr, d.maxHeightAtr, 6, 30),
    breakAtr: num(r.breakAtr, d.breakAtr, 0, 1),
    lookback: Math.round(num(r.lookback, d.lookback, 120, 1500)),
  };
}

/** `settings.boxes` (raw, any shape) → a complete, clamped `BoxesCfg`. */
export function boxesCfgOf(raw: unknown): BoxesCfg {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULT_BOXES_CFG;
  return {
    on: bool(r.on, d.on),
    alerts: bool(r.alerts, d.alerts),
    notify: bool(r.notify, d.notify),
    minGrade: r.minGrade === "A+" ? "A+" : "A",
    scanner: bool(r.scanner, d.scanner),
    watchlist: "watchlist" in r ? sanitizeWatchlist(r.watchlist) : [...DEFAULT_WATCHLIST],
    box: boxCfgOf(r.box),
  };
}

/**
 * `settings.boxes` with `patch` applied: every key the patch does not name survives (also unknown ones); returns the
 * SAME object when nothing changes (so the caller can skip the save).
 */
export function withBoxesSettings(raw: unknown, patch: Partial<Omit<BoxesCfg, "box">> & { box?: Partial<BoxCfg> }): Record<string, unknown> {
  const prev = isObj(raw) ? raw : {};
  const next: Record<string, unknown> = { ...prev };
  let changed = !isObj(raw);
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const val = k === "watchlist" ? sanitizeWatchlist(v) : k === "box" ? { ...(isObj(prev.box) ? prev.box : {}), ...(v as object) } : v;
    if (JSON.stringify(prev[k]) !== JSON.stringify(val)) changed = true;
    next[k] = val;
  }
  return changed ? next : (raw as Record<string, unknown>);
}

/** Cache key of the cfg: the live store re-evaluates only when it changes. */
export function boxesCfgKey(c: BoxesCfg): string {
  const b = c.box;
  return `${+c.on}${+c.alerts}${+c.notify}${c.minGrade}${+c.scanner}|${c.watchlist.join(",")}|${b.pivotLen}:${b.tolAtr}:${b.minTouches}:${b.minBars}:${b.minHeightAtr}:${b.maxHeightAtr}:${b.breakAtr}:${b.lookback}`;
}

/** Does `g` pass the minimum grade? */
export const gradePasses = (g: Grade, min: MinGrade): boolean => (min === "A+" ? g === "A+" : g === "A+" || g === "A");

/** Long share (%) of the top traders at or above which they count as long-positioned (and ≤ 100 − this as short). */
export const BIAS_LONG_PCT = 55;

/**
 * Binance top-trader read for the box setups, on the SAME "Retail rot / grün" rule as the Einstiegs-Check
 * (`deltaMet`, user decision 2026-10-08 "Delta wie bei Hyblock"): top traders (mean of positions and accounts) at
 * ≥ 55 % long AND the Whale–Retail-Delta negative (`< deltaRed`) or falling (`deltaChg ≤ −deltaFall`) → `1`; ≤ 45 %
 * long and the delta positive or rising → `−1`; data but neither → `0`; no fresh Binance data → `null` (the setup
 * reason then counts as not met, never as a fail). No delta reading at all does not block the side (as before).
 * `w` = the user's whale settings (`settings.signals.whale`), defaults otherwise.
 */
export function traderBiasOf(
  r: { position: number | null; account: number | null; delta?: number | null; deltaChg?: number | null } | null | undefined,
  w: Pick<WhaleCfg, "deltaRed" | "deltaFall"> = DEFAULT_WHALE_CFG,
): TraderBias {
  if (!r) return null;
  const vals = [r.position, r.account].filter((v): v is number => v != null && Number.isFinite(v));
  if (!vals.length) return null;
  const top = vals.reduce((s, v) => s + v, 0) / vals.length;
  const retail = (side: "long" | "short") => deltaMet(side, r.delta ?? null, r.deltaChg ?? null, w) !== false;
  if (top >= BIAS_LONG_PCT && retail("long")) return 1;
  if (top <= 100 - BIAS_LONG_PCT && retail("short")) return -1;
  return 0;
}

export const BIAS_TEXT: Readonly<Record<"1" | "-1" | "0" | "null", string>> = { "1": "Top Trader long", "-1": "Top Trader short", "0": "Top Trader neutral", null: "Top Trader: keine Daten" };
export const biasText = (b: TraderBias): string => BIAS_TEXT[String(b) as keyof typeof BIAS_TEXT];
