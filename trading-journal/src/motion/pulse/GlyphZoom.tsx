import { type MotionValue } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { easeInOutCubic, monotoneCurve } from "@/motion/fx/curve";
import { createFrameLoop } from "@/motion/pulse/engine";
import { watchActivity } from "@/motion/pulse/textKit";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `glyph-portal` (measured curves) as a reusable reveal: a wall with a big word punched out of it –
 * through the letters you see the content behind – and the camera dives into one letter until its stroke fills the
 * stage, revealing the content (a share card born from a trade, a new cockpit widget). Zoom
 * `s = e^(span · g(u))` and roll `θ = −5° · h(u)` follow the pack's measured monotone curves (slow start, plunge
 * around u ≈ .7, soft landing); the dive point is the deepest point of the letter's stroke (distance transform of the
 * glyph, computed once per layout), the end scale is just enough for the stroke to cover the stage.
 *
 * Like the pack (and the intro portal) the wall is a 2D canvas redrawn per frame while it moves – the word stays a
 * crisp vector at 30×+ (declared exception `glyph-zoom`: one clear, one rect, one text fill per frame, no layout
 * reads; the loop sleeps at rest, off screen and in hidden tabs). Drive it with `open` (time-based, `duration`, eased)
 * or your own `progress` MotionValue (0..1, e.g. scroll). The content is `inert` + aria-hidden until the stroke covers
 * the stage. Reduced motion: no zoom – the wall fades (`tween.fade`).
 */
export const CONFIG = {
  /** zoom curve g(u) and roll curve h(u) – measured from the pack recording */
  zoomKeys: [[0, 0], [0.142, 0.006], [0.237, 0.025], [0.313, 0.053], [0.38, 0.09], [0.4235, 0.121], [0.493, 0.186], [0.569, 0.281], [0.645, 0.404], [0.72, 0.562], [0.778, 0.688], [0.835, 0.799], [0.89, 0.891], [0.949, 0.968], [0.978, 0.992], [1, 1]] as const,
  rollKeys: [[0, 0], [0.129, 0.018], [0.209, 0.09], [0.274, 0.166], [0.326, 0.262], [0.379, 0.348], [0.4235, 0.44], [0.507, 0.53], [0.585, 0.62], [0.641, 0.7], [0.693, 0.8], [0.765, 0.94], [0.835, 1], [1, 1]] as const,
  roll: -5,
  /** the pack's "Step inside" lasts 2.6 s; the app's dive (remix) is shorter */
  duration: 1.6,
  /** u from which the stroke covers the stage (pack ≈ .94) */
  cover: 0.94,
  /** word box: share of the stage width, max share of the height */
  widthRatio: 0.84,
  maxCapRatio: 0.42,
  font: '800 100px "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
  maxDpr: 2,
} as const;

const gz = monotoneCurve(CONFIG.zoomKeys);
const gr = monotoneCurve(CONFIG.rollKeys);

/** Scale and roll (deg) at dive progress `u` for a log end-scale `span`. */
export function glyphCamera(u: number, span: number): { scale: number; roll: number } {
  const c = Math.min(1, Math.max(0, u));
  return { scale: Math.exp(span * gz(c)), roll: CONFIG.roll * gr(c) || 0 };
}

/**
 * Deepest ink point of a binary mask (chamfer 3-4 distance transform): `{ x, y, d }` in mask px, `d` = distance to the
 * nearest non-ink pixel. Pure (tests run it on hand-made masks).
 */
export function deepestPoint(ink: Uint8Array, w: number, h: number): { x: number; y: number; d: number } {
  const INF = 1e9;
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = ink[i] ? INF : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let v = dist[i]!;
      if (x > 0) v = Math.min(v, dist[i - 1]! + 3);
      if (y > 0) {
        v = Math.min(v, dist[i - w]! + 3);
        if (x > 0) v = Math.min(v, dist[i - w - 1]! + 4);
        if (x < w - 1) v = Math.min(v, dist[i - w + 1]! + 4);
      }
      dist[i] = v;
    }
  let best = { x: 0, y: 0, d: 0 };
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!dist[i]) continue;
      let v = dist[i]!;
      if (x < w - 1) v = Math.min(v, dist[i + 1]! + 3);
      if (y < h - 1) {
        v = Math.min(v, dist[i + w]! + 3);
        if (x < w - 1) v = Math.min(v, dist[i + w + 1]! + 4);
        if (x > 0) v = Math.min(v, dist[i + w - 1]! + 4);
      }
      dist[i] = v;
      if (v > best.d) best = { x, y, d: v };
    }
  return { x: best.x, y: best.y, d: best.d / 3 };
}

