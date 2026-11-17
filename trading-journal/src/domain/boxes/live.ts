/**
 * Live span of the newest box after a breakout (P02 box fix). Pure, no React.
 *
 * The engine ends a box at its last bar before the breakout close (`i1`). When the market comes back into the box
 * (`inside` / `failed`), the box is the reference again – but the bars that closed OUTSIDE it in between are no part
 * of it. A chart therefore draws the box up to its breakout and again from the first bar of the CURRENT run of closes
 * inside its edges (± the breakout buffer) to the live edge, never across the excursion.
 */
import type { Bar } from "../signals/indicators";
import { DEFAULT_BOX_CFG, type Box, type BoxCfg } from "./engine";

/**
 * Index (in `bars`, the bars the box was found on) of the first bar of the current run of closes inside the broken box
 * `box` (± `breakAtr` × the box's ATR, the engine's breakout buffer). `null` when there is no box, the box is unbroken
 * (it runs to the live edge itself) or the last close is outside it.
 */
export function reentryIndex(bars: readonly Bar[], box: Box | null | undefined, cfg: Pick<BoxCfg, "breakAtr"> = DEFAULT_BOX_CFG): number | null {
  if (!box || box.brk === 0 || bars.length === 0) return null;
  const buf = cfg.breakAtr * box.atr;
  const inside = (c: number): boolean => c <= box.top + buf && c >= box.bottom - buf;
  let i = bars.length - 1;
  if (i <= box.i1 || !inside(bars[i]!.c)) return null;
  while (i - 1 > box.i1 && inside(bars[i - 1]!.c)) i--;
  return i;
}
