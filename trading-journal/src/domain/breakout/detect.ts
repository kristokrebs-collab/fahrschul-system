/**
 * Markt-Scanner „Wer bricht aus?“ – der Rechenkern. Rein: Kerzen und Uhrzeit hinein, eine Lesung je Markt heraus; kein Netz,
 * keine Uhr, kein Speicher.
 *
 * Die Regel (jede Schwelle steht in `BREAKOUT_RULES` und so auch im Text der Seite):
 *  1. **Spanne.** Hoch und Tief der ersten 30 Minuten einer Sitzung (New York 9:30 oder London 8:00 Ortszeit, mit Sommerzeit),
 *     aus 5-Minuten-Kerzen.
 *  2. **Ausbruch.** Die erste vollständig geschlossene Kerze danach, deren SCHLUSS außerhalb liegt (über dem Hoch = Long, unter
 *     dem Tief = Short) – ein Docht zählt nicht, eine laufende Kerze auch nicht. Gesucht wird 240 Minuten ab Sitzungsbeginn.
 *     Das ist wörtlich der Einstiegs-Timer des Handelsplans (`entryTimer`, `@/domain/plan`); hier wird nichts doppelt gerechnet.
 *  3. **Volumen.** Volumen der Ausbruchskerze ÷ Durchschnitt der 20 geschlossenen Kerzen davor: ab 1,5× „bestätigt“, ab 2× „stark“.
 *  4. **Trend.** Der Schluss der Ausbruchskerze liegt auf der passenden Seite des EMA 50 (Long darüber, Short darunter).
 *  5. **Abstand.** Wie weit der letzte geschlossene Kurs jetzt von der gebrochenen Marke weg ist – in Prozent und in ATR
 *     (Durchschnitt der letzten 14 True Ranges), damit ein ruhiger und ein wilder Markt vergleichbar sind.
 *
 * Die Note zählt Gründe, sie bewertet keine Gewinnchance: A+ = Ausbruch + Volumen ≥ 2× + Trend, A = Ausbruch + Volumen ≥ 1,5× +
 * Trend, B = Ausbruch + einer der beiden, C = nur der Ausbruch. Ohne Ausbruch gibt es keine Note.
 *
 * Was fehlt, wird gesagt und nie geschätzt: zu wenige Kerzen für den EMA → Trend „nicht bestimmbar“; eine Lücke in den Kerzen →
 * „Keine Kerzen für diese Sitzung“.
 */
import { atrOf, closedUpTo, entryTimer } from "@/domain/plan/entry";
import { latestSession, sessionDay, type SessionDay } from "@/domain/plan/sessions";
import { addDays, BERLIN, clockIn, dayKeyIn, MIN } from "@/domain/plan/time";
import { ema } from "@/domain/signals/indicators";
import type { Side } from "@/domain/types";
import type { Candle } from "@/market/types";

export const BREAKOUT_RULES = {
  /** candle length */
  intervalMs: 5 * MIN,
  interval: "5m",
  /** first minutes of the session = the range */
  rangeMinutes: 30,
  /** a breakout counts this long after the session open (the Handelsplan's default for crypto) */
  searchMinutes: 240,
  atrBars: 14,
  emaBars: 50,
  volumeBars: 20,
  volumeOk: 1.5,
  volumeStrong: 2,
  /** candles asked per market: ~41 h – the current or the previous session plus the EMA's run-up */
  bars: 499,
  /** stop of the calculator prefill when the range edge is on the wrong side */
  atrStop: 1.5,
} as const;

/** The twelve markets of the scan (USDT perpetuals). A fixed, short list – said on the page; never "the whole market". */
export const BREAKOUT_BASES = ["BTC", "ETH", "SOL", "XRP", "BNB", "DOGE", "ADA", "AVAX", "LINK", "LTC", "SUI", "TON"] as const;
export const BREAKOUT_SYMBOLS: readonly string[] = BREAKOUT_BASES.map((b) => `${b}USDT`);

export type BreakoutSessionId = "newyork" | "london";
export const BREAKOUT_SESSIONS: readonly BreakoutSessionId[] = ["newyork", "london"];

export type BreakoutGrade = "A+" | "A" | "B" | "C";
export const GRADE_RANK: Readonly<Record<BreakoutGrade, number>> = { "A+": 4, A: 3, B: 2, C: 1 };

