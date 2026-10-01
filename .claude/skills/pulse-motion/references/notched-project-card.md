# Notched Project Card (notched-project-card)
> Drei Projekt-Karten mit Foto in Graustufen und runder Kerbe unten rechts; beim Hover blendet das Foto in Farbe und der Pfeil-Kreis in der Kerbe wird dunkelrot.

## Wann einsetzen
- Portfolio-/Case-Study-Raster, Projektlisten, "Selected Work" (Foto + Jahr + Titel + Tags)
- Team-, Blog-, News-, Event- oder Immobilien-Karten, die erst ruhig (s/w) und beim Anvisieren lebendig wirken sollen
- Logo-/Kunden-Wand (grau -> farbig), alles mit "ein Akzent zeigt: hier ist der Link"
- Karten mit einem klaren Ziel-Link: der Pfeil in der Kerbe ist die Aufforderung
- Dunkle Seiten (#131313), editoriales Gefuehl, kurze Texte, wenig Chrome
- EN: portfolio grid, case studies, team/blog cards, grayscale-to-color hover, notched / cut-out corner card

## Anatomie & Zeitleiste
Je Karte: Foto (4:3, Radius 28, **unten rechts ausgeschnitten**) + Jahres-Pille oben mittig + Kerbe + Pfeil-Kreis + Titel + Text + Tags.
Kerbe = Rechteck 82x83 (Innenradius 50) in `#1f1f1f`; an den zwei Enden laufen **konkave "Ohren"** (r 28) in die Foto-Kante.

| Zeit (ms) | Phase | Was passiert |
|---|---|---|
| 0 | Ruhe | Foto `grayscale(1)`, Kreis `#1d1d1d`, Pfeil in Ruhelage |
| 0 (Zeiger betritt Karte, auch Text/Tags) | Hover-Start | kein Delay, beide Uebergaenge starten gleichzeitig |
| 0 -> 400 | Foto Farbe | `grayscale 1 -> 0`, `ease`; 50% bei ~110 ms, 90% bei ~250 ms |
| 0 -> 300 | Kreis rot | `#1d1d1d -> #520000`, (.4,0,.2,1); 5% bei 10 ms, 50% bei ~85 ms, 85% bei ~125 ms, fertig ~255 ms |
| 0 -> 300 | Pfeil | `translate(2px,-2px)` (rutscht Richtung Ecke) |
| Zeiger verlaesst Karte | Hover-Ende | exakt rueckwaerts, gleiche Dauern (400/300 ms) |
| Kartenwechsel | Ueberblendung | Karte A faerbt aus, Karte B ein, gleichzeitig (keine Sequenz) |

Video (echte Frame-Zeiten): Zeiger auf Karte 3 @0.57 s -> 2 @1.30 -> 1 @2.22 -> 2 @3.30 -> 3 @4.29 -> raus @5.27 (je ~1 s Hover).
Keine Skalierung, kein Blur, kein Stagger, keine Feder - nur Farbfilter + Kreisfarbe + 2px-Versatz.

## Motion-Tokens
| Token | Wert |
|---|---|
| `--npc-dur-gray` / `--npc-ease-gray` | 400ms / `cubic-bezier(.25,.1,.25,1)` (= CSS `ease`) |
| `--npc-dur-btn` / `--npc-ease-btn` | 300ms / `cubic-bezier(.4,0,.2,1)` (Tailwind-Standard) |
| `--npc-icon-shift` | 2px (x +, y -) |
| Foto-Filter | `--npc-img-rest: grayscale(1)` -> `--npc-img-hover: grayscale(0)` |
Fit gegen ~713 echte Video-Frames (RMSE): Kreis (.4,0,.2,1)/300ms 2.7%; Foto `ease`/400ms 1.9% (gleichwertig: (.4,0,.2,1)/500ms 2.0% - nicht unterscheidbar).

## Look-Tokens
- Farben: Buehne `#131313`, Kerbe `#1f1f1f`, Kreis Ruhe `#1d1d1d`, Kreis Hover `#520000`, Icon `rgba(255,255,255,.66)`, Titel `#e5e5e5`, Text `#a3a3a3`, Tag-Bg `#1d1d1d`, Tag-Text `#cfcfcf`, Pille `rgba(46,46,46,.86)` + `blur(8px)`
- Geometrie (Referenz 1234x673): Karte 350 breit, Foto 4:3 (350x262.5), Abstand 32, Seitenrand 60, mittig; Radius 28; Kerbe 82x83, r50, Ohren r28; Kreis 69px, ~1.5px ueber der Kartenkante
- Typo (im Video Roboto-artig; Stack Inter/Geist/Roboto): Titel 24/30 w500 tracking -0.02em; Text 15/23; Tags 11/17 w500 uppercase, Padding 3x8, r8, Gap 8; Jahr 12px, Pille 26px hoch, 16px vom Fotorand
- Abstaende: Foto -> Titel 20, Titel -> Text 11, Text -> Tags 16; Icon Lucide `arrow-up-right` 20px, stroke 2

## Interaktion & Barrierefreiheit
- Ausloeser: **Maus-Hover ueber die ganze Karte** (Foto, Text, Tags, Kerbe); im Video sichtbarer Maus-Zeiger, kein Drag/Tap
- Karte ist ein `<a>`; `:focus-visible` zeigt denselben Zustand + Fokusring ums Foto
- Touch: 1. Tap = Farb-Vorschau (`.is-active`), 2. Tap folgt dem Link, Tap daneben loest (`touchPreview:false` schaltet aus); getestet
- `@media (hover:hover)` kapselt `:hover`, damit Touch nicht "klebt"
- `prefers-reduced-motion`: Dauer 0.01ms (Zustand wechselt, ohne Animation)
- Kerbe/Kreis/Icon `aria-hidden`; Fotos brauchen sinnvolles `alt`

## 120 Hz
- **Reines CSS, kein JS-Takt**: Uebergaenge laufen im Compositor und folgen automatisch der Display-Rate (60/120/144/240 Hz), kein rAF/setInterval, kein 16.67-ms-Wert im Code.
- Nur compositor-faehige Eigenschaften: `filter` (Foto), `opacity` (rote Kreis-Scheibe), `transform: translate3d` (Pfeil). Kreisfarbe bewusst NICHT per `background-color` (Main-Thread-Paint), sondern als Deckkraft einer roten Scheibe ueber `#1d1d1d` - identische Optik (lineare sRGB-Mischung), ~25% weniger CPU je aktivem Frame im Test.
- Kein `transition: all`, keine Layout-Eigenschaften, keine Layout-Lesezugriffe; `contain: layout style` an der Karte, `contain: layout paint` am Textblock (Paint-Containment an der Karte bewusst nicht: Kreis ragt 1.5px raus). `will-change` bewusst weggelassen (keine dauerhaften Ebenen; Chrome hebt laufende Transitions selbst auf Ebenen). Einzige Blur-Flaeche: Jahres-Pille (~50x26 px).
- **check120 Stress-Choreografie** (Zeiger wischt alle 200 ms ueber Karten 3-2-1-2-3, 2-3 Uebergaenge dauernd aktiv): `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine`; 4x CPU: p50 1.3 / p95 3.0 / p99 6.2 ms, 0.2% der Frames > 10.4 ms (nur Start-Frame/Bilddekodierung); ohne Drosselung p95 0.7 ms.
- **check120 mit Video-Choreografie** (1 s Ruhe je Karte): Verdikt `ZU LANGSAM` (p95 17.4 ms) - **Messartefakt**: Leerlauf-Frames (nichts animiert) laufen im Headless-Chromium mit 60-Hz-Takt (gleiches Ergebnis fuer eine leere statische Seite mit nur einem Gradient-div); die Ruhephasen machen bei 4x Drosselung ~12% der Frames aus. Nur in den Uebergangsfenstern (je 420 ms ab Hover-Wechsel, 4x CPU): p50 1.3 / p95 3.5 / p99 11.4 ms, 98.9% der Frames < 8.33 ms; 6x CPU: p95 7.6 ms.
- Offen: echte 120-Hz-Hardware nicht verfuegbar (Headless, Software-Raster); GPU-Raster auf dem Tablet ist guenstiger als diese Messung.

## Einbindung (assets/notched-project-card.html)
- Markup/CSS zwischen `<!-- COMPONENT:START/END -->` bzw. `/* COMPONENT CSS */` kopieren; Look/Motion nur ueber `:root`-Variablen (`--npc-*`) oben
- `initNotchedProjectCard(root, opts)` -> `{cards, activate(i|null), destroy()}`
  - `items: [{year,title,text,tags:[..],img,alt,href,iconSvg}]` rendert die Karten selbst (HTML-escaped), `root` darf leer sein
  - `touchPreview` (true), `exclusive` (true), `vars: {'--npc-dur-gray':'700ms'}` (Overrides nur fuer dieses root), `onActivate(card,i)`
- Hover braucht kein JS; das JS ist nur Touch-Vorschau + Rendering. Demo-Fotos sind 210x158-Platzhalter - echte Bilder (4:3, >= 700px breit) per `<img src>`.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich React + Tailwind, **ohne Feder** (CSS-Transitions via `group-hover`):
```tsx
<a className="group block">
  <div className="relative aspect-[4/3] [mask: notch]">
    <img className="size-full object-cover grayscale transition-[filter] duration-[400ms] ease group-hover:grayscale-0" />
    <span className="absolute -bottom-0.5 -right-0.5 grid size-[69px] place-items-center rounded-full bg-[#1d1d1d]
      transition-colors duration-300 group-hover:bg-[#520000]">
      <ArrowUpRight className="size-5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </span>
  </div>
</a>
```
Framer-Motion-aequivalent: `whileHover={{ filter:"grayscale(0)" }} transition={{ duration:.4, ease:[.25,.1,.25,1] }}`. Feder waere falsch (kein Overshoot im Video).

## Kreativ remixen
1. **Spotlight-Wave**: Farbe haengt an der Zeigernaehe (`--p` = 1 - Distanz/Radius je Karte, pointermove -> 1x rAF) - beim Wischen laeuft eine Farbwelle durchs Raster.
2. **Herzrasen-Kreis**: Kreis mit Spring-Overshoot (scale .6 -> 1.12 -> 1, stiffness 500 / damping 18), Pfeil dreht 45 Grad ab, `#520000` -> Neon `#ff2a2a` + `box-shadow: 0 0 40px rgba(255,42,42,.6)`.
3. **Kerbe waechst**: per `@property` `--npc-notch-w/h` 82 -> 150, ein Label ("Open project") erscheint - die Kerbe wird zum Button.
4. **Fokus-Zug**: `.npc-grid:has(.npc:hover) .npc:not(:hover){opacity:.45; scale:.97}` - Geschwister treten zurueck.
5. **Kombi**: Foto-Zoom 1.06 + 3D-Tilt (+-4 Grad) + Farb-Wipe als Radial-Maske ab Zeigerposition (Taschenlampe) - auch fuer Pricing-Tiers, Team-Seiten, Video-Karten (Autoplay erst bei Farbe).

## Bekannte Abweichungen (ehrlich)
- **Fotos sind Platzhalter**: aus dem Video extrahierte, auf 210x158 verkleinerte JPEGs (Kerbe/Pille retuschiert), weicher als die Originale; Saettigung um 11% angehoben, damit die Hover-Farbe dem Video entspricht (SATAVG Video 7.4/6.1/2.8, Nachbau jetzt gleich)
- Schrift: Video Roboto-artig, hier Inter/Geist/Roboto-Stack; Umbrueche/Weights koennen um 1-3% bzw. 1px vertikal abweichen (Sandbox hat keine dieser Schriften)
- Farben aus komprimierter Aufnahme gemessen (+-2 Stufen); Pille (Alpha/Blur), Kreisdurchmesser (68-70px), Ohr-Radius (+-2px) geschaetzt
- Kreis leicht anders gerendert: Deckkraft-Scheibe statt Farb-Transition (optisch gleich; Kantenpixel minimal dunkler moeglich)
- Nicht im Video erkennbar: `:active`, Klick-Ziel, Eingangs-/Scroll-Animation, Touch-Verhalten des Originals, Hover direkt auf dem Pfeil-Kreis
- Verifikation: Replica-Aufnahme (VP8, 25 fps) lief wegen Rekorder-Last bis ~0.25 s verzoegert; Timing deshalb numerisch gegen die echten Video-Frames gefittet statt per Pixelvergleich
