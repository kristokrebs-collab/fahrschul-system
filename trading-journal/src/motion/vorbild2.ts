/**
 * Runde 13 – the MEASURED values of the two reference recordings „Share Button Animation“ (A) and „Delete Button – The Bin Eats The Label“
 * (B), one table so a later change has one place to look. Source: the spec of the recordings (`vorbild2/SPEC.md` of the session: every
 * original frame with its timestamp, curves fitted by least squares against `cubic-bezier` and mass-1 springs). Times in ms; springs as
 * Motion transitions (mass 1, `stiffness` / `damping` as fitted). Taken over: structure, proportions, motion, times, curves – type, colours
 * and words come from our design system.
 *
 * Only the chunks of the share fan and the delete pill import this file. Reduced motion: both components drop the moves and keep the
 * states (see there).
 */

/** A — the share pill turns into a hub with ✕, the channels fan out on a half circle, a choice floods, collects and confirms. */
export const shareFan = {
  /** Pill → hub (width about the centre): spring k 670 / c 44 (ζ 0.85, 0.6 % overshoot, rests after ≈ 175 ms). */
  morph: { type: "spring", stiffness: 670, damping: 44, mass: 1 },
  /** The trigger's word fades out while the pill shrinks. */
  labelOut: 100,
  /** The face of the pill cross-fades into the recessed hub (+35 … +200 ms). */
  faceFade: { delay: 35, duration: 165 },
  /** „+“ draws itself from the centre (+230 ms, ≈ 100 ms), then turns 45° clockwise into the ✕ (+335 ms, ≈ 200 ms, strong ease-out). */
  plusIn: { delay: 230, duration: 100 },
  plusTurn: { delay: 335, duration: 200, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  /** The discs: spring k 245 / c 23 / m 1 (ζ 0.73, 3.5 % overshoot), the first starts +250 ms, then one every 50 ms, left → right; scale 0.3 → 1, opacity over ≈ 160 ms. */
  fan: { type: "spring", stiffness: 245, damping: 23, mass: 1 },
  fanStart: 250,
  fanStagger: 50,
  fanFrom: 0.3,
  fanFade: 160,
  /** A choice (t1 = the click): the disc swells to 1.02, dips to 0.83 and springs back (+30 ms, ≈ 230 ms; one key per 33 ms). */
  press: { delay: 30, keys: [1, 1.02, 0.91, 0.84, 0.83, 0.87, 0.99, 1.02, 1], step: 33 },
  /** A ring leaves the disc's edge (r 1.0 → 1.45) and fades (+63 ms, 170 ms, ease-out). */
  ring: { delay: 63, duration: 170, to: 1.45 },
  /** The target's word in a dark pill under the disc, visible ≈ 100 ms (+30 … +130 ms). */
  tip: { delay: 30, duration: 100 },
  /** The caption swaps HARD to the busy word (+63 ms). */
  busyAt: 63,
  /** The flood in the channel's colour grows from the click point until the disc is full (+80 ms, ≈ 90 ms, ease-out). */
  flood: { delay: 80, duration: 90 },
  /** The chosen disc rides straight into the hub's place (+363 ms, ≈ 340 ms, spring k 395 / c 37, ζ 0.92, no overshoot). */
  collectAt: 363,
  collect: { type: "spring", stiffness: 395, damping: 37, mass: 1 },
  /** The others are collected one after another (+397 ms, 17 ms apart, ≈ 120 ms each, ease-in), shrinking under the chosen one. */
  othersAt: 397,
  othersStagger: 17,
  othersDuration: 120,
  /** The old hub turns its ✕ back and fades (≈ 70 ms) as the collection starts. */
  hubOut: 70,
  /** The chosen disc becomes the hub (+563 ms, × 1.11 of its size, spring k 650 / c 44). */
  becomeHubAt: 563,
  becomeHub: { type: "spring", stiffness: 650, damping: 44, mass: 1 },
  /** The caption says the result (HARD) no earlier than +763 ms – later when the target needs longer. */
  doneAt: 763,
  /** After the result: the flood withdraws to the click point (+134 ms, 100 ms, ease-in), then the ✓ draws (130 ms, ease-out). */
  retractAfter: 134,
  retract: 100,
  check: 130,
} as const;

/** Not in the recording – our own rounding off: how long the ✓ stays, and the short reverse of the fan-out when it closes. */
export const shareFanOwn = {
  /** The confirmed disc stays this long before the fan gives the trigger back. */
  hold: 900,
  /** Close (✕, outside, Esc, Tab, after a result): the discs ride back under the hub, the last one first. */
  closeDuration: 160,
  closeStagger: 25,
} as const;

/** B — a delete pill whose bin eats the word, turns into a disc with a spinner while the real deletion runs, and closes the ring. */
export const binEat = {
  /** Press: the pill dips to 0.973 and springs back over 1.02 (≈ 200 ms). */
  press: { keys: [1, 0.973, 0.99, 1.02, 1], duration: 200 },
  /** The lid opens 40° counter-clockwise and the bin tilts 14° clockwise (+60 ms, spring k 700 / c 42). */
  lidAt: 60,
  lid: { type: "spring", stiffness: 700, damping: 42, mass: 1 },
  lidDeg: -40,
  tiltDeg: 14,
  /** The letters jiggle from +60 ms until they leave: ±3 px x, ±2.5 px y, ±8°, each with its own phase, period ≈ 220 ms. */
  jiggle: { x: 3, y: 2.5, deg: 8, period: 220 },
  /** The first letter leaves +450 ms, then one every 85 ms, left → right; each flight to the bottom of the bin takes ≈ 580 ms and ends at 0.55. */
  flyAt: 450,
  flyStagger: 85,
  flight: 580,
  landScale: 0.55,
  /** The fill rises one step per landed letter (each ≈ 70 ms, ease-out) and sloshes once. */
  fillStep: 70,
  /** Full → the pill turns into a disc 105 ms later: width about the centre, 250 ms, `cubic-bezier(0, 0.48, 0.3, 1)`; the lid shuts in ≈ 50 ms. */
  morphAfterFull: 105,
  morph: { duration: 250, ease: [0, 0.48, 0.3, 1] as [number, number, number, number] },
  lidShut: 50,
  /** The old shadow stays on the old outline and fades in ≈ 100 ms. */
  shadowOut: 100,
  /** The spinner appears 395 ms after the morph started (fade 100 ms): a 100° arc, ring Ø 1.17 × the disc, stroke 0.056 of the pill height, 0.45°/ms (800 ms a turn). */
  spinAfterMorph: 395,
  spinFade: 100,
  arcDeg: 100,
  ringRatio: 1.17,
  strokeRatio: 0.056,
  turnMs: 800,
  /** The spinner shows at least this long (the demo's ≈ 415 ms) – it ends only when the real deletion answered. */
  spinMin: 415,
  /** Done: the bin empties (≈ 50 ms) and the arc's head sprints round until the ring is closed (≈ 210 ms, `cubic-bezier(0.2, 0.8, 0.3, 1)`). */
  empty: 50,
  close: { duration: 210, ease: [0.2, 0.8, 0.3, 1] as [number, number, number, number] },
  /** The closed ring holds ≈ 360 ms. */
  hold: 360,
  /** Back to the pill (where the button stays – a failure here): 270 ms strong ease-out, the ring fades in 170 ms, the word fades in place (120 ms) at ≈ 95 % width. */
  back: { duration: 270, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] },
  ringOut: 170,
  labelBackAt: 150,
  labelBack: 120,
} as const;

/** When the bin is full, for a word of `n` letters (6 in the recording: +1425 ms). */
export const binFullAt = (n: number): number => binEat.flyAt + binEat.flyStagger * Math.max(0, n - 1) + binEat.flight;
