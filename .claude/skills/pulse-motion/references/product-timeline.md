# Product Timeline (product-timeline)
> Scroll-gekoppelte, gepinnte Horizontal-Timeline: Hero "Six years, one horizontal scroll." -> Abschnitt pinnt, Track gleitet seitwaerts, jeder Meilenstein zeichnet seinen Stab und enthuellt seinen Text, sobald er die Mitte erreicht.

## Wann einsetzen
- Roadmap / Firmengeschichte / Changelog als Scroll-Story (scrollytelling)
- Pinned horizontal scroll section, Case-Study-Ablauf, Produkt-Meilensteine
- Onboarding-/Prozess-Schritte, Release-Historie, Portfolio-Zeitstrahl
- Dunkle Premium-Landingpage mit Orange/Rot-Akzent, minimalistisch, typografisch

## Anatomie & Zeitleiste
Interaktion = vertikales Scrollen (Touch-Swipe/Rad/Pfeiltasten) im Container. Alles ausser der Intro-Linie ist an die Scrollposition gekoppelt (nicht an die Zeit).
| Phase | Scroll-/Zeitbereich | Was passiert |
|---|---|---|
| Hero | 0 .. 1 Viewport | Eyebrow (mono, gesperrt), H1 (2 Zeilen), Lede, Pfeil; scrollt normal nach oben |
| Eintritt | Abschnitt steigt von unten | Karte (Bild 248x287, r10) + "Product Storyline" + "2020 — 2026" scrollen herein |
| Intro-Linie | ab ca. 62 % Abschnitt im Bild, ~700 ms ease-out (zeitbasiert) | Achse zieht sich von beiden Punkten (scale 0->1) auf 286 px |
| Pin + Slide | travel = letzter Stab - 0.49*W (1:1 Scroll->px) | Track translateX, Achsenende waechst bis 76 % W (ease ueber die ersten 35 %) |
| Meilenstein (je p) | Stab bei 74 % W -> 49 % W | Stab scaleY ~ p^2.2; Punkt scale ab p .25; Titel-Maske hochgleiten ab p .5; Text +0.18 spaeter |
| Unpin / Outro | danach 1 Viewport | Abschnitt scrollt weg, "From the first research note to a multi-market launch." zentriert; blauer Strich (2x20 px) blendet ein/aus |
Meilensteine alternieren oben/unten (Stab 140 px, Raster 218 px): 2020 March, 2020 November, 2021 July, 2022 October, 2023 April, 2025 September, 2026 May.

## Motion-Tokens
- Scroll->Reveal-Glaettung: a = 1 - exp(-12*dt) (smoothK) – verhindert Ruckeln bei Touch-Fling
- Intro-Linie: 700 ms, 1-(1-t)^3
- Stem-Pow 2.2; Reveal-Fenster revealFrom 0.74 / revealTo 0.49 (Anteil Viewportbreite)
- Titel/Text: translateY(100%->0) in overflow:hidden-Maske (smoothstep)
- Achsenende: 606 px (Ruhe) -> 0.763*W, smoothstep(p/0.35)
- Im Original-Control: "Duration 1.40" (Sekunden; im Video nur als Panel-Wert sichtbar, Wirkung unklar)

## Look-Tokens
Buehne #1F1F1F; Titel #F8F8F8; Fliesstext #ADADAD; Eyebrow ~#6A-8A mono, letter-spacing .28em; Akzent-Punkte #FD7A1B (Control: Active Color #FF5F00); Achse #C82701/#A00000 (2 px); Staebe #8D2612 (1 px); blauer Strich #3A77F4. Schrift Roboto/Inter-artig: H1 ~58 px/600/-0.035em/LH 76, Titel 24-26 px, Text 14.5 px/17, Punkt 7 px, Achse bei 36 % Hoehe. Karte 248x287 r10 (im Original ein 3D-Glasblock-Foto, hier als SVG-Platzhalter).

