# `src/views/markt` – "Markt" (Box zu Box live, P02)

`MarktView` (export of `index.ts`, `h1` "Markt") shows the Box-zu-Box engine (`@/domain/boxes`) live on 4h / 1D / 1W of
the live symbol – "trade the best, fuck the rest": only A+ / A setups are shown as setups, everything else is context.
Data: `useBoxes()` from `@/market/boxes` (one store, idle-chunked analysis, recomputed only when a closed bar changes);
the scanner (`useScan`) and the settings (`settings.boxes` via `useJournal`). See `src/market/README.md` → "Box-zu-Box
live" and `src/domain/boxes/README.md`.

| Row (lg, 12 columns) | Cards |
|---|---|
| header | `PageHeader` (title, lead with `MARKT_LEAD_FILL`, status pill: Lädt / Live / Teilweise / Aus / Fehler) |
| band | `AlertBand` – `Marquee` of every timeframe's phase, a pending close, the A-setups and this session's alerts; while the candles load (and when no box exists) a static 38-px shell with one muted line keeps its place – nothing below jumps when the first messages arrive |
| 1 | `BestSetupsCard` (7) · `BoxStateCard` (5) |
| 2 | `BoxChartCard` (12) |
| 3 | `RsiLinesCard` (5) · `ScannerCard` (7) |
| 4 | `BoxSettingsCard` (12) |

Phones: one column in the same order. Every card is a `Reveal` cell (transforms end at `none`; the box chart has no
trade markers, so there is no `position: fixed` ghost a reveal could trap).

## Cards
- **Beste Setups** (`BestSetupsCard.tsx`): each setup is a `MorphCard` (`id = box-setup-{tf}:{boxId}:{side}:{kind}` →
  `layoutId="morph-box-setup-…"` and `morph-title-box-setup-…`); the dialog (`SetupExplain`) lists every reason with
  its weight, the plan (entry, stop, T1…T3, CRV), the box (edges, touches, quality) and the higher timeframe. Grade as
  `GradeMatrix` (dot-matrix, `A+` with the red bloom), `ConfidenceMeter` for the score, the live distance to the edge
  (`EdgeDistance`, `RollingDigits` on a MotionValue derived from `priceMv` – no React render per tick). Empty state: an
  honest "Kein A-Setup" with the best B setup as "beobachten"; loading and "aus" states say why.
- **Box-Status** (`BoxStateCard.tsx`): per timeframe the phase rail (Range → Druck → Ausbruch → Retest → Ziel;
  `railIndex`), the price gauge inside the box (`gaugeY`, transform only), `StatusPill` (`pillOf`: warn while a close is
  pending, live after a breakout, with the candle-close countdown ring) and the countdown to the close. Before any
  analysis (`waitOf`): loading → the „Beste Setups“ loader and a `Lädt` pill in the height of the loaded body; off /
  error → the store's reason – never the verdict „Noch keine saubere Box.“ before the candles are in.
