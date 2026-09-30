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
} as const satisfies Record<string, Transition>;

export const stagger = { rows: 0.02, cards: 0.03, letters: 0.035, particles: 0.03, max: 12 } as const;

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
