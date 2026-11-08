/**
 * The picture of the strategy search as DATA, so a test can prove that nothing in it is invented. The scene holds the real curves of the
 * result (cumulative R after costs per variant – the very arrays of `result.curves`), the real training scores, the winner's real line
 * (training + final test) and the resampling band of its real final-test trades. Four stages, like the Frost signature – but every stroke is a
 * finished run:
 *
 *   Zeichnen         the 1.000 training curves appear in the order they were computed (a cascade by run number); the counter counts lines
 *                    that are completely on screen
 *   Prüfen           a scanner visits the variants in the order the selection compared them; every visited one leaves a dot at its training
 *                    end, the best so far turns mint whenever the running best score changes (recomputed from `result.rows`)
 *   Kristallisieren  the others step back, the winner (variant + stop rule) is emphasised
 *   Endtest          the winner runs dashed into the unseen 20 %; behind it the 5–95 % band of its resampled final-test trades
 *
 * `framePlan(t)` says what is on screen at `t`; the draw functions paint it. Expensive work is incremental: the faint curves and the dots are
 * painted ONCE into their own canvas (`advanceLayers`, a bounded number of segments per frame), whose opacity steps back by CSS; every frame
 * only strokes a handful of lines on the front canvas (`paintFrame`), halos without `shadowBlur` – the main thread stays below 50 ms per frame.
 * No loop lives here; the component drives time and stops at the end.
 */
import type { SearchResult } from "@/domain/lab/search";

/** The four stages and their length (ms). */
export const STAGES = [
  { id: "draw", label: "Zeichnen", ms: 2350 },
  { id: "scan", label: "Prüfen", ms: 4500 },
  { id: "crystal", label: "Kristallisieren", ms: 1350 },
  { id: "test", label: "Endtest", ms: 1850 },
] as const;
export type StageId = (typeof STAGES)[number]["id"];
/** Length of the replay in ms (reduced motion and „Überspringen“ jump to the end). */
export const REPLAY_MS = STAGES.reduce((a, s) => a + s.ms, 0);

/** Drawing: line i starts at `DRAW_SPREAD · i / n` s and takes `DRAW_LINE` s (ease-out) – a cascade in run order. */
const DRAW_SPREAD = 1.4;
const DRAW_LINE = 0.9;
/** Scan: the scanner's sweep (s), eased in and out. */
const SCAN_SWEEP = 4.4;
/** How long a new best glows (s). */
const GLOW = 0.45;
/** Lines of the scanner's trail (the most recently compared). */
const TRAIL = 10;

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
  /** 5 / 50 / 95 % of the resampled final-test sum at the test grid points, ABSOLUTE (from the winner's value at the cut); `null` without */
  band: { lo: readonly number[]; mid: readonly number[]; hi: readonly number[] } | null;
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
  const k0 = result.curves.isPoints;
  const base = wc[k0 - 1] ?? 0;
  const b = result.winner?.risk?.band ?? null;
  return {
    n: result.curves.is.length,
    curves: result.curves.is,
    scores,
    isPoints: k0,
    gridLen: result.curves.grid.length,
    winner,
    winnerCurve: wc,
    flashes: flashSequence(scores, winner),
    oosEnd: (wc[wc.length - 1] ?? 0) - base,
    passed: result.verdict.passed,
    band: b && b.lo.length === result.curves.grid.length - k0 ? { lo: b.lo.map((x) => base + x), mid: b.mid.map((x) => base + x), hi: b.hi.map((x) => base + x) } : null,
  };
}

// ── time ──────────────────────────────────────────────────────────────────────────────────────────────────────

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);
const easeIn = (x: number): number => x * x * x;
const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const spring = (x: number): number => 1 - Math.exp(-7 * x) * Math.cos(10 * x);

/** Share (0…1) of line `i` of `n` that is on screen `s` seconds into „Zeichnen“. */
export function lineProgress(i: number, n: number, s: number): number {
  return easeOut(clamp01((s - (DRAW_SPREAD * i) / Math.max(1, n)) / DRAW_LINE));
}

