---
name: industry-trend-lab
description: Eigener Nachbau der Branchen-Trendstrategie aus "A Century of Profitable Industry Trends" (Zarattini & Antonacci, 2024) mit freien Ken-French-Daten (48 US-Branchen, ab 1926) als Backtest-Labor. Nutze bei "Century of Profitable Industry Trends", "Branchen-Trend", "Trendfolge Branchen", "Donchian Keltner Strategie", "Momentum Industry", "Strategie über 100 Jahre testen". Läuft nur als Rückblick-Simulation, nennt Teilzeiträume, Kosten und ehrliche Abweichungen vom Paper. Keine Orders, keine Anlageberatung.
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

## Ergebnisse dieser Umsetzung (Stand 2026-10-28, Daten bis 2026-09-30)
Siehe `references/ergebnisse-und-grenzen.md`. Kurz: Der Markt-Vergleichswert (9,7 % p. a.) stimmt mit dem Paper überein, die Rendite ist ähnlich, die **Sharpe-Kennzahl des Papers (1,39) wird nicht erreicht** (hier 0,7 bis 0,9). Seit 2014 liegt die Strategie hier **nicht** über dem Markt.

## Wie Claude damit umgeht
1. Immer Teilzeiträume, Kosten und Hebelvariante mitnennen; nie nur die Gesamtzahl.
2. Abweichung zum Paper offen sagen; nicht "bestätigt" schreiben.
3. Ergebnis als Rückblick kennzeichnen, nie als Empfehlung ("kauf Branche X").
4. Vor Parameteränderungen: Zahl der Varianten mitzählen, `trading-lab/scripts/dsr.py` verwenden.
