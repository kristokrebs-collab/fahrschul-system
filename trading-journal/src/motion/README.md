# `src/motion` – motion system

Apple-grade motion layer for the Trade Journal. Everything animates only `transform`, `opacity`, `filter`
and `clip-path`; size/position changes go through `layout`/`layoutId`; every `layout` element sets
`borderRadius` via `style` from `radius`; every spring/tween comes from `tokens.ts`. Import from
`@/motion` (barrel) or the individual files.

Declared exceptions (Plan 3.2 rule 1): `// motion-exception: toast-island` (`primitives/Toast.tsx`) and
`// motion-exception: dock-magnify` (dock, not in this folder).

## `tokens.ts`

`spring`, `ease`, `tween`, `stagger`, `radius` – the lead's file, extended additively:

| added | value | used by |
|---|---|---|
| `spring.pill` | `{stiffness 224, damping 30}` (0.42 s response, critically damped) | `StatusPill` layout |
| `tween.sheetBody` | `.3 s ease.out` | `Sheet` body after the morph |
| `tween.check` / `tween.checkToast` | `.25 s` / `.35 s delay .15` | `CheckboxRow`, toast check mark |
| `tween.toastExit` | `.22 s` | toast island exit |
| `tween.hoverPill` | `.15 s` | `HoverPill` opacity |
| `tween.shimmer` | `delay .7, 1.1 s easeInOut` | `SplitText` sweep |
| `tween.tooltipIn` | `.2 s` | dock tooltip |
| `tween.beam` / `tween.skeleton` | `9 s` / `1.6 s` linear ∞ | `BorderBeam`, `Skeleton` |
| `radius.hover 12`, `radius.thumb 8`, `radius.toastStart 22`, `radius.toastEnd 25`, `radius.fab 999` | | `HoverPill`, `Segmented`, `Toast`, FAB |

## Components

### `MotionRoot`
```tsx
<MotionRoot>{app}</MotionRoot>
// = <MotionConfig reducedMotion="user" transition={spring.smooth}><LayoutGroup>…</LayoutGroup></MotionConfig>
```
One id-less `LayoutGroup`; `layoutId`s are global and de-duplicated by naming/conditions (see contracts).

### `PageSwitch`
`{ index: number; pageKey?: string|number; children; onTransitioning?: (t: boolean) => void; rememberScroll?: boolean (true); className? }`
`AnimatePresence mode="popLayout" initial={false}`; enter `{x: dir·16, opacity 0}`, exit `{x: −dir·12}`; `x: spring.smooth`,
opacity `tween.page` / `tween.exit`. `dir` = sign of the index difference. Container `motion.div layout relative`, page `layout="position"`.
`onTransitioning(true)` on change, `false` after exit **and** enter completed → drive `uiStore.transitioning` (detail opening locked meanwhile).
Remembers `window.scrollY` per index.
```tsx
<PageSwitch index={pages.indexOf(page)} pageKey={page} onTransitioning={ui.setTransitioning}>{view}</PageSwitch>
```

### `MorphDialogProvider` · `useMorphDialog` · `MorphCard` · `MorphTitle`
Card → 620 px dialog morph (Plan 2.5 "Morph-Dialog"), portal-less, with focus trap, scroll lock, `inert` on siblings, Escape/overlay close.
- `MorphDialogProvider` – mount once at app level (inside `MotionRoot`). Renders backdrop `fixed inset-0 z-[70] bg-ink-950/75` (`tween.fade`/`tween.exit`)
  and the panel `layoutId="morph-{id}"` `layoutRoot` `borderRadius 28` `transition.layout = spring.morph`; sticky head with `motion.h2 layoutId="morph-title-{id}"`,
  close button `aria-label="Schließen"`; body enters `tween.body`, exits `tween.exit`.
