/**
 * Box-zu-Box analysis → the chart's `ChartBox[]` (Markt chart and the overview's "Boxen" layer). Pure, no
 * lightweight-charts import (type only), so it can live in the main chunk.
 *
 * - every box of the analysis; broken ones in their tone (up = win, down = loss), the others neutral;
 * - the newest box is the active one: brighter, caption `Box stark`, its edges on the axis, open to the live edge while
 *   the market trades inside it; provisional (dashed, soft) while the live price is beyond an edge before the close
 *   (`pending`);
 * - a box covers only its own bars – never a bar that closed outside it: a finished box ends with its last bar; when the
 *   newest box broke out and the market came back (`inside` / `failed`), the box ends at the breakout and a second, live
 *   part (`{id}:live`) runs from the first bar of the current run of closes back inside (`liveFrom`, the store's
 *   `BoxTfView.liveFrom`) to the live edge;
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
  /** timeframe in the caption (`4h-Box stark`) – for a chart of another interval */
  tfLabel?: string;
  /**
   * ms: open of the first bar of the current run of closes back inside the newest box after its breakout
   * (`BoxTfView.liveFrom`); without it a re-entered box is drawn up to its breakout only
   */
  liveFrom?: number | null;
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
  return st.boxes.flatMap((b, k): ChartBox[] => {
    const active = k === n - 1;
    const id = boxIdOf(a.tf, b) ?? `${a.tf}:${b.t0}`;
    /** exclusive end of the box's last bar */
    const end = b.t1 * 1000 + o.intervalMs;
    // the newest box stays the reference while the market trades inside it (also after a failed breakout) …
    const inside = active && (b.brk === 0 || st.phase === "inside" || st.phase === "failed");
    // … unbroken it runs to the live edge; broken, only the current run of closes back inside does
    const open = inside && b.brk === 0;
    const liveFrom = inside && b.brk !== 0 && o.liveFrom != null && o.liveFrom >= end ? o.liveFrom : null;
    const pending = (open || liveFrom != null) && st.pending !== 0;
    const dir = active && st.dir !== 0 ? st.dir : inside ? 0 : b.brk;
    const tone = dir > 0 ? "win" : dir < 0 ? "loss" : "neutral";
    const pendingTone = st.pending > 0 ? "win" : "loss";
    const targets = active && o.targets !== false ? targetsOf(a, setup) : undefined;
    const label = active ? `${o.tfLabel ? `${o.tfLabel}-` : ""}Box ${GRADE_WORD[b.grade] ?? b.grade}` : undefined;
    const box: ChartBox = {
      id,
      from: b.t0 * 1000,
      to: open ? null : end,
      top: b.top,
      btm: b.bottom,
      tone: open && pending ? pendingTone : tone,
      state: open && pending ? "provisional" : "confirmed",
      active,
      label,
      targets: liveFrom == null ? targets : undefined,
    };
    if (liveFrom == null) return [box];
    // the live part: same edges, from the re-entry to the live edge; it carries the targets (they start at its end) and
    // shares the caption (the chart shows it once: on the first part in view with room for it)
    return [box, { id: `${id}:live`, from: liveFrom, to: null, top: b.top, btm: b.bottom, tone: pending ? pendingTone : tone, state: pending ? "provisional" : "confirmed", active: true, label, targets }];
  });
}

/** Content key of chart boxes (the chart re-sets them only when this changes). */
export function chartBoxesKey(boxes: readonly ChartBox[]): string {
  return boxes.map((b) => `${b.id}:${b.from}:${b.to ?? "∞"}:${b.tone}:${b.state ?? ""}:${b.active ? 1 : 0}:${(b.targets ?? []).map((t) => `${t.label}${t.price}`).join(",")}`).join("|");
}
