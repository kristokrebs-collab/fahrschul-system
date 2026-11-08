/**
 * Paket V – the MEASURED values of the two reference recordings (Anmelde-/Registrierfenster, Bezahlfenster), one table for both
 * windows so a later change has one place to look. Source: `docs/audit/V-VORBILD.md` (the spec of the recordings: frame by frame,
 * curves fitted by least squares). Times in ms, curves as CSS `cubic-bezier`, distances as a share of the card/window (W = width,
 * H = height) – the windows are laid out in container units, so the share is the same at every size.
 *
 * Only the lazy chunks of the two windows import this file (never the first load). Everything here drives Web Animations
 * (`element.animate`): `document.getAnimations()` lists every step, which is how the evidence sheets and the unit tests read the
 * timing back. Reduced motion: each window replaces its moves by one short cross-fade (`fade` below).
 */

/** A CSS easing curve. */
export type Curve = `cubic-bezier(${number}, ${number}, ${number}, ${number})` | "linear";

/** The one cross-fade every move turns into under reduced motion (ms). */
export const VORBILD_FADE_MS = 150;

/** Login ↔ registration: the dark band crosses the card ONCE and stays on the other side. */
export const authBand = {
  /** The band's whole run (measured 870 / 915 ms, recommended 900). */
  duration: 900,
  /** Ease-in-out with a long, soft tail, no overshoot (fit 0.47/0.18/0.32/1.0 and 0.54/0.10/0.28/1.0). */
  easing: "cubic-bezier(0.5, 0.14, 0.3, 1)" as Curve,
  /** Hard content swap under the fully dark card, as a share of the run: A→B 37 %, B→A 43 % (measured; the card is fully covered 0.367–0.439 of the run). */
  swapAt: { toB: 0.38, toA: 0.43 },
  /** Width of the band (share of the card width, landscape) and its travel A→B (share of W). */
  width: 1.42,
  travel: 1.503,
  /** Edge position of the band in mode A at mid-height (share of W); mode B = A − travel + width. */
  edgeA: 0.539,
  /** The slanted edge: 13° against the vertical, top left → bottom right. */
  skewDeg: 13,
  /** New brand text after the swap: eyebrow, headline, body (delay after the swap, duration, rise as share of H). */
  brand: [
    { delay: 20, duration: 300, rise: 0.023 },
    { delay: 80, duration: 300, rise: 0.02 },
    { delay: 140, duration: 250, rise: 0.0155 },
  ],
  brandEasing: "cubic-bezier(0.2, 0, 0, 1)" as Curve,
  /** Form rows after the swap: 45 ms apart, ≈ 230 ms each, rising ≈ 5 px (0.85 % H). */
  row: { stagger: 45, duration: 230, rise: 0.0085 },
  rowEasing: "cubic-bezier(0.2, 0, 0, 1)" as Curve,
  /** Focus underline of field 1: grows from the left (scaleX) after the swap. */
  focusLine: { delay: 250, duration: 120 },
  focusEasing: "cubic-bezier(0, 0, 0.2, 1)" as Curve,
  /** Primary button: last of the form, opacity 0 → 1 and ≈ 8 px rise. */
  button: { delay: 270, duration: 300, rise: 0.013 },
  /** Footer line. */
  footer: { delay: 390, duration: 150 },
} as const;

/** The payment window. */
export const payStage = {
  /** Card turn on focus of the security code (rotateY 0 ↔ 180°). */
  flip: { duration: 290, easing: "cubic-bezier(0.3, 0, 0.3, 1)" as Curve },
  /** Perspective of the turn, as a multiple of the card width (measured 3–4.5×). */
  perspective: 3.6,
  /** A digit group / a character of the name falls in: from −0.5 em, 60 %, transparent – ≈ 100 ms ease-out. */
  fallIn: { duration: 100, easing: "cubic-bezier(0, 0, 0.2, 1)" as Curve, stagger: 50 },
  /** "Bezahlen": form, summary and white column go in ≈ 100 ms. */
  formOut: { duration: 100, easing: "cubic-bezier(0, 0, 0.2, 1)" as Curve },
  /** The card flies to the middle of the window and scales to 1.08 in ≈ 300 ms. */
  lift: { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" as Curve, scale: 1.08 },
  /** A turned card comes back to its front during the flight. */
  liftTurn: { duration: 115, easing: "cubic-bezier(0, 0, 0.2, 1)" as Curve },
  /** Glass plate + accent glow behind the card. */
  plate: { duration: 120 },
  /** Status text + spinner fade in place. */
  status: { delay: 15, duration: 80 },
  /**
   * Authorising (from the click on): spinner 300 ms per turn (linear) from +15 ms, a sheen every 500 ms (a 200 ms pass, the first at
   * +115 ms – still in the flight), the glow breathing with 500 ms (first maximum at +149 ms).
   */
  spinTurn: 300,
  spinFrom: 15,
  sheen: { every: 500, pass: 200, first: 115 },
  pulse: 500,
  pulseFirstMax: 149,
  /** Confirmed: glow → success colour, ring + tick draw, the closing button after ≈ 200 ms. */
  success: { glowDelay: 30, glow: 100, ringDelay: 30, ring: 100, tickDelay: 70, tick: 90, buttonDelay: 200, button: 60 },
  /** An error (declined card, 3-D Secure cancelled): the card goes back the way it came (same curve). */
  back: { duration: 300, easing: "cubic-bezier(0.22, 1, 0.36, 1)" as Curve },
} as const;
