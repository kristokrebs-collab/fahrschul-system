# Product Launch Hero (product-launch-hero)

> Ein 6.65-s-Produkt-Trailer als Loop: dunkle Punktraster-Karte mit Satz "that lets you [Foto] filter out AI." und drehendem Quadrat -> Kamera zoomt heraus und schwenkt prismatisch zur Seite -> Foto-Wand fliegt ein und kollabiert zu einer Hero-Karte, Karte wird zur weissen Leinwand -> rechts fliegt Panel B ("A whole new universe", Foto-Kachel-Ringe) ein -> Befehlszeile `npx shadcn add @snapcn` blendet unscharf ein.

Quelle: 21st.dev-Vorschau "Product Launch Hero" (Bildschirmaufnahme, nur Zeitachse/Optik, kein Quellcode). Datei: `assets/product-launch-hero.html`. Referenz-Buehne 1194x672 (16:9, wird per Skalierung eingepasst).

## Wann einsetzen
- Produkt-/Library-Launch-Hero, "Trailer"-Sektion auf Landingpages - product launch, hero trailer, SaaS intro
- Auto-abspielende Story ohne Scroll: Problem -> Entdeckung -> Ergebnis -> CTA/Install-Befehl - autoplay storyboard
- Entwicklertool-Vorstellung (Install-Zeile am Ende) - dev tool teaser, CLI reveal
- Kamerafahrt ueber Karten/Panels (Zoom-out + Prisma-Drehung) - camera move, perspective pan, 3D card wall
- Foto-/Asset-Wand, die zu EINEM Motiv kollabiert - collage collapse, hero card
- Pitch-/Konferenz-Loop auf grossem Bildschirm - kiosk loop, event screen

## Anatomie & Zeitleiste
Alles ist eine reine Funktion `render(v)` der Videozeit v (Sekunden). Schichten: Buehne -> Kamera-Rig (perspective 1200) -> Panel A (Raster, weisses `lit`, Satzzeile, Foto-Karten) -> Panel B (Ring-Kacheln, Titel) -> HUD-Zeile -> schwarzer Schleier (Loop-Schnitt).

