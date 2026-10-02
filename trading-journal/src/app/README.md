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
Font hints (`document.fonts.load` for Doto / IBM Plex Mono / Sans) run before the first render; they never block.

## `App.tsx`

```
<MorphDialogProvider>
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
`<PageHost page renderPage keepAlive onTransitioning>`: the PageSwitch visual spec (enter `x dir·16` + scale .985 + blur 4 px → none,
exit `−dir·12` + fade). Each property is a single `transform` / `opacity` / `filter` animation via `animate(el, …)`, so Motion runs it
on WAAPI (compositor); the transform springs on `spring.pageEnter` (string keyframes, see `src/motion/README.md`), opacity/filter on
`tween.page`, exit `tween.exit`. Layers end at `transform: none` / `filter: none`.
- Keep-alive pages (the overview) live in React `<Activity mode="hidden">`: state and DOM are kept, effects are destroyed while hidden
  and re-run on show, and the page is pre-rendered hidden at idle priority when the app starts elsewhere. Overview effects must stay
  re-entrant and cheap (ChartCard's `history()` hits the cache; the chart is recreated from the `candles` prop). The hidden DOM stays in
  the document: no real `<table>`, no labels/texts that collide with selectors of other pages (`13 Trades`, `Entscheidungsgrundlage`,
  `Startkapital … USDT`). MotionValue text may show its last value for one tick after the page is shown again.
- The leaving page is pinned absolutely, `inert` and `aria-hidden`, and offset by the scroll delta from `showPage()`.
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
  account for them through latestValues – never drive them imperatively. `dock-bg` / `dock-dot` intentionally have NO
  `layoutDependency`: their willUpdate on a Dock re-render snapshots the layout group when the editor opens, so the unmounting
  `new-trade-{fabCycle}` disc has a box to morph from.
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
| `Header.tsx` | `Header`, `WORDMARK`, `SUBTITLE`, `HEADER_CTA`, `MENU_LABEL`, `headerIntroTarget` | sticky, parked above the edge during intro "stage", slides down (`spring.sheet`) otherwise; logo tile `₿` → `navigate("overview")` + `replayIntro()` + AsciiCascade decode of the wordmark (held until "build" when the intro replays), DancingLetters wordmark on hover, menu button `Navigation öffnen` → CommandNav, sync `StatusPill` (`hidden md:inline-flex`, tones cloud→live, local→warn, error→error, connecting→muted), `Magnetic` → `.shiny-cta` `Trade eintragen` (`max-sm:sr-only`) → `openEditor()` |
| `Dock.tsx` | `Dock`, `DockItem`, `PAGE_LABELS`, `FAB_LABEL`, `DOCK`, `DOCK_INTRO_KEY`, `dockBell`, `dockLayout` | `role="toolbar" aria-label="Navigation"`, 4 tabs (`Übersicht | Trades | Entscheidungsgrundlagen | Einstellungen`, icons `grid|list|target|sliders`), `aria-current="page"`, `dock-bg` + `dock-dot` `layoutId`s (`spring.layout`, `AnimatePresence initial={false}`), `whileTap .94`; transform-only magnification (`spring.dock`, mouse only, off under reduced motion, see "Dock"); FAB disc `layoutId="new-trade-{fabCycle}"` `borderRadius 999`, unmounted while `editor.open && editor.fromFab` |
| `Footer.tsx` | `Footer`, `FooterOutline`, `FOOTER_TEXT`, `CONFIG`, `nextFooterShown` | pulse-motion `motion-footer`: sticky (`-z-10`) under the App curtain (`.app-curtain` in base.css: opaque body background + noise tile, rounded bottom, static shadow); a sentinel at the curtain edge + 2 IntersectionObservers reveal at ≥ 72 % / hide at ≤ 50 %; staggered fade-up (pack timings), tilted Marquee band of live stats (mounted on the first reveal, `paused` while covered; BTC price = MotionValue text), DancingSvgWord outline wordmark (stroke draw 4 s on first reveal, hover gradient + radial mask `userSpaceOnUse`), attribution, `Nach oben`; bottom padding clears the dock |
| `CommandNav.tsx` | `CommandNav`, `openCommandNav`, `closeCommandNav`, `toggleCommandNav`, `useCommandNavOpen`, `isCommandNavShortcut`, `rovingIndex`, `CONFIG` | pulse-motion `immersive-full-screen-navigation`: ⌘K / Ctrl+K (ignored while another modal is open) or the header button; black panel wipes in from the left (WAAPI transform, 800 ms), brand, page links with live counts, quick actions (`Trade eintragen` → `openEditor()`, `CSV-Export`, `Backup herunterladen` via `@/store/backup`), staggered; close wipes right. `useDialogBehaviour` (inert after the wipe), arrows/Home/End/1–4; unmounted while closed |
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
