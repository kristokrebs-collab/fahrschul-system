# Fehlende Assets

Die Website funktioniert vollständig ohne Fotos — sie ist bewusst so gebaut,
dass nichts kaputtgeht oder leer wirkt, solange keine vorliegen. Mit echtem
Bildmaterial wird sie aber deutlich besser. Nach Wirkung sortiert:

## 1. Menschen (größter Hebel)

Technik ist ein Unterscheidungsmerkmal, Vertrauen entsteht durch Personen.
Derzeit gibt es auf `/team` bewusst **keine erfundenen Profile** und keine
Stockfotos.

Gebraucht: Porträts der Fahrlehrerinnen und Fahrlehrer sowie des Büroteams,
jeweils mit Vorname, Klassen, Standort und ein bis zwei echten Sätzen dazu, wie
sie unterrichten. Querformat und Hochformat.

## 2. Simulator

Das gesamte Simulator-Kapitel argumentiert derzeit rein über Nutzen, illustriert
mit einer schematischen Fahrerperspektive. Ein einziges echtes Foto des
Simulatorplatzes würde das Kapitel tragen.

Gebraucht: Simulatorplatz gesamt, Blick auf den Bildschirm, jemand am Gerät.

## 3. Fahrzeuge

Belegt ist ein eigener Fuhrpark mit eigenen LKW und einem eigenen Bus — das ist
ein starkes Argument, das gerade kein Bild hat.

Gebraucht: PKW-Flotte, LKW, Sattelzug, Bus, Motorräder, Anhänger; gern in
Bewegung statt auf dem Hof.

## 4. Standorte

Gebraucht: Außenansicht Fulda (Am Bahnhof 3), Außenansicht Bad Hersfeld (alte
Güterabfertigung), Unterrichtsraum, Büro, Übungsplatz „Werk 2".

## 5. Ausbildungsmomente

Gebraucht: Theorieunterricht, eine Fahrstunde von außen, eine Rangierübung auf
dem Platz, eine bestandene Prüfung.

## 6. Marke

Gebraucht: das **echte** Logo als SVG. Die aktuelle Wortmarke ist eine
typografische Interpretation, kein Nachbau des Originals. Ebenso die exakten
Markenfarben (HEX oder RAL) — das verwendete Rot ist aus dem Signal- und
Bremslicht-Kontext hergeleitet, nicht aus einer Markenvorgabe.

## Einbau

Der Platz ist vorbereitet: `public/` ist nach Kategorien angelegt, und alle
Komponenten rendern Bildbereiche erst, wenn Material vorhanden ist. Für Fotos
sollte `next/image` mit `sizes` und AVIF/WebP verwendet werden; das Format ist
in `next.config.ts` bereits gesetzt.
