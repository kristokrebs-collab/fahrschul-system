# Fachliche Bestätigungen – offene Punkte

Diese Liste enthält fachliche Annahmen, die im Prototyp implizit getroffen
wurden und für den Produktivbetrieb von der Fahrschule Krebs (Fachexperten/
Geschäftsführung) **bestätigt oder korrigiert** werden müssen. Ohne
Bestätigung werden in Prompt 1–4 konservative Platzhalter-Regeln verwendet
und explizit als „unbestätigt" markiert.

## Ausbildung & Klassen

1. Welche Klassen werden an welchem Standort (Fulda / Bad Hersfeld) aktuell
   tatsächlich angeboten? (Prototyp listet B, BE, A, A1, A2, AM, C, CE, D
   pauschal für alle Fahrlehrer über `klassen[]`.)
2. Exakte Pflichtstundenzahlen für Sonderfahrten (Autobahn/Landstraße/Nacht)
   je Klasse – Prototyp nutzt einen einzelnen `praxisP()`-Fortschrittswert
   ohne Klassendifferenzierung.
3. Wie werden Vorbesitz/Erweiterung (z. B. B→BE, A2→A) angerechnet? Aktuell
   nicht im Prototyp abgebildet.
4. B197-Sonderregeln (nur Automatik, Nachweis-Anforderungen) – im Prototyp
   nur als Namensfeld `extra` bei Fahrlehrern vermerkt, keine Ausbildungslogik.

## Prüfungsreife / Tacho

5. Ist die im Prototyp verwendete Gewichtung (Theorie 30 %, Fahrpraxis 25 %,
   Sonderfahrten 25 %, Nachweise 10 %, Finanzen 10 %) fachlich korrekt, oder
   gibt es eine offizielle/interne Formel? Diese Gewichtung ist eine
   Annahme aus der Prototyp-Entwicklung, keine bestätigte fachliche Regel.
6. Darf der Zahlungsstatus (10 % Gewicht) wirklich die angezeigte
   „Prüfungsreife" beeinflussen, oder vermischt das fachliche mit
   kaufmännischer Bewertung? Empfehlung: in Produktion trennen
   (Ausbildungsreife separat von Vertragsstatus zeigen).

## Matching & Termine

7. Genaue Pausen-/Wegezeit-Regeln je Fahrlehrer und Standort (Prototyp hat
   keine Wegezeit-Berechnung zwischen Standorten).
8. Wie „fair" muss die Verteilung von Krebs-Flex-Angeboten unter Schülern
   sein – nach Wartezeit, nach Vertragsdatum, nach Zufallsprinzip?
9. Reihenfolge-Zwang der Ausbildungsschritte: Muss Theorie vor erster
   Übungsfahrt bestätigt sein? Muss eine Mindestzahl Übungsfahrten vor der
   ersten Sonderfahrt liegen? Prototyp erzwingt keine Reihenfolge.

## Freigaben

10. Wer genau darf eine Prüfungsfreigabe erteilen – nur der zuletzt
    fahrende Fahrlehrer, oder jeder für die Klasse berechtigte Fahrlehrer?
11. Muss eine Fahrlehrer-Freigabe durch eine zweite Person (Vier-Augen-Prinzip)
    bestätigt werden, bevor eine Prüfung angemeldet wird?

## Zahlungen

12. Zahlungsziele/Mahnstufen – im Prototyp nicht vorhanden, nur „offen"/„bezahlt".
13. Wie werden Sammelrechnungen für Firmenkunden gehandhabt?
14. Storno-/Ausfallgebühren-Regeln bei kurzfristiger Absage durch Schüler.

## Status

Alle Punkte sind **offen**. Prompt 1–4 implementieren Platzhalter mit
klar sichtbarer „unbestätigt"-Kennzeichnung im Code (Kommentar +
Konfigurationskonstante), sodass sie vor GO-Live von der Fahrschule
fachlich abgenommen werden können. Keine dieser Annahmen darf stillschweigend
als endgültige Fachregel in den Release-Bericht (Prompt 5) einfließen.
