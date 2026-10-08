/**
 * Market structure and support / resistance (ours, decision 10, 2026-10-08) after LuxAlgo "Smart Money Concepts" — the
 * indicator on the user's chart ("Historical Colored All … small 50 5 5 Atr High/Low 3 0.1"):
 *
 * - Swings: the LuxAlgo `swings(len)` leg logic (the same as `luxZone`): swing structure with `swingLookback` (50),
 *   internal structure with `internal` (5). Labels HH / LH / HL / LL against the previous pivot of the same length.
 * - Breaks: a close crossing the last swing (internal) high / low → BOS, or CHoCH when it flips the trend; internal
 *   breaks need an internal pivot different from the swing pivot (LuxAlgo's `top_y != itop_y`).
 * - Order blocks ("Atr" filter, "High/Low" mitigation): on a bullish break the bar with the lowest low between the
 *   broken pivot and the break (bars with a range ≥ 2 × ATR 200 skipped) → demand box [low, high]; bearish mirrored
 *   (highest high → supply). A demand block is mitigated by a later low below its bottom, supply by a high above its top.
 *   The newest 5 internal and 5 swing blocks that are still unmitigated are kept (LuxAlgo shows 5 + 5).
 * - EQH / EQL: two consecutive `eqLen` (3) pivots within `eqThreshold` (0.1) × ATR 200.
 * - Levels: unbroken swing / internal pivots, unmitigated blocks, unbroken EQH / EQL and the premium/discount range
 *   (the trailing extremes) → nearest supports below / resistances above the last close (a zone that contains the close
 *   has distance 0), distances also in ATR 14.
 * ATR 200 is a Wilder RMA of the true range; until 200 bars exist the cumulative mean range stands in (LuxAlgo's other
 * filter option). Pure, O(n · swing length).
 */
import type { Bar } from "./indicators";
import { rma, rolling } from "./indicators";

export type SwingLabel = "HH" | "LH" | "HL" | "LL";

export interface SwingPoint {
  index: number;
  /** open time, unix SECONDS */
  t: number;
  price: number;
  /** true = swing high, false = swing low */
  high: boolean;
  /** internal (length 5) instead of swing structure */
  internal: boolean;
  label: SwingLabel;
  /** a later close beyond the pivot (long: below a low; short: above a high) */
  broken: boolean;
}

export interface StructureBreak {
  /** bar of the break */
  index: number;
  t: number;
  /** broken level and its pivot bar */
  level: number;
  pivot: number;
  kind: "BOS" | "CHoCH";
  /** 1 = bullish (close above a high), −1 = bearish */
  dir: 1 | -1;
  internal: boolean;
}

export interface OrderBlock {
  /** the order-block candle */
  index: number;
  t: number;
  top: number;
  btm: number;
  /** 1 = demand (bullish), −1 = supply (bearish) */
  dir: 1 | -1;
  internal: boolean;
  /** bar of the break that created it */
  brk: number;
}

export interface EqualLevel {
  kind: "EQH" | "EQL";
  price: number;
  from: { index: number; t: number; price: number };
  to: { index: number; t: number; price: number };
  /** a later close beyond the level (swept / taken) */
  broken: boolean;
}

export type LevelKind = "ob" | "swing" | "internal" | "eq" | "range";

export interface Level {
  /** the edge facing the price (support: top of a zone, resistance: bottom) */
  price: number;
  /** zone bounds (= price for a line) */
  top: number;
  btm: number;
  kind: LevelKind;
  /** 1 = support (below), −1 = resistance (above) */
  dir: 1 | -1;
  /** origin bar (pivot / order-block candle); −1 for the range */
  index: number;
  t: number;
  /** distance from the last close to `price`, ≥ 0 (0 inside a zone) */
  dist: number;
  /** `dist` in ATR 14 */
  distAtr: number;
  /** German name: `Demand-OB`, `Swing-Tief`, `Internes Tief`, `EQL`, `Range-Tief` (mirrored for resistance) */
  label: string;
}

export interface Structure {
  /** recent pivots, oldest first (the last 8 swing and 8 internal) */
  swings: SwingPoint[];
  /** recent breaks, oldest first (the last 10) */
  breaks: StructureBreak[];
  /** unmitigated order blocks (newest 5 internal + 5 swing), oldest first */
  obs: OrderBlock[];
  /** recent EQH / EQL (the last 6), oldest first */
  eqs: EqualLevel[];
  /** swing / internal trend from the last break: 1 up, −1 down, 0 none yet */
  trend: -1 | 0 | 1;
  itrend: -1 | 0 | 1;
  /** nearest first, at most 4 each */
  supports: Level[];
  resistances: Level[];
  support: Level | null;
  resistance: Level | null;
  /** ATR 14 (Wilder) at the last bar */
  atr: number;
  /** last close */
  close: number;
  /** index of the last bar (ages: `last − index`) */
  last: number;
}