/** Lines completely on screen `s` seconds into „Zeichnen“ – they finish in run order, so it is the first line that is not complete yet. */
export function linesDone(n: number, s: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lineProgress(mid, n, s) >= 1) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Variants the scanner has compared `s` seconds into „Prüfen“. */
export function scannedAt(n: number, s: number): number {
  return Math.round(easeInOut(clamp01(s / SCAN_SWEEP)) * n);
}

/** When (s into „Prüfen“) the scanner had compared `k` variants – inverse of `scannedAt`, by bisection. */
function reachAt(n: number, k: number): number {
  let lo = 0;
  let hi = SCAN_SWEEP;
  for (let it = 0; it < 22; it++) {
    const mid = (lo + hi) / 2;
    if (scannedAt(n, mid) >= k) hi = mid;
    else lo = mid;
  }
  return hi;
}

export interface FramePlan {
  stage: number;
  /** 0…1 inside the stage */
  stageP: number;
  /** seconds into the stage */
  s: number;
  /** what the first counter shows: lines on screen („Gezeichnet“) or variants compared („Geprüft“) */
  counter: { label: "Gezeichnet" | "Geprüft"; value: number };
  /** variants the scanner has compared (0 … n); n after „Prüfen“ */
  scanned: number;
  /** the best so far (null before the first qualified one) */
  best: number | null;
  /** glow of the latest best change 0…1 */
  glow: number;
  /** opacity of the faint curves / of the dots (1 → stepped back) */
  rest: number;
  dots: number;
  /** winner line width / glow factor 0…1, and the spring of its dot at the cut */
  emphasis: number;
  dot: number;
  /** share of the winner's dashed run into the final test 0…1, and of its band */
  oos: number;
  band: number;
  done: boolean;
}

/** What is on screen at `t` ms (0 … REPLAY_MS). Pure. */
export function framePlan(scene: Scene, t: number): FramePlan {
  let stage = 0;
  let acc = 0;
  while (stage < STAGES.length - 1 && t >= acc + STAGES[stage]!.ms) acc += STAGES[stage++]!.ms;
  const ms = STAGES[stage]!.ms;
  const s = Math.max(0, Math.min(ms, t - acc)) / 1000;
  const stageP = clamp01((t - acc) / ms);
  const n = scene.n;
  const done = t >= REPLAY_MS;
  const plan: FramePlan = { stage, stageP, s, counter: { label: "Gezeichnet", value: 0 }, scanned: 0, best: null, glow: 0, rest: 1, dots: 1, emphasis: 0, dot: 0, oos: 0, band: 0, done };
  if (stage === 0) {
    plan.counter = { label: "Gezeichnet", value: linesDone(n, s) };
    return plan;
  }
  if (stage === 1) {
    const k = scannedAt(n, s);
    plan.scanned = k;
    plan.counter = { label: "Geprüft", value: k };
    let best: number | null = null;
    for (const id of scene.flashes) {
      if (id >= k) break;
      best = id;
    }
    plan.best = best;
    if (best != null) plan.glow = clamp01(1 - (s - reachAt(n, best + 1)) / GLOW);
    return plan;
  }
  plan.scanned = n;
  plan.counter = { label: "Geprüft", value: n };
  plan.best = scene.winner;
  if (stage === 2) {
    const a = clamp01(s / 1.3);
    plan.rest = 1 - 0.68 * easeIn(a);
    plan.dots = 1 - 0.6 * easeIn(a);
    plan.emphasis = easeOut(a);
    plan.dot = spring(a);
    return plan;
  }
  const p = clamp01(s / 1.8);
  plan.rest = 0.32;
  plan.dots = 0.4;
  plan.emphasis = 1;
  plan.dot = 1;
  plan.oos = scene.winner == null ? 0 : done ? 1 : easeOut(p);
  plan.band = plan.oos;
  return plan;
}

