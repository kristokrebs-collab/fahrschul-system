/**
 * The login card's band (Paket V, `docs/audit/V-VORBILD.md` § 1): geometry and choreography, kept apart from the React of
 * `AuthWindow.tsx` so the numbers have one home and the unit tests can check them without a browser.
 *
 * The card has two halves: the paper FORM half and the dark BAND – one slanted parallelogram (13° against the vertical, top left →
 * bottom right) that carries the brand text. Mode A (Anmelden): band on the right, form on the left. Mode B (Registrieren): band on the
 * left, form on the right. Switching runs the band ONCE across the card (one `translateX`) and leaves it on the other side; its content
 * stays in card coordinates (the inner layer runs the inverse transform), so the band acts like a travelling window. Under the fully
 * dark card the content swaps hard, then the new brand text, the form rows, the focus line, the button and the footer come in.
 *
 * Phones (not in the recording, our own derivation): the card stands upright, the band lies across it (top in A, bottom in B) and runs
 * from top to bottom with the same times and curve; its edge is slanted 9° against the horizontal (13° would eat a third of the brand
 * area on a 360-px card).
 */
import { authBand, VORBILD_FADE_MS } from "@/motion/vorbild";
import { endOf, play, type MoveId } from "@/motion/waapi";
import type { AuthView } from "../types";

export type Side = "a" | "b";
export type Orientation = "landscape" | "portrait";

/** Which half shows a view: the registration is B; every other step stays where the card is (the login family is A). */
export function sideOf(view: AuthView, current: Side): Side {
  if (view === "signup") return "b";
  if (view === "sent" || view === "welcome") return current;
  return "a";
}

/** The step a view belongs to inside its half: Anmelden and „Link per E-Mail“ keep ONE form (the e-mail field keeps its node). */
export function stepOf(view: AuthView): string {
  return view === "signin" || view === "magic" ? "entry" : view;
}

/** Portrait geometry (share of the card height): the band's edge sits at 30 % (A, band on top) or 70 % (B, band below). */
const PORTRAIT = { edgeA: 0.3, edgeB: 0.7, skewDeg: 9 } as const;

const pct = (n: number): string => `${Math.round(n * 1e5) / 1e3}%`;

export interface BandGeometry {
  /** Inline style of the band (position + size) and of its inner layer (in band units). */
  band: { left: string; top: string; width: string; height: string };
  inner: { left: string; top: string; width: string; height: string };
  /** `transform` of the band and of its inner layer per side. */
  bandTransform: Record<Side, string>;
  innerTransform: Record<Side, string>;
}

/**
 * Landscape: the band is `width` × W wide, its mid-height edge at `edgeA` · W in A; A→B moves it by `travel` · W to the left
 * (so B's right edge sits at edgeA − travel + width = 45.6 % W, as measured). Percent translations are relative to the element
 * itself: the band's to its own width, the inner layer's to the card width.
 */
export function bandGeometry(o: Orientation): BandGeometry {
  if (o === "landscape") {
    const { width, travel, edgeA, skewDeg } = authBand;
    const skew = `skewX(${skewDeg}deg)`;
    const unskew = `skewX(${-skewDeg}deg)`;
    return {
      band: { left: pct(edgeA), top: "0%", width: pct(width), height: "100%" },
      inner: { left: pct(-edgeA / width), top: "0%", width: pct(1 / width), height: "100%" },
      bandTransform: { a: `translateX(0%) ${skew}`, b: `translateX(${pct(-travel / width)}) ${skew}` },
      innerTransform: { a: `${unskew} translateX(0%)`, b: `${unskew} translateX(${pct(travel)})` },
    };
  }
  const h = authBand.width;
  const top = PORTRAIT.edgeA - h;
  const travel = PORTRAIT.edgeB - top;
  const skew = `skewY(${PORTRAIT.skewDeg}deg)`;
  const unskew = `skewY(${-PORTRAIT.skewDeg}deg)`;
  return {
    band: { left: "0%", top: pct(top), width: "100%", height: pct(h) },
    inner: { left: "0%", top: pct(-top / h), width: "100%", height: pct(1 / h) },
    bandTransform: { a: `translateY(0%) ${skew}`, b: `translateY(${pct(travel / h)}) ${skew}` },
    innerTransform: { a: `${unskew} translateY(0%)`, b: `${unskew} translateY(${pct(-travel)})` },
  };
}

/** When the content swaps (ms after the click): 38 % of the run towards B, 43 % back to A. */
export const swapMs = (to: Side): number => Math.round(authBand.duration * (to === "b" ? authBand.swapAt.toB : authBand.swapAt.toA));

/** The parts of the card a switch moves (looked up by `data-aw-*` attributes inside the card). */
export interface SwitchParts {
  band: HTMLElement | null;
  inner: HTMLElement | null;
  /** Brand block and form column of the side that LEAVES … */
  oldBrand: HTMLElement | null;
  oldColumn: HTMLElement | null;
  /** … and of the side that comes. */
  newBrand: HTMLElement | null;
  newColumn: HTMLElement | null;
  /** Card height in px (the rises are a share of it). */
  height: number;
}

const rows = (root: HTMLElement | null, sel: string): HTMLElement[] => (root ? Array.from(root.querySelectorAll<HTMLElement>(sel)) : []);

/**
 * Enter of a form column: rows (`data-aw-row`, in DOM order) 45 ms apart, then the focus line of field 1, the button and the footer.
 * `at` = when the first row starts (ms). Returns every animation started.
 */
