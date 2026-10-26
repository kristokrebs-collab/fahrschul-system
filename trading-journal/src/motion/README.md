# `src/motion` – motion system

Apple-grade motion layer for the Trade Journal, tuned for 120 Hz. Everything animates only `transform`, `opacity`,
`filter` and `clip-path`; size/position changes go through `layout`/`layoutId`; every `layout` element sets
`borderRadius` via `style` from `radius`; every spring/tween/stagger/dwell comes from `tokens.ts` (no local timing
constants). Every effect is reduced-motion safe (`useReducedFx()`), and live values render as MotionValue children
(zero React renders per tick). Import from `@/motion` (barrel) or the individual files.

Declared exceptions (Plan 3.2 rule 1):
- `// motion-exception: toast-island` (`primitives/Toast.tsx`) – the island's 44×44 → auto×50 size morph (bundle).
- `// motion-exception: text-shimmer` (`TextShimmer.tsx`) – `background-position` sweep on a short label (a paint, on a
  native WAAPI loop that pauses off-screen).

- `AutoHeight` (`views/trades/AutoHeight.tsx`) and `Collapse` (Expander) – the height of ONE box springs so the
  content below is pushed smoothly instead of jumping (no-overlap rule 5); the moving content itself only translates.
- `MorphSelect` (`pulse/MorphSelect.tsx`) – the pack's 140 ms ease-out radius ease (field 12 → panel 16 px) at open,
  on the floating panel only.
- Intro stage (`src/intro/portal.ts`) – the glyph-portal camera is a 2D canvas redraw per frame (the pack's technique:
  the wordmark stays a crisp vector at 30×+); one clear + three fills, no layout reads.
- `// motion-exception: glyph-zoom` (`pulse/GlyphZoom.tsx`, P01) – the same canvas technique for the reusable dive: one
  clear, one rect, one text fill per frame while the dive moves; asleep at rest, off screen and in hidden tabs.
- `// motion-exception: radar-sweep` (`fx/RadarSweep.tsx`, P01) – a loop BY DESIGN: the radar wedge turns / the scan band
  passes (`tween.scan`, 2.4 s linear ∞, CSS `fx-spin` / `fx-scan`, transform only) for exactly as long as a scan runs
  (`active`), paused off screen (`[data-offscreen]`) – never at idle. Reduced motion: a still wedge.
- `// motion-exception: liquid-gauge` (`fx/LiquidGauge.tsx`, P01) – a JS frame loop (not a CSS / Motion tween) moves the
  liquid (`translateY`) and its wave crest (`translateX` + `scaleY`) only while the level / wave moves; it sleeps at rest
  and jumps to the rest state off screen. Listed because it is a hand-rolled loop – it writes transforms only.

The dock no longer animates layout (transform-only magnification, see `src/app/README.md`), so the former
`dock-magnify` exception is gone.

## `tokens.ts`

`spring`, `ease`, `tween`, `stagger`, `radius`, plus the NEW groups `dwell`, `fxTiming` and `gesture`. Values are
seconds unless noted. Additions over the bundle set:

| token | value | used by |
|---|---|---|
| `spring.pill` | `{stiffness 224, damping 30}` (0.42 s, critically damped) | `StatusPill` layout |
| `spring.price` | `{260, 34, mass .6}` | odometer (`RollingDigits source`), `LiveText smooth`, ticker / mark glides (`useGlide`) |
| `spring.candle` | `{420, 42, mass .5}` | forming-candle close glide (`chart/liveCandle.ts`) |
| `spring.pop` | `{520, 22, mass .7}` | check pop, icon hop, badge / `+n` pop, signal dot, needle, `Folgen` pill |
| `spring.enter` | `{240, 30, mass .9}` | `Reveal` / `StaggerItem` y, list inserts, PageSwitch x/scale, page-header words |
| `spring.pageEnter` | `spring.enter` + `restDelta 3.125, restSpeed 12.5` | `PageHost` string-keyframe slide (Motion springs string keyframes over 0…100: = 0.5 px / 2 px·s⁻¹ on the 16 px slide, settles ≈ 0.42 s) |
| `spring.island` | `{400, 30}` | dynamic-island size morphs (trades count pill) |
| `tween.sheetBody` | `.3 s ease.out` | `Sheet` body after the morph |
| `tween.check` / `tween.checkToast` | `.25 s` / `.35 s delay .15` | drawn checks, toast check mark |
| `tween.toastExit` / `tween.toastText` | `.22 s` / `tween.fade` + `delay .12` | toast island exit / text fade + win-value roll start |
| `tween.hoverPill` | `.15 s` | hover pills / row highlights (opacity) |
| `tween.shimmer` / `tween.shimmerText` | `delay .7, 1.1 s` / `2 s linear ∞` | `SplitText` sweep / `TextShimmer` band |
| `tween.tooltipIn` | `.2 s` | dock tooltip (CSS mirror) |
| `tween.beam` / `tween.skeleton` | `9 s` / `1.6 s` linear ∞ | `BorderBeam` (CSS `fx-spin`), skeleton shimmer (CSS `fx-shimmer`) |
| `tween.reveal` | `.45 s ease.out` | blur-fade reveals (opacity / filter), clip wipes |
| `tween.flash` | `.7 s ease.out` | value flash decay, halos, washes |
| `tween.draw` | `1.1 s ease.out` | line / sparkline / equity draw-in, verdict band sweep |
| `tween.ping` / `tween.pingFew` / `tween.ripple` | `1.6 s ∞` / `1.6 s × 3` / `.55 s` | chart price-pulse rings (only while printing) / every other at-rest ring: `PulseDot`, `Sparkline`, `.fx-ping`, heartbeat, FAB (finite: an idle page goes fully at rest) / press ripple, trade pings |
| `tween.shake` / `tween.hold` | `.35 s` / `1.2 s linear` | invalid-field shake / hold-to-confirm fill |
| `tween.burst` | `1.2 s ease.out` | confetti life, `BorderBeam fire` lap, toast win glow |
| `tween.debounce` | `.15 s linear` | the trades search hairline; its duration IS the debounce (`SEARCH_DEBOUNCE_MS`) |
| `stagger.sections / words / reveal / lead` | `.04 / .03 / .04 / .12` | dialog sections, title words, reveal cascade, beat between a surface's reveal and its content (bars, Hochrechnung rows) |
| `dwell.done / holdCheck / armed` | `1.2 / .9 / 4` | timers: settings action ✓ (`DONE_HOLD_MS`), `HoldButton` ✓, AT-fallback armed window |
| `dwell.heroFlicker` | `4` | `HeroBackdrop` flicker sleeps this long after mount / the last pointer activity on the hero |
| `fxTiming.*` | phosphor rise/fall `.04/.12`, `matrixFps 12`, `fieldEase .45`, scramble `reroll .033 · base .25 · min .35 · max .8` | `DotMatrix`, `HeroBackdrop` (`heroField.ts`), `TextScramble` |
| `gesture.toastSwipe / toastFlick / toastFling` | `80 px / 500 px·s⁻¹ / 360 px` | toast island drag dismiss + fling-out |
| `radius.hover 12`, `radius.thumb 8`, `radius.toastStart 22`, `radius.toastEnd 25`, `radius.fab 22` (h/2 of the 44 px disc) | | `HoverPill`, `Segmented`, `Toast`, FAB |
| `spring.liquid` (P01) | `{90, 12}` (ζ ≈ .63, one small overshoot) | `LiquidGauge` level |
| `spring.deal` (P01) | `{170, 18, mass .9}` (ζ ≈ .73, ≈ 3.6 % overshoot, ≈ .45 s) | `CardSpread` deal, `HeatGridReveal` cell pop |
| `tween.sweep` (P01) | `.9 s ease.out` | `SpotlightSweep` (one pass) |
| `tween.scan` (P01) | `2.4 s linear ∞` – **only while a scan runs** (exception `radar-sweep`) | `RadarSweep` (CSS mirror `.fx-radar__sweep` / `.fx-scan__band`) |
| `tween.glow` (P01) | `1.6 s easeInOut × 3` | `GlowBreak` halo breathing, `EquityDraw` head after the draw |
| `tween.streak` / `tween.heat` / `tween.cascade` / `tween.dissolve` / `tween.wave` (P01) | `.9 s` / `.36 s` / `1.2 s` (ease.out) / `.48 s linear` / `1.4 s` | `BreakoutStreak` particle life / `HeatGridReveal` cell fade / `NumberCascade` / `DissolveOut` / `LiquidGauge` wave decay (τ = wave / 4) |
| `stagger.heat` / `stagger.heatMax` / `stagger.streak` / `stagger.deal` (P01) | `.028` per ring, capped `.42` / `.018` / `.05` | `HeatGridReveal` / `BreakoutStreak` launches / `CardSpread` deal |
| `pressScale.small / icon / control / label / surface` | `.88 / .92 / .96 / .97 / .985` | **one press squeeze per target size** (`whileTap { scale }` on `spring.press`; the smaller the target the firmer): `Expander` (24 px) / Header + Dock icons / `Button`, `usePressable` default / `Segmented` label, toast island / `MorphCard` |
| `fxTiming.cascadeReroll` / `fxTiming.dissolveFps` (P01) | `.045 s` / `20` steps·s⁻¹ | `NumberCascade` rain / `DissolveOut` clip steps |

CSS mirrors (`src/styles/tokens.css` cannot import TS; listed at the end of `tokens.ts`): `.fx-strike` = `tween.collapse`,
`.fx-pop` = `tween.tooltipIn` / `tween.exit`, `fx-ping` = `tween.pingFew` (3 iterations), `fx-shimmer` = `tween.skeleton`, `fx-spin` = `tween.beam`;
`.fx-ants` (0.9 s per period) is CSS-only; `.fx-radar__sweep` / `.fx-scan__band` / `.fx-radar__blip` = `tween.scan` (2.4 s linear ∞, only
under `[data-scanning]:not([data-offscreen])`).

