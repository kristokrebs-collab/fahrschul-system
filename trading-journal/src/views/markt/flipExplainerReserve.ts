/**
 * The place of the "Was ist ein Flip?" explainer while its chunk loads (the Top-Trader card shows this box in the finished size, so
 * nothing below it moves): a plain `min-height` per breakpoint from the measured panel (mobile 390, tablet 820, desktop 1440), set
 * with the app's own reserve utilities (`reserveStyle` + `RESERVE_CLASS` of `@/primitives/Reserve`) – no new CSS.
 * The numbers are px of the finished panel; `tests/e2e/flip-explainer.spec.ts` measures them again.
 */
export const FLIP_RESERVE_PX = { base: 638, sm: 447, lg: 411 } as const;
