# Glyph Portal (glyph-portal)

> Ein riesiges Wort ("SUBLIME") in dunklem Gruen auf Grau; beim Scrollen blendet das Interface aus, die Kamera taucht in einen Buchstaben (M) ein - er kippt leicht, wird zum Fenster, das die ganze Buehne fuellt - und dahinter scrollt die naechste Sektion (gruen) herein.

Quelle: 21st.dev-Vorschau "Glyph Portal" (Wort-Regler `SUBLIME`, `Scroll Length 2.4`, Interactive an), rekonstruiert aus einer Bildschirmaufnahme. Datei: `assets/glyph-portal.html`. Referenz-Buehne 957x672 (Basisschrift 16px).

## Wann einsetzen
- Hero -> naechste Sektion mit "Wow": Agentur-/Portfolio-/Studio-Startseite, Markenname als Tor - hero portal, scroll-linked zoom, brand word
- Kapitel-/Szenenwechsel in Storytelling-Seiten (Buchstabe = Kapitel, `setLetter(i)`) - chapter transition, scrollytelling
- Page-Transition/Loader: `scrollToProgress(1, 1800)` beim Laden oder Klick - intro/outro, route transition
- Produktname/Event-Titel, hinter dem sich Foto, Video oder Gradient verbirgt - knockout text, mask reveal, "text as window"
- Dunkle Seiten, ein Akzent (Gruen), wenig Chrome; ein einziges Wort ist die Buehne

## Anatomie & Zeitleiste
Schichten (unten -> oben): Portal-Hintergrund (Gruen + Vignette, viewport-fest) -> Inhalt (`translateY`) -> **Wand** (Canvas: graue Flaeche, aus der das Wort ausgestanzt ist) -> Interface. Das Gruen sieht man nur durch die Buchstaben-Loecher; beim Zoom fuellt ein Loch die Buehne.
Alles ist eine **reine Funktion der Scroll-Position x** (px, nativer Scroll; Gesamtstrecke 2.4 Buehnenhoehen = 1613 px; Scrollbalken-Daumen im Video: 197/664 => 3.4x). Keine Zeit-Animation, kein Zustand - gleiche Position = gleiches Bild (auch rueckwaerts).

| Scroll x (px) / Anteil P | Video-Zeit | Was passiert |
|---|---|---|
| 0 | 0-0.95 s | Ruhe: Wort, Texte, Button, Auswahlfeld "6 . M" (Zeiger geparkt) |
| 33 -> 210 (P 0.02-0.13) | 1.09-1.31 s | Interface blendet **linear** aus (~220 ms bei 400 px/s); Auswahlfeld verschwindet sofort bei P >= 0.03 (x=51, 1.099 s) |
| 0 -> 850 (P 0 -> 0.527) | 1.09-2.15 s | **Zoom** um den Eintauchpunkt: Scale 1 -> ~30x, Drehung 0 -> -5 deg (gegen den Uhrzeigersinn) |
| 356 -> 372 | 1.66-1.88 s | (Daumen-Pause im Video: erste Geste 1.5x, zweite Geste stuerzt hinein) |
| ~800 (u 0.94) | 2.12-2.15 s | letzter Rand des M verlaesst die Buehne => komplett gruen |
| 850 -> 1613 | 2.15-3.6 s | gruen leer, dann scrollt der Inhalt **1:1 mit dem Scroll** hoch (`translateY = 1613 - x`): Ueberschrift y 555 -> 237 px (fade-in linear bei y 555 -> 405), danach 21 px Nachlauf bis x=1613 |

Zoom-Kurve (gemessen, Scale-Fit gegen das Video, rms ln s ~0.03): u = x/850. ln s: u .24 -> 0.09, .42 -> .41, .57 -> .95, .72 -> 1.9, .84 -> 2.7, .95 -> 3.3, 1 -> 3.4. Anlauf ~u^3 (sehr zaeh), Sturzflug um u 0.65-0.8 (bis ~9 ln/u), weiches Auslaufen.

