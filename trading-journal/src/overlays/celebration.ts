import type { Trade } from "@/domain/types";
import { tradeTime } from "@/lib/dates";
import type { CelebrateKind } from "@/store/uiStore";

/** R-multiple from which a single win counts as a big one (larger burst). */
export const BIG_WIN_R = 2;
/** Consecutive realised wins (including the saved one) that count as a streak. */
export const STREAK_WINS = 3;

type Outcome = Pick<Trade, "pnl" | "status">;
type Saved = Outcome & Pick<Trade, "r" | "date"> & { id?: string; createdAt?: string };

function realised<T extends Outcome>(t: T): t is T & { pnl: number } {
  return t.status !== "open" && t.pnl != null && Number.isFinite(t.pnl);
}

/**
 * Which confetti burst saving `saved` earns, or `null` for none:
 * - only a realised win (`pnl > 0`, not open) celebrates, and an edit only when it turns the trade into a win
 *   (`before` was open, flat or a loss) – re-saving a win to fix a typo stays quiet;
 * - `record`: the journal's total P&L after the save is above every running high of the equity curve before it;
 * - `streak`: a big win (`r ≥ BIG_WIN_R`) or the third realised win in a row (by trade time);
 * - `win` otherwise.
 * `trades` is the journal BEFORE the save (the saved trade's old version, if any, is ignored by id).
 */
export function winCelebration(trades: readonly Trade[], saved: Saved, before?: Outcome | null): CelebrateKind | null {
  if (!realised(saved) || saved.pnl <= 0) return null;
  if (before && realised(before) && before.pnl > 0) return null;

  const others = trades.filter((t) => t.id !== saved.id).filter(realised);
  others.sort((a, b) => +tradeTime(a) - +tradeTime(b));
  if (others.length > 0) {
    let equity = 0;
    let peak = 0;
    for (const t of others) {
      equity += t.pnl;
      peak = Math.max(peak, equity);
    }
    if (equity + saved.pnl > peak) return "record";
  }

  if (saved.r != null && saved.r >= BIG_WIN_R) return "streak";
  const at = +tradeTime(saved);
  const prior = others.filter((t) => +tradeTime(t) <= at).slice(-(STREAK_WINS - 1));
  if (prior.length === STREAK_WINS - 1 && prior.every((t) => t.pnl > 0)) return "streak";
  return "win";
}
