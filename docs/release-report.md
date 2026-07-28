# Release-Report

**Projekt:** Website der Fahrschule Krebs GmbH, Fulda und Bad Hersfeld
**Stand:** 28. Juli 2026
**Branch:** `claude/fahrschule-krebs-website-hge31m`

---

## Kurzfassung

Aus einem Repository mit einer einzigen HTML-Datei ist eine vollständige,
produktionsreife deutsche Website geworden: 45 statisch vorgerenderte Seiten,
100 automatisierte Tests, keine Konsolenfehler, LCP 1,3 Sekunden unter
vierfacher CPU-Drosselung.

Die wichtigste Entscheidung des Projekts ist eine **Weglassung**: Es wird kein
einziger Preis veröffentlicht. Die im Auftrag genannte Preisliste gehört
nachweislich zu einem anderen Unternehmen gleichen Namens.

---

## Was gebaut wurde

**Startseite** in elf Kapiteln als durchgehende Route — Hero, Führerschein-
Finder, Klassen-Spursystem, Ausbildungssystem, Schüler-Cockpit, Simulator,
Kostenrechner, Ausbildungsweg, Beruf und Spezial, Menschen und Orte, Abschluss.

**17 Klassenseiten** mit geprüften Rechtswerten · **9 Leistungsseiten** ·
**2 Standortseiten** · Digitalpaket, Cockpit, Simulator, Preise,
Ausbildungsablauf, Team, Kontakt, Impressum, Datenschutz, 404, Sitemap, robots.

**Drei echte Werkzeuge**, keine Attrappen:

- *Führerschein-Finder* — sechs Fragen, gewichtete Empfehlung mit Begründungen
  und Hinweisen auf noch nicht erfüllte Voraussetzungen.
- *Kostenrechner* — vergleicht zwei Angebote Position für Position bei
  identischen Mengen; alles in ganzen Cent, 27 Unit-Tests.
- *Kontaktformular* — Server Action, Zod-Validierung, Honeypot,
  Ratenbegrenzung; meldet ehrlich, wenn kein Zustellweg konfiguriert ist.

**Schüler-Cockpit** als sechsteilige, scroll-synchrone Produktvorschau in echtem
HTML — auf dem Desktop ein `sticky` Gerät neben der Erzählung, auf dem Telefon
Karten in voller Breite. Kein Screenshot, kein Scroll-Hijacking.

---

## Was wiederverwendet wurde

Aus `dashboard.html`, dem einzigen vorgefundenen Artefakt, stammen die
**Geschäftsregeln**: Theoriereduktion bei Vorbesitz, Simulatoreinheiten vor
Echtfahrten, Sonderfahrten erst nach der Grundausbildung, Sperren durch offene
Rechnungen und fehlende Unterlagen — und vor allem das Verständnis von
„PrüfungsReady" als **Liste erfüllter Bedingungen statt Prognose**. Genau so
zeigt es das Cockpit; einen Prozentwert für die Bestehenswahrscheinlichkeit gibt
es bewusst nicht. Die Datei selbst blieb unverändert.

## Was neu entworfen wurde

Alles Sichtbare. Die Richtung „Die Krebs-Route" macht Straßeninfrastruktur zur
Oberflächensprache — Fahrbahn, Markierungen, Spuren, Meilensteine, ein einzelnes
Signalrot mit wechselnder Funktion. Umgesetzt vollständig code-nativ, weil das
Bildmaterial-CDN blockiert war; im Ergebnis ist die Seite dadurch schneller und
auf jeder Auflösung scharf. Begründung in `docs/final-creative-direction.md`.

---

## Geprüfte Geschäftsangaben

