import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { prefersReducedMotion } from "@/motion/pulse/engine";
import { createTimeline, watchActivity } from "@/motion/pulse/textKit";
import { useReducedFx } from "@/motion/useReducedFx";

/** pulse-motion `text-morphing` (measured): blur crossfade through an alpha threshold → gooey blobs. */
export const CONFIG = {
  morphMs: 1000, // progress f 0..1 (visibly "blobby" for ~400 ms)
  holdMs: 1000, // cycle: hold + morph = 2000 ms
  blurMax: 8, // blur(px) = blurMax / f - blurMax, capped at 100 – measured at 90 px type
  blurCap: 100,
  refFontPx: 90, // blur scales with the font size (8 px of blur would erase an 11 px label)
  opacityPow: 0.4, // opacity = f^0.4
  thresholdK: 255, // alpha · k + b
  thresholdB: -140, // ≥ 48 px type (measured at 90 px)
  /** NEW: small labels have sub-pixel strokes that a 0.55 alpha cut erases – lower the cut towards 0.2 at 11 px. */
  smallCutAt: { px: 11, alpha: 0.2 },
  largeCutFromPx: 48,
} as const;

/** Alpha threshold offset `b` of the gooey matrix for a font size (measured -140 from 48 px up). */
export function thresholdOffset(fontPx: number): number {
  const { px, alpha } = CONFIG.smallCutAt;
  const big = -CONFIG.thresholdB / CONFIG.thresholdK;
  const t = Math.max(0, Math.min(1, (fontPx - px) / (CONFIG.largeCutFromPx - px)));
  return -Math.round((alpha + (big - alpha) * t) * CONFIG.thresholdK);
}

/**
 * Blur (px) and opacity of the incoming word at progress f; the outgoing word uses 1 - f. `fontPx` scales the blur
 * from the measured 90 px reference (default: unscaled).
 */
export function morphLayer(f: number, fontPx: number = CONFIG.refFontPx): { blur: number; opacity: number } {
  const k = fontPx / CONFIG.refFontPx;
  if (f <= 0) return { blur: CONFIG.blurCap * k, opacity: 0 };
  if (f >= 1) return { blur: 0, opacity: 1 };
  return { blur: Math.min(CONFIG.blurMax / f - CONFIG.blurMax, CONFIG.blurCap) * k, opacity: Math.pow(f, CONFIG.opacityPow) };
}

export interface TextMorphProps {
  /** Controlled text; every change morphs from the previous one. Ignored while `cycle` is set. */
  text?: string;
  /** Words to cycle through (hold 1000 ms + morph 1000 ms each), time-based, pauses offscreen. */
  cycle?: string[];
  /** Morph duration (default 1000 ms, measured). */
  morphMs?: number;
  /** Cycle hold (default 1000 ms, measured). */
  holdMs?: number;
  onMorphEnd?: (text: string) => void;
  className?: string;
  align?: "start" | "center" | "end";
}

const matrixValues = (fontPx: number) => `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${CONFIG.thresholdK} ${thresholdOffset(fontPx)}`;

interface Engine {
  set(text: string): void;
  morphTo(text: string, ms: number, onEnd?: (t: string) => void): void;
  current(): string;
  destroy(): void;
}

function createEngine(root: HTMLElement, a: HTMLElement, b: HTMLElement, filterUrl: string): Engine {
  const els = [a, b] as const;
  let cur: 0 | 1 = 0;
  let target = "";
  let ms: number = CONFIG.morphMs;
  let endCb: ((t: string) => void) | undefined;
  let lastKey = "";
  let fontPx: number = CONFIG.refFontPx;
  const rest = () => {
    const shown = els[cur];
    const idle = els[cur === 0 ? 1 : 0];
    shown.style.filter = "";
    shown.style.opacity = "";
    shown.style.willChange = "";
    idle.style.filter = "";
    idle.style.opacity = "0";
    idle.style.willChange = "";
    idle.textContent = "";
    root.style.filter = "";
    root.removeAttribute("data-morphing");
    lastKey = "";
  };
  const paint = (f: number) => {
    const key = f.toFixed(4);
    if (key === lastKey) return;
    lastKey = key;
    const incoming = els[cur];
    const outgoing = els[cur === 0 ? 1 : 0];
    const i = morphLayer(f, fontPx);
    const o = morphLayer(1 - f, fontPx);
    incoming.style.filter = `blur(${i.blur.toFixed(2)}px)`;
    incoming.style.opacity = i.opacity.toFixed(4);
    outgoing.style.filter = `blur(${o.blur.toFixed(2)}px)`;
    outgoing.style.opacity = o.opacity.toFixed(4);
  };
  const end = () => {
    rest();
    const cb = endCb;
    endCb = undefined;
    cb?.(target);
  };
  const timeline = createTimeline(root, (e) => {
    const f = Math.min(1, e / ms);
    paint(f);
    if (f >= 1) {
      end();
      return false;
    }
    return true;
  });
  return {
    set(text) {
      timeline.stop();
      target = text;
      els[cur].textContent = text;
      rest();
    },
    morphTo(text, duration, onEnd) {
      if (timeline.running()) {
        timeline.stop();
        rest();
      }
      if (text === target) return;
      ms = duration > 0 ? duration : CONFIG.morphMs;
      fontPx = parseFloat(getComputedStyle(root).fontSize) || CONFIG.refFontPx;
      root.querySelector("feColorMatrix")?.setAttribute("values", matrixValues(fontPx));
      target = text;
      endCb = onEnd;
      // the old word becomes the outgoing layer, the new one goes into the idle layer
      cur = cur === 0 ? 1 : 0;
      els[cur].textContent = text;
      root.style.filter = filterUrl;
      root.setAttribute("data-morphing", "");
      for (const el of els) el.style.willChange = "filter, opacity";
      paint(0);
      timeline.start(0);
    },
    current: () => target,
    destroy() {
      timeline.stop();
      endCb = undefined;
    },
  };
}

