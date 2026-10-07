# `src/primitives` – Nothing-design component kit

All class strings are 1:1 from the original bundle (Plan 2.5); all springs/tweens from `@/motion/tokens`. Import from `@/primitives` (barrel).
UI strings are German. Every component is dark-only, keyboard-accessible and respects reduced motion.

| component | props | notes |
|---|---|---|
| `Card` | `{ children; title?; action?; note?; bare?; gradientSize? (240); gradientFrom? (#9b9b9b); gradientTo? (#2c2c2c); gradientColor?; edgeGlow? (true); className?; innerClassName?; …HTMLMotionProps<"div"> }` | Compositor-only spotlight: two pre-rendered radial blobs (a border tint inside an `fx-ring` mask + the inner glow) move by transform; the rect is measured on pointerenter and after scroll/resize, never per move. Proximity arc (21st.dev "Glowing Effect"): a pre-rendered conic arc rotated on `spring.smooth`, lit within 64 px of the card, off in the centre, ≤ 4 cards at once, never behind `[inert]` (`glowField.ts`); `gradientFrom` also tints it. Fine pointers only; static border under reduced motion. Root `div.group` + `<h2 class="label">` with the red dot unchanged. `className` styles the inner surface, not the outer wrapper: grid placement (`lg:col-span-*`) goes on the wrapping cell. |
| `Button` | `{ variant?: "ghost"\|"primary"\|"danger"; size?: "sm"\|"md"; ripple? (true); …HTMLMotionProps<"button"> }` | `whileTap {scale .96}` `spring.press`; press ripple from the pointer (centre for keys) on `tween.ripple`, coloured by `rippleColor[variant]` (`spawnRipple`, `ripple.ts`), never while disabled or under reduced motion. Exports `buttonBase`, `buttonVariant`, `buttonSize`, `rippleColor`. Coarse pointers: `.touch-hit` (≥ 44 × 44 tap area, no layout change). |
| `Input` / `Textarea` | `InputHTMLAttributes & { numeric?; invalid?; wrapperClassName? }` | The control sits in `span[data-input]` (use `wrapperClassName` for layout). A pre-rendered focus ring (`--ring-glow-input`, `--ring-glow-invalid` when invalid) fades/scales in with `peer-focus`, plus a pulse ring `[data-input-pulse]`. `numeric` → `inputMode="decimal" font-mono`. Exports `inputClass`. |
| `Field` | `{ label; htmlFor?; children; help?; error?; suffix?; invalidKey?; className? }` | Root `[data-field]`; `invalidKey` shakes the field (`SHAKE_X` on `tween.shake`) and pulses its border (`tween.flash`) whenever the key changes; the error line (`role="alert"`, id `{htmlFor}-error`) fades in. Imperative: `shakeField(elOrId)`, `useShake()`, `revealInvalid(idOrEl, { reduced })` (`fieldFx.ts`). |
| `Segmented<T>` | `{ options: {v,label,disabled?}[]; value; onChange; size?; tones?; className?; aria-label? }` | `role="radiogroup"`, roving tabindex; thumb `layoutId="bg-{useId}"` `layoutDependency={value}` `spring.segment` `borderRadius 8`; hover ghost `layoutId="seg-hover-{useId}"` (`spring.hover`, opacity `tween.hoverPill`, below the thumb, hover devices only, none under reduced motion); only the label scales to .97 when pressed (`spring.press`). Physics (additive, `@/motion/physics`): iOS press-slide-release (after 10 px, angle-locked; the thumb previews the segment under the finger with a selection haptic; release commits ONE `onChange` – a flick > 600 px/s picks the segment nearest to the projected position; the click after it is swallowed; `touch-action: pan-y`; a native non-passive touchmove guard (`useTouchMoveGuard`) while sliding, so Chrome never swallows the next tap after a fast slide), thumb on `contextSpringAt(spring.segment, tempo)` / ghost on `contextSpring(spring.hover, speed)` (the tokens themselves for taps / keys). `aria-checked` = `value` only (`data-checked` follows the visible thumb). Coarse pointers: segments ≥ 44 px wide, tap area 44 px tall (::after, vertical only). Pure `segmentAt(row, x)`. |
| `Badge` | `{ tone?; children; className?; title?; dot?; ping? }` | `dot` adds a tone dot, `ping` a `.fx-ping` ring on it (live mode). Exports `badgeTone`. |
| `CheckboxRow` | `{ checked; onToggle; children; sub?; disabled?; strike?; className? }` | `role="checkbox"`; the box pops on `spring.pop` and its fill scales in, check `pathLength` on `tween.check`; the row tint is a pre-rendered `[data-tint]` layer crossfaded by opacity; `strike` draws a strike-through (clip-path wipe `.fx-strike`, plain-string labels) and dims the label. |
| `EmptyState` | `{ title; text?; action?; className? }` | `.fx-ants` marching border (`data-idle` pauses it off-screen), a `DotMatrix` ∅ glyph breathing in a diagonal wave (`EMPTY_GLYPH_FRAMES`, `emptyGlyph.ts`), CTA sheen: a `::after` band on `fx-shimmer-x` (`tween.shimmer` timing) started by `[data-shine]` on first view; the CTA button gets `overflow-hidden`. |
| `Label` | `{ children; as?; htmlFor?; dot? (true); className?; id? }` | `<h2 class="label">` + `size-1.5 rounded-full bg-signal`. |
| `StatTile` | `{ fact; label; value; suffix?; verdict?; active; onActivate?; body; loading?; className? }` | Memoised hero KPI. `MorphCard id="fact-{fact}"` + `MorphTitle`. String values count up on first view (`spring.number`, final text `.sr-only`) and `TextRoll` on later changes; `loading` → Skeleton; hover lift scale 1.03 / y −2 on a NON-layout wrapper (`spring.hover`) + crossfaded highlight – hover devices only (`useCanHover`), so a tap / focus return never leaves a touch tile lifted; content wrapper `layoutDependency={active}`; verdict = an out-of-flow popover above the tile (`bottom-full`, `line-clamp-3`, `sm+`), clip-path reveal `tween.verdict` – the row never re-lays out. |
| `Expander` / `Collapse` | `{ open; onToggle; label; controls?; className? }` / `{ open; children; className?; id? }` | `+` toggle (icon 45° `spring.plus`, press .88 + a pre-rendered white disc popping on `spring.pop`); `Collapse` = declared height tween `tween.collapse`, content settles from y −6. |
| `RingGauge` | `{ value; marker?; size? (148); stroke? (9); color?; passColor?; track?; children?: ReactNode \| (progress: MotionValue<number>) => ReactNode; aria-label? }` | Draws on first view (`tween.gauge`) with a riding tip dot; the needle pops (`spring.pop`) as the draw starts. `passColor`: a pre-rendered second arc crossfades in (`tween.crossfade`) when the drawn tip crosses `marker`; an upward crossing flashes a halo (`tween.flash`). Render-prop `children` gets the frame-synced progress (centre counter). Pure helper `crossing(prev, next, marker)`. |
| `ConvictionRadio` | `{ value; onChange; options?; className? }` | 1–5, `aria-label="Überzeugung"`, 12-particle burst `spring.burst` (skipped under reduced motion). |
| `ToastIsland` | `{ toasts?: IslandToast[]; onDismiss?; className? }` | The ONLY `[role=status][aria-live=polite]` region (`data-toast-island`), one toast at a time, 44×44 → auto×50 (`spring.toast`, declared exception). `IslandToast.duration` (ms, `0` = sticky): the island owns the dismiss timer – it starts when the toast reaches the front of the queue and pauses on hover / focus / drag / a finger or pen resting on it (`[data-held]`), with a compositor remaining-time bar (`.fx-countdown`). Drag-x to dismiss (`gesture.toastSwipe` px or `gesture.toastFlick` px/s; flings out `gesture.toastFling` on `tween.toastExit`). Win toasts roll their value up (`spring.number`, `rollValue.ts`, final text `.sr-only`) under a green glow (`tween.burst`); the `+n` queue badge pops and rolls (`spring.pop`). The ui store never auto-dismisses. |
| `toastStore` | `useToasts()`, `useToastStore`, `toast.ok/warn/error/push/dismiss/clear`, `toastDuration(kind)` | Standalone store (the shell uses `uiStore.toasts` instead). |
| `SetupChip` / `SetupChips` | `{ name; color; className? }` / `{ items; max? (2); className? }` | `+n` overflow, empty → `ohne Grundlage`. |
| `Sparkline` | `{ values; className?; stroke?; dot? }` | Resampled to 20 points; first-view draw-in (`tween.draw`, clip-path) and an end ring (`tween.ping`). |
| `SplitText` | `{ text; className?; force? }` | Letter reveal `spring.reveal`, transform-only shimmer `tween.shimmer`; once per session. |
| `Magnetic` / `Tilt` | `{ children; intensity?; range?; remeasure?; className? }` / `{ children; factor?; className? }` | Cached rects (`useHoverRect`, re-read after scroll/resize only); `remeasure` re-measures per move in `frame.read` for hosts that magnify (the dock). Mouse only, off under reduced motion. |
| `BorderBeam` | `{ size?; duration?; delay?; colorFrom?; colorTo?; borderWidth?; fire?; className? }` | A conic beam rotating under an `fx-ring` mask, looped by CSS `fx-spin` (compositor; no `offset-path`); `fire` runs ONE lap on `tween.burst` per new truthy value (level crossings, scenario changes). |
| `Skeleton` / `ChartSkeleton` / `SkeletonSwap` | `{ className?; style?; height? }` / `{ height?; className? }` / `{ ready; skeleton; children; className? }` | Transform-only shimmer band (`animate-fx-shimmer`). `SkeletonSwap` swaps in one grid cell with no layout shift: content fades and de-blurs in on `tween.fade` (ends at `filter: none`), the skeleton leaves on `tween.exit`. |
| `icons` | `Icon`, `GlyphPlus`, `GlyphClose`, `GlyphCheck { drawn?, transition? }`, `GlyphCross`, `GlyphInfo`, `LiveRing` | Inline SVG, `stroke="currentColor"`. |
| `WarnBanner` | `{ open? (true); children; action?; className? }` | After-boot enter: y −8 + top-down clip wipe on `tween.reveal` (y on `spring.layout`, ends at `clip-path: none`); warn dot with 3 soft `.fx-ping` pulses; exit `tween.exit`. |
| `Tooltip` / `TooltipBox` / `TooltipRow` | `{ content; children; side?; sideOffset?; className?; delayDuration? }` | `.fx-pop` enter and exit; `tooltipClass` exported. Opens on TAP too (touch / pen tap toggles a controlled `open`, decided from the state at pointer-down – the dismissable layer closes on any outside pointer-down, the trigger included; a tap elsewhere closes); mouse / keyboard keep Radix' hover / focus; the trigger's own `onClick` still runs; `collisionPadding 12`, `max-w-[min(280px,100vw−24px)]`. |
| `FormulaBlock` / `FormulaRows` | `{ children }` / `{ rows }` | Explainer formula + `dl sm:grid-cols-2`. |
| `VerdictPanel` / `Explainer` | `{ tone; children }` / `{ d; bare? }` | `VerdictPanel`: one-shot tone band sweep (`tween.draw`, after its section appeared) on first view and per tone change. `Explainer`: what / formula / rows / verdict are `StaggerItem`s – bare explainers cascade with the MorphDialog / Sheet body, framed ones run their own stagger. |
| `HeroBackdrop` | `{ className? }` | Canvas dot flicker on the 18 px grid (`heroField.ts`, `fxTiming.matrixFps` steps/s), sleeps off-screen / in hidden tabs / `dwell.heroFlicker` after mount or the last pointer activity; pointer spotlight moved by transform (`spring.smooth`) with a counter-shifted grid. Reduced motion: the static bundle backdrop. |