export interface GlyphZoomProps {
  /** The word punched out of the wall (short, upper-case reads best: "WIN", "+2,1R", "NEU"). */
  word: string;
  /** Index of the letter to dive into (default: the widest stroke of the word). */
  letter?: number;
  /** Dive in (true) / climb out (false), time-based. */
  open?: boolean;
  /** External 0..1 progress (overrides `open`). */
  progress?: MotionValue<number>;
  /** Seconds of a dive (default 1.6). */
  duration?: number;
  /** Wall colour (a concrete colour – the canvas cannot resolve CSS variables per frame). */
  wallColor?: string;
  /**
   * What the letters show while the wall stands (CSS background; default a signal-red glow) – it fades into the content
   * during the plunge. `null` lets the content itself shine through the letters.
   */
  portal?: string | null;
  /** Content behind the wall (visible through the letters, revealed by the dive). */
  children: ReactNode;
  /** Accessible name of the stage. */
  label: string;
  /** Give the stage a size (it fills its box). */
  className?: string;
  onDone?: (open: boolean) => void;
}

interface Layout {
  w: number;
  h: number;
  dpr: number;
  font: string;
  x: number;
  baseline: number;
  pivot: { x: number; y: number };
  span: number;
}

const PORTAL = "radial-gradient(120% 120% at 50% 40%, #ff3b47 0%, #e5202e 35%, #7a0d16 100%)";

