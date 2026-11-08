/**
 * The picture of the strategy search as DATA, so a test can prove that nothing in it is invented: the scene holds the real curves
 * of the result (cumulative R after costs per variant, the very arrays of `result.curves`), the scanner visits the variants in
 * their real order and the flashes are exactly the moments the running best score changed (recomputed from `result.rows`).
 * `framePlan(t)` says what is on screen at time `t`; `drawFrame` paints it on a 2D context. No loop lives here – the component
 * drives time and stops at the end.
 */
import type { SearchResult } from "@/domain/lab/search";

/** Length of the replay in ms (reduced motion and „Überspringen“ jump to the end). */
export const REPLAY_MS = 7200;
/** Phase borders as shares of the replay: scan · step back · into the final test. */
export const PHASE = { scanEnd: 0.6, backEnd: 0.76 } as const;

/** Real curves and scores of a result, in the order of the run. */
export interface Scene {
  /** variants drawn: `result.counts.variants` */
  n: number;
  /** the very arrays of the result (not copies) */
  curves: readonly (readonly number[])[];
  /** training score per variant (`null` = not qualified) */
  scores: readonly (number | null)[];
  isPoints: number;
  gridLen: number;
  /** id of the winner, `null` without one */
  winner: number | null;
  winnerCurve: readonly number[];
  /** the moments the running best changed: variant ids in scan order (ends on the winner) */
  flashes: readonly number[];
  /** the final test ended above / below its start, for the colour of the dashed part */
  oosEnd: number;
  passed: boolean;
}

/** Variant ids where the best training score so far changed while scanning 0 … n−1 (first of equals wins, like the selection). */
export function flashSequence(scores: readonly (number | null)[], winner: number | null): number[] {
  const out: number[] = [];
  let best = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    const s = scores[i];
    if (s != null && s > best) {
      best = s;
      out.push(i);
    }
  }
  // the selection uses unrounded scores: if rounding made two equal, the winner still closes the sequence
  if (winner != null && out[out.length - 1] !== winner) out.push(winner);
  return out;
}

export function sceneOf(result: Pick<SearchResult, "rows" | "curves" | "winner" | "verdict" | "counts">): Scene {
  const scores = result.rows.map((r) => r.isScore);
  const winner = result.winner?.variant.id ?? null;
  const wc = result.curves.winner;
  return {
    n: result.curves.is.length,
    curves: result.curves.is,
    scores,
    isPoints: result.curves.isPoints,
    gridLen: result.curves.grid.length,
    winner,
    winnerCurve: wc,
    flashes: flashSequence(scores, winner),
    oosEnd: (wc[wc.length - 1] ?? 0) - (wc[result.curves.isPoints - 1] ?? 0),
    passed: result.verdict.passed,
  };
}

export interface FramePlan {
  /** variants the scanner has visited (0 … n) */
  scanned: number;
  /** the variant that is the best so far (null before the first qualified one) */
  best: number | null;
  /** variants whose flash is still glowing, with their glow 0…1 */
  glow: readonly { id: number; a: number }[];
  /** the others' opacity factor (1 → 0.18 while they step back) */
  rest: number;
  /** winner line width factor 0…1 */
  emphasis: number;
  /** share of the winner's dashed run into the final test 0…1 */
  oos: number;
  done: boolean;
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const easeInOut = (x: number): number => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number): number => x * x;
const GLOW_MS = 260;

