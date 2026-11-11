import { CONFIG } from "@/intro/introConfig";
import { ORBIT_MS, orbitCurve } from "@/intro/curves";
import { clamp01, easeOutCubic, lerp } from "@/motion/pulse/engine";

/**
 * Build beat on the real DOM: every overview cell registers here (IntroCell). At the portal, the cells on screen are
 * measured once, posed as a slanted compact deck at the viewport centre (slanted-spread-hero) and carried to their
 * real slots on the measured cinematic-orbit progress curve, staggered in reading order. Only transform/opacity are
 * written; every cell ends at `transform: none` (no containing block for fixed descendants).
 */

export interface CellState {
  landed: boolean;
  flown: boolean;
}

export interface CellHandle {
  el: HTMLElement;
  /** false: never flies (deferred / content-visibility cells) – lands immediately. */
  fly: boolean;
  set(state: CellState): void;
}

const cells = new Set<CellHandle>();
let root: HTMLElement | null = null;

export function registerCell(h: CellHandle): () => void {
  cells.add(h);
  return () => void cells.delete(h);
}

/** The overview grid: the product-launch zoom-out (scale + blur) of the app seen through the portal is applied here. */
export function registerIntroRoot(el: HTMLElement): () => void {
  root = el;
  return () => {
    if (root === el) root = null;
  };
}

export function introRoot(): HTMLElement | null {
  return root;
}

export function resetCells(): void {
  for (const c of cells) c.set({ landed: false, flown: false });
}

export function landAllCells(): void {
  for (const c of cells) {
    clearFlightStyle(c.el);
    c.set({ landed: true, flown: flownSet.has(c) });
  }
  flownSet.clear();
}

const flownSet = new Set<CellHandle>();

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DeckPose {
  dx: number;
  dy: number;
  rot: number;
  scale: number;
}

/**
 * Deck pose of each rect (reading order) relative to its own slot: centred on (cx, cy), stacked with the
 * slanted-spread compact step (20/-8 u, u = vw / 1234), rotated by the fan angle; scale ≤ `deck.scale` and small
 * enough that a tall card still fits the viewport.
 */
export function deckPoses(rects: readonly Rect[], vw: number, vh: number, cx = vw / 2, cy = vh / 2, cfg = CONFIG.deck): DeckPose[] {
  const n = rects.length;
  const u = Math.min(1.4, Math.max(0.5, vw / 1234));
  return rects.map((r, k) => {
    const off = k - (n - 1) / 2;
    const scale = Math.min(cfg.scale, (cfg.fitH * vh) / Math.max(1, r.h), (cfg.fitW * vw) / Math.max(1, r.w));
    return {
      dx: cx + off * cfg.stepX * u - (r.x + r.w / 2),
      dy: cy + off * cfg.stepY * u - (r.y + r.h / 2),
      rot: cfg.rot + (cfg.tilt[k % cfg.tilt.length] ?? 0),
      scale,
    };
  });
}

/** CSS transform of a pose at travel progress p (0 = deck, 1 = slot → "none"). */
export function flightTransform(pose: DeckPose, p: number): string {
  if (p >= 1) return "none";
  const q = 1 - p;
  const s = lerp(pose.scale, 1, p);
  return `translate3d(${(pose.dx * q).toFixed(2)}px,${(pose.dy * q).toFixed(2)}px,0) rotate(${(pose.rot * q).toFixed(3)}deg) scale(${s.toFixed(4)})`;
}

/** Travel progress of the k-th card `t` ms after the flight start (ORBIT_KEYS, sped up by `speed`). */
export function flightProgress(t: number, k: number, cfg = CONFIG.flight): number {
  const local = (t - k * cfg.stagger) * cfg.speed;
  if (local <= 0) return 0;
  if (local >= ORBIT_MS) return 1;
  return orbitCurve(local);
}

