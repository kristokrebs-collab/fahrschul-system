import { useLayoutEffect, useRef, type CSSProperties, type Ref } from "react";
import { cn } from "@/lib/cn";
import { clamp01, easeOutCubic, seeded } from "@/motion/pulse/engine";
import { createTimeline, hashString, splitChars, usePlayTrigger, type Timeline } from "@/motion/pulse/textKit";
import { useReducedFx } from "@/motion/useReducedFx";

/**
 * pulse-motion `text-ascii-cascade` (measured): scramble into ASCII/block glyphs, fall ~1 font size (cubic ease-out)
 * while dimming to grey, hold, rise back, glow, then every glyph resolves to the real text in the same frame.
 */
export const CONFIG = {
  fall: 550, // ms, 0 → drop, 1-(1-p)^3
  hold: 670, // ms at the bottom, glyphs keep changing
  rise: 600, // ms, drop → 0, 1-(1-p)^3
  resolveAt: 1870, // ms after start: all glyphs jump to the real text at once (no stagger)
  tick: 70, // ms scramble cadence
  changeProb: 0.7, // per glyph and tick
  onsetJitter: 60, // ms random per-letter onset
  dropEm: 47 / 46, // 47 px at 46 px type
  dimOpacity: 0.58, // whole row at the bottom
  whiteGain: 1.6, // white layer = max(0, 1 - gain · d)
  glowPeak: 0.85, // pre-rendered glow layer opacity at the resolve
  glowTail: 280, // ms the glow fades after the resolve (NEW: the pack's "leuchtet auf" as a layer fade)
  chars: ".:-=+*#%@&░▒▓█",
  /** Nothing palette: resolved = fg white, scramble tone = muted grey (pack: blue slate). */
  hiColor: "var(--color-fg, #f2f2f2)",
  loColor: "var(--color-mute, #9b9b9b)",
  glowShadow: "0 0 .35em rgba(255,255,255,.55), 0 0 .08em rgba(255,255,255,.7)",
} as const;

export interface CascadeFrame {
  /** Drop fraction 0..1 (× drop em). */
  d: number;
  opacity: number;
  white: number;
  glow: number;
  resolved: boolean;
  done: boolean;
}

/** Pure timeline: the visual state `e` ms after the scramble started. */
export function cascadeAt(e: number, cfg: Pick<typeof CONFIG, "fall" | "hold" | "rise" | "resolveAt" | "dimOpacity" | "whiteGain" | "glowPeak" | "glowTail"> = CONFIG): CascadeFrame {
  const riseStart = cfg.fall + cfg.hold;
  let d: number;
  if (e <= 0) d = 0;
  else if (e < cfg.fall) d = easeOutCubic(e / cfg.fall);
  else if (e < riseStart) d = 1;
  else d = 1 - easeOutCubic(clamp01((e - riseStart) / cfg.rise));
  const resolved = e >= cfg.resolveAt;
  if (resolved) d = 0;
  let glow = 0;
  if (e >= riseStart && !resolved) glow = cfg.glowPeak * easeOutCubic((e - riseStart) / (cfg.resolveAt - riseStart));
  else if (resolved) glow = cfg.glowPeak * (1 - clamp01((e - cfg.resolveAt) / cfg.glowTail));
  return {
    d,
    opacity: 1 - (1 - cfg.dimOpacity) * d,
    white: Math.max(0, 1 - cfg.whiteGain * d),
    glow,
    resolved,
    done: e >= cfg.resolveAt + cfg.glowTail,
  };
}

/**
 * Deterministic glyph scrambler (seeded PRNG, never Math.random): `step(e)` re-rolls on each new 70 ms tick and
 * returns true when any glyph changed. Whitespace stays whitespace so the word shape stays readable.
 */
export interface ScrambleConfig {
  tick: number;
  changeProb: number;
  onsetJitter: number;
  chars: string;
}

export function createScrambler(text: string, seed: number, cfg: ScrambleConfig = CONFIG) {
  const rnd = seeded(seed);
  const chars = splitChars(text);
  const pool = splitChars(cfg.chars);
  const onset = chars.map(() => rnd() * cfg.onsetJitter);
  const cur = chars.slice();
  let lastTick = -1;
  return {
    chars,
    cur,
    onset,
    step(e: number): boolean {
      const k = Math.floor(e / cfg.tick);
      if (k === lastTick) return false;
      lastTick = k;
      let changed = false;
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]!;
        if (e < onset[i]! || /\s/.test(ch)) continue;
        if (cur[i] === ch || rnd() < cfg.changeProb) {
          const next = pool[Math.floor(rnd() * pool.length)] ?? ch;
          if (next !== cur[i]) changed = true;
          cur[i] = next;
        }
      }
      return changed;
    },
    reset() {
      for (let i = 0; i < chars.length; i++) cur[i] = chars[i]!;
      lastTick = -1;
    },
  };
}

