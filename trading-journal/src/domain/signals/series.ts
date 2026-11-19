/**
 * Per-bar MCB events of a whole series (chart markers). Same WaveTrend and event conditions as the check.
 */
import type { SignalCfg } from "./config";
import { waveTrend, type Bar } from "./indicators";
import { mcbEvents, type WtKind } from "./mcb";

export interface McbPoint {
  /** open time of the bar, unix SECONDS */
  t: number;
  kind: WtKind;
}

/** Kinds drawn as chart dots by default (the big MCB dots); `bull` / `bear` are the small crosses. */
export const MAJOR_KINDS: ReadonlySet<WtKind> = new Set<WtKind>(["bottom", "top", "buy", "sell"]);

/**
 * Every MCB event of `bars` (ascending). `minor` adds the small `bull` / `bear` crosses. A series shorter than
 * `revRange + 2` bars yields only crosses (Bottom/Top need the reversal window), like the check itself.
 */
export function mcbSeries(bars: readonly Bar[], cfg: SignalCfg, opts: { minor?: boolean } = {}): McbPoint[] {
  if (bars.length < 3) return [];
  const { wt1, wt2 } = waveTrend(bars, cfg);
  const close = bars.map((b) => b.c);
  const out: McbPoint[] = [];
  for (const e of mcbEvents(wt1, wt2, cfg, close)) {
    if (!opts.minor && !MAJOR_KINDS.has(e.kind)) continue;
    out.push({ t: bars[e.index]!.t, kind: e.kind });
  }
  return out;
}
