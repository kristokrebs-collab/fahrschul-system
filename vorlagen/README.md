# Premium-Vorlagen — fünf Website-Vorlagen in einer Datei

`../premium-vorlagen.html` ist die Auslieferung: **eine HTML-Datei, 3,8 MB, offline
lauffähig.** Kein Framework, kein CDN, keine Netzabfrage. Schriften, Filmsequenzen
und Bilder liegen als Base64 in der Datei.

Öffnen: Datei doppelklicken. Bedienung mit `1`–`5`, `/` für die Suche, `Esc` zurück
zur Galerie.

## Die fünf Vorlagen

| # | Name | Charakter | Filmmechanik |
|---|---|---|---|
| 01 | **Nachtfahrt** | Kino, sehr viel Schwarz, verdichtete Archivo (`wdth` 62) | gepinnter Scroll-Scrub: 28 Bilder hängen am Scrollbalken, die Flotte dreht 360° |
| 02 | **Fahrbahn** | heller Grund, redaktionell, gedehnte Archivo (`wdth` 124) | Film eingefasst im Passepartout, Endlosschleife |
| 03 | **Werk 2** | Bento, industriell, Stahl | jede Kachel trägt ihren Film und startet ihn beim Überfahren |
| 04 | **Simulator** | WebGL-Wellen, Regen, Glas | Shader live + Regenfilm als Textur + 3D-Kippung beim Scrollen |
| 05 | **Route** | vollflächiger Filmhintergrund | Kapitelwechsel blendet den Hintergrund über (kein Scroll-Hijacking) |

Jede Vorlage bekennt sich zu ihrem eigenen Grund — das ist Absicht, keine
Auslassung. Die **Galerie-Hülle** beherrscht hell und dunkel (Umschalter oben rechts).

## Woher Farbe und Schrift kommen

Nicht frei gewählt, sondern aus `docs/designrichtung.md` des Projekts übernommen:

- **Ink** `#060708`–`#6b7480` · **Chalk** `#f3f1ec` · **Signal** `#ff3b45` / `#e10a17` / `#c00711`
- **Amber** `#e0a11a` nur für Warten, **Grün** `#4ba97a` nur für Erledigtes
- **Archivo** variabel für Display (Verdichtung über `font-stretch`, nicht über Tracking),
  **Instrument Sans** für Fließtext, **JetBrains Mono** für Anzeigen
- Rot markiert nie mehr als eine Sache pro Bildschirm. Wo der Lichtring der
  Drehbühne rot ist, ist die Überschrift es deshalb **nicht**.

## Die 24 Bausteine aus 21st.dev

Alle 24 Lesezeichen sind verbaut und einzeln geprüft. Reihenfolge wie in
`docs/21st-mapping.md`:

| Baustein | Autor | Wo |
|---|---|---|
| Hero Scrub | jean.duthil13 | 01 — gepinnter Hero |
| Liquid Metal Button | johuniq | 01, 04, 05 — Primär-CTA |
| Interactive Image Accordion | minhxthanh | 03 — Fahrzeugwelten |
| Minimalist Hero | ravikatiyar162 | 03 — Kopf mit Signalkreis |
| Animated Glowing Search Bar | minhxthanh | Galerie — Vorlagensuche |
| Section With Mockup | aghasisahakyan1 | 02 — Weiterbildung mit Parallaxe |
| Gradient Selector Card | isaiahbjork | 02 — sechs Stationen |
| Reveal Text | isaiahbjork | Überschriften in 01, 02, 04, 05 |
| Container Scroll Animation | manuarora700 | 04 — Rahmen kippt nach vorn |
| Shiny Button | designali-in | 03, 05 — Sekundär-CTA |
| Dock | ibelick | Galerie — Vorlagenwechsel |
| Minimal Dock | jatin-yadav05 | Dock-Spiegelung + App-Dock in 04 |
| MarkerPopup | mapcn | 05 — Standortkarte |
| View Magnifier | bucharitesh | 02 — Fahrzeugdetail |
| Image Auto Slider | waleedkibhen | 01 — Fuhrpark, Galerie — Bausteinband |
| Feature Carousel | cult-ui | 03 — Digitalpaket |
| Animated Tabs | chetanverma16 | 02 — Klassen |
| Animated Profile Card | aghasisahakyan1 | 05 — Bereichskarten |
| Hero Section 2 | meschacirung | 05 — zentrierter Kopf |
| Sign In Flow | aghasisahakyan1 | 04 — Cockpit-Zugang |
| Shader Animation | designali-in | 04 — WebGL-Wellen |
| Hero (Paper Shader) | reuno-ui | 04 — Papierverlauf |
| Hover Footer | mdafsarx | Fußzeilen |
| Morphing Cursor | jatin-yadav05 | global ab 900 px |