- `useMorphDialog()` → `{ open, settled, show({ id, title, body, className? }), close() }`. `body` may be a function (evaluated on open).
- `MorphCard` `{ id; title; body: () => ReactNode; children; className?; as?: "button"|"div"; borderRadius?: number (16); dialogClassName?; motionProps? }`
  – the source: `layoutId="morph-{id}"`, `style.borderRadius`, `aria-haspopup="dialog"`. After the dialog's `onLayoutAnimationComplete` the source is
  `visibility:hidden` (no `opacity-0` pop) and becomes visible again as soon as `close()` runs so the reverse morph crossfades into it.
- `MorphTitle` `{ id; as?: "span"|"dt"|"h3"|"div"; className?; children }` – `layoutId="morph-title-{id}" layout="position"`, put it inside the card so the title travels.
```tsx
<MorphCard id={`fact-${key}`} title="Netto-P&L" body={() => <Explainer bare d={data} />} className="rounded-2xl border …">
  <MorphTitle id={`fact-${key}`} as="dt" className="label">Netto-P&L</MorphTitle>
  <dd className="num font-mono text-[17px]">…</dd>
</MorphCard>
```
Pills (`Details +`, `+ Ablesung`) pass `borderRadius={radius.pill}`.

### `Sheet`
`{ open; onClose; title; size?: "md"|"lg" (540/860 px); layoutId?; headerExtra?; footer?; children; className?; onOpened? }`
Overlay `fixed inset-0 z-[60] grid items-end … sm:place-items-center` (`tween.fade`/`tween.exit`); panel `role="dialog" aria-modal` `layoutRoot`
`borderRadius 28`, header `h2 text-[17px] font-semibold` + close `aria-label="Schließen"`, body `motion.div layoutScroll min-h-[40vh] overflow-y-auto px-6 py-5`,
footer slot with the safe-area padding. Focus trap, scroll lock, `inert`, Escape.
- with `layoutId` (`new-trade`, `setup-card-{id}`): panel morphs on `spring.sheet`; body mounts after `onLayoutAnimationComplete`, then `{opacity 0, y 8}→{1,0}` `tween.sheetBody`.
- without: desktop `{y 40, opacity 0, scale .98}` ↔ exit `{y 30 …}` on `spring.sheet`; mobile (< sm) `y 100%→0` on `tween.sheetIos`,
  `drag="y"` `dragElastic .05`, dismiss when `offset.y > 120 || velocity.y > 800`.
```tsx
<Sheet open={editing} onClose={close} title="Grundlage bearbeiten" layoutId={`setup-card-${id}`} footer={<Button variant="primary">Speichern</Button>}>…</Sheet>
```
The source (FAB disc / setup card) must set `visibility:hidden` while the sheet is open (pattern as in `MorphCard`).

### `HoverPill` · `useHoverGroup`
`HoverPill { show; group: "bt"|"rank"|"recent"|string; className? }` → `layoutId="hover-{group}"`, `absolute inset-0 rounded-xl bg-white/[0.055] ring-1 ring-white/[0.08]`,
`style.borderRadius 12`, `spring.hover`, opacity .15 s (exit delayed .15 s). Parent row must be `relative`.
`useHoverGroup<T>()` → `{ hovered, bind(id) → { onMouseEnter, onMouseLeave, onFocus (focus-visible only), onBlur }, clear() }`.

### `MotionNumber` · `useAnimatedNumber` · `formatNumber` · `toneOf`
`MotionNumber { value?: number|null; source?: MotionValue<number>; decimals?; prefix?; suffix?; signed?; format?; tone?: "auto"|"none"; gate?: boolean; transition?; className?; aria-label? }`
`useMotionValue` + `animate(mv, value, spring.number)`, text via `useTransform` rendered as a MotionValue child (zero re-renders), de-DE, `−`, `tabular-nums`.
`tone="auto"`: three stacked spans (`text-win`/`text-loss`/`text-fg`) crossfaded on `tween.crossfade`; only the current one is not `aria-hidden`.
`gate`: animates only while in view (`IntersectionObserver`), otherwise sets instantly (table P&L). Reduced motion → instant.
`useAnimatedNumber(value, { transition?, instant? })` returns the shared MotionValue (hero P&L and its fact dialog render the **same** value via `source`).
`formatNumber(v, { decimals, prefix, suffix, signed })` → `"−1.234,50"`, `null → "–"`.

