/**
 * Canvas snapshot of the hero's equity curve (P04): when the period switches, the OLD curve is painted with the same
 * geometry as `EquityDraw` (`equityPoints`, same pad and baseline) onto an opaque canvas, and `playStripWipe` peels it
 * away strip by strip over the new, already drawn curve. One layout read (the host size) per switch, nothing per frame.
 */
import { EQUITY_DRAW, equityPoints } from "@/motion/fx/EquityDraw";
import { FX_HEX } from "@/motion/fx/shared";

/** Surface behind the curve (`bg-ink-950` of the chart well) – the snapshot must be opaque. */
export const WELL_HEX = "#040404";

export type CurveTone = "win" | "loss" | "fg";

/** Tone `EquityDraw` resolves for `tone="auto"`. */
export function curveTone(values: readonly number[]): CurveTone {
  const vs = values.filter((v) => Number.isFinite(v));
  const first = vs[0];
  const last = vs[vs.length - 1];
  if (first == null || last == null || first === last) return "fg";
  return last > first ? "win" : "loss";
}

/** Paints `values` into a new `w × h` canvas (device pixels), or null without a 2D context (jsdom). */
export function paintEquity(values: readonly number[], w: number, h: number, dpr = 1): HTMLCanvasElement | null {
  if (typeof document === "undefined" || w <= 0 || h <= 0) return null;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = c.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  ctx.scale(dpr, dpr);
  ctx.fillStyle = WELL_HEX;
  ctx.fillRect(0, 0, w, h);
  const base = values.find((v) => Number.isFinite(v));
  const pts = equityPoints(values, w, h, EQUITY_DRAW.pad, base);
  if (pts.length < 2) return c;
  const color = FX_HEX[curveTone(values)];
  // baseline (dashed reference at the first value)
  const by = equityPoints([...values, base ?? 0], w, h, EQUITY_DRAW.pad, base).at(-1)!.y;
  ctx.save();
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = "#2c2c2c";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, by);
  ctx.lineTo(w, by);
  ctx.stroke();
  ctx.restore();
  // soft area
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, `${color}38`);
  grad.addColorStop(1, `${color}00`);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, h);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(pts[pts.length - 1]!.x, h);
  ctx.closePath();
  ctx.fill();
  // line + head
  ctx.strokeStyle = color;
  ctx.lineWidth = EQUITY_DRAW.stroke;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  const end = pts[pts.length - 1]!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(end.x, end.y, EQUITY_DRAW.head, 0, Math.PI * 2);
  ctx.fill();
  return c;
}
