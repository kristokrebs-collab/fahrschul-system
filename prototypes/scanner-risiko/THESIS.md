# Scanner + Risiko-Rechner im Frost-Stil - These (vor dem Prototyp)

Nutzer: "Das erste fand ich am besten" (trading-journal-frost) -> exakt dessen Sprache: Frost ueber Farbszene, Riesenwort,
Umriss-Ziffern, Mint = "der Beste / erfuellt", Scramble, Zaehler, Faecher, Haptik. Plus seine Regel: "alles muss echt klappen".

These: Erst finden, dann bemessen. Der Scanner sucht live in 12 Coins das eine Setup mit Gruenden (Ausbruch, Volumen, Trend);
der Rechner sagt, wie gross die Position sein darf, damit der Stop genau das geplante Risiko kostet - Gebuehren eingerechnet.

Signatur (eins): "Eine bleibt" als Scanner - ein Radar laeuft, jede Coin-Karte loest sich aus dem Unscharfen (Ticker-Scramble
wie das orvia-Buchstabenraster), die Gruende springen einzeln an, dann sortieren sich alle Karten per Feder nach Note (FLIP)
und die beste kristallisiert: die anderen treten zurueck, sie hebt sich mint leuchtend ab.

Rechner: Preisleiter (Ziel / Einstieg / Stop) federt bei jeder Eingabe, Positionsgroesse rollt hoch, Hebel-Balken federt,
Warnung erscheint ehrlich (Risiko ueber 2 %, Hebel ueber 5x). Belohnt (ruhig, mint) wird nur "im Rahmen deiner Regeln" -
nie ein Gewinn. Kein Order-Knopf.

Daten: data-api.binance.vision (Quelle des Journals), 5-Min-Kerzen, ATR 14, EMA 50, Volumen-Schnitt 20, Sitzung New York /
London, Range 30 Min. Bewegung: ease-out rein, ease-in raus, Feder mit leichtem Overshoot, nichts linear, Reduced Motion =
Endzustand. Ohne Verbindung: ehrlicher Fehler, keine Ersatzdaten.

## Pruefrunden (gesehen, Live-Daten 08.11., 12 Coins)
1. Durchgang 1 (Desktop + 390 px: Scan-Mitte, Endzustand, Rechner bei 1 % und 3 %): Gebuehren frassen bei engem Stop einen
   grossen Teil des Risikos (LTC: 2 R brachten nur +75 USDT bei -100) - ohne Erklaerung; Werte brachen auf dem Handy um; das
   Radar lag auf dem Handy ueber dem Text.
   -> Zeile "davon Gebuehren" + ehrlicher Hinweis ab 25 % Gebuehrenanteil, Hinweis wenn der Kurs schon nah am Stop steht,
   Werte ohne Umbruch, Radar auf dem Handy leiser und weiter weg.
2. Durchgang 2 (Karte mit Note B antippen, Stop auf 1,5 ATR, Handy-Ausgabe): Gebuehren-Zeile zu lang fuer das Handy
   -> kurz "39 USDT · 39 %". Reduced Motion: alle 12 Karten sofort sichtbar, Bestes markiert, Rechnung steht.
Live gesehen: LTC A+ (Volumen 4,0x) und BNB A+ (3,2x) vorne; TON ohne Kerzen fuer die Sitzung -> ehrlich "Keine Kerzen".
