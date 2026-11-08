# Setup-Labor "echt" - These (vor dem Prototyp)

Ausloeser: Nutzer-Feedback zu v1 (plan-zeitmaschine): Animation schwaecher als beim Frost-Prototyp, und "alle Komponenten
muessen in echt klappen - Gruende, die auf Volumen oder Ausbruechen beruhen".

These: Jede Zahl ist echt, jede Bewegung zeigt einen echten Rechenschritt. Echte BTCUSDT-5-Min-Kerzen von Binance
(dieselbe Quelle wie das Journal: data-api.binance.vision), 60 Tage, live nachgeladen. Ein Setup gilt nur mit Gruenden:
Ausbruch (Schluss ausserhalb der Range), Volumen (x-fach ueber dem 20-Kerzen-Schnitt), Trend (Kurs auf der richtigen Seite
der EMA 50). Note A+/A/B/C wie im Journal - nur A+ und A zaehlen.

Signatur (eins, wie im Frost-Prototyp, den der Nutzer gelobt hat): die Kristallisation - jetzt mit 800 ECHTEN Varianten
der Ausbruchsregel (Range 15-60 Min x Volumen-Schwelle x Ziel x Stop x Trendfilter), jede auf den echten Kerzen
durchgerechnet; der Beste wird auf den ersten 80 % der Tage gewaehlt und laeuft ehrlich in die letzten 20 %.

Inspo-Uebersetzung: Riesenwort mit Scramble (orvia/Kaffee), Zaehler zaehlt geladene Kerzen hoch (orvia), Punkt->Pille fuer
den Live-Kurs (yahi), Tag-Replay Kerze fuer Kerze mit aufsteigendem Volumenbalken, Gruende erscheinen einzeln mit
Haken + Haptik-Tick (Flow-Klick), fruehere Faelle als verstreute Karten, die sich nach Ausgang sortieren (Flow-Fotowand),
Vorher/Nachher-Karten Auswahl vs. Endtest (Flow before/after), Frost-Flaechen (Gmail).

Stil: Frost-Prototyp (Inter Tight / JetBrains Mono, Frost ueber Farbszene, Mint = "erfuellt / der Beste"), Gewinn/Verlust nur
als Datenfarbe. Bewegung: Eintritt ease-out, Austritt ease-in, Feder mit leichtem Overshoot, nichts linear, Reduced Motion
= Endzustand. Ehrlich: Rueckblick und Simulation, keine Prognose, Gebuehren eingerechnet, keine Orders, keine Belohnung
fuer Gewinn. Ohne Verbindung: ehrlicher Fehlerzustand statt Ersatzdaten.

## Pruefrunden (gesehen, echte Daten: 18.000 Kerzen, 44 Handelstage)
1. Durchgang 1 (Desktop + 390 px, alle vier Bereiche, Mitte und Ende der Animationen): Bei Short-Trades lag das Ziel
   ausserhalb der Chart-Skala (Skala nur fuer Long gedacht); Trade-Zonen liefen nach dem Ausstieg weiter; erste Zeitmarke
   abgeschnitten; Varianten-Kurven zu blass, Ausreisser stauchten den Faecher; Tagesleiste ohne Legende.
   -> Skala fuer beide Richtungen, Zonen enden kurz nach dem Ausstieg, Trennlinie zum Volumen, Kurven kraeftiger und Skala
   ohne Ausreisser (Beste immer im Bild), Legende.
2. Durchgang 2 (Handy-Chart, Ziel-Tag 29.10. per Klick): Tages-Chart auf dem Handy unlesbar klein; Beschriftungen von Range
   und Einstieg ueberlagerten sich; Zeitmarken links ueberlappten.
   -> eigene Handy-Geometrie (weniger Kerzen, groessere Schrift), Trade-Beschriftung rechts neben der Zone, Zeitmarken reduziert.
Gegenprobe: keine Skriptfehler; Tag-Klick spielt den Tag neu ab (29.10.: A, Volumen 1,6x, Ziel +1,89 R nach Gebuehren);
06.11.: A+, Volumen 3,0x, trotzdem Stop -1,11 R - die Gruende sind kein Versprechen, und das zeigt das Labor auch.
Ersetzt prototypes/plan-zeitmaschine (Demo-Daten).