| Zeit v (s) | Phase |
|---|---|
| 0.10-0.41 | Panel + Text blenden (fast linear) aus Schwarz ein |
| 0.17-0.55 | Outline-Quadrat blendet ein, dreht 18.5 deg/s, driftet leicht |
| 0.34 + n*0.40 | Foto-Slot in der Satzzeile wechselt alle 0.4 s (walker -> rays -> portrait), Crossfade 0.14 s |
| 1.42 | kleiner Zeiger-Pfeil erscheint |
| 1.37-1.9 | Kamera: Zoom-out 1.0 -> 0.62 (k 5.5/s), Schwenk nach links (tx -379, k 6.6), Prisma-Drehung rotY -36.7 deg (k 8.5) |
| 1.52-1.68 | Satzzeile blendet aus |
| 1.58-2.58 | 13 Foto-Karten fliegen von links ein (flyK 8.5, 260 px), je ~60 ms versetzt |
| 2.02 -> | Panel B fliegt von rechts ein (x 1228 -> 628, kritisch gedaempft omega 7.3) |
| 2.94-3.0 | Karten kollabieren (0.38 s), Hero-Karte gleitet gross nach links, anfangs unscharf (5.5 px) und schaerft ab 3.18 s |
| 3.0-3.52 | Panel A wird linear weiss (#e4e6e7), Verlauf von links |
| 4.02-5.15 | ganze Szene sinkt nach unten (+111 px, exponentiell beschleunigt, harter Stopp) |
| 4.24-4.94 | HUD `npx shadcn add @snapcn`: Opacity easeOutQuad, Versatz 38 px exp., Blur 14 -> 0 |
| 6.65 | harter Schnitt auf Schwarz, Loop |

## Motion-Tokens
- Glaettung durchgehend exponentiell: `wert = ziel * (1 - exp(-k * (v - t0)))`; k: Zoom 5.48, Schwenk 6.58, Drehung 8.48, Ty 18.9, Karten-Flug 8.5, Hero 6, Ring-Blur 5.
- Panel B: kritisch gedaempfte Feder (omega 7.3, kein Overshoot) - Video zeigt keinen sichtbaren Ueberschwinger.
- Linear: Intro-Fade 0.31 s, weisse Leinwand 0.52 s, Quadrat-Drehung.
- Ring-Kacheln kreisen gegen den Uhrzeigersinn (Ringe r 490/300/215/130, Kacheln 16-104 px).
- Alle Werte im `PRODUCT_LAUNCH_HERO_CONFIG`-Block (JS, oben) und den Tabellen `PLH_CARDS`, `PLH_HERO`, `PLH_RINGS`.

## Look-Tokens (CSS-Variablen `--plh-*`)
- Seite `#010101`, Buehne `#020202`, Panel A `#070909` mit Punktraster (24 px, Punkt rgba(255,255,255,.085))
- Panel-Radius 28 px, Ring-Kachel 20 px, Foto-Karten 3 px; Leinwand-Weiss `#e4e6e7`
- Text `#f5f5f5` (30 px, "out AI." leiser), HUD weiss 34 px, Panel-B-Titel 66 px mit Verlauf `#ececec -> #6a6a6a`, Untertitel `#5e5e5e`, "Explore"-Pille `#262626` / `#8a8a8a`
- Font: Inter, Geist, ui-sans-serif, system-ui; Fotos sind prozedurale Inline-SVG-Verlaeufe (keine Bilddateien)

## Interaktion & Barrierefreiheit
- Autoplay-Loop. Klick/Tap auf die Buehne = Pause/Weiter; Leertaste = Pause/Play; Pfeil links/rechts = Spulen. Pointer-Events (Maus + Touch), `touch-action: manipulation`.
- `role`/`aria-label` an der Buehne, Fokusring; Deko-Ebenen `aria-hidden`.
- `prefers-reduced-motion`: Loop haelt auf dem Endbild (Panel A weiss + B + HUD) statt zu animieren.

## 120 Hz
- Zeitbasiert: eine rAF-Schleife akkumuliert v aus dem Zeitstempel (dt <= 50 ms), `render(v)` ist zustandslos; kein Frame-Zaehler, kein setInterval.
- Nur `transform`, `opacity`, `filter` pro Frame, Schreibzugriffe nur bei Wertaenderung; Layout nur bei Init/Resize (Cache), `contain: layout paint style`.
- check120: `VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine`; ohne Drosselung p95 4.7 ms, 4x: p95 10.4 ms, p50 3.1 ms, Skript 0.29 ms/Frame, 0 Layouts/Frame.
- Verbleibende WARN (style.left/top/width/height): nur einmalig in Init/Resize beim Platzieren der Karten/Kacheln, nie pro Frame - unkritisch.

## Einbindung
```html
<!-- COMPONENT:START ... COMPONENT:END aus assets/product-launch-hero.html kopieren, plus CSS-Block und JS -->
<script>
  const hero = initProductLaunchHero(document.querySelector('.plh'),
    { duration: 6.65, loop: true, autoplay: true, speed: 1 });
  // hero.play() / pause() / toggle() / seek(sec) / time() / destroy()
</script>
```
Optionen flach ueberschreiben das CONFIG: `duration`, `loop`, `autoplay`, `speed`. Feintuning ueber CONFIG/CSS-Variablen.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich ein `useTime`/`useTransform`-Storyboard oder Timeline mit Kamera-Wrapper (`perspective`), Karten per `motion.div`:
```tsx
const cam = useSpring(0, { stiffness: 90, damping: 16 });   // ~k 5-8 / s, kritisch gedaempft
<motion.div style={{ scale: s, x: tx, rotateY: rot, transformPerspective: 1200 }}>
<motion.div initial={{ x: -260, opacity: 0 }} animate={{ x: 0, opacity: 1 }}
  transition={{ type: "spring", stiffness: 140, damping: 20, delay: i * 0.06 }} />
<motion.span initial={{ opacity: 0, y: 38, filter: "blur(14px)" }}
  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.7, ease: "easeOut" }} />
```
(Vermutung, nicht belegt.)

## Kreativ remixen
1. **Produkt-Trailer pro Release:** Foto-Slot durch App-Screens/Logos ersetzen, Befehlszeile durch Changelog-Zeile - jede Version bekommt ihren Mini-Film.
2. **Herzrasen-Kamera:** `cam.s.to` 0.62 -> 0.35, `rot.to` -36 -> -70, k verdoppeln; zusaetzlich Kamera-Roll und leichter Handheld-Wackler (sin-Rauschen auf tx/ty).
3. **Ring-Galaxie:** mehr Ringe (6-8), gegenlaeufige Drehrichtung, Kachelgroesse mit der Distanz skalieren, Parallax mit Zeigerposition.
4. **Scroll-gesteuert:** `v` aus dem Scroll-Fortschritt statt aus der Uhr (Funktion `seek`) - Scrollytelling mit Rueckwaertslauf.
5. **Lichtwechsel:** Weiss-Leinwand-Moment mit Flash/Bloom und Sound-Tick; Hero-Karte per Spring mit Overshoot landen lassen und HUD zeichenweise tippen.

## Bekannte Abweichungen (ehrlich)
- Die Foto-Motive sind Naehe-Nachbauten aus SVG-Verlaeufen (Silhouetten, Farbstreifen), nicht die Originalfotos; Kacheln der Ringe sind stilisierte Materialien (Gras, Holz, Himmel) - im Vergleichsbild sichtbar anders.
- Kamera-Verlauf, Kartenpositionen und Panel-B-Einflug sind per Fit an die Videoframes gemessen (Struktur und Timing gut, einzelne Karten-Rotationen/Positionen weichen um einige px ab).
- Kachelgroessen/Ring-Phasen in Panel B nur grob rekonstruiert; Titel-Abschnitt am rechten Rand (Text "universe") ist im Video abgeschnitten, ebenso im Nachbau.
- Hintergrundmusik/Schaltflaechen der 21st-Seite (Player-Leiste) gehoeren nicht zur Komponente.
- Zeigerpfeil und Timing des Loop-Schnitts bei 6.65 s sind aus 6-s-Videoausschnitt abgeleitet; Verhalten nach Loopende nicht erkennbar.
