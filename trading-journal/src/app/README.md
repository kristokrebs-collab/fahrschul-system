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
  <ScenarioWatcher/>                       toast `Neues Szenario: …` on 4H scenario key change (tj2-trigger-last)
  <Header/>
  <main class="mx-auto max-w-[1320px] px-4 pb-40 pt-6 sm:px-6">
    <LocalModeBanner/>                     mode === "local" && !hideLocalBanner
    <motion.div layout="position" layoutDependency={bannerOpen}>   siblings move up on spring.layout
      <PageSwitch index={o|t|s|e} pageKey={page} onTransitioning={ui.setTransitioning}> <CurrentPage/> </PageSwitch>
      <Footer/>                            SVG outline `TRADE JOURNAL` + <ChartAttribution/>
    </motion.div>
  </main>
  <BottomFade/> <Dock/> <ToastIsland toasts={uiStore.toasts → toIslandToast} onDismiss={dismissToast}/>
  <TradeDetail candles={useDetailCandles()}/>            always mounted – the overlays own their AnimatePresence
  <EditorHost/>   → `<TradeEditor livePrice livePriceLabel/>`; the price is read from `priceMv` only while the editor is open (`useLivePriceWhile`), label `Live-Preis (Bybit) übernehmen` on fallback
  <SetupEditor/>
</MorphDialogProvider>
```
Scroll memory lives in the router only (`navigate` / `applyRoute` → `restoreScroll`, top on first visit / deep link); `PageSwitch` gets `rememberScroll={false}` so a `#trades?…` deep link is never overridden a frame later.

| file | export | notes |
|---|---|---|
| `Header.tsx` | `Header`, `WORDMARK`, `SUBTITLE`, `HEADER_CTA` | sticky, logo tile `₿` → `navigate("overview")`, `SplitText` once per session, sync `StatusPill` (`hidden md:inline-flex`, tones cloud→live, local→warn, error→error, connecting→muted), `Magnetic` → `.shiny-cta` `Trade eintragen` (`max-sm:sr-only`) → `openEditor()` |
| `Dock.tsx` | `Dock`, `DockItem`, `PAGE_LABELS`, `FAB_LABEL`, `DOCK` | `role="toolbar" aria-label="Navigation"`, 4 tabs (`Übersicht | Trades | Entscheidungsgrundlagen | Einstellungen`, icons `grid|list|target|sliders`), `aria-current="page"`, `dock-bg` + `dock-dot` `layoutId`s (`spring.layout`, `AnimatePresence initial={false}`), tooltip `-top-7`, `whileTap .94`; magnification `useTransform` → `useSpring(spring.dock)` only for `pointerType==="mouse"` and not under reduced motion (`// motion-exception: dock-magnify`); FAB disc `layoutId="new-trade"` `borderRadius 999`, unmounted while `editor.open && editor.fromFab` |
| `Footer.tsx` | `Footer`, `FooterOutline`, `FOOTER_TEXT` | stroke draw 4 s once in view, hover radial mask following the mouse through MotionValues (`spring.tooltip`), gradient `#8a8a8a → #fff → #e5202e` |
| `LocalModeBanner.tsx` | `LocalModeBanner`, `useLocalBannerOpen`, `LOCAL_BANNER_*` | `WarnBanner` (exit `tween.exit`), text 1:1 + Netlify sentence when `!hasClaudeRuntime()`, close `aria-label="Hinweis schließen"` → `setPref("hideLocalBanner", true)` |
| `BottomFade.tsx` | `BottomFade` | `fixed z-[45] h-28 from-transparent via-ink-900/70 to-ink-900` |
| `ScenarioWatcher.tsx` | `ScenarioWatcher`, `TRIGGER_LAST_KEY` | renders null; `kline_4h` → `lastClosed4h` → `scenario`; toast only on key change with a newer close time |
| `marketBoot.ts` | `bootMarket(): () => void` | see boot |
| `toasts.ts` | `toIslandToast(uiToast)` | `success→ok`, `error→error`, `signal/info→warn` (info glyph) |
| `useDetailCandles.ts` | `useDetailCandles()`, `sliceAround`, `DETAIL_WINDOW_MS` | 1h cache slice ±3 d around `tradeTime(trade)` (identity per detail id), `history()` for the missing edge |
| `pages.ts` / `overlays.ts` | re-exports of the four views / the app overlays | single seam for the shell and for tests (`vi.mock("@/app/pages")`, `vi.mock("@/app/overlays")`) |

## What the integrator should check

- **Strings**: dock/FAB/header use the bundle strings `Entscheidungsgrundlagen` and `Trade eintragen` (Plan 6.6), not the task
  shorthand `Grundlagen` / `Neuer Trade`. The FAB is the gradient disc of the bundle; `.shiny-cta` stays on the header CTA.
- **Chart controls**: interval `1m | 1h | 4h` (uiStore `ChartInterval` has no `1w`); pane `– | Ratio | OI` where `–` is stored as
  `tj2-ui.flags.chartPaneOff` (uiStore `ChartPane` has no `none`); range `1W | 1M | 3M` (`1m` → 7 days only).
- **Toasts**: `uiStore.toasts` is the single toast source (journal store + overlays push there); `primitives/toastStore` is unused by the shell.
- **Market hooks**: cards use `useFeed`/`useHealth` + `deriveMarket` (`views/overview/useMarket.ts`) instead of `useMarketView()` because the
  store emits on every aggTrade (≈10 Hz); the live price is rendered from `priceMv` (`useRollingPrice`, ≤ 4 Hz odometer).
- **Falling-Knife card** sits in the Top-Trader card (bundle placement), not in the market panel.
- Hyblock-MCP live mode (`Top Trader · Hyblock`, `Live · alle 5 min`) is not wired; the card is Binance-only (`Top Trader · Binance`).

## `src/views/overview`

`OverviewView` = `grid gap-5 lg:grid-cols-12`: Hero (12) · ChartCard (12) · BacktestCompare (5) | WinRateCard (3) | ProjectionCard (4) ·
EquityCard (7) | TopTraderCard (5) · RankingCard (7) | ChecklistCard (5) · MonthlyCard (5) | RecentTrades (7) · PatternsCard (12).
Every card reads `uiStore.acc` through `useAccountView(acc)`; all German strings come from `@/domain/*` or the bundle. Helpers:
`ExplanationView` / `toExplainerData` (domain `Explanation` → primitives `Explainer`), `Bar` (`scaleX` on `tween.bar`),
`useMarket.ts` (`useNow`, `useMarketPanelView`, `usePriceSnapshot`, `useRollingPrice`, `useForceRefresh` – 5 forced feeds, 5-s cooldown).
Tests: `tests/unit/app.shell.test.tsx`, `tests/unit/views.overview.{hero,market,recent}.test.tsx`; the market is mocked through
`tests/unit/views.overview.harness.tsx` (`fakeMarket(actual)` → deterministic snapshot + fake provider, `bootFixtureJournal()`).
