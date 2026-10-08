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

CSS mirrors (`src/styles/tokens.css` cannot import TS; listed at the end of `tokens.ts`): `.fx-strike` = `tween.collapse`,
`.fx-pop` = `tween.tooltipIn` / `tween.exit`, `fx-ping` = `tween.pingFew` (3 iterations), `fx-shimmer` = `tween.skeleton`, `fx-spin` = `tween.beam`;
`.fx-ants` (0.9 s per period) is CSS-only.

## Components

### `MotionRoot`
```tsx
<MotionRoot>{app}</MotionRoot>
// = <MotionConfig reducedMotion="user" transition={spring.smooth}><LayoutGroup>…</LayoutGroup></MotionConfig>
```
One id-less `LayoutGroup`; `layoutId`s are global and de-duplicated by naming/conditions (see contracts).

`NoLayoutCascade` / `LayoutCascade` (`NoLayoutCascade.tsx`): when all exits of an `AnimatePresence` finish, Motion calls the
root group's `forceRender`, which re-renders every motion component in the app (≈ 1,700). A presence whose exits never
move an in-flow sibling — `popLayout` swaps (`TextRoll`, calendar month / day panel), fixed overlays (`Sheet`,
`MorphDialogProvider`, `CommandNav`, `ToastIsland`), `absolute` layers (`Card` spot ring, the fresh-entry badge) — is
wrapped in `<NoLayoutCascade>` (same `id` / `group`, no `forceRender`). Sheet and dialog bodies get the cascade back with
`<LayoutCascade>`, so their own presences next to `layout` siblings still FLIP. The root itself keeps `forceRender`
(non-`popLayout` presences next to un-gated `layout` nodes rely on it).

### `PageSwitch`
`{ index; pageKey?; children; onTransitioning?; rememberScroll? (true); className? }` – no longer used by the shell (see `PageHost`
in `src/app`), kept in the barrel for other uses.
- No `layout` anywhere: the container is a plain `relative` div.
- Enter `{x: dir·16, scale .985, blur 4px, opacity 0}` – x/scale on `spring.enter`, opacity/blur on `tween.page`, blur off under
  reduced motion, ends at `filter: none`. Exit `{x: −dir·12, opacity 0}` on `tween.exit`. `transitioning` clears after ≈ 0.45 s.

### `MorphDialogProvider` · `useMorphDialog` · `MorphCard` · `MorphTitle`
Card → 620 px dialog morph (Plan 2.5 "Morph-Dialog"), portal-less, with focus trap, scroll lock, `inert` on siblings, Escape/backdrop close.
- `MorphDialogProvider` – mount once at app level. Overlay = ONE fixed `z-[70]` wrapper: it is the backdrop-click target and is never
  made inert; the `bg-ink-950/75` dim layer is decorative (`pointer-events-none`). Panel `layoutId="morph-{id}"` `layoutRoot`
  `borderRadius 28` on `spring.morph`; sticky head `motion.h2 layoutId="morph-title-{id}"`; the body is a stagger parent (`StaggerItem`
  sections). The big drop shadow sits on an unscaled sibling and fades in (`tween.fade`) after the morph, so the per-frame radius
  correction repaints the panel alone.
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
lock, `inert`, Escape. With `layoutId` (`new-trade`, `setup-card-{id}`) the panel morphs on `spring.sheet`; without, desktop
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
`<StaggerItem as="div|section|li">` fades up from `{opacity 0, y 8, blur 4px}` (`tween.reveal`, y on `spring.enter`) and ends at
`filter:none` / `transform:none`. The bodies of `MorphDialogProvider` and `Sheet` are stagger parents: sections cascade
`stagger.sections` apart, capped at `stagger.max` (`sectionDelay(base)` / `withSectionStagger(t, base)`); labels `STAGGER_HIDDEN` /
`STAGGER_SHOWN`. Outside a parent or under reduced motion it renders statically. Items start at opacity 0 in jsdom until the animation
runs: tests `waitFor` before `toBeVisible`.