## Motion-Tokens (CONFIG im JS)
| Token | Wert | Anmerkung |
|---|---|---|
| scrollLength | 2.4 | Buehnenhoehen Scroll-Strecke (Video-Regler) |
| zoomEnd | 0.527 | Anteil der Strecke bis Zoom-Ende (850 px bei 1613) |
| zoomSpan, zoomKeys | 3.4, 16 Stuetzpunkte | `s = e^(zoomSpan * g(u))`, g monotone Hermite-Kurve (0..1) |
| roll, rollKeys | -5 deg | `theta = roll * h(u)`, dreht frueh, saettigt ab u 0.8 |
| origin M | at [0.939, 0.306] | Eintauchpunkt als Anteil der Buchstaben-Box = (753, 283) px |
| Pivot-Drift | [-0.018, -0.099] Versalhoehen, from 1.7, tau 0.76 | Zoom-Zentrum wandert ab Scale 1.7 ~14 px nach oben (-> 751, 269) |
| uiFade / selectHideAt | [0.02, 0.13] / 0.03 | Anteile der Gesamtstrecke |
| contentFade | [0.473, 0.25] | Inhalt blendet ein, waehrend Restfahrt (in Buehnenhoehen) 0.473 -> 0.25 |
| smooth | 0 | s Zeitkonstante; im Video keine Glaettung (Bild folgt dem Scroll bis auf ~7 ms) |
| stepDuration | 2600 ms | "Step inside" (easeInOutCubic) - Erweiterung |

## Look-Tokens
| Token | Wert |
|---|---|
| Buehne / Wand | `#1f1f1f`; Wort + Portal `#001e08` (0,30,8) mit minimalem Verlauf: Vignette unten rechts bis (0,22,8), feiner Lichtfleck oben rechts |
| Wort | Vektor-Umrisse (nachgezeichnet): Versalhoehe 140 px, Breite 802 px, Mitte x +2 px, Grundlinie y=380 (46.1% Hoehe); Stamm 24.6 px (Plus-Jakarta-ExtraBold-artig) |
| Interface | Logo "sublime." 20px/600 `#eceeed` links 50px; Tagline 14px rechts; Zeile ueber dem Wort 14px (y 29%); "Follow your curiosity." 18px (63.5%); Hint 12px (85.7%) |
| Button | 152x46, Radius 10, `#000b02`, Rand 1px `#1f3229`, Text 15/500, Pfeil klein rechts (72.7%) |
| Auswahlfeld | 125x45, Radius 8, `#4a4a4a`, Text "6 . M" 13/500 + Chevron (93.9%) |
| Inhalt | Ueberschrift 38px/400 `#fff` bei y 35%; 3 Spalten (Pad 50, Gap 64, je 245), Linie `rgba(255,255,255,.035)`, "01" 11px, Titel 18/500, Text 15/1.6 `.84` weiss |
| Schrift | Plus Jakarta Sans (nicht verfuegbar) -> Stack "Plus Jakarta Sans, Inter, Geist, ..., Arial, Liberation Sans"; Letter-Spacing auf Arial-Breiten kalibriert |

## Interaktion & Barrierefreiheit
- Video: Scroll (Zeiger geparkt, Mausrad/Touch am Tablet). Umsetzung: **nativer Scroll** (`position: sticky` + hohes Scroll-Feld): Mausrad, Touch-Inertia, Scrollbalken, Tastatur - ohne Hijacking.
- Erweiterungen (im Video nicht sichtbar): "Step inside" scrollt animiert ans Ende (bricht bei Wheel/Touch/Taste ab); Zeiger ueber einem Buchstaben -> gruenes Leuchten, Klick/Tap oder Auswahlfeld waehlt den Eintauch-Buchstaben ("Pick any letter, then scroll").
- A11y: echter `<h1>` (sr-only) mit dem Wort, Canvas `aria-hidden`; Inhalt `aria-hidden` bis er sichtbar ist; Button/Select fokussierbar mit sichtbarem Fokusring.
- `prefers-reduced-motion`: kein Zoom/Roll - Wort bleibt stehen, die Wand blendet per Opacity aus (u 0.55 -> 0.95), Step springt.

