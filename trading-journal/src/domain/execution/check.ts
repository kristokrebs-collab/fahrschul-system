/**
 * Ausführbarkeit (F44), the check of a planned order against one order-book snapshot: how tight the spread is, whether the
 * book carries the size, what the stop fill would cost beyond the best price – held against the slippage the plan ASSUMED
 * (`settings.risk` → `slippagePct`) – and how large the order is next to the day's turnover. Pure and deterministic.
 *
 * The words (tight / normal / wide, thresholds in bp) are rules of thumb of this app, not an exchange rule; they are
 * exported so the card can say them. The check describes ONE moment of the book: it is no promise that an order will fill at
 * these prices, and a failure to read the book is never a green light (the card says „keine Daten“).
 */
import { bandOf, marketImpact, touchOf, type Band, type Book, type Impact, type Touch } from "./book";

export type Tone = "ok" | "warn" | "bad" | "unknown";

/** Spread up to this many bp = „eng“, up to the next = „normal“, up to the third = „weit“, beyond = „sehr weit“. */
export const SPREAD_TIGHT_BPS = 2;
export const SPREAD_NORMAL_BPS = 10;
export const SPREAD_WIDE_BPS = 30;
/** An order above this share of the 24 h turnover is „groß im Verhältnis zum Tagesumsatz“; above the second „sehr groß“. */
export const TURNOVER_LARGE = 0.005;
export const TURNOVER_HUGE = 0.02;
/** The bands around the middle the depth is read at (fractions). */
export const BAND_PCTS = [0.001, 0.005, 0.01] as const;

export type SpreadWord = "eng" | "normal" | "weit" | "sehr weit";

export function spreadWord(bps: number): { word: SpreadWord; tone: Tone } {
  if (bps <= SPREAD_TIGHT_BPS) return { word: "eng", tone: "ok" };
  if (bps <= SPREAD_NORMAL_BPS) return { word: "normal", tone: "ok" };
  if (bps <= SPREAD_WIDE_BPS) return { word: "weit", tone: "warn" };
  return { word: "sehr weit", tone: "bad" };
}

export interface ExecInput {
  book: Book;
  side: "long" | "short";
  /** order size in base units */
  qty: number;
  /** the slippage the plan assumes at the stop, as a fraction (0,0005 = 5 bp) */
  assumedSlippage: number;
  /** turnover of the last 24 h in quote currency, `null` when not known */
  quoteVolume24h: number | null;
}

export type FindingId = "spread" | "depth" | "assumption" | "turnover";
export interface Finding {
  id: FindingId;
  tone: Tone;
}

export interface ExecCheck {
  touch: Touch | null;
  spread: { word: SpreadWord; tone: Tone } | null;
  bands: Band[];
  /** opening the position: a long buys, a short sells */
  entry: Impact | null;
  /** closing it at the stop: a long sells, a short buys */
  stop: Impact | null;
  assumedBps: number;
  /** the stop fill's distance from the middle in bp (half the spread plus the impact) – the number held against the assumption */
  measuredBps: number | null;
  assumption: "covered" | "low" | "unknown";
  /** order value ÷ 24 h turnover, `null` without either */
  turnover: number | null;
  findings: Finding[];
  /** the worst tone of the findings that could be read; `unknown` when none could */
  tone: Tone;
}

const worse = (a: Tone, b: Tone): Tone => {
  const rank: Record<Tone, number> = { unknown: -1, ok: 0, warn: 1, bad: 2 };
  return rank[b] > rank[a] ? b : a;
};

export function checkExecution(i: ExecInput): ExecCheck {
  const touch = touchOf(i.book);
  const buyFirst = i.side === "long";
  const entry = marketImpact(i.book, buyFirst ? "buy" : "sell", i.qty);
  const stop = marketImpact(i.book, buyFirst ? "sell" : "buy", i.qty);
  const bands = touch ? BAND_PCTS.map((p) => bandOf(i.book, touch.mid, p)) : [];
  const assumedBps = i.assumedSlippage * 10_000;
  const measuredBps = stop?.complete ? stop.fromMidBps : null;
  const assumption: ExecCheck["assumption"] = measuredBps === null ? "unknown" : measuredBps <= assumedBps ? "covered" : "low";
  const value = touch ? i.qty * touch.mid : null;
  const turnover = value !== null && i.quoteVolume24h !== null && i.quoteVolume24h > 0 ? value / i.quoteVolume24h : null;

  const findings: Finding[] = [];
  const sp = touch ? spreadWord(touch.spreadBps) : null;
  findings.push({ id: "spread", tone: sp ? sp.tone : "unknown" });
  const depthTone: Tone = !entry || !stop ? "unknown" : entry.complete && stop.complete ? "ok" : "bad";
  findings.push({ id: "depth", tone: depthTone });
  findings.push({ id: "assumption", tone: assumption === "unknown" ? "unknown" : assumption === "covered" ? "ok" : "warn" });
  findings.push({ id: "turnover", tone: turnover === null ? "unknown" : turnover > TURNOVER_HUGE ? "bad" : turnover > TURNOVER_LARGE ? "warn" : "ok" });

  return { touch, spread: sp, bands, entry, stop, assumedBps, measuredBps, assumption, turnover, findings, tone: findings.reduce<Tone>((t, f) => worse(t, f.tone), "unknown") };
}
