import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { createFrameLoop, latestPointer } from "@/motion/pulse/engine";
import { canHoverNow, springStep, watchActivity } from "@/motion/pulse/textKit";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `text-prism-split` (fitted to the recording): a soft-edged black lens follows the pointer on a spring;
 * inside it the text is 6 % larger and 5 px higher, made of three screen-blended copies that slide apart with the
 * lens velocity and merge to white at rest. Nothing palette: copies signal red (leads) / white / ink grey (trails).
 */
export const CONFIG = {
  spring: { stiffness: 350, damping: 30, mass: 1 },
  splitGain: 0.02, // s: copy offset = gain · lens velocity (px per px/s)
  splitMaxAt48: 14, // px at 48 px type, scales with the font size
  magnify: 1.06,
  liftEm: -0.105, // ≈ -5 px at 48 px
  lensWidthEm: 2.5,
  featherEm: 0.25,
  maxDtMs: 50,
  lensBg: "var(--color-ink-950, #040404)", // pack #050505
  colors: ["var(--color-signal, #e5202e)", "#ffffff", "var(--color-faint, #5f5f5f)"] as const, // pack #ff8080 / #00ff00 / #ccccff
  fadeMs: 160, // NEW: lens fades in on enter / out after leave (pack: always visible at the centre)
} as const;

/** Copy offset (px) of the leading copy for a lens velocity (px/s) at a font size. */
export function splitOffset(v: number, fontPx: number): number {
  const max = (CONFIG.splitMaxAt48 * fontPx) / 48;
  return Math.max(-max, Math.min(max, CONFIG.splitGain * v));
}

export interface TextPrismProps {
  children?: ReactNode;
  /** Plain text alternative to `children`. */
  text?: string;
  className?: string;
  /** Lens width in em (default 2.5). */
  lensSize?: number;
  as?: "span" | "div" | "h1" | "h2" | "p";
}

const layerStyle = (color: string): CSSProperties => ({
  position: "absolute",
  left: 0,
  top: 0,
  display: "block",
  whiteSpace: "nowrap",
  transformOrigin: "0 0",
  mixBlendMode: "screen",
  color,
});

/**
 * Prism lens over a word or number (pack `text-prism-split`). Hover devices only (mouse/pen); touch and keyboard get
 * the plain text. Idle = no work: no listeners fire, the loop sleeps and the lens is hidden. Pointer moves are only
 * stored and applied once per frame; the box is measured once per hover. Per frame: 4 transforms. The base text is
 * the real (accessible, selectable) text; lens + copies are aria-hidden. The lens is clipped to the element's box.
 * Reduced motion: the lens jumps to the pointer without spring or split.
 */
