/**
 * Applies optional filters to ANY lab strategy (F17): the wrapper asks the original strategy at the close of bar i and
 * lets its signal through only when every active filter says yes at that same close. A signal the filter rejects is gone
 * – it does not come back at a later bar (an edge-triggered rule has no second edge; a Box-zu-Box idea counts as seen).
 * The wrapper counts, per filter, how many signals it rejected and how many it could not judge (unknown).
 */
import { KIND_TAG } from "../../backtest/strategies/boxToBox";
import type { BtStrategy, EntrySignal } from "../../backtest/types";
import { FAIL, PASS, type SideMask } from "./masks";
import type { FilterId } from "./types";

export type Masks = Partial<Record<FilterId, SideMask>>;

export interface FilterCounts {
  /** signals the strategy handed over while the engine was asked (flat) */
  asked: number;
  /** let through / rejected (a rejected signal is counted once, whichever filters said no) */
  passed: number;
  blocked: number;
  /** of `blocked`: signals that two or more active filters would have rejected (the overlap) */
  blockedMulti: number;
  /** per filter: signals it said no to / could not judge (independent of the other filters) */
  by: Partial<Record<FilterId, { fail: number; unknown: number }>>;
}

type Verdict = "pass" | "fail" | "unknown";

function verdictOf(id: FilterId, masks: Masks, sig: EntrySignal, i: number): Verdict {
  if (id === "retest") return sig.tag.startsWith(KIND_TAG.retest) ? "pass" : "fail";
  const m = masks[id];
  if (!m) return "unknown";
  const v = (sig.side === "long" ? m.long : m.short)[i];
  return v === PASS ? "pass" : v === FAIL ? "fail" : "unknown";
}

export function applyFilters(inner: BtStrategy, active: readonly FilterId[], masks: Masks): { strategy: BtStrategy; counts: () => FilterCounts } {
  const counts: FilterCounts = { asked: 0, passed: 0, blocked: 0, blockedMulti: 0, by: {} };
  for (const id of active) counts.by[id] = { fail: 0, unknown: 0 };
  const strategy: BtStrategy = {
    start: inner.start,
    exitAt: inner.exitAt,
    signalAt(i: number): EntrySignal | null {
      const sig = inner.signalAt(i);
      if (!sig) return null;
      counts.asked++;
      let no = 0;
      for (const id of active) {
        const v = verdictOf(id, masks, sig, i);
        if (v === "pass") continue;
        no++;
        counts.by[id]![v === "fail" ? "fail" : "unknown"]++;
      }
      if (no === 0) {
        counts.passed++;
        return sig;
      }
      counts.blocked++;
      if (no > 1) counts.blockedMulti++;
      return null;
    },
  };
  const snapshot = (): FilterCounts => ({ ...counts, by: Object.fromEntries(Object.entries(counts.by).map(([k, v]) => [k, { ...v }])) });
  return { strategy, counts: snapshot };
}
