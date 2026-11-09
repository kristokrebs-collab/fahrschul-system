import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { cn } from "@/lib/cn";
import { createFrameLoop, latestPointer, seeded } from "@/motion/pulse/engine";
import { canHoverNow, hashString, springStep, splitChars, watchActivity } from "@/motion/pulse/textKit";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `dancing-letters` (fitted): letters near the pointer jump away on per-letter springs (smaller, up or
 * down, sometimes tilted), stay displaced ~1.4 s after the last contact, then glide back on a soft spring.
 */
export const CONFIG = {
  kick: { stiffness: 520, damping: 20, mass: 1 }, // jump away: fast, ~1 slight overshoot
  back: { stiffness: 26, damping: 8, mass: 1 }, // glide back: ζ≈0.8, ~1 s
  radiusEm: 95 / 96, // 95 px at 96 px type (scales with the letters' font size)
  holdMs: 1400, // stays displaced after the last contact
  cooldownMs: 420, // min gap between two new throws of the same letter
  scaleMin: 0.5,
  scaleMax: 1.12,
  yMaxEm: 0.34, // ± vertical offset (up to 0.7·yMax upwards, yMax downwards)
  rotMax: 34, // deg
  bigTiltChance: 0.2, // 80 % of throws use only 10 % of rotMax
} as const;

export interface DanceTarget {
  y: number;
  rot: number;
  scale: number;
}

/** Random throw for one letter (seeded PRNG): y in px for `fontPx`, rotation in deg, scale. */
export function throwTarget(rnd: () => number, fontPx: number): DanceTarget {
  const r = (a: number, b: number) => a + rnd() * (b - a);
  const y = r(-CONFIG.yMaxEm * 0.7, CONFIG.yMaxEm) * fontPx;
  const rot = r(-CONFIG.rotMax, CONFIG.rotMax) * (rnd() < CONFIG.bigTiltChance ? 1 : 0.1);
  const scale = r(CONFIG.scaleMin, CONFIG.scaleMax);
  return { y, rot, scale };
}

interface Letter {
  els: Set<Element>;
  space: boolean;
  p: [number, number, number];
  v: [number, number, number];
  tg: [number, number, number];
  cx: number;
  cy: number;
  hit: number;
  contact: number;
  away: boolean;
  key: string;
}

export interface Dancer {
  attach(root: Element | null): void;
  register(i: number, el: Element | null, prev?: Element | null): void;
  setText(text: string, seed?: number): void;
  setEnabled(on: boolean): void;
  setRadius(px: number | undefined): void;
  /** false keeps every letter at scale 1 (SVG text re-lays out on every pointer move while scaled). */
  setScale(on: boolean): void;
  poke(i: number): void;
  destroy(): void;
}

