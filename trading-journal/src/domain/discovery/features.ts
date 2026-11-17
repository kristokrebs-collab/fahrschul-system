/**
 * The features of an entry (Auftrag B): one number or category per trade, computed ONLY from what was known when the position
 * was opened.
 *
 * The no-look-ahead rule is one sentence: a feature at an entry sees the candles that had CLOSED by then (`k` of them: the
 * signal candle is `bars[k − 1]`), the clock, and – for "losses in a row" – the trades that were already closed. Every series here
 * is a recursion or a window over EARLIER candles, so the value at candle j depends on candles 0…j only. The test
 * `tests/unit/discovery.lookahead.test.ts` proves it two ways: the table of a series cut at k equals the table of the full
 * series at k, and rewriting everything after k changes nothing.
 *
 * Conventions: a number marked `dir` is read from the side of the trade (Long as is, Short mirrored: "positive = in the
 * direction of the trade"). ATR is Wilder's ATR(14) of the signal candle; everything that needs a window the data does not fill
 * yet is `null` – never a guess.
 */
import { aggregateBars, closedCount, weekOpenS } from "../backtest/bars";
import { sessionOf, SESSIONS } from "../insights/time";
import { rsi as wilderRsi } from "../signals/indicators";
import { atr as wilderAtr } from "../signals/structure";
import type { Bar } from "../signals/indicators";
import type { DiscoveryLevel, DiscoveryMarket, DiscoverySide, FeatureDef, FeatureId, FeatureValue } from "./types";

// ── definitions ───────────────────────────────────────────────────────────────────────────────────────────────

const def = (id: FeatureId, d: Omit<FeatureDef, "id">): [FeatureId, FeatureDef] => [id, { id, ...d }];

const NUM = { kind: "num", dir: false, obscure: false, phase: "entry", needsBars: true, filterable: true } as const;
const CAT = { kind: "cat", unit: "", digits: 0, dir: false, obscure: false, phase: "entry", needsBars: false, filterable: true } as const;

export const FEATURES: Readonly<Record<FeatureId, FeatureDef>> = Object.fromEntries([
  def("side", { ...CAT, label: "Richtung", group: "time" }),
  def("session", { ...CAT, label: "Session (UTC)", group: "time" }),
  def("weekday", { ...CAT, label: "Wochentag (UTC)", group: "time" }),
  def("dayPart", { ...CAT, label: "Tageszeit (UTC)", group: "time" }),
  def("emaDist20", { ...NUM, label: "Abstand zum EMA 20 (in Handelsrichtung)", unit: "ATR", digits: 2, group: "price", dir: true }),
  def("emaDist50", { ...NUM, label: "Abstand zum EMA 50 (in Handelsrichtung)", unit: "ATR", digits: 2, group: "price", dir: true }),
  def("emaDist200", { ...NUM, label: "Abstand zum EMA 200 (in Handelsrichtung)", unit: "ATR", digits: 2, group: "price", dir: true }),
  def("rsi", { ...NUM, label: "RSI(14)", unit: "", digits: 0, group: "price" }),
  def("rsiSlope", { ...NUM, label: "RSI-Steigung über 3 Kerzen", unit: "Punkte", digits: 1, group: "price", obscure: true }),
  def("volRegime", { ...NUM, label: "Volatilität im Verhältnis zu ihrem 50er-Schnitt", unit: "×", digits: 2, group: "volatility", obscure: true }),
  def("candleSize", { ...NUM, label: "Größe der Signalkerze", unit: "ATR", digits: 2, group: "candle" }),
  def("bodyRatio", { ...NUM, label: "Körper-Anteil der Signalkerze", unit: "%", digits: 0, group: "candle", obscure: true }),
  def("wickAgainst", { ...NUM, label: "Docht gegen die Handelsrichtung (Anteil der Kerze)", unit: "%", digits: 0, group: "candle", obscure: true, dir: true }),
  def("relVolume", { ...NUM, label: "Volumen im Verhältnis zum 20er-Schnitt", unit: "×", digits: 2, group: "volume" }),
  def("roomAhead", { ...NUM, label: "Abstand zum 20-Kerzen-Hoch (Long) bzw. -Tief (Short)", unit: "ATR", digits: 2, group: "price", dir: true }),
  def("roomBehind", { ...NUM, label: "Abstand zum 20-Kerzen-Tief (Long) bzw. -Hoch (Short)", unit: "ATR", digits: 2, group: "price", dir: true }),
  def("trendSlope", { ...NUM, label: "Trendneigung der letzten 20 Kerzen (in Handelsrichtung)", unit: "ATR je Kerze", digits: 2, group: "price", obscure: true, dir: true }),
  def("efficiency", { ...NUM, label: "Trend-Effizienz der letzten 20 Kerzen", unit: "", digits: 2, group: "price", obscure: true }),
  def("bbPos", { ...NUM, label: "Lage im Bollinger-Band (20, 2)", unit: "%", digits: 0, group: "price" }),
  def("bbWidth", { ...NUM, label: "Breite des Bollinger-Bands", unit: "%", digits: 1, group: "volatility", obscure: true }),
  def("keyLevelDist", { ...NUM, label: "Abstand zur nächsten Schlüsselmarke", unit: "ATR", digits: 2, group: "price", filterable: false }),
  def("htfTrend", { ...NUM, label: "Höherer Zeitrahmen: Abstand zum EMA 20 (in Handelsrichtung)", unit: "ATR", digits: 2, group: "price", dir: true }),
  def("dayStartDist", { ...NUM, label: "Abstand zum Tagesbeginn (in Handelsrichtung)", unit: "ATR", digits: 2, group: "price", obscure: true, dir: true }),
  def("gap", { ...NUM, label: "Lücke vor der Signalkerze (in Handelsrichtung)", unit: "ATR", digits: 2, group: "candle", obscure: true, dir: true }),
  def("lossStreak", { ...CAT, label: "Verlusttrades unmittelbar davor", group: "history", filterable: false }),
  def("setup", { ...CAT, label: "Setup", group: "journal", filterable: false }),
  def("emotion", { ...CAT, label: "Emotion", group: "journal", filterable: false }),
  def("hold", { ...NUM, label: "Haltedauer (erst nach dem Ausstieg bekannt)", unit: "h", digits: 1, group: "after", phase: "after", needsBars: false, filterable: false }),
]) as Record<FeatureId, FeatureDef>;

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

