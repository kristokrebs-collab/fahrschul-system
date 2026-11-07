# `src/domain/industryTrend` – Branchen-Trend (Aktien › Branchen-Trend, F67)

Pure TypeScript, no React, no I/O. The signal rule of **Zarattini & Antonacci (2024), „A Century of Profitable Industry Trends“**, ported from the lab script
`megatest.py` (skill `industry-trend-lab`, the functions marked „gleiche Semantik wie industry_trend“) to the 48 industries of Kenneth French's data library.
A look BACK at past prices – no forecast, no advice, no order.

| file | what |
|---|---|
| `config.ts` | `TrendParams`, `BASE_PARAMS` (up 20, down 40, Keltner 2.8, target volatility 2 %, leverage 2), cost 5 bp, `strategyId` (`s-20-40-2.8-0.02-2.0`, Python number spelling), the 48 German industry names, `fmtDay`, `paramsText`. |
| `indicators.ts` | `ema` (seeded with the first value), `rollExtreme`, `rollMeanChange`, `rollStd0` (population σ) – the same warm-up and the same order of sliding sums as the script, so floats are equal, not just close. |
| `signal.ts` | `runSignal(returns, {up, down, kelt})` → `exposure` per day + the weight unit of the last day; `lastChangeIndex`; `weights` (target volatility × unit, all scaled together when the sum is above the leverage cap). |
| `ampel.ts` | `computeAmpel(dataset)` → the 48 rows (green / cash, day of the last change, target weight) and the changes of the last 60 trading days; yields between industries (`yieldEvery`/`pause`) so no task runs long; `IndustryDataset` (basis points, industry-major, `MISSING = -32768`). |
| `protokoll.ts` | the paper protocol in the format of the lab script's `vault/protokoll.jsonl` (`erfasst, datum, branche, signal, strategie, modus: "DEMO/PAPIER", gesendet: false, hinweis`): build from events, merge without duplicates, `.jsonl` out and in. |
| `paper.ts` | **C1** Branchen-Signal → Papier-Position, rein: `TrendSignal` (`signalIdOf`, `signalOfRow`, `signalAgeDays`), `INSTRUMENTS` (22 ETFs als grobe Näherung), `planFromBars` (Einstieg = letzter Schluss, Stop 2 × ATR, Ziel 2 R, Zeitstopp 20 Tage), `decide` (die Risikoregel, zehn Regeln mit Grund), `openPosition` (idempotent), `closePosition`, `positionForRed`, `bookOfStored`, `bookStats` |
| `pine.ts` | `buildPine(params)` – a Pine **v5 indicator** (dots, channels, stop, two `alertcondition`s with a JSON message), the notes on what differs, `PAYLOAD_JSON_SCHEMA`. `toPine` of the lab (`@/domain/lab/pine`) is not reusable: it turns a rule tree into a v6 *strategy* from the lab's blocks, and the channel / Keltner / trailing-stop rule is none of them – only its conventions (honest header, deterministic, snapshot-tested) are kept. **Not compiled in TradingView.** |
| `result.ts` | `parseMegatest(text)` – the lab result file (`megatest.json`) checked field by field (types, sizes, equal lengths; the first wrong place is named), `verdictOf` – accepted only when EVERY check passed; a file whose word contradicts its own checks is marked inconsistent and the checks win. |
| `chartMath.ts` | histogram, ranges, share below the diagonal, log gridlines, ease-out, crosshair index – the numbers behind the three charts. |

## What is verified against what
- `tests/unit/industryTrend.signal.test.ts`: a mini example worked out by hand (comments show the arithmetic), indicators against hand values, and **eight cuts of real Ken-French series run through the user's own Python `signal_pass`** (`tests/fixtures/industryTrend/signal-cases.json`, made by `megatest.py` unchanged; same day of every change, same weight). The whole real file (48 industries, 26,338 days) was compared once too: the 48 states and every change day are identical (not a test – the 21 MB CSV is not in the repo).
- `industryTrend.protokoll.test.ts`: the first 12 lines of a REAL `protokoll.jsonl` read and written back character by character.
- `industryTrend.result.test.ts`: the shipped example is a REAL run (`public/branchen-trend/beispiel-megatest.json`); its verdict is **VERWORFEN** (end test and cost check failed), and that is what the tests pin.
- `industryTrend.pine.test.ts`: structure of the Pine text, the rule lines against the lab's, the payload against its JSON schema. Not TradingView.

## Papier-Portfolio (C1)

`paper.ts` + `src/views/aktien/branchen/paperStore.ts` / `PaperCard.tsx`. **Grün** = Long im ETF, **Rot** = Cash (die offene Position der Branche wird geschlossen), **nie Short**. Der Weg: Signal → Prüfung des Kandidaten (Kerzen des ETFs, die Zeitmaschine spielt den Prüfplan 10 000 Mal durch, die Simulation wird mit `tradeId` = ID der Position gespeichert) → **Risikoregel** (Not-Aus aus · Richtung grün · Alter des Signals ≤ 4 Tage · ETF in der Liste · kein Doppelsignal · keine zweite Position je Branche / ETF und höchstens 5 offene · Kerzen ≥ 200 und höchstens 5 Tage alt · Zeitmaschine ≥ 1 000 Läufe und nicht „Stop deutlich vor Ziel“ · 1 % Risiko je Position, höchstens 25 % des 10.000-$-Papierkontos, kein Hebel · mindestens ein ganzes Stück) → genau eine Position mit `signalId` / `simulationId` / `tradeId` → Historie. **Idempotent**: die Signal-ID und daraus die Positions-ID sind abgeleitet; dasselbe Signal ein zweites Mal – oder der Knopf zweimal – eröffnet nichts (`duplicate`); die Regel wird beim Eröffnen auf dem Buch von jetzt noch einmal angewandt. **Veraltete Daten** eröffnen nichts: Die Forschungsdatei von Ken French liegt Wochen zurück, dort sagt die Regel „veraltet“ und lädt nicht einmal Kerzen – die Brücke öffnet erst, wenn frische Signale kommen (der Weg `ingest` für TradingView ist die Signal-Struktur selbst, noch nicht angeschlossen). **Not-Aus**: keine neue Position, Schließen bleibt möglich. Nur Papier: `modus: "PAPIER"`, `gesendet: false`, kein Aufruf irgendeiner Börse; die Füllung ist der letzte Schlusskurs (Annahme).

## Not here on purpose
- The 12,000-variant run, the deflated Sharpe, the plateau and Monte-Carlo checks: the Python script computes them; this module only reads and judges their result.
- The portfolio return curve of the base rule (needs the risk-free rate from the factor file, which the app does not load).
- Any order, broker, or TradingView receiver.