// ── geometry ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Palette {
  /** the faint curves and dots: the veil channels („255 255 255“ dark, ink in light) */
  veil: string;
  fg: string;
  faint: string;
  win: string;
  loss: string;
}

export interface Geometry {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

/** The plot's padding (CSS px): room for the zone labels on top. */
export const geometryOf = (w: number, h: number): Geometry => ({ w, h, padL: 14, padR: 14, padT: w < 520 ? 52 : 46, padB: 16 });

/** y-range from the curves themselves (1 % / 99 % of the training lows / highs, the winner and the band always inside). */
export function rangeOf(scene: Scene): { lo: number; hi: number } {
  const lows: number[] = [];
  const highs: number[] = [];
  for (const c of scene.curves) {
    let a = 0;
    let b = 0;
    for (const v of c) {
      if (v < a) a = v;
      if (v > b) b = v;
    }
    lows.push(a);
    highs.push(b);
  }
  lows.sort((x, y) => x - y);
  highs.sort((x, y) => x - y);
  let lo = lows.length ? lows[Math.floor((lows.length - 1) * 0.01)]! : -1;
  let hi = highs.length ? highs[Math.floor((highs.length - 1) * 0.99)]! : 1;
  for (const v of scene.winnerCurve) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (scene.band) {
    for (const v of scene.band.lo) if (v < lo) lo = v;
    for (const v of scene.band.hi) if (v > hi) hi = v;
  }
  if (!(hi - lo > 1e-9)) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.06;
  return { lo: lo - pad, hi: hi + pad };
}

/** Pixel of grid point k (−1 = the origin, 0 R at the start … gridLen−1). */
export function pointX(g: Geometry, scene: Scene, k: number): number {
  return g.padL + ((k + 1) / scene.gridLen) * (g.w - g.padL - g.padR);
}

export function pointY(g: Geometry, range: { lo: number; hi: number }, v: number): number {
  return g.padT + ((range.hi - v) / (range.hi - range.lo)) * (g.h - g.padT - g.padB);
}

type Ctx = CanvasRenderingContext2D;
const valueAt = (c: readonly number[], k: number): number => (k < 0 ? 0 : (c[k] ?? 0));

/** Strokes curve `c` from grid point `from` (−1 = origin) to `to` (inclusive) as one sub-path. */
export function curvePath(ctx: Ctx, g: Geometry, scene: Scene, range: { lo: number; hi: number }, c: readonly number[], from: number, to: number): void {
  ctx.moveTo(pointX(g, scene, from), pointY(g, range, valueAt(c, from)));
  for (let k = from + 1; k <= to; k++) ctx.lineTo(pointX(g, scene, k), pointY(g, range, valueAt(c, k)));
}

// ── the layer of the faint curves: painted once, incrementally ────────────────────────────────────────────────

/**
 * The stage is three stacked canvases: the grid (painted once), the faint curves with the dots (`Layers`, painted incrementally, its OPACITY
 * is `plan.rest` – a compositor property, no repaint), and the front (`paintFrame`: a handful of lines per frame).
 */
export interface Layers {
  base: Ctx;
  /** per variant: last grid point painted (−1 = nothing yet) */
  drawnTo: Int16Array;
  /** dots painted for variants 0 … ticked−1 */
  ticked: number;
}

export function newLayers(base: Ctx, n: number): Layers {
  return { base, drawnTo: new Int16Array(n).fill(-1), ticked: 0 };
}

/**
 * Paints into the layer what `plan` needs and was not painted yet (new segments of the curves, new dots) – at most `budget` segments per
 * call; returns `true` when the layer holds everything `plan` needs. Each line is its own stroke: they add up where they overlap.
 */
export function advanceLayers(L: Layers, g: Geometry, scene: Scene, range: { lo: number; hi: number }, pal: Palette, plan: FramePlan, budget = Infinity): boolean {
  const n = scene.n;
  const last = scene.isPoints - 1;
  const b = L.base;
  b.lineWidth = 0.9;
  b.lineJoin = "round";
  b.strokeStyle = `rgb(${pal.veil} / 0.1)`;
  let spent = 0;
  for (let i = 0; i < n; i++) {
    const want = plan.stage === 0 ? Math.round(lineProgress(i, n, plan.s) * (last + 1)) - 1 : last;
    const have = L.drawnTo[i]!;
    if (want <= have) continue;
    if (spent >= budget) return false;
    b.beginPath();
    curvePath(b, g, scene, range, scene.curves[i]!, have, want);
    b.stroke();
    spent += want - have;
    L.drawnTo[i] = want;
  }
  if (plan.scanned > L.ticked) {
    b.fillStyle = `rgb(${pal.veil} / 0.35)`;
    const x = pointX(g, scene, last);
    for (let i = L.ticked; i < plan.scanned; i++) {
      b.beginPath();
      b.arc(x, pointY(g, range, valueAt(scene.curves[i]!, last)), 1.3, 0, 7);
      b.fill();
    }
    L.ticked = plan.scanned;
  }
  return true;
}

/** The grid of the plot (painted once): the cut between selection and final test, the zero line, the quiet final-test zone, „0 R“. */
export function drawGrid(ctx: Ctx, g: Geometry, scene: Scene, range: { lo: number; hi: number }, pal: Palette): void {
  ctx.clearRect(0, 0, g.w, g.h);
  const cutX = pointX(g, scene, scene.isPoints - 1);
  ctx.fillStyle = `rgb(${pal.veil} / 0.02)`;
  ctx.fillRect(cutX, 0, g.w - cutX, g.h);
  ctx.strokeStyle = `rgb(${pal.veil} / 0.14)`;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.moveTo(cutX, g.padT - 30);
  ctx.lineTo(cutX, g.h - g.padB);
  ctx.stroke();
  ctx.setLineDash([]);
  const zy = pointY(g, range, 0);
  ctx.strokeStyle = `rgb(${pal.veil} / 0.12)`;
  ctx.beginPath();
  ctx.moveTo(g.padL, zy);
  ctx.lineTo(g.w - g.padR, zy);
  ctx.stroke();
  ctx.font = '10px "IBM Plex Mono", ui-monospace, monospace';
  ctx.fillStyle = pal.faint;
  ctx.textBaseline = "bottom";
  ctx.textAlign = "left";
  ctx.fillText("0 R", g.padL + 2, zy - 3);
}

/** A line with a soft halo: two wide, faint strokes under the core (no `shadowBlur` – that blurs the whole box on every frame). */
function haloStroke(ctx: Ctx, color: string, width: number, glow: number, trace: () => void): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (glow > 0) {
    ctx.globalAlpha = 0.07 + 0.05 * Math.min(1, glow / 20);
    ctx.lineWidth = width + 0.55 * glow;
    ctx.beginPath();
    trace();
    ctx.stroke();
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = width + 0.22 * glow;
    ctx.beginPath();
    trace();
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = width;
  ctx.beginPath();
  trace();
  ctx.stroke();
  ctx.restore();
}

function dotAt(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  if (!(r > 0)) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.2, 0, 7);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fill();
  ctx.restore();
}