type Tag = "span" | "div" | "h1" | "h2" | "h3" | "p";

export interface AsciiCascadeProps {
  text: string;
  /** Replay trigger: a number replays on every change, `true` plays (again after a false). */
  play?: number | boolean;
  /** Play once on mount (default true). */
  playOnMount?: boolean;
  /** Fires at the resolve frame (also immediately under reduced motion when a play was requested). */
  onDone?: () => void;
  className?: string;
  as?: Tag;
  /** ms before the scramble starts (default 0). */
  delay?: number;
  /** Fall depth in em (default 47/46 ≈ 1.02 em, the measured value). Smaller for tight places. */
  drop?: number;
  /** Adds `drop` em of bottom padding so the fall stays inside the element's own box (no overlap below). */
  reserve?: boolean;
  /** PRNG seed (default: hash of the text + play count) – fixed seeds give identical scrambles. */
  seed?: number;
  /**
   * Start from the scramble instead of the readable text: the very first paint already shows the first glyph roll
   * (no per-letter onset), so a decode never flashes its answer first. Use only with a play pending (intro wordmark).
   */
  scrambled?: boolean;
  /** Resolved colour (default fg white). The glow layer follows it. */
  color?: string;
  /** Scramble colour while falling (default mute grey). */
  scrambleColor?: string;
}

interface Engine {
  play(delay: number, onDone?: () => void): void;
  finish(): void;
  destroy(): void;
}

const NO_ONSET: ScrambleConfig = { ...CONFIG, onsetJitter: 0 };

/** The glyphs of the first roll of a `scrambled` cascade (same PRNG sequence as the engine's first play). */
export function firstRoll(text: string, seed: number): string[] {
  const s = createScrambler(text, seed, NO_ONSET);
  s.step(0);
  return s.cur.slice();
}

function createEngine(root: HTMLElement, row: HTMLElement, layers: [HTMLElement, HTMLElement, HTMLElement], text: string, dropEm: number, seedBase: number | undefined, scrambled: boolean): Engine {
  const [lo, hi, glow] = layers;
  const glyphs = layers.map((layer) => Array.from(layer.querySelectorAll<HTMLElement>("[data-g]")));
  let count = 0;
  const cfgFor = (n: number): ScrambleConfig => (scrambled && n === 0 ? NO_ONSET : CONFIG);
  let scr = createScrambler(text, seedBase ?? hashString(text), cfgFor(0));
  /** Per-layer glyphs currently in the DOM; invisible layers are not written (synced when they become visible). */
  const shown = glyphs.map(() => (scrambled ? firstRoll(text, seedBase ?? hashString(text)) : scr.chars.slice()));
  let resolvedFired = false;
  let doneCb: (() => void) | undefined;
  let last = { y: -1, o: -1, w: -1, g: -1 };

  const sync = (layer: number, target: readonly string[]) => {
    const list = glyphs[layer]!;
    const cur = shown[layer]!;
    for (let i = 0; i < target.length; i++) {
      const ch = target[i]!;
      if (cur[i] === ch) continue;
      cur[i] = ch;
      const el = list[i];
      if (el) el.textContent = ch;
    }
  };
  const syncAll = (target: readonly string[]) => {
    for (let l = 0; l < glyphs.length; l++) sync(l, target);
  };
  const paint = (f: CascadeFrame) => {
    const y = Math.round(f.d * dropEm * 1000) / 1000;
    if (y !== last.y) row.style.transform = `translate3d(0,${y}em,0)`;
    const o = Math.round(f.opacity * 1000) / 1000;
    if (o !== last.o) row.style.opacity = String(o);
    const w = Math.round(f.white * 1000) / 1000;
    if (w !== last.w) hi.style.opacity = String(w);
    const g = Math.round(f.glow * 1000) / 1000;
    if (g !== last.g) glow.style.opacity = String(g);
    last = { y, o, w, g };
  };
  const settle = () => {
    syncAll(scr.chars);
    row.style.transform = "";
    row.style.opacity = "";
    row.style.willChange = "";
    hi.style.opacity = "";
    glow.style.opacity = "0";
    lo.style.opacity = "0";
    root.removeAttribute("data-playing");
    last = { y: -1, o: -1, w: -1, g: -1 };
  };
  const fireDone = () => {
    if (resolvedFired) return;
    resolvedFired = true;
    const cb = doneCb;
    doneCb = undefined;
    cb?.();
  };
  const timeline: Timeline = createTimeline(root, (e) => {
    const f = cascadeAt(e);
    if (!f.resolved) scr.step(e);
    const target = f.resolved ? scr.chars : scr.cur;
    sync(0, target);
    if (f.white > 0) sync(1, target);
    if (f.glow > 0) sync(2, target);
    if (f.resolved) fireDone();
    paint(f);
    if (f.done) {
      settle();
      return false;
    }
    return true;
  });
  return {
    play(delay, onDone) {
      timeline.stop();
      scr = createScrambler(text, (seedBase ?? hashString(text)) + count, cfgFor(count));
      count += 1;
      resolvedFired = false;
      doneCb = onDone;
      lo.style.opacity = "1";
      row.style.willChange = "transform, opacity";
      root.setAttribute("data-playing", "");
      timeline.start(delay);
    },
    finish() {
      timeline.stop();
      settle();
      fireDone();
    },
    destroy() {
      timeline.stop();
      doneCb = undefined;
      settle();
    },
  };
}

