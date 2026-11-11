/**
 * Cases of the training (F38): which of the trader's own journal trades make a situation, where the chart has to end so
 * that the future stays hidden, which candles to load, and the queue of a session. Pure and deterministic (a seeded
 * shuffle, no clock inside).
 */
import { candleAt, simulateScenario, type ScenarioResult, type WhatIfBar, type WhatIfTrade } from "../whatif/simulate";
import type { Trade } from "../types";
import type { TrainingRound } from "./model";

export type CaseInterval = "15m" | "1h" | "4h";
export const CASE_INTERVALS: readonly CaseInterval[] = ["15m", "1h", "4h"];
export const CASE_INTERVAL_MS: Readonly<Record<CaseInterval, number>> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };

/** Candles the trader sees before the decision, and the minimum that makes a chart worth deciding on. */
export const LOOKBACK_BARS = 90;
export const MIN_VISIBLE_BARS = 20;
/** Candles loaded after the case's exit (the reveal shows the way on a little further). */
const AFTER_BARS = 24;
/** Cases per session. */
export const SESSION_SIZE = 6;

const ms = (local: string | undefined): number => (local ? new Date(local).getTime() : NaN);

/** The interval a case is practised on: the trade's own timeframe when it is one of ours, else by its duration. */
export function caseInterval(t: Pick<Trade, "timeframe" | "date" | "exitDate" | "status">): CaseInterval {
  if (CASE_INTERVALS.includes(t.timeframe as CaseInterval)) return t.timeframe as CaseInterval;
  const from = ms(t.date);
  const to = t.exitDate ? ms(t.exitDate) : NaN;
  const span = Number.isFinite(from) && Number.isFinite(to) ? to - from : 0;
  return span <= 36 * 3_600_000 ? "15m" : span <= 10 * 86_400_000 ? "1h" : "4h";
}

/** A trade can be a case when it is closed and has an entry price and time. */
export function caseEligible(t: Pick<Trade, "status" | "entry" | "date">): boolean {
  return t.status === "closed" && t.entry != null && t.entry > 0 && Number.isFinite(ms(t.date));
}

/** True when the trade carries the setup in the journal (the truth recognition is measured against). */
export const carriesSetup = (t: Pick<Trade, "setups">, setupId: string): boolean => (t.setups ?? []).includes(setupId);

/** The candle window to load: LOOKBACK before the entry … the exit (or 24 candles after the entry) + a little. */
export function caseWindow(t: Pick<Trade, "date" | "exitDate" | "status">, interval: CaseInterval, now: number): { from: number; to: number } {
  const step = CASE_INTERVAL_MS[interval];
  const entry = ms(t.date);
  const exit = t.exitDate ? ms(t.exitDate) : NaN;
  const end = Number.isFinite(exit) && exit >= entry ? exit : entry + 24 * step;
  return { from: entry - (LOOKBACK_BARS + 14) * step, to: Math.min(now, end + AFTER_BARS * step) };
}

export interface Decision {
  /** index of the candle the entry fell into – the first candle the trader does NOT see */
  entryIdx: number;
  /** candles shown while deciding: `bars[0 … visible − 1]`, all CLOSED before the entry */
  visible: number;
  /** open time of the last visible candle */
  anchorMs: number;
}

/** Where the picture ends: the last candle that closed before the entry. `null` without enough history before it. */
export function decisionAt(bars: readonly Pick<WhatIfBar, "time">[], entryMs: number, intervalMs: number): Decision | null {
  const entryIdx = candleAt(bars, entryMs, intervalMs);
  if (entryIdx < MIN_VISIBLE_BARS) return null;
  return { entryIdx, visible: entryIdx, anchorMs: bars[entryIdx - 1]!.time };
}

/** The candles the trader may see while deciding – never a candle from the entry on. */
export function visibleBars<T extends Pick<WhatIfBar, "time">>(bars: readonly T[], d: Decision): T[] {
  return bars.slice(Math.max(0, d.visible - LOOKBACK_BARS), d.visible);
}

