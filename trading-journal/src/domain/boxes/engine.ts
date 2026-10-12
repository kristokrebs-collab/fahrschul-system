/**
 * Box-zu-Box engine (pure). A box is a horizontal range between a resistance and a support that the market has
 * tested from both sides — the way a trader draws it, anchored on real swing points instead of candle heights:
 *
 * 1. Pivots: fractal swing highs / lows (`pivotLen` bars on each side), confirmed `pivotLen` bars later.
 * 2. Formation: the latest run of pivots whose highs sit within `tolAtr` × ATR of each other (resistance) and whose
 *    lows do as well (support), with ≥ `minTouches` per edge, interleaved (top, bottom, top … — a trend leg has two
 *    highs and then two lows, not interleaved), every close inside the edges (± the breakout buffer), a height of
 *    `minHeightAtr`…`maxHeightAtr` ATR and ≥ `minBars` bars. The longest such run wins.
 * 3. Freeze: once formed, the edges stay. Only a CLOSE beyond an edge by `breakAtr` × ATR is a breakout; a wick
 *    beyond it is a sweep (liquidity grab) and the box lives on. After a breakout the scan starts again → the next box.
 * 4. Targets ("Box zu Box"): the near edge of an earlier box beyond the broken edge, the origin of the move that led
 *    into the box, clustered support / resistance levels (≥ 2 touches), else a measured move.
 * 5. Quality 0–100 (touches, duration, clean edges, height, sweeps) → "stark" / "solide" / "schwach";
 *    "trade the best": the UI shows strong and solid boxes, weak ones only on request.
 */
import type { Bar } from "../signals/indicators";
import { atr } from "../signals/structure";

export interface BoxCfg {
  /** fractal half-width: a pivot high is the highest high of `pivotLen` bars left and right */
  pivotLen: number;
  /** pivots within this many ATR count as the same edge */
  tolAtr: number;
  /** touches per edge needed to form a box */
  minTouches: number;
  /** minimum box length in bars */
  minBars: number;
  minHeightAtr: number;
  maxHeightAtr: number;
  /** a close must be this many ATR beyond the edge to count as a breakout */
  breakAtr: number;
  /** bars scanned (newest) */
  lookback: number;
}

export const DEFAULT_BOX_CFG: Readonly<BoxCfg> = {
  pivotLen: 3,
  tolAtr: 0.8,
  minTouches: 2,
  minBars: 10,
  minHeightAtr: 1.5,
  maxHeightAtr: 14,
  breakAtr: 0.25,
  lookback: 700,
};

export interface Pivot {
  /** bar index of the swing */
  i: number;
  /** bar index at which the pivot is confirmed (`i + pivotLen`) */
  at: number;
  high: boolean;
  price: number;
}

export type BoxGrade = "stark" | "solide" | "schwach";

export interface Box {
  /** first and last bar of the box (inclusive) */
  i0: number;
  i1: number;
  /** bar at which the box was confirmed (fourth touch) */
  formedAt: number;
  t0: number;
  t1: number;
  /** resistance (highest touching wick) and the lower end of the resistance band */
  top: number;
  topIn: number;
  /** support (lowest touching wick) and the upper end of the support band */
  bottom: number;
  bottomIn: number;
  mid: number;
  height: number;
  /** ATR 14 when the box formed (scale for buffers) */
  atr: number;
  touchesTop: number;
  touchesBottom: number;
  /** wicks beyond an edge that closed back inside */
  sweeps: number;
  /** 0 = still active, 1 / −1 = left upward / downward by a close */
  brk: 0 | 1 | -1;
  /** index of the breakout bar */
  brkI: number | null;
  quality: number;
  grade: BoxGrade;
}

export interface Level {
  price: number;
  /** pivots in the cluster */
  touches: number;
  lastI: number;
}

export type TargetKind = "box" | "origin" | "level" | "measured";
export interface Target {
  price: number;
  kind: TargetKind;
  label: string;
  /** zone of a target box (near edge … far edge) */
  zone: [number, number] | null;
  /** bar index of the reference (origin pivot / box start), for drawing */
  i: number | null;
}

const fin = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);