## 120 Hz
- Technik: rAF-Loop nur solange sich etwas aendert (`dt = min(50, t - last)`); Zustand = f(scrollY), kein Takt. Wand = 2D-Canvas (Vektor bleibt bei s=30 kristallscharf; DOM-Transform wuerde rastern): Ruhe/Hover-Canvas nur Wort-Band-gross (Schatten malt die Wand), Zoom-Canvas buehnengross, Moduswechsel nur sichtbar/unsichtbar. Interface/Inhalt nur `opacity`/`translate3d` (nur bei Aenderung geschrieben), `will-change` nur waehrend der Bewegung, `contain: layout paint`, Zeiger nur gemerkt + im rAF angewendet, Layout nur in `measure()` (Init/Resize), Canvas-Aufloesung <= 2x. Hover-Leuchten per `a = 1 - exp(-dt/tau)`.
- check120 (957x672 und 1234x673, 4x Drosselung): statisch ok (nur INFO: Layout-Lesen in `measure()`), Laufzeit 1x p95 1.8 ms / 4x p95 8.1 bzw. 8.4 ms, Script 0.13-0.14 ms/Frame, keine Konsolenfehler. VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine.
- Einschraenkung (ehrlich): Im Headless-Harness takten **Scroll-Frames mit ~17.4 ms** (60 Hz) - auch eine leere Sticky-Seite zeigt p95 17.7 ms (Kontrolle). Die Choreografie mischt daher Hover-Sweeps (schnelle Frames) mit kurzen Scroll-Stuecken (Step + Mausrad); die reine Scroll-Phase misst ~17.4 ms (Harness-Artefakt, kein Skript-Kosten: 0.14 ms/Frame). Auf echten 120/144-Hz-Geraeten scrollt der Compositor im Display-Takt.

## Einbindung (assets/glyph-portal.html)
- Kopiere Daten (`GLYPH_PORTAL_SUBLIME`, optional), `GLYPH_PORTAL_CONFIG`, `/* COMPONENT CSS */`, `/* COMPONENT JS */` und das Markup `<section class="gp" data-gp>...</section>`.
- `initGlyphPortal(root, opts) -> { setLetter(i), scrollToProgress(p, ms), progress(), info(), refresh(), destroy() }`; `root` = `.gp` (hohes Scroll-Feld, enthaelt `[data-gp-stage]`, optional `[data-gp-ui]`, `[data-gp-content]`, `[data-gp-select]`, `[data-gp-step]`).
- opts: `word`, `letter` (0-basiert), `scrollLength`, `zoomEnd`, `zoomSpan`, `zoomKeys`, `roll`, `rollKeys`, `uiFade`, `contentFade`, `smooth`, `stepDuration`, `interactive`, `hoverTint`, `origin {Buchstabe: {at, drift, from, tau}}`, `glyphs` (Vektor-Umrisse oder null), `fit`, `maxDpr`.
- Andere Woerter: ohne `glyphs` rendert die System-Schrift (Breite/Hoehe auf die Ziel-Box gefittet); Eintauchpunkt automatisch (tiefster Innenpunkt per Distanztransformation), Scale wird automatisch so weit erhoeht, bis das Loch die Buehne fuellt. Eigene Inhalte: Gruen (`--gp-portal`) durch Bild/Video/Gradient ersetzen, Inhalt in `[data-gp-content]`.
- Buehne = Viewport (`100svh`); `scrollLength` setzt die Hoehe des Scroll-Felds.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich React + Tailwind + framer-motion: `useScroll` auf einem hohen Container (Sticky-Buehne), `useTransform` fuer Scale/Rotate/Opacity, Wort als SVG-`<mask>`/Text-Knockout, Inhalt dahinter.
```tsx
const { scrollYProgress: p } = useScroll({ target: ref, offset: ["start start", "end end"] });   // Container 340vh, Buehne sticky
const u = useTransform(p, [0, 0.527], [0, 1]);
const scale = useTransform(u, zoomKeys.map(k => k[0]), zoomKeys.map(k => Math.exp(3.4 * k[1])));  // 1 -> ~30
const rotate = useTransform(u, [0, .43, .8, 1], [0, -2.2, -5, -5]);
const ui = useTransform(p, [0.02, 0.13], [1, 0]);
const contentY = useTransform(p, v => (1 - v) * range);                                           // 1:1 mit dem Scroll
<motion.g style={{ scale, rotate, originX: "93.9%", originY: "30.6%" }}>{/* Buchstaben als mask: <text fill="black">SUBLIME</text> */}</motion.g>
```
Keine Feder im Spiel: Bild folgt dem Scroll direkt (Fit mit ~7 ms Versatz zum Scrollbalken).