export function GlyphZoom({ word, letter, open = false, progress, duration = CONFIG.duration, wallColor = "#0a0a0a", portal = PORTAL, children, label, className, onDone }: GlyphZoomProps) {
  const reduced = useReducedFx();
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [covered, setCovered] = useState(() => (progress ? progress.get() >= CONFIG.cover : open));
  const st = useRef({ u: progress ? progress.get() : open ? 1 : 0, from: 0, to: 0, t0: 0, layout: null as Layout | null, active: true, covered, onDone, wallColor, reduced });
  useLayoutEffect(() => {
    st.current.onDone = onDone;
    st.current.wallColor = wallColor;
    st.current.reduced = reduced;
  });

  const draw = () => {
    const s = st.current;
    const c = canvasRef.current;
    const L = s.layout;
    const ctx = c?.getContext?.("2d") ?? null;
    if (!c || !L || !ctx) return;
    const { scale, roll } = glyphCamera(s.u, L.span);
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0, 0, L.w, L.h);
    ctx.fillStyle = s.wallColor;
    ctx.fillRect(0, 0, L.w, L.h);
    ctx.globalCompositeOperation = "destination-out";
    ctx.translate(L.pivot.x, L.pivot.y);
    ctx.rotate((roll * Math.PI) / 180);
    ctx.scale(scale, scale);
    ctx.translate(-L.pivot.x, -L.pivot.y);
    ctx.font = L.font;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(word, L.x, L.baseline);
    ctx.globalCompositeOperation = "source-over";
  };

  const applyU = (u: number) => {
    const s = st.current;
    s.u = u;
    const cov = u >= CONFIG.cover;
    const c = canvasRef.current;
    if (c) {
      // reduced motion: the wall fades (CSS opacity transition) instead of zooming
      if (s.reduced) c.style.opacity = cov ? "0" : "1";
      else c.style.visibility = cov ? "hidden" : "visible";
    }
    const content = contentRef.current;
    if (content) content.style.transform = s.reduced ? "none" : `scale(${(1.12 - 0.12 * Math.min(1, u / CONFIG.cover)).toFixed(4)})`;
    // the portal colour fades into the content during the plunge (u .55 → cover)
    const portalEl = portalRef.current;
    if (portalEl) portalEl.style.opacity = s.reduced ? (cov ? "0" : "1") : (1 - Math.min(1, Math.max(0, (u - 0.55) / (CONFIG.cover - 0.55)))).toFixed(3);
    if (cov !== s.covered) {
      s.covered = cov;
      setCovered(cov);
    }
    if (!cov || s.reduced) draw();
  };

  // first paint (also without a canvas context, e.g. jsdom): wall / content in their start state
  useLayoutEffect(() => {
    applyU(st.current.u);
    // applyU only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // layout: fit the word, find the dive point – on mount, resize and font load (never per frame)
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const c = canvasRef.current;
    if (!stage || !c) return;
    const ctx = c.getContext?.("2d") ?? null;
    if (!ctx) return;
    const measure = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (w === 0 || h === 0) return;
      const dpr = Math.min(CONFIG.maxDpr, typeof devicePixelRatio === "number" ? devicePixelRatio : 1);
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      ctx.font = CONFIG.font;
      const m100 = ctx.measureText(word);
      const cap100 = ctx.measureText("H").actualBoundingBoxAscent || 72;
      const fs = Math.max(8, Math.min((CONFIG.widthRatio * w * 100) / Math.max(1, m100.width), (CONFIG.maxCapRatio * h * 100) / cap100));
      const font = CONFIG.font.replace("100px", `${fs.toFixed(2)}px`);
      ctx.font = font;
      const total = ctx.measureText(word).width;
      const capH = (cap100 * fs) / 100;
      const x = (w - total) / 2;
      const baseline = h / 2 + capH / 2;
      // per letter: advance offsets; pick the letter (given, or the one with the thickest stroke)
      const chars = Array.from(word);
      let best = { idx: 0, x: x + total / 2, y: h / 2, d: 1 };
      chars.forEach((ch, i) => {
        if (letter !== undefined && i !== letter) return;
        if (ch.trim() === "") return;
        const before = ctx.measureText(chars.slice(0, i).join("")).width;
        const cw = ctx.measureText(ch).width;
        const k = 3; // mask px per css px
        const pad = 4;
        const mw = Math.max(4, Math.ceil((cw + pad * 2) / k) * 1);
        const mh = Math.max(4, Math.ceil((capH * 1.3 + pad * 2) / k));
        const mc = document.createElement("canvas");
        mc.width = mw;
        mc.height = mh;
        const mx = mc.getContext("2d", { willReadFrequently: true });
        if (!mx) return;
        mx.scale(1 / k, 1 / k);
        mx.font = font;
        mx.textBaseline = "alphabetic";
        mx.fillStyle = "#000";
        mx.fillText(ch, pad, capH * 1.15 + pad);
        const data = mx.getImageData(0, 0, mw, mh).data;
        const ink = new Uint8Array(mw * mh);
        for (let p = 0; p < ink.length; p++) ink[p] = (data[p * 4 + 3] ?? 0) > 127 ? 1 : 0;
        const dp = deepestPoint(ink, mw, mh);
        const d = dp.d * k;
        if (letter !== undefined || d > best.d) best = { idx: i, x: x + before + dp.x * k - pad, y: baseline - capH * 1.15 + dp.y * k - pad, d };
      });
      // end scale: the stroke (radius d) must cover the stage from the pivot to its farthest corner
      const far = Math.max(Math.hypot(best.x, best.y), Math.hypot(w - best.x, best.y), Math.hypot(best.x, h - best.y), Math.hypot(w - best.x, h - best.y));
      const span = Math.log(Math.max(2, (far / Math.max(1, best.d)) * 1.15));
      st.current.layout = { w, h, dpr, font, x, baseline, pivot: { x: best.x, y: best.y }, span };
      applyU(st.current.u);
    };
    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(measure);
      ro.observe(stage);
    }
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) measure();
    });
    return () => {
      live = false;
      ro?.disconnect();
    };
    // applyU / draw only touch refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, letter]);

  // time-based dive (open)
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);
  useEffect(() => {
    const s = st.current;
    const loop = createFrameLoop(() => {
      if (!s.active) return false;
      const k = Math.min(1, (performance.now() - s.t0) / (duration * 1000));
      applyU(s.from + (s.to - s.from) * easeInOutCubic(k));
      if (k >= 1) {
        s.onDone?.(s.to >= 1);
        return false;
      }
      return true;
    });
    loopRef.current = loop;
    const stage = stageRef.current;
    const unwatch = stage
      ? watchActivity(stage, (a) => {
          s.active = a;
          if (a) loop.wake();
        })
      : () => {};
    return () => {
      unwatch();
      loop.stop();
    };
    // applyU only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  useEffect(() => {
    if (progress) return;
    const s = st.current;
    const to = open ? 1 : 0;
    if (s.u === to && s.to === to) return;
    if (reduced) {
      applyU(to);
      s.onDone?.(open);
      return;
    }
    s.from = s.u;
    s.to = to;
    s.t0 = performance.now();
    loopRef.current?.wake();
    // applyU only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, progress, reduced]);

  useEffect(() => {
    if (!progress) return;
    applyU(progress.get());
    return progress.on("change", (v) => applyU(Math.min(1, Math.max(0, v))));
    // applyU only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  return (
    <div ref={stageRef} role="group" aria-label={label} data-pulse="glyph-zoom" data-covered={covered ? "" : undefined} className={cn("relative isolate overflow-hidden", className)}>
      <div ref={contentRef} className="absolute inset-0" aria-hidden={covered ? undefined : true} inert={!covered}>
        {children}
      </div>
      {portal ? <div ref={portalRef} aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: portal }} /> : null}
      <span className="sr-only">{word}</span>
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 size-full" style={reduced ? { transition: `opacity ${tween.fade.duration}s ease-out` } : undefined} />
    </div>
  );
}