/** Fractal pivots in confirmation order. */
export function findPivots(bars: readonly Bar[], len: number, from = 0): Pivot[] {
  const out: Pivot[] = [];
  const n = bars.length;
  for (let i = Math.max(from, len); i < n - len; i++) {
    const b = bars[i]!;
    let hi = true;
    let lo = true;
    for (let k = i - len; k <= i + len && (hi || lo); k++) {
      if (k === i) continue;
      const o = bars[k]!;
      // strict on the left, non-strict on the right: the first of equal highs is the pivot
      if (hi && (k < i ? o.h >= b.h : o.h > b.h)) hi = false;
      if (lo && (k < i ? o.l <= b.l : o.l < b.l)) lo = false;
    }
    if (hi) out.push({ i, at: i + len, high: true, price: b.h });
    if (lo) out.push({ i, at: i + len, high: false, price: b.l });
  }
  return out.sort((a, b) => a.at - b.at || a.i - b.i);
}

/** ATR 14 with a cumulative mean range before 14 bars (never NaN for i ≥ 0). */
function atrSeries(bars: readonly Bar[]): number[] {
  const a = atr(bars, 14);
  let sum = 0;
  return a.map((v, i) => {
    sum += bars[i]!.h - bars[i]!.l;
    return Number.isFinite(v) && v > 0 ? v : sum / (i + 1);
  });
}

interface Fit {
  top: number;
  topIn: number;
  bottom: number;
  bottomIn: number;
  touchesTop: number;
  touchesBottom: number;
  first: number;
}

/**
 * Longest valid run of pivots ending with the newest one (`ps`, index order), or null. Spreads only grow when older
 * pivots are added, so the walk stops at the first violation.
 */
function fitRun(bars: readonly Bar[], ps: readonly Pivot[], end: number, A: number, cfg: BoxCfg): Fit | null {
  const tol = cfg.tolAtr * A;
  const buf = cfg.breakAtr * A;
  let hMax = -Infinity;
  let hMin = Infinity;
  let lMax = -Infinity;
  let lMin = Infinity;
  let nh = 0;
  let nl = 0;
  let firstH = Infinity;
  let lastH = -Infinity;
  let firstL = Infinity;
  let lastL = -Infinity;
  let cMax = -Infinity; // closes from the run start to `end`
  let cMin = Infinity;
  let scanned = end + 1;
  let best: Fit | null = null;
  for (let k = ps.length - 1; k >= 0; k--) {
    const p = ps[k]!;
    if (p.high) {
      hMax = Math.max(hMax, p.price);
      hMin = Math.min(hMin, p.price);
      nh++;
      firstH = Math.min(firstH, p.i);
      lastH = Math.max(lastH, p.i);
    } else {
      lMax = Math.max(lMax, p.price);
      lMin = Math.min(lMin, p.price);
      nl++;
      firstL = Math.min(firstL, p.i);
      lastL = Math.max(lastL, p.i);
    }
    if (hMax - hMin > tol || lMax - lMin > tol) break;
    for (let i = scanned - 1; i >= p.i; i--) {
      cMax = Math.max(cMax, bars[i]!.c);
      cMin = Math.min(cMin, bars[i]!.c);
    }
    scanned = Math.min(scanned, p.i);
    if (nh < cfg.minTouches || nl < cfg.minTouches) continue;
    const height = hMax - lMin;
    if (height < cfg.minHeightAtr * A || height > cfg.maxHeightAtr * A) continue;
    if (lMax >= hMin) continue; // bands overlap: no box
    if (cMax > hMax + buf || cMin < lMin - buf) break; // a close already left the range: older pivots won't help
    // interleaved: a bottom touch between the first and last top touch, and vice versa
    if (!(firstL < lastH && firstH < lastL)) continue;
    if (end - p.i + 1 < cfg.minBars) continue;
    best = { top: hMax, topIn: hMin, bottom: lMin, bottomIn: lMax, touchesTop: nh, touchesBottom: nl, first: p.i };
  }
  return best;
}