/** The resampling band (5–95 %) behind the winner in the final-test zone, up to the share `upTo` of the test. */
export function drawBand(ctx: Ctx, g: Geometry, scene: Scene, range: { lo: number; hi: number }, pal: Palette, alpha: number, upTo: number): void {
  const b = scene.band;
  if (!b || !(alpha > 0)) return;
  const k0 = scene.isPoints;
  const m = Math.max(1, Math.round(upTo * b.lo.length));
  const start = scene.winnerCurve[k0 - 1] ?? 0;
  ctx.save();
  ctx.fillStyle = scene.passed ? pal.win : pal.fg;
  ctx.globalAlpha = 0.14 * alpha;
  ctx.beginPath();
  ctx.moveTo(pointX(g, scene, k0 - 1), pointY(g, range, start));
  for (let j = 0; j < m; j++) ctx.lineTo(pointX(g, scene, k0 + j), pointY(g, range, b.hi[j]!));
  for (let j = m - 1; j >= 0; j--) ctx.lineTo(pointX(g, scene, k0 + j), pointY(g, range, b.lo[j]!));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The front of one frame: the scanner's trail, the best so far, the winner, its dashed final test and the band (the faint layer lies below). */
export function paintFrame(ctx: Ctx, g: Geometry, scene: Scene, range: { lo: number; hi: number }, pal: Palette, plan: FramePlan): void {
  ctx.clearRect(0, 0, g.w, g.h);
  const last = scene.isPoints - 1;
  if (plan.stage === 1) {
    // the trail of the scanner: the most recently compared curves, brighter the newer
    ctx.lineWidth = 1.2;
    for (let j = Math.max(0, plan.scanned - TRAIL); j < plan.scanned; j++) {
      const a = 0.05 + (0.5 * (j - plan.scanned + TRAIL + 1)) / TRAIL;
      ctx.strokeStyle = `rgb(${pal.veil} / ${a.toFixed(3)})`;
      ctx.beginPath();
      curvePath(ctx, g, scene, range, scene.curves[j]!, -1, last);
      ctx.stroke();
    }
    const best = plan.best;
    if (best != null) haloStroke(ctx, pal.win, 1.8, 8 + 16 * plan.glow, () => curvePath(ctx, g, scene, range, scene.curves[best]!, -1, last));
    return;
  }
  if (plan.stage < 2 || scene.winner == null) return;
  const cutX = pointX(g, scene, last);
  const cutY = pointY(g, range, valueAt(scene.winnerCurve, last));
  if (plan.stage === 3) drawBand(ctx, g, scene, range, pal, plan.band, plan.oos);
  haloStroke(ctx, pal.win, plan.stage === 2 ? 1.8 + 1.6 * plan.emphasis : 3.4, plan.stage === 2 ? 10 + 10 * plan.emphasis : 20, () => curvePath(ctx, g, scene, range, scene.winnerCurve, -1, last));
  if (plan.stage === 3 && plan.oos > 0) {
    const total = scene.gridLen - scene.isPoints;
    const upTo = scene.isPoints - 1 + Math.max(1, Math.round(plan.oos * total));
    const color = scene.passed ? pal.win : scene.oosEnd < 0 ? pal.loss : pal.fg;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.6;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    curvePath(ctx, g, scene, range, scene.winnerCurve, last, upTo);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    dotAt(ctx, pointX(g, scene, upTo), pointY(g, range, valueAt(scene.winnerCurve, upTo)), 3.5, color);
  }
  dotAt(ctx, cutX, cutY, 5 * Math.max(0, plan.dot), pal.win);
}

/**
 * Where the result card goes on a wide stage: its right edge 12 px left of the cut (the final test stays visible) and at the top or the bottom –
 * whichever the winner's training line crosses less in that stretch.
 */
export function placeOverlay(g: Geometry, scene: Scene, range: { lo: number; hi: number }, ow: number, oh: number): { right: number; vertical: "top" | "bottom" } {
  const cutX = pointX(g, scene, scene.isPoints - 1);
  const right = Math.max(14, Math.round(g.w - cutX + 12));
  const x1 = g.w - right;
  const x0 = x1 - ow;
  let top = 0;
  let bottom = 0;
  for (let k = -1; k < scene.isPoints; k++) {
    const x = pointX(g, scene, k);
    if (x < x0 || x > x1) continue;
    const y = pointY(g, range, valueAt(scene.winnerCurve, k));
    if (y < 14 + oh) top++;
    if (y > g.h - 14 - oh) bottom++;
  }
  return { right, vertical: bottom <= top ? "bottom" : "top" };
}