/** The features computed from candles (the others come from the clock, the trade history or the journal). */
export const BAR_FEATURES = ["emaDist20", "emaDist50", "emaDist200", "rsi", "rsiSlope", "volRegime", "candleSize", "bodyRatio", "wickAgainst", "relVolume", "roomAhead", "roomBehind", "trendSlope", "efficiency", "bbPos", "bbWidth", "keyLevelDist", "htfTrend", "dayStartDist", "gap"] as const satisfies readonly FeatureId[];
export type BarFeatureId = (typeof BAR_FEATURES)[number];

export const CALENDAR_FEATURES = ["session", "weekday", "dayPart"] as const satisfies readonly FeatureId[];

/** Windows (candles). */
export const WIN = { room: 20, trend: 20, bb: 20, atrAvg: 50, vol: 20, rsiSlope: 3, atr: 14 } as const;

// ── causal series ─────────────────────────────────────────────────────────────────────────────────────────────

const fin = (x: number | null | undefined): x is number => typeof x === "number" && Number.isFinite(x);
const orNull = (x: number): number | null => (Number.isFinite(x) ? x : null);

/** EMA like TradingView `ta.ema`: seeded with the SMA of the first `len` closes, `null` before. The value at i uses candles 0…i. */
export function emaSeeded(src: readonly number[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  if (len < 1 || src.length < len) return out;
  let sum = 0;
  for (let i = 0; i < len; i++) sum += src[i]!;
  let prev = sum / len;
  out[len - 1] = prev;
  const a = 2 / (len + 1);
  for (let i = len; i < src.length; i++) {
    prev = a * src[i]! + (1 - a) * prev;
    out[i] = prev;
  }
  return out;
}

/** Mean of the last `len` values at each index; `null` until `len` consecutive finite values exist. */
export function rollingMean(src: readonly (number | null)[], len: number): (number | null)[] {
  const out: (number | null)[] = new Array(src.length).fill(null);
  let run = 0;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (!fin(x)) {
      run = 0;
      sum = 0;
      continue;
    }
    run++;
    sum += x;
    if (run > len) sum -= src[i - len]!;
    if (run >= len) out[i] = sum / len;
  }
  return out;
}

/** The higher timeframe the trend feature reads: the first of 1h / 4h / 1D / 1W that is at least four candles long (as the lab's trend filter). */
export function htfOf(bars: readonly Bar[], execSec: number): { bars: Bar[]; sec: number; label: string } | null {
  const steps: readonly [number, string][] = [
    [3600, "1h"],
    [14_400, "4h"],
    [86_400, "1D"],
    [604_800, "1W"],
  ];
  const hit = steps.find(([sec]) => sec >= execSec * 4) ?? steps[steps.length - 1]!;
  const [sec, label] = hit;
  if (sec <= execSec) return null;
  if (sec === 604_800) return execSec === 86_400 ? { bars: aggregateBars(bars, weekOpenS, 7), sec, label } : null;
  if (sec % execSec !== 0) return null;
  return { bars: aggregateBars(bars, (t) => Math.floor(t / sec) * sec, sec / execSec), sec, label };
}