/** What is on screen at `t` ms (0 … REPLAY_MS). Pure. */
export function framePlan(scene: Scene, t: number, total = REPLAY_MS): FramePlan {
  const p = clamp01(t / total);
  const scanP = clamp01(p / PHASE.scanEnd);
  const scanned = p >= PHASE.scanEnd ? scene.n : Math.floor(easeInOut(scanP) * scene.n);
  let best: number | null = null;
  const glow: { id: number; a: number }[] = [];
  const tScan = total * PHASE.scanEnd;
  for (const id of scene.flashes) {
    if (id >= scanned) break;
    best = id;
    // when the scanner reached this variant (inverse of the eased sweep, by bisection)
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      if (Math.floor(easeInOut(mid) * scene.n) > id) hi = mid;
      else lo = mid;
    }
    const age = t - hi * tScan;
    if (age >= 0 && age < GLOW_MS) glow.push({ id, a: 1 - age / GLOW_MS });
  }
  const backP = clamp01((p - PHASE.scanEnd) / (PHASE.backEnd - PHASE.scanEnd));
  const finalP = clamp01((p - PHASE.backEnd) / (1 - PHASE.backEnd));
  return { scanned, best: p >= PHASE.scanEnd ? scene.winner : best, glow, rest: 1 - 0.82 * easeIn(backP), emphasis: easeOut(backP), oos: scene.winner == null ? 0 : easeInOut(finalP), done: p >= 1 };
}

// ── drawing ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface Palette {
  fg: string;
  mute: string;
  faint: string;
  line: string;
  win: string;
  loss: string;
  zone: string;
}

export interface Geometry {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  /** height of the barcode strip at the bottom (the scanner's lane) */
  strip: number;
  /** bottom padding below the strip */
  padB: number;
}

export const geometryOf = (w: number, h: number): Geometry => ({ w, h, padL: 10, padR: 10, padT: 16, strip: 14, padB: 8 });

/** y-range from the curves themselves (1 % / 99 % of all values, the winner always inside). */
export function rangeOf(scene: Scene): { lo: number; hi: number } {
  const all: number[] = [0];
  for (const c of scene.curves) for (const v of c) all.push(v);
  for (const v of scene.winnerCurve) all.push(v);
  all.sort((a, b) => a - b);
  const q = (x: number): number => all[Math.min(all.length - 1, Math.max(0, Math.floor(x * (all.length - 1))))]!;
  let lo = Math.min(q(0.01), ...scene.winnerCurve, 0);
  let hi = Math.max(q(0.99), ...scene.winnerCurve, 0);
  if (!(hi - lo > 1e-9)) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.06;
  return { lo: lo - pad, hi: hi + pad };
}

/** Pixel of grid point k (0 … gridLen−1) of a curve; the origin (0 R at the start) is x = padL. */
export function pointX(g: Geometry, scene: Scene, k: number): number {
  const plotW = g.w - g.padL - g.padR;
  return g.padL + ((k + 1) / scene.gridLen) * plotW;
}

export function pointY(g: Geometry, range: { lo: number; hi: number }, v: number): number {
  const plotH = g.h - g.padT - g.padB - g.strip - 8;
  return g.padT + (1 - (v - range.lo) / (range.hi - range.lo)) * plotH;
}

type Ctx = CanvasRenderingContext2D;

function path(ctx: Ctx, g: Geometry, scene: Scene, range: { lo: number; hi: number }, c: readonly number[], upTo: number): void {
  ctx.moveTo(g.padL, pointY(g, range, 0));
  for (let k = 0; k < upTo; k++) ctx.lineTo(pointX(g, scene, k), pointY(g, range, c[k] ?? 0));
}