Token ownership: only P01 (the motion package) edits `tokens.ts` / `tokens.css`; feature packages ask for new values.

## Components

### `MotionRoot`
```tsx
<MotionRoot>{app}</MotionRoot>
// = <MotionConfig reducedMotion="user" transition={spring.smooth}>…</MotionConfig>   (no layout group)
```
`layoutId`s are global and de-duplicated by naming/conditions (see contracts): the projection tree has ONE root for the
document, which holds the `layoutId` stacks – no `LayoutGroup` is needed for a shared morph.

Layout groups (`NoLayoutCascade.tsx`, contract tests `tests/unit/motion.cascade.test.tsx`): a `LayoutGroup` adds a shared
projection group (the `willUpdate` of any member snapshots EVERY member, and all of them are measured again after the
commit) and a `forceRender` (called by an `AnimatePresence` once all its exits finished; re-renders every motion
component under the group). App-wide, both scaled with the whole app: a hover pill, a status pill relabelling, the dock
indicator following a page switch measured all ≈ 130 `layout` / `layoutId` nodes of the Übersicht, and every finished
exit re-rendered ≈ 1,700 motion components. So the root has NO group. Morphs keep working without one: a new lead takes
a fresh snapshot of the previous lead (`NodeStack.promote`), a `layoutId` node snapshots itself on unmount, and every
morph source flips its own `layoutDependency` / unmounts / exits in the commit that mounts its target. Without a group a
`layout` node that does not re-render does not FLIP when something else moves it – it moves with its container (cards
and pages jump anyway; FLIPping inside them only made the node lag behind).
- `<LayoutCascade>` – a scoped `LayoutGroup` (own projection group + own `forceRender`, no id): for subtrees whose nodes
  must glide together – sheet and dialog bodies (`Sheet`, `MorphDialogProvider`: the panel resizes with its form, a
  discard strip closes up) and the settings page (`PageHost` `cascade={["settings"]}`: `Reorder` rules glide up after a
  "Regel entfernen?" strip leaves).
- `<NoLayoutCascade>` – drops the nearest group's `forceRender` (keeps its projection group); a no-op outside a
  `LayoutCascade`. Inside one, wrap presences whose exits never move an in-flow sibling (`popLayout` swaps such as
  `TextRoll`, fixed overlays, `absolute` rings and pills).

### `PageSwitch`
`{ index; pageKey?; children; onTransitioning?; rememberScroll? (true); className? }` – no longer used by the shell (see `PageHost`
in `src/app`), kept in the barrel for other uses.
- No `layout` anywhere: the container is a plain `relative` div.
- Enter `{x: dir·16, scale .985, blur 4px, opacity 0}` – x/scale on `spring.enter`, opacity/blur on `tween.page`, blur off under
  reduced motion, ends at `filter: none`. Exit `{x: −dir·12, opacity 0}` on `tween.exit`. `transitioning` clears after ≈ 0.45 s.

### `MorphDialogProvider` · `useMorphDialog` · `MorphCard` · `MorphTitle`
Card → 620 px dialog morph (Plan 2.5 "Morph-Dialog"), portal-less, with focus trap, scroll lock, isolated siblings (`a11y.ts`), Escape/backdrop close.
- `MorphDialogProvider` – mount once at app level. Overlay = ONE fixed `z-[70]` wrapper: it is the backdrop-click target and is never
  isolated; the `bg-ink-950/75` dim layer is decorative (`pointer-events-none`). Panel `layoutId="morph-{id}"` `layoutRoot`
  `borderRadius 28` on `spring.morph`; sticky head `motion.h2 layoutId="morph-title-{id}"`; the body is a stagger parent (`StaggerItem`
  sections). The big drop shadow sits on an unscaled sibling and fades in (`tween.fade`) after the morph, so the per-frame radius
  correction repaints the panel alone.
- State lives in an external store read with `useSyncExternalStore` (one synchronous batch per change, so a source's
  `layoutDependency` flips in the commit that mounts / relegates the panel). `useMorphSource(id)` → `{ isOpen, settled,
  closing, closeTempo, show, returned }` re-renders only when THIS id changes (`MorphCard`, `MorphTitle`); `useMorphDialog()` is
  tracked – a reader re-renders only when a state field it read changed (`const { close } = useMorphDialog()` never does).
- `useMorphDialog()` → `{ open, settled, closing, closeTempo, show({ id, title, body, className? }), close(), returned(id), registerGuard }`;
  `className` sizes the column. `close()` is the programmatic close (after saving, "Verwerfen") and is never guarded.
- Swipe to dismiss (iOS 18 zoom, `useSwipeDismiss` mode "zoom", touch / pen once the open morph has settled): handle = the sticky head
  `[data-dialog-handle]` (grabber pill on coarse pointers, `useTouchMoveGuard`); the column follows 1:1 and shrinks to 0.88 while the dim
  lifts; a flick closes with `closeTempo` = the release tempo and the source `MorphCard` zooms back on
  `contextSpringAt(spring.morph, closeTempo)` (the token itself for every other close).
- `useMorphDialogGuard(guard, onAttempt)` (a dialog body with input, e.g. `HyblockForm`): while `guard()` is true, Escape, backdrop, × and
  swipe call `onAttempt` (show "Änderungen verwerfen?") instead of closing; the swipe is resisted with a rubber band and never commits.
- Hand-back: once the source reports `returned(id)` after a close, the leaving panel is kept at opacity 0 with
  `pointer-events: none` (two MotionValues on the wrapper / panel) — Motion stops projecting it when the card's reverse
  morph ends and it would otherwise snap back to its full box while the other exits run.
- `MorphCard { id; title; body; children; className?; as?; borderRadius? (16); dialogClassName?; motionProps? }` – the source,
  `layoutDependency={isOpen}`; hidden (`visibility`) once the morph settled, visible again on close; `whileTap` scale .985 on
  `spring.press` (off while its dialog is open); reports `returned(id)` when its reverse morph ends or it unmounts.
