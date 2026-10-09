/**
 * "Top-Trader kaufen · Retail rot" — the whale-vs-retail condition of the Einstiegs-Check (ours, additive).
 *
 * Inputs per Binance futures-data period (`/futures/data/topLongShortPositionRatio` = top traders by position,
 * `/futures/data/globalLongShortAccountRatio` = all accounts = "retail"; the same pair the Top-Trader card's
 * `Top vs. Alle` delta uses). Each point is the long share at a period boundary, so the change between two points is
 * one CLOSED period:
 * - long: top-trader long % rises (the top traders buy) AND the all-accounts long % falls (retail is red);
 * - short: top-trader long % falls AND the all-accounts long % rises (retail is green).
 * `runLong` / `runShort` count those periods backwards from the newest one (a gap or a period that does not fit
 * stops the count, like `Δ+ Kerzen`). The condition holds on a period when its run ≥ `minRun`, and holds overall when
 * it holds on ANY configured period (the readings of all periods are shown).
 *
 * Grading (`applyWhale`): holds and `weight > 0` → score + `weight` (max 100) and, for a valid entry, strength + 1
 * (max 4, the label follows). `weight 0` = shown and stored, never counted. No data (Binance futures data reach ~30
 * days back, other sources have no top traders) → no reading: the verdict is exactly the one without the condition.
 * Pure: no I/O; the market layer (`src/market/signals/whale.ts`) feeds the series.
 */
import { STRENGTH_LABEL, tfSeconds, whaleCfgOf, type Side, type SignalCfg, type WhaleCfg } from "./config";
import type { Signals, Strength, Verdict } from "./verdict";

/** One ratio snapshot: time (ms, period boundary) and the long share in %. Structurally a market `RatioPoint`. */
export interface RatioSample {
  time: number;
  longPct: number;
}

export interface WhaleSeries {
  /** top traders, position long % */
  top: readonly RatioSample[];
  /** all accounts (retail), long % */
  retail: readonly RatioSample[];
}

/** Reading of one period at the evaluation time. */
export interface WhalePeriod {
  period: string;
  /** ms of the newest snapshot used */
  at: number;
  /** newest top-trader long % / all-accounts long % */
  top: number;
  retail: number;
  /** change over the last `minRun` periods (fewer when the series is shorter), percentage points */
  topChg: number;
  retailChg: number;
  /** trailing closed periods with top ↑ and retail ↓ */
  runLong: number;
  /** trailing closed periods with top ↓ and retail ↑ */
  runShort: number;
}

export interface WhaleReading {
  /** periods with data, in config order (small → large) */
  periods: WhalePeriod[];
  /** configured periods without (fresh) data */
  missing: string[];
}

/** The condition for one side, attached to its `Verdict` when a reading exists. */
export interface WhaleVerdict {
  ok: boolean;
  /** longest run of this side over the periods */
  run: number;
  need: number;
  /** period of that run (the smaller one on a tie) */
  period: string;
  /** top / retail change on that period over the last `need` periods, pp */
  topChg: number;
  retailChg: number;
  /** points added to the score (0 when it does not hold or the weight is 0) */
  points: number;
}

/** A newest snapshot older than this many periods (+ 5 min publication slack) is stale → no data for the period. */
export const WHALE_FRESH_PERIODS = 2;
const SLACK_MS = 5 * 60_000;

const periodMs = (p: string): number => tfSeconds(p) * 1000;

/**
 * Reading of one period from its two series at `atMs` (only snapshots at or before `atMs` count). `null` when there
 * are fewer than two joined snapshots or the newest one is stale.
 */
export function whalePeriod(period: string, s: WhaleSeries | null | undefined, atMs: number, minRun: number): WhalePeriod | null {
  const step = periodMs(period);
  if (!s || !step || !Number.isFinite(atMs)) return null;
  const retail = new Map<number, number>();
  for (const p of s.retail) if (p.time <= atMs && Number.isFinite(p.longPct)) retail.set(p.time, p.longPct);
  const rows: { t: number; top: number; ret: number }[] = [];
  for (const p of s.top) {
    if (p.time > atMs || !Number.isFinite(p.longPct)) continue;
    const r = retail.get(p.time);
    if (r !== undefined) rows.push({ t: p.time, top: p.longPct, ret: r });
  }
  rows.sort((a, b) => a.t - b.t);
  const dedup = rows.filter((r, i) => i === 0 || r.t !== rows[i - 1]!.t);
  const n = dedup.length;
  if (n < 2) return null;
  const last = dedup[n - 1]!;
  if (atMs - last.t > WHALE_FRESH_PERIODS * step + SLACK_MS) return null;
  let runLong = 0;
  let runShort = 0;
  let longOpen = true;
  let shortOpen = true;
  for (let i = n - 1; i >= 1 && (longOpen || shortOpen); i--) {
    const a = dedup[i - 1]!;
    const b = dedup[i]!;
    const contiguous = b.t - a.t === step;
    const dTop = b.top - a.top;
    const dRet = b.ret - a.ret;
    if (longOpen && contiguous && dTop > 0 && dRet < 0) runLong++;
    else longOpen = false;
    if (shortOpen && contiguous && dTop < 0 && dRet > 0) runShort++;
    else shortOpen = false;
  }
  const back = dedup[Math.max(0, n - 1 - Math.max(1, minRun))]!;
  return { period, at: last.t, top: last.top, retail: last.ret, topChg: last.top - back.top, retailChg: last.ret - back.ret, runLong, runShort };
}