const GLYPH: CSSProperties = { position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)" };

function Layer({ chars, glyphs, style, refEl, className }: { chars: string[]; glyphs: string[]; style?: CSSProperties; refEl: (el: HTMLSpanElement | null) => void; className?: string }) {
  return (
    <span ref={refEl} className={className} style={style}>
      {chars.map((ch, i) => (
        // the invisible original reserves each cell's width; the glyph is centred over it, so wide blocks never shift layout
        <span key={i} className="relative inline-block">
          <span className="invisible">{ch}</span>
          <span data-g="" style={GLYPH}>
            {glyphs[i] ?? ch}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Decode with an ASCII cascade (pack `text-ascii-cascade`, exact phase timings). The real text is announced once via
 * an sr-only span; the three glyph layers (grey scramble, white, pre-rendered glow) are aria-hidden. Per frame only
 * the row's transform/opacity and two layer opacities change; glyph text nodes change only on 70 ms ticks.
 * Reduced motion: the plain text, no scramble. Note: the fall overflows `drop` em below the box unless `reserve`.
 */
export function AsciiCascade({ text, play, playOnMount = true, onDone, className, as = "span", delay = 0, drop = CONFIG.dropEm, reserve = false, seed, scrambled = false, color = CONFIG.hiColor, scrambleColor = CONFIG.loColor }: AsciiCascadeProps) {
  const reduced = useReducedFx();
  const rootRef = useRef<HTMLElement | null>(null);
  const rowRef = useRef<HTMLSpanElement | null>(null);
  const loRef = useRef<HTMLSpanElement | null>(null);
  const hiRef = useRef<HTMLSpanElement | null>(null);
  const glowRef = useRef<HTMLSpanElement | null>(null);
  const engine = useRef<Engine | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const row = rowRef.current;
    const lo = loRef.current;
    const hi = hiRef.current;
    const glow = glowRef.current;
    if (!root || !row || !lo || !hi || !glow) return;
    const e = createEngine(root, row, [lo, hi, glow], text, drop, seed, scrambled && !reduced);
    engine.current = e;
    return () => {
      e.destroy();
      engine.current = null;
    };
    // `reduced` is read once: a later change is handled by the finish() effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, drop, seed, scrambled]);

  useLayoutEffect(() => {
    if (reduced) engine.current?.finish();
  }, [reduced]);

  usePlayTrigger(play, playOnMount, () => {
    if (reduced) {
      onDone?.();
      return;
    }
    engine.current?.play(delay, onDone);
  });

  const chars = splitChars(text);
  const initial = scrambled && !reduced ? firstRoll(text, seed ?? hashString(text)) : chars;
  const Root = as as "span";
  return (
    <Root
      ref={rootRef as Ref<HTMLSpanElement>}
      className={cn("relative inline-block", className)}
      style={reserve ? { paddingBottom: `${drop}em` } : undefined}
      data-pulse="ascii-cascade"
    >
      <span className="sr-only">{text}</span>
      <span key={text} ref={rowRef} aria-hidden="true" className="relative block whitespace-pre">
        <Layer chars={chars} glyphs={initial} refEl={(el) => void (loRef.current = el)} className="block" style={{ color: scrambleColor, opacity: 0 }} />
        <Layer chars={chars} glyphs={initial} refEl={(el) => void (hiRef.current = el)} className="absolute inset-0" style={{ color }} />
        <Layer chars={chars} glyphs={initial} refEl={(el) => void (glowRef.current = el)} className="absolute inset-0" style={{ color, textShadow: CONFIG.glowShadow, opacity: 0 }} />
      </span>
    </Root>
  );
}
