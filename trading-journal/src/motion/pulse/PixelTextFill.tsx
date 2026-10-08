import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { clamp01 } from "@/motion/pulse/engine";
import { createTimeline, usePlayTrigger } from "@/motion/pulse/textKit";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `pixel-text-fill` (measured): resting grey text; a dithered pixel ember front (signal red instead of
 * the pack's orange) sweeps each line left→right, a soft white fill follows; lines are chained.
 */
export const CONFIG = {
  /** Measured per-line table (ms from the first ember, i.e. the pack's 1000 ms autoplay pre-roll removed). */
  oStart: [0, 1100, 2300, 3000],
  oDur: [1000, 950, 800, 800],
  wStart: [1100, 2300, 3000, 3800],
  wDur: [700, 600, 700, 550],
  oPow: 1.7, // ember accelerates (p^1.7)
  wPow: 1.0, // white linear
  featherOEm: 2.2, // soft right edge of the ember window
  featherWEm: 4.4, // soft right edge of the white window (~170 px at 40 px)
  dotPx: 4, // dither grid
  holePx: 1.2, // dither hole radius
  restColor: "var(--color-line-2, #2c2c2c)", // pack #252527 (~15 % white)
  emberColor: "var(--color-signal, #e5202e)", // pack #ff5200
  fillColor: "var(--color-fg, #f2f2f2)", // pack #f4f0ec
} as const;

export interface LineSchedule {
  oStart: number;
  oDur: number;
  wStart: number;
  wDur: number;
}

/**
 * Per-line schedule for `n` lines: the measured table for the first four lines, every further line repeats the
 * fourth line's rhythm (ember 800 ms, white starts when the ember has left, 550 ms). `speed` > 1 is faster.
 */
export function scheduleFor(n: number, speed = 1): LineSchedule[] {
  const out: LineSchedule[] = [];
  const k = 1 / (speed > 0 ? speed : 1);
  for (let i = 0; i < n; i++) {
    if (i < CONFIG.oStart.length) {
      out.push({ oStart: CONFIG.oStart[i]!, oDur: CONFIG.oDur[i]!, wStart: CONFIG.wStart[i]!, wDur: CONFIG.wDur[i]! });
    } else {
      const prev = out[i - 1]!;
      const oDur = CONFIG.oDur[3]!;
      out.push({ oStart: prev.wStart, oDur, wStart: prev.wStart + oDur, wDur: CONFIG.wDur[3]! });
    }
  }
  return out.map((s) => ({ oStart: s.oStart * k, oDur: s.oDur * k, wStart: s.wStart * k, wDur: s.wDur * k }));
}

export function totalDuration(schedule: LineSchedule[]): number {
  return schedule.reduce((m, s) => Math.max(m, s.wStart + s.wDur, s.oStart + s.oDur), 0);
}

/** Front progress (0..1) of the ember and the white fill for one line at `t` ms. */
export function fillAt(t: number, s: LineSchedule): { o: number; w: number } {
  return {
    o: Math.pow(clamp01((t - s.oStart) / s.oDur), CONFIG.oPow),
    w: Math.pow(clamp01((t - s.wStart) / s.wDur), CONFIG.wPow),
  };
}

export interface PixelTextFillProps {
  lines: string[];
  play?: number | boolean;
  /** Play once on mount (default true). Without a pending play the text shows filled (final). */
  playOnMount?: boolean;
  /** Time scale (default 1; 2 = twice as fast). */
  speed?: number;
  /** ms before the first ember (default 0). */
  delay?: number;
  onDone?: () => void;
  className?: string;
  align?: "left" | "center";
  as?: "p" | "div" | "h1" | "h2" | "h3";
}

const featherMask = (em: number) => `linear-gradient(90deg, #000 calc(100% - ${em}em), transparent 100%)`;
const DITHER = `radial-gradient(circle at 25% 25%, transparent 0 ${CONFIG.holePx}px, #000 ${CONFIG.holePx + 0.45}px), radial-gradient(circle at 75% 75%, transparent 0 ${CONFIG.holePx}px, #000 ${CONFIG.holePx + 0.45}px)`;

const revStyle = (featherEm: number): CSSProperties => ({
  position: "absolute",
  left: 0,
  top: 0,
  height: "100%",
  width: `calc(200% + ${featherEm}em)`,
  overflow: "hidden",
  pointerEvents: "none",
  transform: "translate3d(-100000px,0,0)",
  WebkitMaskImage: featherMask(featherEm),
  maskImage: featherMask(featherEm),
});
const innerStyle = (featherEm: number, color: string, dither: boolean): CSSProperties => ({
  position: "absolute",
  left: 0,
  top: 0,
  // rev width = 2W + F → W = (100% - F) / 2: the copy wraps exactly like the base line
  width: `calc((100% - ${featherEm}em) / 2)`,
  color,
  ...(dither
    ? {
        WebkitMaskImage: DITHER,
        maskImage: DITHER,
        WebkitMaskSize: `${CONFIG.dotPx}px ${CONFIG.dotPx}px`,
        maskSize: `${CONFIG.dotPx}px ${CONFIG.dotPx}px`,
        WebkitMaskComposite: "source-in",
        maskComposite: "intersect",
      }
    : null),
});

interface LineEls {
  line: HTMLElement;
  base: HTMLElement;
  revs: [HTMLElement, HTMLElement];
  ins: [HTMLElement, HTMLElement];
  W: number;
  fo: number;
  fw: number;
  eo: number;
  ew: number;
}

interface Engine {
  play(delay: number, speed: number, onDone?: () => void): void;
  setFilled(): void;
  destroy(): void;
}

function createEngine(root: HTMLElement): Engine {
  const lines: LineEls[] = Array.from(root.querySelectorAll<HTMLElement>("[data-ptf-line]")).map((line) => {
    const base = line.querySelector<HTMLElement>("[data-ptf-base]")!;
    const revs = Array.from(line.querySelectorAll<HTMLElement>("[data-ptf-rev]")) as [HTMLElement, HTMLElement];
    const ins = revs.map((r) => r.firstElementChild as HTMLElement) as [HTMLElement, HTMLElement];
    return { line, base, revs, ins, W: 0, fo: 0, fw: 0, eo: NaN, ew: NaN };
  });
  const byLine = new Map<Element, LineEls>(lines.map((l) => [l.line, l]));
  let schedule: LineSchedule[] = [];
  let doneCb: (() => void) | undefined;
  let state: "rest" | "running" | "filled" = "rest";
  let lastT = -1e9;
  /** Line widths and the font size are known (the first `ResizeObserver` report, or the synchronous fallback). */
  let measured = false;

  const readFont = () => {
    const fs = parseFloat(getComputedStyle(root).fontSize) || 16;
    for (const l of lines) {
      l.fo = CONFIG.featherOEm * fs;
      l.fw = CONFIG.featherWEm * fs;
      l.eo = l.ew = NaN;
    }
  };
  /** Fallback without `ResizeObserver` (jsdom): one synchronous read when a play starts. */
  const measureNow = () => {
    readFont();
    for (const l of lines) l.W = l.line.offsetWidth;
    measured = true;
  };
  const setEdge = (l: LineEls, layer: 0 | 1, e: number) => {
    const key = layer === 0 ? "eo" : "ew";
    if (l[key] === e) return;
    l[key] = e;
    const B = 2 * l.W + (layer === 0 ? l.fo : l.fw);
    l.revs[layer].style.transform = `translate3d(${(e - B).toFixed(2)}px,0,0)`;
    l.ins[layer].style.transform = `translate3d(${(B - e).toFixed(2)}px,0,0)`;
  };
  const apply = (t: number) => {
    lastT = t;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      const s = schedule[i];
      if (!s) continue;
      const { o, w } = fillAt(t, s);
      setEdge(l, 0, Math.round(o * (l.W + l.fo) * 4) / 4);
      setEdge(l, 1, Math.round(w * (l.W + l.fw) * 4) / 4);
    }
  };
  const setMode = (mode: "rest" | "running" | "filled") => {
    state = mode;
    root.setAttribute("data-state", mode);
    const filled = mode === "filled";
    for (const l of lines) {
      l.base.style.color = filled ? CONFIG.fillColor : CONFIG.restColor;
      for (const r of l.revs) {
        r.style.display = filled ? "none" : "";
        r.style.willChange = mode === "running" ? "transform" : "";
      }
      for (const n of l.ins) n.style.willChange = mode === "running" ? "transform" : "";
    }
  };
  let total = 0;
  /** Frames a running play has waited for the first size report. */
  let waited = 0;
  const timeline = createTimeline(root, (t) => {
    // until the first size report the windows stay parked off-line (their initial transform) and the clock runs on;
    // an observer that never reports (a stubbed one) falls back to one read in a frame
    if (!measured) {
      if (++waited <= 3) return true;
      measureNow();
    }
    apply(t);
    if (t >= total) {
      setMode("filled");
      const cb = doneCb;
      doneCb = undefined;
      cb?.();
      return false;
    }
    return true;
  });
  // Sizes come from the observer, never from a read in a commit or an effect: a layout read there forced the whole
  // freshly mounted page through style + layout inside the React task, once per instance with the writes of the
  // previous one in between (≈ 200 ms of forced layout on a page switch to the Entscheidungsgrundlagen). The report
  // arrives right after the browser's own layout; a font swap re-wraps the lines and reports again.
  const ro =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          for (const e of entries) {
            const l = byLine.get(e.target);
            if (!l) continue;
            const box = e.borderBoxSize?.[0];
            l.W = box ? box.inlineSize : (e.target as HTMLElement).offsetWidth;
          }
          // style is clean right after layout: the font size (a `clamp(…vw)` statement follows the viewport) is free here
          readFont();
          measured = true;
          if (state === "running") apply(lastT);
        })
      : null;
  for (const l of lines) ro?.observe(l.line);
  return {
    play(delay, speed, onDone) {
      timeline.stop();
      schedule = scheduleFor(lines.length, speed);
      total = totalDuration(schedule);
      doneCb = onDone;
      if (!ro) measureNow();
      waited = 0;
      setMode("running");
      if (measured) apply(-1e6);
      timeline.start(delay);
    },
    setFilled() {
      timeline.stop();
      setMode("filled");
      const cb = doneCb;
      doneCb = undefined;
      cb?.();
    },
    destroy() {
      timeline.stop();
      doneCb = undefined;
      ro?.disconnect();
    },
  };
}

