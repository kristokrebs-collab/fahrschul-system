# Lernschleife: aus Fehlern lernen, ohne sich selbst zu täuschen

Forschung zu LLM-Handelsagenten nutzt dasselbe Muster: Trades samt Kennzahlen in ein Gedächtnis schreiben, daraus kurze Reflexionen (kurz-/langfristig) ableiten und beim nächsten Entscheid abrufen. Beispiele: FinMem (geschichtetes Gedächtnis), TrustTrade (Journal plus Reflexions-Agenten über 1 bis 14 und 28 bis 360 Tage), FinAgent, TradingGPT; Übersicht: [LLM Agent in Financial Trading, Survey](https://arxiv.org/pdf/2408.06361). Bekannte Schwäche laut Survey: Rauschen verdeckt, welche Entscheidung Gewinn oder Verlust verursachte. Wirkung unter Realbedingungen ist nicht belegt.

## Umsetzung hier (bewusst vorsichtig)
1. **Journal** (`journal.py add`): R-Multiple je Trade (Gewinn geteilt durch eingeplantes Risiko), Modus (`paper`/`backtest`), Fehler-Tags aus festem Vokabular: `late_entry`, `moved_stop`, `oversized`, `against_plan`, `no_setup`, `revenge`, `fomo`, `ignored_news`.
2. **Auswertung** (`stats`, `review`): Kennzahlen je Strategie, Kosten je Fehler-Tag. Regelentwurf erst ab **5 Fällen** und negativer Summe.
3. **Prüfung neuer Regeln:** nächste ~20 Paper-Trades mit Regel, Vergleich mit den davor; keine Regel am selben Datensatz bestätigen, aus dem sie kam.
4. **Freigabe durch den Nutzer** vor jeder Regeländerung; alte Regeln mit Datum behalten (Änderungsprotokoll).
5. **Drift beobachten:** fällt Ø R über 20 Trades deutlich, Strategie pausieren und prüfen statt „nachlernen“.

## Was dieses System nicht tut
Es handelt nicht live, ändert keine Regeln ohne Dich, optimiert nicht stillschweigend Parameter nach, und verspricht keine Rendite.
