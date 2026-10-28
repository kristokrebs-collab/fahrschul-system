# „Self-Improving Trading Bot“-Roadmap (Instagram-Karussell) → was wir haben

Quelle: Karussell „Build your ultimate self-improving trading bot“ (arwazaz_, 8 Folien, Screenshots vom Nutzer, Stand 2026-10-28). Die Roadmap-Inhalte selbst wurden nicht abgerufen (Kommentar-Gate). Zuordnung nach den sichtbaren Folien-Titeln.

| Schritt (Folie) | Bei uns | Anmerkung |
|---|---|---|
| 01 System-Architektur | `trading-desk` (Karte), `trading-lab` | Strategie-Engine, Datenbank/Journal, Monitoring |
| 02 Daten & Research | `trader-scanner`, `trader-news`, `trader-analyst`, `industry-trend-lab` | freie Quellen (Yahoo, EDGAR, French) |
| 03 Strategie-Entwicklung | `trading-lab`, `trader-entry`, `trader-exit` | Hypothese vorab, Verwerfungskriterium |
| 04 Backtesting & Validierung | `trader-timemachine`, `scripts/dsr.py`, `references/backtest-hygiene.md` | Walk-forward, Mehrfachtest-Korrektur |
| 05 Selbstverbesserungs-Schleife | `scripts/journal.py review`, `references/learning-loop.md` | Vorschläge, Freigabe durch Dich |
| 06 Ausführung & Risiko (Broker/MT5) | `trader-risk`, `trader-budget`, `trader-broker` | **Live-Ausführung bewusst nicht gebaut**; nur Paper, Ticket + manuelles „Ja“ |
| 07 Deployment & Monitoring | `trader-alerts`, `morning-note` | Alarme statt Auto-Handel |
| 08 Tools/Repos | `.claude/setup/MCP-und-Plugins.md` | Python, TradingView-Daten über freien Konnektor |

Die Folien stellen „Paper → Live“ als Phasen dar. Das Karussell führt Schritt 6 mit direkter MT5-Order aus Python vor: Das ist die Stelle, die wir ausdrücklich **nicht** automatisieren (`trading-desk`, Regel 1).