/** Paints one frame. Everything it draws comes from `scene` (the result) and `plan` (time). */
export function drawFrame(ctx: Ctx, g: Geometry, scene: Scene, plan: FramePlan, pal: Palette, range = rangeOf(scene)): void {
  ctx.clearRect(0, 0, g.w, g.h);
  const zeroY = pointY(g, range, 0);
  const isX = pointX(g, scene, scene.isPoints - 1);
  const endX = g.w - g.padR;
  // the unseen final test: a quiet zone
  ctx.fillStyle = pal.zone;
  ctx.fillRect(isX, g.padT - 6, endX - isX, g.h - g.padT - g.padB + 2);
  ctx.strokeStyle = pal.line;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(isX, g.padT - 6);
  ctx.lineTo(isX, g.h - g.padB - 2);
  ctx.stroke();
  ctx.setLineDash([]);
  // zero line
  ctx.beginPath();
  ctx.moveTo(g.padL, zeroY);
  ctx.lineTo(endX, zeroY);
  ctx.stroke();
  ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = pal.faint;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText("Training", g.padL, 2);
  ctx.textAlign = "right";
  ctx.fillText("Endtest · ungesehen", endX, 2);
  ctx.textAlign = "left";
  ctx.fillText("0 R", g.padL + 2, zeroY + 2);

  // the visited curves: one batched path, faint; the scanner's neighbourhood a little brighter
  const n = scene.n;
  const show = Math.min(plan.scanned, n);
  const winner = scene.winner;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = pal.mute;
  ctx.globalAlpha = 0.16 * plan.rest;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < show; i++) {
    if (i === winner && plan.emphasis > 0) continue;
    path(ctx, g, scene, range, scene.curves[i]!, scene.isPoints);
  }
  ctx.stroke();
  // scanner window (the last few visited variants) while the scan runs
  if (plan.scanned < n && plan.scanned > 0) {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = pal.fg;
    ctx.beginPath();
    for (let i = Math.max(0, show - 6); i < show; i++) path(ctx, g, scene, range, scene.curves[i]!, scene.isPoints);
    ctx.stroke();
  }
  // the best so far (mint) and the flashes
  const best = plan.best;
  if (best != null && best !== winner) {
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = pal.win;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    path(ctx, g, scene, range, scene.curves[best]!, scene.isPoints);
    ctx.stroke();
  }
  for (const f of plan.glow) {
    ctx.globalAlpha = Math.min(1, 0.35 + 0.65 * f.a);
    ctx.strokeStyle = pal.win;
    ctx.lineWidth = 2 + 2.4 * f.a;
    ctx.shadowColor = pal.win;
    ctx.shadowBlur = 10 * f.a;
    ctx.beginPath();
    path(ctx, g, scene, range, scene.curves[f.id]!, scene.isPoints);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // the winner: thick; its run into the final test dashed
  if (winner != null && (plan.emphasis > 0 || best === winner)) {
    const e = Math.max(plan.emphasis, best === winner ? 0.15 : 0);
    ctx.strokeStyle = pal.win;
    ctx.lineWidth = 1.6 + 2 * e;
    ctx.globalAlpha = 0.5 + 0.5 * e;
    ctx.beginPath();
    path(ctx, g, scene, range, scene.winnerCurve, scene.isPoints);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (plan.oos > 0) {
      const total = scene.gridLen - scene.isPoints;
      const upTo = scene.isPoints + Math.max(1, Math.round(plan.oos * total));
      ctx.strokeStyle = scene.passed ? pal.win : scene.oosEnd < 0 ? pal.loss : pal.fg;
      ctx.lineWidth = 3.2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(pointX(g, scene, scene.isPoints - 1), pointY(g, range, scene.winnerCurve[scene.isPoints - 1] ?? 0));
      for (let k = scene.isPoints; k < upTo; k++) ctx.lineTo(pointX(g, scene, k), pointY(g, range, scene.winnerCurve[k] ?? 0));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // the scanner's lane: one tick per variant, tall by its score, mint where the best changed
  const y0 = g.h - g.padB;
  const plotW = g.w - g.padL - g.padR;
  let maxScore = 0;
  for (const s of scene.scores) if (s != null && s > maxScore) maxScore = s;
  const flashSet = new Set(scene.flashes);
  const tick = plotW / Math.max(1, n);
  ctx.lineWidth = Math.max(0.6, Math.min(1.2, tick * 0.8));
  for (let i = 0; i < n; i++) {
    const seen = i < show;
    const s = scene.scores[i];
    const hgt = s != null && maxScore > 0 ? 4 + (g.strip - 4) * (s / maxScore) : 3;
    const x = g.padL + (i + 0.5) * tick;
    ctx.strokeStyle = seen && flashSet.has(i) ? pal.win : pal.line;
    ctx.globalAlpha = seen ? (flashSet.has(i) ? 1 : 0.9) : 0.35;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y0 - hgt);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (plan.scanned < n && plan.scanned > 0) {
    const x = g.padL + (show - 0.5) * tick;
    ctx.strokeStyle = pal.fg;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y0 + 3);
    ctx.lineTo(x, y0 - g.strip - 2);
    ctx.stroke();
  }
}
