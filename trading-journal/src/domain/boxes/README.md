# `src/domain/boxes` — Box-zu-Box engine (pure)

Owner rules (2026-10-12): boxes only automatic, on higher timeframes (4h / 1D), anchored on real supports and
resistances; breakout counts on the candle CLOSE; after a breakout the target is the origin of the move into the box
or the previous box ("Box zu Box"); diagonal RSI trendline breaks confirm the direction; "trade the best, fuck the
rest" → only A+ / A setups are flagged `best`.

```ts
import { analyzeBoxes, findBoxes, boxState, rsiLines, rsiLineText, PHASE_LABEL } from "@/domain/boxes";
```

| Piece | Rule |
|---|---|
| Pivots (`findPivots`) | fractal: high of `pivotLen` (3) bars left (strict) and right (non-strict); confirmed `pivotLen` bars later |
| Formation (`findBoxes`) | newest run of pivots with highs within `tolAtr` (0.8) × ATR 14 and lows likewise, ≥ `minTouches` (2) per edge, edges interleaved (top/bottom alternate — a trend leg is rejected), every close inside the edges ± `breakAtr` (0.25 ATR), height 1.5…14 ATR, ≥ 10 bars. Longest valid run wins. Top / bottom = the extreme touching wicks; `topIn` / `bottomIn` = inner end of the edge band |
| Freeze | after formation the edges stay; only a close beyond `edge ± breakAtr·ATR` breaks out; wicks beyond are sweeps |
| Merge | neighbouring boxes that touch / overlap in price, lie ≤ 12 bars apart, fit in 70 % of `maxHeightAtr` and kept every close inside the union become one box (walked forward again) — the trader's single range instead of sub-boxes |
| Quality | touches 32 · duration 22 · closes inside 18 · height (2.5–9 ATR ideal) 14 · edge balance 8 · sweeps 6 → `stark` ≥ 62, `solide` ≥ 42, else `schwach` |
| Levels (`srLevels`) | pivots (len ≥ 4) clustered within 0.6 ATR, ≥ 2 touches |
| Targets (`boxTargets`) | near edge of an earlier non-weak box beyond the broken edge, origin of the leg into the box, S/R levels; ≥ 0.35 box heights away; nearest 3; fallback measured move |
| State (`boxState`) | relative to the newest box and the LAST CLOSE: inside / breakout / retest (edge tested within 3 bars, close outside) / failed (back inside) / target (extreme since breakout reached T1) / running (> 24 bars); `pending` = live price beyond an edge before the close |
| RSI lines (`rsiLines`) | Wilder RSI 14; pivots 5/3; lines through two pivots with \|slope\| ≥ 0.02/bar, no RSI value beyond the line between them (tol 1.2); broken = 0.6 beyond; fresh ≤ 8 bars |
| Setups (`boxSetups`) | range long/short in the outer quarter, breakout/retest after a close beyond the edge, "pre" when the RSI presses its line; weighted reasons (RSI break, top-trader bias, box quality, higher-timeframe box) → score → A+ ≥ 85, A ≥ 72, B ≥ 55; CRV < 1.5, weak box or "pre" cap at B |

Calibrated on real Binance BTCUSDT.P 4h / 1D (TradingView connector, Feb–Oct 2026, fixtures in `tests/unit/fixtures/`):
the 62–66k range of April–May is one strong box that broke out upward into the 78k rally.

## P02 additions (live wiring)

| File | Contents |
|---|---|
| `config.ts` | `settings.boxes` (passthrough, like `settings.signals`): `boxesCfgOf(raw)` – sanitiser, every field defaulted / clamped (`on`, `alerts`, `notify`, `minGrade` `A+` / `A`, `scanner`, `watchlist` ≤ 20 normalised USDT perps – default `DEFAULT_WATCHLIST` of 10 –, `box` engine knobs); `withBoxesSettings(raw, patch)` keeps unknown keys and returns the same object when nothing changes; `boxesCfgKey`; `gradePasses(g, min)`; `traderBiasOf(reading)` (top traders ≥ 55 % long with a non-negative Whale–Retail-Delta → `1`, mirrored → `−1`, else `0`, no data → `null`); `BOX_TFS`, `HTF_OF` (1D grades 4h, 1W grades 1D), `BOX_TF_MS`, `BOX_TF_LABEL`. |
| `snapshot.ts` | `BoxSnapshot` (what `Trade.boxSnap` holds, `v: 1`), `toBoxSnapshot(analysis, { symbol, tf, side, source })` (the best setup on the TRADE's side, prices at 6 significant digits), `parseBoxSnapshot`, `boxGradeOf(trade)` (reader for analytics), `boxIdOf(tf, box)` (stable id: start bar + edges), `boxKey(analysis)` (fingerprint of everything shown – the live store publishes only when it changes). The live / retro resolver is `@/market/boxes/snapshot`. |

The engine files are unchanged except two fixes (box fix): a measured-move target below zero is dropped (a tall weekly
box, `bottom − height < 0`), and a setup without any target (no CRV) is capped at B – never "best".

`live.ts` (box fix): `reentryIndex(bars, box)` – the first bar of the current run of closes back inside a broken newest
box (± the breakout buffer), `null` when unbroken or outside; the chart draws the box up to its breakout and its live
part from there, never across the bars that closed outside. Tests: `tests/unit/chart.boxPlacement.test.ts` (every drawn
box on real 4h / 1D / 1W bars covers only closes inside its edges ± the buffer).

The live store, alerts and scanner: `src/market/README.md` → "Box-zu-Box live"; the page:
`src/views/markt/README.md`. Tests of the additions: `tests/unit/market.boxes.test.ts` (domain block); the engine itself:
`tests/unit/domain.boxes.test.ts`.