## Kreativ remixen
1. **Foto/Video als Portal**: `--gp-portal` durch ein loopendes Video ersetzen und innen leicht parallaxen - man taucht in den Buchstaben und landet in einer Szene; je Buchstabe ein anderes Kapitel (`setLetter` per Scroll-Zone/Hover).
2. **Hochdrehen**: `zoomSpan: 5.5`, `roll: -25`, `rollKeys` bis 1.0 erst bei u 1, `contentFade` enger, `smooth: 0.08` fuer buttrig-weiches Mausrad - Sturzflug mit Drall.
3. **Page-Transition**: Wort = Seitenname; Klick auf einen Link -> `scrollToProgress(1, 1400)` und Route wechseln; rueckwaerts beim Zurueck (`scrollToProgress(0, 1000)`).
4. **Zeiger-/Gyro-/Audio-getrieben**: statt Scroll `x` aus Neigung (DeviceOrientation), Bass-Pegel oder Drag setzen (`render(x)` ist rein) + `navigator.vibrate(8)` beim "Cover"-Moment (u 0.94).
5. **Eigenes Logo**: Umrisse per Marching-Squares aus einem Screenshot nachzeichnen und als `glyphs` einsetzen (mehrere Pfade je Buchstabe, `evenodd`) - dasselbe Eintauchen mit Marken-Glyphen oder Emoji-Silhouetten.

## Bekannte Abweichungen (ehrlich)
- Schrift: Interface/Inhalt nutzen Arial/Liberation (Plus Jakarta Sans nicht vorhanden); Positionen stimmen auf 1-2 px, Glyphformen/Zeilenumbrueche nur durch Letter-Spacing angenaehert (Bild-RMSE im Inhalt ~0.11, Hero/Zoom 0.01-0.03; ein Teil davon ist der Mauszeiger im Video).
- Wort: aus dem Video nachgezeichnet (M/I/L/E als Geraden, S/U/B als Polygone, Fehler ~0.3 px); Zoom- und Roll-Kurven sowie der Pivot-Drift sind **gefittet**, nicht abgelesen (Scale rms ln s 0.03). Visuell lag das Bild ~7 ms hinter dem Scrollbalken-Daumen (eingerechnet).
- Video-Frames kamen mit 60 Hz Inhaltsrate (jedes zweite Bild doppelt) - Zeitaufloesung ~17 ms. Scroll-Position nur aus dem Daumen (3.4 px Raster) gelesen.
- Nicht erkennbar: Hover-/Fokus-Zustaende (Button, Wort, Select-Popup), "Annotations"-Overlay und was "Interactive" genau tut (Zeiger parkte unter dem Wort), Verhalten beim Rueckwaertsscrollen/Resize/Touch, Aktion von "Step inside" (angenommen: Scroll ans Ende), exakte Zoom-Mechanik nach dem Cover (Scale ab x 850 unbekannt). Das Controls-Panel gehoert zur 21st-Seite, nicht zur Komponente.
- Der Zoom endet hier bei ~30x (aus dem Video abgeleitet); fuer andere Buchstaben erhoeht `initGlyphPortal` die Endscale automatisch.