export interface StructureCfg {
  swing: number;
  internal: number;
  eqLen: number;
  eqThreshold: number;
  /** premium/discount range (trailing extremes), optional extra levels */
  range?: { hi: number; lo: number } | null;
}

/** Wilder ATR of `len` (`NaN` until `len` bars). */
export function atr(bars: readonly Bar[], len: number): number[] {
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1]!.c), Math.abs(b.l - bars[i - 1]!.c))));
  return rma(tr, len);
}

interface LegPivot {
  /** bar at which the pivot is detected (`index + len`) */
  at: number;
  index: number;
  high: boolean;
  price: number;
}

/**
 * LuxAlgo `swings(len)` pivots in detection order: at bar i (≥ len) the bar `i − len` is a swing high when its high
 * is above every high of the `len` bars after it (leg 0), a swing low when its low is below every low after it (leg 1);
 * a leg change emits the pivot. Same rule as `luxZone`, O(n) with rolling extremes.
 */
function legPivots(bars: readonly Bar[], hs: readonly number[], ls: readonly number[], len: number): LegPivot[] {
  const out: LegPivot[] = [];
  const hh = rolling(hs, len, true);
  const ll = rolling(ls, len, false);
  let leg = 0;
  let prevLeg = -1;
  for (let i = 0; i < bars.length; i++) {
    if (i >= len) {
      const p = bars[i - len]!;
      if (p.h > hh[i]!) leg = 0;
      else if (p.l < ll[i]!) leg = 1;
    }
    if (prevLeg !== -1 && leg !== prevLeg) {
      const p = bars[i - len]!;
      out.push(leg === 1 ? { at: i, index: i - len, high: false, price: p.l } : { at: i, index: i - len, high: true, price: p.h });
    }
    prevLeg = leg;
  }
  return out;
}

const keepLast = <T>(xs: T[], n: number): T[] => (xs.length > n ? xs.slice(xs.length - n) : xs);

const LEVEL_TEXT: Readonly<Record<LevelKind, readonly [string, string]>> = {
  ob: ["Demand-OB", "Supply-OB"],
  swing: ["Swing-Tief", "Swing-Hoch"],
  internal: ["Internes Tief", "Internes Hoch"],
  eq: ["EQL", "EQH"],
  range: ["Range-Tief", "Range-Hoch"],
};
/** When two levels sit within 0.1 ATR the stronger kind is kept. */
const KIND_RANK: Readonly<Record<LevelKind, number>> = { ob: 5, swing: 4, eq: 3, internal: 2, range: 1 };