/** Readings of every configured period; `null` when the condition is off or no period has data. */
export function whaleReading(series: Readonly<Record<string, WhaleSeries | null | undefined>>, cfg: Pick<SignalCfg, "whale">, atMs: number): WhaleReading | null {
  const w = whaleCfgOf(cfg);
  if (!w.on) return null;
  const periods: WhalePeriod[] = [];
  const missing: string[] = [];
  for (const p of w.periods) {
    const r = whalePeriod(p, series[p], atMs, w.minRun);
    if (r) periods.push(r);
    else missing.push(p);
  }
  return periods.length ? { periods, missing } : null;
}

/** The condition for `side` from a reading. */
export function whaleVerdict(side: Side, reading: WhaleReading, w: WhaleCfg): WhaleVerdict {
  let best = reading.periods[0]!;
  let run = -1;
  for (const p of reading.periods) {
    const r = side === "long" ? p.runLong : p.runShort;
    if (r > run) {
      run = r;
      best = p;
    }
  }
  const ok = run >= w.minRun;
  return { ok, run, need: w.minRun, period: best.period, topChg: best.topChg, retailChg: best.retailChg, points: ok ? w.weight : 0 };
}

/** Condition title per side (card row, reasons, settings). */
export const WHALE_TITLE: Readonly<Record<Side, string>> = { long: "Top-Trader kaufen · Retail rot", short: "Top-Trader verkaufen · Retail grün" };

/** Reason line of the condition (`Top-Trader kaufen · Retail rot (2× 30m/1h)`). */
export function whaleReasonText(side: Side, w: WhaleCfg): string {
  return `${WHALE_TITLE[side]} (${w.minRun}× ${w.periods.join("/")})`;
}

function relabel(v: Verdict, strength: Strength): string {
  if (!v.valid) return v.label;
  const sideWord = v.side === "long" ? "Long" : "Short";
  return strength >= 3 ? `Sehr starker ${sideWord}-Einstieg` : strength === 2 ? `Starker ${sideWord}-Einstieg` : `${sideWord}-Einstieg`;
}

function gradeSide(v: Verdict, reading: WhaleReading, w: WhaleCfg): Verdict {
  const wv = whaleVerdict(v.side, reading, w);
  const bonus = wv.points > 0;
  const strength = (v.valid ? Math.min(4, v.strength + (bonus ? 1 : 0)) : 0) as Strength;
  return {
    ...v,
    strength,
    score: Math.min(100, v.score + wv.points),
    label: strength === v.strength ? v.label : relabel(v, strength),
    reasons: [...v.reasons, { text: whaleReasonText(v.side, w), ok: wv.ok }],
    whale: wv,
  };
}

/**
 * Grades both sides with the condition (see the module note). Without a reading (off, no data) the input comes back
 * unchanged — the evaluation then equals the other journal's exactly.
 */
export function applyWhale<S extends Signals>(sig: S, reading: WhaleReading | null, cfg: Pick<SignalCfg, "whale">): S {
  const w = whaleCfgOf(cfg);
  if (!w.on || !reading || !reading.periods.length) return sig;
  const long = gradeSide(sig.long, reading, w);
  const short = gradeSide(sig.short, reading, w);
  return { ...sig, long, short, best: long.score >= short.score ? long : short, whale: reading };
}

/** `STRENGTH_LABEL` re-export for the copy of the settings card ("+1 Stärke"). */
export const WHALE_STRENGTH_NOTE = (w: Pick<WhaleCfg, "weight">): string => (w.weight > 0 ? `+${w.weight} Score, gültiger Einstieg +1 Stärke (bis ${STRENGTH_LABEL[4]})` : "nur Anzeige, zählt nicht");