function quality(b: Pick<Box, "touchesTop" | "touchesBottom" | "i0" | "i1" | "height" | "atr" | "sweeps">, inside: number, cfg: BoxCfg): number {
  const touches = Math.min(1, (b.touchesTop + b.touchesBottom - 2 * cfg.minTouches) / 5);
  const len = Math.min(1, (b.i1 - b.i0 + 1) / (cfg.minBars * 4));
  const h = b.height / b.atr;
  const height = h < 2.5 ? (h - cfg.minHeightAtr) / (2.5 - cfg.minHeightAtr) : h <= 9 ? 1 : Math.max(0, 1 - (h - 9) / 6);
  const sweeps = Math.min(1, b.sweeps / 2);
  const balance = Math.min(b.touchesTop, b.touchesBottom) / Math.max(b.touchesTop, b.touchesBottom);
  const q = 32 * touches + 22 * len + 18 * inside + 14 * Math.max(0, height) + 6 * sweeps + 8 * balance;
  return Math.round(Math.max(0, Math.min(100, q)));
}
export const gradeOf = (q: number): BoxGrade => (q >= 62 ? "stark" : q >= 42 ? "solide" : "schwach");

/** Walk forward from `from` with frozen edges; returns the last bar inside and the breakout direction. */
function walk(bars: readonly Bar[], top: number, bottom: number, buf: number, from: number): { i1: number; brk: 0 | 1 | -1; sweeps: number } {
  let i1 = from - 1;
  let sweeps = 0;
  for (let i = from; i < bars.length; i++) {
    const b = bars[i]!;
    if (b.c > top + buf) return { i1, brk: 1, sweeps };
    if (b.c < bottom - buf) return { i1, brk: -1, sweeps };
    if (b.h > top + buf || b.l < bottom - buf) sweeps++;
    i1 = i;
  }
  return { i1, brk: 0, sweeps };
}

/**
 * A trader draws one range where the engine found neighbouring sub-boxes with fake breakouts in between: two boxes
 * merge when they touch or overlap in price, lie close in time, the union is not taller than 70 % of `maxHeightAtr`
 * and every close from the first box to the second stayed inside the union. The union is walked forward again, so a
 * later box inside it is absorbed as well.
 */
function mergeBoxes(bars: readonly Bar[], raw: readonly Box[], cfg: BoxCfg): Box[] {
  const out: Box[] = [];
  for (const b of raw) {
    const a = out[out.length - 1];
    if (a) {
      const top = Math.max(a.top, b.top);
      const bottom = Math.min(a.bottom, b.bottom);
      const A = Math.max(a.atr, b.atr);
      const buf = cfg.breakAtr * A;
      const gap = b.i0 - a.i1;
      const vGap = Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top); // > 0: ranges apart
      let inside = gap <= Math.max(cfg.minBars, 12) && vGap <= 0.25 * Math.min(a.height, b.height) && top - bottom <= cfg.maxHeightAtr * 0.7 * A;
      for (let i = a.i0; inside && i < b.i0; i++) { const c = bars[i]!.c; if (c > top + buf || c < bottom - buf) inside = false; }
      if (inside) {
        const w = walk(bars, top, bottom, buf, b.formedAt + 1);
        const i1 = Math.max(w.i1, b.formedAt);
        let sweeps = 0;
        for (let i = a.i0; i <= i1; i++) if (bars[i]!.h > top + buf || bars[i]!.l < bottom - buf) sweeps++;
        let inn = 0;
        for (let i = a.i0; i <= i1; i++) { const c = bars[i]!.c; if (c <= top && c >= bottom) inn++; }
        const base = { i0: a.i0, i1, height: top - bottom, atr: A, touchesTop: (a.top >= b.top ? a.touchesTop : b.touchesTop) + 1, touchesBottom: (a.bottom <= b.bottom ? a.touchesBottom : b.touchesBottom) + 1, sweeps };
        const q = quality(base, inn / (i1 - a.i0 + 1), cfg);
        out[out.length - 1] = {
          ...base, formedAt: a.formedAt, t0: a.t0, t1: bars[i1]!.t,
          top, topIn: a.top >= b.top ? a.topIn : b.topIn, bottom, bottomIn: a.bottom <= b.bottom ? a.bottomIn : b.bottomIn, mid: (top + bottom) / 2,
          brk: w.brk, brkI: w.brk ? i1 + 1 : null, quality: q, grade: gradeOf(q),
        };
        continue;
      }
      if (b.i0 <= a.i1) continue; // swallowed by a union that already runs past it (outside its range cannot happen)
    }
    out.push(b);
  }
  return out;
}