## Interaktion & Barrierefreiheit
Container `section.ptl` (tabindex=0, role=region) ist der Scroller: Touch (touch-action: pan-y), Mausrad, Pfeiltasten/Bild-Tasten nativ. Screenreader-Text mit allen Meilensteinen (.ptl__sr). prefers-reduced-motion: keine Glaettung, Intro-Linie springt. `overscroll-behavior: contain`.

## 120 Hz
rAF-Loop laeuft nur, solange Scroll/Reveal sich bewegt; dt = min(t-last, 50); Glaettung mit 1-exp(-k*dt); Intro-Zug per dt/Dauer. Nur transform (translate3d/scale3d) und opacity; Geometrie einmal in measure() (ResizeObserver) gecacht, keine Layout-Reads pro Frame; Scroll-Listener passiv, scrollTop nur im Event gelesen; Schreibzugriffe nur bei Wertaenderung; will-change nur waehrend der Bewegung.
check120: `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine` (normal p95 1.1 ms, 4x p95 6.0 ms, 0 % ueber Budget, 0 Layouts/Frame). Verbleibende [WARN] "style.left/height": nur einmaliges Setup (Item-Position, Hoehe des Pin-Spacers bei Resize), nie pro Frame.

## Einbindung
`assets/product-timeline.html`: CONFIG-Block + CSS-Variablen oben. `initProductTimeline(root, opts)` – root = Scroll-Container mit fester Hoehe (z.B. 100vh); opts ueberschreibt CONFIG: `items[{date,text}]` (\n = Zeilenumbruch), `eyebrow, heading, lede, introTitle, introRange, outro, step, firstStemX, axisEndFrac, revealFrom, revealTo, stemPow, smoothK, introDrawMs`. Gibt `{measure}` zurueck. Karte ist ein SVG – fuer ein echtes Bild `.ptl__card` ersetzen.

## Vermuteter Original-Stack
React + Framer-Motion `useScroll({target})` + `useTransform`: sticky Section mit hoher Hoehe, `x = useTransform(progress,[0,1],[0,-travel])`, pro Item `useScroll`/`useInView` fuer pathLength-/scaleY-Stab und Mask-Reveal; Controls: duration, textColor, activeColor, mutedTextColor, backgroundColor.
```tsx
const { scrollYProgress } = useScroll({ target: ref, offset: ["start start","end end"] });
const x = useTransform(scrollYProgress, [0,1], [0, -travel]);
<motion.span style={{ scaleY: useSpring(p, { stiffness: 140, damping: 24 }) }} className="origin-bottom" />
```

## Kreativ remixen
1. Stab als SVG-Pfad mit Glow (drop-shadow) und Funken-Partikeln, die beim Erreichen der Mitte hochsteigen.
2. Parallax: Karte/Bilder mit 0.6x Track-Geschwindigkeit, Titel mit Mikro-Skew nach Scroll-Geschwindigkeit.
3. Aktiver Meilenstein pulsiert (Punkt-Ring expandiert) und Hintergrund faerbt sich leicht warm.
4. Mit Cursor-Spotlight oder Dock kombinieren; Zahlen-Counter (Jahre) laufen mit dem Scroll.
5. Vertikale Variante fuer Mobile; oder Achse wird beim Scrollen zur Welle (SVG-Pfad morph).

## Bekannte Abweichungen
- Karte: SVG-Nachbau statt 3D-Glasbild.
- Schrift: Roboto/Inter-Fallback; in der Testumgebung fehlte Roboto, Schriftbreiten daher nur naeherungsweise kalibriert.
- Reveal-Kurven (Stab/Punkt/Text) aus ~20-fps-Frames geschaetzt; exakte Easing und die "Duration"-Wirkung nicht erkennbar.
- Achse war in einem Moment grau (#474747) statt rot – Ursache unklar, nicht nachgebaut.
- Blauer Strich: Bedeutung unklar (fixierte Marke im Outro), als dezentes Element nachgebaut.
- Hero-Einblendung beim Laden und Scroll-Fling-Physik (Browser/Touch) nicht Teil der Komponente.
