/**
 * The Showroom switch (Paket S) – a compile-time constant like `__TJ_EDITION__` (Vite `define`, `vite.config.ts`):
 *
 * | build                                            | `__TJ_SHOWROOM__` |
 * |--------------------------------------------------|-------------------|
 * | `npm run build` (Netlify production / branches), dev, tests, share, single file | `false` |
 * | `npm run build:showroom` (local), Netlify `deploy-preview` (`npm run build:showroom:deploy`) | `true`  |
 *
 * `if (__TJ_SHOWROOM__) …` folds at build time (the use sites in `main.tsx` and `App.tsx` name the define itself – an imported constant is not folded before the module graph is built, and the chunks stayed in the output): the lazy chunks behind it (mock backend, banner, panel) are never emitted in a build without the flag
 * (`tests/unit/showroom.bundle.test.ts` scans the production build for every marker).
 */
export const SHOWROOM: boolean = __TJ_SHOWROOM__;
