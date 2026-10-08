/**
 * `@/domain/lage` — the "Lage-Ampel" (user decision 23, 2026-10-08): automatic higher-timeframe context for the
 * falling-knife protection, validated on BTC history (…/scratchpad/merge/knife-lab/REPORT.md). Pure, no I/O.
 *
 * ```ts
 * const lage = computeLage(daily, h4, livePrice, Date.now(), { h1 });   // Lage (state red | amber | green | none)
 * const gate = lageGate(lage, lageSettingsOf(settings.signals));        // { counts, blocked, label }
 * ```
 * Live data: `useLage()` / `getLage()` in `@/market` (src/market/lage.ts). UI: `views/overview/LagePanel.tsx`,
 * settings `views/settings/LageCard.tsx` (`settings.signals.lage`).
 */
export * from "./types";
export {
  computeLage,
  lageBase,
  lageAt,
  lageKey,
  metSigns,
  closedBars,
  nextDailyClose,
  DAY_MS,
  H4_MS,
  H1_MS,
  LAGE_MIN_DAILY,
  LAGE_MIN_H4,
  LAGE_STRUCTURE_BARS,
  LAGE_CONFIRM_DAYS,
  LAGE_STRUCTURE,
  NEW_LOW_BARS,
  type LageBase,
} from "./compute";
export { lageGate, lageSettingsOf, withLageSettings, toLageSnapshot, parseLageSnapshot, lageSnapshotText, DEFAULT_LAGE_SETTINGS, LAGE_MODES, LAGE_MODE_TEXT } from "./gate";
export * from "./copy";