export function enterColumn(col: HTMLElement | null, at: number, height: number, reduced: boolean, tag: string): Animation[] {
  const out: Array<Animation | null> = [];
  const id = (part: string): MoveId => `auth:${tag}-${part}`;
  if (reduced) {
    if (col) out.push(play(col, [{ opacity: 0 }, { opacity: 1 }], { id: id("fade"), duration: VORBILD_FADE_MS, delay: at, easing: "linear" }));
    return out.filter((a): a is Animation => !!a);
  }
  const { row, rowEasing, button, footer, focusLine, focusEasing, brandEasing } = authBand;
  rows(col, "[data-aw-row]").forEach((el, i) => {
    out.push(play(el, [{ opacity: 0, translate: `0 ${row.rise * height}px` }, { opacity: 1, translate: "0 0" }], { id: id(`row${i}`), duration: row.duration, delay: at + i * row.stagger, easing: rowEasing }));
  });
  for (const el of rows(col, "[data-aw-btn]")) {
    out.push(play(el, [{ opacity: 0, translate: `0 ${button.rise * height}px` }, { opacity: 1, translate: "0 0" }], { id: id("button"), duration: button.duration, delay: at + button.delay, easing: brandEasing }));
  }
  for (const el of rows(col, "[data-aw-foot]")) {
    out.push(play(el, [{ opacity: 0 }, { opacity: 1 }], { id: id("footer"), duration: footer.duration, delay: at + footer.delay, easing: rowEasing }));
  }
  const line = col?.querySelector<HTMLElement>("[data-aw-focusline]");
  if (line) out.push(play(line, [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { id: id("focusline"), duration: focusLine.duration, delay: at + focusLine.delay, easing: focusEasing, fill: "backwards" }));
  return out.filter((a): a is Animation => !!a);
}

/** Enter of a brand block: eyebrow, headline, body (`data-aw-brand-row`, in DOM order) at +20 / +80 / +140 ms, rising 14 / 12 / 10 px. */
export function enterBrand(brand: HTMLElement | null, at: number, height: number, reduced: boolean): Animation[] {
  if (reduced) return [play(brand, [{ opacity: 0 }, { opacity: 1 }], { id: "auth:brand-fade", duration: VORBILD_FADE_MS, delay: at, easing: "linear" })].filter((a): a is Animation => !!a);
  return rows(brand, "[data-aw-brand-row]")
    .map((el, i) => {
      const s = authBand.brand[Math.min(i, authBand.brand.length - 1)]!;
      return play(el, [{ opacity: 0, translate: `0 ${s.rise * height}px` }, { opacity: 1, translate: "0 0" }], { id: `auth:brand${i}`, duration: s.duration, delay: at + s.delay, easing: authBand.brandEasing });
    })
    .filter((a): a is Animation => !!a);
}

/** A hard cut at `at` ms: visible until then, gone from then on (one step keyframe, so it is seekable like the rest). */
function cutAt(el: HTMLElement | null, at: number, total: number, id: MoveId): Animation | null {
  const k = Math.min(1, Math.max(0, at / total));
  return play(el, [{ opacity: 1, offset: 0 }, { opacity: 1, offset: k }, { opacity: 0, offset: k }, { opacity: 0, offset: 1 }], { id, duration: total, easing: "linear" });
}

/**
 * The switch A ↔ B (`to` = the side that comes). Starts every move at once (call it in the layout effect of the commit that changed
 * the side, before the browser paints) and returns them with the swap time; the caller focuses field 1 at `swap` and removes the
 * leaving column after `end`.
 */
export function runSwitch(parts: SwitchParts, to: Side, o: Orientation, reduced: boolean): { anims: Animation[]; swap: number; end: number } {
  const g = bandGeometry(o);
  const from: Side = to === "b" ? "a" : "b";
  const out: Array<Animation | null> = [];
  if (reduced) {
    // reduced motion: the band jumps, the old content goes and the new comes in one short cross-fade, field 1 gets the focus at once
    out.push(play(parts.oldColumn, [{ opacity: 1 }, { opacity: 0 }], { id: "auth:old-fade", duration: VORBILD_FADE_MS, easing: "linear" }));
    out.push(play(parts.oldBrand, [{ opacity: 1 }, { opacity: 0 }], { id: "auth:old-brand-fade", duration: VORBILD_FADE_MS, easing: "linear" }));
    out.push(...enterColumn(parts.newColumn, 0, parts.height, true, "new"), ...enterBrand(parts.newBrand, 0, parts.height, true));
    const anims = out.filter((a): a is Animation => !!a);
    return { anims, swap: 0, end: Math.max(VORBILD_FADE_MS, ...anims.map(endOf)) };
  }
  const { duration, easing } = authBand;
  const swap = swapMs(to);
  out.push(play(parts.band, [{ transform: g.bandTransform[from] }, { transform: g.bandTransform[to] }], { id: "auth:band", duration, easing }));
  out.push(play(parts.inner, [{ transform: g.innerTransform[from] }, { transform: g.innerTransform[to] }], { id: "auth:band-inner", duration, easing }));
  out.push(cutAt(parts.oldBrand, swap, duration, "auth:old-brand-cut"));
  out.push(cutAt(parts.oldColumn, swap, duration, "auth:old-column-cut"));
  out.push(...enterBrand(parts.newBrand, swap, parts.height, false));
  out.push(...enterColumn(parts.newColumn, swap, parts.height, false, "new"));
  const anims = out.filter((a): a is Animation => !!a);
  return { anims, swap, end: Math.max(duration, ...anims.map(endOf)) };
}
