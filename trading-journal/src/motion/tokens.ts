import type { Transition } from "motion/react";

/**
 * Motion tokens. Bundle springs are preserved 1:1 (comments name the original component);
 * NEW values are marked. Only ever animate transform / opacity / filter / clip-path (see Plan 3.2).
 */
export const spring = {
  press: { type: "spring", stiffness: 500, damping: 30 }, // Button whileTap
  morph: { type: "spring", stiffness: 340, damping: 34, mass: 0.9 }, // Morph-Dialog (Card → Dialog)
  sheet: { type: "spring", stiffness: 320, damping: 32 }, // Sheet
  detail: { type: "spring", bounce: 0.08, duration: 0.45 }, // Trade-Detail (time-defined)
  segment: { type: "spring", bounce: 0.18, duration: 0.45 }, // Segmented thumb (time-defined)
  layout: { type: "spring", stiffness: 380, damping: 34 }, // Ranking rows; NEW for dock-dot, dock-bg, lists
  hover: { type: "spring", stiffness: 260, damping: 22, mass: 0.8 }, // Hover-Pill
  toast: { type: "spring", stiffness: 400, damping: 30 }, // Toast island
  cards: { type: "spring", stiffness: 300, damping: 30 }, // Setup cards enter
  number: { type: "spring", stiffness: 140, damping: 40 }, // MotionNumber counter
  digit: { type: "spring", stiffness: 280, damping: 18, mass: 0.3 }, // RollingDigits
  dock: { type: "spring", mass: 0.1, stiffness: 150, damping: 12 }, // Dock magnification
  magnet: { type: "spring", stiffness: 26.7, damping: 4.1, mass: 0.2 }, // Magnetic
  tilt: { type: "spring", stiffness: 220, damping: 18 }, // Tilt
  reveal: { type: "spring", stiffness: 260, damping: 22 }, // SplitText
  burst: { type: "spring", stiffness: 400, damping: 25 }, // Conviction particles
  plus: { type: "spring", stiffness: 400, damping: 26 }, // "+" rotation
  bar: { type: "spring", stiffness: 200, damping: 26 }, // checklist bar in editor
  smooth: { type: "spring", stiffness: 158, damping: 25 }, // NEW: status changes, scenario box, page-x (Apple .smooth)
  tooltip: { type: "spring", stiffness: 500, damping: 40 }, // NEW: chart tooltip MotionValues
  pill: { type: "spring", stiffness: 224, damping: 30 }, // NEW: StatusPill dot ↔ pill (0.42 s response, critically damped, one spring per state)
  price: { type: "spring", stiffness: 260, damping: 34, mass: 0.6 }, // NEW: live price glide (odometer, live text), follows every trade
  candle: { type: "spring", stiffness: 420, damping: 42, mass: 0.5 }, // NEW: LiveCandle close glide (off on the live chart: the canvas jumps per print) + pulse overlay glide
  pop: { type: "spring", stiffness: 520, damping: 22, mass: 0.7 }, // NEW: check pop, icon bounce, badge pop
  enter: { type: "spring", stiffness: 240, damping: 30, mass: 0.9 }, // NEW: Reveal / list item enter
  // NEW: PageHost slide = spring.enter on a string transform keyframe pair, which Motion springs over 0…100; these rest
  // thresholds are 0.5 px / 2 px·s⁻¹ on the 16 px slide (PAGE_ENTER_X), so it settles in ≈ 0.42 s, not ≈ 0.55 s
  pageEnter: { type: "spring", stiffness: 240, damping: 30, mass: 0.9, restDelta: 3.125, restSpeed: 12.5 },
  island: { type: "spring", stiffness: 400, damping: 30 }, // NEW: dynamic-island size morph
} as const satisfies Record<string, Transition>;

export const ease = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  ios: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

export const tween = {
  page: { duration: 0.35, ease: ease.out },
  collapse: { duration: 0.32, ease: ease.out },
  gauge: { duration: 1.1, ease: ease.out },
  bar: { duration: 0.8, ease: ease.out },
  fade: { duration: 0.2, ease: "easeOut" },
  exit: { duration: 0.12, ease: "linear" }, // exit is always shorter than enter
  sheetIos: { duration: 0.5, ease: ease.ios }, // NEW: mobile bottom sheet without layoutId
  body: { delay: 0.12, duration: 0.25, ease: ease.out }, // dialog body
  libDefault: { duration: 0.45, ease: [0.4, 0, 0.1, 1] as [number, number, number, number] },
  crossfade: { duration: 0.2, ease: "easeOut" }, // NEW: opacity crossfades (tone layers)
  verdict: { duration: 0.5, delay: 0.15, ease: ease.out },
  cardHover: { duration: 0.5, ease: ease.out }, // CSS, not Motion
  chartIn: { duration: 0.55, ease: ease.out }, // chart mount entrance
  sheetBody: { duration: 0.3, ease: ease.out }, // NEW: sheet body after onLayoutAnimationComplete (Bundle Nhe 0.3 s)
  check: { duration: 0.25, ease: "easeOut" }, // NEW: CheckboxRow pathLength (Bundle Ff 0.25 s)
  checkToast: { duration: 0.35, delay: 0.15, ease: "easeOut" }, // NEW: toast check-mark pathLength (Bundle 0.35 s delay 0.15)
  toastExit: { duration: 0.22, ease: "easeOut" }, // NEW: toast island exit (Bundle 0.22 s)
  hoverPill: { duration: 0.15, ease: "easeOut" }, // NEW: HoverPill opacity in/out (Bundle Rg 0.15 s)
  shimmer: { delay: 0.7, duration: 1.1, ease: "easeInOut" }, // NEW: SplitText shimmer sweep (Bundle p2)
  tooltipIn: { duration: 0.2, ease: "easeOut" }, // NEW: dock tooltip (Bundle Kw 0.2 s)
  beam: { duration: 9, ease: "linear", repeat: Infinity }, // NEW: BorderBeam loop (Bundle a2 default 9 s)
  skeleton: { duration: 1.6, ease: "linear", repeat: Infinity }, // NEW: Skeleton shimmer (CSS keyframes shimmer-x, 1.6 s)
  reveal: { duration: 0.45, ease: ease.out }, // NEW: blur-fade reveal (opacity/filter)
  flash: { duration: 0.7, ease: ease.out }, // NEW: value flash decay (up/down tint)
  draw: { duration: 1.1, ease: ease.out }, // NEW: line/sparkline/equity draw-in (clip-path / pathLength)
  ping: { duration: 1.6, ease: "easeOut", repeat: Infinity }, // NEW: live ping ring loop (only where a ring is explicitly wanted forever)
  pingFew: { duration: 1.6, ease: "easeOut", repeat: 2 }, // NEW: a ring that pings 3× when it appears, then rests (no endless loop at idle)
  shake: { duration: 0.35, ease: "easeInOut" }, // NEW: invalid field / error shake (x keyframes)
  ripple: { duration: 0.55, ease: ease.out }, // NEW: press ripple
  hold: { duration: 1.2, ease: "linear" }, // NEW: hold-to-confirm fill
  shimmerText: { duration: 2, ease: "linear", repeat: Infinity }, // NEW: text shimmer sweep loop
  burst: { duration: 1.2, ease: ease.out }, // NEW: confetti particle life
  toastText: { duration: 0.2, ease: "easeOut", delay: 0.12 }, // NEW: toast island text fade (= tween.fade one beat in); the win value starts rolling on the same delay
  debounce: { duration: 0.15, ease: "linear" }, // NEW: search debounce made visible (hairline fill); its duration IS the debounce (SEARCH_DEBOUNCE_MS)
} as const satisfies Record<string, Transition>;

