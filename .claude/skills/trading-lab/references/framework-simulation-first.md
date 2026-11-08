# Simulation-First-Rahmen (Zusammenfassung eines geteilten Leitfadens)

Quelle: Google-Doc „Claude Trading Framework: Simulation-First Setup Guide“ (vom Nutzer geteilt, Stand 2026-10-28; Autor laut Schlusszeile „@seb.ai“). Das Doc selbst nennt das Ergebnis „$80 → $4,218“ **selbstberichtet, nicht unabhängig geprüft**. Hier nur Inhalt in eigenen Worten, als Arbeitsablauf.

## Schleife: SCAN → SCORE → SIZE → LOG
1. **Zeitfilter (SCAN):** Ist das Setup nur zu bestimmten Zeiten erlaubt? → `scripts/edge_windows.py` (mit Permutationstest, weil bei 24 Fenstern fast immer eines gut aussieht).
2. **Signal-Score (SCORE):** Regeln als transparenter Punktwert (Beispiel nur zur Anschauung: Trend 40, Momentum 25, Volumen 20, Risiko 15; unter 70 auslassen, ab 85 normale Größe). Fehlen Daten: „INSUFFICIENT DATA“ statt raten.
3. **Positionsgröße (SIZE):** Risikobetrag = Konto × Risiko-%; Größe = Risikobetrag ÷ Abstand Einstieg–Stopp (Beispiel: 1.000 $ × 0,5 % = 5 $; Stopp-Abstand 1 $ → 5 Stück). Größe folgt dem Limit, nicht dem Bauchgefühl → `trader-budget`.
4. **Strikte Regeln:** Einstieg, Ungültigkeit/Stopp, Ziel, max. Risiko je Trade, max. Tagesverlust, max. offene Positionen, Pausenbedingungen, Folge eines Regelbruchs → `trader-risk`.
5. **Trade-Log:** Datum/Zeit, Markt, Setup, Score, Einstieg, Stopp, Ziel, Größe, Ergebnis, Gebühren/Slippage, Regel befolgt (ja/nein), Notiz → `scripts/journal.py`.
6. **Wochenrückblick:** Stichprobe, Trefferquote, Ø Gewinn/Verlust, Drawdown, längste Verlustserie, Gebühren, Regelbrüche; Beobachtung von Empfehlung trennen; drei Experimente für die nächste Periode → `journal.py review`.

## Ehrlich testen
Daten zum Regelbau und Daten zum Testen trennen; Gebühren und Slippage; Verlustphasen mitnennen; Stichprobengröße, Drawdown, Regelbrüche berichten; Backtest nie als Live-Ergebnis bezeichnen; ein Screenshot oder eine gute Woche beweist nichts.

## Sicherheitsrahmen aus dem Doc (deckt sich mit `trading-desk`)
Keine Zugangsdaten oder API-Schlüssel in den Chat, keine automatische Orderausführung, jede Ausgabe von einem Menschen geprüft, nichts verspricht Gewinn, erst an ungesehenen Daten testen. Hinweis des Docs auf FINRA Rule 2210 und Investor.gov (US); in Deutschland/EU gelten BaFin/ESMA-Hinweise (siehe `social-drafts`).
