/**
 * The logo sequence (Runde 11, A5): the brand mark(s) draw themselves STRICTLY one after the other – stroke 1 is finished before stroke 2
 * starts, logo 1 before logo 2 – in at most 1.2 s, once per session; Einstellungen › Darstellung › Bewegung replays it.
 *
 * What is drawn is configuration, not code: `LOGO_MARKS` holds the marks as SVG path data in a 24 × 24 box. Today it is the one mark the app
 * has always had, the ₿ sign, as three strokes (letter body, upper and lower pair of ticks). The brand name and the real logo path are the
 * operator's decision E10 (`docs/LAUNCH-PLAN.md`): swap the entries (or add a second logo) and the sequence, the tile and the replay follow –
 * nothing else changes. `logoTimeline` is pure and unit-tested.
 */
import { useSyncExternalStore } from "react";
import { storageKey } from "@/store/storage";

export interface LogoMark {
  id: string;
  /** accessible name of the mark (the tile around it is decorative; the header button has its own name) */
  label: string;
  /** SVG path data in a 24 × 24 box, drawn in this order */
  paths: readonly string[];
}

/** E10: the operator's logo goes here (path data, 24 × 24). Today: the ₿ sign the header always showed. */
export const LOGO_MARKS: readonly LogoMark[] = [
  {
    id: "btc",
    label: "₿",
    paths: ["M8.5 4.5v14M8.5 4.5h4.9a3.2 3.2 0 0 1 0 6.4H8.5M8.5 10.9h5.6a3.8 3.8 0 0 1 0 7.6H8.5", "M10.8 2.2v2.3M14 2.2v2.3", "M10.8 18.5v2.3M14 18.5v2.3"],
  },
];

/** The sequence lasts at most this long (ms), whatever the number of strokes. */
export const LOGO_TOTAL_MS = 1200;
/** The whole mark rests this long fully drawn before the next one starts to draw (ms, inside the total). */
export const LOGO_HOLD_MS = 0;

export interface LogoSlot {
  /** index of the mark */
  mark: number;
  /** index of the stroke inside the mark */
  stroke: number;
  /** ms from the start of the sequence */
  start: number;
  /** ms the stroke takes to draw */
  duration: number;
}

/**
 * Pure: one slot per stroke, back to back – `start[i+1] ≥ start[i] + duration[i]` – and the last one ends by `total`. Every stroke gets
 * the same time (a mark with more strokes does not take longer than one with fewer, as a whole: the time is shared by all strokes of all marks).
 */
export function logoTimeline(marks: readonly Pick<LogoMark, "paths">[], total: number = LOGO_TOTAL_MS): LogoSlot[] {
  const count = marks.reduce((n, m) => n + m.paths.length, 0);
  if (count === 0) return [];
  const duration = Math.floor(total / count);
  const out: LogoSlot[] = [];
  let at = 0;
  marks.forEach((m, mark) =>
    m.paths.forEach((_, stroke) => {
      out.push({ mark, stroke, start: at, duration });
      at += duration;
    }),
  );
  return out;
}

/** The time a mark is on screen drawing: from its first stroke's start to its last stroke's end (for the cross-fade between logos). */
export function markWindow(slots: readonly LogoSlot[], mark: number): { start: number; end: number } | null {
  const own = slots.filter((s) => s.mark === mark);
  if (own.length === 0) return null;
  return { start: own[0]!.start, end: own[own.length - 1]!.start + own[own.length - 1]!.duration };
}

/* ------------------------------------------------------------------ once per session, replay */

export const LOGO_SEQ_KEY: string = storageKey("logo-seq");

/** Has the sequence played in this session? Blocked storage reads as „yes“ (it then simply never plays). */
export function logoSeen(): boolean {
  try {
    return sessionStorage.getItem(LOGO_SEQ_KEY) !== null;
  } catch {
    return true;
  }
}
export function markLogoSeen(): void {
  try {
    sessionStorage.setItem(LOGO_SEQ_KEY, "1");
  } catch {
    /* private mode: it plays again next time */
  }
}

let replays = 0;
const listeners = new Set<() => void>();
/** Plays the sequence again (the settings button). Ignored under reduced motion by the tile itself. */
export function replayLogo(): void {
  replays += 1;
  for (const l of listeners) l();
}
export function useLogoReplays(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => replays,
    () => 0,
  );
}
