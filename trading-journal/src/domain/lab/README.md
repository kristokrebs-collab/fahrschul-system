# `src/domain/lab` – Regeln, Bibliothek, Pine

Reine Domain-Logik (kein React, kein I/O). Die Oberfläche steht in `src/views/labor` (README dort).

| Ordner / Datei | was |
|---|---|
| `rules/` | Regelbaum „Eigene Idee“: `types.ts`, `tree.ts` (Bereinigen, Prüfen mit Grund, Klartext, Auswertung ohne Blick in die Zukunft), `blocks.ts` + `blocksPlus.ts` (die Bausteine; `kit.ts` = gemeinsame Hilfen), `series.ts` / `indicators.ts` (Reihen: Wilder- / TradingView-Definitionen), `templates.ts` (4 Schnellvorlagen). |
| `library/` | Strategie-Bibliothek: `cards.ts` (32 Karten, typische Werte in drei Einstellungen, eine Quelle für Karte und Entwurf), `search.ts`. Wird nur vom lazy Sheet importiert, nicht vom Barrel. |
| `pine/` | `toPine` (Pine-v6-Skript aus dem Regelbaum, Lücken namentlich), `links.ts` (TradingView-Chart-Link). |
| `extras/` | Zusatzläufe auf dem gezeigten Lauf: `job.ts` (Belastung, Filter, Parameter-Raster, Verwaltung), `paramGrid.ts` (Achsen ±25 %, Zellen), `manageCompare.ts` (F65: derselbe Lauf mit Stop unverändert · Break-even 0,5 / 1 / 1,5 R · Netto-Break-even · Trailing 2 / 3 × ATR · Teilziel – die Signale bleiben, nur `EntrySignal.manage` wird ersetzt; Median R, Kosten, Dauer, Verlustserie und „Ausgestoppt vor dem Ziel“ über die Paarung mit dem Lauf ohne Verwaltung). |
| `stress/`, `filters/`, `diagnosis/`, `report/`, `idea.ts` | siehe die Kommentare in den Dateien. `filters/` kennt zusätzlich den **Muster-Filter** (`pattern`, `FilterSelection.pattern`): nur wenn der Nutzer im Muster-Entdecker ein bestätigtes Muster gewählt hat, erscheint die Zeile; die Maske rechnet `@/domain/discovery/filter`. Der **Terminfilter** (`event`, F43: „Keine Einstiege X Minuten vor/nach einem Termin“, `eventMinutes` / `eventKinds` der Auswahl) erscheint in `filterInfos` erst, wenn er gewählt ist (die Labor-Karte zeigt seine Zeile immer); die Maske `@/domain/events/filterMask` kennt nur regelbasierte Termine (Funding, Verfall, US-Open) und antwortet nie „unbekannt“. |

Regeln: Jeder Baustein ist eine reine Funktion über geschlossene Kerzen mit Tri-State (0 falsch · 1 wahr · 2 unbekannt); unbekannt erfüllt nie eine Bedingung.
Zahlen auf Bibliothekskarten sind keine Ergebnisse. Ein Baustein, der Daten des Laufs braucht (Funding), ist ohne sie gesperrt – mit Grund.

## Abgleich mit TradingView
`tests/unit/lab.blocksPlus.test.ts` rechnet die Reihen von Hand nach und prüft ADX/DI, Stochastic, CCI, Williams %R, Bollinger, RSI, MACD und Ichimoku gegen Werte aus dem
TradingView-Connector (`tests/unit/fixtures/tv-binance-btcusdt-1d-indicators.json`, BINANCE:BTCUSDT 1D, 2026-10-19). Der Screener des Connectors liefert eine Tageskerze, die
nicht Kerze für Kerze mit `get-ohlcv` übereinstimmt (Hoch/Tief/Schluss weichen um etwa 0,1 % ab); die Toleranzen im Test sind diese Quellen-Differenz, nicht die Formel.
Supertrend und Chandelier haben dort keine Vergleichsspalte: sie sind gegen die veröffentlichte Pine-Definition (`ta.supertrend`) nachgebaut und über Eigenschaftstests geprüft,
nicht gegen TradingView-Zahlen.
