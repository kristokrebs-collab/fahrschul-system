/**
 * Shared helpers of the shell's richer motion (Runde 10, 12): the sidebar's spring curve, the first-load sequence of the sidebar (rows
 * wave in, glyphs draw one after the other – once per page load), and a quiet "now and then" timer for the glints (centre button of
 * the bottom bar, the local-mode badge).
 *
 * Everything here is cheap and finite: the springs are CSS `linear()` curves (no frame loop), the draw-in is a CSS animation on
 * `stroke-dashoffset` (the shapes carry `pathLength="1"`, set once), the timers sleep while the tab is hidden and stop after a
 * few rounds. Reduced motion: nothing starts (and `base.css` zeroes whatever a stylesheet would still play).
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import { springCurve } from "@/app/cssEasing";

/** The sidebar's reveal: a spring that settles without overshoot (ζ ≈ 0.95), so the edge line never leaves the plate. */
export const SB_SPRING = { stiffness: 320, damping: 34, mass: 1 } as const;
const SB_CURVE = springCurve(SB_SPRING);
/** Written on the sidebar frame: `--sb-ms` / `--sb-ease` read by `shell-motion.css` (reveal, labels, group folds). */
export const SB_VARS = { "--sb-ms": `${SB_CURVE.ms}ms`, "--sb-ease": SB_CURVE.easing } as CSSProperties;

/** The finder's answers opening under the field: a slightly livelier spring (ζ ≈ 0.85), `--nf-ms` / `--nf-ease`. */
export const NF_SPRING = { stiffness: 300, damping: 30, mass: 1 } as const;
const NF_CURVE = springCurve(NF_SPRING);
export const NF_VARS = { "--nf-ms": `${NF_CURVE.ms}ms`, "--nf-ease": NF_CURVE.easing } as CSSProperties;

/* ------------------------------------------------------------------ stroke draw-in */

/** A single icon redraw (bottom bar, on a tab switch). */
export const REDRAW_MS = 700;

const SHAPES = "path, circle, rect, line, polyline, ellipse";

/**
 * The first-load sequence of the sidebar (Runde 12), once per page load – not per session (a reload is a new opening of the site and the
 * only way to see it again), never on hover, a route change or a re-render:
 * - the ROWS wave in from the top, one every `rowStepMs` (70–90 ms), each taking `rowMs` (380–460 ms) – CSS `sb-wave`;
 * - the GLYPHS draw STRICTLY one after the other: glyph n has its own slot of `glyphMs`, its strokes share it back to back, and glyph n+1
 *   starts only when glyph n is finished (the spring of the active marker is not part of it and stays as it was);
 * - a short glint closes each glyph (`glintMs`).
 */
export const SEQ = { rowStepMs: 80, rowMs: 420, glyphFromMs: 80, glyphMs: 80, glintMs: 600 } as const;
/** The longest the sequence waits for the app to come into view (intro stage) before the rows simply show. */
export const SEQ_WAIT_MAX_MS = 20_000;

