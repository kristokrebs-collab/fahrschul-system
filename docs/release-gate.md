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

## Der eigenständige Build — Abnahme gegen `file://`

Der zweite Auslieferungsweg ist eine Datei pro Seite, die per Doppelklick läuft:
kein Server, kein Netz, keine Bibliothek von einem CDN. Erzeugt wird er mit
`node scripts/standalone/build.mjs <ordner>` — aus **denselben** TypeScript-
Inhaltsdateien, die auch Next.js rendert (ein Resolver-Hook lädt sie direkt in
Node). Zwei Kopien derselben Fakten kann es damit nicht geben.

Geprüft wird mit `node scripts/standalone/gate.mjs <ordner>`. Das Skript öffnet
die Dateien über `file://` und **bricht jede Anfrage ab**, die nicht
`file:`, `data:` oder `blob:` ist. Was trotzdem noch funktioniert, funktioniert
wirklich offline.

| Prüfung | Ergebnis |
|---|---|
| Seiten geladen | **40 / 40**, jede mit `h1` und Titel |
| Externe Requests über alle Seiten | **0** |
| Konsolen- und Laufzeitfehler | **0** |
| Bookmark-Techniken im Markup gefunden | **20 / 20** |
| Fokus sichtbar über 45 Tab-Stationen | **45**, keine unsichtbare, keine außerhalb des Bildes |
| Tap-Ziele unter 24 px (außerhalb von Fließtext) | **0** |
| Horizontaler Overflow bei 390 px | **0 px** |

### Gemessene Helligkeit über den Scroll

Mittlere Bildhelligkeit des sichtbaren Fensters, zwölf Positionen, 0–255:

```
28  39  32  43  44  50  36  239  230  203  193  109
└───────── Nacht ─────────┘  └──── Tag ────┘  Footer
```

Spannweite **211 von 255**. Der Sprung zwischen Position 7 und 8 ist der
Sonnenaufgang in Kapitel 07 — genau eine Stelle, nicht ein Verlauf über alles.

### Kontrast, auf den zusammengesetzten Pixeln gemessen

Wo Text auf einem Verlauf, einer durchscheinenden Fläche oder auf Video sitzt,
lügt die Berechnung aus der Kaskade. Gemessen wird deshalb der **gerenderte
Bildschirm**: Screenshot in ein Canvas, Histogramm über die Textbox, der
häufigste Helligkeitswert ist der Grund.

| Element | Verhältnis | WCAG |
|---|---|---|
| Kapitel-Label in der Morgendämmerung | 13,23 : 1 | AA |
| Kapitelüberschrift Morgendämmerung | 15,96 : 1 | AA |
| Fließtext Morgendämmerung | 6,68 : 1 | AA |
| Label auf der Tageslicht-Karte (über Video) | 6,52 : 1 | AA |
| Fließtext auf der Tageslicht-Karte (über Video) | 5,76 : 1 | AA |
| Überschrift auf der Tageslicht-Karte | 15,82 : 1 | AA |
| Fließtext im Hero (über Video) | 8,09 : 1 | AA |

Zwei Befunde stammen erst aus dieser Messung: Das Label der Morgendämmerung kam
im Verlauf auf 2,9 : 1, die Punkte der Simulator-Galerie waren 34 × 4 px groß.
Beides ist korrigiert — Text beginnt unterhalb des Verlaufs, und die Punkte
behalten ihre 4 px Strich in einem 24 px hohen Ziel (`background-clip`).

### `prefers-reduced-motion` offline

| Prüfung | Ergebnis |
|---|---|
| Route zeichnet noch | nein — Standbild, zwei Messungen identisch |
| Videos mit geladener Quelle | **0** (nur Poster, kein Byte Video dekodiert) |
| Poster vorhanden | 4 / 4 |
| Führerschein-Finder | 6 Schritte → „Klasse B" |

### Was der Nutzer tatsächlich anfassen kann (offline nachgespielt)

| Interaktion | Ergebnis |
|---|---|
| Finder, sechs Fragen | Empfehlung „Klasse B" mit Begründung |
| Preisrechner, deutsche Eingabe `62,50` | 20 × 62,50 € = 1.250,00 €, Summen 1.600,00 € vs. 1.670,00 € |
| Klassen-Tabs | Auswahl wechselt, nur ein Panel sichtbar |
| Cockpit-Scroll | App bewegt sich (−223 px → −595 px) |
| Mobiles Menü | öffnet, Fokus wandert hinein, `Esc` schließt und gibt Fokus zurück |
| Video | spielt aus der Datei heraus (VP9/WebM als `data:`-URI) |