/** The trader's plan on the real candles, for the comparison after the reveal: entry at the open after the decision, their stop, no target, until the case's trade ended. */
export function planOutcome(side: "long" | "short", stop: number, bars: readonly WhatIfBar[], d: Decision, intervalMs: number, caseExitMs: number | null): ScenarioResult | null {
  const entryBar = bars[d.entryIdx];
  if (!entryBar) return null;
  const trade: WhatIfTrade = { side, entry: entryBar.open, stop, target: null, exit: null, entryMs: entryBar.time, exitMs: caseExitMs, qty: null };
  return simulateScenario(trade, bars, intervalMs, { id: "plan", label: "Dein Plan", horizon: caseExitMs != null && candleAt(bars, caseExitMs, intervalMs) >= 0 ? { kind: "actual" } : { kind: "runOn" } });
}

/* ------------------------------------------------------------------ session queue */

/** mulberry32 – a tiny seeded PRNG (the same seed gives the same session). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(list: readonly T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface QueueCase {
  tradeId: string;
  /** the case carries the practised setup (else: a situation of another setup – "does MY setup apply here?") */
  positive: boolean;
}

/** How many cases of each kind a setup has in the journal (for the start screen). */
export function poolOf(trades: readonly Trade[], setupId: string): { positive: number; other: number } {
  let positive = 0;
  let other = 0;
  for (const t of trades) {
    if (!caseEligible(t)) continue;
    if (carriesSetup(t, setupId)) positive++;
    else other++;
  }
  return { positive, other };
}

/**
 * The cases of one session: about two thirds situations of the practised setup, the rest situations of OTHER setups (so
 * "Liegt mein Setup vor?" can be answered No) – when the journal has none, only the setup's own. Cases not practised yet
 * come before cases practised long ago; inside that the order is shuffled by `seed`. `firstTradeId` leads when eligible.
 */
export function buildQueue(opts: { trades: readonly Trade[]; setupId: string; rounds: readonly TrainingRound[]; seed: number; size?: number; firstTradeId?: string | null }): QueueCase[] {
  const size = Math.max(1, opts.size ?? SESSION_SIZE);
  const rnd = prng(opts.seed);
  const last = new Map<string, number>();
  for (const r of opts.rounds) if (r.setupId === opts.setupId) last.set(r.tradeId, Math.max(last.get(r.tradeId) ?? 0, Date.parse(r.createdAt) || 0));
  const rank = (ts: Trade[]): Trade[] => {
    const fresh = shuffle(
      ts.filter((t) => !last.has(t.id)),
      rnd,
    );
    const seen = shuffle(
      ts.filter((t) => last.has(t.id)),
      rnd,
    ).sort((a, b) => last.get(a.id)! - last.get(b.id)!);
    return [...fresh, ...seen];
  };
  const eligible = opts.trades.filter(caseEligible);
  const pos = rank(eligible.filter((t) => carriesSetup(t, opts.setupId)));
  const neg = rank(eligible.filter((t) => !carriesSetup(t, opts.setupId)));
  const wantNeg = neg.length ? Math.min(neg.length, Math.floor(size / 3)) : 0;
  const wantPos = Math.min(pos.length, size - wantNeg);
  const picked = [...pos.slice(0, wantPos).map((t) => ({ t, positive: true })), ...neg.slice(0, size - wantPos).map((t) => ({ t, positive: false }))];
  const mixed = shuffle(picked, rnd);
  const first = opts.firstTradeId ? eligible.find((t) => t.id === opts.firstTradeId) : undefined;
  const out: QueueCase[] = mixed.map(({ t, positive }) => ({ tradeId: t.id, positive }));
  if (first) {
    const rest = out.filter((c) => c.tradeId !== first.id);
    return [{ tradeId: first.id, positive: carriesSetup(first, opts.setupId) }, ...rest].slice(0, Math.max(size, 1));
  }
  return out;
}
