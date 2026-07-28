# Visuelle Qualitätssicherung

Geprüft am Produktionsbuild in Chromium. Screenshots in `docs/screenshots/`,
erzeugt mit `scripts/shot.mjs`.

## Breiten

| Breite | Geprüft | Ergebnis |
| --- | --- | --- |
| 390 px | Startseite, Cockpit | Hero vollständig über der Falz, Schaltflächen volle Breite |
| 412 px | Alle Interaktionen (Playwright „mobile") | Menü, Finder, Rechner, Formular bedienbar |
| 430 px | Rechner | Tabelle scrollt in sich, Seite nicht |
| 768 px | Klassenübersicht | Spuren zweispaltig |
| 1024 px | Standortseite | Zweispaltiges Layout greift |
| 1440 px | Alle Kapitel | Referenzbreite |
| 1920 px | Startseite | Inhalt bei 84 rem zentriert, Fahrbahn füllt |

## Belege

`desktop-hero` · `desktop-klassen` · `desktop-cockpit` · `desktop-simulator` ·
`desktop-rechner` · `desktop-leistungen` · `desktop-standort` ·
`mobile-hero` · `mobile-cockpit` · `mobile-rechner` · `tablet-klassen` · `wide-hero`

## Durchgang 1 — Struktur und Klarheit

| Befund | Behebung |
| --- | --- |
| Hero nannte „18 Führerscheinklassen", der Katalog hat 17 | Zahl wird aus `licenceClasses.length` berechnet |
| Fahrbahn zu schwach, las sich nicht als Straße | Deckkraft der Markierungen erhöht, Fahrbahnfläche und Randlinien ergänzt |
| Harte Kante im Rotverlauf hinter der Überschrift | Separater Glühbereich entfernt, Dunst in das SVG verlegt und enger gefasst |
| Klasse B versprach „Videos aus Fulda" | Formulierung entfernt — nicht belegt |

## Durchgang 2 — Optik und Bewegung

| Befund | Behebung |
| --- | --- |
| Inaktive Cockpit-Passagen bei 45 % kaum lesbar | Untergrenze 60 %, Kontrast geprüft |
| Bei reduzierter Bewegung blieben hohe Leerräume | Abstände kollabieren in diesem Modus |
| Gerätrahmen zu dominant | Auf Aluminium-Andeutung reduziert, Innenfläche bekommt das Gewicht |

## Durchgang 3 — Produktionsreife

| Befund | Schwere | Behebung |
| --- | --- | --- |
| **Mobiles Menü hinter dem Inhalt, kein Link anklickbar** | kritisch | Panel aus dem Header gelöst — `backdrop-filter` machte den Header zum Bezugsrahmen für `position: fixed` |
| Waagerechter Seitenüberlauf 73 px bei 412 px | mittel | Ursache waren `sr-only`-Beschriftungen in der Tabelle ohne Positionierungskontext; Wrapper auf `relative` |
| Korn-Ebene ragte über den Viewport hinaus | gering | `inset: -50%` auf `inset: 0` |
| CSP verbot `eval` im Entwicklungsmodus | gering | `'unsafe-eval'` nur im Dev-Build |
| 404 für das Favicon | gering | `app/icon.svg` ergänzt |
| ESLint brach mit Zirkelbezug ab | gering | Native Flat-Configs statt `FlatCompat` |
| `setState` im Effekt bei Routenwechsel | gering | Zustandsanpassung während des Renderings |

## Falscher Alarm — dokumentiert, damit er nicht wiederkehrt

Zwischenzeitlich schien die Produktionsseite völlig ungestylt zu laden (CSS als
`text/plain`, Schriftart Times New Roman) und die Hydration auszufallen.
Ursache war **kein** Anwendungsfehler: Ein alter `next start`-Prozess hielt den
Port und lieferte ein `.next`-Verzeichnis aus, das inzwischen neu gebaut worden
war. Nach sauberem Neustart trat der Effekt nicht mehr auf.

Konsequenz für die Tests: Der Filter, der `net::ERR_ABORTED` ignorierte, wurde
so eingeengt, dass er nur noch für Navigationsanfragen gilt. Ein abgebrochenes
Stylesheet oder Skript ist jetzt ein Testfehler — genau so etwas darf nicht
durch eine grüne Testsuite rutschen.

## Restpunkte

- Das Simulator-Kapitel trägt kein echtes Foto (siehe `missing-assets.md`).
- `/team` zeigt bewusst keine Porträts, solange keine echten vorliegen.
- Die Startseite ist auf dem Telefon rund 28.000 px hoch. Das ist für elf
  Kapitel vertretbar, weil das Cockpit dort sechs vollwertige Karten zeigt statt
  einer synchronisierten Sequenz — ließe sich später zu einem Wischkarussell
  verdichten.
