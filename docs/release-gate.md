# Release-Gate — Premium-Relaunch

Unabhängige Abnahme, durchgeführt gegen den **Production-Build** (`next build`
+ `next start`), nicht gegen den Dev-Server. Jede Zahl unten ist gemessen, nicht
geschätzt; die Messskripte laufen über echtes Chromium.

## Automatisierte Tests

| Prüfung | Ergebnis |
|---|---|
| `tsc --noEmit` | fehlerfrei |
| `eslint .` | fehlerfrei |
| `vitest run` | 27 / 27 bestanden |
| `playwright test` | 73 bestanden, 7 projektbedingt übersprungen |

Die Playwright-Suite läuft in zwei Projekten (Desktop 1440, Mobile 390) und
prüft unter anderem: genau ein `h1` je Seite, Titel vorhanden, **keine
Konsolenfehler**, kein horizontaler Overflow, Tastaturbedienung des
Führerschein-Finders, Mobile-Menü, und das Cockpit in der gestapelten Variante.

## Kontrast in den Tageslicht-Kapiteln

Die **fünf** hellen Kapitel (Kosten, Weg, Beruf, Orte, Ankommen) kehren die
komplette Farbskala um. Gemessen in jedem einzelnen: Überschriften durchgehend
**16,1 : 1**, Fließtext durchgehend **6,92 : 1**. Gemessen wurde die
tatsächlich berechnete Textfarbe gegen den hellen Grund `#f6f3ec`:

| Element | Farbe | Verhältnis | WCAG |
|---|---|---|---|
| Kapitelüberschrift | `#14181c` | **16,1 : 1** | AAA |
| Fließtext / Label | `#4d545c` | **6,92 : 1** | AA, groß auch AAA |
| Sekundärtext | `#4d545c` | **6,92 : 1** | AA |
| Link in Signalrot | `#c00711` | **5,78 : 1** | AA |

Das Rot wird auf hellem Grund bewusst von `#e10a17` auf `#c00711` vertieft —
der Markenton bleibt erkennbar, das Verhältnis steigt von 4,1 : 1 (durchgefallen
für Fließtext) auf 5,78 : 1.

## Tastatur und Fokus

45 Tab-Schritte ab Seitenanfang durchlaufen; **null** Elemente ohne sichtbaren
Fokusring.

Dabei zwei echte Fehler gefunden und behoben:

1. Sämtliche Eingabefelder des Preisrechners hatten `focus:outline-none` ohne
   Ersatz — auf dem interaktivsten Bauteil der Seite gab es für
   Tastaturnutzende keinerlei Fokusanzeige. Die Unterdrückung ist entfernt, der
   globale Ring greift wieder, die farbige Rahmenänderung bleibt zusätzlich.
2. Das Tabpanel der Klassen-Spuren ist fokussierbar (`tabIndex={0}`), hat seinen
   Ring aber ebenfalls unterdrückt. Es bekommt jetzt einen eigenen
   `focus-visible`-Ring mit Abstand.

## `prefers-reduced-motion`

Gemessen mit `emulateMedia({ reducedMotion: 'reduce' })` — nicht über die
Playwright-Projektkonfiguration, die in dieser Umgebung nachweislich **nicht**
bis ins `matchMedia` des Browsers durchschlägt.

| Aspekt | Ergebnis |
|---|---|
| `matchMedia` greift | ja |
| WebGL-Canvas | 0 (Szene wird gar nicht erst geladen) |
| Scheinwerfer-Cursor | 0 |
| Abspielende Videos | 0 — stattdessen Standbilder, geladen und dekodiert |
| Hero-Ausreißer lesbar | Deckkraft 1, keine Transformation |

Nichts ist versteckt, nichts wartet auf eine Animation, die nie kommt.

## Mobile (390 px)

| Aspekt | Ergebnis |
|---|---|
| Horizontaler Overflow | 0 px |
| WebGL-Canvas | 0 |
| Scheinwerfer-Cursor | 0 |
| Kapitel-Rail | 0 (erst ab 1024 px) |

Die aufwendigen Ebenen existieren auf dem Telefon nicht — sie werden nicht
versteckt, sondern gar nicht erzeugt.

## GPU-Budget

Die 3D-Route rendert nicht dauerhaft. Der Frameloop steht still, sobald

- der Tab in den Hintergrund geht (`visibilitychange`), oder
- ein Tageslicht-Kapitel den Viewport vollständig ausfüllt — dort ist die Route
  ohnehin verdeckt.

Dazu kommen die bestehenden Grenzen: `dpr` gedeckelt auf 1,75, Szene nur ab
1024 px und nur bei WebGL2, Modul wird per dynamischem Import erst geladen,
wenn das Gerät sie überhaupt bekommt.

## Formulare und CTAs

Kein CTA endet in einer Demo-Meldung. Jeder Kontakt-Link trägt den Kontext im
Query-String und die Serverseite nimmt ihn entgegen:

| Aufruf | Ergebnis auf `/kontakt` |
|---|---|
| `?bezug=klasse-b&von=/fuehrerschein/klasse-b` | „bezieht sich auf **Klasse B**", `reference=klasse-b`, Thema *Führerschein* |
| `?bezug=adr&von=/leistungen/adr` | `reference=adr`, Thema **Seminar** vorausgewählt |
| `?standort=fulda&von=/standorte/fulda` | Standort **Fulda** vorausgewählt |

Alle Werte werden serverseitig gegen den echten Katalog geprüft — eine von Hand
gebaute URL kann weder ein nicht existierendes Thema vorwählen noch freien Text
auf die Seite bringen. `reference` und `source` gehen mit an den Webhook, damit
im Büro niemand die offensichtliche Rückfrage stellen muss.
