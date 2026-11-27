/**
 * The choreography of the payment window (Paket V, `docs/audit/V-VORBILD.md` § 2.4) as Web Animations – every move one `animate`, ids
 * `pay:*`, so the evidence sheets can stop the page at any millisecond and the tests read duration / delay / curve back.
 *
 *   lift        form, summary and the white column go (≈ 100 ms); the card flies to the middle of the window and scales to 1.08 (300 ms,
 *               cubic-bezier(0.22, 1, 0.36, 1)); a glass plate with the accent glow comes up behind it and turns into the card's glow;
 *               status text + spinner fade in place.
 *   authorising spinner 300 ms per turn, a sheen across the card every 500 ms (a 200 ms pass), the glow breathes with 500 ms.
 *   success     the loop stops, the glow turns to the success colour (100 ms), ring and tick draw, the closing button after 200 ms.
 *   back        an error: the card flies back on the same curve, the form returns – nothing is shown as paid.
 * Reduced motion: no flight, no loop – one short cross-fade into the end state.
 */
import { payStage, VORBILD_FADE_MS } from "@/motion/vorbild";
import { cancelAll, play } from "@/motion/waapi";

export interface StageParts {
  win: HTMLElement | null;
  card: HTMLElement | null;
  plate: HTMLElement | null;
  glow: HTMLElement | null;
  glowOk: HTMLElement | null;
  sheen: HTMLElement | null;
  form: HTMLElement | null;
  summary: HTMLElement | null;
  right: HTMLElement | null;
  status: HTMLElement | null;
  spinner: HTMLElement | null;
}

/** Where the card has to go: the middle of the window (50 % W, 48.8 % H, measured), as a translate from its resting place. */
export function liftDelta(win: DOMRect, card: DOMRect): { x: number; y: number } {
  return { x: Math.round(win.left + win.width * 0.5 - (card.left + card.width / 2)), y: Math.round(win.top + win.height * 0.488 - (card.top + card.height / 2)) };
}

const done = (list: Array<Animation | null>): Animation[] => list.filter((a): a is Animation => !!a);

