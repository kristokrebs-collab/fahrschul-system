# `src/views/biasTest` – "Chart spiegeln / Bias prüfen" (F62)

`MirrorPanel` sits under two charts: the **Markt** box chart (`views/markt/BoxChartCard.tsx`) and the **trade replay**
(`views/trades/replay/TradeReplay.tsx`). Both read their view with `useMirrorState(surface)` and draw it; the panel and the
test flow share the store `flowStore.ts`.

## What is mirrored – and what is not

Only the **price axis** is displayed upside down (`invertScale` of lightweight-charts 5.2.1). Prices, times, bars, boxes,
breakouts and every signal stay exactly as they are; a second flip is the original chart (`src/chart/mirror.ts`, unit-tested).
There is no mathematical inversion and no synthetic counter-return – a real inverse series would be a separate feature.
The chart creates no new long / short signals.

Layers (each its own chip, `aria-pressed`, ≥ 44 px on coarse pointers): **Ausbrüche** (RSI breaks, their glow and the broken
line), **Trendlinien** (active RSI diagonals), **Boxen**, **Eigene Trades** (off by default on Markt – that chart shows none
today), **RSI** (the pane). The **RSI is never mirrored silently**: the optional "RSI als 100−RSI spiegeln" inverts its axis,
and the legend then reads `100−RSI 14` with the mirrored value.

## The guided test

1. **Setup** – what to cover: market name, own position, P&L, long / short colours (neutral grey ramp, form instead of colour).
2. **Schritt 1 · Original** – the picture is frozen at the last *closed* bar (`lastClosedAnchor`; the replay: the bar at the
   playhead). No live data, no later bar, no exit / target of an own trade. Markt shows only the chart (the setups, box status
   and alerts would tell the direction). Direction, conditions and invalidation are written down and **stored with a
   timestamp** (`submitFirst`) – only then the chart turns.
3. **Schritt 2 · Gespiegelt** – the same data upside down; the trader rates again (direction, trigger / conditions,
   invalidation). **Stored** (`submitSecond`) – only then the original comes back, the covered labels return.
4. **Aufgedeckt** – both answers side by side and the plain comparison (`@/domain/biasTest` `compareAnswers`): facts and a
   possible contradiction, **no bias score**.
5. **Verlauf** – past tests with both answers; the outcome (what the price did afterwards) is entered by the trader later.
   An unfinished test stays stored: "Fortsetzen" (same market / interval needed) or "Verwerfen".

A failed write leaves the test where it was. Leaving the page drops the live state, never a stored answer.

## State

- `flowStore.ts` (zustand): `flow` (one test at a time), the free `flipped` per surface, `prefs` (layers, 100−RSI) per device
  in `localStorage` `storageKey("bias-view")` (try/catch; the flip itself is never remembered).
- Records: `settings.biasTests` through `useJournal.saveSettings` – see `src/domain/biasTest/README.md`.
- `model.ts` `visibleMarkers`: which own-trade markers a frozen / blind chart may draw (later trades vanish, exits / P&L stripped).
- `hooks.ts`: `useMirrorState`, `useFrozenBars` (the same array while the closed part is unchanged: a new bar never reloads
  the frozen history).

## Motion / a11y

Tokens only (`tween.fade`, `spring.press`); the panel fades between steps, reduced motion → instant. Switch and chips are
real controls with labels; answer fields have `<label>`s; gaps are announced (`role="status"`). No new `layoutId`, no loops.