### `Reveal` · `RevealGroup` / `RevealItem`
Blur-fade entrance `{opacity 0, y 14, blur 6px}` → rest, once, when 15 % is in view (margin −50px); stagger
`min(i, stagger.max)·stagger.reveal`; ends at `transform:none` / `filter:none` (transitionEnd), no x offset. Reduced motion or no
`IntersectionObserver`: `initial={false}`, static. The group is driven by `animate`, so items mounted later also enter.

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
  transform and its own layer. Velocity blur 0–1.5 px (`blur={false}` disables it; off under reduced motion). Zero React renders per
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
| `TextRoll { text; mode?; direction? }` | label morph: shared letters glide (`layout="position"`, `layoutDependency=text`), others blur in/out; `mode="roll"`, labels > 24 chars always roll. The real label is an sr-only span, the visual layer uses `::before{content:attr(data-ch)}` – textContent and the accessible name are always exactly the label. | `spring.digit`, `tween.fade/exit/crossfade` |
| `TextScramble` | decode effect; the real text node stays (opacity 0 while decoding), an aria-hidden overlay shows the glyphs; zero React renders. | `stagger.letters`, `fxTiming.scramble*` |
| `LiveText { source; format?; smooth?; flash?; … }` | MotionValue as text, zero renders; a single `motion.span`, so single-element `getByText` contracts hold. `smooth` glides on `spring.price`. | `spring.price`, `tween.flash` |

### Live indicators: `ValueFlash` · `PulseDot` · `DotMatrix`
- `ValueFlash` / `useValueFlash` – up/down flash on pre-rendered `bg-win/15` / `bg-loss/15` layers (opacity only); reduced motion: 2 px underline. `tween.flash`.
- `PulseDot { tone?; size?; rings? 1|2; active?; ping?; label? }` – live dot with ping rings; `ping` MotionValue fires a per-trade
  ping ≤ 4 Hz; rings ping 3× (`tween.pingFew`) on start / re-entry, then rest; pause off-screen; aria-hidden unless `label`. `tween.pingFew/ripple/flash`.
