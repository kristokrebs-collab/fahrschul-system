# `src/app` – shell wiring (`main.tsx`, `App.tsx`, header, dock, footer, banner)

Plan 1.4/1.5 (boot, router, banner), 6.6 (shell), 3.3 (dock/page morphs). The `Übersicht` page lives in
`src/views/overview` (see the section at the end).

## Boot (`src/main.tsx`)

```ts
void bootJournal();      // migrate + sync hydrate, then claude.ai probe (Fall A/B) – @/store/journalStore
installRouter();         // hash grammar #{page}[?query], hashchange, filter mirror – @/store/router
bootMarket();            // startMarket(settings); follows settings.market.symbol → setSymbol, hyblock.timeframe → setPeriod
createRoot(#root).render(<StrictMode><MotionRoot><App/></MotionRoot></StrictMode>)
```
Font hints (`document.fonts.load` for Doto / IBM Plex Mono / Sans) run before the first render; they never block, and a
rejected load (offline file, blocked font host) is caught – no unhandled `NetworkError`.

## Editions and builds

Two editions × two targets, chosen at build time (`src/edition.ts`: `__TJ_EDITION__` personal | share, `__TJ_TARGET__`
web | file → `EDITION`, `IS_SHARE`, `BUILD_TARGET`, `IS_FILE_BUILD`, `isFileProtocol()`):

| command | output | edition |
|---|---|---|
| `npm run build` | `dist/` (web root; the legacy `/dashboard.html` is copied along) | personal – the user's setups, levels, capital, `tj2-*` storage (same keys as the other journal version) |
| `npm run build:share` | `dist/teilen/` (base `/teilen/`) | share – empty journal, neutral setups (`s_mtf`, `s_bt`), levels unset, `tj2share-*` storage; manifest / app name "Trade Journal (Teilen)" |
| `npm run build:single` | `release/trade-journal-persoenlich.html`, `release/trade-journal-teilen.html` (`scripts/build-single.mjs [outDir]`, `vite.single.config.ts`) | both, each ONE self-contained HTML file (JS, CSS, fonts and favicon inline; manifest / touch-icon links dropped – they cannot work under `file://`) that opens from disk |

- Privacy guard (`scripts/privacyGuard.ts`, Vite plugin in `generateBundle`): every share build (web and file) fails when a
  personal string or number from `src/domain/edition/personal.ts` ends up in the bundle. Edition data and copy go through
  `ED` (`@/domain/edition`), never `edition/personal` directly; storage keys through `storageKey()` / `KEYS`.
- Netlify (repo root `netlify.toml`): `npm ci && npm run build && npm run build:share`; `/teilen/*` → `/teilen/index.html` before the
  catch-all, so the personal app is the site root and the share edition is `/teilen/`.
- Dev: `vite` serves the personal edition, `vite --mode share` the share edition at `/teilen/`. Vitest runs as personal.
- File builds: `LocalModeBanner` says `Datei-Version.`; with no usable storage (Android `content://` opens) the journal runs in
  memory and the header pill says `Nicht gespeichert` (`modeLabelFor`); Settings → Live-Daten hides the EU-proxy switch.

## Display: installable, fullscreen, bottom inset (grey-bar fix, tablet audit §1)

The grey strip above the One UI taskbar in the user's screenshot is HOST UI (the browser's bottom toolbar / sheet, most likely
Samsung Internet's), drawn outside web content: no page z-index can cover it. The app offers the two ways out and follows it:
- **Installable**: `public/manifest.webmanifest` (`display: standalone`, `start_url`/`scope` `./` – works under `/` and `/teilen/`,
  ink theme/background `#0a0a0a`, Nothing icons in `public/icons/`: dot-matrix ₿ + one signal dot, `any` + `maskable` PNG 192/512,
  SVG, `apple-touch-icon` 180; the PNGs are Chromium renders of the dot-matrix SVG design in `public/icons/icon.svg`), linked in `index.html` with
  `mobile-web-app-capable` / `apple-mobile-web-app-*`; the favicon is an inline `data:` SVG (works in the single files too).
  `beforeinstallprompt` is kept (no mini-infobar over the dock) → CommandNav action `App installieren`; where no prompt exists
  (iOS, Firefox, before the prompt fires) on a touch device a hint says how to add it to the home screen. Not in file:// builds.