export function flightDuration(n: number, cfg = CONFIG.flight): number {
  return Math.max(0, n - 1) * cfg.stagger + ORBIT_MS / cfg.speed;
}

function clearFlightStyle(el: HTMLElement): void {
  el.style.transform = "";
  el.style.zIndex = "";
  el.style.willChange = "";
}

interface Flyer {
  h: CellHandle;
  pose: DeckPose;
  p: number;
  landed: boolean;
  key: string;
}

export interface Flight {
  /** number of cards in the deck */
  readonly size: number;
  /** writes the poses at `t` ms after the flight start; returns false once every card has landed. */
  step(t: number): boolean;
  /** skip: carries every card from its current progress to its slot over `ms` (call `settle(e)` with e 0→1). */
  settle(e: number): void;
  /** final state: transform none everywhere, all cells landed. */
  finish(): void;
}

/**
 * Measures every registered cell once (one layout read), lands the far-off-screen and non-flying ones right away and
 * poses the rest as the deck (cells just below the fold join it and travel out of view to their slots). Must run while no cell carries a transform.
 */
export function prepareFlight(vw: number, vh: number): Flight {
  const measured = Array.from(cells).map((h) => {
    const r = h.el.getBoundingClientRect();
    return { h, r: { x: r.left, y: r.top, w: r.width, h: r.height } };
  });
  const flying = measured.filter(({ h, r }) => h.fly && r.h > 0 && r.y < vh * CONFIG.flight.fold && r.y + r.h > 0);
  flying.sort((a, b) => Math.round(a.r.y) - Math.round(b.r.y) || a.r.x - b.r.x);
  const poses = deckPoses(
    flying.map((f) => f.r),
    vw,
    vh,
  );
  const flyers: Flyer[] = flying.map((f, k) => ({ h: f.h, pose: poses[k]!, p: 0, landed: false, key: "" }));
  flownSet.clear();
  for (const f of flyers) flownSet.add(f.h);
  for (const m of measured) if (!flownSet.has(m.h)) m.h.set({ landed: true, flown: false });
  const n = flyers.length;
  flyers.forEach((f, k) => {
    f.h.set({ landed: false, flown: true });
    f.h.el.style.willChange = "transform";
    f.h.el.style.zIndex = String(n - k);
    write(f, 0);
  });

  function write(f: Flyer, p: number) {
    f.p = p;
    const tf = flightTransform(f.pose, p);
    if (tf !== f.key) {
      f.key = tf;
      f.h.el.style.transform = tf === "none" ? "" : tf;
    }
    if (!f.landed && p >= CONFIG.flight.landAt) {
      f.landed = true;
      f.h.set({ landed: true, flown: true });
    }
    if (p >= 1) {
      f.h.el.style.zIndex = "";
      f.h.el.style.willChange = "";
    }
  }

  const from: number[] = [];
  return {
    size: n,
    step(t) {
      let busy = false;
      flyers.forEach((f, k) => {
        const p = flightProgress(t, k);
        if (p !== f.p || p === 0) write(f, p);
        if (p < 1) busy = true;
      });
      return busy;
    },
    settle(e) {
      if (from.length === 0) for (const f of flyers) from.push(f.p);
      const k = easeOutCubic(clamp01(e));
      flyers.forEach((f, i) => write(f, e >= 1 ? 1 : lerp(from[i] ?? 0, 1, k)));
    },
    finish() {
      for (const f of flyers) write(f, 1);
      landAllCells();
    },
  };
}

/** App zoom-out seen through the portal (product-launch camera): scale 1.06 → 1, blur 8 → 0 over portal progress. */
export function appPose(u: number, cfg = CONFIG.app): { scale: number; blur: number } {
  const e = easeOutCubic(clamp01((u - cfg.from) / (1 - cfg.from)));
  return { scale: lerp(cfg.scaleFrom, 1, e), blur: lerp(cfg.blurFrom, 0, e) };
}