- `DotMatrix` – LED matrix, zero React renders (imperative opacity writes in `frame.render`), useId ids, one glow layer, no aria-live.
  Presets `text` (5×7 digits), loader, pulse, wave, snake, chevrons; `meter` = scrolling VU from a MotionValue (`signed`: buys up,
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
- `usePressable({ disabled?, scale? (.96), hover?, transition? })` → `{ whileTap, whileHover (hover devices), transition: spring.press }`.
- `useMediaQuery(q, fallback)`, `useCanHover()`, `useIsDesktop()` (≥ 640 px).
- `a11y.ts`: `useFocusTrap(ref, active, settled?)`, `useScrollLock(active)`, `useInertOutside(ref, active, settled?)`,
  `useEscape(active, onClose)`, `useDialogBehaviour(ref, active, onClose, { settled? })`:
  - focus moves into the panel and Tab is trapped at once; `inert` is applied when `settled` is true (open morph done);
  - after close, lifting `inert` and then returning focus wait for `settled` (exit / reverse morph done);
  - each deferral is bounded by `SETTLE_FALLBACK_MS` (700); omitting `settled` gives immediate behaviour; focus is not returned if the
    user focused something else meanwhile; `INERT_EXEMPT_SELECTOR` (`[aria-live]`, the toast island) is never made inert.
  - `MorphDialog`, `Sheet` and `TradeDetail` pass `settled`.
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
| `AsciiCascade` (`color`, `scrambleColor`, `scrambled`, `reserve`, `drop`) | text-ascii-cascade | intro wordmark (starts `scrambled` – never flashes the answer first); header logo click (decode after the replay); MarketPanel scenario lead on a scenario change (`color="inherit"` keeps the tone) |
| `PixelTextFill` | pixel-text-fill | intro statement; page subtitles once per session (`LeadFill`: Trades, Entscheidungsgrundlagen, Einstellungen) |
| `Typewriter` | text-animate | intro data line (real counts + live price); `EmptyState` line (`line` prop, "Keine Treffer": "Filter lockern oder zurücksetzen.") |
| `TextMorph` | text-morphing | every string `StatusPill` label; MarketPanel scenario key word |
| `TextPrism` (`colors`) | text-prism-split | Hero Netto-P&L; lens and copies only on hover devices (touch renders the plain figure, no copies); copies always take their layer colour |
| `DancingLetters` · `DancingSvgWord` | dancing-letters | header wordmark (hover); footer outline wordmark |
| `TactileHighlight` (`padX`, `tab`) | tactile-highlight | verdict key words (`VerdictPanel`), scenario key word, `LeadFill` key word – inline places pass `tab={false}` (the 90 ms tab would cross the preceding text) |
| `MorphSelect` | morphing-language-selector | `#f-tf` timeframe, Trades setup filter, `#s-currency` |
| `Autocomplete` | autocomplete | Trades search (grouped suggestions); `#s-symbol` (Binance futures symbols → `BINANCE:…`) |
| `NotchedFrame` | notched-project-card | setup cards (CSS in `@layer components`, utilities win) |
| `WidgetGrid` · `useLift` | draggable-widget-grid | MarketPanel mini tiles (order in `tj2-ui-market-tiles`); RulesCard / SetupEditor checklist lift |
| `StripWipe` · `playStripWipe` | parallax-strip-slider | chart interval switch (10 strips from an opaque snapshot) |
| `Marquee` (`paused`) | motion-footer | footer stats band; `paused` follows the footer's reveal hysteresis (hidden at ≤ 50 % in view), so it resumes where it stopped |

Built on the same engine outside this folder: the intro (`src/intro`, glyph-portal / reel-collage / slanted-spread /
cinematic-orbit / product-launch), the dock labels + magnification and the command navigation (`src/app`), the
equity replay scrubber (`src/chart/EquityChart.tsx`) and the Hochrechnung milestone rail (`views/overview`).

Intro gating: first-view effects inside an overview cell wait for `useIntroLanded()` / `useIntroGate()`
(`src/intro/introStore.ts`); `TactileHighlight playOnView` does this itself.

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
| Dock (`src/app/README.md`) | tap hop by press length (`hopFor(lastPressMs())`: `spring.pop` → `spring.smooth`), touch scrub (`data-scrub`), flick-to-switch (`flickStep` → `setNavTempo` → PageHost `contextSpringAt(spring.pageEnter, consumeNavTempo())`, faster `flickHop`), re-tap = scroll to top + dip; `dock-bg` / `dock-dot` keep `spring.layout` |
| `Segmented` | iOS press-slide-release (preview under the finger + haptic, ONE `onChange` on release, a flick > 600 px/s snaps to the projected segment); thumb `contextSpringAt(spring.segment, tempo)`, ghost `contextSpring(spring.hover, speed)` |
| `HoverPill` · `RowHighlight` | `contextSpring(spring.hover, pointerSpeed())` sampled when a row claims the pill (focus: 0); `isRealHover()` (last pointer was a mouse) gates `HoverPill`, the table only hovers for non-touch pointers – nothing stays lit after a tap |
| `WidgetGrid` (market tiles, checklist lift) | throw: velocity tracker per drag, a release ≥ `CONFIG.throwMinSpeed` lands on the slot at `throwTarget` (projection with `CONFIG.throwRate`), tilt `CONFIG.tiltPerSpeed` (≤ `tiltMax`°, `tiltSpring`), drop `mixSpring(spring.layout, CONFIG.dropFast, tempo)` |
| `MorphSelect` · `Autocomplete` | press-drag-release (mouse: a vertical drag opens the menu; touch: hold still `CONFIG.pressHoldMs` and it opens under the finger, the page scroll blocked for that gesture only; the row under the finger by arithmetic `rowAtPoint`, release selects, the trigger click is swallowed), fling-to-close with `progressVelocity`; coarse rows `CONFIG.rowHCoarse` (`placePanel(…, rowH)`) |
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
  `position:fixed` or overflow-escaping UI inside those cards.
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
on hide and re-run on show (keep them re-entrant and cheap – ChartCard's `history()` must hit the cache, the chart is recreated from
the `candles` prop), the hidden DOM stays in the document (no real `<table>`, no labels/texts colliding with other pages' selectors),
and MotionValue text may show its last value for one tick after the page is shown again.

## layoutId contracts

| id | source → target | transition | rule |
|---|---|---|---|
| `hover-{group}` (`bt`, `rank`, `recent`) | `HoverPill` between rows of one list | `spring.hover`, opacity `tween.hoverPill` | one group per card |
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
| `dock-dot`, `dock-bg` | active dock item (inside the magnified item) | `spring.layout` | singletons, `borderRadius 9999`, intentionally NO `layoutDependency` (see `src/app/README.md`) |
| `status-{feed}` | `StatusPill` header ↔ card | `spring.pill` | optional |
| `chart-range` | RangePills thumb | `spring.layout` | one per chart card, `layoutDependency={value}`, `borderRadius radius.thumb` |

Every element above sets `style={{ borderRadius }}` (`radius.card 16`, `radius.dialog/sheet 28`, `radius.pill 9999`, `radius.hover 12`, `radius.thumb 8`).
`position:fixed` panels carry `layoutRoot`; scrolling ancestors of `layout` elements carry `layoutScroll` (sheet/dialog body, table wrapper).