Helpers (all from `@/primitives`):

| module | exports | notes |
|---|---|---|
| `glowField.ts` | `registerGlow(el, listener)`, `primeGlowRect`, `GLOW_PROXIMITY` (64), `GLOW_INACTIVE_ZONE`, `MAX_ACTIVE_GLOWS` (4) | one shared pointer listener for every `Card` arc; pure maths (`readGlow`, `pickGlows`) unit-tested |
| `hoverRect.ts` | `useHoverRect()`, `HoverRectTracker` | rect cached per hover, invalidated on scroll/resize |
| `ripple.ts` | `spawnRipple(host, geo, color)`, `rippleGeometry`, `MAX_RIPPLES` (3) | WAAPI ripple, pooled |
| `fieldFx.ts` | `shakeField`, `useShake`, `revealInvalid`, `rectFullyVisible`, `SHAKE_X`, `PULSE_OPACITY`, `SCROLL_SETTLE_MS` | `revealInvalid(idOrEl, { reduced })`: focus without jump → smooth scroll into view if needed (page or scrolling sheet body) → shake + pulse once visible |
| `revealValue.ts` | `useRevealValue(ref, target, { transition, from?, delay?, enabled?, onReveal? })`, `useSeenOnce(ref)`, `canRevealOnView` | fill-on-first-view MotionValue, zero renders (see `src/motion/README.md`) |
| `emptyGlyph.ts` | `EMPTY_GLYPH`, `EMPTY_GLYPH_FRAMES`, `breathingFrames` | dot-matrix ∅ for `EmptyState` |
| `rollValue.ts` | `parseRollValue`, `formatRoll` | toast win-value roll |
| `heroField.ts` | `createField`, `stepField`, `FIELD_*` | pure flicker state for `HeroBackdrop` |