- **Box-Chart** (`BoxChartCard.tsx`): its own lazy `NothingCandleChart` (the overview chart is a separate keep-alive
  instance) with `boxes` (`toChartBoxes`: the active box, earlier boxes faded, the open reference box while price is
  inside / failed, targets) and `boxAutoscale`. A box covers only its own bars – never a candle that closed outside it: a
  newest box that broke out and was re-entered ends at its breakout, and its live part (`{id}:live`, targets, shared
  caption) runs from `BoxTfView.liveFrom` (first bar of the current run of closes back inside) to the live edge; the
  RSI pane (`panes: ["rsi"]`) with the diagonal trendlines and break glow. Timeframe `Segmented` 4h / 1D / 1W (the chart's `StripWipe` wipes the new picture in); window 30 / 180 / 730
  days; 4h history extended once (`provider.history`, 120 days).
- **RSI-Linien** (`RsiLinesCard.tsx`): per timeframe a mini RSI with its two lines (`miniGeo`), drawn in on first view
  (`useFirstInView` + clip-path), a fresh break breathes (`GlowBreak`, 3 cycles).
- **Scanner** (`ScannerCard.tsx`): the watchlist's A+ / A setups on 4h / 1D, best score first; `RadarSweep` while
  scanning, progress `n / m`, the next scheduled scan; "Jetzt scannen" (`scanNow`). It runs on its own token bucket
  (≤ 20 weight / min), so ten symbols take about two minutes – said in the note.
- **Einstellungen** (`BoxSettingsCard.tsx`): `writeBoxes(patch)` writes `settings.boxes` at once (like `LageCard`):
  Box-Analyse an / aus, Alarme, Systembenachrichtigung (asks for permission; honest hint when blocked / unsupported),
  minimum grade A+ / A, scanner an / aus, watchlist chips (≤ 20, `Autocomplete` over the provider's symbols, normalised
  to USDT perps).

## Motion / 120 Hz
Tokens from `@/motion/tokens` only; transform / opacity / filter / clip-path only; finite loops; `useReducedFx` → every
end state at once; no blur under `data-safe-fx`; decorative layers `aria-hidden`; the only live region stays the
`ToastIsland` (alerts are toasts).
- Setup cards are dealt in (`CardSpread`, on first view and when the set of ids changes – `hashIds`).
- Breakout / retest card: one `BorderBeam` fire lap, `BreakoutStreak` chevrons in the breakout direction,
  `TactileHighlight` "Ausbruch ↑/↓", `TextScramble` decodes the broken level.
- A breakout of the range high (or an all-time high) on the closed bar fires `celebrateFrom` kind `record` once per box.
- The chart: boxes draw in (fill grows → over `tween.draw`, edges fade, targets run left to right), provisional boxes
  have a dashed edge, the confirmation is a wipe to the solid edge – a finite rAF, the canvas never animates
  permanently. RSI break: `GlowBreak` in the ripple layer (3 breaths), canvas halo skipped under safe-fx.
- Scanner: `RadarSweep` while a scan runs, rows reveal (`RevealGroup`).

## Wiring (P14)
The page is not routed by this package: register `markt` → `MarktView` (pages, dock, command nav, router, intro boot,
icon) and mount `<BoxAlertHost />` (re-exported here) once among the app hosts. Until then the dev harness
`dev/markt.html` (Vite dev server) renders the page with `bootJournal`, `bootMarket`, the alert host, `ToastIsland` and
`Celebrate`.

## Tests
- `tests/unit/views.markt.test.tsx` – view states (loading / off / empty / A-setups), dialog, rail, gauge, settings
  writes, band items.
- `tests/e2e/markt.spec.ts` – page with mocked klines (`tests/e2e/mocks/market.ts` `boxes` option), setup dialog,
  timeframe switch, scanner on demand, settings, alerts, no horizontal scroll, mobile + desktop. Opens
  `PW_MARKT_URL` (default `/dev/markt.html`, i.e. a dev server; set `/#markt` once routed – the markt tests skip when
  the harness is not served). The overview test (RSI pane, box layer, order-flow row) runs on any server.

## Schlüsselmarken, Tagesplan, Alarme (F09 / F08 / F22)

Three cards of this page live in `src/views/schluesselmarken` (`KeyLevelsCard` + `PlanCard` between the chart and the RSI
lines, `AlertsCard` at the end): the user's own key levels with a status computed from the real candles of each level's
timeframe, add / edit / duplicate / delete, history with intrabar and close events apart, the precedence rule for
timeframes that disagree; the day plan (range / long / short / abwarten, each with trigger, invalidation and „Was den Plan
ändert“); channels, active hours, prepare distance, cooldown and the **Zustellprotokoll** with the plain note that alerts
only run while the app is open. The five fixed levels of the settings are listed read-only („aus Einstellungen“). Writes go
to `settings.keyLevels` at once (`writes.ts`, like the Box-Einstellungen). Own levels also draw as chart lines in this
chart and in the Übersicht chart (`keyLines` prop of `NothingCandleChart`, `src/chart/levels.ts`). Domain, rules and
migration: `src/domain/keylevels/README.md`; live side: `src/market/keylevels`. Tests: `views.schluesselmarken*.test.ts(x)`,
`tests/e2e/keylevels.spec.ts`.

## Preis- & RSI-Struktur (F05)

`TrendStructureCard` (lazy chunk, `lg:col-span-12` right under the chart; fallback = a skeleton card of the same title):
per selected timeframe (chips `30m 1h 2h 3h 4h 1D 1W`, default `1h 4h 1D 1W`, stored in `settings.trendlines.tfs`) the
diagonal trendlines of the **price** (through pivot highs / lows) and of the **RSI** – Abwärtstrendlinie and
Aufwärtstrendlinie – with **Annäherung, Bruch und Retest as separate statements** (`describeLine`: „Annäherung an die
Abwärtstrendlinie“, „Abwärtstrendlinie nach oben gebrochen“, „Retest läuft / bestätigt“, „Bruch zurückgenommen“, „Bruch
ohne Retest“), the distance of the newest close in % and ATR (RSI: points), touches, and the candle count / RSI / ATR of
the row. Only CLOSED candles of the timeframe's own feed; a timeframe the feed cannot serve is a **disabled chip with the
reason listed below** (and, when selected, a row that says why) – never swapped for another one. A switch („Preislinien im
Chart“) and a chip in the chart legend write `settings.trendlines.chart`.

Chart: `BoxChartCard` hands `priceLines` (`toChartTrendlines`, only price lines of timeframes ≥ the chart's interval) to
`NothingCandleChart`, which loads `TrendlinePrimitive` on the first line. The lines are in time and price, so they follow the
mirror (only the price axis flips) and a 1D line also reads on the 4h chart (anchored at the middle of its candles when the
timeframe is longer than the chart's). The mirror's „Trendlinien“ layer hides them; during a bias test the lines are computed
from the **frozen bars** only (nothing after the anchor shapes a line). `data-trendlines` on the chart wrapper counts them.
The old „RSI-Linien“ card stays (box engine, 4h / 1D / 1W, no retest); the new card reads the same kind of line with retest on
the free timeframes. Domain: `src/domain/trendlines/README.md`; live side: `src/market/trendlines`.
Tests: `views.markt.trend.test.tsx`, `chart.trendline.test.ts`, `tests/e2e/trendlines.spec.ts`.

## Ähnliche Situationen (F19)

`SimilarCard` (lazy chunk, `lg:col-span-12` right under the structure card; fallback = a skeleton card of the same title). The last
closed candle of the chosen timeframe (chips `30m … 1W`, any the feed serves; default 4h) is described by up to nine features (RSI,
RSI slope, distance to EMA 50 / 200 in ATR, range / ATR, relative volume, trend of 10 candles, weekday, session – a collapsible
chip group, defaults without EMA 200 / weekday / session; a feature that makes no sense on a timeframe is disabled with its reason).
Horizon 6 / 12 / 24 / 48 candles and unit R (1 R = 1 ATR of the hit's candle) or % are `Segmented`; the choice is remembered on
this device (`storageKey("similar")`, `similarPrefs.ts`, not part of the synced settings).

The card shows, in this order: the sample size (closed candles, comparable candles), features that had to be dropped (with the
reason), then – only with ≥ 20 hits – the headline („In 14 von 24 ähnlichen Situationen lag der Kurs nach 12 Kerzen höher (58 %,
Spanne 41–73 %)“), the up / down bar, median, quartiles, σ, typical high / low after, the setback against the majority, the first
touch of ±1 and its median time, the yardstick (the same horizon after every comparable candle) and **Gegenbeispiele** (every hit
that went against the majority, largest move first, first four shown, „Alle zeigen“); then the **Stichprobe** (every hit, nearest
first, first eight shown). Under 20 hits: „Zu wenig Daten …“, no shares, no counter-examples list – the hits remain. The
caveats (Ähnlichkeit ist keine Prognose; Mehrfachtest) are always at the bottom of the card.

A hit is a button: `SimilarHitSheet` (lazy, third chunk, fetched on the first click) opens the situation on the real candles in the
shared `ReplayChart` (`showTrade` off, lines: the hit's close and ±1 unit) with `ScrubTimeline` – it opens on the situation, the
candles after the hit appear when you play or drag – plus the features of the hit next to the current situation and the outcome
numbers. Model: `similarModel.ts` (`hitModel`, pure). The assistant's tool `similar` calls `openSimilar()` (`similarOpen.ts`, zustand):
the page navigates, the card scrolls into view and takes focus. Domain: `src/domain/similar/README.md`; live side:
`src/market/similar`. Tests: `views.markt.similar.test.tsx`, `similar.*.test.ts`, `assistant.similar.test.ts`, e2e `similar.spec.ts`.

## Inhalt-Leiste (Auffindbarkeit)

Unter dem Seitenkopf sitzt die `SectionNav` (`src/primitives/SectionNav.tsx`): ein Chip je Abschnitt, klebt unter dem Header, markiert den sichtbaren Abschnitt (`aria-current="location"`), ein Tipp scrollt weich (reduzierte Bewegung: Sprung) und hebt den Titel kurz hervor. Die Karten tragen ihre `data-testid` (`markt-best` … `alerts-card`); die Leiste nennt sie in Lesereihenfolge (elf Chips; ein laufender Bias-Test zeigt nur den Chart, dann auch keine Leiste). Test: `tests/e2e/funktionen-anker.spec.ts` (jeder Chip landet unter der Leiste), `tests/unit/primitives.sectionNav.test.tsx`.

## Quelle und Stand (Selbstprüfung)

`MarktStand.tsx` ist die eine Zeile unter dem Meldungsband: welcher Anbieter die Kerzen der Boxen, Schlüsselmarken und RSI-Linien geliefert hat (aus dem Stempel des Feeds,
`SOURCE_LABEL` in `src/ui/SourceStand.tsx`), wann sie abgerufen wurden (auf die Minute gerundet – die Zeile rendert einmal pro Minute, nicht mit jedem Kerzen-Tick) und der Schluss der
letzten **geschlossenen** Kerze je Zeiteinheit (4h, 1D, 1W). Fehlt eine Zeit, steht „keine Daten“. Test: `ui.sourceStand.test.tsx`, e2e `selbstpruefung.spec.ts`.

## Termine, Heute wichtig, Ereignisphasen (F43)

Ein lazy Abschnitt (`src/views/termine`, README dort) zwischen Tagesplan und RSI-Linien: **Heute wichtig** (Morgenbriefing, `briefing-card`), **Termine** (Kalender als Liste oder Monat, `termine-card`) und **Ereignisphasen** (Trades vor/nach Funding, am Verfallstag, FOMC-Tag, in der US-Open-Stunde – Journal oder letzter Backtest, `phasen-card`). Alle drei stehen in der „Inhalt“-Leiste der Seite. Termine sind berechnet (Funding-Raster, Deribit-Verfall, NYSE-Zeiten), stammen aus einer Liste mit Quelle und Abrufdatum (FOMC) oder sind vom Nutzer eingetragen; jede Zeile nennt ihre Quelle, Fehlendes heißt „keine Daten“. Tests: `views.termine.test.tsx`, `tests/e2e/termine.spec.ts`.
