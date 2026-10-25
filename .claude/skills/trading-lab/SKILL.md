---
name: trading-lab
description: Lern-Labor für Trading-Strategien, nur Backtest und Paper Trading. Nutze bei "Strategie testen", "Backtest", "Walk-forward", "Overfitting", "Trade-Journal", "aus Fehlern lernen", "selbstlernender Trading-Bot", "Trading-Algorithmus erkennen" oder Strategie-Ideen. Liefert Prüfregeln gegen Scheinerfolge (Deflated Sharpe, Walk-forward, Kosten), ein Journal mit Fehleranalyse (scripts/journal.py) und Regelvorschläge, die der Nutzer freigibt. Handelt nie live, ändert nie selbst Regeln, keine Finanzberatung.
---

# Trading-Lab (Backtest, Paper, Lernschleife)

Gilt zusammen mit `trading-desk` (keine Order ohne manuelles „Ja“, Paper Trading, keine Finanzberatung). Dieser Skill sendet **nie** Orders und kennt keine Broker-Zugänge.

## Ablauf
1. **Hypothese vorab schriftlich** (Marktlogik, Messgröße, Verwerfungskriterium), bevor Daten angesehen werden. Zahl der ausprobierten Varianten mitzählen.
2. **Backtest mit Hygiene** (`references/backtest-hygiene.md`): kein Blick in die Zukunft, Gebühren/Spread/Slippage, nur historisch verfügbare Daten, Zeitraum in Trainings- und Testteil trennen.
3. **Walk-forward statt einmaliger Optimierung:** Parameter nur im Fenster wählen, gewertet wird nur die Zusammensetzung der Test-Fenster.
4. **Mehrfachtest-Korrektur:** `python3 scripts/dsr.py trials.csv` (Deflated Sharpe). Unter 0.95 gilt der Vorteil als **nicht belegt**.
5. **Paper Trading** mit festen Regeln, jeder Trade ins Journal: `python3 scripts/journal.py add ...` (Einstieg, Ausstieg, Stop, Fehler-Tags).
6. **Lernschleife:** `journal.py stats` und `journal.py review` (siehe `references/learning-loop.md`). Ergebnis sind **Regelvorschläge als Entwurf**. Der Nutzer entscheidet; jede neue Regel wird an **neuen** Daten bestätigt, nicht an denen, aus denen sie entstand.

## Grenzen (immer offen sagen)
- „Lernt aus Fehlern“ heißt hier: Journal auswerten, Regel vorschlagen, Nutzer prüft. Kein System, das sich selbst umschreibt und handelt.
- Unter 30 Trades sind Kennzahlen kaum aussagekräftig; Paper-Fills sind besser als echte (kein Slippage, keine Teilausführung).
- Vergangenheit sagt die Zukunft nicht voraus. Ein Test beweist keinen Gewinn.
- Fehler-Zuordnung ist unsicher: Ein Verlust kann Pech statt Fehler sein.
- Daten nur aus freien/offiziellen Quellen (siehe `trader-timemachine`, Yahoo, EDGAR) und mit Quelle/Zeitraum nennen.

## Dateien
`scripts/journal.py` (Trades, Statistik, Fehlerkosten, Regelentwurf) · `scripts/dsr.py` (Deflated Sharpe) · `references/backtest-hygiene.md` · `references/learning-loop.md` · `references/automation-ideas.md` (Ideen für Hintergrund-Automationen mit Risiken).
Journal liegt in `trader/journal.json` (nicht committen).
