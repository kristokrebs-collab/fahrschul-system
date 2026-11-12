# `src/intro` – "das Journal baut sich auf"

The opening intro (~5 s at 120 Hz, skippable). `IntroHost` is mounted once in `App`; the stage is a portal to `body`
outside the app root, the build beat runs on the real overview DOM (no screenshots).

## When it plays
- Autoplay (`introBoot.canAutoplay`): once per session (sessionStorage `tj2-intro`, set when it starts; the e2e / perf
  harness pre-sets it), only in a real browser (not jsdom), not under reduced motion, not when switched off in the
  settings (localStorage `tj2-ui-intro` = `"off"`, `IntroPref`), and only when the app opens on the overview (a deep
  link into another page skips it and leaves the flag unset).
- `replayIntro()` (header logo, Settings "Intro jetzt abspielen"): always navigates to the overview and scrolls to the
  top; plays when motion is allowed. Ignored while an intro runs.
- Skip: the `Überspringen` pill, Esc / Enter / Space or a click on the stage (stage); Esc during the build → every cell
  settles in 260 ms. The pill fades out when the build starts (it would float over the landing cards).

## Phases (`introStore.ts`)
`off` → `stage` (overlay covers and takes every pointer, `#root` `aria-hidden` + `data-intro-covered` – NOT `inert`:
releasing `inert` restyled the whole app in the first frames of the build –, wheel/touch/nav keys held, Tab stays on the
pill, focus on the overlay) → `build` (cells fly, header
slides down, dock rises) → `done` (focus returns to where it was). First-view effects wait for `useIntroLanded()`
(`IntroCell` provides it per cell) / `useIntroGate()`; `useIntroFlown()` lets a flown cell skip its scroll reveal.

## Timeline (`introConfig.ts`, `director.ts` – one rAF loop, pure function of elapsed time)
| ms | beat | pack effect |
| --- | --- | --- |
| 0–1870 | dot grid, signal dot + pings, rotating marker in the "O", wordmark decodes from its first glyph roll | product-launch-hero, text-ascii-cascade |
| 560–2100 | "Disziplin schlägt Gefühl." pixel fill (red ember), data line typed with the real counts | pixel-text-fill, text-animate |
| 1880–3470 | rows part, reel window with the user's KPIs (hard cuts), scaleY collapse, wordmark glides to the centre | reel-collage |
| 3470–4330 | camera dives into the "O" (canvas, preroll .14 of the measured zoom curve), the app shows through the hole | glyph-portal |
| 3950–~5100 | overview cells: slanted compact deck → their slots (orbit curve, reading-order stagger), end at `transform: none` | slanted-spread-hero, cinematic-orbit-hero |

Geometry is measured once from the overlay box (not `innerWidth`: classic scrollbars) and a baseline probe in the
first glyph cell, so the canvas wordmark is registered on the DOM one it replaces. Only transform / opacity are
written to the app (`flight.ts`); `appPose` scales the grid 1.06 → 1 (no blur on the page-tall grid).