/** Everything precomputed once per market; `barFeatures` then reads it at any candle. */
export interface FeatureSeries {
  bars: readonly Bar[];
  secLen: number;
  atr: (number | null)[];
  rsi: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  atrAvg: (number | null)[];
  /** index of the first candle of the same UTC day when that candle opens at 00:00 UTC, else −1 */
  dayStart: Int32Array;
  htf: { bars: Bar[]; sec: number; ema20: (number | null)[]; atr: (number | null)[] } | null;
  levels: readonly DiscoveryLevel[];
}

const nullify = (a: readonly number[]): (number | null)[] => a.map(orNull);

export function buildSeries(m: DiscoveryMarket): FeatureSeries {
  const bars = m.bars;
  const n = bars.length;
  const closes = bars.map((b) => b.c);
  const atr = nullify(n ? wilderAtr(bars, WIN.atr) : []);
  const dayStart = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const t = bars[i]!.t;
    if (i > 0 && Math.floor(t / 86_400) === Math.floor(bars[i - 1]!.t / 86_400)) dayStart[i] = dayStart[i - 1]!;
    else dayStart[i] = t % 86_400 === 0 ? i : -1;
  }
  const h = n ? htfOf(bars, m.intervalSec) : null;
  return {
    bars,
    secLen: m.intervalSec,
    atr,
    rsi: nullify(n ? wilderRsi(closes, 14) : []),
    ema20: emaSeeded(closes, 20),
    ema50: emaSeeded(closes, 50),
    ema200: emaSeeded(closes, 200),
    atrAvg: rollingMean(atr, WIN.atrAvg),
    dayStart,
    htf: h ? { bars: h.bars, sec: h.sec, ema20: emaSeeded(h.bars.map((b) => b.c), 20), atr: nullify(h.bars.length ? wilderAtr(h.bars, WIN.atr) : []) } : null,
    levels: m.levels ?? [],
  };
}

// ── the features of one entry ─────────────────────────────────────────────────────────────────────────────────

export type BarFeatureRow = Record<BarFeatureId, number | null>;

export const emptyBarRow = (): BarFeatureRow => Object.fromEntries(BAR_FEATURES.map((f) => [f, null])) as BarFeatureRow;

/**
 * The candle features of an entry that sees the first `k` candles closed (`k = closedCount(bars, secLen, entryTime)`), at
 * `atS` (UNIX seconds, the moment of the entry – the higher timeframe counts only candles closed by then). `k = 0` → all `null`.
 */
