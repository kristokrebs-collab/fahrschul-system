/**
 * Box-zu-Box analysis → the chart's `ChartBox[]` (Markt chart and the overview's "Boxen" layer). Pure, no
 * lightweight-charts import (type only), so it can live in the main chunk.
 *
 * - every box of the analysis; broken ones in their tone (up = win, down = loss), the others neutral;
 * - the newest box is the active one: brighter, caption `Box stark`, its edges on the axis, open to the live edge while
 *   the market trades inside it (also after a failed breakout); provisional (dashed, soft) while the live price is beyond
 *   an edge before the close (`pending`);
 * - targets of the active box: the best setup's targets + stop (`T1`, `T2`, `Stop`); without a setup the nearest
 *   target in each direction (`↑ T1`, `↓ T1`).
 */
import type { ChartBox, ChartBoxTarget } from "@/chart/primitives/BoxPrimitive";
import { boxIdOf, type BoxAnalysis, type BoxSetup } from "@/domain/boxes";

export interface ToChartBoxesOptions {
  /** bar length of the analysis timeframe (ms): a finished box ends at the end of its last bar */
  intervalMs: number;
  /** draw the targets of the active box (default true) */
  targets?: boolean;
  /** the setup whose targets / stop are drawn (default: the analysis' best) */
  setup?: BoxSetup | null;
}

const GRADE_WORD: Readonly<Record<string, string>> = { stark: "stark", solide: "solide", schwach: "schwach" };

function targetsOf(a: BoxAnalysis, setup: BoxSetup | null): ChartBoxTarget[] {
  if (setup) {
    const out: ChartBoxTarget[] = setup.targets.slice(0, 3).map((t, k) => ({ price: t.price, kind: "tp", label: `T${k + 1}` }));
    out.push({ price: setup.stop, kind: "sl", label: "Stop" });
    return out;
  }
  const st = a.box;
  if (st.dir !== 0) return st.targets.slice(0, 3).map((t, k) => ({ price: t.price, kind: "tp", label: `T${k + 1}` }));
  const out: ChartBoxTarget[] = [];
  if (st.up[0]) out.push({ price: st.up[0].price, kind: "tp", label: "↑ T1" });
  if (st.down[0]) out.push({ price: st.down[0].price, kind: "tp", label: "↓ T1" });
  return out;
}

/** The boxes of one analysis as chart boxes (oldest first, the newest is active). */
export function toChartBoxes(a: BoxAnalysis | null | undefined, o: ToChartBoxesOptions): ChartBox[] {
  if (!a) return [];
  const st = a.box;
  const n = st.boxes.length;
  const setup = o.setup === undefined ? (a.best?.best ? a.best : (a.setups.find((s) => s.kind !== "pre") ?? null)) : o.setup;
  return st.boxes.map((b, k): ChartBox => {
    const active = k === n - 1;
    // the newest box stays the reference while the market trades inside it (also after a failed breakout)
    const open = active && (b.brk === 0 || st.phase === "inside" || st.phase === "failed");
    const pending = open && st.pending !== 0;
    const dir = active && st.dir !== 0 ? st.dir : open ? 0 : b.brk;
    const tone = pending ? (st.pending > 0 ? "win" : "loss") : dir > 0 ? "win" : dir < 0 ? "loss" : "neutral";
    return {
      id: boxIdOf(a.tf, b) ?? `${a.tf}:${b.t0}`,
      from: b.t0 * 1000,
      to: open ? null : b.t1 * 1000 + o.intervalMs,
      top: b.top,
      btm: b.bottom,
      tone,
      state: pending ? "provisional" : "confirmed",
      active,
      label: active ? `Box ${GRADE_WORD[b.grade] ?? b.grade}` : undefined,
      targets: active && o.targets !== false ? targetsOf(a, setup) : undefined,
    };
  });
}

/** Content key of chart boxes (the chart re-sets them only when this changes). */
export function chartBoxesKey(boxes: readonly ChartBox[]): string {
  return boxes.map((b) => `${b.id}:${b.to ?? "∞"}:${b.tone}:${b.state ?? ""}:${b.active ? 1 : 0}:${(b.targets ?? []).map((t) => `${t.label}${t.price}`).join(",")}`).join("|");
}