/** Framework-free engine behind `useDancingLetters`; works for HTML spans and SVG `<text>` elements alike. */
export function createDancer(): Dancer {
  let letters: Letter[] = [];
  /** Elements per letter index, independent of the text so refs attached before `setText` keep their slot. */
  const slots: Set<Element>[] = [];
  let rnd = seeded(1);
  let root: Element | null = null;
  let enabled = false;
  let radiusPx: number | undefined;
  let scaleOn = true;
  let fontPx = 16;
  let ptr: { x: number; y: number } | null = null;
  let ptrNew = false;
  let now = 0;
  let active = true;
  let detach: (() => void) | null = null;

  const paint = (l: Letter, force = false) => {
    const key = `${l.p[0].toFixed(2)}|${l.p[1].toFixed(2)}|${l.p[2].toFixed(3)}`;
    if (!force && key === l.key) return;
    l.key = key;
    const rest = l.p[0] === 0 && l.p[1] === 0 && l.p[2] === 1;
    // never back to "none": a none ↔ transform switch restyles the subtree (SVG text re-lays out every time)
    const t = rest ? "translate(0px,0px)" : `translate3d(0,${l.p[0].toFixed(2)}px,0) rotate(${l.p[1].toFixed(2)}deg) scale(${l.p[2].toFixed(3)})`;
    for (const el of l.els) (el as HTMLElement).style.transform = t;
  };
  const measure = () => {
    for (const l of letters) {
      const el = l.els.values().next().value as Element | undefined;
      if (!el) continue;
      const b = el.getBoundingClientRect();
      l.cx = b.left + b.width / 2;
      l.cy = b.top + b.height / 2;
    }
    const first = letters.find((l) => l.els.size > 0)?.els.values().next().value as Element | undefined;
    if (first) fontPx = parseFloat(getComputedStyle(first).fontSize) || fontPx;
  };
  const newTarget = (l: Letter) => {
    const t = throwTarget(rnd, fontPx);
    l.tg = [t.y, t.rot, scaleOn ? t.scale : 1];
    l.away = true;
  };
  const setWillChange = (on: boolean) => {
    for (const l of letters) for (const el of l.els) (el as HTMLElement).style.willChange = on ? "transform" : "";
  };
  const loop = createFrameLoop((dt, t) => {
    now = t;
    if (ptr && ptrNew) {
      ptrNew = false;
      const r = radiusPx ?? CONFIG.radiusEm * fontPx;
      const r2 = r * r;
      for (const l of letters) {
        if (l.space) continue;
        const dx = ptr.x - l.cx;
        const dy = ptr.y - l.cy;
        if (dx * dx + dy * dy < r2) {
          l.contact = now;
          if (now - l.hit > CONFIG.cooldownMs) {
            newTarget(l);
            l.hit = now;
          }
        }
      }
    }
    let busy = false;
    for (const l of letters) {
      if (l.away && now - l.contact > CONFIG.holdMs) l.away = false;
      const cfg = l.away ? CONFIG.kick : CONFIG.back;
      for (let j = 0; j < 3; j++) {
        const target = l.away ? l.tg[j]! : j === 2 ? 1 : 0;
        const s = springStep(l.p[j]!, l.v[j]!, target, dt, cfg);
        l.p[j] = s.x;
        l.v[j] = s.v;
      }
      const moving = l.away || Math.abs(l.p[0]) > 0.02 || Math.abs(l.p[1]) > 0.02 || Math.abs(l.p[2] - 1) > 0.0005 || Math.abs(l.v[0]) > 0.02 || Math.abs(l.v[1]) > 0.02 || Math.abs(l.v[2]) > 0.0005;
      if (moving) busy = true;
      else {
        l.p = [0, 0, 1];
        l.v = [0, 0, 0];
      }
      paint(l);
    }
    if (!busy) setWillChange(false);
    return busy;
  });
  const wake = () => {
    if (!enabled || !active) return;
    if (!loop.running()) setWillChange(true);
    loop.wake();
  };
  const isHoverPointer = (e: PointerEvent) => e.pointerType === "mouse" || e.pointerType === "pen";
  const onMove = (e: Event) => {
    const pe = e as PointerEvent;
    if (!enabled || !isHoverPointer(pe)) return;
    ptr = latestPointer(pe);
    ptrNew = true;
    wake();
  };
  const onEnter = (e: Event) => {
    if (!enabled || !isHoverPointer(e as PointerEvent)) return;
    measure();
    onMove(e);
  };
  const onLeave = () => {
    ptr = null;
    ptrNew = false;
  };
  const onScroll = () => {
    if (ptr) measure();
  };
  const listen = (el: Element) => {
    const opts = { passive: true } as const;
    el.addEventListener("pointerenter", onEnter, opts);
    el.addEventListener("pointermove", onMove, opts);
    el.addEventListener("pointerleave", onLeave, opts);
    el.addEventListener("pointercancel", onLeave, opts);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    const unwatch = watchActivity(el, (a) => {
      active = a;
      if (!a) loop.stop();
      else if (letters.some((l) => l.away || l.p[2] !== 1)) wake();
    });
    return () => {
      el.removeEventListener("pointerenter", onEnter);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("pointercancel", onLeave);
      window.removeEventListener("scroll", onScroll, { capture: true });
      unwatch();
    };
  };
  const reset = () => {
    loop.stop();
    for (const l of letters) {
      l.p = [0, 0, 1];
      l.v = [0, 0, 0];
      l.away = false;
      paint(l, true);
    }
    setWillChange(false);
  };
  return {
    attach(el) {
      if (el === root) return;
      detach?.();
      detach = null;
      root = el;
      if (el) detach = listen(el);
    },
    register(i, el, prev) {
      const set = (slots[i] ??= new Set());
      if (prev) set.delete(prev);
      if (!el) return;
      set.add(el);
      const s = (el as HTMLElement).style;
      if (el instanceof SVGElement) s.transformBox = "fill-box";
      s.transformOrigin = "50% 50%";
      const l = letters[i];
      if (l) paint(l, true);
    },
    setText(text, seed) {
      reset();
      const chars = splitChars(text);
      rnd = seeded(seed ?? hashString(text));
      letters = chars.map((ch, i) => ({
        els: (slots[i] ??= new Set<Element>()),
        space: /\s/.test(ch),
        p: [0, 0, 1],
        v: [0, 0, 0],
        tg: [0, 0, 1],
        cx: 0,
        cy: 0,
        hit: -1e9,
        contact: -1e9,
        away: false,
        key: "",
      }));
    },
    setEnabled(on) {
      enabled = on;
      if (!on) reset();
    },
    setRadius(px) {
      radiusPx = px;
    },
    setScale(on) {
      scaleOn = on;
    },
    poke(i) {
      const l = letters[i];
      if (!l || l.space || !enabled) return;
      if (l.els.size && !l.cx) measure();
      now = performance.now();
      newTarget(l);
      l.hit = l.contact = now;
      wake();
    },
    destroy() {
      detach?.();
      detach = null;
      reset();
    },
  };
}