- `MorphTitle { id; as?; className?; layoutDependency?; children }` – `layoutId="morph-title-{id}" layout="position"`, measured only
  when its dialog opens/closes (default `layoutDependency` = this card's dialog open), so value/hover re-renders never force a layout read.

### `Sheet`
`{ open; onClose; title; size?: "md"|"lg"; layoutId?; headerExtra?; footer?; children; className?; onOpened?; handoff?; dismissGuard?;
onDismissAttempt? }` – overlay `z-[60]`, panel `role="dialog"` `layoutRoot` `borderRadius 28`, body `layoutScroll`, focus trap, scroll
lock, isolated outside (`a11y.ts`), Escape. With `layoutId` (`new-trade`, `setup-card-{id}`) the panel morphs on `spring.sheet`; without, desktop
`{y 40, scale .98}` on `spring.sheet`, mobile `y 100%` on `tween.sheetIos`. The body is a stagger parent (`StaggerItem`). A sliding
sheet keeps its shadow on the panel (it only moves by transform). The source must be `visibility:hidden` while open. The footer pads by
`var(--safe-bottom, env(safe-area-inset-bottom))`, so it clears a browser bar laid over the page bottom.
- Swipe to dismiss (`useSwipeDismiss`, touch / pen at every width): handle = the header row + grabber `[data-sheet-handle]`
  (`useTouchMoveGuard`); the opaque COLUMN moves (never the `layoutId` panel); a flick leaves on the release velocity with its contents
  inside (`<AnimatePresence custom={flung}>` + `flingExit`), a slow drag springs back.
- Unsaved input: `dismissGuard={() => dirty}` + `onDismissAttempt(via)` (`via` = `escape|backdrop|close|swipe`) – Escape, backdrop, ✕ and
  swipe ask instead of closing (swipe resisted). Omitted: the sheet guards itself once any field inside received input and asks with its
  own inline strip (`SHEET_DISCARD_COPY`); `false` opts out (ImportDialog).
- `handoff { backdropFrom, enterDelay }`: detail → editor without the page brightening in between.

### `Stagger.tsx` – `StaggerItem` · `sectionDelay` · `withSectionStagger`
`<StaggerItem as="div|section|li">` fades up from `{opacity 0, y 8, blur 4px}` (no blur under `html[data-safe-fx]`, `safeFx.ts`)
(`tween.reveal`, y on `spring.enter`) and ends at
`filter:none` / `transform:none`. The bodies of `MorphDialogProvider` and `Sheet` are stagger parents: sections cascade
`stagger.sections` apart, capped at `stagger.max` (`sectionDelay(base)` / `withSectionStagger(t, base)`); labels `STAGGER_HIDDEN` /
`STAGGER_SHOWN`. Outside a parent or under reduced motion it renders statically. Items start at opacity 0 in jsdom until the animation
runs: tests `waitFor` before `toBeVisible`.

### `Reveal` · `RevealGroup` / `RevealItem`
Blur-fade entrance `{opacity 0, y 14, blur 6px}` (`REVEAL_FROM`; under `html[data-safe-fx]` `REVEAL_FROM_SAFE` without the blur –
a blur over a card revealed while the page scrolls is the tablet compositor's heaviest work) → rest, once, at the reveal point (`revealReached`, `inView.ts`: 15 % of the element in view with the viewport shrunk by 50 px – OR a fifth of that viewport for an element too tall for 15 % ever to fit, ≥ ≈ 5 000 px on a phone; before, such a card stayed at opacity 0 for ever); one shared observer for all reveals (`useRevealSeen` / `observeReveal`); stagger
`min(i, stagger.max)·stagger.reveal`; ends at `transform:none` / `filter:none` (transitionEnd), no x offset. Reduced motion or no
`IntersectionObserver`: `initial={false}`, static. The group is driven by `animate`, so items mounted later also enter.
`Reveal defer={ReserveHeight}`: a cell below the first screenful of a long page skips style/layout/paint while far off screen (`content-visibility: auto`,
the Übersicht's pattern: `DEFER_CLASS` = 12 px room above/below for the hover lift, layout-neutral; assumed size = `contain-intrinsic-block-size: auto <end size>`
per breakpoint, `INTRINSIC_CLASS`) and is marked `data-defer`; the page calls `useIdlePrerender(ref)` (`@/primitives/idlePrerender`) so each cell is rendered once in idle
time instead of inside the first scroll past it. Pair with `Reserve` (`late`) when the card's content arrives late. Used by the Analyse page.

**Containing-block rule:** a transformed/filtered ancestor becomes the containing block of `position:fixed` descendants. Never wrap
ancestors of fixed ghosts (the ChartCard body with its marker ghost, the trades table ghost) in `Reveal` or anything else that keeps a
transform/filter; everything here therefore ends at `none`. Cards that run their own first-view draw (EquityChart, MonthlyBars,
Sparkline) only get opacity/translate reveals.

### `MotionNumber` · `useAnimatedNumber` · `formatNumber` · `toneOf`
`{ value?; source?; decimals?; prefix?; suffix?; signed?; format?; tone?: "auto"|"none"; gate?; flash?; countOnReveal?; revealKey?; transition?; className?; aria-label? }`
- Text via `useTransform` rendered as a MotionValue child (zero re-renders), de-DE, `−`, `tabular-nums`.
- `tone="auto"`: three stacked spans crossfaded on `tween.crossfade`; the sign listener only exists for `auto`, so per-frame sources
  (ring centre, bar counters) cost nothing with `tone="none"`.
- `flash`: up-move win tint, down-move loss tint on `tween.flash` (two pre-rendered aria-hidden layers, opacity only; off under reduced motion).
- `countOnReveal`: holds 0 until first in view, then animates; later changes roll from the previous value; the label is always final.
  With `revealKey` it is session-once: a key that already counted (module-level set) shows its value at once on later mounts
  (Trades / Setups are not keep-alive, so their KPIs and setup tiles count only on the first visit).
- `gate`: animate only while visible – shared observer (`inView.ts`), refs only, no React commits while scrolling.

### `RollingDigits`
- `value` mode: per-column `spring.digit`, no roll on mount, updates faster than 4 Hz `jump()`.
- `source` mode: `<RollingDigits source={priceMv} decimals={1} decimalClassName="text-mute" formatLabel={n0} />` – rounded to the display
  grid and glided on ONE `spring.price`; columns derive a continuous carry position (`carryPosition(x, place)`): the lowest digit spins,
  higher digits roll in lock-step on a carry, every column rests exactly on a digit. Each column is a memoised 0–9–0 strip with one
  transform and its own layer. Velocity blur, compositor-only: a pre-blurred copy of the strip (constant `blur(1.25px)`, `data-fx="digit-blur"`)
  fades in over the sharp one with the column's speed (opacity only – animating the radius re-rasterised the strip ≈ 200× per 10 s);
  `blur={false}` disables it; off under reduced motion and Samsung-Internet-safe effects. Zero React renders per
  tick (only digit-count / sign changes re-render); the aria-label is written imperatively at most once per second.

### `StatusPill`
`{ tone; label?; expanded; ring?: number|RingCycle|null; spinning?; feed?; className?; title?; pingKey?; pingOn?; layoutKey? }`
- Dot (6 px) ↔ pill on ONE layout spring (`spring.pill`); `layoutDependency` = tone | expanded | ring | string label | `layoutKey`.
- `ring` accepts `RingCycle { endsAt, ms? }`: two rotating half-rings (transform only) run themselves – no per-second render; a number
  still shows that progress.
- `tone="live"` shows a heartbeat (`tween.pingFew`: 3 beats when it turns live, then rest; WAAPI); `pingKey` / `pingOn` (any MotionValue) fire bright pings ≤ 4/s (`tween.ripple`, pool of 3).
- Overflow is clipped only when expanded. Static under reduced motion; the cycle ring then steps every 5 s. `feed` → `layoutId="status-{feed}"`.

### Text: `TextShimmer` · `TextRoll` · `TextScramble` · `LiveText`
| component | what it does | tokens |
|---|---|---|
| `TextShimmer` | band sweep clipped to the text (`background-clip:text`), textContent unchanged; native WAAPI loop paused off-screen (declared exception). | `tween.shimmerText` |
| `TextRoll { text; mode?; direction? }` | label morph: shared letters glide (`layout="position"`, `layoutDependency=text`), others blur in/out; `mode="roll"`, labels > 24 chars always roll. The real label is an sr-only span, the visual layer uses `::before{content:attr(data-ch)}` – textContent and the accessible name are always exactly the label. A swap within `RAPID_SWAP_MS` (200 ms) of the previous one is instant (the roll in flight is dropped – never stacked labels); `tabular-nums`. | `spring.digit`, `tween.fade/exit/crossfade` |
| `TextScramble` | decode effect; the real text node stays (opacity 0 while decoding), an aria-hidden overlay shows the glyphs; zero React renders. | `stagger.letters`, `fxTiming.scramble*` |
| `LiveText { source; format?; smooth?; flash?; … }` | MotionValue as text, zero renders; a single `motion.span`, so single-element `getByText` contracts hold. `smooth` glides on `spring.price`. | `spring.price`, `tween.flash` |

### Live indicators: `ValueFlash` · `PulseDot` · `DotMatrix`
- Tick feedback (per-trade pings, up/down washes, `StatusPill` / `MotionNumber` pings and flashes) goes through `replay(el,
  frames, timing)` (`replay.ts`): ONE native WAAPI animation per layer, restarted on each tick (`cancelReplay` cuts it) – no
  Motion animation built per tick (that was ≈ 0.5–1 ms plus garbage each, several per second on a 40 Hz feed); jsdom falls
  back to Motion's `animate`. `PulseDot` pings only while on screen.
- `ValueFlash` / `useValueFlash` – up/down flash on pre-rendered `bg-win/15` / `bg-loss/15` layers (opacity only); reduced motion: 2 px underline. `tween.flash`.
- `PulseDot { tone?; size?; rings? 1|2; active?; ping?; label? }` – live dot with ping rings; `ping` MotionValue fires a per-trade
  ping ≤ 4 Hz; rings ping 3× (`tween.pingFew`) on start / re-entry, then rest; pause off-screen; aria-hidden unless `label`. `tween.pingFew/ripple/flash`.
- `DotMatrix` – LED matrix, zero React renders (imperative opacity writes in `frame.render`), useId ids, one glow layer, no aria-live.
  Presets `text` (5×7 digits, `- − + . , : % /`, upper-case `A–Z` (`I` 3 wide), `↑ ↓ ! ?` – lower case stays blank; the
  comfortable wrapper is `DotMatrixText` in `@/motion/fx`), loader, pulse, wave, snake, chevrons; `meter` = scrolling VU from a MotionValue (`signed`: buys up,
  sells down; stepped at `sampleMs`, written once per sample, no frame loop in between). Phosphor / step rate from `fxTiming`.

### Celebration: `Celebrate` · `celebrateFrom(el, { kind, tone })`
Fixed `z-[80] overflow-hidden pointer-events-none aria-hidden` confetti layer, mounted ONCE (in `App`, next to the toast island);
renders null until a burst is queued. Dots are white and win-green, plus one red dot for `kind:"record"`; reduced motion: ring only.
Store: `useUi.celebrate({x,y,tone,kind})` / `endCelebration(id)`, at most 3 bursts. `tween.burst/ripple/flash`, `spring.pop`.

### Controls: `HoldButton` · `HoldConfirm` · `Switch`
- `HoldButton { onConfirm; onRelease?; ref?; holdLabel?; armedLabel?; variant?; size?; duration?; fallback?; icon? }` – hold to confirm
  (fill on `tween.hold`, scale .97, early release springs back + shakes, completion flashes + draws a ✓ for `dwell.holdCheck`).
  Keyboard: hold Enter/Space. A detail-0 click (assistive tech) arms it and a second confirms within `dwell.armed` (`fallback`).
  `onRelease(completed)`: `true` after a completed hold, `false` for an early release and (with `fallback={false}`) an activation
  without a hold; cancels (leave, pointercancel, blur, Escape) never report. `ref` is the native button. The accessible name stays `children`.
- `HoldConfirm { onAsk; onConfirm; … }` + `useConfirmFocus(confirming)` – two-path destructive button: tap/click/quick key/AT →
  `onAsk` (inline confirmation), hold → act immediately. `useConfirmFocus` moves focus to the safe answer and back to the button.
  e2e: a Playwright `click()` is a short press (asks); a hold needs `mouse.down()` + ≈ 1.3 s or a held Enter.
- `Switch { checked; onCheckedChange; size?; tone? }` – `role="switch"` + `aria-checked` on a native button; elastic thumb (x spring
  with velocity stretch), whileTap squash. `spring.press`, `tween.crossfade`. `touch-hit`: a 44 × 44 tap area on coarse pointers
  (the track is 42 × 24) without a layout change.

### `clock.ts` – shared wall clock (`nowMv`)
One ref-counted timer for the whole app replaces per-card `useNow(1000)` state.
- `nowMv: MotionValue<number>` holds `Date.now()` and ticks `CLOCK_SLACK_MS` (4 ms) after every whole second – a self-aligning
  setTimeout chain that never drifts and re-aligns on `visibilitychange`. With no holder the timer stops.
- `useNowMv()` retains the clock while mounted (layout effect, so the first tick lands before paint); `retainClock()` → idempotent
  release is the non-hook variant; `clockHolders()` for diagnostics; `msToNextSecond(now)` the pure scheduling helper.
- Render countdowns and ages as MotionValue text in LEAF nodes, never as React state:
```tsx
const now = useNowMv();
const age = useTransform([now, priceReceivedAtMv], ([n, r]) => liveAgeLabel(r, n).text);
const countdown = useTransform([now, nextFundingMv], ([n, t]) => hhmmss(t - n));
<motion.span>{age}</motion.span>
```
To flip a tone at a threshold (e.g. warn after 120 s) use `useMotionValueEvent(…, "change")` and set state only when the boolean flips.
Live market MotionValues (`priceMv`, `tickDirMv`, `open24hMv`, `flowImbalanceMv`, …) are documented in `src/market/README.md`.

### `inView.ts` – shared observer
`observeInView(el, cb)` (one `IntersectionObserver` at threshold .1 for every helper), `canObserveInView()` (false in jsdom/SSR),
`useFirstInView(ref, enabled?)` – `true` from the first time ≥ 10 % is on screen (one React update), `true` whenever `enabled` is false
(reduced motion) or without an observer. `@/primitives/revealValue` builds `useRevealValue` / `useSeenOnce` on it.

### Hooks
- `useReducedFx()` → boolean; gate every MotionValue/`useSpring` effect with it.
- `usePressable({ disabled?, scale? (`pressScale.control` .96 – pick the token of the target size), hover?, transition? })` → `{ whileTap, whileHover (hover devices), transition: spring.press }`.
- `useMediaQuery(q, fallback)`, `useCanHover()`, `useIsDesktop()` (≥ 640 px) – one shared `MediaQueryList` + listener per query
  (stable `subscribe`: renders never re-subscribe or create lists).
- `safeFx.ts`: `SAFE_FX_ATTR` / `isSafeFx()` – Samsung-Internet-safe effects (`html[data-safe-fx]`, set by `@/app/pwa`); `Reveal`,
  `RevealItem`, `StaggerItem` and PageHost drop their blur under it.
- `a11y.ts`: `useFocusTrap(ref, active, settled?)`, `useScrollLock(active)`, `useInertOutside(ref, active, settled?)`,
  `useEscape(active, onClose)`, `useBackClose(active, onBack)`, `useDialogBehaviour(ref, active, onClose, { settled? })`:
  - focus moves into the panel and Tab is trapped at once; the outside is isolated when `settled` is true (open morph done);
  - after close, releasing the outside and then returning focus wait for `settled` (exit / reverse morph done); a dialog opened from
    inside a CLOSING one (the detail's `Bearbeiten` → the editor) returns focus to that one's opener (the trade row) – its button is
    gone by then, and focus used to fall to `<body>`;
  - each deferral is bounded by `SETTLE_FALLBACK_MS` (700); omitting `settled` gives immediate behaviour; focus is not returned if the
    user focused something else meanwhile; `INERT_EXEMPT_SELECTOR` (live regions – `[aria-live]` except `aria-live="off"`, which
    is muted content like the chart's OHLC legend – and the toast island) is never isolated.
  - Isolation (perf-120 C) is NOT `inert`: the siblings of every ancestor get `aria-hidden="true"` + `data-modal-behind` (reference
    counted, an `aria-hidden` they already had is kept / restored) and a document `focusin` guard sends focus that lands there (Tab in
    from the browser UI, a programmatic focus) back into the latest isolated panel while it is open – the guard ends when the dialog
    starts to close (a tap into the page the exit uncovers, e.g. during the navigation's 800 ms wipe, keeps its focus; the release
    still waits for `settled`); pointer input never reaches the page while the dialog is open (every modal
    overlay is a fixed full-viewport layer above page, header and dock) and Tab stays trapped. `inert` is inherited style: setting and
    lifting it restyled every element of the page behind (≈ 1 900 on the Übersicht, 15–25 ms forced by the focus return after a sheet
    closed, the same again after the open morph). Reachability checks use `UNREACHABLE_SELECTOR` (`[inert],[data-modal-behind]`).
  - Stacked dialogs (P14): the app-level hosts mount their dialogs in place (a `HostSlot` wrapper, `display: contents`), so a
    sheet opened from the trade detail (share, replay) sits in a wrapper the detail's isolation already marked as behind. The
    newer dialog lifts the marks on its own chain while it is open (`liftOwnChain`) and they come back on its release while
    the older dialog still holds them – the topmost dialog is never aria-hidden.
  - `MorphDialog`, `Sheet` and `TradeDetail` pass `settled`.
  - Android back (decision 26, `useBackClose(active, onBack)`, part of `useDialogBehaviour` – so every modal session has it: sheets
    incl. the trade / setup editor and the import, morph dialogs, the trade detail, the command navigation): while open the session owns
    one same-URL history entry (`store/backStack.ts`); the system back button / back gesture runs `onClose` – the Escape path, so an
    unsaved form asks "Änderungen verwerfen?" and, kept open, gets its entry back (the next back asks again) – instead of switching the
    page underneath; any other close (×, Escape, Speichern, swipe, backdrop) consumes the entry with an own `history.go` the router
    never sees. Nested sessions stack (back closes the topmost: setup editor before the trade editor); a hand-off in one commit (detail →
    Bearbeiten → editor, navigation → Trade eintragen) keeps the one entry. Only with no dialog open does back reach the hash router.
  - `useTouchMoveGuard(isDragging)` → ref callback: a native NON-passive `touchmove` listener that `preventDefault`s while a drag is
    engaged. React's touch listeners are passive; an unconsumed fast touch sequence lets Chrome treat the next tap (≈ 1 s) as a fling
    cancel and swallow its click. Every swipe / drag surface carries it: sheet header, dialog head, detail grabber + header, toast,
    dock, `Segmented`, calendar month swipe.

### `base.css`
`html { scrollbar-gutter: stable }` (the scroll lock never reflows); under reduced motion transition/animation delays are zeroed and
`scroll-behavior` is `auto`.

## pulse-motion (`src/motion/pulse/*`, barrel `@/motion/pulse`)

Ports of the pulse-motion pack (timings/curves/springs measured from the recordings, Nothing palette), all on the
shared 120 Hz engine (`engine.ts`: exact `springAt`, `smoothing(k, dt)`, `cubicBezier`, `createFrameLoop` that sleeps
when idle, coalesced `latestPointer`, seeded PRNG; `springStep.ts`: the one retargetable exact spring step, wrapped by
`textKit.springStep`; `textKit.ts`: `createTimeline` – rAF clock that pauses offscreen / in a hidden tab –,
`usePlayTrigger`, `watchActivity`). Per frame only transform / opacity / clip-path (filter during a morph) are
written, never React state; reduced motion shows the final state at once. Every file keeps its tokens in `CONFIG`.

| Component | Pack effect | Where it is used |
| --- | --- | --- |
| `AsciiCascade` (`color`, `scrambleColor`, `scrambled`, `reserve`, `drop`) | text-ascii-cascade | intro wordmark (starts `scrambled` – never flashes the answer first); header logo click (decode after the replay); `color="inherit"` keeps a tone |
| `PixelTextFill` | pixel-text-fill | intro statement; page subtitles once per session (`LeadFill`: Trades, Entscheidungsgrundlagen, Einstellungen) |
| `Typewriter` | text-animate | intro data line (real counts + live price); `EmptyState` line (`line` prop, "Keine Treffer": "Filter lockern oder zurücksetzen.") |
| `TextMorph` | text-morphing | every string `StatusPill` label (the MarketPanel shows its pair · source through `TextScramble` and its loading line through `TextShimmer`) |
| `TextPrism` (`colors`) | text-prism-split | Hero Netto-P&L; lens and copies only on hover devices (touch renders the plain figure, no copies); copies always take their layer colour |
| `DancingLetters` · `DancingSvgWord` | dancing-letters | header wordmark (hover); footer outline wordmark |
| `TactileHighlight` (`padX`, `tab`) | tactile-highlight | verdict key words (`VerdictPanel`), the "Neuer … Einstieg" marker (`SignalCard`), `LeadFill` key word – inline places pass `tab={false}` (the 90 ms tab would cross the preceding text) |
| `MorphSelect` | morphing-language-selector | `#f-tf` timeframe, Trades setup filter, `#s-currency` |
| `Autocomplete` | autocomplete | Trades search (grouped suggestions); `#s-symbol` (Binance futures symbols → `BINANCE:…`) |
| `NotchedFrame` | notched-project-card | setup cards (CSS in `@layer components`, utilities win) |
| `WidgetGrid` · `useLift` | draggable-widget-grid | MarketPanel mini tiles (order in `tj2-ui-market-tiles`); RulesCard / SetupEditor checklist lift |
| `StripWipe` · `playStripWipe` | parallax-strip-slider | chart interval switch (10 strips from an opaque snapshot) |
| `Marquee` (`paused`) | motion-footer | footer stats band; `paused` follows the footer's reveal hysteresis (hidden at ≤ 50 % in view), so it resumes where it stopped |
| `ScrubTimeline` (P01) | agent-trace (generalised from `chart/replay.ts`) | session / trade replays, Monte-Carlo runs, a diary – see "P01 ports" below |
| `MilestoneRail` (P01) | product-timeline | plans, goals, fills, onboarding progress (vertical, horizontal, pinned) |
| `MagnifyRow` (P01) | dock (magnification remix) | group switchers, shortcut keys |
| `FullscreenWipe` · `WipeItem` (P01) | immersive-full-screen-navigation | "Bericht bereit", "Ziel erreicht", checkout return, search overlay |
| `GlyphZoom` (P01) | glyph-portal | share card born from a trade, a new cockpit widget |
| `ReelWindow` (P01) | reel-collage | screenshot galleries, example setups |
| `CardSpread` (`deal` / `fan`, P01) | slanted-spread-hero | tariff / setup / strategy cards dealt into their grid; the slanted fan hero |
| `OrbitSpread` (P01) | cinematic-orbit-hero | coach profile, team / mentor ring |
| `LaunchGrid` · `LaunchSlot` (P01) | product-launch-hero | pricing hero, onboarding start |

Built on the same engine outside this folder: the intro (`src/intro`, glyph-portal / reel-collage / slanted-spread /
cinematic-orbit / product-launch), the dock labels + magnification and the command navigation (`src/app`), the
equity replay scrubber (`src/chart/EquityChart.tsx`) and the Hochrechnung milestone rail (`views/overview`). These
one-off builds stay as they are; the P01 ports below are the reusable versions for new features.

### P01 ports – contracts

Dev gallery: `dev/pulse-ui.html?c=scrub|milestone|magnify|fswipe|glyph|reel|spread|orbit|launch` (`?c=pinned` for the pinned
rail, `&bare` without the backdrop; demos in `dev/pulse-ports.tsx`). Tests: `tests/unit/pulse.ports.test.tsx`.

| component | props (abridged) | contract |
| --- | --- | --- |
| `ScrubTimeline` | `{ label; total; spans?: {id,label,start,duration,tone?,meta?}[]; markers?; time?: MotionValue; defaultTime?; autoPlay?; loop?; playSeconds? (10.4); speeds? ([1,2,4]); step?; bigStep?; formatTime?; onCommit?; transport?; title? }` | Everything is a pure function of `time` (`spanProgress`, `scrubKey`, `timeAtX`, `playStep`): playhead, `scaleX` bars, rows waking up (opacity .45 → 1), readout and `aria-valuenow` are written on change, zero React renders. Scrub = 1:1 pointer (coalesced, one rect read per gesture); Play from the rAF clock, stops at the end (or `loop`), sleeps off screen. `role="slider"` (arrows / Shift / Page / Home / End, Space = play). Subscribe your chart to the same `time`. Clips its horizontal overflow (`overflow-x: clip`). Reduced motion: no auto-play. |
| `MilestoneRail` | `{ items: {id,title,date?,text?,tone?}[]; orientation? ("vertical"\|"horizontal"); pinned?; active?; label }` | First view: the rail draws segment by segment (`tween.draw` split, capped), dots pop (`spring.pop`), copy rises from a mask; the active dot pings 3× (`.fx-ping`). `pinned` (horizontal): sticky section, track = page scroll (smoothed `1 − e^(−12·dt)`), stems `p^2.2`, reveal 74 % → 49 % of the viewport; geometry on resize only. `<ol>` + `aria-current="step"`. Reduced motion: static (pinned → horizontal row). |
| `MagnifyRow` | `{ items: {id,label,icon,onSelect?,active?,disabled?}[]; label; size? (44); gap? (6); magnify? (.8); showLabels? }` | Windowed Gaussian bell (`magnifyBell`, σ 48, window 140 px), symmetric widening (`magnifyLayout`), transform only, pointer on `spring.dock`, amount 400 / 20; labels rise 6 px. `role="toolbar"`, roving focus (arrows / Home / End; keyboard focus magnifies like a hover). Hover devices only; reduced motion: none. Leave ≈ 40 px of room left / right of the row (the magnified items widen it by transform). |
| `FullscreenWipe` / `WipeItem` | `{ open; onClose; label; children; curtain? (true); autoCloseMs?; closeLabel? ("Schließen") }` / `{ index; children }` | Portalled `role="dialog"` (`useDialogBehaviour`; the session ends with the close). Red signal curtain 80 ms ahead, black panel wipes in (800 ms, `cubic-bezier(.76,0,.24,1)`, shell + counter-translate), items fade up 24 px from 620 ms (`wipeItemDelay`), out to the right. `autoCloseMs` + `.fx-countdown` hairline. z-index 77 / 78 (under the confetti layer). Reduced motion: instant fade. |
| `GlyphZoom` | `{ word; letter?; open? \| progress?: MotionValue; duration? (1.6); wallColor?; portal?; children; label }` | Canvas wall with the word punched out (exception `glyph-zoom`); dive point = deepest stroke point (`deepestPoint`, distance transform, once per layout), end scale just covers the stage, curves `glyphCamera` (pack keys). Content `inert` + aria-hidden until covered (`data-covered`), then interactive; the portal colour fades into it. Reduced motion: the wall fades. |
| `ReelWindow` | `{ reels; lines: [string,string]; swapLines?; cards?; play?; playOnView? (true); loop?; label }` | Hard cuts (`reelStart`, faster first), collapse `scaleY` 340 ms, line swap, spread 440 ms (`collapseAt`, `spreadAt`) – pure functions of time, one timeline (pauses off screen), container units (`cqw`/`cqh`, no measuring). Rests on the tableau (finite; `loop` opt-in). `figure` + `label`, the swapped lines in `figcaption`. 4:3 below `sm`. Reduced motion: the tableau. |
| `CardSpread` | `{ variant? ("deal"\|"fan"); children; cards? (fan); play?; playOnView?; open?; onOpenChange?; autoplay?; label?; itemClassName? }` | `deal`: YOUR grid; one layout read per deal, cards start as a slanted deck (±4°, .86) and are dealt on `spring.deal` (`stagger.deal`), ending at `transform: none`. `fan`: the pack hero (−13°, spring 14 / 7.5, headline fades 10 → 80 %), `role="button"` + `aria-expanded`. Reduced motion: final layout / open fan. |
| `OrbitSpread` | `{ items; children; trigger? ("view"\|"click"\|"manual"); open?; label; listLabel? }` | Fan → elliptical ring on the measured curve (`orbitProgress`, 2.8 s), depth scale / z-order (`orbitPose`), copy opacity + scale .9 → 1, pointer drift by depth (20 / 9), ←/→ turn one slot (70 / 15). Container units, transforms only, z-index written on change. `role="group"`, the cards a `<ul>`. 4:3 below `sm`. Reduced motion: open ring, no drift. |
| `LaunchGrid` / `LaunchSlot` | `{ children; slots?; cards?; aside?; hud?; play?; playOnView?; label }` | `launchAt(v)`: dot grid lights radially (clip-path circle), square marker turns in (finite spin), `LaunchSlot` cuts through `slots` (0.4 s) to the last, cards fly in (k 8.5) and collapse onto the hero card, prismatic camera turn and back (rotateY, ends `none`), `aside` flies in (ω 7.3), `hud` blurs in (no blur under safe-fx). ≈ 4.1 s, then rest. `section` + `label`; layout by CSS grid. Reduced motion: the rest frame. |

Intro gating: first-view effects inside an overview cell wait for `useIntroLanded()` / `useIntroGate()`
(`src/intro/introStore.ts`); `TactileHighlight playOnView` does this itself.

## fx kit (`src/motion/fx`, barrel `@/motion/fx`, P01)

Creative one-shot effects for the feature pages, built to the same contract as everything above: transform / opacity /
filter / clip-path only, timings from `tokens.ts` (measured or tuning values in an exported config object per file),
`useReducedFx` → the static end state, no blur under `html[data-safe-fx]`, finite (the one loop, `RadarSweep`, only
while a scan runs), canvas through `createFrameLoop` / `createTimeline` (asleep off screen and in hidden tabs), live values
as MotionValues, decorative layers `aria-hidden` with the real value kept accessible, never `aria-live`. Shared runtime:
`shared.ts` (`FX_TONE` / `FX_HEX` – red stays the one accent –, `playWaapi`, `useFxPlay(ref, play, playOnView, enabled,
run)`: replay key + once on first view, intro-gated), `curve.ts` (`monotoneCurve`, `expApproach`, `smoothstep`,
`progressIn`, `easeInOutCubic`). Dev gallery: `dev/pulse-fx.html?c=<id>&bare` (text effects also in
`dev/pulse-text.html?c=flap|coach|cascade|matrix`); tests: `tests/unit/motion.fx.test.tsx`.

| effect | props (abridged) | what / tokens | reduced · safe-fx |
| --- | --- | --- | --- |
| `GlowBreak` | `{ x?, y?: number \| MotionValue; tone? ("win"\|"loss"\|"soft"); size?; rings? (0–3); play?; playOnMount? }` | DOM glow pinned to a chart point (place it in a `relative` overlay): halo breathes 3× (`tween.glow`), sonar rings 3× each (`tween.pingFew`, staggered), WAAPI, pre-rendered gradients | resting glow, no rings · no filter used |
| `BreakoutStreak` | `{ direction? ("up"\|"down"\|"left"\|"right"); tone?; count? (≤ 40); play?; playOnMount?; origin?; spread?; seed?; onDone? }` | Canvas chevrons (`›` + echo) in the breakout direction, seeded (`streakParticles`, `streakAt`), launched `stagger.streak`, life `tween.streak`, then the canvas clears and sleeps | nothing drawn |
| `RadarSweep` | `{ active; variant? ("radar"\|"band"); tone?; size?; label? }` | Radar scope (wedge + blips) or a scan band over its parent; CSS loop only under `[data-scanning]`, paused off screen (exception `radar-sweep`) | still wedge / static tint |
| `LiquidGauge` | `{ value: number \| MotionValue; danger? (.8 \| null); tone?; shape? ("tank"\|"round"); label; valueText?; children? }` | `role="meter"`; level on `spring.liquid`, wave kick + decay (`waveKick`, `waveDecay`, `tween.wave`), red crossfade + dashed edge above `danger`; rises from empty on first view; loop asleep at rest (exception `liquid-gauge`) | level jumps, no wave |
| `EquityDraw` | `{ values; height?; tone? ("auto"…); area?; baseline?; play?; playOnView?; progress?: MotionValue; duration?; label }` | `role="img"`; left → right draw by `clip-path: inset()` + glowing head (`transform`), both from one MotionValue (zero renders), head breathes 3× after; `progress` scrubs / races; width on resize only | drawn at once · no drop-shadow |
| `HeatGridReveal` | `{ cols; origin?; play?; playOnView?; children; className?; cellClassName?; ring? }` | Your cells, cascading from the origin cell (`heatDelay`: Chebyshev ring · `stagger.heat`, cap `stagger.heatMax`), pop on `spring.deal` (one imperative Motion animation per cell, started in a layout effect – no motion component per cell, a replay never re-mounts your cells), rest without an inline transform, origin ring once; `heatColor(t, mode)` for cell colours | static grid · ring without glow |
| `SplitFlap` | `{ text; order?; direction?; tiles?; minChars?; align? }` | Dark tiles with a hinge, label rolls via `TextRoll mode="roll"`; direction from `order` (`flapDirection`) | TextRoll swaps instantly |
| `CoachStream` | `{ text; thinking?; thinkingLabel? ("Coach denkt …"); msPerChar? (65); maxCatchUp? (2400); cursor?; instant?; onCaughtUp? }` | Typewriter on the rAF clock that CONTINUES when `text` grows (streaming), a chunk never takes longer than `maxCatchUp`; `TextShimmer` while thinking; full text sr-only; caret blinks 3× after catching up | full text at once |
| `ConfidenceMeter` | `{ value (0–100); label? ("Konfidenz"); hideLabel?; tone? ("auto"…); rows?; cols?; size?; gap?; showValue? }` | `role="meter"`; DotMatrix ramp (`confidenceFrame`) uncovered by a clip wipe on first view, phosphor crossfade on change, `RollingDigits` %; auto tone ≥ 70 win / ≥ 40 fg / below mute | static |
| `NumberCascade` | `{ value; decimals?; prefix?; suffix?; signed?; format?; play?; playOnView?; duration?; onDone? }` | Count-up under a numeral rain (`fxTiming.cascadeReroll`), columns lock most significant first (`lockAt`) with a pop, `tween.cascade`; slots from the final string (no width jump), zero renders; a new value cascades again | final value |
| `DissolveOut` / `dissolveElement(el)` | `{ active; onDone?; cell?; seed?; as? }` | Pixel dissolve: seeded order (`dissolveOrder`), `clip-path: path()` of the remaining row runs (`dissolvePath`) in `fxTiming.dissolveFps` steps over `tween.dissolve`, dims + sinks 4 px, then `onDone` (the owner removes the element). One size read per dissolve | plain fade (`tween.exit`) |
| `SpotlightSweep` | `{ play?; playOnView? (true); tone? ("signal"…); onDone? }` | ONE red line with a soft trail crosses its `relative` card (`tween.sweep`), WAAPI, then gone | nothing |
| `celebrateStreak(el, {streak})` / `celebrateRecord(el)` | – | Presets for the `streak` / `record` kinds of `Celebrate` (the overlay in `App`): streak + white echo from `STREAK_ECHO_FROM` (5); record (red signal dot) + win echo `stagger.insert` later – at most 2 bursts | no echo (the overlay shows its ring) |
| `DotMatrixText` (also in `@/motion`) | `{ text; width?; align?; preset? ("wave"\|"snake"\|"chevrons"\|"chevrons-left"); presetPosition?; cycles? (3); tone?; presetTone?; size?; gap?; glow?; label?; decorative? }` | DotMatrix text mode, upper-cased + padded (`matrixText`), optional animated preset glyph that plays `cycles` loops then rests (`Infinity` only for busy indicators that unmount); `role="img"` with the text | static frame, no glow; the pure activity glyphs (wave, snake) are dropped, chevrons stay |

Planned uses (feature packages): boxes / breakouts – `BreakoutStreak`, `GlowBreak`, `RadarSweep`, `CardSpread`, `DotMatrixText`
"A+"; analytics – `HeatGridReveal`, `NumberCascade`, `EquityDraw`, `ScrubTimeline`; coach / reports – `CoachStream`,
`SpotlightSweep`, `ConfidenceMeter`, `SplitFlap`, `FullscreenWipe`, `MilestoneRail`, `OrbitSpread`; risk – `LiquidGauge`,
`DissolveOut`, `NumberCascade`; growth – `celebrateStreak` / `celebrateRecord`, `MilestoneRail`; pricing / onboarding –
`LaunchGrid`, `CardSpread`, `FullscreenWipe`; social – `MagnifyRow`, `GlyphZoom`. P01 adds no `layoutId`s (the contract
table below is unchanged).

## Physics (`src/motion/physics`)

Apple-style physics, strictly ADDITIVE: every tuned token in `tokens.ts` stays as it is, and taps, keyboard and
programmatic animations keep using them. Physics only (a) drives direct manipulation 1:1 under the finger with an
iOS rubber band at the limits, (b) hands the finger's velocity to a spring on release (slow → gentle, no overshoot;
fast → short and up to 0.3 bounce), and (c) gives layout-driven targets (pills, thumbs, morphs — Motion starts layout
animations at velocity 0) a slightly shorter, bouncier *context spring* only when the input was fast. Import from
`@/motion/physics`. Tuning lives in `physics` (`physics/constants.ts`, an extension of `gesture`; sources: WWDC18 803,
WWDC23 10158, UIKit, Android/Flutter VelocityTracker).

Motion 13 facts this relies on: time-defined springs (`bounce`/`duration`/`visualDuration`) drop the initial
velocity → anything that carries velocity is physics-defined (stiffness/damping/mass); `layout`/`layoutId` animations
always start at velocity 0 → only context springs there.

| export | what |
|---|---|
| `appleSpring(duration, bounce)` / `appleParams(spring)` / `appleParamsOf(token)` | WWDC23 conversion: k = (2π/d)², c = 4π(1−b)/d (b ≥ 0) or 4π/(d(1+b)); `appleSpring(.5, 0)` = `spring.smooth` |
| `physicsOf(token)` / `motionTimeSpring` / `isTimeDefined` / `isSpring` | the exact physics Motion runs for any spring token (port of Motion's `findSpring`) |
| `tempoOf(speed)` | 0 at ≤ 400 px/s … 1 at ≥ 1800 px/s (smoothstep) |
| `releaseSpring(v, speed?)` | Apple(.5, 0) when slow → Apple(.36, .3) when fast, `velocity: v` included |
| `contextSpring(token, speedPxS)` / `contextSpringAt(token, tempo)` | the token ITSELF at ≤ 400 px/s / tempo 0; at full tempo duration × 0.8, bounce + 0.15 (cap 0.4) |
| `mixSpring(a, b, t)` / `pressTempo(ms)` | Apple-space blend (identity at both ends) / tap ≤ 150 ms → 0 … press ≥ 400 ms → 1 |
| `flingSpring(dir, v)` | critically damped exit, ≥ 900 px/s, coarse rest thresholds |
| `project(v, rate)` / `projectPoint` / `decayInertia(rate)` | UIScrollView deceleration (0.998 normal: 1000 px/s → 499 px; 0.99 fast → 99 px) / Motion `inertia` equivalent |
| `rubberBand(x, d)` / `rubberBandInverse` / `rubberClamp(v, min, max, d)` | iOS (1 − 1/(x·0.55/d + 1))·d |
| `swipeDecision` / `flickDecision` / `dismissThreshold` / `snapIndex` / `flickStep` / `nearestIndex` / `axisLock` | commit rules on the PROJECTED position; flick-back > 300 px/s cancels; 16 px minimum; 10 px hysteresis + 1.2 axis ratio |
| `createVelocityTracker()` | weighted LSQ over 100 ms of coalesced samples, 0 after 40 ms at rest |
| `inputSpeed` (MotionValue) / `pointerSpeed()` / `pointerTempo()` / `lastPressMs()` / `installTempo()` / `useTempoProbe()` / `setNavTempo`/`consumeNavTempo` / `haptic()` | passive global tempo probe (3 passive listeners, no loop, no React state) |
| `useAxisDrag(opts)` / `springTo(mv, to, v)` | generic 1-/2-axis drag on MotionValues |
| `useSwipeDismiss(opts)` / `flingExit(info)` / `flingValue(mv, info)` | overlay / toast swipe-to-dismiss |

Rules: sample tempo IN THE EVENT HANDLER and store it with the state change (never read it in render); keyboard /
focus / programmatic paths pass 0. Drag the opaque column wrapper, never a `layoutId` panel. Reduced motion: tracking
stays 1:1 and rubber bands stay (feedback, not decoration); releases jump; flung exits fade (`tween.fade`); no zoom
scale. 120 Hz: zero React state per move, one layout read per gesture (pointerdown), transform/opacity only,
`will-change` only from engagement until the value is home.

The physics tuning is the `physics` object (`physics/constants.ts`), not `tokens.ts`: the tuned tokens stay untouched and every
consumer below falls back to the token itself at tempo 0. `src/motion/index.ts` deliberately does NOT re-export the physics module
(`clamp`, `physics`, `haptic` would be generic names in the main barrel) – import from `@/motion/physics`. `MotionRoot` installs the
tempo probe (`useTempoProbe()`), so `pointerSpeed()` has data from the first interaction.

### Where it is used (context springs, swipe-dismiss, throws)

| surface | physics |
|---|---|
| `Sheet` (TradeEditor, SetupEditor, ImportDialog) | `useSwipeDismiss` on the column, handle `[data-sheet-handle]` + header row; flung exit via `custom` + `flingExit`; `dismissGuard` resists with a rubber band (see `Sheet`) |
| `MorphDialog` | zoom dismiss from `[data-dialog-handle]`; `closeTempo` → source `MorphCard` on `contextSpringAt(spring.morph, closeTempo)`; `useMorphDialogGuard` |
| `TradeDetail` | zoom dismiss from `[data-detail-grabber]` + header row; `uiStore.dismissDetail(tempo)` stores `detailTempo`; the source (recent row, trade card `[data-trade-morph]`) zooms back on `contextSpringAt(spring.detail, detailTempo)`; `DETACHED_DETAIL_SOURCES` (`marker`, `insights`) own no `trade-{id}` target, so those details enter on their own |
| Toast island | horizontal swipe either way (`direction: 0`, mouse too), fling out on the release velocity, the click after a drag is swallowed |
| Dock (`src/app/README.md`) | tap hop by press length (`hopFor(lastPressMs())`: `spring.pop` → `spring.smooth`), touch scrub (`data-scrub`), flick-to-switch (`flickStep` → `setNavTempo` → PageHost `contextSpringAt(spring.pageEnter, consumeNavTempo())`, faster `flickHop`), re-tap = scroll to top + dip; the tab markers keep `spring.layout` (compositor FLIP, `DockMarker`) |
| `Segmented` | iOS press-slide-release (preview under the finger + haptic, ONE `onChange` on release, a flick > 600 px/s snaps to the projected segment); thumb `contextSpringAt(spring.segment, tempo)`, ghost `contextSpring(spring.hover, speed)` |
| `HoverPill` · `RowHighlight` | `contextSpring(spring.hover, pointerSpeed())` sampled when a row claims the pill (focus: 0); `isRealHover()` (last pointer was a mouse) gates `HoverPill`, the table only hovers for non-touch pointers – nothing stays lit after a tap |
| `WidgetGrid` (market tiles, checklist lift) | throw: velocity tracker per drag, a release ≥ `CONFIG.throwMinSpeed` lands on the slot at `throwTarget` (projection with `CONFIG.throwRate`), tilt `CONFIG.tiltPerSpeed` (≤ `tiltMax`°, `tiltSpring`), drop `mixSpring(spring.layout, CONFIG.dropFast, tempo)` |
| `MorphSelect` · `Autocomplete` | press-drag-release (mouse: a vertical drag opens the menu; touch: hold still `CONFIG.pressHoldMs` and it opens under the finger, the page scroll blocked for that gesture only; the row under the finger by arithmetic `rowAtPoint`, release selects, the trigger click is swallowed), fling-to-close with `progressVelocity`; coarse rows `CONFIG.rowHCoarse` (`placePanel(…, rowH)`); `MorphSelect` closes on an outside scroll only once its trigger left the spot the panel was placed from (a scroll event queued before the open, or a scroller the field does not sit in, keeps it open) |
| Calendar month (`views/insights`) | `useAxisDrag` x with a rubber band at the first / last month, `flickDecision` on release |

Every drag surface also carries `useTouchMoveGuard` (see Hooks), so a tap right after a fast swipe is never swallowed.

## Feature notes

### Market panel live leaves (`src/views/overview/MarketLive.tsx`)
Every live number is a MotionValue leaf, so the panel commits only on structural changes:
- `LivePrice`: `RollingDigits source` on `priceMv` with a move flash. `ChangeChip`: live 24 h % from `priceMv` / `open24hMv`, glided;
  the arrow rotates on `spring.segment`. `OrderFlow`: `DotMatrix` signed meter from `buyVolMv` / `sellVolMv` windows plus the buy
  share from `flowImbalanceMv`. `FundingBlock`: the mark glides on `spring.price`, the countdown runs on `nowMv`. `LivePill`: age on
  `nowMv`, a `RingCycle` ring, `pingOn={tradeCountMv}`. `PreviewLine`: countdown on `nowMv`. `TriggerDistances`: label + scaleX
  proximity bar following the glided price.
- React re-renders come only from `useMarketPanelView(levels)` (health / bar / presence keys, one deadline timer), `usePriceClass`
  flips (reach, zone, invalidation) and hover.
- Scenario change (never on mount): a clip-path sweep of the new tone (`tween.reveal`, fades on `tween.flash`), a title pop
  (`spring.pop`) and `<BorderBeam fire={n}>`. Reduced motion: a crossfade only.

### `StatTile` · Hero · `HeroBackdrop`
- `StatTile` is memoised. String values count up from 0 the first time the tile is in view (`spring.number`, shared observer, final
  text in `.sr-only`) and roll with `TextRoll` on later changes, never on mount. `loading` shows a Skeleton. Hover lift = scale 1.03 /
  y −2 on a NON-layout wrapper (`spring.hover`) plus an opacity-crossfaded highlight, on hover devices only; no `layout` / flexGrow on
  the tile root; the content wrapper has `layoutDependency={active}`; the verdict is an out-of-flow popover above the tile, so hovering
  never changes the row height (nor moves the hero headline).
- Hero: the Netto-P&L glow flashes (`tween.flash`) only for changes within the same account after loading; `SkeletonSwap` until
  loaded; the return badge rolls with `TextRoll`. `morph-fk-count` has `layoutDependency={fk.n|dialogOpen}` and `style.borderRadius` 0.
- `HeroBackdrop`: canvas dot flicker on the 18 px grid (`heroField.ts`, `fxTiming.matrixFps` steps/s, ≈ 1 % re-roll per step, a red
  signal dot ≈ 0.2 %, focus around the pointer), asleep off-screen, in hidden tabs and `dwell.heroFlicker` (4 s) after mount or the last pointer activity on the hero (a
  pointer move wakes it). Spotlight (fine pointers): a window moved by
  transform on `spring.smooth` with its bright grid counter-shifted by `−(x mod 18)` so the dots stay locked. Reduced motion: static.

### Overview cards
- Grid (`OverviewView`): cells below the hero are `<Reveal index={column}>`. Hero and ChartCard are deliberately NOT wrapped (the chart
  has its own `tween.chartIn` entrance and hosts the fixed marker ghost). Rows 3–6 add `content-visibility:auto` +
  `contain-intrinsic-block-size: auto <px>`; a deferred cell is paint-contained, so it uses `-my-3 py-3` for the hover lift – never put
  `position:fixed` or overflow-escaping UI inside those cards. Deferred cells carry `data-defer` and render once in idle time
  after load (`startIdlePrerender`, `@/primitives/idlePrerender`: one cell per idle period, top to bottom, `visible` for one
  frame then `auto` again, paused while the page scrolls), so their first style / layout / paint never lands in a scroll frame.
- `@/primitives/revealValue`: `useRevealValue(ref, target, { transition, from?, delay?, enabled?, onReveal? })` → a MotionValue resting
  at `from` until first in view, then animating; later changes animate from the current value (zero renders; reduced motion / no IO:
  starts at the target). `useSeenOnce(ref)` = a boolean that flips once.
- Bars: `<Bar value index>` fills on first view with `barDelay(index)` = `stagger.lead` + capped `stagger.reveal`. Bar + counter:
  `const fill = useBarFill(tileRef, winRate, i)` → `<Bar source={fill}/>` + `<BarPercent fill={fill} label={pct0(winRate)}/>`.
- `RingGauge`: draws on first view (`tween.gauge`) with a riding tip dot; the needle pops (`spring.pop`); with `passColor` a
  pre-rendered second arc crossfades in (`tween.crossfade`) when the tip crosses `marker`, an upward crossing flashes a halo
  (`tween.flash`); `children` may be `(progress) => node` for a frame-synced centre counter; pure helper `crossing(prev, next, marker)`.
- `RecentTrades`: `AnimatePresence key={acc} mode="popLayout"`, rows `layout="position"` with `layoutDependency={ids}`; variants
  `hidden` / `enter` (insert drop-in) / `shown` (`stagger.rows`); an inserted row gets a one-shot `[data-fx="fresh"]` highlight; a
  leaving row carries `data-exiting`, `aria-hidden`, `inert` (the accessible row count stays `RECENT_COUNT`); row press .985 (off while
  its detail is open). `trade-{id}` / `trade-side-{id}` / `trade-pnl-{id}` unchanged.
- `RankingCard`: rank numbers `TextRoll mode="roll"` (`rankRollDirection` – a climbing row rolls down); a changed rank flashes a white/5
  wash. `BacktestCompare`: banner tone = three pre-rendered surfaces crossfaded; headline/sub swap as blur-rolls; Du/Backtest/Δ cells
  `TextRoll mode="roll"`. `Explainer`: what/formula/rows/verdict are `StaggerItem`s. `VerdictPanel`: one-shot tone band sweep
  (`tween.draw`) on first view and per tone change. `EmptyState`: `.fx-ants`, a `DotMatrix` ∅ glyph (`EMPTY_GLYPH_FRAMES`), CTA sheen.
  `Expander` press .88 + disc pop; `Collapse` content settles from y −6; `WarnBanner` enter wipe + 3 soft warn-dot pulses.

### Einstiegs-Check (`SignalCard`, `views/overview`)
- The card re-renders at most once per second (the engine publishes only real changes, `useSignalCheck()`); the zone marker follows
  the live price as a MotionValue. Meters and zone markers move by `transform` only (never `left` / `width`); the zone labels sit
  outside the bar, so a marker never crosses text.
- A NEW valid entry (never on load): one `<BorderBeam fire>` lap, a halo on the score ring, the rung dots that lit up pop
  (`spring.pop`), `.fx-ping` on the running bar, and a `TactileHighlight` "Neuer … Einstieg" marker held for `SIGNAL_HOLD_MS`.
  Reduced motion: the final state at once.
- Candle-close states (decisions 6 + 9): countdowns (`⚠ vorläufig · schließt in mm:ss`) are text on the shared second clock
  (`useNowMv` → `useTransform` → `motion.span`), never React state per second. Provisional looks use the side colours at about
  50 % saturation (`#65b488` / `#d27a7b`, `ink.winSoft` / `ink.lossSoft` in the chart), dashed borders and dashed / outlined dots;
  "stark bestätigt" adds a double ring. Lit tiles draw their tone border on a `-inset-px` layer, so the tile needs
  `overflow-clip` with `overflow-clip-margin: 1px` (plain `overflow-hidden` clipped it away).

### `HeroBackdrop` text mask
Elements marked `data-hero-mask="text"` (their text lines) or `"box"` (their border box) keep the dot field away: the canvas skips the
blocked cells and the static / spotlight grids get an SVG CSS mask. Re-measured on resize only (≤ 1 per 150 ms), never per frame.

### Market tiles
The four mini tiles (Funding, OI, Taker, Bid / Ask) are `MorphCard`s rendered as `div` inside `WidgetGrid`: a tap opens the explainer
(`morph-market-tile-{id}`), a press-and-hold lifts the tile for reordering. The weekly check is `morph-weekly-check`.

### Chart (`src/chart`, full contract in `src/chart/README.md`)
`spring.candle` (forming close), `tween.ping` (price-pulse rings, second ring delayed `tween.ping.duration/2`), `tween.flash` /
`tween.ripple` (tick tint, per-print ping, marker ripple), `spring.pop` / `tween.exit` (`Folgen` pill), `tween.crossfade` (interval /
pane screenshot), `tween.draw` (Equity / Sparkline draw-in), `spring.smooth` (Equity `jetzt`), `spring.tooltip`, `spring.cards` +
`stagger.cards` (MonthlyBars), `spring.press` (RangePills label .97). High-frequency updates never touch React state (trades via
MotionValue events, klines via `subscribeFeed` ≤ 1/frame, canvas writes once per frame while on screen and expanded). Decorative test
markers: `data-fx="price-pulse"`, `"follow"`, `"equity-now"`.

### Keep-alive overview
The shell keeps the overview mounted in React `<Activity mode="hidden">` on other tabs (`src/app/PageHost.tsx`): effects are destroyed
on hide and re-run on show (keep them re-entrant and cheap – ChartCard requests a `history()` range once per key; the candle chart
PARKS its lightweight-charts instance when the hide destroys its effect (host still in the document) and re-attaches it on show:
no createChart / setData on a return, every chart effect skips an input it already applied, autoSize is off and its own
ResizeObserver ignores the 0 × 0 report of the hidden page), the hidden DOM stays in the document (no real `<table>`, no
labels/texts colliding with other pages' selectors), and MotionValue text may show its last value for one tick after the page is
shown again. A cleanup that must tell "hidden" from "unmounted" checks `node.isConnected`; React runs no cleanup for a subtree
unmounted while hidden (the chart sweeps such parked instances every 10 s). The hide detaches every ref, so each motion
component unmounts its VisualElement and every `layoutId` node would snapshot itself (a getBoundingClientRect of a
`display: none` box, thrown away, each forcing the layout of the page switched to – ≈ 100 reads / 55 ms on the first switch
away from the Übersicht): `useHoldProjectionOnHide()` (`activityProjection.ts`) – the page host's first child in front of
every keep-alive page, or the page root – blocks the document projection root's updates for that commit (its layout cleanup runs
before the children detach). The show re-mounts every node, and with `root.hasTreeAnimated` each `layout` / `layoutId` node marks
itself layout-dirty, so the next layout update anywhere measured them all (every node inside a `content-visibility: auto` cell
forced that cell's style + layout, ≈ 20 ms): `useSettleProjectionOnShow(layerRef)` – the host's last child – drops that flag for the
page's nodes that take part in no animation (`settleRevealedProjection`); a later layout change or morph measures before it compares.

## layoutId contracts

| id | source → target | transition | rule |
|---|---|---|---|
| `hover-{group}` (`bt`, `rank`, `recent`) | `HoverPill` between rows of one list | `spring.hover`, opacity `tween.hoverPill` | one group per card; lists use `useHoverStore()` + `HoverPillFor` (the hovered id lives outside React state: a hover re-renders the two pills, never the list) – `useHoverGroup` (state in the list) stays for small cases |
| `hover-trades-{useId}` | `RowHighlight` (`src/views/trades/RowHighlight.tsx`) between hovered/focused table rows | `spring.hover`, opacity `tween.hoverPill` (exit delay .15 s) | one per table; `borderRadius radius.hover`; lives in the table's `layoutScroll` wrapper, measured with transform-free offsets |
| `sort-indicator-{useId}` | active sort-column chip in `SortHeader` (`TradesTable.tsx`) | `spring.layout`; chevron rotate `spring.plus` | one per table; `borderRadius radius.pill`; `aria-hidden` (direction stays sr-only ` ↑`/` ↓`) |
| `bg-{useId}` | `Segmented` thumb | `spring.segment` | unique per instance, `layoutDependency={value}`, `borderRadius 8` |
| `seg-hover-{useId}` | `Segmented` hover ghost between items | `spring.hover`, opacity `tween.hoverPill` | unique per instance, `borderRadius 8`, below the thumb; hover devices only, none under reduced motion |
| `emotion-{useId}` | TradeEditor "Gefühl beim Einstieg" chip thumb | `spring.segment` | `borderRadius radius.pill`, `layoutDependency=value`, inside `AnimatePresence` (fades out on clear); only the chip label dips on press |
| `sf-color-{useId}` | SetupEditor colour selection ring | `spring.segment` | `borderRadius radius.pill`, `layoutDependency=value`; a sibling of the swatch button, so the hover scale is never measured |
| `morph-{id}` / `morph-title-{id}` (`fact-*`, `bt-{k}-{filter}`, `setup-rank-{id}`, `hyblock-new`, `falling-knife`, `market-tile-{funding\|oi\|taker\|book}`, `weekly-check`) | `MorphCard` → `MorphDialogProvider` panel | `spring.morph`; after a swipe-dismiss `contextSpringAt(spring.morph, closeTempo)` | source hidden after the morph; both carry `layoutDependency` (dialog open) |
| `morph-fk-count`, `morph-dot-{id}` | Falling-Knife count / ranking dot inside their `MorphCard` | `spring.morph` | `morph-fk-count`: `layoutDependency={fk.n|open}`, `borderRadius 0`; `morph-dot`: `borderRadius 9999` |
| `trade-{id}`, `trade-pnl-{id}`, `trade-side-{id}` | recent row / table ghost / mobile card / chart-marker ghost → Trade-Detail | `spring.detail`; back after a swipe-dismiss on `contextSpringAt(spring.detail, detailTempo)` | set conditionally by `uiStore.detail.source` (`recent`/`table`/`marker`/`insights`; `DETACHED_DETAIL_SOURCES` drop the list's ids) |
| `setup-card-{id}`, `setup-name-{id}`, `setup-dot-{id}` | setup card → `Sheet` (540 px) | `spring.sheet` | card `visibility:hidden` while open |
| `new-trade` | FAB disc (`borderRadius 999`, inside the FAB's scaled visual) → `Sheet size="lg"` | `spring.sheet` | disc unmounted while `editor.open && fromFab` |
| `status-{feed}` | `StatusPill` header ↔ card | `spring.pill` | optional |
| `chart-range` | RangePills thumb | `spring.layout` | one per chart card, `layoutDependency={value}`, `borderRadius radius.thumb` |

Feature packages (P02–P13, registered by the integrator P14 – each id lives in exactly one mounted component at a time):

| id | source → target | transition | rule |
|---|---|---|---|
| `hover-{group}` (`community-board`, `search`) | `HoverPill` in the leaderboard rows (P12) / the search hits (P13) | `spring.hover` | same contract as above; the search pill follows the active option (keyboard too) |
| `morph-{id}` / `morph-title-{id}` (`box-setup-{id}` P02, `fact-ana-{key}` P03, `setup-strategy-{id}` P07) | best-setup card / ratio tile / strategy strip → `MorphDialogProvider` panel | `spring.morph` | the `MorphCard` contract above; ids are unique per page (the Markt and Analyse pages are never shown together) |
| `auth-sheet` | header `AccountPill` "Anmelden" (P09) → login `Sheet` | `spring.sheet` | ONE source on screen (the header pill); opened from anywhere else the sheet slides in without a morph |
| `labor-chip-{id}`, `labor-strat-{uid}` | Labor option chips / strategy tiles thumb (P07) | `spring.segment` / `spring.layout` | per chip group / per config card, `layoutDependency={value}`, `borderRadius radius.pill` / card radius; reduced motion: no transition |
| `annotation-tool-{uid}` | active tool of the screenshot annotation toolbar (P06) | `spring.segment` | per toolbar, `borderRadius radius.thumb` |
| `cal-day-{key}` | calendar day cell → `DayPanel` (Auswertung) | `spring.detail` | set only while the cell is armed (pressed); the panel carries the same id while open |

`// motion-exception: theme-reveal` (P13, `src/app/themeTransition.ts`): the theme switch reveals the new page through a
growing `clip-path` circle (View Transitions) – a declared exception to "only transform / opacity / filter".

Every element above sets `style={{ borderRadius }}` (`radius.card 16`, `radius.dialog/sheet 28`, `radius.pill 9999`, `radius.hover 12`, `radius.thumb 8`).
`position:fixed` panels carry `layoutRoot`; scrolling ancestors of `layout` elements carry `layoutScroll` (sheet/dialog body, table wrapper).