/**
 * Line-by-line ember fill (pack `pixel-text-fill`, measured chain). Three stacked copies per line in one box – base
 * (real text, rest grey), dithered ember window and white window, both aria-hidden – so nothing shifts layout; per
 * frame only two translate3d writes per line, and only when the quarter-pixel edge changes. Lines may wrap (narrow
 * screens): the copies wrap identically and the window sweeps the whole line block. Reduced motion: filled at once.
 */
export function PixelTextFill({ lines, play, playOnMount = true, speed = 1, delay = 0, onDone, className, align = "left", as = "p" }: PixelTextFillProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLParagraphElement | null>(null);
  const engine = useRef<Engine | null>(null);
  const linesKey = lines.join("\n");
  /** Read once: a mount play keeps the rest state; any later text change shows filled until the next play. */
  const mountPending = useRef(playOnMount || play === true);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const e = createEngine(root);
    engine.current = e;
    // before first paint: filled unless a mount play is about to run (no grey flash for already-seen subtitles)
    if (!mountPending.current) e.setFilled();
    mountPending.current = false;
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, [linesKey]);

  useLayoutEffect(() => {
    if (reduced) engine.current?.setFilled();
  }, [reduced]);

  usePlayTrigger(play, playOnMount, () => {
    if (reduced) {
      engine.current?.setFilled();
      onDone?.();
      return;
    }
    engine.current?.play(delay, speed, onDone);
  });

  const Root = as as "p";
  return (
    <Root ref={rootRef} className={cn("m-0", align === "center" ? "text-center" : "text-left", className)} data-pulse="pixel-text-fill" data-state="rest">
      {lines.map((txt, i) => (
        <span key={`${i}:${txt}`} data-ptf-line="" className={cn("relative block w-fit max-w-full", align === "center" && "mx-auto")} style={{ contain: "layout paint" }}>
          <span data-ptf-base="" className="block" style={{ color: CONFIG.restColor }}>
            {txt}
          </span>
          <span data-ptf-rev="" aria-hidden="true" style={revStyle(CONFIG.featherOEm)}>
            <span className="block" style={innerStyle(CONFIG.featherOEm, CONFIG.emberColor, true)}>
              {txt}
            </span>
          </span>
          <span data-ptf-rev="" aria-hidden="true" style={revStyle(CONFIG.featherWEm)}>
            <span className="block" style={innerStyle(CONFIG.featherWEm, CONFIG.fillColor, false)}>
              {txt}
            </span>
          </span>
        </span>
      ))}
    </Root>
  );
}