## Usage snippets

```tsx
import { Card, Button, Field, Input, Segmented, Badge, StatTile, ToastIsland, toast, shakeField } from "@/primitives";
import { MotionRoot, MorphDialogProvider, MotionNumber, useAnimatedNumber } from "@/motion";

<MotionRoot>
  <MorphDialogProvider>
    <Card title="Letzte Trades" action={<Button size="sm">Alle ansehen →</Button>}>…</Card>
    <Field label="Einsatz" htmlFor="stake" suffix="USDT"><Input id="stake" numeric /></Field>
    <Segmented aria-label="Richtung" options={[{ v: "long", label: "Long" }, { v: "short", label: "Short" }]} value={side} onChange={setSide}
      tones={{ long: "bg-win/15 border-win/30", short: "bg-loss/15 border-loss/30" }} />
    <Badge tone="win">Gewinn</Badge>
    <ToastIsland />
  </MorphDialogProvider>
</MotionRoot>

// hero KPI tiles – the P&L MotionValue is shared with the fact dialog
const pnl = useAnimatedNumber(stats.net);
<StatTile fact="net" label="Netto-P&L" active={hover === 0} onActivate={() => setHover(0)}
  value={<MotionNumber source={pnl} decimals={2} signed tone="auto" />}
  verdict={{ tone: "win", text: "…" }}
  body={() => <Explainer bare d={{ what: "…", rows: [["Trades", "12"]], verdict: { tone: "win", text: "…" } }} />} />

toast.ok("Trade gespeichert", { value: "+120,50 USDT", valueTone: "win" });
shakeField("s-makro"); // invalid field: shake + border pulse (or `<Field invalidKey={errorCount}>`)
```

