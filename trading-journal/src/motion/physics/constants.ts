/**
 * Physics tuning (px, ms, px·s⁻¹). These extend the `gesture` group of `tokens.ts` without touching it: the tuned
 * springs/tweens there stay exactly as they are (physics is ADDITIVE, see README "Physics"). Every number below has a
 * source: Apple (WWDC18 803 "Designing Fluid Interfaces", WWDC23 10158 "Animate with springs"), UIKit
 * (`UIScrollView.DecelerationRate`), Android/Flutter `VelocityTracker`, and the research in the physics plan.
 */
export const physics = {
  // ── gesture recognition ────────────────────────────────────────────────────────────────────────────────────
  hysteresis: 10, // px – a gesture owns the pointer only after this much travel (Apple: "usually 10 points")
  axisRatio: 1.2, // |primary| > 1.2·|cross| ⇒ the axis is ours (≈ 40° cone); otherwise the browser keeps the scroll
  clickSwallowMs: 600, // ms – the click that follows an engaged drag is swallowed within this window

  // ── velocity estimation ────────────────────────────────────────────────────────────────────────────────────
  velocityHorizon: 100, // ms of samples in the weighted least-squares fit (Android / Flutter)
  velocityStopped: 40, // ms without a move before the lift ⇒ velocity 0 ("placed", not thrown)
  stillTravel: 2, // px – moved less than this over the last `velocityStopped` ms ⇒ also "placed" (pause rule)
  velocitySamples: 48, // ring size: holds the 100 ms horizon at 240 Hz coalesced input (24) with headroom
  maxVelocity: 8000, // px/s – glitch clamp

  // ── projection (UIScrollView) ──────────────────────────────────────────────────────────────────────────────
  decelNormal: 0.998, // UIScrollView.DecelerationRate.normal (per ms) → τ 499.5 ms, distance = 0.4995·v
  decelFast: 0.99, // UIScrollView.DecelerationRate.fast → τ 99.5 ms, distance = 0.099·v (pickers, segments, slots)

  // ── rubber band (iOS) ──────────────────────────────────────────────────────────────────────────────────────
  rubber: 0.55, // b(x) = (1 − 1/(x·c/d + 1))·d — slope c at the edge, tends to d

  // ── tempo → spring ─────────────────────────────────────────────────────────────────────────────────────────
  slowSpeed: 400, // px/s – at or below: gentle, no added overshoot (the token itself)
  fastSpeed: 1800, // px/s – at or above: direct and elastic
  releaseSlow: { duration: 0.5, bounce: 0 }, // = Apple .smooth = spring.smooth (k 157.9, c 25.13)
  releaseFast: { duration: 0.36, bounce: 0.3 }, // k 304.6, c 24.43 — "noticeable bounciness", below Apple's 0.4 line
  contextResponse: 0.2, // layout-driven targets at full tempo: duration × (1 − 0.2)
  contextBounce: 0.15, // … and bounce + 0.15
  maxBounce: 0.4, // never above Apple's caution line ("cautious about values higher than around 0.4")
  tapMs: 150, // ms – a press up to this long is a tap (dock hop exactly as tuned) …
  holdMs: 400, // ms – … from this long a deliberate press (gentler, no rebound); `pressTempo` blends between

  // ── commit rules ───────────────────────────────────────────────────────────────────────────────────────────
  dismissFraction: 0.33, // projected-offset threshold = clamp(0.33·size, dismissMin, dismissMax)
  dismissMin: 140, // px
  dismissMax: 260, // px
  dismissMinOffset: 16, // px actually travelled before any dismissal can commit (no accidental flicks)
  flickBack: 300, // px/s against the dismiss direction cancels, even past the threshold
  flickMinSpeed: 600, // px/s – a quick flick (one step per flick: dock tab switch, calendar month) needs this …
  flickMinTravel: 24, // px – … this much travel …
  flickMaxMs: 250, // ms – … within this press duration
  throwMinSpeed: 400, // px/s – below this a drop lands where it is (no projection; WidgetGrid, segmented)

  // ── swipe-dismiss surfaces ─────────────────────────────────────────────────────────────────────────────────
  stretch: 60, // px – rubber-band dimension against a resting edge (sheet pulled up, island pulled away from its edge)
  guardStretch: 120, // px – rubber-band dimension while a dirty editor resists dismissal (300 px of finger ≈ 70 px)
  crossFollow: 0.5, // zoom mode: the cross axis follows the finger at half speed
  dismissScale: 0.12, // zoom mode: centred cards shrink by up to 12 % as they are pulled (iOS 18 zoom-dismiss)
  dimFloor: 0.25, // the backdrop dim keeps ≥ 25 % while pulled
  flingMinVelocity: 900, // px/s – a committed exit leaves at least this fast (a slow drag past the line still exits briskly)
  flingOvershoot: 40, // px – a flung panel travels its own size plus this, so its shadow clears the edge too

  // ── feedback ───────────────────────────────────────────────────────────────────────────────────────────────
  haptic: 6, // ms navigator.vibrate on threshold crossings / selection changes (Android; silently ignored elsewhere)
} as const;

export type PhysicsTuning = typeof physics;