/** All boxes of a series (oldest first). Uses closed bars only — pass the running candle separately as live price. */
export function findBoxes(bars: readonly Bar[], cfg: BoxCfg = DEFAULT_BOX_CFG): Box[] {
  const n = bars.length;
  if (n < cfg.minBars + 2 * cfg.pivotLen + 14) return [];
  const A = atrSeries(bars);
  const start = Math.max(0, n - cfg.lookback);
  const pivots = findPivots(bars, cfg.pivotLen, start);
  const boxes: Box[] = [];
  let run: Pivot[] = [];
  let floor = start; // no box may start before this bar (end of the previous box)
  let k = 0;
  for (let j = start; j < n; j++) {
    let added = false;
    while (k < pivots.length && pivots[k]!.at <= j) {
      const p = pivots[k++]!;
      if (p.i >= floor) { run.push(p); added = true; }
    }
    if (!added || run.length < 2 * cfg.minTouches) continue;
    run.sort((a, b) => a.i - b.i);
    const a = A[j]!;
    const fit = fitRun(bars, run, j, a, cfg);
    if (!fit) continue;
    // formed: freeze the edges and walk forward to the breakout
    const buf = cfg.breakAtr * a;
    let i1 = j;
    let brk: 0 | 1 | -1 = 0;
    let sweeps = 0;
    for (let i = fit.first; i <= j; i++) if (bars[i]!.h > fit.top + buf || bars[i]!.l < fit.bottom - buf) sweeps++;
    for (let i = j + 1; i < n; i++) {
      const b = bars[i]!;
      if (b.c > fit.top + buf) { brk = 1; break; }
      if (b.c < fit.bottom - buf) { brk = -1; break; }
      if (b.h > fit.top + buf || b.l < fit.bottom - buf) sweeps++;
      i1 = i;
    }
    // start: back to where price entered the range (closes inside), at most half the box length, not before `floor`
    let i0 = fit.first;
    const maxBack = Math.floor((i1 - fit.first + 1) / 2);
    while (i0 - 1 >= floor && fit.first - (i0 - 1) <= maxBack) {
      const c = bars[i0 - 1]!.c;
      if (c > fit.top || c < fit.bottom) break;
      i0--;
    }
    // late touches (pivots after formation, inside the box, near an edge)
    let touchesTop = fit.touchesTop;
    let touchesBottom = fit.touchesBottom;
    const tol = cfg.tolAtr * a;
    for (const p of pivots) {
      if (p.i <= j || p.i > i1) continue;
      if (p.high && p.price >= fit.top - tol && p.price <= fit.top + buf) touchesTop++;
      if (!p.high && p.price <= fit.bottom + tol && p.price >= fit.bottom - buf) touchesBottom++;
    }
    let inside = 0;
    for (let i = i0; i <= i1; i++) { const c = bars[i]!.c; if (c <= fit.top && c >= fit.bottom) inside++; }
    const base = { i0, i1, height: fit.top - fit.bottom, atr: a, touchesTop, touchesBottom, sweeps };
    const q = quality(base, inside / (i1 - i0 + 1), cfg);
    boxes.push({
      ...base, formedAt: j, t0: bars[i0]!.t, t1: bars[i1]!.t,
      top: fit.top, topIn: fit.topIn, bottom: fit.bottom, bottomIn: fit.bottomIn, mid: (fit.top + fit.bottom) / 2,
      brk, brkI: brk ? i1 + 1 : null, quality: q, grade: gradeOf(q),
    });
    if (!brk) break; // the newest box is still active
    floor = i1 + 1;
    j = i1; // continue after the breakout bar (loop ++)
    k = 0;
    while (k < pivots.length && pivots[k]!.at <= j) k++;
    run = pivots.filter((p) => p.at <= j && p.i >= floor);
  }
  let merged = mergeBoxes(bars, boxes, cfg);
  for (let pass = 0; pass < 3; pass++) { const m = mergeBoxes(bars, merged, cfg); if (m.length === merged.length) break; merged = m; }
  return merged;
}

