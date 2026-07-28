# Fahrschule Krebs — Website

Produktionsreife Website für die **Fahrschule Krebs GmbH**, Fulda und
Bad Hersfeld. Next.js, TypeScript, Tailwind CSS. 45 statisch vorgerenderte
Seiten, vollständig auf Deutsch.

## Schnellstart

```bash
npm install
npm run dev        # http://localhost:3000
```

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm run build` | Produktionsbuild (45 Seiten) |
| `npm start` | Produktionsserver |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm test` | Vitest — Preislogik (27 Fälle) |
| `npm run test:e2e` | Playwright — Browser (73 Fälle, Desktop und Mobil) |
| `npm run verify` | Typen, Lint, Unit-Tests und Build am Stück |

Die Playwright-Tests bauen und starten den **Produktionsbuild** selbst.

## Vor dem Livegang

Zwei Dinge sind zwingend:

1. **`docs/business-confirmations-needed.md` durcharbeiten.** Preise, Anzahl der
   Simulatoren, Adresse Bad Hersfeld, Impressumsangaben. Nichts davon ist
   erfunden — es ist bewusst nicht veröffentlicht.
2. **Zustellweg für das Kontaktformular setzen:**
   ```bash
   CONTACT_WEBHOOK_URL=https://…     # nimmt JSON per POST
   CONTACT_WEBHOOK_TOKEN=…           # optional
   ```
   Ohne diese Variable sagt das Formular offen, dass es nicht senden kann, und
   verweist auf Telefon und E-Mail. Es täuscht **keinen** Erfolg vor.

## Wie Inhalte gepflegt werden

Alle geschäftlichen Angaben liegen in `src/content/`. Keine Adresse, kein Preis
und keine Uhrzeit steht in einer Komponente.

Jede Angabe ist ein `Fact` mit Quelle, Prüfdatum und Vertrauensgrad:

```ts
street: fact('Am Bahnhof 3', 'Impressum', '2026-07-27', 'confirmed')
```

`publicValue()` gibt nur Werte mit `confirmed` oder `likely` heraus. Alles
andere erscheint **nicht** auf der Seite — auch nicht versehentlich. Dieselbe
Funktion speist die strukturierten Daten, damit die Auszeichnung dem Sichtbaren
nie widersprechen kann.

**Preise eintragen:** Werte in `src/content/prices.ts` setzen und `confidence`
auf `confirmed` ändern. Der Rechner füllt sich von selbst.

**Klasse ergänzen:** Eintrag in `src/content/classes.ts`. Seite, Navigation,
Footer, Sitemap, Übersicht und strukturierte Daten folgen automatisch.

**Cockpit live schalten:** in `src/content/digital-package.ts` den `status` von
`'vorschau'` auf `'verfuegbar'` setzen.

## Aufbau

```
src/
  app/            Routen, Metadaten, Sitemap, robots, Server Action
  components/
    brand/        Wortmarke, Embleme, Fahrbahn, Atmosphäre
    navigation/   Header, Footer
    storytelling/ Hero und Kapitel der Startseite
    classes/      Führerschein-Finder, Klassen-Spuren
    cockpit/      Schüler-Cockpit (Vorschau)
    simulator/    Simulator-Kapitel
    pricing/      Kostenrechner
    guide/        Ausbildungsablauf
    contact/      Kontaktformular
  content/        Sämtliche Geschäftsangaben, je mit Quelle
  lib/            Preislogik, Formatierung, strukturierte Daten
docs/             Recherche, Prüfberichte, offene Fragen, Screenshots
```

## Dokumentation

Einstieg: **`docs/release-report.md`**. Am wichtigsten für den Betrieb:
**`docs/business-confirmations-needed.md`**.

## Hinweise

- **Keine Bilddateien.** Die gesamte Bildsprache ist SVG und CSS.
  `docs/missing-assets.md` listet, welche Fotos die Website spürbar besser machen.
- **Kein Tracking, kein Cookie-Banner.** Schriften werden selbst ausgeliefert.
- `dashboard.html` im Wurzelverzeichnis ist das vorgefundene interne Werkzeug.
  Es gehört nicht zur Website und bleibt unverändert; seine Geschäftsregeln sind
  in die Ausbildungslogik eingeflossen.
