import { physics } from "@/motion/physics/constants";

/** The fields of a PointerEvent the tracker reads (React's `e.nativeEvent`, a raw PointerEvent, or a test stub). */
export interface PointerSampleSource {
  timeStamp: number;
  clientX: number;
  clientY: number;
  getCoalescedEvents?: () => ArrayLike<{ timeStamp: number; clientX: number; clientY: number }>;
}

export interface VelocityTrackerOptions {
  /** ring size (default `physics.velocitySamples` = 48: the 100 ms horizon at 240 Hz with headroom). */
  capacity?: number;
  /** ms of history in the fit (default 100). */
  horizon?: number;
  /** ms without a sample before `now` ⇒ velocity 0 (default 40). */
  stopped?: number;
  /** px – moved less than this over the last `stopped` ms ⇒ velocity 0 (default 2). */
  stillTravel?: number;
  /** px/s clamp (default 8000). */
  maxVelocity?: number;
}

export interface VelocityTracker {
  /** Forget all samples (call on pointerdown). */
  reset(): void;
  /** One sample: `t` in ms (any clock, but the same clock for every sample and for `now`). */
  add(t: number, x: number, y: number): void;
  /** Feeds every coalesced sample of a pointer event (120/240 Hz digitisers) with its own timeStamp; falls back to the event itself. */
  addEvent(e: PointerSampleSource): void;
  /** px/s. `now` = the release event's timeStamp: if the last sample is ≥ `stopped` ms older, the pointer rested ⇒ 0. */
  velocity(now?: number): { x: number; y: number };
  /** |velocity| in px/s. */
  speed(now?: number): number;
  /** Number of samples held. */
  count(): number;
  /** Timestamp of the newest sample, or NaN when empty. */
  lastTime(): number;
}

/**
 * Pointer velocity by WEIGHTED LEAST SQUARES over the last 100 ms (Android / Flutter horizon, 40 ms assume-stopped):
 * a straight line x(t) = a + b·t is fitted to the samples of the horizon with weights rising linearly from 0 (oldest,
 * 100 ms) to 1 (newest), and b is the velocity. Robust against single jittery samples and frame quantisation (Motion's
 * PanSession takes a two-point difference instead). Allocation-free ring buffer; O(n) per read, O(1) per sample.
 * Rules: duplicate timestamps keep the latest position (coalesced lists may repeat the parent event); out-of-order or
 * non-finite samples are dropped; a pointer that rested ≥ 40 ms before `now`, or moved < 2 px over the last 40 ms,
 * reads 0 ("placed, not thrown" — a slow lift is gentle).
 */
export function createVelocityTracker(opts: VelocityTrackerOptions = {}): VelocityTracker {
  const size = Math.max(2, Math.floor(opts.capacity ?? physics.velocitySamples));
  const horizon = opts.horizon ?? physics.velocityHorizon;
  const stopped = opts.stopped ?? physics.velocityStopped;
  const still = opts.stillTravel ?? physics.stillTravel;
  const vmax = opts.maxVelocity ?? physics.maxVelocity;
  const ts = new Float64Array(size);
  const xs = new Float64Array(size);
  const ys = new Float64Array(size);
  let head = 0;
  let n = 0;
  const lastIndex = () => (head - 1 + size) % size;
  const clampV = (v: number) => (v > vmax ? vmax : v < -vmax ? -vmax : v);

  const add = (t: number, x: number, y: number) => {
    if (!Number.isFinite(t) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (n) {
      const li = lastIndex();
      const tl = ts[li]!;
      if (t < tl) return;
      if (t === tl) {
        xs[li] = x;
        ys[li] = y;
        return;
      }
    }
    ts[head] = t;
    xs[head] = x;
    ys[head] = y;
    head = (head + 1) % size;
    if (n < size) n++;
  };

  /** True when the pointer moved less than `still` px over the last `stopped` ms (and the window is covered). */
  const paused = (li: number): boolean => {
    if (!(still > 0)) return false;
    const tl = ts[li]!;
    const xl = xs[li]!;
    const yl = ys[li]!;
    let max = 0;
    for (let i = 1; i < n; i++) {
      const j = (li - i + size) % size;
      const age = tl - ts[j]!;
      if (age >= stopped) {
        // interpolate the position at exactly `stopped` ms ago between this sample and the next newer one
        const k = (j + 1) % size;
        const span = ts[k]! - ts[j]!;
        const f = span > 0 ? (ts[k]! - (tl - stopped)) / span : 0;
        const px = xs[k]! + (xs[j]! - xs[k]!) * f;
        const py = ys[k]! + (ys[j]! - ys[k]!) * f;
        max = Math.max(max, Math.hypot(px - xl, py - yl));
        return max < still;
      }
      max = Math.max(max, Math.hypot(xs[j]! - xl, ys[j]! - yl));
      if (max >= still) return false;
    }
    return false; // the window is not covered by samples: no verdict
  };

  const velocity = (now?: number): { x: number; y: number } => {
    if (n < 2) return { x: 0, y: 0 };
    const li = lastIndex();
    const tl = ts[li]!;
    if (now !== undefined && Number.isFinite(now) && now - tl >= stopped) return { x: 0, y: 0 };
    if (paused(li)) return { x: 0, y: 0 };
    const xl = xs[li]!;
    const yl = ys[li]!;
    let sw = 0, st = 0, stt = 0, sx = 0, sy = 0, stx = 0, sty = 0, k = 0;
    for (let i = 0; i < n; i++) {
      const j = (li - i + size) % size;
      const t = ts[j]! - tl; // ≤ 0
      if (-t > horizon) break;
      const w = 1 + t / horizon; // 1 (newest) … 0 (horizon)
      const x = xs[j]! - xl;
      const y = ys[j]! - yl;
      sw += w;
      st += w * t;
      stt += w * t * t;
      sx += w * x;
      sy += w * y;
      stx += w * t * x;
      sty += w * t * y;
      k++;
    }
    const den = sw * stt - st * st;
    if (k < 2 || !(Math.abs(den) > 1e-9)) return { x: 0, y: 0 };
    return { x: clampV(((sw * stx - st * sx) / den) * 1000), y: clampV(((sw * sty - st * sy) / den) * 1000) };
  };

  return {
    reset() {
      head = 0;
      n = 0;
    },
    add,
    addEvent(e) {
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : null;
      if (list && list.length) {
        for (let i = 0; i < list.length; i++) {
          const c = list[i]!;
          add(c.timeStamp > 0 ? c.timeStamp : e.timeStamp, c.clientX, c.clientY);
        }
        // the parent event is NOT added again: it mirrors the last coalesced sample, and a later dispatch timeStamp
        // with the same position would read as a stop
      } else add(e.timeStamp, e.clientX, e.clientY);
    },
    velocity,
    speed(now) {
      const v = velocity(now);
      return Math.hypot(v.x, v.y);
    },
    count: () => n,
    lastTime: () => (n ? ts[lastIndex()]! : NaN),
  };
}
