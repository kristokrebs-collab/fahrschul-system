---
name: industry-trend-lab
description: Eigener Nachbau der Branchen-Trendstrategie aus "A Century of Profitable Industry Trends" (Zarattini & Antonacci, 2024) mit freien Ken-French-Daten (48 US-Branchen, ab 1926) als Backtest-Labor. Nutze bei "Century of Profitable Industry Trends", "Branchen-Trend", "Trendfolge Branchen", "Donchian Keltner Strategie", "Momentum Industry", "Strategie über 100 Jahre testen". Läuft nur als Rückblick-Simulation, nennt Teilzeiträume, Kosten und ehrliche Abweichungen vom Paper. Mit Prüfstand (validate.py: 60/20/20-Split, Walk-forward, Robustheit, Kosten, Tor), Mega-Test (megatest.py: 10.000+ Varianten, 10.000 Monte-Carlo-Pfade, Vault, Demo-Signale, Freigabe-Warteschlange) und HTML-Dashboards. Keine Orders, keine Anlageberatung.
---

# Industry-Trend-Lab (Backtest, nur Simulation)

Gilt zusammen mit `trading-desk` und `trading-lab` (keine Order, keine Finanzberatung, Rückblick ist keine Prognose).

## Was das ist
Long-only-Trendfolge auf **48 US-Branchenportfolios** (Daten: [Kenneth French Data Library](https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/data_library.html), kostenlos, 1926 bis heute). Quelle der Idee: [Paper von Zarattini & Antonacci](https://concretumgroup.com/a-century-of-profitable-industry-trends/), Regeln zusätzlich aus der [Replikationsstudie (arXiv 2412.14361)](https://arxiv.org/abs/2412.14361) und dem [Python-Artikel von Concretum](https://concretumgroup.com/backtest-a-profitable-trend-following-strategy-using-python/) (Parameter). **Der Code hier ist eigener Code**, nicht deren Code.

## Benutzen
```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/industry_trend.py" --download ~/french-data      # lädt 2 freie Dateien, rechnet ca. 10 s
python3 "${CLAUDE_SKILL_DIR}/scripts/industry_trend.py" --industry <zip> --factors <zip> --end 2024 --cost-bps 5 --max-lev 1
```
Regeln und Parameter stehen im Kopf des Skripts. Parameter (20/40 Tage, Keltner 2×1,4, Ziel-Vola 2 %, max. Hebel 2) stammen aus dem Artikel; **nichts davon wurde hier optimiert**.

## Prüfstand und Dashboard (selbstverbessernde Schleife, nur Simulation)
```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/validate.py" --industry <zip> --factors <zip> --lab-dir lab   # schreibt lab/results.json + lab/experiments.json
python3 "${CLAUDE_SKILL_DIR}/scripts/make_dashboard.py" --results lab/results.json --out lab/dashboard.html   # eine einzelne HTML-Datei
```
Ablauf: Daten 60/20/20 teilen (Entwicklung/Validierung/Endtest), Basis gegen Kandidat mit Kosten rechnen, Walk-forward (10 J. wählen, 5 J. anwenden), Parameter-Heatmap (Plateau statt Einzelgipfel), Monatsverteilung, Kosten-Szenarien, Deflated Sharpe über alle getesteten Varianten. **Tor: Kandidat nur übernehmen, wenn alle Prüfungen bestehen**, sonst bleibt die Basis. Jeder Lauf wird in `experiments.json` protokolliert (v1, v2, ...). Das Dashboard zeigt nur diese echten Zahlen, es erfindet nichts und sendet keine Orders. Erster Lauf (2026-10-28): Kandidat 40/20 wurde **verworfen** (Endtest, Robustheit, Kosten und Mehrfachtest nicht bestanden).

## Mega-Test: 10.000+ Varianten, ein Tor, ein Vault (nur Simulation)
```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/megatest.py" --industry <zip> --factors <zip> --lab-dir lab            # voller Lauf: 12.096 Varianten, ca. 25 bis 30 Min auf 4 Kernen
python3 "${CLAUDE_SKILL_DIR}/scripts/megatest.py" ... --quick --paths 2000                                  # Test: 36 Varianten, ca. 25 s
python3 "${CLAUDE_SKILL_DIR}/scripts/make_dashboard.py" --template megatest                                  # lab/megatest.json -> lab/megatest-dashboard.html
python3 "${CLAUDE_SKILL_DIR}/../trading-lab/scripts/outbox.py" list --lab-dir lab                            # Freigabe-Warteschlange (nur Papier)
```
- **Raster:** up 10 bis 65, down 20 bis 130, Keltner 1,0 bis 4,0, Ziel-Vola 1 bis 3 %, Hebel 1 bis 2; jede Variante über die ganze Historie mit Kosten (5 bp). Der schnelle Rechenkern wurde gegen `industry_trend.py` geprüft (Abweichung 1e-13).
- **Auswahl** nur auf den ersten 80 % der Daten; die letzten 20 % sind Prüfdaten. **Tor:** Deflated Sharpe über alle Varianten, Endtest gegen Basis, Plateau der Nachbarn, Rendite nach 10 bp über Markt, Monte-Carlo-Verlustchance <= 20 %. **Nur wer alles besteht, kommt in `lab/vault/strategies.json`**; sonst bleibt die Basis.
- **10.000 Monte-Carlo-Pfade** (Block-Bootstrap, 5 Jahre) der Kandidatin für den Fächer im Dashboard.
- **Demo-Signale:** grüner Punkt = Demo-Kauf, roter Punkt = Demo-Verkauf, letzte 60 Handelstage; Protokoll `lab/vault/protokoll.jsonl`. **Es wird nichts gesendet.** Freigabe = nur Papier-Eintrag (`outbox.py`, mit Notaus, kein „alles freigeben“). Echte Orders brauchen weiter dein ausdrückliches „Ja“ (`trader-risk`, `trader-broker`).
- **Echter Lauf (2026-10-30, 12.096 Varianten, 23 Min auf 4 Kernen):** Kandidatin 65/20, Keltner 1,0, Ziel-Vola 1 %, Hebel 2 hatte in der Auswahl Sharpe 1,26, im Endtest nur 0,39 (Basis 20/40: 0,54). **Verworfen**: Endtest und Kosten (5,5 % gegen Markt 11,5 % nach 10 bp) nicht bestanden; Deflated Sharpe 1,00 (bei 20 Jahren täglicher Daten sehr nachsichtig), Plateau und Monte-Carlo (Verlustchance 3,9 %) bestanden. **Rang-Korrelation Auswahl gegen Endtest über alle Varianten: -0,00**, also kein Zusammenhang. Vault: 0 Einträge. Beispiel: `assets/beispiel-megatest-dashboard.html`.
- **Ehrlich:** Wer in der Auswahl vorn liegt, bleibt im Endtest oft nicht vorn (Rang-Korrelation steht im Dashboard). Der Stand der Signale ist der letzte Datenstand (Ken French, nicht live). Muster aus Harvey (nur Bauweise, kein Code): `trading-lab/references/harvey-muster.md`; TradingView nur lesend: `trading-lab/references/tradingview-lesend.md`.

## Ergebnisse dieser Umsetzung (Stand 2026-10-28, Daten bis 2026-09-30)
Siehe `references/ergebnisse-und-grenzen.md`. Kurz: Der Markt-Vergleichswert (9,7 % p. a.) stimmt mit dem Paper überein, die Rendite ist ähnlich, die **Sharpe-Kennzahl des Papers (1,39) wird nicht erreicht** (hier 0,7 bis 0,9). Seit 2014 liegt die Strategie hier **nicht** über dem Markt.

## Wie Claude damit umgeht
1. Immer Teilzeiträume, Kosten und Hebelvariante mitnennen; nie nur die Gesamtzahl.
2. Abweichung zum Paper offen sagen; nicht "bestätigt" schreiben.
3. Ergebnis als Rückblick kennzeichnen, nie als Empfehlung ("kauf Branche X").
4. Vor Parameteränderungen: Zahl der Varianten mitzählen, `trading-lab/scripts/dsr.py` verwenden.
