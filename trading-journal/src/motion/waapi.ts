/**
 * Tiny Web Animations helpers for the two windows of Paket V (login card, payment window). Every step of their choreography is ONE
 * `element.animate` – compositor-only properties (transform, opacity), seekable and listed by `document.getAnimations()` – so the
 * evidence sheets can pause the page at any millisecond and the tests can read duration, delay and curve back.
 *
 * Where the browser has no Web Animations (jsdom in the unit tests, very old engines) `play` returns `null` and the element simply
 * stays in its CSS end state: nothing waits for an animation that never runs.
 */

/** Marks the animations of one choreography (read back by the evidence script: `anim.id`). */
export type MoveId = `${"auth" | "pay"}:${string}`;

export function canAnimate(el: Element | null | undefined): el is Element & { animate: Element["animate"] } {
  return !!el && typeof (el as Element).animate === "function";
}

/** Starts one move. `fill: "both"` by default: it holds its first frame during the delay and its last frame until cancelled. */
export function play(el: Element | null | undefined, keyframes: Keyframe[], opts: KeyframeAnimationOptions & { id: MoveId }): Animation | null {
  if (!canAnimate(el)) return null;
  const a = el.animate(keyframes, { fill: "both", ...opts });
  a.id = opts.id;
  return a;
}

/** Resolves when every animation of the list has finished or was cancelled (never rejects). */
export function settled(anims: ReadonlyArray<Animation | null>): Promise<void> {
  return Promise.all(anims.map((a) => (a ? a.finished.then(() => undefined, () => undefined) : undefined))).then(() => undefined);
}

/** Cancels every animation of the list (their elements fall back to their CSS state). */
export function cancelAll(anims: ReadonlyArray<Animation | null>): void {
  for (const a of anims) a?.cancel();
}

/** The full length of one animation (delay + duration), ms. */
export function endOf(a: Animation | null): number {
  const t = a?.effect?.getComputedTiming();
  return t ? Number(t.endTime ?? 0) : 0;
}