/** Support / resistance levels: pivots clustered within `tolAtr` × ATR, ≥ 2 touches. */
export function srLevels(bars: readonly Bar[], cfg: BoxCfg = DEFAULT_BOX_CFG): Level[] {
  const n = bars.length;
  if (n < 30) return [];
  const A = atrSeries(bars)[n - 1]!;
  const tol = cfg.tolAtr * A * 0.75;
  const ps = findPivots(bars, Math.max(cfg.pivotLen, 4), Math.max(0, n - cfg.lookback)).sort((a, b) => a.price - b.price);
  const out: Level[] = [];
  let cur: Pivot[] = [];
  const flush = () => {
    if (cur.length >= 2) out.push({ price: cur.reduce((s, p) => s + p.price, 0) / cur.length, touches: cur.length, lastI: Math.max(...cur.map((p) => p.i)) });
    cur = [];
  };
  for (const p of ps) {
    if (cur.length && p.price - cur[0]!.price > tol) flush();
    cur.push(p);
  }
  flush();
  return out;
}

const dt = (t: number) => new Date(t * 1000).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/** Box-zu-Box targets for a breakout of `boxes[k]` in direction `dir` (nearest first, at most 3). */
export function boxTargets(bars: readonly Bar[], boxes: readonly Box[], k: number, dir: 1 | -1, levels: readonly Level[] = []): Target[] {
  const B = boxes[k]!;
  const edge = dir > 0 ? B.top : B.bottom;
  const min = 0.35 * B.height;
  const beyond = (p: number) => (dir > 0 ? p > edge + min : p < edge - min);
  const c: Target[] = [];
  for (let j = k - 1; j >= 0; j--) {
    const P = boxes[j]!;
    if (P.grade === "schwach") continue;
    const near = dir > 0 ? P.bottom : P.top;
    if (beyond(near)) c.push({ price: near, kind: "box", label: `Box vom ${dt(P.t0)}`, zone: dir > 0 ? [P.bottom, P.top] : [P.top, P.bottom], i: P.i0 });
  }
  // origin of the leg into the box: extreme between the previous box (or 3 box lengths back) and the box start
  const from = k > 0 ? boxes[k - 1]!.i1 : Math.max(0, B.i0 - 3 * (B.i1 - B.i0 + 1));
  let ext = dir > 0 ? -Infinity : Infinity;
  let extI = -1;
  for (let i = from; i < B.i0; i++) {
    const v = dir > 0 ? bars[i]!.h : bars[i]!.l;
    if (dir > 0 ? v > ext : v < ext) { ext = v; extI = i; }
  }
  if (extI >= 0 && beyond(ext)) c.push({ price: ext, kind: "origin", label: `Startpunkt der Bewegung (${dt(bars[extI]!.t)})`, zone: null, i: extI });
  for (const L of levels) if (beyond(L.price)) c.push({ price: L.price, kind: "level", label: `${dir > 0 ? "Widerstand" : "Unterstützung"} · ${L.touches} Berührungen`, zone: null, i: L.lastI });
  if (!c.length) c.push({ price: edge + dir * B.height, kind: "measured", label: "Measured Move (Boxhöhe)", zone: null, i: null });
  c.sort((a, b) => dir * (a.price - b.price));
  const rank: Record<TargetKind, number> = { box: 3, origin: 2, level: 1, measured: 0 };
  const out: Target[] = [];
  for (const t of c) {
    const dup = out.find((o) => Math.abs(o.price - t.price) < 0.3 * B.height);
    if (!dup) out.push({ ...t });
    else if (rank[t.kind] > rank[dup.kind]) Object.assign(dup, { label: `${t.label} · ${dup.label}`, kind: t.kind, zone: t.zone ?? dup.zone, i: t.i ?? dup.i });
  }
  return out.slice(0, 3);
}

export type BoxPhase = "inside" | "breakout" | "retest" | "failed" | "target" | "running" | "none";
export const PHASE_LABEL: Readonly<Record<BoxPhase, string>> = {
  inside: "In der Box",
  breakout: "Ausbruch",
  retest: "Retest der Kante",
  failed: "Fehlausbruch – zurück in der Box",
  target: "Ziel erreicht",
  running: "Läuft – neue Box abwarten",
  none: "Keine saubere Box",
};