export function barFeatures(s: FeatureSeries, k: number, atS: number, side: DiscoverySide): BarFeatureRow {
  const row = emptyBarRow();
  const j = Math.min(k, s.bars.length) - 1;
  if (j < 0) return row;
  const b = s.bars[j]!;
  const dir = side === "long" ? 1 : -1;
  const a = s.atr[j];
  const hasAtr = fin(a) && a > 0;

  if (hasAtr) {
    for (const [id, ema] of [["emaDist20", s.ema20], ["emaDist50", s.ema50], ["emaDist200", s.ema200]] as const) {
      const e = ema[j];
      if (fin(e)) row[id] = (dir * (b.c - e)) / a;
    }
    row.candleSize = (b.h - b.l) / a;
    if (j >= 1) row.gap = (dir * (b.o - s.bars[j - 1]!.c)) / a;
    const ds = s.dayStart[j]!;
    if (ds >= 0 && s.secLen < 86_400) row.dayStartDist = (dir * (b.c - s.bars[ds]!.o)) / a;
    const av = s.atrAvg[j];
    if (fin(av) && av > 0) row.volRegime = a / av;
    if (s.levels.length) {
      let best = Infinity;
      for (const lv of s.levels) if (lv.sinceMs != null && lv.sinceMs / 1000 <= atS && Number.isFinite(lv.price)) best = Math.min(best, Math.abs(b.c - lv.price));
      if (best < Infinity) row.keyLevelDist = best / a;
    }
  }

  const r = s.rsi[j];
  if (fin(r)) {
    row.rsi = r;
    const r0 = j >= WIN.rsiSlope ? s.rsi[j - WIN.rsiSlope] : null;
    if (fin(r0)) row.rsiSlope = r - r0;
  }

  const range = b.h - b.l;
  if (range > 0) {
    row.bodyRatio = (Math.abs(b.c - b.o) / range) * 100;
    row.wickAgainst = ((side === "long" ? b.h - Math.max(b.o, b.c) : Math.min(b.o, b.c) - b.l) / range) * 100;
  }

  if (j >= WIN.vol && b.v != null && Number.isFinite(b.v) && b.v >= 0) {
    let sum = 0;
    let ok = true;
    for (let i = j - WIN.vol; i < j; i++) {
      const v = s.bars[i]!.v;
      if (v == null || !Number.isFinite(v) || v < 0) {
        ok = false;
        break;
      }
      sum += v;
    }
    const mean = sum / WIN.vol;
    if (ok && mean > 0) row.relVolume = b.v / mean;
  }

  if (j >= WIN.room - 1 && hasAtr) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let i = j - WIN.room + 1; i <= j; i++) {
      hi = Math.max(hi, s.bars[i]!.h);
      lo = Math.min(lo, s.bars[i]!.l);
    }
    row.roomAhead = (side === "long" ? hi - b.c : b.c - lo) / a;
    row.roomBehind = (side === "long" ? b.c - lo : hi - b.c) / a;
  }

  if (j >= WIN.trend - 1) {
    // least-squares slope of the last 20 closes (x = 0…19): Σ(x − 9,5)(y − ȳ) ÷ 665
    const N = WIN.trend;
    let ym = 0;
    for (let i = j - N + 1; i <= j; i++) ym += s.bars[i]!.c;
    ym /= N;
    let num = 0;
    for (let x = 0; x < N; x++) num += (x - (N - 1) / 2) * (s.bars[j - N + 1 + x]!.c - ym);
    const slope = num / ((N * (N * N - 1)) / 12);
    if (hasAtr) row.trendSlope = (dir * slope) / a;
  }
  if (j >= WIN.trend) {
    let path = 0;
    for (let i = j - WIN.trend + 1; i <= j; i++) path += Math.abs(s.bars[i]!.c - s.bars[i - 1]!.c);
    if (path > 0) row.efficiency = Math.abs(b.c - s.bars[j - WIN.trend]!.c) / path;
  }

  if (j >= WIN.bb - 1) {
    let m = 0;
    for (let i = j - WIN.bb + 1; i <= j; i++) m += s.bars[i]!.c;
    m /= WIN.bb;
    let v = 0;
    for (let i = j - WIN.bb + 1; i <= j; i++) v += (s.bars[i]!.c - m) ** 2;
    const sd = Math.sqrt(v / WIN.bb);
    if (sd > 0) row.bbPos = ((b.c - (m - 2 * sd)) / (4 * sd)) * 100;
    if (m > 0) row.bbWidth = ((4 * sd) / m) * 100;
  }

  if (s.htf && hasAtr) {
    const mc = closedCount(s.htf.bars, s.htf.sec, atS);
    if (mc >= 1) {
      const e = s.htf.ema20[mc - 1];
      const ha = s.htf.atr[mc - 1];
      if (fin(e) && fin(ha) && ha > 0) row.htfTrend = (dir * (s.htf.bars[mc - 1]!.c - e)) / ha;
    }
  }
  return row;
}

// ── calendar ──────────────────────────────────────────────────────────────────────────────────────────────────

export const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"] as const;
export const DAY_PARTS = ["Nacht (0–6 Uhr)", "Vormittag (6–12 Uhr)", "Nachmittag (12–18 Uhr)", "Abend (18–24 Uhr)"] as const;

/** Session, weekday and part of the day of an instant (all UTC; `sessionOf` is the journal's own). */
export function calendarFeatures(entryMs: number): { session: string; weekday: string; dayPart: string } {
  const d = new Date(entryMs);
  const key = sessionOf(d);
  return { session: SESSIONS.find((s) => s.key === key)!.label, weekday: WEEKDAYS[d.getUTCDay()]!, dayPart: DAY_PARTS[Math.floor(d.getUTCHours() / 6)]! };
}

/** Number of losses (R < 0) directly before an entry among the trades closed by then, capped at 3 – as the category label. */
export const STREAK_LABELS = ["0", "1", "2", "3 oder mehr"] as const;

export function streakLabel(n: number): string {
  return STREAK_LABELS[Math.min(3, Math.max(0, n))]!;
}

/** Generic value read: used by the filter and the tests. */
export const isMissing = (v: FeatureValue | undefined): v is null | undefined => v == null || (typeof v === "number" && !Number.isFinite(v));