## CSS
`src/styles/shiny-cta.css` – complete `.shiny-cta` block (FAB: `<button class="shiny-cta"><span>…</span></button>`) and the
`.hero-backdrop` utility.

fx kit (`src/styles/tokens.css`): utilities `fx-ring`, `animate-fx-ping`, `animate-fx-shimmer`, `animate-fx-spin`; classes `.fx-ping`,
`.fx-countdown`, `.fx-ants` (`--fx-ants-color/dash/width/speed`), `.fx-shimmer-text` (+ `__band`, `__copy`), `.fx-strike`
(`data-strike` / `data-struck`) and `.fx-pop`. All animate transform or opacity only (the strike uses clip-path); each class's resting
style is its reduced-motion fallback. Timings mirror the TS tokens (list at the end of `src/motion/tokens.ts`).

`src/styles/base.css` (touch + display):
- `.touch-hit` – coarse pointers: an invisible centred `::after` grows the tap area to ≥ 44 × 44 without a layout change;
  `.touch-hit-y` the same, vertical only (dense rows of side-by-side controls); `.touch-hit-links` gives every `<a>` inside the
  same area (markup we don't render, e.g. the chart attribution). All in `@layer components`, so `absolute` / `fixed` / `sticky`
  utilities on the element still win over the `position: relative` they set.
- `--safe-bottom` = `max(env(safe-area-inset-bottom), var(--vv-bottom))`: the bottom inset every pinned-to-bottom element uses
  (dock, toast island, footer padding, bottom fade, `scroll-padding-bottom`); `--vv-bottom` is written by `src/app/pwa.ts`.
- `color-scheme: only dark` (+ an explicit `prefers-color-scheme: dark` block), `-webkit-tap-highlight-color: transparent`,
  no callout / selection on header and nav in an installed app.
