# Slanted Spread Hero (slanted-spread-hero)
> Ein kompakter, schraeg geneigter Kartenstapel faechert sich weich diagonal auf und blendet dahinter eine grosse Headline mit Untertext ein.

## Wann einsetzen
- Hero-Bereich einer Landing-Page / Portfolio / Galerie-Teaser (hero, showcase)
- Bildstapel -> Auffaecherung als "Reveal" (stack to spread, card fan, image deck)
- Produkt-/Template-Vorschau mit mehreren Motiven, Moodboard, Case-Study-Teaser
- Intro-Moment nach dem Laden oder bei Tap/Klick ("Show all")
- Headline, die hinter Bildern liegt und erst durch das Auffaechern lesbar wird (Text-Reveal, Tiefenschichtung)

## Anatomie & Zeitleiste
Buehne dunkel (#1b1c21), violetter Lichtfleck mit feinen Ringen, 8 Karten (Himmel, Blumen, Surfer, Mops, Fussball, Jacke, Feld, Ballons; hinten -> vorn) im Stapel; Headline "Dynamic ... le." (im Video teils verdeckt) + 2-zeiliger Untertext ("... motion across the viewport.").

| Phase | Zeit (ms ab Start) | Was passiert |
|---|---|---|
| Stapel | 0 - ~1500 | kompakter Stapel (Scale ~.6, Schritt ca. 20/-8 px), geneigt ca. -13 Grad, Text unsichtbar |
| Spread | ~1500 - ~3300 | Feder 0 -> 1: Scale -> 1, Schritt -> 112/-54 px diagonal nach oben rechts, ease-out ohne Overshoot |
| Headline | ab ~10 % Fortschritt bis ~80 % | Opacity grau -> weiss (hinter den Karten) |
| Untertext | etwas spaeter (+12 %) | Opacity, gedaempftes Grau |
| Ruhe | danach | statisch (keine Idle-Bewegung erkennbar) |

Im Video (Zeit ab Stapel-Sichtbarkeit ~1.3 s): Spread-Start ~2.9 s, Text ab ~3.0 s, praktisch fertig ~4.5 s.

## Motion-Tokens
- Feder auf Fortschritt p (0..1): stiffness 14, damping 7.5 (ueberkritisch, ~1.8 s, kein Overshoot)
- Text-Fenster: textFrom .10, textTo .80, subLag .12, smoothstep
- Delay bis Autoplay: 1500 ms
- Faecher: stepX 112u, stepY -54.4u, Versatz (-32, +9)u, Rotation -13 Grad, Einzel-Tilt +-1.5..2.5 Grad
- Stapel: scale .68, stepX 20u, stepY -8u (1u = 1px bei 1234 Breite)

## Look-Tokens
- Buehne #1b1c21, Lichtfleck rgba(58,40,110,.20) (Mitte ~#1C1827), Ringe rgba(255,255,255,.012)
- Headline weiss #f4f4f5, ~62u, Gewicht 700, letter-spacing -.035em; Untertext 16u, rgba(255,255,255,.52)
- Karten 172x128u, Radius 12, Schatten 0 14 34 rgba(0,0,0,.45)
- Font: Inter, Geist, Roboto, ... (Video wirkt wie Roboto/Inter)
- Motive als Inline-SVG-Platzhalter (SP_ART), per opts.art austauschbar

## Interaktion & Barrierefreiheit
- Autoplay nach Delay; Tippen/Klick (pointerup, Maus + Touch) toggelt Spread/Stapel; Enter/Space ebenso
- root: role=button, tabindex=0, aria-expanded, aria-label; Focus-Ring; touch-action: manipulation
- prefers-reduced-motion: kein Tween, Zustand springt direkt

## 120 Hz
- rAF mit Zeitstempel, dt = min(dt, 50), Feder semi-implizit mit festem Substep 1/240 s (Akkumulator); loop stoppt, sobald ruhig
- Nur transform/opacity, will-change nur waehrend der Animation, contain: layout paint; Messung (u) einmal + ResizeObserver
- check120: VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine (4x Drosselung: p95 3.0 ms, 0.1 % ueber Budget; ungedrosselt p95 0.5 ms)

## Einbindung
`assets/slanted-spread-hero.html`: Markup zwischen COMPONENT:START/END, `initSlantedSpreadHero(root, opts)` -> `{open(), close(), toggle(), isOpen}`.
Optionen: autoplay, delay, spring{stiffness,damping}, textFrom/textTo/subLag, collapsed{scale,stepX,stepY,rot}, spread{scale,stepX,stepY,rot,offX,offY}, tiltJitter, tiltAmount, art (Array SVG-Innenleben, viewBox 172x128), onChange(open). Texte direkt im Markup (.sp__title, .sp__sub).

## Vermuteter Original-Stack -> React/Framer-Motion
```jsx
const p = useSpring(open ? 1 : 0, { stiffness: 14, damping: 7.5 }) // oder useScroll-getrieben
cards.map((c,i)=> <motion.img style={{ x: useTransform(p,[0,1],[k*20,k*112]),
  y: useTransform(p,[0,1],[k*-8,k*-54]), scale: useTransform(p,[0,1],[.68,1]), rotate: -13 }} />)
<motion.h1 style={{ opacity: useTransform(p,[.1,.8],[0,1]) }}>Dynamic ... </motion.h1>
```
Eventuell scroll- oder inView-getriggert; im Video startet es von selbst (nicht eindeutig).

## Kreativ remixen
1. Scroll-gekoppelt: p = Scroll-Fortschritt, Karten gleiten beim Scrollen auseinander, Text wird frei.
2. Stagger statt gleichmaessig: pro Karte eigene Feder (Delay 40 ms), leichter Overshoot (damping 5) = Kartenspiel-Wurf.
3. Cursor-Parallax: Faecher kippt (rotateY/X) mit Zeigerlage, Karten in verschiedenen Tiefen (translateZ).
4. Hover auf Karte hebt sie aus dem Faecher (scale 1.15, Schatten, Nachbarn weichen aus) fuer Produktgalerie/Case Studies.
5. Mehrere Faecher in Orbit/Kreis, Headline als Maske, Farbwechsel des Lichtflecks pro aktiver Karte.

## Bekannte Abweichungen
- Motive sind SVG-Platzhalter, keine Fotos; echte Bilder via opts.art/img einsetzen.
- Headline-Wortlaut nicht lesbar (nur "Dynami..." und "...le."); Untertext nur teilweise ("...on across the ... port."). Texte geraten ("Dynamic Spread Style.").
- Ausloeser im Video unklar (Autoplay vs Scroll vs Tap); Zeiger erschien nicht am Effekt. Stapel/Faecher-Neigung im Original wirkt etwas staerker perspektivisch (3D-Schraegstellung) als reine 2D-Rotation; Stapel dort etwas groesser/dichter.
- Feder-Werte per Frame-Vergleich geschaetzt (Aufnahme 10-20 fps ausgewertet, kein exakter Ms-Abgleich der Kurve).
- Oeffnungs-Fade des 21st-Modals ist nicht Teil der Komponente.
