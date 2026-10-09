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
  `openTrade(id)` = `openDetail(id, DETAIL_SOURCE)` with `DETAIL_SOURCE = "insights"`, a detached source
  (`uiStore.DETACHED_DETAIL_SOURCES`): the recent-trades list drops its shared `trade-{id}` ids, so the detail enters on its
  own instead of flying out of an unrelated row), `SEG_TOUCH` (≥ 44 px segments
  on coarse pointers), `softTone`.
- `insightsStore.ts`: `useInsightsUi` – `focusDay(key)` (Disziplin / Rückblick open a day in the calendar, which
  switches month, opens the day view and scrolls itself into view), `unit` (€ | R | %). View state only.
- The section header repeats the Hero's Gesamt / Makro / Scalp switch (same store value).

## Motion / 120 Hz
- Calendar: month change slides (`spring.segment` x + fade); touch swipe via `useAxisDrag` (velocity hand-off,
  rubber band at the first / current month, `flickDecision`; a native touchmove guard, `useTouchMoveGuard`, so the tap after a fast
  swipe is never swallowed); day cell → day view is a shared-layout morph
  (`layoutId="cal-day-{key}"` on the cell's tinted surface and the panel surface, `spring.detail`), both ways. The
  grid stays mounted (faded, `inert`, out of flow) under the day view – it is the morph source and keeps state. Motion
  registers a `layoutId` only at mount, so the armed surface (hover / pointerdown / focus) remounts; cell children are
  `pointer-events: none`, so that remount never removes the pointerdown target (a removed target cancels the tap).
- Edge-Score: inline SVG radar, the polygon grows (scale, `spring.smooth`), vertices pop (`spring.pop`), account
  switch crossfades; score counts up (`MotionNumber countOnReveal`).
- Bars: `Bar` / `useRevealValue` (scaleX), columns scaleY on `spring.enter`, under-water curve and intraday curve wipe
  in by clip-path (`tween.draw`), heat map cells fade column by column (CSS opacity, 8 ms stagger).
- Disziplin heat map: cells are 14–17 px (a 44 px hit area per cell would overlap the neighbours), so ONE click handler on the
  grid takes an exact hit on a traded day, else the nearest traded day whose centre lies within 24 px (`TAP_RADIUS`; one rect
  read per cell, at tap time only). Double-click / Enter opens the day in the calendar.

## Disziplin layout (decision 12 – no black holes with a sparse journal)
Left column: score ring + day / streak / Ø (`Im Kalender öffnen`) beside the heat map; under it the 30-day score trend; then
`Letzte Handelstage` | `Schwächste Regel`. Right column (lg, 23 rem): every rule with its result that day and its 30-day rate.
- Heat map: the number of week columns follows the measured width (`ResizeObserver` → `heatWeeks`, 14 px cells + 3 px gap,
  8…53 weeks; re-renders only when the count changes), cells stretch to fill the column exactly. Every past day is drawn: a
  faint dot on a day without trades, an opaque grey ramp → white on traded days (no white-alpha: Samsung Internet's dark
  filter turns translucent white into translucent black), today framed (`data-today`), month names above (`monthLabels`,
  ≥ 3 columns apart), legend `kein Trade · heute · weniger ■■■■ mehr Regeln erfüllt`. First view: column-staggered fade
  from 30 % (never from 0 – nothing can stay invisible).
- Score trend (`scoreTrend`): dot-matrix lollipop over the last 30 calendar days – a faint dot per day, a stem to the score
  on traded days (dot white ≥ 80 %, grey, red < 50 %), the 80 % streak line dashed, `Ø … · n Handelstage`; stems grow from
  the baseline on first view (scaleY). Decorative for screen readers (the header line carries the numbers).
- `Letzte Handelstage` (`lastTradingDays`, ≤ 5): date, the 10 rules as marks (green kept · red broken · grey not judged),
  score, the broken rules by short name (`RULE_SHORT`); a row is a 44 px button that selects the day (ring + rule list).
- `Schwächste Regel` (`weakestRule`): lowest 30-day rate (ties → judged on more days), `An x von y Handelstagen verletzt.`
  + the rule's hint; `Alle prüfbaren Regeln eingehalten.` when nothing broke. Pure helpers: `disciplineView.ts`.

## Ergebnis nach Signal-Stärke (`SignalStrengthCard`, Einstiegs-Check v2)
- `Stärke` table (4 … 0 + `Ohne Check`) as before; a row unfolds its trades.
- `Kerzenschluss` table (`stateRows`, `insights-signal-state`): the same columns grouped by the stored candle-close state —
  stark bestätigt · bestätigt · vorläufig · kein Einstieg · ohne Status (snapshots from before decision 6 / the other
  version). Shown only when at least one snapshot carries a state.
- `Wirkung der Bedingungen`: win rate with vs without each ladder condition (`conditionEffects`), the legacy top-trader
  reading (`whaleEffect`, `insights-signal-whale`), then the graded parts of v2 snapshots (`partEffects`,
  `insights-signal-part-{key}`): Top-Trader-Kombi erfüllt with its items Positionen / Konten / Retail (indented, `sub`),
  Divergenz (regulär, bestätigt), Support / Widerstand + Platz. A trade whose check had no data for a part is counted in
  `noData` (`n ohne Daten`), never as "not met"; snapshots without the part are left out; a part no trade has data for is
  omitted. The info panel (`explainSignal(res, effects, extra)`) lists the same rows.

## Other cards with sparse data (audited at 1692×978, 1280×800 and 390 with 3 trades)
- Erkenntnisse without a clear pattern: the empty state lists what each evaluation still needs (`PROGRESS_STEPS`: first
  finding 2 × `FINDING_MIN_N`, Edge-Score `EDGE_MIN_TRADES`, Backtest-Vergleich `MIN_TRADES_STABLE`) with `have / need` bars.
- Zeit & Session: empty buckets keep a dot on the zero line; every label carries the bucket's trade count (`2 T` / `–`).
- Drawdown: the under-water curve takes the height its row leaves (min. 120 px), ≤ 40 trades get a dot each; `Längste
  Phase` spans two tile columns (no hole in the 3-column grid).
- Drawdown scrub and Zeit scrub read one rect per press and write transforms / text directly – no React state per move.
- Height changes only through `AutoHeight` / `Collapse` (declared exceptions). Reduced motion: no slides / draws.

## Data
- Day notes: `useDayNote` / `saveDay(date, { note, mood })` (`tj2-days`, F1). The editor saves after a 700 ms typing
  pause, on blur and when the day view closes (unmount flush) – input is never dropped; other stored fields of the day
  survive (`saveDay` merges).
- `trade.signal` read with `parseSignalSnapshot` (other version's `SignalSnap` and ours); `trade.mistakes` + automatic
  mistakes; `settings.discipline` (optional, passthrough) for the discipline limits – edited in Einstellungen →
  `Disziplin-Grenzen` (`views/settings/LimitsCard.tsx`); without it 2 % per trade / 4 % per day / Makro 2 · Scalp 5 trades.
