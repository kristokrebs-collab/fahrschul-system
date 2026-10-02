import { useEffect, useEffectEvent, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { observeInView, canObserveInView } from "@/motion/inView";
import { createTimeline } from "@/motion/pulse/textKit";
import { useIntroLanded } from "@/intro/introStore";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `tactile-highlight` (measured): a short "tab" pops left of the marker and retracts, then the marker bar
 * wipes in from the left on an exponential (p = 1 - e^(-t/150 ms)); text over the bar switches colour as it passes.
 */
export const CONFIG = {
  tabPop: 15, // ms, scaleX .72 → 1
  tabPopFrom: 0.72,
  tabHold: 30, // ms
  tabRetract: 42, // ms, ease-in (1 - k²) towards the marker
  wipeDelay: 90, // ms after start
  wipeTau: 150, // ms time constant
  doneAt: 0.9995, // p considered final
  tabWidthEm: 1.38, // 88 px at 64 px
  padXEm: 0.16,
  radius: "5px",
  tones: {
    invert: { bar: "var(--color-fg, #f2f2f2)", text: "var(--color-ink-950, #040404)", glow: "0 8px 20px rgba(255,255,255,.07)" },
    signal: { bar: "var(--color-signal, #e5202e)", text: "#ffffff", glow: "0 8px 20px rgba(229,32,46,.16)" },
  },
} as const;

export type HighlightTone = keyof typeof CONFIG.tones;

export interface HighlightFrame {
  /** Tab scaleX (0 = hidden). */
  tab: number;
  /** Marker progress 0..1. */
  p: number;
  done: boolean;
}

/** Pure wipe-in timeline at `e` ms after the start. */
export function highlightAt(e: number): HighlightFrame {
  const { tabPop, tabHold, tabRetract, tabPopFrom, wipeDelay, wipeTau, doneAt } = CONFIG;
  let tab = 0;
  if (e >= 0 && e < tabPop) tab = tabPopFrom + (1 - tabPopFrom) * (e / tabPop);
  else if (e >= tabPop && e < tabPop + tabHold) tab = 1;
  else if (e >= tabPop + tabHold && e < tabPop + tabHold + tabRetract) {
    const k = (e - tabPop - tabHold) / tabRetract;
    tab = 1 - k * k;
  }
  const we = e - wipeDelay;
  let p = we > 0 ? 1 - Math.exp(-we / wipeTau) : 0;
  const done = p > doneAt;
  if (done) p = 1;
  return { tab, p, done };
}

/** Wipe-out (deactivation): exponential decay from `from` with the same time constant, no tab. */
export function highlightOutAt(e: number, from: number): { p: number; done: boolean } {
  const p = from * Math.exp(-Math.max(0, e) / CONFIG.wipeTau);
  return p < 1 - CONFIG.doneAt ? { p: 0, done: true } : { p, done: false };
}

export interface TactileHighlightProps {
  children: ReactNode;
  tone?: HighlightTone;
  /** Wipe in once when ~10 % in view (and the surrounding intro cell has landed). */
  playOnView?: boolean;
  /** Controlled: true wipes in, false wipes out. Takes precedence over `playOnView`. */
  active?: boolean;
  onDone?: () => void;
  className?: string;
}

interface Engine {
  wipeIn(onDone?: () => void): void;
  wipeOut(): void;
  set(p: number): void;
  destroy(): void;
}

function createEngine(root: HTMLElement, bar: HTMLElement, tab: HTMLElement, lit: HTMLElement): Engine {
  let p = 0;
  let mode: "in" | "out" = "in";
  let from = 0;
  let doneCb: (() => void) | undefined;
  let last = { p: -1, tab: -1 };
  const paint = (np: number, ntab: number) => {
    p = np;
    if (np !== last.p) {
      bar.style.transform = `scale3d(${np.toFixed(4)},1,1)`;
      lit.style.clipPath = `inset(0 ${((1 - np) * 100).toFixed(3)}% 0 0)`;
    }
    if (ntab !== last.tab) {
      tab.style.opacity = ntab > 0 ? "1" : "0";
      if (ntab > 0) tab.style.transform = `scale3d(${ntab.toFixed(4)},1,1)`;
    }
    last = { p: np, tab: ntab };
  };
  const live = (on: boolean) => {
    const wc = on ? "transform" : "";
    bar.style.willChange = wc;
    tab.style.willChange = wc;
    lit.style.willChange = on ? "clip-path" : "";
    if (on) root.setAttribute("data-playing", "");
    else root.removeAttribute("data-playing");
  };
  const timeline = createTimeline(root, (e) => {
    if (mode === "in") {
      const f = highlightAt(e);
      paint(f.p, f.tab);
      if (f.done) {
        live(false);
        const cb = doneCb;
        doneCb = undefined;
        cb?.();
        return false;
      }
      return true;
    }
    const f = highlightOutAt(e, from);
    paint(f.p, 0);
    if (f.done) live(false);
    return !f.done;
  });
  return {
    wipeIn(onDone) {
      timeline.stop();
      mode = "in";
      doneCb = onDone;
      live(true);
      paint(0, 0);
      timeline.start(0);
    },
    wipeOut() {
      timeline.stop();
      doneCb = undefined;
      if (p <= 0) return;
      mode = "out";
      from = p;
      live(true);
      timeline.start(0);
    },
    set(np) {
      timeline.stop();
      live(false);
      paint(np, 0);
    },
    destroy() {
      timeline.stop();
      doneCb = undefined;
      live(false);
    },
  };
}

/**
 * Marker wipe behind a key word (pack `tactile-highlight`, exact timing). The word is real inline text (accessible
 * once); a clipped, aria-hidden duplicate in the "on bar" colour reveals exactly where the bar has passed, so the
 * text is readable in every frame. Per frame: two scale3d transforms + one clip-path. The tab pops outside the
 * word to the left only for ~90 ms (aria-hidden, no layout). Without `playOnView`/`active` the marker is static.
 * Reduced motion: final state at once.
 */
export function TactileHighlight({ children, tone = "invert", playOnView = false, active, onDone, className }: TactileHighlightProps) {
  const reduced = useReducedFx();
  const landed = useIntroLanded();
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const barRef = useRef<HTMLElement | null>(null);
  const tabRef = useRef<HTMLElement | null>(null);
  const litRef = useRef<HTMLSpanElement | null>(null);
  const engine = useRef<Engine | null>(null);
  const played = useRef(false);
  const controlled = active !== undefined;
  const fireDone = useEffectEvent(() => onDone?.());
  /** First paint: a static marker is on; controlled / on-view markers start empty (their effects take over). */
  const initialRef = useRef(!controlled && !playOnView ? 1 : 0);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    const tab = tabRef.current;
    const lit = litRef.current;
    if (!root || !bar || !tab || !lit) return;
    const e = createEngine(root, bar, tab, lit);
    engine.current = e;
    e.set(initialRef.current);
    return () => {
      e.destroy();
      engine.current = null;
    };
  }, []);

  // the engine is rebuilt after a (StrictMode / keep-alive) remount, so an on-view wipe may run again
  useEffect(
    () => () => {
      played.current = false;
    },
    [],
  );

  // controlled
  useEffect(() => {
    if (!controlled) return;
    const e = engine.current;
    if (!e) return;
    if (reduced) {
      e.set(active ? 1 : 0);
      if (active) fireDone();
      return;
    }
    if (active) e.wipeIn(() => fireDone());
    else e.wipeOut();
  }, [controlled, active, reduced]);

  // once in view
  useEffect(() => {
    if (controlled || !playOnView || played.current) return;
    const root = rootRef.current;
    const e = engine.current;
    if (!root || !e) return;
    if (reduced) {
      played.current = true;
      e.set(1);
      fireDone();
      return;
    }
    if (!landed) return;
    const go = () => {
      if (played.current) return;
      played.current = true;
      e.wipeIn(() => fireDone());
    };
    if (!canObserveInView()) {
      go();
      return;
    }
    let stop: (() => void) | null = observeInView(root, (inView) => {
      if (!inView) return;
      go();
      stop?.();
      stop = null;
    });
    return () => {
      stop?.();
    };
  }, [controlled, playOnView, reduced, landed]);

  const t = CONFIG.tones[tone];
  const box: CSSProperties = { borderRadius: CONFIG.radius };
  return (
    <span ref={rootRef} className={cn("relative inline-block whitespace-nowrap", className)} style={{ padding: `0 ${CONFIG.padXEm}em`, ...box }} data-pulse="tactile-highlight" data-tone={tone}>
      <i
        ref={tabRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-0 bottom-0"
        style={{ ...box, right: "100%", width: `${CONFIG.tabWidthEm}em`, background: t.bar, transformOrigin: "100% 50%", opacity: 0 }}
      />
      <i
        ref={barRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ ...box, background: t.bar, boxShadow: t.glow, transformOrigin: "0 50%", transform: "scale3d(0,1,1)" }}
      />
      <span className="relative">{children}</span>
      <span
        ref={litRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 select-none"
        style={{ padding: `0 ${CONFIG.padXEm}em`, color: t.text, clipPath: "inset(0 100% 0 0)" }}
      >
        {children}
      </span>
    </span>
  );
}
