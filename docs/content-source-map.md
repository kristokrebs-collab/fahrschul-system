# Inhalt-Quellen-Zuordnung

## Prinzip

Kein Preis, keine Adresse, keine Uhrzeit und keine Rechtsangabe steht in einer
Komponente. Alles liegt in `src/content/` und wird über `publicValue()`
gelesen. Steht eine Angabe an zwei Stellen auf der Seite, kommt sie trotzdem
aus einem Feld.

## Das Wahrheits-Primitiv

`src/content/truth.ts` definiert:

```ts
Fact<T> = { value, source, reviewed, confidence, note? }
confidence = 'confirmed' | 'likely' | 'unverified' | 'conflicting'
publicValue(fact) → T | undefined   // undefined außer bei confirmed/likely
```

Komponenten behandeln `undefined` als „nicht anzeigen". Ein unbelegter Wert
kann damit nicht versehentlich auf die Seite gelangen — auch nicht durch eine
spätere Änderung, die den Kommentar übersieht.

Dieselbe Funktion speist die strukturierten Daten (`lib/structured-data.ts`).
Was einem Menschen nicht gezeigt wird, bekommt auch Google nicht.

## Zuordnung

| Datei | Inhalt | Genutzt von |
| --- | --- | --- |
| `content/business.ts` | Firma, Historie, Standorte, Kontakt, Bürozeiten, Theoriezeiten, Team, Fuhrpark, Übungsplatz | Header, Footer, Hero, Standortseiten, Team, Kontakt, Impressum, Datenschutz, JSON-LD |
| `content/classes.ts` | 17 Klassen: Mindestalter, Theorie, Sonderfahrten, Voraussetzungen, SEO | Klassenseiten, Klassen-Spuren, Finder, Navigation, Sitemap, Course-JSON-LD |
| `content/services.ts` | 9 Leistungen inklusive der fünf BKF-Module | Leistungsseiten, Kapitel 9, Navigation, Sitemap |
| `content/digital-package.ts` | Digitale Elemente mit Verfügbarkeitsstatus | Kapitel 4, `/digitalpaket` |
| `content/prices.ts` | Positionen, Mengenannahmen, externe Kosten | Rechner, `/preise` |
| `content/guide.ts` | 12 Stationen des Ausbildungswegs, vier Kostentöpfe | Kapitel 8, `/ausbildungsablauf`, `/preise` |
| `content/cockpit-demo.ts` | Beispieldaten des Cockpits | Kapitel 5, `/schueler-cockpit` |
| `content/navigation.ts` | Menüs, aus Klassen und Leistungen **abgeleitet** | Header, Footer |
| `content/truth.ts` | Das Primitiv | alles |

`navigation.ts` erzeugt seine Einträge aus `classes.ts` und `services.ts`.
Eine neue Klasse erscheint dadurch automatisch im Menü, im Footer, in der
Sitemap und in der Übersicht — ohne dass eine Liste nachgepflegt wird.

## Rechtsangaben

Alle Rechtsangaben tragen `source` (FeV / FahrschAusbO / StVG mit Abgleich zu
TÜV, DEKRA, Fahrlehrerverband) und `reviewed: '2026-07-27'`. Sichtbar auf der
Seite als Stand-Hinweis unter dem Ausbildungsweg und auf jeder Klassenseite.

Bei einer Rechtsänderung: Wert in `classes.ts` oder `guide.ts` ändern,
`reviewed` hochsetzen. Die Seiten ziehen nach.
