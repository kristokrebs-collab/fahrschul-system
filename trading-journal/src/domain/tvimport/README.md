# `src/domain/tvimport` – TradingView ways in (F14)

Pure TypeScript, no React, no I/O. Used by the lab's TradingView section (`src/views/labor/TvSection.tsx`).

| file | what |
|---|---|
| `adapters.ts` | `TV_ADAPTERS`, `STATUS_LABEL`: the honest status of every way – `supported` (tester export), `forward` (alert webhook: from now on, trades not signals), `unsupported` (Pine execution, indicator as block, indicator series, account access) – each with `what` and `limits`. No login to TradingView, no scraping, no foreign code. |
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
