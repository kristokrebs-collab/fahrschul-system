# Backtest-Hygiene (Checkliste)

Quellen (Stand 2026-10, Praxisliteratur; Primärquellen prüfen): López de Prado/Bailey zum Deflated Sharpe Ratio; ["The Three Types of Backtests" (SSRN)](https://papers.ssrn.com/abstract=4897573); [Backtesting & Research Methodology](https://tradingstrategy.ai/docs/learn/backtesting.html); [Walk-Forward Optimization](https://tradescript.substack.com/p/walk-forward-optimization-why-your). Vieles stammt aus Blogs und Kursseiten, Faustregeln sind keine Standards.

## Typische Scheinerfolge
| Fehler | Erkennen / vermeiden |
|---|---|
| Look-ahead (Zukunft im Signal) | Signal nur aus Daten **vor** der Ausführungsbar; Ausführung zur nächsten Bar |
| Survivorship (nur überlebende Aktien) | Delisted/Konkurse einbeziehen, sonst Rendite zu hoch |
| Mehrfachtests | Anzahl Varianten mitzählen, Deflated Sharpe (`scripts/dsr.py`), Ergebnis nach unten korrigieren |
| Überanpassung | wenige Parameter, Plateau statt Spitze (Nachbarwerte ähnlich gut), Walk-forward |
| Kosten vergessen | Gebühren, Spread, Slippage (bei Daytrading entscheidend), Steuern |
| Zu kleine Stichprobe | Faustregel: mindestens ~30 unabhängige Trades je freiem Parameter; mehr ist besser |
| Regimewechsel | Test über Hausse, Baisse, Seitwärts; Teilzeiträume einzeln ansehen |
| Datenqualität | Splits/Dividenden bereinigen, Ausreißer prüfen, Zeitzonen (New York!) |

## Walk-forward in Kürze
Zeitreihe in Folge-Fenster teilen: im Fenster *i* Parameter wählen (In-Sample), im direkt folgenden Fenster *i+1* unverändert testen (Out-of-Sample). Bewertet wird nur die Aneinanderreihung der Out-of-Sample-Stücke. Selbst das schützt nicht vor Selektion, wenn viele Varianten durchprobiert werden (dann zusätzlich DSR).
Fortgeschritten: kombinatorische, bereinigte Kreuzvalidierung mit Purging/Embargo an den Grenzen (viele Pfade statt einer Historie).

## Daumenregeln (grob, nicht belegt)
Backtest-Sharpe für Live grob halbieren denken; verwerfen, wenn das Ergebnis nur mit genau einem Parameterwert funktioniert; Strategie vorab mit Verwerfungskriterium festlegen.