**Wichtig zur Herkunft:** der bezahlte Quellcode von 21st.dev war nicht abrufbar
(`get_component` meldet `retrieval_limit_reached`, 2 Abrufe/Tag). Die Mechanik ist
nach Komponentenbeschreibung in reinem HTML/CSS/JS nachgebaut — das ist für eine
Ein-Datei-Auslieferung ohnehin nötig, weil die Originale React/shadcn sind.
Die Autorschaft der Vorlagen liegt bei den genannten Personen.

## Warum Bildsequenzen statt `<video>`

Scroll-Scrubbing über `video.currentTime` ruckelt, weil MP4 nur an Keyframes
springt. Die Vorlagen zeichnen deshalb **JPEG-Sequenzen auf Canvas** und blenden
zwischen zwei Bildern über (Bruchteil-Index) — dadurch läuft eine 16-Bild-Schleife
wie eine weiche Zeitlupe und ein Scrub trifft jedes Bild exakt. Kein Codec-Risiko,
in jedem Browser gleich.

Sechs Sequenzen, 116 Einzelbilder, aus dem Zweig `higgsfield-assets` entnommen:
`turntable` (28) · `morph` (22) · `roadday` (18) · `rain` (16) · `cabin` (16) · `ring` (16).
Vorschauen in der Galerie laden mit `stride 3` nur jedes dritte Bild — gleiche
Bewegung, ein Drittel Speicher.

## Neu bauen

```bash
cd vorlagen
node build.mjs ../premium-vorlagen.html
```

Quelltext liegt in `src/` und wird nach Dateinamen sortiert zusammengesetzt
(`01-tokens.css` … `07-t5.css`, `10-shell.html` … `15-t5.html`, `90-engines.js` …
`95-app.js`). Die Bildsequenzen in `assets/` stammen aus:

```bash
node frames.mjs <webm> assets/frames/<name> <anzahl> <breite> <qualität>
node resize.mjs picks.txt <quellordner> assets/img
```

Quelle sind die **WebM**-Fassungen aus `higgsfield-assets` — das Chromium von
Playwright ist ein Open-Source-Build ohne H.264 und kann die MP4s nicht dekodieren.

## Geprüft

31 von 31 Prüfungen bestanden (`interact.mjs`), keine JS-Fehler. Geprüft wurden
alle 24 Bausteine einzeln plus Suche, Umschalter, Tastatur, Zählwerke und
Formularprüfung. Kein Querlauf bei 390, 768 und 1440 px. Bei
`prefers-reduced-motion` stehen Filme als Standbild, Korn und Auftritte sind aus.

## Was bewusst fehlt

**Keine Preise, keine Sternebewertungen, keine Simulator-Zahlen.** `docs/business-truth.md`
führt sie als unbelegt; der Assistent in Vorlage 05 nennt deshalb gesetzliche
Mindestwerte nach FeV und FahrschAusbO statt Beträge. Formulare zeigen echte
Prüfung und echte Zustände, versenden aber nichts.

Es gibt **keine erfundenen Personen**: Vorlage 05 zeigt Ausbildungsbereiche, wo eine
Team-Sektion Porträts bräuchte — die liegen nicht vor.

Die frühere Produktionsseite verzichtete absichtlich auf Marquee, Custom-Cursor und
gepinnte Szenen (`docs/final-creative-direction.md`). Diese Sammlung nutzt sie, weil
sie ausdrücklich bestellt waren — beim Übernehmen in die Live-Seite ist das eine
bewusste Entscheidung, keine Selbstverständlichkeit.