export function TextPrism({ children, text, className, lensSize = CONFIG.lensWidthEm, as = "span" }: TextPrismProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const lensRef = useRef<HTMLSpanElement | null>(null);
  const content = children ?? text;

  useEffect(() => {
    const root = rootRef.current;
    const lens = lensRef.current;
    if (!root || !lens || !canHoverNow()) return;
    const layers = Array.from(lens.children) as HTMLElement[];
    let W = 0;
    let H = 0;
    let LW = 0;
    let fs = 16;
    let left = 0;
    let scaleX = 1;
    let x = 0;
    let v = 0;
    let target = 0;
    let pending: number | null = null;
    let hovering = false;
    let active = true;

    const measure = () => {
      const r = root.getBoundingClientRect();
      W = root.offsetWidth;
      H = root.offsetHeight;
      LW = lens.offsetWidth;
      fs = parseFloat(getComputedStyle(root).fontSize) || 16;
      left = r.left;
      scaleX = W > 0 && r.width > 0 ? W / r.width : 1;
    };
    const render = () => {
      const s = CONFIG.magnify;
      const q = reduced ? 0 : splitOffset(v, fs);
      lens.style.transform = `translate3d(${(x - LW / 2).toFixed(2)}px,0,0)`;
      const ty = (H / 2) * (1 - s) + CONFIG.liftEm * fs;
      for (let i = 0; i < layers.length; i++) {
        layers[i]!.style.transform = `translate3d(${(LW / 2 - s * x + (1 - i) * q).toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${s})`;
      }
    };
    const loop = createFrameLoop((dt) => {
      if (pending !== null) {
        target = Math.max(0, Math.min(W, (pending - left) * scaleX));
        pending = null;
      }
      if (reduced) {
        x = target;
        v = 0;
      } else {
        const s = springStep(x, v, target, Math.min(dt, CONFIG.maxDtMs / 1000));
        x = s.x;
        v = s.v;
      }
      const resting = Math.abs(target - x) < 0.03 && Math.abs(v) < 0.5;
      if (resting) {
        x = target;
        v = 0;
      }
      render();
      if (resting && pending === null) {
        setLive(false);
        if (!hovering) lens.style.opacity = "0";
        return false;
      }
      return true;
    });
    const setLive = (on: boolean) => {
      if (on) root.setAttribute("data-live", "");
      else root.removeAttribute("data-live");
      const wc = on ? "transform" : "";
      lens.style.willChange = wc;
      for (const l of layers) l.style.willChange = wc;
    };
    const wake = () => {
      if (!active) return;
      if (!loop.running()) setLive(true);
      loop.wake();
    };
    const isHoverPointer = (e: PointerEvent) => e.pointerType === "mouse" || e.pointerType === "pen";
    const onEnter = (e: PointerEvent) => {
      if (!isHoverPointer(e)) return;
      measure();
      hovering = true;
      const p = latestPointer(e);
      const start = Math.max(0, Math.min(W, (p.x - left) * scaleX));
      // the lens appears under the pointer, then springs with it
      x = start;
      v = 0;
      target = start;
      render();
      lens.style.opacity = "1";
      wake();
    };
    const onMove = (e: PointerEvent) => {
      if (!hovering || !isHoverPointer(e)) return;
      pending = latestPointer(e).x;
      wake();
    };
    const onLeave = () => {
      if (!hovering) return;
      hovering = false;
      pending = null;
      target = W / 2;
      lens.style.opacity = "0";
      wake();
    };
    const onScroll = () => {
      if (hovering) measure();
    };
    root.addEventListener("pointerenter", onEnter, { passive: true });
    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave, { passive: true });
    root.addEventListener("pointercancel", onLeave, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    const unwatch = watchActivity(root, (a) => {
      active = a;
      if (!a) loop.stop();
    });
    return () => {
      loop.stop();
      unwatch();
      root.removeEventListener("pointerenter", onEnter);
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("pointercancel", onLeave);
      window.removeEventListener("scroll", onScroll, { capture: true });
      setLive(false);
      lens.style.opacity = "0";
    };
  }, [reduced]);

  const feather = `${CONFIG.featherEm}em`;
  const mask = `linear-gradient(90deg, transparent 0, #000 ${feather}, #000 calc(100% - ${feather}), transparent 100%)`;
  const Root = as as "span";
  return (
    <Root ref={rootRef} className={cn("relative inline-block whitespace-nowrap", className)} style={{ overflow: "clip" }} data-pulse="text-prism">
      <span className="block">{content}</span>
      <span
        ref={lensRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 h-full select-none overflow-hidden"
        style={{
          width: `${lensSize}em`,
          background: CONFIG.lensBg,
          isolation: "isolate",
          contain: "layout paint style",
          WebkitMaskImage: mask,
          maskImage: mask,
          opacity: 0,
          transition: `opacity ${CONFIG.fadeMs}ms ease-out`,
        }}
      >
        {CONFIG.colors.map((c) => (
          <span key={c} style={layerStyle(c)}>
            {content}
          </span>
        ))}
      </span>
    </Root>
  );
}
