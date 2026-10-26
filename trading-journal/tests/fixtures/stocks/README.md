# Fixtures der Aktien-Funktionen (F67/F68)

Echte Antworten der öffentlichen Quellen, abgerufen am **2026-10-25** (Sonntag, Markt zu; der letzte Handelstag ist Fr 2026-10-23).
Nichts davon ist nachgebaut, nur gekürzt.

| Datei | Quelle | Inhalt |
|---|---|---|
| `nasdaqlisted.txt`, `otherlisted.txt` | `https://www.nasdaqtrader.com/dynamic/SymDir/` | je 14–18 Zeilen aus den Verzeichnissen (Kopfzeile und `File Creation Time: 1023202621:31` unverändert): Stammaktien, Klassenaktien, ADRs, ETFs, Test-Papiere, Warrants, Units, Vorzugsaktien |
| `yahoo-aapl-1d-5d.json` | `query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1d&range=5d` | 5 Tageskerzen (Mo–Fr), Meta mit Kurs, Volumen, 52-Wochen-Spanne |
| `yahoo-aapl-5m-1d.json` | `…/AAPL?interval=5m&range=1d&includePrePost=false` | der Handelstag Fr 2026-10-23: 78 reguläre 5-Minuten-Kerzen **plus** der Schlussdruck um 16:00 (Volumen 0), den der Parser verwirft |
| `yahoo-brkb-1d-5d.json` | `…/BRK-B?interval=1d&range=5d` | Klassenaktie mit Bindestrich |
| `yahoo-bad-symbol.json` | `…/ZZZZNOPE?…` | die 404-Antwort für ein unbekanntes Kürzel |
| `tv-aapl-1d-rsi.json` | TradingView (Connector `get-ohlcv` NASDAQ:AAPL 1D und `get-symbol-data` RSI), abgerufen am **2026-10-26** | 250 Tagesschlusskurse 2025-10-27 bis 2026-10-23 und TradingViews eigenes RSI(14) der letzten beiden Kerzen – nur zum Gegenprüfen unserer RSI-Rechnung (`tests/unit/scanner.reference.test.ts`), Abweichung unter 0,05 |
| `yahoo-rss-tsla.xml` | `feeds.finance.yahoo.com/rss/2.0/headline?s=TSLA&region=US&lang=en-US` | die ersten 4 von 18 Schlagzeilen |

Yahoo ist inoffiziell: Format und Verfügbarkeit können sich ohne Ankündigung ändern. Die Tests prüfen den Parser gegen diese
Dateien; ob die Quelle heute noch genauso antwortet, zeigt nur ein Live-Abruf (`curl` mit gewöhnlichem User-Agent).