export interface DancingLettersOptions {
  /** Proximity radius in px (default 95/96 em of the letters' font size = 95 px at 96 px). */
  radius?: number;
  seed?: number;
  /** Turn the effect off (e.g. during an intro). */
  disabled?: boolean;
  /** Random scale per throw (default true; `DancingSvgWord` defaults to false, see there). */
  scale?: boolean;
}

export interface DancingLettersHandle {
  /** Attach to the element that should receive pointer events (an HTML wrapper or the `<svg>`). */
  bindRoot: (el: Element | null) => void;
  /** Stable callback ref per letter index; several elements may share an index (SVG outline + fill layers). */
  bindLetter: (i: number) => (el: Element | null) => (() => void) | undefined;
  /** Throw letter `i` programmatically. */
  poke: (i: number) => void;
  letters: string[];
}

/**
 * Engine hook for dancing letters on any markup. Letters are registered via `bindLetter(i)`; the engine writes
 * `transform` (translate3d · rotate · scale, SVG: `transform-box: fill-box`) directly – zero React renders after mount.
 * Hover devices only (mouse/pen, `(hover: hover)`), off under reduced motion; the loop sleeps when everything rests
 * and pauses offscreen / in a hidden tab. Rects are measured once per pointer enter (and on scroll while hovering).
 */
export function useDancingLetters(text: string, { radius, seed, disabled = false, scale = true }: DancingLettersOptions = {}): DancingLettersHandle {
  const reduced = useReducedFx();
  const [dancer] = useState(createDancer);
  const letters = useMemo(() => splitChars(text), [text]);

  // text first (layout effect), so letter refs registered in the same commit find their slots
  useLayoutEffect(() => {
    dancer.setText(text, seed);
  }, [dancer, text, seed]);
  useEffect(() => {
    dancer.setRadius(radius);
  }, [dancer, radius]);
  useEffect(() => {
    dancer.setScale(scale);
  }, [dancer, scale]);
  useEffect(() => {
    dancer.setEnabled(!disabled && !reduced && canHoverNow());
  }, [dancer, disabled, reduced]);
  useEffect(() => () => dancer.destroy(), [dancer]);

  const letterBinders = useMemo(
    () =>
      letters.map((_, i) => (el: Element | null) => {
        if (!el) return undefined;
        dancer.register(i, el);
        // React 19 ref cleanup: each element unregisters itself, so shared per-letter refs stay exact
        return () => dancer.register(i, null, el);
      }),
    [dancer, letters],
  );
  return useMemo(
    () => ({
      bindRoot: (el: Element | null) => dancer.attach(el),
      bindLetter: (i: number) => letterBinders[i] ?? (() => undefined),
      poke: (i: number) => dancer.poke(i),
      letters,
    }),
    [dancer, letterBinders, letters],
  );
}

type Tag = "span" | "div" | "h1" | "h2" | "p";

export interface DancingLettersProps extends DancingLettersOptions {
  text: string;
  className?: string;
  as?: Tag;
}

/**
 * HTML dancing letters (pack `dancing-letters`). Spans are created once per text; the real text is announced once
 * (sr-only), the glyph spans are aria-hidden. Letters only move within ±0.34 em of their slot.
 */
export function DancingLetters({ text, className, as = "span", ...opts }: DancingLettersProps) {
  const { bindRoot, bindLetter, letters } = useDancingLetters(text, opts);
  const Root = as as "span";
  return (
    <Root ref={bindRoot as Ref<HTMLSpanElement>} className={cn("relative inline-block whitespace-pre", className)} data-pulse="dancing-letters">
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {letters.map((ch, i) => (
          <span key={`${i}:${ch}`} ref={bindLetter(i)} className="inline-block">
            {ch}
          </span>
        ))}
      </span>
    </Root>
  );
}

