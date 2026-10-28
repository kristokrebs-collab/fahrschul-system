# Ergebnisse und Grenzen (Rückblick, kein Versprechen)

Eigener Lauf mit `scripts/industry_trend.py`, 48 Branchen, tägliche Wertgewichtete Renditen, Geldmarkt = RF aus den French-Faktordaten. Signal am Schlusskurs, Rendite ab Folgetag. Zahlen sind Simulation.

| Lauf (bis 2024, Zeitraum des Papers) | CAGR | Vola | Sharpe | max. Drawdown |
|---|---|---|---|---|
| Standard (Hebel bis 2, ohne Kosten) | 21,6 % | 22,4 % | 0,85 | 76 % |
| Standard, 5 bp Kosten je Seite | 19,5 % | 22,5 % | 0,77 | 77 % |
| ohne Hebel (max. 1), ohne Kosten | 12,7 % | 12,2 % | 0,80 | 58 % |
| ohne Hebel, 5 bp Kosten | 11,6 % | 12,3 % | 0,71 | 59 % |
| Markt (Buy & Hold) | 9,7 % | 17,1 % | 0,45 | 84 % |
| **Paper (Angabe der Autoren)** | 18,2 % | ca. 12 % | **1,39** | n. n. |

Teilzeiträume (Standardlauf ohne Kosten, Daten bis 2026-09): 1950 bis 1999 stark über dem Markt (Sharpe 1,2), 2000 bis 2013 mäßig, **2014 bis 2026 unter dem Markt** (CAGR 12,4 % gegen 13,5 %, Sharpe 0,52 gegen 0,69).

## Warum die Zahlen vom Paper abweichen können (nicht geklärt)
- Gewichtung/Hebel/Geldmarkt-Details sind aus Artikel und Replikationsstudie rekonstruiert, nicht aus dem Original-Code; die Formeln der Studie waren im abgerufenen Text nicht lesbar.
- Das Paper rechnet mit Kosten/Slippage in eigener Form; hier einfache Basispunkte auf den Umschlag (20 bis 36 mal pro Jahr).
- Datenstand: French-Daten wurden seither revidiert; hier Ausgabe 202609.
- Fazit: **Der Sharpe-Wert des Papers wurde nicht reproduziert.** Die Replikationsstudie (Columbia, [arXiv 2412.14361](https://arxiv.org/abs/2412.14361)) nennt ebenfalls Grenzen in der jüngeren Zeit.

## Offene Fragen vor jeder Nutzung
Steuern, Handelbarkeit (Branchenportfolios sind keine Fonds; ETF-Ersatz hat andere Renditen), Hebelfinanzierung, Umschlag, Kapitalgröße. Keine Anlageberatung.
