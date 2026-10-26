# `src/domain/tvimport` – TradingView ways in (F14)

Pure TypeScript, no React, no I/O. Used by the lab's TradingView section (`src/views/labor/TvSection.tsx`).

| file | what |
|---|---|
| `chart.ts`, `indicators.ts` | F64 indicator contract and check, see the last section. |
| `adapters.ts` | `TV_ADAPTERS`, `STATUS_LABEL`: the honest status of every way – `supported` (tester export), `forward` (alert webhook: from now on, trades not signals), `unsupported` (Pine execution, indicator as block, indicator series as a source for a run, account access); the chart-data check is `supported` – each with `what` and `limits`. No login to TradingView, no scraping, no foreign code. |
| `parse.ts` | `parseTvTrades(text, { utcOffsetMinutes })`: the strategy-tester export "List of trades". Columns by HEADER (EN / DE names, currency in the name, any order; cumulative / run-up / drawdown columns ignored), delimiter detection (`,` `;` tab), quotes and quoted line breaks, BOM, CRLF; numbers `1,234.56` / `1.234,56` / `−12,5` / `(3.5)`; dates ISO (with offset), `dd.mm.yyyy`, `mm/dd/yyyy` (ambiguity warned). Entry + exit row per trade number are paired; an exit row marked "Open" or a missing exit = open trade. Errors carry the 1-based LINE of the file; readable rows are kept. |
| `compare.ts` | `compareTrades(tv, lab, { barMs, labFrom, labTo })`: pairing by direction and entry time (one execution bar of tolerance, each trade once), common period, open trades left out, net difference (all compared / paired only), unit-free sum of price moves, and `reasons[]` – observations backed by figures (costs, position size, order of high / low inside a candle, entry delay, exits, unpaired trades), phrased as "kann", never as a proven cause. |

Money is only comparable when both sides traded the same size; the export has no risk sizing, the lab does. The comparison therefore
shows the net with that caveat and the sum of price moves next to it.

Relation to `src/exchanges/csv/formats.ts` (`tradingViewFormat`): that one imports the same export INTO THE JOURNAL as "Backtest"
trades (English headers only). This module only reads for the comparison and never writes to the journal.

## Webhook (`netlify/functions/hooks-tradingview.mts`) – unchanged
Read and kept as is: the secret is the personal token in the URL path (TradingView cannot send headers; there is no signature to
check), scope `webhook:tradingview`, plan `apiAccess`, 60 / min per token, body ≤ 16 KiB, idempotent per alert id. It creates
and closes real trades (`open` needs a size), so it is a forward test of what an alert sends, not a signal feed and not a way to
backtest. A signal-only alert (no trade) would need its own table and a retention decision; it was not added.

## Tests
`tests/unit/tvimport.test.ts` (reader, numbers, dates, columns, errors with lines, adapters, comparison),
`tests/unit/views.labor.tv.test.tsx` (cards, upload in the browser, comparison, zone shift, error lines).

## Hinweg: Pine-Export (F14 / F64)
Der Rückweg (Strategietester-Export) hat jetzt einen Hinweg: `@/domain/lab/pine` – `toPine(config, options)` erzeugt aus dem Regelbaum von „Eigene Idee“ eine
lesbare Pine-v6-Strategie (`strategy()`, Bausteine als `ta.*`, Stop/Ziel/Break-even/Trailing/Teil-Gewinn/Zeit-Stop, Gebühr/Größe/Slippage aus dem Lauf,
höhere Zeitebenen per `request.security` ohne Blick in die Zukunft). Nicht übersetzbare Bausteine (MCB-Punkte, MCB-Leiter, Premium/Discount, RSI-Linie, Funding)
werden namentlich aufgelistet und stehen im Skript als Eingabe „als erfüllt annehmen“ (Standard aus) – nie still weggelassen. `tvChartUrl(symbol, interval)` ist nur ein Link
auf `BINANCE:<SYMBOL>.P`. Adapterstatus `pine-export` = unterstützt. Die App führt Pine weder aus noch prüft sie es; ein Compilerfehler in TradingView steht dort in Zeile und Text.

## Indikator-Vertrag und Abgleich (F14 / F64)
`chart.ts` reads the TradingView export "Chartdaten exportieren" (`parseTvChart`: time, open, high, low, close, optional volume, one `ChartColumn` per plot; tolerant like the
trade reader, unreadable rows are listed with their line and left out, an empty cell = no value). `indicators.ts` holds the contract of the 12 indicators the lab calculates
(`INDICATORS`: Pine call, inputs, output series, `compute`, `validation` = `tv` on a named TradingView value or `definition` only) and the check `compareIndicator(chart, column,
def, output, inputs)`. Facts, not claims: `warmupOf` MEASURES the first candle with a value by running the real function on the fixed series `testBars`; the settle time of a recursive smoothing is a rule of thumb
derived from its memory (`settle`, RMA / EMA memory), not a measurement; and a property test shows that a value never changes when later
candles are added (no repainting; only the running candle is provisional). The tolerance is half a unit of the last decimal the export wrote; the verdict is `equal` (within
the export's rounding), `differs` (with the five largest deviations), `open` (file too short to settle) or `few` (too few common values) – never a certificate, valid for this
file and these inputs. `guessColumn` pre-fills the indicator for a recognised column name (ambiguous names such as "Basis" stay unassigned). The columns are only compared, never
used as a signal or as candles for a run. Honest limit: tested against rebuilt export files, not against a real one from a TradingView account; EMA, ATR and Keltner are built
from the published definition (EMA/ATR are checked indirectly through MACD/ADX).
Tests: `tests/unit/tvimport.indicators.test.ts`, `tests/unit/views.labor.tv.indicators.test.tsx`, `tests/e2e/indicator-check.spec.ts`.