export interface DancingSvgWordProps extends DancingLettersOptions {
  text: string;
  /** Box of the word (e.g. `h-full w-full`); the word is centred in it like `<text x="50%" y="50%" text-anchor="middle">`. */
  className?: string;
  /** Font classes of the word (size/weight/family) – used to lay out and to render every letter. */
  textClassName?: string;
  /** Shared `<defs>` (gradients/masks). Use `userSpaceOnUse` – letter coordinates equal the word box's px coordinates. */
  defs?: ReactNode;
  /** Accessible name; without it the word is decorative (`aria-hidden`), like the footer outline. */
  label?: string;
  /** Layers of one letter: return `<text>` elements without x/y – they are positioned on the measured glyph. */
  children: (char: string, index: number) => ReactNode;
}

const LETTER_PAD_EM = 0.4;

/**
 * Dancing letters for SVG artwork (the footer outline wordmark). A hidden full-word `<text>` lays the glyphs out
 * (kerning, centring); every letter is then its own small `<svg>` (inside an HTML box) whose viewBox maps the word's
 * coordinates, so gradients/masks in `defs` line up across letters. The dancer transforms the HTML boxes – compositor
 * only. Measured in Chromium: transforming SVG elements (or an `<svg>` itself) re-lays out the SVG text every frame;
 * with an HTML wrapper it only happens on pointer moves, and is ~6× cheaper without a scale component – so the SVG
 * word throws letters up/down and tilts them but keeps scale 1 unless `scale` is set.
 * Hover devices only; boxes are measured on mount, resize and font load, never per frame.
 */
export function DancingSvgWord({ text, className, textClassName, defs, label, children, scale = false, ...opts }: DancingSvgWordProps) {
  const { bindRoot, bindLetter, letters } = useDancingLetters(text, { ...opts, scale });
  const measureRef = useRef<SVGTextElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const setBox = useCallback(
    (el: HTMLDivElement | null) => {
      boxRef.current = el;
      bindRoot(el);
    },
    [bindRoot],
  );

  useLayoutEffect(() => {
    const m = measureRef.current;
    const box = boxRef.current;
    if (!m || !box) return;
    const place = () => {
      if (typeof m.getExtentOfChar !== "function" || typeof m.getStartPositionOfChar !== "function") return;
      const fs = parseFloat(getComputedStyle(m).fontSize) || 16;
      const pad = fs * LETTER_PAD_EM;
      const cells = box.querySelectorAll<HTMLElement>(":scope > [data-letter]");
      let u = 0;
      letters.forEach((ch, i) => {
        const at = u;
        u += ch.length;
        const cell = Array.from(cells).find((c) => c.dataset.letter === String(i));
        if (!cell) return;
        let ext: DOMRect;
        let start: DOMPoint;
        try {
          ext = m.getExtentOfChar(at);
          start = m.getStartPositionOfChar(at);
        } catch {
          return;
        }
        const x = ext.x - pad;
        const y = ext.y - pad;
        const w = ext.width + 2 * pad;
        const h = ext.height + 2 * pad;
        cell.style.left = `${x}px`;
        cell.style.top = `${y}px`;
        cell.style.width = `${w}px`;
        cell.style.height = `${h}px`;
        cell.firstElementChild?.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
        for (const t of cell.querySelectorAll("text")) {
          t.setAttribute("x", String(start.x));
          t.setAttribute("y", String(start.y));
        }
      });
    };
    place();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    ro?.observe(box);
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    let alive = true;
    void fonts?.ready.then(() => alive && place());
    return () => {
      alive = false;
      ro?.disconnect();
    };
  }, [letters]);

  return (
    <div
      ref={setBox}
      className={cn("relative select-none", className)}
      // like the original <svg>, a word wider than the box is clipped (never a horizontal page scroll)
      style={{ overflowX: "clip" }}
      data-pulse="dancing-svg-word"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <svg className="pointer-events-none absolute inset-0 h-full w-full" style={{ visibility: "hidden" }} aria-hidden="true">
        {defs}
        <text ref={measureRef} x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className={textClassName}>
          {letters.join("")}
        </text>
      </svg>
      {letters.map((ch, i) =>
        ch.trim() ? (
          <div key={`${i}:${ch}`} ref={bindLetter(i)} data-letter={i} className="pointer-events-none absolute" style={{ left: 0, top: 0, width: 0, height: 0 }}>
            <svg className="block h-full w-full overflow-visible" aria-hidden="true">
              <g className={textClassName}>{children(ch, i)}</g>
            </svg>
          </div>
        ) : null,
      )}
    </div>
  );
}