export const stagger = {
  rows: 0.02,
  cards: 0.03,
  letters: 0.035,
  particles: 0.03,
  max: 12,
  sections: 0.04,
  words: 0.03,
  reveal: 0.04,
  lead: 0.12, // NEW: beat between a surface's reveal and its content starting (bar fills, Hochrechnung rows, bar/counter pairs)
  insert: 0.2, // NEW: rows inserted into a shown list wait this long (≈ spring.layout 90 % settled), so siblings make room first
} as const;

/**
 * NEW: dwell times (s) – how long a transient state stays before it reverts. They drive timers, not transitions
 * (`setTimeout(…, dwell.done * 1000)`).
 */
export const dwell = {
  done: 1.2, // a finished settings action keeps its drawn ✓ before going back to idle (save, export, refresh)
  holdCheck: 0.9, // HoldButton shows its ✓ after a completed hold
  armed: 4, // HoldButton's assistive-tech fallback waits this long for the confirming second activation
  heroFlicker: 4, // HeroBackdrop ambient flicker runs this long after mount / the last pointer activity on the hero, then the canvas rests (perf-05)
  scrollSettle: 0.15, // scroll gate (`scrollGate.ts`): hover tracking stays off until this long after the last scroll event
} as const;

/** NEW: imperative dot / glyph effects – exponential approaches and step rates, not Motion transitions. */
export const fxTiming = {
  phosphorRise: 0.04, // s – DotMatrix cell time constant towards brighter (fast rise)
  phosphorFall: 0.12, // s – … towards darker (slow trailing fall)
  matrixFps: 12, // dot-matrix step rate: DotMatrix frame player default and the HeroBackdrop ambient flicker
  fieldEase: 0.45, // HeroBackdrop per-step phosphor easing of a dot towards its target brightness
  scrambleReroll: 0.033, // s – TextScramble glyph re-roll (~30 fps)
  scrambleBase: 0.25, // s – TextScramble duration = base + length · stagger.letters …
  scrambleMin: 0.35, // s – … clamped to [min, max]
  scrambleMax: 0.8,
  liveFlashGap: 0.5, // s – live price / book washes (odometer, header ticker, Bid/Ask, chart pulse tint): minimum gap between two flashes, direction flips included
} as const;

/** NEW: gesture distances / speeds (px, px·s⁻¹). */
export const gesture = {
  toastSwipe: 80, // drag-x past this dismisses the toast island …
  toastFlick: 500, // … or a flick faster than this
  toastFling: 360, // a swiped toast flies out this far (exit timing: tween.toastExit)
} as const;

/** Border radii that every `layout`/`layoutId` element must set via `style`, never only via class. */
export const radius = {
  card: 16,
  dialog: 28,
  sheet: 28,
  pill: 9999,
  input: 12,
  hover: 12, // NEW: HoverPill (rounded-xl)
  thumb: 8, // NEW: Segmented thumb (rounded-lg)
  toastStart: 22, // NEW: toast island collapsed (declared exception, see Toast.tsx)
  toastEnd: 25, // NEW: toast island expanded
  fab: 999, // NEW: FAB disc (`new-trade` source)
} as const;

/*
 * CSS mirrors (src/styles/tokens.css cannot import TS – keep these in sync by hand):
 * - `.fx-strike` 0.32 s ease.out = tween.collapse · `.fx-pop` 0.2 s ease-out / 0.12 s linear = tween.tooltipIn / tween.exit
 * - `fx-ping` 1.6 s ease-out × 3 = tween.pingFew · `fx-shimmer` 1.6 s linear = tween.skeleton · `fx-spin` 9 s = tween.beam
 * - `.fx-ants` 0.9 s per dash period (CSS only, `--fx-ants-speed`) · dock tooltip `duration-200 ease-out` = tween.tooltipIn
 */
