# Zeitmaschine + Trade-Plan animiert - These (vor dem Prototyp)

Rahmen: Designsystem des Journals (DESIGN.md auf claude/dreamy-dirac-uwi1be): Nothing-Stil, Tinte #0a0a0a mit 22-px-Punktraster,
Doto-Punktmatrix fuer die EINE grosse Zahl, IBM Plex Sans/Mono, Signalrot #e5202e als einziger Akzent, Gruen/Rot nur als Datenfarbe
(#3ddc84 / #ff4d4f), "Bewegung meldet Zustaende, sie schmueckt nicht", Loops endlich. Neu dazu: Frost-Flaechen (Wunsch des Nutzers),
dahinter ein unscharfer Kerzen-Hintergrund, damit das Glas etwas zu zeigen hat.

These: Die Zeit laeuft sichtbar. Ein Plan wird nicht "berechnet", er wird Kerze fuer Kerze durchgespielt - und jeder Lauf endet an
einem Ausgang (Ziel, Stop oder Zeit), den man sieht.

Signature (eins): der Zeitcursor der Zeitmaschine - eine signalrote Haarlinie faehrt von links nach rechts; alle Pfade wachsen mit ihr,
jeder Pfad, der Ziel oder Stop beruehrt, endet dort mit einem Punkt, und dieser Punkt fliegt rechts in seine Ausgangs-Saeule
(Ziel / Zeit / Stop), die sich wie Sand aufschichtet. Am Ende rollt die Erwartung in Doto hoch, mit ehrlichem Intervall.

Trade-Plan: zwei Schritte (Einstieg -> Ausstieg) als Morph. Die Range zeichnet sich ueber den ersten Kerzen, Hoch/Tief rasten
als Linien ein, der Einstieg sitzt am Range-Hoch. Im Ausstieg faellt der Stop per Feder auf die gewaehlte Regel, das Ziel steigt auf
das gewaehlte R; das R-Lineal baut sich auf (1 Block Risiko, n Bloecke Chance), Chance-Risiko zaehlt hoch. Ziehen des Ziels rastet
an ganzen R ein (Haptik-Tick = Rueckmeldung, keine Belohnung).

Bewegung: Eintritt ease-out, Austritt ease-in, Interface Feder mit leichtem Overshoot, Zeitcursor ease-in-out, nichts linear;
Reduced Motion = Endzustand. Ehrlich: Demo-Daten, "Simulation, keine Prognose", keine Orders, keine Belohnung fuer Gewinn.

## Pruefrunden (gesehen)
1. Durchgang 1 (Desktop + 390 px, Schritt 1, Schritt 2, Zeitmaschine Mitte/Ende): Plan-Chart zu flach, Preis-Beschriftung
   rechts abgeschnitten, auf dem Handy unlesbar klein; leeres Lineal in Schritt 1 auf dem Handy; Prozent-Kacheln brechen um;
   Demo-Simulation hatte einen eingebauten Vorteil (Drift) -> zeigte "Leichter Vorteil" auf erfundenen Daten.
   -> Chart responsiv neu gebaut (eigene Geometrie fuer schmal/breit, groessere Schrift, Beschriftung "87,4k" im Rand),
   Lineal in Schritt 1 mobil aus, Kacheln zweizeilig, Drift = 0.
2. Durchgang 2 (Steuerung, Ziehen 3 R -> 2 R, Range-Mitte): Stop-Ausgaenge mit vollem Kerzen-Schlupf fielen weit unter die
   Linie und ueber die Zeitachse; Linien-Beschriftung links kollidierte mit dem Faecher.
   -> Stop mit kleinem Schlupf (bis ca. 0,1 R), Ziel als Limit genau auf R; Beschriftung rechts.
Gegenprobe: keine Skriptfehler; Ziehen rastet bei 0,5 R (Haptik-Tick); Reduced Motion zeigt Endzustand; Ergebnis bei Zufall
ehrlich "Kein belastbarer Vorteil" bzw. "verliert im Schnitt".
