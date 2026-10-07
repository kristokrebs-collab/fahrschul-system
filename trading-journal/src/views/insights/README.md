# `src/views/insights` – "Auswertung" on the Übersicht

`InsightsSection` (export of `index.ts`) is mounted once by the overview as a **direct child of the overview grid**:
its root is a `<section>` with `lg:col-span-12` and its own 12-column grid. Every card is an `IntroCell fly={false}`
+ `Reveal` + `content-visibility:auto` cell (same deferral as the overview's lower rows), so it needs no surrounding
`Cell`/`Reveal`. Metrics: `@/domain/insights` (pure, unit-tested).

| Row | Cards |
|---|---|
| 1 | Rückblick (7) · Erkenntnisse (5) |
| 2 | P&L-Kalender (7) · Edge-Score (5) |
| 3 | Disziplin (12) |
| 4 | Fehler-Kosten (6) · Ergebnis nach Signal-Stärke (6) |
| 5 | Zeit & Session (7) · R-Verteilung (5) |
| 6 | Drawdown (7) · Gewinner vs. Verlierer (5) |

An account view without any trade shows only the calendar (day notes work without trades) and one preview card.

## Shared pieces
- `ui.tsx`: `useInsightsBase()` (Hero's `uiStore.acc` → `useAccountView`), `InsightCard` (Card + `+` explainer
  toggle, explainer built lazily), `Stat`, `TradeRows` / `TradeList` (rows open the trade detail via
  `openTrade(id)` = `openDetail(id, "marker")`: no foreign `trade-{id}` morph source), `SEG_TOUCH` (≥ 44 px segments
  on coarse pointers), `softTone`.
- `insightsStore.ts`: `useInsightsUi` – `focusDay(key)` (Disziplin / Rückblick open a day in the calendar, which
  switches month, opens the day view and scrolls itself into view), `unit` (€ | R | %). View state only.
- The section header repeats the Hero's Gesamt / Makro / Scalp switch (same store value).

## Motion / 120 Hz
- Calendar: month change slides (`spring.segment` x + fade); touch swipe via `useAxisDrag` (velocity hand-off,
  rubber band at the first / current month, `flickDecision`); day cell → day view is a shared-layout morph
  (`layoutId="cal-day-{key}"` on the cell's tinted surface and the panel surface, `spring.detail`), both ways. The
  grid stays mounted (faded, `inert`, out of flow) under the day view – it is the morph source and keeps state. Motion
  registers a `layoutId` only at mount, so the armed surface (hover / pointerdown / focus) remounts; cell children are
  `pointer-events: none`, so that remount never removes the pointerdown target (a removed target cancels the tap).
- Edge-Score: inline SVG radar, the polygon grows (scale, `spring.smooth`), vertices pop (`spring.pop`), account
  switch crossfades; score counts up (`MotionNumber countOnReveal`).
- Bars: `Bar` / `useRevealValue` (scaleX), columns scaleY on `spring.enter`, under-water curve and intraday curve wipe
  in by clip-path (`tween.draw`), heat map cells fade column by column (CSS opacity, 8 ms stagger).
- Drawdown scrub and Zeit scrub read one rect per press and write transforms / text directly – no React state per move.
- Height changes only through `AutoHeight` / `Collapse` (declared exceptions). Reduced motion: no slides / draws.

## Data
- Day notes: `useDayNote` / `saveDay(date, { note, mood })` (`tj2-days`, F1). The editor saves after a 700 ms typing
  pause, on blur and when the day view closes (unmount flush) – input is never dropped; other stored fields of the day
  survive (`saveDay` merges).
- `trade.signal` read with `parseSignalSnapshot` (other version's `SignalSnap` and ours); `trade.mistakes` + automatic
  mistakes; `settings.discipline` (optional, passthrough) for the discipline limits.