Bestätigt und veröffentlicht: Firma, HRB 5374 Amtsgericht Fulda, Geschäftsführer
Michael Krebs, **Gründung 1964** durch Günter Krebs, zweite Generation seit
**1999**, Filiale Bad Hersfeld seit **2009**, Adresse und Telefon Fulda,
gemeinsame E-Mail, Struktur des Theorieunterrichts an beiden Standorten,
17 Fahrerlaubnisklassen, Berufskraftfahrer-Ausbildung mit beschleunigter
Grundqualifikation (140 Stunden, IHK-Prüfung), **die fünf konkreten
BKF-Module**, ADR mit Aufbaukurs Tank, Staplerschein, Handicap-Ausbildung, ASF,
Ferienfahrschule, Ladungssicherung, eigener Fuhrpark, Übungsplatz „Werk 2" —
und dass mit **Fahrsimulator** ausgebildet wird.

Rechtsangaben gegen FeV, FahrschAusbO und StVG geprüft. Dabei wurden zwei
Fehler in den Ausgangsannahmen korrigiert: Das Mindestalter der Klasse AM ist
**15** (bundesweit seit 2021), und die Altersabsenkung bei C und CE hängt an der
**vollständigen** Grundqualifikation — die beschleunigte senkt dort nichts.

## Was zurückgehalten wird

| Angabe | Grund |
| --- | --- |
| **Alle Preise** | Die kursierende Liste gehört zur Fahrschule Krebs GmbH in **Freigericht/Gelnhausen** — einem anderen Unternehmen mit eigenem Handelsregistereintrag |
| Anzahl der Simulatoren | Belegt ist die Ausbildung am Simulator, nicht deren Anzahl oder die Klassen |
| Hörbuch, E-Book, „über 80 Lernvideos" | Kein öffentlicher Beleg |
| Intensivtheorie in neun Werktagen | Keine veröffentlichte Zusage |
| Sternebewertungen | Nur eine Spiegelquelle unbekannten Datums |
| „Eine der größten Fahrschulen Deutschlands" | Selbstaussage ohne unabhängigen Beleg |
| Bürozeiten Bad Hersfeld, Theoriezeiten Fulda | Quellen widersprechen sich |
| Fax, MPU, Fahrsicherheitstraining, Sehtest vor Ort | Nur Aggregatoren |

Alles davon ist eine Zeile Konfiguration vom Erscheinen entfernt, sobald es
bestätigt ist. Vollständig in `docs/business-confirmations-needed.md`.

---

## Assets

**Es wurde kein Higgsfield-Asset erzeugt.** Das Archiv enthält 16 Bilder, deren
Download die Egress-Policy des Containers blockiert (HTTP 403); ihr Inhalt ist
daher unbekannt. Neue Generierung hätte eine ausdrückliche Freigabe erfordert
und war inhaltlich nicht nötig — eine erzeugte Person oder ein erzeugtes
Fahrzeug hätte auf der Seite einer realen Fahrschule ohnehin nicht als echt
dargestellt werden dürfen.

Stattdessen: null Bilddateien, die gesamte Bildsprache in SVG und CSS.
`docs/missing-assets.md` listet nach Wirkung, welche echten Fotos fehlen.

---

## Tests

| Prüfung | Ergebnis |
| --- | --- |
| Produktionsbuild | ✅ 45 Seiten |
| TypeScript (`strict`, `noUncheckedIndexedAccess`) | ✅ fehlerfrei |
| ESLint | ✅ fehlerfrei |
| Vitest — Preislogik | ✅ 27 / 27 |
| Playwright — Desktop und Mobil | ✅ 73 / 73 |
| Konsolenfehler auf 18 Seiten | ✅ keine |
| Waagerechter Überlauf bei 412 px | ✅ keiner |
| Reduzierte Bewegung | ✅ Inhalte vollständig |

Abgedeckt: alle Seiten, 404, Sitemap, robots, Rechnerarithmetik in der
Oberfläche, deutsche Dezimaleingabe, Mengenänderung, einseitige Preise,
Finder-Empfehlungen, serverseitige Formularvalidierung, kein vorgetäuschter
Sendeerfolg, Sprunglink, Tastaturnavigation, Pfeiltasten in der Tablist,
Landmarken, mobiles Menü, Cockpit ohne Gerätrahmen auf dem Telefon.