/**
 * Gooey text morph (pack `text-morphing`): both words share one grid cell, so the box is max(old, new) during the
 * morph and the current word at rest – nothing overlaps or spills. The threshold filter (`feColorMatrix`, unique id)
 * is only applied while morphing, so resting text keeps normal anti-aliasing. Per frame: filter + opacity on two
 * spans. The current text is exposed once via an sr-only span (no aria-live: the toast island stays the only live
 * region). Reduced motion: hard swap. Meant for small labels (the blur area stays tiny).
 */
export function TextMorph({ text = "", cycle, morphMs = CONFIG.morphMs, holdMs = CONFIG.holdMs, onMorphEnd, className, align = "start" }: TextMorphProps) {
  const reduced = useReducedFx();
  const filterId = `pulse-tm-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const aRef = useRef<HTMLSpanElement | null>(null);
  const bRef = useRef<HTMLSpanElement | null>(null);
  const srRef = useRef<HTMLSpanElement | null>(null);
  const engine = useRef<Engine | null>(null);
  const cycleKey = cycle && cycle.length > 0 ? cycle.join("\u0000") : null;
  const first = cycleKey ? (cycle![0] ?? "") : text;
  const firstRef = useRef(first);
  const fireEnd = useEffectEvent((t: string) => onMorphEnd?.(t));

  useLayoutEffect(() => {
    const root = rootRef.current;
    const a = aRef.current;
    const b = bRef.current;
    if (!root || !a || !b) return;
    const e = createEngine(root, a, b, `url(#${filterId})`);
    e.set(firstRef.current);
    engine.current = e;
    return () => {
      firstRef.current = e.current();
      e.destroy();
      engine.current = null;
    };
  }, [filterId]);

  // controlled mode
  useLayoutEffect(() => {
    if (cycleKey) return;
    const e = engine.current;
    if (!e || e.current() === text) return;
    if (reduced || prefersReducedMotion()) {
      e.set(text);
      fireEnd(text);
      return;
    }
    e.morphTo(text, morphMs, (t) => fireEnd(t));
  }, [text, cycleKey, reduced, morphMs]);

  // cycle mode: hold → morph → hold …, only while on screen and the tab is visible
  useEffect(() => {
    const root = rootRef.current;
    const e = engine.current;
    if (!cycleKey || !root || !e) return;
    const words = cycleKey.split("\u0000");
    let idx = Math.max(0, words.indexOf(e.current()));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = true;
    let waiting = false;
    const next = () => {
      timer = undefined;
      if (!active) {
        waiting = true;
        return;
      }
      idx = (idx + 1) % words.length;
      const w = words[idx]!;
      if (srRef.current) srRef.current.textContent = w;
      if (reduced) {
        e.set(w);
        fireEnd(w);
        timer = setTimeout(next, holdMs + morphMs);
        return;
      }
      e.morphTo(w, morphMs, (t) => {
        fireEnd(t);
        timer = setTimeout(next, holdMs);
      });
    };
    const unwatch = watchActivity(root, (a) => {
      active = a;
      if (a && waiting) {
        waiting = false;
        timer = setTimeout(next, holdMs);
      }
    });
    timer = setTimeout(next, holdMs);
    return () => {
      unwatch();
      if (timer) clearTimeout(timer);
    };
  }, [cycleKey, reduced, morphMs, holdMs]);

  const justify = align === "center" ? "center" : align === "end" ? "end" : "start";
  const cell = { gridArea: "1 / 1", justifySelf: justify, whiteSpace: "nowrap" } as const;
  return (
    <span ref={rootRef} className={cn("relative inline-grid", className)} data-pulse="text-morph">
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix in="SourceGraphic" type="matrix" values={matrixValues(CONFIG.refFontPx)} />
        </filter>
      </svg>
      <span ref={srRef} className="sr-only">
        {cycleKey ? null : text}
      </span>
      <span ref={aRef} aria-hidden="true" style={cell} />
      <span ref={bRef} aria-hidden="true" style={{ ...cell, opacity: 0 }} />
    </span>
  );
}