export interface SeqSlot {
  start: number;
  duration: number;
}
export interface SidebarSequence {
  /** one wave slot per row, top to bottom */
  rows: SeqSlot[];
  /** one slot per glyph, with the slots of its strokes inside it (back to back) */
  glyphs: (SeqSlot & { strokes: SeqSlot[] })[];
  /** ms until the last row has landed and the last glint is over (when the markers can go) */
  totalMs: number;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** Pure: the timeline for rows whose glyphs have `strokeCounts[i]` strokes. Glyph slots never overlap; strokes inside a slot never overlap. */
export function sidebarSequence(strokeCounts: readonly number[]): SidebarSequence {
  const rows = strokeCounts.map((_, i) => ({ start: i * SEQ.rowStepMs, duration: SEQ.rowMs }));
  const glyphs = strokeCounts.map((n, i) => {
    const start = SEQ.glyphFromMs + i * SEQ.glyphMs;
    const count = Math.max(1, n);
    const each = Math.floor((SEQ.glyphMs / count) * 100) / 100;
    return { start, duration: SEQ.glyphMs, strokes: Array.from({ length: count }, (_, k) => ({ start: r2(start + k * each), duration: each })) };
  });
  const lastRow = rows.length ? rows[rows.length - 1]!.start + SEQ.rowMs : 0;
  const lastGlyph = glyphs.length ? glyphs[glyphs.length - 1]!.start + glyphs[glyphs.length - 1]!.duration + SEQ.glintMs : 0;
  return { rows, glyphs, totalMs: Math.ceil(Math.max(lastRow, lastGlyph)) };
}

/**
 * Writes the sequence onto the sidebar under `root` (custom properties the CSS reads): `--sq-d` on a row, `--gd` / `--gm` on a stroke,
 * `--ge` (end of the glyph) on its icon. Rows inside a folded group are left out – they take no slot, so the visible ones follow each other
 * without a gap. Returns `totalMs`. Idempotent.
 */
export function applySidebarSequence(root: Element | null): number {
  if (!root) return 0;
  const rows = Array.from(root.querySelectorAll<HTMLElement>(".sb-rows > li")).filter((li) => !li.closest('[data-fold="closed"]'));
  const icons = rows.map((li) => li.querySelector<HTMLElement>(".sb-ico"));
  const strokes = icons.map((ico) => (ico ? Array.from(ico.querySelectorAll<SVGElement>(SHAPES)) : []));
  const seq = sidebarSequence(strokes.map((s) => s.length));
  rows.forEach((li, i) => {
    li.style.setProperty("--sq-d", `${seq.rows[i]!.start}ms`);
    const glyph = seq.glyphs[i]!;
    icons[i]?.style.setProperty("--ge", `${glyph.start + glyph.duration}ms`);
    strokes[i]!.forEach((shape, k) => {
      const slot = glyph.strokes[k]!;
      shape.style.setProperty("--gd", `${slot.start}ms`);
      shape.style.setProperty("--gm", `${slot.duration}ms`);
    });
  });
  return seq.totalMs;
}

let sequencePlayed = false;
/** Has the sequence started in this page load? (Module state: a remount of the sidebar – a resize across 768 px – never plays it again.) */
export function sequenceSeen(): boolean {
  return sequencePlayed;
}
export function markSequenceSeen(): void {
  sequencePlayed = true;
}
/** Test hook. */
export function resetSequenceForTests(): void {
  sequencePlayed = false;
}

const subscribeVisible = (cb: () => void): (() => void) => {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
};
/** Is the tab visible? A sequence that would start in a hidden tab waits for the first look (animations keep their clock while hidden). */
export function useTabVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisible,
    () => document.visibilityState !== "hidden",
    () => true,
  );
}

/** Gives every drawn shape under `root` the normalised length the CSS dash animation counts in. Idempotent. */
export function prepareStrokes(root: Element | null): void {
  if (!root) return;
  for (const el of Array.from(root.querySelectorAll(SHAPES))) if (!el.hasAttribute("pathLength")) el.setAttribute("pathLength", "1");
}

/**
 * Replays the stroke draw on one element (an icon wrapper with the class `sb-ico`): sets `data-redraw` for `REDRAW_MS`.
 * Returns the cancel. Under reduced motion nothing starts.
 */
export function redrawStrokes(el: HTMLElement | null, reduced: boolean): () => void {
  if (!el || reduced) return () => {};
  prepareStrokes(el);
  el.removeAttribute("data-redraw");
  // one frame between remove and set, so the CSS animation restarts
  const raf = requestAnimationFrame(() => el.setAttribute("data-redraw", ""));
  const timer = window.setTimeout(() => el.removeAttribute("data-redraw"), REDRAW_MS + 80);
  return () => {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    el.removeAttribute("data-redraw");
  };
}

/* ------------------------------------------------------------------ now and then */

export interface IdleCycleOptions {
  /** the timer only runs while this is true */
  active: boolean;
  /** ms until the first round, then the gap between rounds */
  firstMs: number;
  everyMs: number;
  /** rounds per page load (the timer stops after them) */
  max: number;
}

/**
 * A counter that advances once per round: use it as a React `key` to restart a finite CSS animation. It waits while the tab is
 * hidden (no round is made up for), stops after `max` rounds and does nothing while inactive or under reduced motion.
 */
export function useIdleCycle({ active, firstMs, everyMs, max }: IdleCycleOptions, reduced: boolean): number {
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!active || reduced || round >= max) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      timer = setTimeout(
        () => {
          // a hidden tab skips the round: it is tried again when the tab is back
          if (document.visibilityState !== "visible") return;
          setRound((n) => n + 1);
        },
        round === 0 ? firstMs : everyMs,
      );
    };
    arm();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (timer) clearTimeout(timer);
        arm();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, reduced, round, max, firstMs, everyMs]);
  return round;
}