/**
 * breakout = a closed candle beyond the range; inside = no breakout yet, the search window still runs; expired = the window is
 * over without a breakout; no-data = the candles of the session are missing or have a hole.
 */
export type BreakoutStatus = "breakout" | "inside" | "expired" | "no-data";

export interface BreakoutRead {
  symbol: string;
  /** "BTC" of "BTCUSDT" */
  base: string;
  status: BreakoutStatus;
  /** one line: where the market stands, in words */
  statusText: string;
  side: Side | null;
  grade: BreakoutGrade | null;
  /** the three reasons: `null` = cannot be told from the candles at hand */
  reasons: { breakout: boolean; volume: boolean | null; trend: boolean | null };
  /** breakout candle volume ÷ mean of the 20 closed candles before it */
  volumeX: number | null;
  range: { high: number; low: number; startMs: number; endMs: number } | null;
  /** the range edge that broke */
  level: number | null;
  signal: { barOpen: number; barClose: number; price: number } | null;
  /** close of the newest closed candle */
  price: number | null;
  /** open time of that candle + its length (ms) */
  priceAt: number | null;
  /** change against the close 24 h before, percent; `null` when that candle is not loaded */
  change24h: number | null;
  atr: number | null;
  /**
   * Distance of `price` from the mark: after a breakout from the broken edge in the breakout's direction (negative = back
   * inside the range); without one, to the nearer edge (always ≥ 0 inside the range).
   */
  distPct: number | null;
  distAtr: number | null;
  /** without a breakout: which edge is nearer */
  nearEdge: "high" | "low" | null;
  /** the session that was read */
  session: { id: BreakoutSessionId; label: string; openMs: number; previousDay: boolean };
  /** the why, in sentences with the numbers; clock times in the reader's zone (`AnalyzeInput.timeZone`) */
  why: string[];
  /** closed candles for the mini chart: a few before the range up to the newest */
  preview: Candle[];
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const n1 = (x: number): string => x.toFixed(1).replace(".", ",");
const n2 = (x: number): string => x.toFixed(2).replace(".", ",");
/** a price in words with the places its size needs */
const priceWords = (p: number): string => {
  const d = p >= 10_000 ? 0 : p >= 1000 ? 1 : p >= 100 ? 2 : p >= 1 ? 3 : 5;
  return p.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
};

/**
 * The session to read at `now`: today's, once its range and one more candle can be closed; before that the session of the
 * day before (the page says "gestern"). So a scan in the morning shows yesterday's New York session instead of nothing.
 */
export function pickSession(id: BreakoutSessionId, now: number): { day: SessionDay; previousDay: boolean } {
  const R = BREAKOUT_RULES;
  const latest = latestSession(id, now, R.searchMinutes);
  const day = now >= latest.openMs + R.rangeMinutes * MIN + R.intervalMs ? latest : sessionDay(id, addDays(latest.dayKey, -1), R.searchMinutes);
  // "gestern": the session's calendar day (in its own zone) is not the day of `now`
  return { day, previousDay: day.dayKey !== dayKeyIn(now, day.tz) };
}

export function gradeOf(reasons: BreakoutRead["reasons"], volumeX: number | null): BreakoutGrade | null {
  if (!reasons.breakout) return null;
  const strong = volumeX != null && volumeX >= BREAKOUT_RULES.volumeStrong;
  if (reasons.volume && reasons.trend) return strong ? "A+" : "A";
  if (reasons.volume || reasons.trend) return "B";
  return "C";
}

export interface AnalyzeInput {
  symbol: string;
  candles: readonly Candle[];
  sessionId: BreakoutSessionId;
  now: number;
  /** zone of the clock times in the words (default Berlin, like the Handelsplan) */
  timeZone?: string;
}

/** One market: the reading of its session at `now`. */
export function analyzeBreakout(i: AnalyzeInput): BreakoutRead {
  const R = BREAKOUT_RULES;
  const iv = R.intervalMs;
  const { day, previousDay } = pickSession(i.sessionId, i.now);
  const closed = closedUpTo(i.candles, iv, i.now).filter((c) => [c.open, c.high, c.low, c.close].every(fin));
  const last = closed[closed.length - 1] ?? null;
  const base = i.symbol.replace(/USDT$/, "");
  const session = { id: i.sessionId, label: day.label, openMs: day.openMs, previousDay };
  const price = last?.close ?? null;
  const priceAt = last ? last.time + iv : null;
  const dayAgo = last ? closed.find((c) => c.time === last.time - 24 * 60 * MIN) : undefined;
  const change24h = last && dayAgo && dayAgo.close > 0 ? (last.close / dayAgo.close - 1) * 100 : null;
  const atr = atrOf(closed, R.atrBars)?.value ?? null;
  const blank: BreakoutRead = {
    symbol: i.symbol,
    base,
    status: "no-data",
    statusText: "Keine Kerzen für diese Sitzung",
    side: null,
    grade: null,
    reasons: { breakout: false, volume: null, trend: null },
    volumeX: null,
    range: null,
    level: null,
    signal: null,
    price,
    priceAt,
    change24h,
    atr,
    distPct: null,
    distAtr: null,
    nearEdge: null,
    session,
    why: [],
    preview: [],
  };

  const t = entryTimer({ symbol: i.symbol, candles: i.candles, intervalMs: iv, session: day, now: i.now, orMinutes: R.rangeMinutes, sides: "both", minVolumeX: null });
  const range = t.range && t.range.complete ? { high: t.range.high, low: t.range.low, startMs: t.range.startMs, endMs: t.range.endMs } : null;
  if (!range || price == null || t.status === "no-data" || t.status === "invalid" || t.status === "closed" || t.status === "not-open" || t.status === "forming") {
    return { ...blank, why: ["Für diese Sitzung fehlen 5-Minuten-Kerzen (eine Lücke in den Daten, oder die Spanne ist noch nicht geschlossen). Ohne sie lassen sich Hoch und Tief nicht bestimmen – die App schätzt nichts."] };
  }
  const preview = closed.filter((c) => c.time >= range.startMs - 6 * iv).slice(-96);
  const yesterday = previousDay ? " (gestern)" : "";
  const T = (ms: number): string => clockIn(ms, i.timeZone ?? BERLIN);
  const P = (x: number): string => priceWords(x);
  const rangeLine = `Spanne von ${T(range.startMs)} bis ${T(range.endMs)} Uhr: Hoch ${P(range.high)}, Tief ${P(range.low)}.`;

  if (t.status === "triggered" && t.signal) {
    const sig = t.signal;
    const idx = closed.findIndex((c) => c.time === sig.barOpen);
    const before = idx >= 0 ? closed.slice(Math.max(0, idx - R.volumeBars), idx) : [];
    const vols = before.map((c) => c.volume).filter((v) => fin(v) && v > 0);
    const bar = idx >= 0 ? closed[idx]! : null;
    const volumeX = bar && vols.length === R.volumeBars && fin(bar.volume) && bar.volume > 0 ? bar.volume / (vols.reduce((s, v) => s + v, 0) / vols.length) : null;
    // the EMA needs its run-up: with fewer than 50 closed candles up to the breakout it is not said
    const emaAt = idx + 1 >= R.emaBars ? ema(closed.slice(0, idx + 1).map((c) => c.close), R.emaBars)[idx]! : null;
    const trend = emaAt != null && fin(emaAt) ? (sig.side === "long" ? sig.price > emaAt : sig.price < emaAt) : null;
    const reasons = { breakout: true, volume: volumeX == null ? null : volumeX >= R.volumeOk, trend };
    const dir = sig.side === "long" ? 1 : -1;
    const dist = (price - sig.level) * dir;
    const why = [
      rangeLine,
      `Die Kerze ${T(sig.barOpen)} ist um ${T(sig.barClose)} Uhr geschlossen. Ihr Schluss ${P(sig.price)} liegt ${sig.side === "long" ? "über dem Hoch" : "unter dem Tief"} der Spanne (${P(sig.level)}), ${n2(sig.beyondPct * 100)} % darüber hinaus. Gezählt wird der Schluss, kein Docht.`,
    ];
    why.push(
      volumeX == null
        ? `Volumen: nicht bestimmbar – vor der Ausbruchskerze liegen keine ${R.volumeBars} geschlossenen Kerzen mit Volumen vor.`
        : `Volumen der Ausbruchskerze: ${n1(volumeX)}× der Durchschnitt der ${R.volumeBars} Kerzen davor (bestätigt ab ${n1(R.volumeOk)}×).`,
    );
    why.push(
      trend == null
        ? `Trend: nicht bestimmbar – für den EMA ${R.emaBars} fehlen Kerzen.`
        : `Trend: Der Schluss liegt ${sig.side === "long" ? (trend ? "über" : "unter") : trend ? "unter" : "über"} dem EMA ${R.emaBars} – ${trend ? "passt zur Richtung" : "gegen die Richtung"}.`,
    );
    if (dist < 0) why.push("Der letzte Schluss liegt wieder innerhalb der Spanne.");
    return {
      ...blank,
      status: "breakout",
      statusText: `${sig.side === "long" ? "Long" : "Short"}-Ausbruch um ${T(sig.barClose)}${yesterday}`,
      side: sig.side,
      grade: gradeOf(reasons, volumeX),
      reasons,
      volumeX,
      range,
      level: sig.level,
      signal: { barOpen: sig.barOpen, barClose: sig.barClose, price: sig.price },
      distPct: (dist / sig.level) * 100,
      distAtr: atr && atr > 0 ? dist / atr : null,
      why,
      preview,
    };
  }

  // no breakout: where the last close stands against the range
  const toHigh = range.high - price;
  const toLow = price - range.low;
  const nearEdge: "high" | "low" = toHigh <= toLow ? "high" : "low";
  const edge = nearEdge === "high" ? range.high : range.low;
  const gap = Math.abs(price - edge);
  const expired = t.status === "expired";
  const beyond = price > range.high ? "über" : price < range.low ? "unter" : null;
  const statusText = expired
    ? `Kein Ausbruch in dieser Sitzung${yesterday}`
    : beyond
      ? `${beyond === "über" ? "Über" : "Unter"} der Spanne, noch ohne Schluss`
      : "In der Spanne – noch kein Ausbruch";
  return {
    ...blank,
    status: expired ? "expired" : "inside",
    statusText,
    range,
    distPct: (gap / edge) * 100,
    distAtr: atr && atr > 0 ? gap / atr : null,
    nearEdge,
    why: [
      rangeLine,
      expired
        ? `Bis ${T(day.cutoffMs)} Uhr (${R.searchMinutes} Minuten nach Sitzungsbeginn) ist keine Kerze außerhalb der Spanne geschlossen – nach dieser Regel gibt es in dieser Sitzung keinen Ausbruch.`
        : `Bisher ist keine Kerze außerhalb der Spanne geschlossen. Gesucht wird bis ${T(day.cutoffMs)} Uhr; eine laufende Kerze zählt erst nach ihrem Schluss.`,
      `Letzter Schluss ${P(price)}: ${n2((gap / edge) * 100)} % ${beyond ? "jenseits des" : "bis zum"} ${nearEdge === "high" ? "Hoch" : "Tief"}.`,
    ],
    preview,
  };
}

const STATUS_RANK: Readonly<Record<BreakoutStatus, number>> = { breakout: 3, inside: 2, expired: 1, "no-data": 0 };

/** Order of the finished scan: most reasons first, then the stronger volume, then A–Z. A position in a sorting – no advice. */
export function rankReads(reads: readonly BreakoutRead[]): BreakoutRead[] {
  return [...reads].sort(
    (a, b) =>
      STATUS_RANK[b.status] - STATUS_RANK[a.status] ||
      (b.grade ? GRADE_RANK[b.grade] : 0) - (a.grade ? GRADE_RANK[a.grade] : 0) ||
      (b.volumeX ?? 0) - (a.volumeX ?? 0) ||
      (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0),
  );
}

export interface CalcPrefill {
  pair: string;
  side: Side;
  /** the last closed price */
  entry: number;
  stop: number;
  /** where the stop comes from: the other edge of the range, or 1,5 ATR when that edge is on the wrong side of the price */
  stopFrom: "range" | "atr";
}

/** What the calculator is prefilled with from a breakout. `null` without a breakout, or when no stop can be named. */
export function calcPrefill(r: BreakoutRead): CalcPrefill | null {
  if (r.status !== "breakout" || !r.side || !r.range || r.price == null || !(r.price > 0)) return null;
  const edge = r.side === "long" ? r.range.low : r.range.high;
  const ok = r.side === "long" ? edge < r.price : edge > r.price;
  if (ok) return { pair: r.symbol, side: r.side, entry: r.price, stop: edge, stopFrom: "range" };
  if (!r.atr || !(r.atr > 0)) return null;
  const stop = r.price - (r.side === "long" ? 1 : -1) * BREAKOUT_RULES.atrStop * r.atr;
  return stop > 0 ? { pair: r.symbol, side: r.side, entry: r.price, stop, stopFrom: "atr" } : null;
}
