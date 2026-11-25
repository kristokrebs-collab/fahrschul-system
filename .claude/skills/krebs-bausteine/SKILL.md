---
name: krebs-bausteine
description: Katalog aller selbst gebauten Bausteine und der Inspiration dahinter - Orbs/Lichtkugel-Hintergruende, Glas- und Frost-Look, Buttons mit Feder und Haptik, Scramble-Titel, Zaehler, Radar, Kristallisation "Eine bleibt", Tages-Replay, Faecher-Karten, Vorher/Nachher-Karten, Preisleiter, 33 pulse-motion-Komponenten, 14 Stile, Motion-Graphics, Trading-Journal-Prototypen (Frost-Elemente, Setup-Labor, Scanner & Risiko-Rechner, Plan/Zeitmaschine) und Dashboards, dazu die Inspo-Liste (Gmail-Reel, Juicelab, Kaffee-Site, yahi, orvia, Flow, Kinso, Charlie Hills) und die Uebersicht aller Skills. Nutze bei "was haben wir schon gebaut", "zeig mir unsere Komponenten", "Orbs", "Hintergrund-Animation", "Frost", "Glass", "Button-Animation", "Inspo", "wie im Gmail-Reel", "wie das erste Trading-Journal-Design", "Baustein wiederverwenden". Zeigt, wo jede Datei liegt und welche Regeln gelten.
---

# Krebs-Bausteine: alles, was wir gebaut haben

Einstieg zum Wiederverwenden. Erst hier nachsehen, dann die passende Datei oeffnen - nichts neu erfinden, was es schon gibt.

## Wo was liegt
| Bereich | Ort |
|---|---|
| 33 Komponenten + 14 Stile + Glass-Look + Motion-Graphics | Skill `pulse-motion` - Liste: `references/pulse-motion-katalog.md` |
| Trading-Journal Frost-Elemente (Lieblingsstil des Nutzers) | `assets/prototypen/trading-journal-frost/index.html` |
| Setup-Labor mit echten Binance-Kerzen | `assets/prototypen/setup-labor/index.html` |
| Markt-Scanner + Risiko-Rechner (live) | `assets/prototypen/scanner-risiko/index.html` |
| Plan + Zeitmaschine (Demo, ersetzt durch Setup-Labor) | `assets/prototypen/plan-zeitmaschine/index.html` |
| Mega-Test- und Pruefstand-Dashboard (echte Ken-French-Daten) | `assets/dashboards/` (Quelle: Skill `industry-trend-lab`) |
| Inspiration und was daraus wurde | `references/inspo.md` |
| Alle Skills mit Kurzbeschreibung | `references/alle-skills.md` |
Jeder Prototyp hat eine `THESIS.md` (These, Signatur, zwei Pruefrunden).

## Die Bausteine nach Art
- **Hintergruende/Orbs:** treibende Lichtkugeln (Bernstein/Violett/Tuerkis, 38 s ease-out, nur transform) + Korn gegen Banding - `pulse-motion/assets/glass.css`, alle Prototypen (`body::before/::after`). Atmosphaere: unscharfe Kerzen, Punktraster 22 px.
- **Flaechen:** Glass-Look v2 (Zeiger-Licht, lichtzugewandte Kante, `glass.css` + `glass-look.js`), Frost (Milchglas, Rand-Highlight, Tiefenschatten).
- **Typo-Effekte:** Riesenwort hinter Objekt, Scramble/Aufloesen (Titel, Ticker), Umriss-Ziffern ("06", "01"), markiertes Wort (Hintergrund-Sweep), Count-up/Rolling-Zahlen.
- **Buttons & Interaktion:** Hover-Anhub per Feder, `:active` scale .95, Abschluss-Knopf mit Haken-Zeichnen + Ring + Haptik (`navigator.vibrate`), Segment-Schalter, ziehbare Ziel-Linie mit Raststufen, Punkt -> Suchpille.
- **Daten-Animation:** Kristallisation "Eine bleibt" (Canvas, Zeichnen -> Pruefen -> Kristallisieren -> Endtest), Zeitmaschine (roter Zeitcursor, Ausgaenge fliegen in Saeulen), Tages-Replay Kerze fuer Kerze, Radar-Scan, FLIP-Sortierung, Faecher-/Fotowand-Karten, Vorher/Nachher schraeg, Preisleiter mit Feder, Hebel-Balken.

## Regeln (gelten fuer jeden Baustein)
1. Bewegung: Eintritt ease-out `cubic-bezier(.16,1,.3,1)`, Austritt ease-in, Interface Feder `cubic-bezier(.34,1.56,.64,1)` mit leichtem Overshoot, nichts linear; nur transform/opacity/filter/clip-path; `prefers-reduced-motion` = Endzustand sofort.
2. Prototyp zuerst: These -> Prototyp -> zwei gesehene Pruefrunden (Desktop + 390 px) -> erst dann uebernehmen.
3. Echt statt Demo, wo moeglich (Binance `data-api.binance.vision`); ohne Daten ehrlicher Fehler, keine Ersatzdaten.
4. Dopamin nur White-Hat: Belohnung fuer Disziplin, nie fuer Gewinn; Verluste bleiben Verluste; keine Orders, Paper Trading Standard.
5. Externe Skripte nur mit fester Version (CDN), Schriften: Inter Tight + JetBrains Mono (Frost) bzw. Doto + IBM Plex (Journal-System).