export interface BoxState {
  boxes: Box[];
  levels: Level[];
  /** newest box (active or last broken) */
  box: Box | null;
  phase: BoxPhase;
  dir: 0 | 1 | -1;
  price: number;
  /** position in the box, 0 = support … 1 = resistance (outside < 0 / > 1) */
  pos: number | null;
  zone: "top" | "mid" | "bottom" | null;
  /** live candle beyond an edge, close pending */
  pending: 0 | 1 | -1;
  targets: Target[];
  up: Target[];
  down: Target[];
  barsSince: number | null;
  /** 0..1 way from the broken edge to target 1 */
  progress: number | null;
  atr: number;
}

/**
 * State of the newest box. `bars` = CLOSED bars (breakouts count on closes); `live` = current price (running candle).
 */
export function boxState(bars: readonly Bar[], cfg: BoxCfg = DEFAULT_BOX_CFG, live?: number, boxes = findBoxes(bars, cfg)): BoxState {
  const n = bars.length;
  const price = fin(live) ? live : n ? bars[n - 1]!.c : NaN;
  const A = n ? atrSeries(bars)[n - 1]! : 0;
  const levels = srLevels(bars, cfg);
  const empty: BoxState = { boxes, levels, box: null, phase: "none", dir: 0, price, pos: null, zone: null, pending: 0, targets: [], up: [], down: [], barsSince: null, progress: null, atr: A };
  if (!boxes.length) return empty;
  const k = boxes.length - 1;
  const B = boxes[k]!;
  const buf = cfg.breakAtr * B.atr;
  const pos = B.height > 0 ? (price - B.bottom) / B.height : 0.5;
  const zone = pos >= 0.75 ? "top" : pos <= 0.25 ? "bottom" : "mid";
  const up = boxTargets(bars, boxes, k, 1, levels);
  const down = boxTargets(bars, boxes, k, -1, levels);
  const base: BoxState = { ...empty, box: B, pos, zone, up, down };
  // the newest box stays the reference until a new one forms: where is the market NOW relative to it?
  const last = bars[n - 1]!;
  const side = (c: number): 0 | 1 | -1 => (c > B.top + buf ? 1 : c < B.bottom - buf ? -1 : 0);
  const now = side(last.c);
  if (now === 0) {
    const reentered = B.brk !== 0;
    return { ...base, phase: reentered && n - 1 - (B.brkI ?? n) < 6 ? "failed" : "inside", pending: price > B.top + buf ? 1 : price < B.bottom - buf ? -1 : 0 };
  }
  const dir = now;
  let brkI = n - 1;
  while (brkI - 1 > B.i1 && side(bars[brkI - 1]!.c) === dir) brkI--;
  const since = n - 1 - brkI + (fin(live) ? 1 : 0);
  const targets = dir > 0 ? up : down;
  const edge = dir > 0 ? B.top : B.bottom;
  let ext = edge;
  for (let i = brkI; i < n; i++) ext = dir > 0 ? Math.max(ext, bars[i]!.h) : Math.min(ext, bars[i]!.l);
  if (fin(live)) ext = dir > 0 ? Math.max(ext, live) : Math.min(ext, live);
  const t1 = targets[0];
  const progress = t1 ? Math.max(0, Math.min(1, (price - edge) / (t1.price - edge || 1))) : null;
  const reached = !!t1 && (dir > 0 ? ext >= t1.price : ext <= t1.price);
  const back = dir > 0 ? price < B.top - buf : price > B.bottom + buf;
  let phase: BoxPhase;
  if (reached) phase = "target";
  else if (back) phase = "failed";
  else {
    const recent = bars.slice(Math.max(brkI + 1, n - 3));
    const tested = recent.some((b) => (dir > 0 ? b.l <= B.top + buf * 2 && b.c > B.top : b.h >= B.bottom - buf * 2 && b.c < B.bottom));
    phase = tested && since >= 2 ? "retest" : since > 24 ? "running" : "breakout";
  }
  return { ...base, phase, dir, targets, barsSince: since, progress };
}