**Drei echte Fehler haben die Tests gefunden:**

1. **Das mobile Menü war unbenutzbar.** Der `backdrop-filter` des Headers machte
   diesen zum Bezugsrahmen für `position: fixed`, wodurch das Panel hinter dem
   Seiteninhalt landete. Auf dem Telefon ließ sich über das Menü keine Seite
   öffnen. Behoben, indem das Panel aus dem Header gelöst wurde.
2. **Fließkomma-Rundung im Preisrechner.** `Math.round(1.005 * 100)` ergibt 100
   statt 101. Der Nachkommateil wird jetzt als Zeichenkette gerundet.
3. **„2.000" wurde als zwei Euro gelesen.** Im Deutschen ist der Punkt der
   Tausendertrenner. Regel ergänzt und getestet.

Dazu ein **falscher Alarm**, der in `docs/visual-qa.md` dokumentiert ist, damit
er nicht wiederkehrt: Ein alter Serverprozess lieferte ein zwischenzeitlich neu
gebautes `.next`-Verzeichnis aus, was wie ein totaler CSS-Ausfall aussah. Kein
Anwendungsfehler — aber der Anlass, den Testfilter für abgebrochene Anfragen so
einzuengen, dass ein fehlendes Stylesheet künftig einen Test rot färbt.

---

## Bekannte Grenzen

- **Keine Fotos.** Die stärkste verbleibende Verbesserung.
- **Kein Screenreader-Test** mit NVDA, JAWS oder VoiceOver; kein axe-Lauf
  (Bibliothek in dieser Umgebung nicht installierbar).
- **Kein Lighthouse-Lauf** — gemessen wurde über die Performance-API im
  gedrosselten Browser. Auf der echten Hosting-Umgebung nachholen.
- **Klassen D1, D1E, L und T** sind real im Angebot, aber noch nicht angelegt.
  Jeweils ein Eintrag in `classes.ts`; Seite, Navigation und Sitemap folgen.
- **Ratenbegrenzung im Prozessspeicher** — bei mehreren Instanzen ersetzen.
- **CSP nutzt `'unsafe-inline'`** für Skripte; eine Nonce über Middleware wäre
  der nächste Schritt.
- Die Startseite ist auf dem Telefon sehr lang, weil das Cockpit dort sechs
  vollwertige Karten zeigt statt einer synchronisierten Sequenz.

---

## Betrieb

```bash
npm install
npm run verify        # Typen, Lint, Tests, Build
npm run build && npm start
```

Node ≥ 20.9. Läuft auf jeder Node-Plattform; wegen der 45 statischen Seiten
auch auf jedem CDN mit Node-Funktion für die Server Action.

Erforderlich für das Kontaktformular:

```bash
CONTACT_WEBHOOK_URL=https://…
CONTACT_WEBHOOK_TOKEN=…          # optional
```

Empfohlen auf Hosting-Ebene: `Strict-Transport-Security`, Kompression,
langlebiges Caching für `/_next/static`.

---

## Screenshots

In `docs/screenshots/`: `desktop-hero` · `desktop-klassen` · `desktop-cockpit` ·
`desktop-simulator` · `desktop-rechner` · `desktop-leistungen` ·
`desktop-standort` · `mobile-hero` · `mobile-cockpit` · `mobile-rechner` ·
`tablet-klassen` · `wide-hero`.

## Unterlagen

`business-confirmations-needed.md` (zuerst lesen) · `business-truth.md` ·
`truth-conflicts.md` · `source-inventory.md` · `asset-inventory.md` ·
`missing-assets.md` · `current-technical-baseline.md` ·
`reference-research.md` · `final-creative-direction.md` ·
`information-architecture.md` · `motion-map.md` · `app-showcase-spec.md` ·
`price-calculator-spec.md` · `content-source-map.md` ·
`reusable-components.md` · `accessibility-report.md` ·
`performance-report.md` · `security-review.md` · `visual-qa.md`