- **Fullscreen**: `Vollbild` / `Vollbild beenden` (`requestFullscreen({ navigationUI: "hide" })`, webkit fallback) in the header
  (lg+) and in the CommandNav; hidden where the API is missing (iPhone Safari).
- **Bottom inset**: `installViewportInset()` (App effect) writes `--vv-bottom` = host UI laid over the layout viewport's bottom
  (`innerHeight − (visualViewport.offsetTop + height)`, rAF-coalesced, written only on change, 0 while pinch-zoomed and for
  keyboard-sized gaps ≥ 120 px – the dock stays behind the keyboard as on iOS). `--safe-bottom` (base.css) feeds the dock,
  footer padding, bottom fade and focus scroll padding.
- **Forced darkening**: `color-scheme: only dark` (meta + CSS + `prefers-color-scheme` block). Chromium Auto Dark / WebView
  force-dark leave the page alone; Samsung Internet's night mode re-colours pages unless the user enables Settings → Labs →
  "Use website dark theme" – the CommandNav shows that hint in Samsung Internet only. No page-side opt-out exists beyond this.
- **Header**: opaque `bg-ink-900` (no 97 % alpha: scrolled text ghosted through under the pills).

| file | export | notes |
|---|---|---|
| `pwa.ts` | `canInstall`, `promptInstall`, `useCanInstall`, `isStandalone`, `useStandalone`, `isSamsungInternet`, `isIosSafari`, `fullscreenSupported`, `isFullscreen`, `toggleFullscreen`, `useFullscreen`, `useFullscreenSupported`, `bottomInset`, `installViewportInset`, `VV_KEYBOARD_MIN`, `DISPLAY_STRINGS` | listeners installed on import (guarded for jsdom / file://) |
| `DisplayActions.tsx` | `FullscreenButton`, `GlyphFullscreen` | header button (`aria-pressed`), renders nothing without the API; the Settings owner can mount `FullscreenButton` too |

## Layer diagnostics + Samsung-Internet-safe effects (decision 7)

The user still sees the grey bar in normal Samsung Internet (not in TradingView). Measured on their screenshots: the bottom
47 CSS px × ~780 CSS px, centred, flush on the One UI taskbar, flat rgb(27,27,27) (Samsung's night mode darkens the page:
ink-900 → 4, white → ~30), drawn OVER an open dialog's dim layer (z ≥ 70 if it were ours). No page layer of that size is
known, so the app now lets the device answer it:
- **`?debug=layers`** in the URL (search or hash query) or **five quick taps on the header logo** (each ≤ 450 ms apart,
  `MULTI_TAP`; a single tap's intro replay now waits for that window) open `LayerDiagnostics` (lazy chunk, `LayerDiagHost`
  in App, nothing runs while closed). It outlines and labels every `position: fixed | sticky` layer and named inner part
  (`data-layer`) with `#n name · w×h · z`, draws an opaque red/black **Prüfstreifen** over the bottom 64 px at z
  2147483647 with a 16/32/48 px ruler (a grey bar still covering it is browser UI; a bar under it is ours), and a panel
  with inner / client / visual-viewport size, DPR, safe-area insets (probe elements), `--vv-bottom` / `--safe-bottom`,
  the layers under the bottom centre, a hide toggle per layer (noise film included), the safe-effects switch and
  **Kopieren** (plain-text report, Clipboard API with an `execCommand` / selectable textarea fallback). Minimieren keeps
  only outlines + strip for a clean screenshot. Close: ×, Esc, five logo taps. Everything it changed is restored on close.
- **`data-safe-fx`** on `<html>` (`pwa.ts`, set on import before the first paint for Samsung Internet; `?safefx=1/0`
  forces it anywhere): base.css drops every `backdrop-filter`, the dock label plates fade (opacity) instead of the
  clip-path reveal, the dock's extra `will-change` layers, the header CTA's masked shine layers (a plain inset red under-glow instead), the fixed noise film
  (`body::before`, an SVG-filter image over the viewport) and the toast's blurred win glow; the dock's session entrance
  rises without its blur filter (`dockEntrance(…, noBlur)`), PageHost's entering page slides and fades without its
  4 px blur, and the motion primitives' content entrances fade without blur (`Reveal` / `RevealItem` on scroll,
  `StaggerItem` sheet / dialog sections – `@/motion/safeFx`, the attribute's single source; `pwa.ts` re-exports it).
- The toast island's live region is a 0×0 box at rest (no empty full-viewport fixed layer between toasts); it opens to
  `inset-0` while a toast shows or exits, staying in the DOM / accessibility tree throughout.
- Layer names: `Header`, `Dock`, `Dock-Leiste`, `Unterer Verlauf`, `Toast-Insel`, `Navigation (Vollbild)` (`data-layer`).

| file | export | notes |
|---|---|---|
| `layerDiag.ts` | `diagRequested`, `createTapCounter`, `MULTI_TAP`, `useLayerDiagOpen`, `setLayerDiagOpen`, `toggleLayerDiag`, `collectLayers`, `refreshBoxes`, `readViewport`, `layersAt`, `layerName`, `layerEffects`, `layerLine`, `formatReport`, `copyText`, `DIAG_ATTR` | pure helpers + DOM reads (overlay open only) |
| `LayerDiagnostics.tsx` | default overlay, `DIAG_TITLE`, `DIAG_HINT`, `PROBE_H` | one DOM walk / s + on resize / visual-viewport change, box refresh on scroll ≤ 10 Hz |
| `pwa.ts` | `SAFE_FX_ATTR`, `wantsSafeFx`, `isSafeFx`, `setSafeFx` | see above |
| `overviewScenario.ts` | `overviewScenario`, `RANGE_TITLE`, `shownScenarioKey` | decision 13: long-only scenarios on the Übersicht (market panel + scenario toast); a close under the stored short level reads as the range, the stored level is untouched |

## Dock: touch physics (additive, `@/motion/physics`)
- **Tap hop by press length**: `hopFor(lastPressMs())` – a tap ≤ 150 ms, keyboard (click `detail 0`) and programmatic switches get
  EXACTLY `{ ...spring.pop, velocity: −600 }`; a press ≥ 400 ms a calm `spring.smooth` lift at −300 px/s; blended between.
- **Re-tap the active tab** → native smooth scroll to the top (instant under reduced motion) + a `spring.pop` dip of the icon.
- **Touch scrub** (touch / pen, toolbar `touch-action: none`): after 10 px horizontal the magnification runs under the finger
  (amount 0.45, the pointer rubber-banded past the row ends), the item under the finger shows its label (`data-scrub`, written only
  on change, CSS mirrors the hover variants) with a selection haptic; release over an item activates it (not when released > 40 px
  above / below the press). **Flick** (< 250 ms, > 600 px/s, > 24 px): one tab per flick, finger right = next tab; the new icon hops
  faster (`flickHop`, ≤ −750 px/s) and PageHost takes the tempo (`setNavTempo` → `contextSpringAt(spring.pageEnter, tempo)`); at the
  row's end the active icon dips instead.
- **Long press** (400 ms still) shows the item's label; releasing then does nothing (Android tooltip behaviour).
- Mouse magnification, tooltips, FAB, intro entrance: unchanged.

## `App.tsx`

```
<MorphDialogProvider>                     (effect: installViewportInset() → --vv-bottom, see "Display")
  <ScenarioWatcher/>                       toast `Neues Szenario: …` when a 4h bar closes into a new scenario key (tj2-trigger-last)
  <Header/>                                HeaderEdge (hairline / shade / edge blur / red reading progress) + HeaderTicker
  <main class="mx-auto max-w-[1320px] px-4 pb-40 pt-6 sm:px-6">
    <LocalModeBanner/>                     mode === "local" && !hideLocalBanner
    <motion.div layout="position" layoutDependency={bannerOpen}>   moves only when the banner enters / leaves (spring.layout)
      <Pages/>                             useDeferredValue(page) → <PageHost keepAlive={["overview"]} onTransitioning={ui.setTransitioning}/>
      <Footer/>                            SVG outline `TRADE JOURNAL` + <ChartAttribution/>
    </motion.div>
  </main>
  <BottomFade/> <Dock/>
  <Toasts/>                                leaf host: uiStore.toasts → toIslandToast → <ToastIsland onDismiss={dismissToast}/>
  <Detail/>                                leaf host: <TradeDetail candles={useDetailCandles()}/> (always mounted, owns its AnimatePresence)
  <EditorHost/>                            → <TradeEditor livePrice livePriceLabel/>; the rounded price is read once a second on `nowMv` only while the editor is open (`useLivePriceWhile`); label `Live-Preis (Bybit) übernehmen` on fallback
  <SetupEditor/>
  <Celebrate/>                             confetti layer, mounted once (renders null until `celebrateFrom` queues a burst)
</MorphDialogProvider>
```
Every store subscription lives in a leaf host, so the shell itself only re-renders when the local banner opens or closes.
`Pages` reads the page through `useDeferredValue`: the dock (which reads the store directly) reacts in the click's own frame, and the
new page renders afterwards in an interruptible background render.

### Page host (`PageHost.tsx`) – replaces `PageSwitch` in the shell
`<PageHost page renderPage keepAlive onTransitioning>`: the PageSwitch visual spec (enter `x dir·16` + scale .985 + blur 4 px → none
– after a fast dock flick the slide runs on `contextSpringAt(spring.pageEnter, consumeNavTempo())`, otherwise the token itself –
exit `−dir·12` + fade). Each property is a single `transform` / `opacity` / `filter` animation via `animate(el, …)`, so Motion runs it
on WAAPI (compositor); the transform springs on `spring.pageEnter` (string keyframes, see `src/motion/README.md`), opacity/filter on
`tween.page`, exit `tween.exit`. Layers end at `transform: none` / `filter: none`. `data-safe-fx`: no blur (slide + fade only).
- `cascade` (module-level array, the shell passes `["settings"]`): pages wrapped in their own `LayoutCascade` – a scoped layout
  group, since `MotionRoot` has none (see `src/motion/README.md`).
- Keep-alive pages (the overview) live in React `<Activity mode="hidden">`: state and DOM are kept, effects are destroyed while hidden
  and re-run on show, and the page is pre-rendered hidden at idle priority when the app starts elsewhere. Overview effects must stay
  re-entrant and cheap (ChartCard's `history()` hits the cache; the chart is recreated from the `candles` prop). The hidden DOM stays in
  the document: no real `<table>`, no labels/texts that collide with selectors of other pages (`13 Trades`, `Entscheidungsgrundlage`,
  `Startkapital … USDT`). MotionValue text may show its last value for one tick after the page is shown again.
- Motion around a hide / show: the host puts `HideHold` in front of a keep-alive page (`useHoldProjectionOnHide`: no `layoutId`
  snapshots of a page that is being hidden) and `ShowSettle` behind it (`useSettleProjectionOnShow`: the re-mounted nodes are not all
  measured by the next layout update – that measured every node inside the Übersicht's `content-visibility: auto` cells, ≈ 20 ms).
- The leaving page is pinned absolutely, `aria-hidden`, and offset by the scroll delta from `showPage()`. It swallows pointer input
  (capture listeners – no interaction during a transition, like iOS) and focus inside it is released at the switch; it is NOT
  `inert` and has no `pointer-events: none` – both are inherited and restyled every element of the page fading out in the switch
  frame (≈ 2 200 on the Übersicht, 20–30 ms; `visibility` likewise, `flick/restyle.mjs`). A parked page is `inert` (free: display
  none inside). When its exit has played it is collapsed (height 0 + overflow hidden, layout kept – no 0 × 0 resize for its
  observers); it is parked
  (keep-alive) or unmounted only once the switch has settled and the main thread is idle (`requestIdleCallback`, ≤ `PARK_TIMEOUT_MS`
  600 ms; a 50 ms timer without it): the hide of the Übersicht (≈ 50 ms – every effect and ~600 motion components detach) and the
  unmount of a page no longer land in the middle of the new page's entrance. Switching back before that shows the page without a
  re-mount (the layer is restored in the switch's layout effect).
- `transitioning` has the same contract as PageSwitch (`true` at the switch commit, `false` once enter and exit finished).
- Scroll memory: the router parks restores (`navigate` / `applyRoute` → `restoreScroll`, top on first visit / deep link); PageHost
  calls `showPage(page)` at the commit that shows the page (layout effect, before paint); `detachShell` on unmount. `PageSwitch` is no
  longer used by the shell (it stays in the `@/motion` barrel).

### Dock – transform-only magnification
- Label/pill: pack `dock` taus (38/35 ms label, 40/45 ms pill + 25 ms delay) and the 1000/38 rise spring as CSS `linear()`
  transitions (`DOCK_CONFIG`); the label is an opaque plate uncovered by clip-path (SH-03). `motion.nav layoutRoot` (SH-01) and
  `layoutDependency = page|editor.open` on dock-bg / dock-dot / new-trade. Intro: parked during "stage", rises on `spring.reveal` at "build" (`dockEntrance`).
- `dockLayout` windowed Gaussian bell (`dockBell`, σ 48, amplitude 0.8, amount on the pack's 400/20 spring), per-slot `x` on the button and `scale` (originY 1) on its visual; a stretchable tray:
  caps translate ∓W/2, the middle scales by 1 + W/mid. Item centres are measured once per pointerenter in `frame.read`.
- The magnified transforms are MotionValues on motion components, so the `dock-bg` / `dock-dot` / `new-trade-{fabCycle}` shared transitions
  account for them through latestValues – never drive them imperatively. `dock-bg` / `dock-dot` carry
  `layoutDependency = page|editor.open`; the unmounting `new-trade-{fabCycle}` disc snapshots itself when the editor opens
  (a `layoutId` node's `projection.unmount` → `willUpdate`), and the sheet panel takes that snapshot as the new lead –
  no layout group involved (`MotionRoot` has none, see `src/motion/README.md`).
- FAB ↔ editor is a ONE-WAY morph: the disc and the FAB sheet share `layoutId="new-trade-{fabCycle}"`; `closeEditor` bumps
  `uiStore.fabCycle` for a FAB editor, so the disc remounts under a fresh id (it can never resume from the exiting sheet – that
  drew a sheet-sized red blob) and acknowledges the return with a scale .9 → 1 on `spring.pop`.
- Icons hop on activation (`spring.pop`), the FAB carries an `fx-ping` ring that pings 3× (`tween.pingFew`) whenever the FAB
  (re)appears with the editor closed, then rests (no endless loop at idle); entrance once per session (`tj2-dock-intro`: `spring.sheet`
  y, `tween.reveal` opacity/blur, `stagger.cards`), CSS tooltips (`duration-200 ease-out` = `tween.tooltipIn`), the nav itself is
  `pointer-events-none` (items opt back in). Dock icons use `Magnetic remeasure` (the layout changes under the pointer while magnifying).
- No declared motion exception any more (`dock-magnify` is gone).

### Edges, banner, ticker
- `Header`: `HeaderEdge` – hairline, shade, edge blur (`TOP_BANDS = []`, off for perf: shade + hairline only) and the red
  reading progress (`spring.smooth`); logo flip/press (`spring.tilt` / `spring.press`). `HeaderTicker`: the live price glides on
  `spring.price` (pure helpers `tickerPrice`, `tickerChange`, `priceStep`).
- `BottomFade`: the plain gradient only – `BOTTOM_BANDS` is `[]` (perf fallback applied: the fixed full-width strip under the dock
  was re-blurred on every composited frame and pegged the display compositor). `EdgeBlur` returns null for `[]`; re-enable bands only
  with a strip that nothing animates over. `TOP_BANDS` is `[]` too (final perf pass: the strip is only visible while content scrolls under it, so it was re-blurred on every
  scroll frame – `scrollTrades` dropped@120 130 → 58 without it).
- `LocalModeBanner`: `popLayout`, enter reveal, exit `tween.exit`; its only dot is WarnBanner's (3 pings, then rest – the extra,
  endlessly pinging `PulseDot` is gone).

| file | export | notes |
|---|---|---|
| `Header.tsx` | `Header`, `WORDMARK`, `SUBTITLE`, `HEADER_CTA`, `MENU_LABEL`, `headerIntroTarget` | sticky, parked above the edge during intro "stage", slides down (`spring.sheet`) otherwise; logo tile `₿` → `navigate("overview")` + `replayIntro()` + AsciiCascade decode of the wordmark (held until "build" when the intro replays), DancingLetters wordmark on hover, menu button `Navigation öffnen` → CommandNav, sync `StatusPill` (`hidden md:inline-flex`, label `modeLabelFor(mode, storage)` – `Nicht gespeichert` (tone loss) when nothing persists; tones cloud→live, local→warn, error→error, connecting→muted), `Magnetic` → `.shiny-cta` `Trade eintragen` (`max-sm:sr-only`) → `openEditor()` |
| `Dock.tsx` | `Dock`, `DockItem`, `PAGE_LABELS`, `FAB_LABEL`, `DOCK`, `DOCK_INTRO_KEY`, `dockBell`, `dockLayout` | `role="toolbar" aria-label="Navigation"`, 4 tabs (`Übersicht | Trades | Entscheidungsgrundlagen | Einstellungen`, icons `grid|list|target|sliders`), `aria-current="page"`, `dock-bg` + `dock-dot` `layoutId`s (`spring.layout`, `AnimatePresence initial={false}`), `whileTap .94`; transform-only magnification (`spring.dock`, mouse only, off under reduced motion, see "Dock"); FAB disc `layoutId="new-trade-{fabCycle}"` `borderRadius 999`, unmounted while `editor.open && editor.fromFab` |
| `Footer.tsx` | `Footer`, `FooterOutline`, `FOOTER_TEXT`, `CONFIG`, `nextFooterShown` | pulse-motion `motion-footer`, in normal flow (never covers page content): a sentinel at the footer's top edge + 2 IntersectionObservers reveal at ≥ 72 % of the footer in view / hide at ≤ 50 %; staggered fade-up (pack timings), tilted Marquee band of live stats (mounted on the first reveal, `paused` while hidden; BTC price = MotionValue text), DancingSvgWord outline wordmark (stroke draw 4 s on first reveal, hover gradient + radial mask `userSpaceOnUse`), attribution, `Nach oben`; bottom padding clears the dock |
| `CommandNav.tsx` | `CommandNav`, `openCommandNav`, `closeCommandNav`, `toggleCommandNav`, `useCommandNavOpen`, `isCommandNavShortcut`, `rovingIndex`, `CONFIG` | pulse-motion `immersive-full-screen-navigation`: ⌘K / Ctrl+K (ignored while another modal is open) or the header button; black panel wipes in from the left (WAAPI transform, 800 ms), brand, page links with live counts, quick actions (`Trade eintragen` → `openEditor()`, `CSV-Export`, `Backup herunterladen` via `@/store/backup`, `Vollbild` / `App installieren` where offered, then the install / Samsung dark-mode hints), staggered; close wipes right. `useDialogBehaviour` (page isolated after the wipe), arrows/Home/End/1–4; unmounted while closed. Single grid column `minmax(0,1fr)` + page names `clamp(22px,4.6vw,64px)`: nothing overflows at 390 |
| `shellStats.ts` / `cssEasing.ts` | `useShellStats`, `shellStatTexts`, `useLivePriceText` / `expoCurve`, `springCurve` | journal figures for footer + nav; pack curves as CSS `linear()` |
| `LocalModeBanner.tsx` | `LocalModeBanner`, `useLocalBannerOpen`, `LOCAL_BANNER_*` | `WarnBanner` (exit `tween.exit`), text 1:1 + Netlify sentence when `!hasClaudeRuntime()`, close `aria-label="Hinweis schließen"` → `setPref("hideLocalBanner", true)` |
| `BottomFade.tsx` | `BottomFade`, `EdgeBlur`, `BOTTOM_BANDS`, `bandMask`, `bandBox` | `fixed z-[45] h-28` gradient (`BOTTOM_BANDS = []`, no blur) |
| `HeaderTicker.tsx` | `HeaderTicker`, `tickerPrice`, `tickerChange`, `tickerChangePct`, `tickerDecimals`, `tickerJump`, `priceStep` | live price + 24 h change from `priceMv` / `open24hMv`, glide on `spring.price` |
| `PageHost.tsx` | `PageHost`, `pageDirection`, `layerRole`, `PAGE_ENTER_X`, `PAGE_EXIT_X` | see "Page host" |
| `ScenarioWatcher.tsx` | `ScenarioWatcher`, `TRIGGER_LAST_KEY` | renders null; `useFeedSelect("kline_4h", selectClosed4h)` → `scenario` – re-renders only when a 4h bar closes; toast only on key change with a newer close time |
| `marketBoot.ts` | `bootMarket(): () => void` | see boot |
| `toasts.ts` | `toIslandToast(uiToast)`, `toastLifetime` | `success→ok`, `error→error`, `signal/info→warn` (info glyph); passes the lifetime (`TOAST_MS` or the toast's `duration`, `0` = sticky) as the island `duration` – the island owns the countdown, `uiStore` never auto-dismisses |
| `useDetailCandles.ts` | `useDetailCandles()`, `sliceAround`, `DETAIL_WINDOW_MS` | 1h cache slice ±3 d around `tradeTime(trade)` (identity per detail id), `history()` for the missing edge |
| `pages.ts` / `overlays.ts` | re-exports of the four views / the app overlays | single seam for the shell and for tests (`vi.mock("@/app/pages")`, `vi.mock("@/app/overlays")`) |

## What the integrator should check

- **Strings**: dock/FAB/header use the bundle strings `Entscheidungsgrundlagen` and `Trade eintragen` (Plan 6.6), not the task
  shorthand `Grundlagen` / `Neuer Trade`. The FAB is the gradient disc of the bundle; `.shiny-cta` stays on the header CTA.
- **Chart controls**: interval `1m | 1h | 4h` (uiStore `ChartInterval` has no `1w`); pane `– | Ratio | OI` where `–` is stored as
  `tj2-ui.flags.chartPaneOff` (uiStore `ChartPane` has no `none`); range `1W | 1M | 3M` (`1m` → 7 days only).
- **Toasts**: `uiStore.toasts` is the single toast source (journal store + overlays push there); `primitives/toastStore` is unused by the shell.
- **Market hooks**: cards use `useFeedSelect` / `useHealthSelect` keys + `deriveMarket` (`views/overview/useMarket.ts`) instead of
  `useMarketView()`, so they re-render on structural changes only; every live number is a MotionValue leaf (`priceMv` odometer, ages
  and countdowns on `nowMv`, see `src/motion/README.md` "Market panel live leaves").
- **Falling-Knife card** sits in the Top-Trader card (bundle placement), not in the market panel.
- Hyblock-MCP live mode (`Top Trader · Hyblock`, `Live · alle 5 min`) is not wired; the card is Binance-only (`Top Trader · Binance`).

## `src/views/overview`

`OverviewView` = `grid gap-5 lg:grid-cols-12`: Hero (12) · ChartCard (12) · BacktestCompare (5) | WinRateCard (3) | ProjectionCard (4) ·
EquityCard (7) | TopTraderCard (5) · RankingCard (7) | ChecklistCard (5) · MonthlyCard (5) | RecentTrades (7) · PatternsCard (12).
Every card reads `uiStore.acc` through `useAccountView(acc)`; all German strings come from `@/domain/*` or the bundle. Helpers:
`ExplanationView` / `toExplainerData` (domain `Explanation` → primitives `Explainer`), `Bar` (fill on first view, `barDelay` =
`stagger.lead` + capped `stagger.reveal`), `MarketLive.tsx` (the panel's MotionValue leaves), `marketMath.ts` (pure keys / deadlines /
flow windows), `useMarket.ts` (`useMarketPanelView(levels)`, `useMotionSelect`, `usePriceClass`, `usePriceSource`, `useGlide`,
`useOrderFlowMeter`, `useTopTraderView`, `useForceRefresh` – 5 forced feeds, 5-s cooldown). The page is kept alive while hidden (see
"Page host"); cells below the hero are `Reveal`s (never the ChartCard body).
Tests: `tests/unit/app.shell.test.tsx`, `tests/unit/views.overview.{hero,market,recent}.test.tsx`; the market is mocked through
`tests/unit/views.overview.harness.tsx` (`fakeMarket(actual)` → deterministic snapshot + fake provider, `bootFixtureJournal()`).
