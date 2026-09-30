# `src/primitives` – Nothing-design component kit

All class strings are 1:1 from the original bundle (Plan 2.5); all springs/tweens from `@/motion/tokens`. Import from `@/primitives` (barrel).
UI strings are German. Every component is dark-only, keyboard-accessible and respects reduced motion.

| component | props | notes |
|---|---|---|
| `Card` | `{ children; title?; action?; note?; bare?; gradientSize? (240); gradientFrom? (#9b9b9b); gradientTo? (#2c2c2c); gradientColor?; className?; innerClassName?; …HTMLMotionProps<"div"> }` | Spotlight border via MotionValues + `useMotionTemplate` (`frame.read` measuring), sheen + glow layers, hover lift (CSS 500 ms), pre-rendered shadow layer crossfaded by opacity. `title` renders `<h2 class="label">` with the red dot; inner `flex h-full flex-col p-5` unless `bare`. |
| `Button` | `{ variant?: "ghost"\|"primary"\|"danger"; size?: "sm"\|"md"; …HTMLMotionProps<"button"> }` | `motion.button`, `whileTap {scale .96}` `spring.press` (off when disabled). Exports `buttonBase`, `buttonVariant`, `buttonSize`. |
| `Input` / `Textarea` | `InputHTMLAttributes & { numeric?; invalid? }` | Bundle `ze`; `numeric` → `inputMode="decimal" font-mono`. Exports `inputClass`. |
| `Field` | `{ label; htmlFor?; children; help?; error?; suffix?; className? }` | `.label` + control; `suffix` (`USDT`, `x`) inside; `error` → `role="alert"` with id `{htmlFor}-error`. |
| `Segmented<T>` | `{ options: {v,label,disabled?}[]; value; onChange; size?; tones?: Record<T,string>; className?; aria-label? }` | `role="radiogroup"`, roving tabindex, ←→↑↓ Home End; thumb `layoutId="bg-{useId}"` `spring.segment` `borderRadius 8`; item `whileTap .97`. |
| `Badge` | `{ tone?: "win"\|"loss"\|"warn"\|"mute"\|"steel"\|"teal"; children; className?; title? }` | Exports `badgeTone`. |
| `CheckboxRow` | `{ checked; onToggle; children; sub?; disabled?; className? }` | `role="checkbox"`, SVG check `pathLength` on `tween.check`. |
| `EmptyState` | `{ title; text?; action?; className? }` | dashed box. |
| `Label` | `{ children; as?: "h2"\|"h3"\|"span"\|"div"\|"label"\|"dt"; htmlFor?; dot? (true); className?; id? }` | `<h2 class="label">` + `size-1.5 rounded-full bg-signal`. |
| `StatTile` | `{ fact; label; value; verdict?: {tone,text}\|null; active; onActivate?; body: () => ReactNode; className? }` | Hero KPI: `motion.div layout style={{flexGrow}}` `spring.layout`; `MorphCard id="fact-{fact}"` + `MorphTitle` (`morph-title-fact-{fact}`); `+` glyph rotates 90°; verdict clip-path reveal `tween.verdict`, exit `tween.exit`. |
| `Expander` / `Collapse` | `{ open; onToggle; label; controls?; className? }` / `{ open; children; className?; id? }` | `+` toggle (`aria-label` `Details zeigen: …`/`Details schließen: …`, icon 45° `spring.plus`); `Collapse` = height 0↔auto `tween.collapse`. |
| `RingGauge` | `{ value: number\|null; marker?; size? (148); stroke? (9); color? (#f2f2f2); track? (#222); children; aria-label? }` | `strokeDashoffset` `tween.gauge` `initial:false`, needle marker. |
| `ConvictionRadio` | `{ value: Conviction\|null; onChange; options?; className? }` | 1–5 (`Schwach Gering Mittel Hoch Top`, `--conv-1..5`), `aria-label="Überzeugung"`, 12-particle burst `spring.burst` stagger .03 (skipped under reduced motion). |
| `ToastIsland` | `{ toasts?; onDismiss?; className? }` | Fixed above the dock, `aria-live="polite"`, one toast at a time, 44×44 → auto×50 (`spring.toast`, declared exception `// motion-exception: toast-island`), exit `tween.toastExit`, check `tween.checkToast`; auto-dismiss 2800 ms / `warn` 5200 ms. |
| `toastStore` | `useToasts() → Toast[]`, `useToastStore`, `toast.ok/warn/error/push/dismiss/clear`, `toastDuration(kind)` | `Toast = { id; kind: "ok"\|"warn"\|"error"; title; value?; valueTone?; detail? }`. |
| `SetupChip` / `SetupChips` | `{ name; color; className? }` / `{ items: {id,name,color}[]; max? (2); className? }` | `+n` overflow, empty → `ohne Grundlage`. |
| `Sparkline` | `{ values: number[]; className?; stroke?; dot? }` | Resampled to 20 points (`resample(values, 20)` exported), `d`/`cx`/`cy` MotionValues animated with `tween.bar` and written to the DOM directly. |
| `SplitText` | `{ text; className?; force? }` | Letter reveal `spring.reveal` (delay `.1 + i·.035`), transform-only shimmer `tween.shimmer`; once per session (`sessionStorage` `tj2-intro`), static under reduced motion. |
| `Magnetic` | `{ children; intensity? (.35); range? (90); className? }` | `spring.magnet`, mouse only, gated. |
| `Tilt` | `{ children; factor? (6); className? }` | `rotateX/Y ±factor`, perspective 900, `spring.tilt`, mouse only, gated. |
| `BorderBeam` | `{ size? (80); duration? (9); delay?; colorFrom?; colorTo?; borderWidth?; className? }` | `offset-path` loop; mount only when `status==="live"` **and** hovered; renders nothing under reduced motion. |
| `Skeleton` / `ChartSkeleton` | `{ className?; style?; height? }` / `{ height? (268); className? }` | `bg-white/[0.04]` + transform-only shimmer (`@keyframes shimmer-x`, `motion-reduce:hidden`). |
| `icons` | `Icon { name: "grid"\|"list"\|"target"\|"sliders"\|"plus"\|"x"\|"search" }`, `GlyphPlus`, `GlyphClose`, `GlyphCheck { drawn?, transition? }`, `GlyphCross`, `GlyphInfo`, `LiveRing { progress, spinning?, stroke? }` | Inline SVG, `stroke="currentColor"`; size via `className`. |
| `WarnBanner` | `{ open? (true); children; action?; className? }` | `Lokaler Modus` banner, exit `tween.exit`, `layout` `spring.layout`. |
| `Tooltip` / `TooltipBox` / `TooltipRow` | `{ content; children; side?; sideOffset?; className?; delayDuration? }` | Wrapper over `@/ui/tooltip` with the chart-tooltip class string (`tooltipClass` exported); `TooltipBox`/`TooltipRow` for Recharts `content`. |
| `FormulaBlock` / `FormulaRows` | `{ children }` / `{ rows: [label, value, toneClass?][] }` | Explainer formula + `dl sm:grid-cols-2`. |
| `VerdictPanel` / `Explainer` | `{ tone: "win"\|"loss"\|"warn"\|"mute"; children }` / `{ d: { title?, what, formula?, rows?, verdict? }; bare? }` | Verdict tones (Plan 2.5); `Explainer` = Bundle `vi` (use `bare` inside `MorphDialog`). |
| `HeroBackdrop` | `{ className? }` | Three gradients + 18 px dot grid (inline styles); CSS twin `.hero-backdrop` in `styles/shiny-cta.css`. |

## Usage snippets

```tsx
import { Card, Button, Field, Input, Segmented, Badge, StatTile, ToastIsland, toast } from "@/primitives";
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
```

## CSS
`src/styles/shiny-cta.css` – complete `.shiny-cta` block (FAB: `<button class="shiny-cta"><span>…</span></button>`), `.hero-backdrop`
utility and `@keyframes shimmer-x` (Skeleton). The lead may move the last two into `base.css`.