/** Market structure of a series (see the module note). `null` below 3 bars. */
export function marketStructure(bars: readonly Bar[], cfg: StructureCfg): Structure | null {
  const n = bars.length;
  if (n < 3) return null;
  const a200 = atr(bars, 200);
  const a14 = atr(bars, 14);
  // OB / EQ threshold: ATR 200, the cumulative mean range until it exists
  const thr: number[] = new Array(n);
  let cum = 0;
  for (let i = 0; i < n; i++) {
    cum += bars[i]!.h - bars[i]!.l;
    thr[i] = Number.isFinite(a200[i]!) ? a200[i]! : cum / (i + 1);
  }
  const hs = bars.map((b) => b.h);
  const ls = bars.map((b) => b.l);
  // detection order per bar (a leg emits at most one pivot per bar)
  const byBar = (ev: LegPivot[]): Array<LegPivot | undefined> => {
    const m: Array<LegPivot | undefined> = new Array(n);
    for (const e of ev) m[e.at] = e;
    return m;
  };
  const sAt = byBar(legPivots(bars, hs, ls, cfg.swing));
  const iAt = byBar(legPivots(bars, hs, ls, cfg.internal));
  const eAt = byBar(legPivots(bars, hs, ls, cfg.eqLen));

  const swings: SwingPoint[] = [];
  const iswings: SwingPoint[] = [];
  const breaks: StructureBreak[] = [];
  const eqs: EqualLevel[] = [];
  let obs: OrderBlock[] = [];
  let topY = NaN, topX = -1, topCross = false, pTopY = NaN;
  let btmY = NaN, btmX = -1, btmCross = false, pBtmY = NaN;
  let itopY = NaN, itopX = -1, itopCross = false, pItopY = NaN;
  let ibtmY = NaN, ibtmX = -1, ibtmCross = false, pIbtmY = NaN;
  let trend: -1 | 0 | 1 = 0;
  let itrend: -1 | 0 | 1 = 0;
  let eqTop = NaN, eqTopX = -1, eqBtm = NaN, eqBtmX = -1;

  const obCoord = (useMax: boolean, loc: number, i: number, internal: boolean, brk: number): void => {
    let mn = Infinity;
    let mx = -Infinity;
    let idx = -1;
    for (let j = i - 1; j > loc; j--) {
      const b = bars[j]!;
      if (!(b.h - b.l < thr[j]! * 2)) continue;
      // ">=": on a tie the older bar wins, like LuxAlgo's backwards loop
      if (useMax) {
        if (b.h >= mx) {
          mx = b.h;
          mn = b.l;
          idx = j;
        }
      } else if (b.l <= mn) {
        mn = b.l;
        mx = b.h;
        idx = j;
      }
    }
    if (idx >= 0) obs.push({ index: idx, t: bars[idx]!.t, top: mx, btm: mn, dir: useMax ? -1 : 1, internal, brk });
  };

  for (let i = 0; i < n; i++) {
    const b = bars[i]!;
    const se = sAt[i];
    if (se) {
      const e = se;
      if (e.high) {
        swings.push({ index: e.index, t: bars[e.index]!.t, price: e.price, high: true, internal: false, label: e.price > topY ? "HH" : "LH", broken: false });
        topCross = true;
        topY = e.price;
        topX = e.index;
      } else {
        swings.push({ index: e.index, t: bars[e.index]!.t, price: e.price, high: false, internal: false, label: e.price < btmY ? "LL" : "HL", broken: false });
        btmCross = true;
        btmY = e.price;
        btmX = e.index;
      }
    }
    const ie = iAt[i];
    if (ie) {
      const e = ie;
      if (e.high) {
        iswings.push({ index: e.index, t: bars[e.index]!.t, price: e.price, high: true, internal: true, label: e.price > itopY ? "HH" : "LH", broken: false });
        itopCross = true;
        itopY = e.price;
        itopX = e.index;
      } else {
        iswings.push({ index: e.index, t: bars[e.index]!.t, price: e.price, high: false, internal: true, label: e.price < ibtmY ? "LL" : "HL", broken: false });
        ibtmCross = true;
        ibtmY = e.price;
        ibtmX = e.index;
      }
    }
    if (i > 0) {
      const pc = bars[i - 1]!.c;
      if (itopCross && b.c > itopY && pc <= pItopY && topY !== itopY) {
        breaks.push({ index: i, t: b.t, level: itopY, pivot: itopX, kind: itrend < 0 ? "CHoCH" : "BOS", dir: 1, internal: true });
        itopCross = false;
        itrend = 1;
        obCoord(false, itopX, i, true, i);
      }
      if (topCross && b.c > topY && pc <= pTopY) {
        breaks.push({ index: i, t: b.t, level: topY, pivot: topX, kind: trend < 0 ? "CHoCH" : "BOS", dir: 1, internal: false });
        topCross = false;
        trend = 1;
        obCoord(false, topX, i, false, i);
      }
      if (ibtmCross && b.c < ibtmY && pc >= pIbtmY && btmY !== ibtmY) {
        breaks.push({ index: i, t: b.t, level: ibtmY, pivot: ibtmX, kind: itrend > 0 ? "CHoCH" : "BOS", dir: -1, internal: true });
        ibtmCross = false;
        itrend = -1;
        obCoord(true, ibtmX, i, true, i);
      }
      if (btmCross && b.c < btmY && pc >= pBtmY) {
        breaks.push({ index: i, t: b.t, level: btmY, pivot: btmX, kind: trend > 0 ? "CHoCH" : "BOS", dir: -1, internal: false });
        btmCross = false;
        trend = -1;
        obCoord(true, btmX, i, false, i);
      }
    }
    // mitigation ("High/Low")
    if (obs.length && obs.some((o) => (o.dir === 1 ? b.l < o.btm : b.h > o.top))) obs = obs.filter((o) => (o.dir === 1 ? !(b.l < o.btm) : !(b.h > o.top)));
    // EQH / EQL
    const ee = eAt[i];
    if (ee) {
      const e = ee;
      if (e.high) {
        if (Math.max(e.price, eqTop) < Math.min(e.price, eqTop) + thr[i]! * cfg.eqThreshold)
          eqs.push({ kind: "EQH", price: Math.max(e.price, eqTop), from: { index: eqTopX, t: bars[eqTopX]!.t, price: eqTop }, to: { index: e.index, t: bars[e.index]!.t, price: e.price }, broken: false });
        eqTop = e.price;
        eqTopX = e.index;
      } else {
        if (Math.max(e.price, eqBtm) < Math.min(e.price, eqBtm) + thr[i]! * cfg.eqThreshold)
          eqs.push({ kind: "EQL", price: Math.min(e.price, eqBtm), from: { index: eqBtmX, t: bars[eqBtmX]!.t, price: eqBtm }, to: { index: e.index, t: bars[e.index]!.t, price: e.price }, broken: false });
        eqBtm = e.price;
        eqBtmX = e.index;
      }
    }
    pTopY = topY;
    pBtmY = btmY;
    pItopY = itopY;
    pIbtmY = ibtmY;
  }

  // suffix close extremes after each bar (unbroken levels)
  const minAfter = new Array<number>(n + 1).fill(Infinity);
  const maxAfter = new Array<number>(n + 1).fill(-Infinity);
  for (let i = n - 1; i >= 0; i--) {
    minAfter[i] = Math.min(minAfter[i + 1]!, bars[i]!.c);
    maxAfter[i] = Math.max(maxAfter[i + 1]!, bars[i]!.c);
  }
  for (const q of eqs) q.broken = q.kind === "EQL" ? minAfter[q.to.index + 1]! < q.price : maxAfter[q.to.index + 1]! > q.price;
  for (const p of swings) p.broken = p.high ? maxAfter[p.index + 1]! > p.price : minAfter[p.index + 1]! < p.price;
  for (const p of iswings) p.broken = p.high ? maxAfter[p.index + 1]! > p.price : minAfter[p.index + 1]! < p.price;

  const close = bars[n - 1]!.c;
  const atrNow = a14[n - 1]!;
  const unit = Number.isFinite(atrNow) && atrNow > 0 ? atrNow : thr[n - 1]! || 1;
  const sup: Level[] = [];
  const res: Level[] = [];
  const add = (kind: LevelKind, dir: 1 | -1, top: number, btm: number, index: number): void => {
    if (!Number.isFinite(top) || !Number.isFinite(btm)) return;
    const edge = dir === 1 ? top : btm;
    if (dir === 1 ? btm > close : top < close) return; // wrong side of the price
    const dist = close >= btm && close <= top ? 0 : Math.abs(close - edge);
    (dir === 1 ? sup : res).push({ price: edge, top, btm, kind, dir, index, t: index >= 0 ? bars[index]!.t : bars[n - 1]!.t, dist, distAtr: dist / unit, label: LEVEL_TEXT[kind][dir === 1 ? 0 : 1] });
  };
  for (const p of [...swings, ...iswings]) {
    const kind: LevelKind = p.internal ? "internal" : "swing";
    if (!p.broken) add(kind, p.high ? -1 : 1, p.price, p.price, p.index);
  }
  const iObs = keepLast(obs.filter((o) => o.internal), 5);
  const sObs = keepLast(obs.filter((o) => !o.internal), 5);
  const keptObs = [...iObs, ...sObs].sort((x, y) => x.index - y.index || x.brk - y.brk);
  for (const o of keptObs) add("ob", o.dir, o.top, o.btm, o.index);
  for (const q of eqs) if (!q.broken) add("eq", q.kind === "EQL" ? 1 : -1, q.price, q.price, q.to.index);
  if (cfg.range && cfg.range.hi > cfg.range.lo) {
    add("range", 1, cfg.range.lo, cfg.range.lo, -1);
    add("range", -1, cfg.range.hi, cfg.range.hi, -1);
  }
  const nearest = (xs: Level[]): Level[] => {
    xs.sort((x, y) => x.dist - y.dist || KIND_RANK[y.kind] - KIND_RANK[x.kind]);
    const out: Level[] = [];
    for (const l of xs) {
      const dup = out.find((o) => Math.abs(o.price - l.price) <= 0.1 * unit);
      if (dup) continue;
      out.push(l);
      if (out.length === 4) break;
    }
    return out;
  };
  const supports = nearest(sup);
  const resistances = nearest(res);
  const allSwings = [...keepLast(swings, 8), ...keepLast(iswings, 8)].sort((x, y) => x.index - y.index || Number(x.internal) - Number(y.internal));
  return {
    swings: allSwings,
    breaks: keepLast(breaks, 10),
    obs: keptObs,
    eqs: keepLast(eqs, 6),
    trend,
    itrend,
    supports,
    resistances,
    support: supports[0] ?? null,
    resistance: resistances[0] ?? null,
    atr: atrNow,
    close,
    last: n - 1,
  };
}

/**
 * Latest internal swing low (`high = false`) or high, and whether it is the FIRST higher low (the low before it was a
 * lower low) — short mirrored: the first lower high after a higher high. `null` without such a pivot.
 */
export function lastInternalPivot(s: Pick<Structure, "swings">, high = false): { pivot: SwingPoint; first: boolean } | null {
  const ps = s.swings.filter((p) => p.internal && p.high === high);
  const pivot = ps[ps.length - 1];
  if (!pivot) return null;
  const prev = ps[ps.length - 2];
  return { pivot, first: high ? pivot.label === "LH" && prev?.label === "HH" : pivot.label === "HL" && prev?.label === "LL" };
}
