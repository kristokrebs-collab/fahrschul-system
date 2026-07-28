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

---

# Durchgang 4 — Ausbau mit echten Assets (28.07.)

## Was sich geändert hat

- **Echte Wortmarke** in Header und Footer (KREBS ‖ Fahrschule /
  Verkehrsbildungszentrum), als Typografie nachgebaut.
- **Cockpit-Kapitel komplett neu**: scroll-gesteuerte Produktpräsentation auf
  Basis der echten App-Screenshots. Das Gerät kippt beim Eintritt in die
  Ruhelage, der App-Inhalt scrollt synchron zur Erzählung zu Ebene A →
  Fahrstil → Protokoll, Zähler und der Prüfungsreife-Ring füllen sich in
  ihren Szenenfenstern, die Meilensteinleiste wandert mit, am Ende zeichnet
  sich die Routenlinie aus dem Gerät zur nächsten Station. Kein Scroll-Hijacking:
  gepinnt wird per `position: sticky`, das Rad wird nie abgefangen.
- **Studio-Fahrzeuge** (Audi/Actros/Citaro/Suzuki auf rotem Leuchtring) als
  Kategorie-Bühnen im Klassen-Kapitel, beschriftet als „Studio-Darstellung".
- **Echtes K-TEAM-Foto** in Kapitel 10 und auf /team.
- **Kapitel-Atmosphäre**: eine feste Lichtebene wandert mit der Geschichte
  (registrierte CSS-Properties, 1,2-s-Übergänge, kein Animationsloop).
- **Simulator-Schema** jetzt als Dreischirm-Trainingsplatz mit Sitz und
  Konsole — angelehnt an die reale Bauform aus der Referenz des Inhabers.

## Gefunden und behoben in diesem Durchgang

| Befund | Schwere | Behebung |
| --- | --- | --- |
| `test.use({ reducedMotion })` kam im Test-Setup nie im Browser an — die Reduced-Motion-Tests testeten in Wahrheit die volle Animation | hoch (Testlücke) | Umstellung auf `page.emulateMedia()`, empirisch verifiziert |
| Zähler/Ring füllten sich außerhalb ihrer Erzählszene | mittel | Fenster an die Szenensegmente ausgerichtet |
| Krebs-Silhouette aus dem Logo ließ sich nicht sauber freistellen (Text überlappt) | gering | Zuschnitt auf Scheren-und-Panzer-Region oberhalb der Textzeile |

## Belege

`docs/screenshots/desktop-cockpit-v2.png`, `mobile-cockpit-v2.png` sowie zwei
Bildschirmaufnahmen (Hero-Einstieg, Cockpit-Sequenz) — an den Auftraggeber
übergeben.

## Benchmark-Selbsttest (gegen die stärksten recherchierten Referenzen)

- *Erster Bildschirm ebenso beeindruckend?* Ja — Perspektiv-Fahrbahn plus
  echte Marke; kein Template-Muster erkennbar.
- *Cockpit-Sequenz einzigartig?* Ja — sie zeigt die **echte** App des
  Betriebs, nicht ein generisches Mockup; die Inhalte (A7/A66,
  Prüfungsstrecken-Training Fulda, Bewertung des Fahrlehrers) kann keine
  andere Fahrschule übernehmen.
- *Logo-Tausch-Test:* Klassen-Bühnen, Cockpit, Team-Kapitel und Wortmarke
  bestehen ihn jetzt erst recht — die Inhalte gehören nachweislich Krebs.
- *Schwächste Stellen jetzt:* /team ohne Einzelporträts (Material fehlt),
  Simulator weiter ohne echtes Foto des eigenen Geräts.
