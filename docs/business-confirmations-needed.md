# Vom Inhaber zu bestätigen

Diese Liste ist der wichtigste Teil der Dokumentation. Jeder Punkt hier ist eine
Angabe, die auf der Website **bewusst nicht** oder nur eingeschränkt erscheint,
weil sie sich nicht belegen ließ.

Die Website ist so gebaut, dass jede dieser Angaben mit einer einzigen Änderung
in `src/content/` sichtbar wird: Wert eintragen, `confidence` auf `confirmed`
setzen, fertig. Es muss keine Komponente angefasst werden.

---

## 1. Preise — höchste Priorität

**Status: es wird kein einziger Preis veröffentlicht.**

Während des Projekts kursierte eine Preisliste (Grundbetrag 399 €, Fahrstunde
64 €, Sonderfahrt 76 €, Lehrmaterial 99 €, Vorstellung Theorie 60 €,
Vorstellung Praxis 180 €, B197-Testfahrt 50 €). Die Recherche hat ergeben,
dass diese Werte zu einer **anderen, nicht verbundenen Fahrschule Krebs GmbH**
in Freigericht/Gelnhausen (Main-Kinzig-Kreis) gehören, die unter
`fahrschule-krebs.com` firmiert und einen eigenen Creditreform-Eintrag hat.

Diese Zahlen wurden deshalb **nicht übernommen**. Sie zu veröffentlichen hätte
die Preise eines fremden Unternehmens auf diese Website gestellt.

Benötigt wird die aktuelle, eigene Preisliste für mindestens:
Grundbetrag · Lehrmaterial · Übungsfahrstunde · Sonderfahrt · Simulatoreinheit ·
Vorstellung Theorieprüfung · Vorstellung praktische Prüfung.

→ Einzutragen in `src/content/prices.ts`.

## 2. Simulator

Bestätigt ist, **dass** mit Fahrsimulator ausgebildet wird (eigene Videos auf
Facebook und YouTube, Marke offenbar VOGEL). Nicht belegt und deshalb nirgends
genannt:

- Wie viele Simulatoren gibt es?
- An welchem Standort stehen sie?
- Welche Klassen werden abgedeckt (nur B, oder auch BE/C/CE)?
- Wie viele Simulatoreinheiten gehören zur Ausbildung?

Die ursprüngliche Vorgabe „zwei High-Tech-Simulatoren für B, BE, C und CE" ließ
sich durch keine Quelle stützen und wird nicht behauptet.

## 3. Digitale Lernangebote

Für keines dieser Elemente wurde eine öffentliche Quelle gefunden:

- **Hörbuch zur Theorie** — kein Beleg.
- **E-Book gegen Prüfungsangst** — kein Beleg.
- **Über 80 Lernvideos aus Fulda** — belegt ist nur die dokumentarische Reihe
  „Malina macht den Führerschein" (2016/17, mit move36 produziert). Das ist
  keine Lernvideo-Bibliothek.
- **Intensivtheorie in neun Werktagen** — keine veröffentlichte Zusage gefunden.

→ `src/content/digital-package.ts`, Abschnitt `unconfirmedElements`.

## 4. Schüler-Cockpit

Öffentlich ist keine Schüler-App auffindbar. Die Website zeigt das Cockpit
deshalb ausdrücklich als **Vorschau** („In Entwicklung") mit Beispieldaten.

Zu klären: Gibt es das Cockpit bereits? Ab wann? Soll es als vorhandenes
Produkt oder weiterhin als Ausblick dargestellt werden?

→ `status` in `src/content/digital-package.ts` von `'vorschau'` auf
`'verfuegbar'` ändern, sobald es startet.

## 5. Adresse Bad Hersfeld — Widerspruch

| Quelle | Adresse |
| --- | --- |
| Eigene Website und eigene Facebook-Seite der Filiale | **Bahnhofstraße 18A** („in der alten Güterabfertigung") |
| Fünf und mehr Branchenverzeichnisse | Bahnhofstraße 20 |

Veröffentlicht wird **18A**, weil die Angabe des Unternehmens selbst Vorrang
hat. Beide Adressen liegen nebeneinander am Bahnhof — möglicherweise ein nicht
nachgeführter Umzug. **Bitte prüfen.**

## 6. Bürozeiten Bad Hersfeld — Widerspruch

„Di–Do 16:15–17:00 Uhr" gegen „Di–Do 15:00–18:00 Uhr". Einig sind sich die
Quellen nur darin, dass dienstags bis donnerstags nachmittags geöffnet ist.
Auf der Standortseite steht deshalb derzeit ein Hinweis, kurz anzurufen.

## 7. Theoriezeiten Fulda — Widerspruch

Von derselben Seite kamen drei unterschiedliche Fassungen zurück
(15:00/16:30/18:00 · 16:00/17:30 plus Fr 14:30 · nur „drei Themen Mo–Do").
Veröffentlicht wird deshalb nur die **Struktur** (Mo–Do drei Themen pro Tag,
LKW Mo+Do 16:30–19:30, Motorrad Mi zweiwöchentlich 16:30–19:30), nicht die
Uhrzeiten des Grundstoffs.

## 8. Impressum — rechtlich zwingend

Vor dem Livegang zu prüfen:

- **USt-IdNr. DE257818771** — nur über einen Suchindex extrahiert.
- **Aufsichtsbehörde Regierungspräsidium Kassel** — Einzelquelle.
- Vollständige Vertretungsregelung.
- Prokura Günter Krebs (nur Creditreform) — falls im Impressum gewünscht.

## 9. Weitere offene Punkte

| Angabe | Status |
| --- | --- |
| Bürozeiten Fulda (Mo–Do 9–18, Fr 9–17) | Eigene Website gegen Verzeichnisse (Sa geöffnet?) — plausibel, aber bestätigen |
| Zahl der Fahrlehrer (18 gegen „ca. 20") | Website nennt „rund 20" |
| Bewertungen (ProvenExpert 4,4 / 82) | Wird **nicht angezeigt** — Spiegelquelle unbekannten Datums |
| „Eine der größten Fahrschulen Deutschlands" | Selbstaussage — wird **nicht** als Tatsache veröffentlicht |
| Erste-Hilfe-Kurse | Unklar, ob eigene Durchführung oder DRK als Raumnutzer — Formulierung vermeidet die Behauptung |
| FES (Fahreignungsseminar) | Nur Verzeichnisse, keine eigene Seite — bestätigen, wer der Seminarleiter ist |
| MPU-Vorbereitung, Fahrsicherheitstraining, Sehtest vor Ort | Nur Aggregatoren — **nicht aufgenommen** |
| Klassen D1, D1E, L, T | Real im Katalog, aber **noch nicht angelegt** — siehe Release-Report |
| Übungsplatz „Werk 2" (Bellingerstr. 6, ca. 2.000 m²) | Adresse nur aus einem Verzeichnis |
| Fax Fulda 0661 90190906 | Nur Verzeichnisse — **nicht veröffentlicht** |
| Fotos von Team, Fahrzeugen, Standorten, Simulator | **Fehlen vollständig** — siehe `missing-assets.md` |