/** The lift; returns the animations (they hold their end state until `back` or a reset cancels them). */
export function lift(p: StageParts, reduced: boolean): { anims: Animation[]; delta: { x: number; y: number } } {
  const delta = p.win && p.card ? liftDelta(p.win.getBoundingClientRect(), p.card.getBoundingClientRect()) : { x: 0, y: 0 };
  const { formOut, lift: l, plate, status } = payStage;
  if (reduced) {
    return {
      delta,
      anims: done([
        play(p.form, [{ opacity: 1 }, { opacity: 0 }], { id: "pay:form-out", duration: VORBILD_FADE_MS, easing: "linear" }),
        play(p.summary, [{ opacity: 1 }, { opacity: 0 }], { id: "pay:summary-out", duration: VORBILD_FADE_MS, easing: "linear" }),
        play(p.right, [{ opacity: 1 }, { opacity: 0 }], { id: "pay:white-out", duration: VORBILD_FADE_MS, easing: "linear" }),
        play(p.card, [{ opacity: 0, translate: `${delta.x}px ${delta.y}px`, scale: String(l.scale) }, { opacity: 1, translate: `${delta.x}px ${delta.y}px`, scale: String(l.scale) }], { id: "pay:card-fade", duration: VORBILD_FADE_MS, easing: "linear" }),
        play(p.glow, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:glow-in", duration: VORBILD_FADE_MS, easing: "linear" }),
        play(p.status, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:status-in", duration: VORBILD_FADE_MS, easing: "linear" }),
      ]),
    };
  }
  return {
    delta,
    anims: done([
      play(p.form, [{ opacity: 1 }, { opacity: 0 }], { id: "pay:form-out", duration: formOut.duration, easing: formOut.easing }),
      play(p.summary, [{ opacity: 1 }, { opacity: 0 }], { id: "pay:summary-out", duration: formOut.duration, easing: formOut.easing }),
      play(p.right, [{ opacity: 1 }, { opacity: 0 }], { id: "pay:white-out", duration: formOut.duration, easing: formOut.easing }),
      play(p.card, [{ translate: "0 0", scale: "1" }, { translate: `${delta.x}px ${delta.y}px`, scale: String(l.scale) }], { id: "pay:card-lift", duration: l.duration, easing: l.easing }),
      play(p.plate, [{ opacity: 0, offset: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0, offset: 1 }], { id: "pay:plate", duration: l.duration, easing: "linear" }),
      play(p.glow, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:glow-in", duration: l.duration - plate.duration, delay: plate.duration, easing: l.easing }),
      play(p.status, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:status-in", duration: status.duration, delay: status.delay, easing: formOut.easing }),
    ]),
  };
}

/** The loops while the bank / the server answers (stopped by `cancelAll` the moment the answer is there). */
// motion-exception: pay-authorising — spinner, sheen and glow pulse loop ONLY while the payment is being authorised (an open request)
export function authorising(p: StageParts, reduced: boolean): Animation[] {
  if (reduced) return [];
  const { spinTurn, spinFrom, sheen, pulse, pulseFirstMax } = payStage;
  return done([
    play(p.spinner, [{ rotate: "0deg" }, { rotate: "360deg" }], { id: "pay:spinner", duration: spinTurn, iterations: Infinity, easing: "linear", delay: spinFrom, fill: "none" }),
    play(p.sheen, [{ translate: "-120% 0", opacity: 1, offset: 0 }, { translate: "620% 0", opacity: 1, offset: sheen.pass / sheen.every }, { translate: "620% 0", opacity: 0, offset: 1 }], { id: "pay:sheen", duration: sheen.every, iterations: Infinity, easing: "linear", delay: sheen.first, fill: "none" }),
    play(p.glow, [{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }], { id: "pay:pulse", duration: pulse, iterations: Infinity, easing: "ease-in-out", delay: pulseFirstMax, fill: "none" }),
  ]);
}

/** Confirmed by the server: glow to the success colour, ring + tick draw, then the closing button. */
export function success(p: StageParts & { ring: SVGElement | null; tick: SVGElement | null; doneBtn: HTMLElement | null }, reduced: boolean): Animation[] {
  const s = payStage.success;
  if (reduced) return done([play(p.glowOk, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:ok-glow", duration: VORBILD_FADE_MS, easing: "linear" }), play(p.doneBtn, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:done-btn", duration: VORBILD_FADE_MS, easing: "linear" })]);
  return done([
    play(p.glow, [{ opacity: 1 }, { opacity: 0 }], { id: "pay:glow-out", duration: s.glow, delay: s.glowDelay, easing: "linear" }),
    play(p.glowOk, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:ok-glow", duration: s.glow, delay: s.glowDelay, easing: "linear" }),
    play(p.ring, [{ strokeDashoffset: "1" }, { strokeDashoffset: "0" }], { id: "pay:ok-ring", duration: s.ring, delay: s.ringDelay, easing: "cubic-bezier(0, 0, 0.2, 1)" }),
    play(p.tick, [{ strokeDashoffset: "1" }, { strokeDashoffset: "0" }], { id: "pay:ok-tick", duration: s.tick, delay: s.tickDelay, easing: "cubic-bezier(0, 0, 0.2, 1)" }),
    play(p.doneBtn, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:done-btn", duration: s.button, delay: s.buttonDelay, easing: "linear" }),
  ]);
}

/** An error: the card goes back, the form comes back (the caller cancels the lift once this has finished). */
export function back(p: StageParts, delta: { x: number; y: number }, reduced: boolean): Animation[] {
  const { back: b, lift: l } = payStage;
  const d = reduced ? VORBILD_FADE_MS : b.duration;
  const e = reduced ? "linear" : b.easing;
  return done([
    reduced
      ? play(p.card, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:card-back", duration: d, easing: e })
      : play(p.card, [{ translate: `${delta.x}px ${delta.y}px`, scale: String(l.scale) }, { translate: "0 0", scale: "1" }], { id: "pay:card-back", duration: d, easing: e }),
    play(p.glow, [{ opacity: 1 }, { opacity: 0 }], { id: "pay:glow-back", duration: d / 2, easing: "linear" }),
    play(p.status, [{ opacity: 1 }, { opacity: 0 }], { id: "pay:status-back", duration: d / 3, easing: "linear" }),
    play(p.form, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:form-back", duration: d / 2, delay: d / 2, easing: "linear" }),
    play(p.summary, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:summary-back", duration: d / 2, delay: d / 2, easing: "linear" }),
    play(p.right, [{ opacity: 0 }, { opacity: 1 }], { id: "pay:white-back", duration: d / 2, delay: d / 4, easing: "linear" }),
  ]);
}

export { cancelAll };
