/**
 * Build edition and delivery target – compile-time constants (Vite `define`, see `vite.config.ts` and
 * `vite.single.config.ts`):
 *
 * | build                                   | `__TJ_EDITION__` | `__TJ_TARGET__` | output                          |
 * |-----------------------------------------|------------------|-----------------|---------------------------------|
 * | `npm run build` (Netlify root), dev, tests | `personal`     | `web`           | `dist/`                         |
 * | `npm run build:share` (Netlify `/teilen/`) | `share`        | `web`           | `dist/teilen/`                  |
 * | `npm run build:single`                  | both             | `file`          | `release/trade-journal-*.html`  |
 *
 * - `personal` = the user's journal: current defaults (setups, levels, capital, copy), storage keys `tj2-*`.
 * - `share`    = neutral edition to give away: empty journal, neutral setups, no personal strings (the build fails
 *   when one leaks, `scripts/privacyGuard.ts`), its own storage namespace `tj2share-*` so it never reads or writes
 *   the personal `tj2-*` data on the same origin / browser.
 * `EDITION === "share" ? a : b` folds at build time; a pure-literal data module that is only reachable through the
 * unused branch is tree-shaken (verified with rolldown 1.2 / Vite 8.3).
 */
declare const __TJ_EDITION__: "personal" | "share";
declare const __TJ_TARGET__: "web" | "file";

export type Edition = "personal" | "share";
export type BuildTarget = "web" | "file";

export const EDITION: Edition = __TJ_EDITION__;
export const BUILD_TARGET: BuildTarget = __TJ_TARGET__;
/** The neutral "zum Teilen" edition (Netlify `/teilen/` or the share single file). */
export const IS_SHARE: boolean = EDITION === "share";
/** One of the two single-file builds (opened from disk, no Netlify function, no claude.ai runtime). */
export const IS_FILE_BUILD: boolean = BUILD_TARGET === "file";

/** Runtime check: the page itself was opened from disk (`file:` or an Android `content:` URL), whatever the build. */
export function isFileProtocol(): boolean {
  return typeof location !== "undefined" && (location.protocol === "file:" || location.protocol === "content:");
}
