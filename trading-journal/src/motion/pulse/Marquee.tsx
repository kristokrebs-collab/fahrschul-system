import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { createFrameLoop, prefersReducedMotion } from "@/motion/pulse/engine";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `motion-footer` ticker band (measured): an endless, seamless left drift at 52 px/s. Position is a
 * pure function of elapsed running time (x = t · speed mod loop width) – only transform is written; the loop
 * width is measured once (and on resize), the loop sleeps when paused, offscreen or in a hidden tab.
 */
export const CONFIG = {
  speed: 52, // px/s
  gap: 48, // px between the end of one copy and the start of the next
  fade: 48, // px static edge fade (mask)
} as const;

export interface MarqueeProps {
  children: ReactNode;
  /** px/s */
  speed?: number;
  /** px between copies */
  gap?: number;
  direction?: "left" | "right";
  pauseOnHover?: boolean;
  "aria-label"?: string;
  className?: string;
  /** Edge fade width in px (0 = none). */
  fade?: number;
  /**
   * Holds the drift where it is (the loop sleeps). For hosts the IntersectionObserver cannot judge, e.g. a sticky
   * footer that always intersects the viewport while covered by the page.
   */
  paused?: boolean;
}

/** Wrapped offset in [0, loop) for `elapsed` ms of running time at `speed` px/s. */
export function marqueeOffset(elapsedMs: number, speed: number, loop: number): number {
  if (loop <= 0) return 0;
  const x = ((elapsedMs * speed) / 1000) % loop;
  return x < 0 ? x + loop : x;
}

/** Copies needed so the track always covers the viewport while one loop width scrolls past. */
export function marqueeCopies(viewport: number, loop: number): number {
  if (loop <= 0) return 2;
  return Math.max(2, Math.ceil(viewport / loop) + 1);
}

/**
 * Infinite marquee: the children are rendered once for real and duplicated `aria-hidden` (inert) as often as the
 * measured width requires. Pauses on hover (real hover devices), focus-within, offscreen (IntersectionObserver)
 * and hidden tab; reduced motion shows the first copy static.
 */
export function Marquee({ children, speed = CONFIG.speed, gap = CONFIG.gap, direction = "left", pauseOnHover = true, "aria-label": ariaLabel, className, fade = CONFIG.fade, paused = false }: MarqueeProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLDivElement>(null);
  const [copies, setCopies] = useState(2);
  const st = useRef({ loop: 0, elapsed: 0, since: 0, running: false, hover: false, focus: false, visible: true, hidden: false, paused, speed, dir: direction, reduced });
  const loopRef = useRef<ReturnType<typeof createFrameLoop> | null>(null);

  const apply = (x: number) => {
    const t = trackRef.current;
    const s = st.current;
    if (!t) return;
    const v = s.dir === "left" ? -x : x - s.loop;
    t.style.transform = `translate3d(${v.toFixed(2)}px,0,0)`;
  };

  const sync = () => {
    const s = st.current;
    const should = !s.reduced && !prefersReducedMotion() && s.loop > 0 && !s.hover && !s.focus && s.visible && !s.hidden && !s.paused;
    if (should === s.running) return;
    const now = performance.now();
    if (should) {
      s.since = now;
      s.running = true;
      if (trackRef.current) trackRef.current.style.willChange = "transform";
      loopRef.current?.wake();
    } else {
      s.elapsed += now - s.since;
      s.running = false;
      loopRef.current?.stop();
      if (trackRef.current) trackRef.current.style.willChange = "";
      apply(marqueeOffset(s.elapsed, s.speed, s.loop));
    }
  };

  useEffect(() => {
    const s = st.current;
    const loop = createFrameLoop(() => {
      if (!s.running) return false;
      apply(marqueeOffset(s.elapsed + performance.now() - s.since, s.speed, s.loop));
      return true;
    });
    loopRef.current = loop;
    return () => loop.stop();
  }, []);

  useEffect(() => {
    const s = st.current;
    // keep the visual position when speed / direction / motion preference change
    if (s.running) {
      const now = performance.now();
      s.elapsed = ((s.elapsed + now - s.since) * s.speed) / Math.max(1e-6, speed);
      s.since = now;
    } else if (s.speed !== speed) s.elapsed = (s.elapsed * s.speed) / Math.max(1e-6, speed);
    s.speed = speed;
    s.dir = direction;
    s.reduced = reduced;
    if (reduced && trackRef.current) trackRef.current.style.transform = "";
    sync();
    if (!s.running && !reduced) apply(marqueeOffset(s.elapsed, s.speed, s.loop));
    // sync/apply only touch refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed, direction, reduced]);

  useEffect(() => {
    st.current.paused = paused;
    sync();
    // sync only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // measure one copy (+ gap) once and on resize; derive the copy count
  useLayoutEffect(() => {
    const root = rootRef.current;
    const first = firstRef.current;
    if (!root || !first) return;
    const measure = () => {
      const s = st.current;
      const loop = first.offsetWidth + gap;
      if (loop === s.loop && copies === marqueeCopies(root.clientWidth, loop)) return;
      s.loop = loop;
      setCopies(marqueeCopies(root.clientWidth, loop));
      sync();
      if (!s.running) apply(marqueeOffset(s.elapsed, s.speed, s.loop));
    };
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    ro.observe(first);
    return () => ro.disconnect();
    // sync/apply only touch refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gap, copies]);

  // offscreen + hidden tab
  useEffect(() => {
    const root = rootRef.current;
    const s = st.current;
    const onVis = () => {
      s.hidden = document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVis);
    let io: IntersectionObserver | null = null;
    if (root && typeof IntersectionObserver === "function") {
      io = new IntersectionObserver((entries) => {
        s.visible = entries[entries.length - 1]?.isIntersecting ?? true;
        sync();
      });
      io.observe(root);
    }
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      io?.disconnect();
      s.running = false;
    };
    // sync only touches refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mask = fade > 0 ? `linear-gradient(to right, transparent, #000 ${fade}px, #000 calc(100% - ${fade}px), transparent)` : undefined;
  const showCopies = reduced ? 1 : copies;

  return (
    <div
      ref={rootRef}
      role="marquee"
      aria-label={ariaLabel}
      className={cn("relative overflow-hidden", className)}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
      onPointerEnter={(e) => {
        if (!pauseOnHover || e.pointerType !== "mouse") return;
        st.current.hover = true;
        sync();
      }}
      onPointerLeave={() => {
        if (!st.current.hover) return;
        st.current.hover = false;
        sync();
      }}
      onFocus={() => {
        st.current.focus = true;
        sync();
      }}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        st.current.focus = false;
        sync();
      }}
    >
      <div ref={trackRef} className="flex w-max" style={{ gap }}>
        <div ref={firstRef} className="flex shrink-0 items-center">
          {children}
        </div>
        {Array.from({ length: showCopies - 1 }, (_, i) => (
          <div key={i} aria-hidden="true" inert className="flex shrink-0 items-center">
            {children}
          </div>
        ))}
      </div>
    </div>
  );
}