### `RollingDigits`
`{ value; decimals? (0); className?; instant?; aria-label? }` – per-digit odometer (`spring.digit`), `.`/`,` de-DE, leading `−`, no roll on mount,
direction-aware wraps, only changed digits move; > 4 Hz or reduced motion → `jump()`. Style from outside: `className="dot-num text-[42px]"`.

### `StatusPill`
`{ tone: "live"|"warn"|"error"|"muted"; label?; expanded: boolean; ring?: number|null (0..1); spinning?; feed?; className?; title? }`
Dot (6 px) ↔ 28 px pill: **one** layout spring (`spring.pill`, interruptible, no width tween); tone = four pre-rendered layers crossfaded on `tween.crossfade`;
label wipes in `tween.fade`, out `tween.exit` (`AnimatePresence mode="popLayout"`); `ring` swaps the dot for a 14 px countdown ring (CSS `stroke-dashoffset 1s linear`,
`animate-spin` while `spinning`); `feed` → `layoutId="status-{feed}"`.

### Hooks
- `useReducedFx()` → boolean; gate every MotionValue/`useSpring` effect with it.
- `usePressable({ disabled?, scale? (.96), hover?, transition? })` → `{ whileTap, whileHover (only on `(hover:hover)`), transition: spring.press }` – spread onto any `motion.*`.
- `useMediaQuery(q, fallback)`, `useCanHover()`, `useIsDesktop()` (≥ 640 px).
- `a11y.ts`: `useFocusTrap(ref, active)`, `useScrollLock(active)`, `useInertOutside(ref, active)`, `useEscape(active, onClose)`, `useDialogBehaviour(ref, active, onClose)` (all four).

## layoutId contracts

| id | source → target | transition | rule |
|---|---|---|---|
| `hover-{group}` (`bt`, `rank`, `recent`) | `HoverPill` between rows of one list | `spring.hover` | one group per card |
| `bg-{useId}` | `Segmented` thumb | `spring.segment` | unique per instance |
| `morph-{id}` / `morph-title-{id}` (`fact-*`, `bt-{k}-{filter}`, `setup-rank-{id}`, `hyblock-new`, `falling-knife`) | `MorphCard` → `MorphDialogProvider` panel | `spring.morph` | source hidden after `onLayoutAnimationComplete` |
| `trade-{id}`, `trade-pnl-{id}`, `trade-side-{id}` | recent row / table ghost → Trade-Detail | `spring.detail` | set conditionally by `uiStore.detail.source` (`recent`/`table`/`marker`) |
| `setup-card-{id}`, `setup-name-{id}`, `setup-dot-{id}` | setup card → `Sheet` (540 px) | `spring.sheet` | card `visibility:hidden` while open |
| `new-trade` | FAB disc (`borderRadius 999`) → `Sheet size="lg"` | `spring.sheet` | disc unmounted/hidden while open |
| `dock-dot`, `dock-bg` | active dock item | `spring.layout` | singletons, `AnimatePresence initial={false}` |
| `status-{feed}` | `StatusPill` header ↔ card | `spring.pill` | optional |
| `chart-range` | range pill | `spring.layout` | one per chart card |

Every element above sets `style={{ borderRadius }}` (`radius.card 16`, `radius.dialog/sheet 28`, `radius.pill 9999`, `radius.hover 12`, `radius.thumb 8`).
`position:fixed` panels carry `layoutRoot`; scrolling ancestors of `layout` elements carry `layoutScroll` (sheet/dialog body, table wrapper).
