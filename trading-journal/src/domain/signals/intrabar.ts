/**
 * Intrabar memory (ours, proposal 1 of the TradingView check of 2026-10-08): an MCB event on a FORMING candle can come
 * and go with the price ("repaint"). The 1h Kaufsignal of 13:11–13:25 UTC vanished at 13:26; the user looked at 13:30
 * and the app said "kein Signal" while his chart (seen minutes earlier) had a green dot. Per rung and side the live
 * engine remembers the strongest event it saw on the current candle — kind, first / last sighting, price — and the card
 * shows it greyed while it is gone ("Kaufsignal intrabar 13:11–13:25 bei 82.466 · aktuell nicht gehalten"). The
 * memory is dropped when the candle closes; it never counts (0 in the verdict, the score and the bias).
 *
 * Pure: `noteIntrabar(memo, checks, at, price)` → the next memo (the same object when nothing changed), fed from the
 * engine's evaluations on 1m closes (`@/market`); `intrabarOf(memo, check, side)` → what the rung shows.
 */
import type { Side } from "./config";
import { WT_RANK, type WtKind } from "./mcb";
import type { TfCheck } from "./verdict";

/** One remembered forming-candle event. */
export interface IntrabarSighting {
  /** strongest kind seen on this candle (Bottom > Kaufsignal > Kreuz) */
  kind: WtKind;
  /** open time (unix SECONDS) of the candle it belongs to */
  bar: number;
  /** first / last evaluation that showed it, ms (the 1m close evaluated) */
  first: number;
  last: number;
  /** live price at the first / last sighting (`NaN` without one) */
  price: number;
  lastPrice: number;
}

/** Per timeframe and side. */
export type IntrabarMemo = Readonly<Record<string, Readonly<Partial<Record<Side, IntrabarSighting>>>>>;

export const EMPTY_INTRABAR: IntrabarMemo = Object.freeze({});

const SIDES: readonly Side[] = ["long", "short"];

/**
 * The memo after one evaluation at `at` (ms) with the live `price`: a rung whose forming candle shows an event of a side
 * starts or extends that side's sighting (the strongest kind wins; its first sighting stays); a sighting of an older
 * candle — or of a rung whose last bar is closed — is dropped. Returns `memo` itself when nothing changed.
 */
export function noteIntrabar(memo: IntrabarMemo, checks: readonly (TfCheck | null | undefined)[], at: number, price: number | null): IntrabarMemo {
  let out: Record<string, Partial<Record<Side, IntrabarSighting>>> | null = null;
  const put = (tf: string, v: Partial<Record<Side, IntrabarSighting>> | null): void => {
    if (!out) out = { ...memo } as Record<string, Partial<Record<Side, IntrabarSighting>>>;
    if (v && Object.keys(v).length) out[tf] = v;
    else delete out[tf];
  };
  const p = price != null && Number.isFinite(price) ? price : NaN;
  const seen = new Set<string>();
  for (const c of checks) {
    if (!c) continue;
    seen.add(c.tf);
    const prev = memo[c.tf];
    if (!c.forming) {
      if (prev) put(c.tf, null);
      continue;
    }
    const bar = c.closeAt;
    let next: Partial<Record<Side, IntrabarSighting>> | null = null;
    let changed = false;
    for (const side of SIDES) {
      const old = prev?.[side];
      const keep = old && old.bar === bar ? old : undefined;
      if (old && !keep) changed = true;
      const ev = c.conf?.[side]?.forming ?? null;
      let cur = keep;
      if (ev) {
        const kind = keep && WT_RANK[keep.kind] >= WT_RANK[ev.kind] ? keep.kind : ev.kind;
        cur = keep ? { ...keep, kind, last: at, lastPrice: p } : { kind, bar, first: at, last: at, price: p, lastPrice: p };
        changed = true;
      }
      if (cur) (next ??= {})[side] = cur;
    }
    if (changed) put(c.tf, next);
  }
  for (const tf of Object.keys(memo)) if (!seen.has(tf)) put(tf, null);
  return out ?? memo;
}

/**
 * The sighting a rung shows for `side`: one of the rung's current forming candle, while that side has NO event on the
 * rung now (state `none`) — a lit event (forming or closed) is shown as itself. `null` otherwise.
 */
export function intrabarOf(memo: IntrabarMemo | null | undefined, check: TfCheck | null | undefined, side: Side): IntrabarSighting | null {
  if (!memo || !check?.forming) return null;
  const s = memo[check.tf]?.[side];
  if (!s || s.bar !== check.closeAt) return null;
  const st = check.conf?.[side]?.state ?? "none";
  return st === "none" ? s : null;
}
