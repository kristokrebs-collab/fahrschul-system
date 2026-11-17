/**
 * Pure model of the trade replay (Journal v3, P06): which candles to load (entry − N … exit + N bars), where the entry /
 * exit sit in them, the running excursion per bar (`replaySteps`) and the timeline spans.
 */
import { replaySteps, type ReplayStep } from "@/domain/excursion";
import { fillStats } from "@/domain/fills";
import type { EnrichedTrade } from "@/domain/types";
import type { ScrubMarker, ScrubSpan } from "@/motion/pulse/ScrubTimeline";
import type { ReplayBar, ReplayTrade } from "@/chart/ReplayChart";

export type ReplayInterval = "15m" | "1h" | "4h";
export const REPLAY_INTERVALS: readonly ReplayInterval[] = ["15m", "1h", "4h"];
export const INTERVAL_MS: Record<ReplayInterval, number> = { "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000 };
/** Bars before the entry / after the exit: 60 % of the bars in the trade, at least 12, at most 60. */
export function padBars(barsInTrade: number): number {
  return Math.max(12, Math.min(60, Math.round(barsInTrade * 0.6)));
}

const ms = (local: string | undefined): number => (local ? new Date(local).getTime() : NaN);

/** Entry / exit time (ms) of a trade; open → `now`; closed without exit time → `null` (one bar is assumed). */
export function replayTimes(t: Pick<EnrichedTrade, "date" | "exitDate" | "status">, now = Date.now()): { from: number; to: number | null } {
  const from = ms(t.date);
  const to = t.status === "open" ? now : t.exitDate ? ms(t.exitDate) : null;
  return { from, to: to != null && Number.isFinite(to) && to >= from ? to : null };
}

/** Default interval: about 20–150 bars inside the trade. */
export function defaultReplayInterval(t: Pick<EnrichedTrade, "date" | "exitDate" | "status">, now = Date.now()): ReplayInterval {
  const { from, to } = replayTimes(t, now);
  const span = to != null ? to - from : 0;
  if (span <= 36 * 3_600_000) return "15m";
  if (span <= 10 * 86_400_000) return "1h";
  return "4h";
}

/** The candle window to load for `interval`. */
export function replayWindow(t: Pick<EnrichedTrade, "date" | "exitDate" | "status">, interval: ReplayInterval, now = Date.now()): { from: number; to: number } {
  const step = INTERVAL_MS[interval];
  const { from, to } = replayTimes(t, now);
  const end = to ?? from + 24 * step;
  const pad = padBars(Math.max(1, Math.round((end - from) / step)));
  return { from: from - pad * step, to: Math.min(now, end + pad * step) };
}

/** Index of the bar that contains `at` (open time ≤ at < next open), clamped into the data. */
export function barAt(bars: readonly Pick<ReplayBar, "time">[], at: number): number {
  if (!bars.length) return -1;
  let lo = 0;
  let hi = bars.length - 1;
  if (at <= bars[0]!.time) return 0;
  if (at >= bars[hi]!.time) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.time <= at) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface ReplayModel {
  trade: ReplayTrade;
  steps: ReplayStep[];
  spans: ScrubSpan[];
  markers: ScrubMarker[];
  /** total bars */
  total: number;
}

/** Everything the replay needs for loaded `bars`; `null` without an entry price / bars. */
export function buildReplay(t: EnrichedTrade, bars: readonly ReplayBar[], interval: ReplayInterval, now = Date.now()): ReplayModel | null {
  const avg = t.fills?.length ? fillStats(t.fills, t.side).avgEntry : null;
  const entry = avg ?? t.entry;
  if (!bars.length || entry == null || !(entry > 0)) return null;
  const { from, to } = replayTimes(t, now);
  const entryIndex = barAt(bars, from);
  const exitIndex = t.status === "open" || to == null ? null : barAt(bars, to);
  const step = INTERVAL_MS[interval];
  const steps = replaySteps(bars, { side: t.side, entry, stop: t.stop, exit: t.exit, from, to: to ?? bars[bars.length - 1]!.time, intervalMs: step });
  const total = bars.length;
  const end = exitIndex ?? total - 1;
  const tone = t.result === "win" ? "win" : t.result === "loss" ? "loss" : "fg";
  const spans: ScrubSpan[] = [
    { id: "before", label: "Vorlauf", start: 0, duration: entryIndex + 1, tone: "mute" },
    { id: "trade", label: t.status === "open" ? "Im Trade (läuft)" : "Im Trade", start: entryIndex + 1, duration: Math.max(1, end - entryIndex), tone, meta: t.r != null ? `${t.r > 0 ? "+" : ""}${t.r.toFixed(2).replace(".", ",")} R` : undefined },
  ];
  if (exitIndex != null && exitIndex < total - 1) spans.push({ id: "after", label: "Danach", start: exitIndex + 1, duration: total - exitIndex - 1, tone: "mute" });
  const markers: ScrubMarker[] = [{ at: entryIndex + 1, label: "Einstieg", tone: "fg" }];
  if (exitIndex != null) markers.push({ at: exitIndex + 1, label: "Ausstieg", tone: tone === "fg" ? "mute" : tone });
  return {
    trade: { side: t.side, entry, stop: t.stop, target: t.target, exit: t.exit, entryIndex, exitIndex, result: t.result },
    steps,
    spans,
    markers,
    total,
  };
}

/** Readout values after `n` shown bars. */
export function readoutAt(steps: readonly ReplayStep[], n: number): ReplayStep | null {
  if (n <= 0 || !steps.length) return null;
  return steps[Math.min(steps.length, Math.floor(n)) - 1] ?? null;
}

/** German phase label after `n` shown bars. */
export function phaseLabel(model: Pick<ReplayModel, "trade">, n: number): string {
  if (n <= model.trade.entryIndex) return "Vor dem Einstieg";
  if (model.trade.exitIndex != null && n > model.trade.exitIndex) return "Nach dem Ausstieg";
  return "Im Trade";
}
