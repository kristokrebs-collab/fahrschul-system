# Notched Project Card (notched-project-card)
> Drei Projekt-Karten mit Foto in Graustufen und einer runden Kerbe unten rechts; beim Hover blendet das Foto in Farbe und der Pfeil-Kreis in der Kerbe wird dunkelrot.

## Wann einsetzen
- Portfolio-/Case-Study-Raster, Projektlisten, "Selected Work" (Foto + Jahr + Titel + Tags)
- Team-, Blog-, News-, Event- oder Immobilien-Karten, die erst ruhig (s/w) und beim Anvisieren lebendig wirken sollen
- Logo-Wand / Kunden-Wand (grau -> farbig) und alles mit "ein Akzent zeigt: hier ist der Link"
- Karten mit einem klaren Ziel-Link: der Pfeil in der Kerbe ist die Aufforderung
- Dunkle Seiten (#131313), editoriales Gefuehl, kurze Texte, wenig Chrome
- EN: portfolio grid, case studies, team/blog cards, grayscale-to-color hover, notched / cut-out corner card

## Anatomie & Zeitleiste
Aufbau je Karte: Foto (4:3, Radius 28, **unten rechts ausgeschnitten**) + Jahres-Pille oben mittig + Kerbe + Pfeil-Kreis + Titel + Text + Tags.
Die Kerbe ist ein Rechteck 82x83 (Innenradius 50) in `#1f1f1f`; an ihren zwei Enden laufen **konkave "Ohren"** (Radius 28) in die Foto-Kante - dadurch wirkt das Foto wie weich ausgeschnitten.

| Zeit (ms) | Phase | Was passiert |
|---|---|---|
| 0 | Ruhe | Foto `grayscale(1)`, Kreis `#1d1d1d`, Pfeil in Ruhelage |
| 0 (Zeiger betritt Karte, auch Text/Tags) | Hover-Start | kein Delay, beide Uebergaenge starten gleichzeitig |
| 0 -> 400 | Foto Farbe | `grayscale 1 -> 0`, ease; 50% bei ~110 ms, 90% bei ~250 ms |
| 0 -> 300 | Kreis rot | `#1d1d1d -> #520000`, Kurve (.4,0,.2,1); 50% bei ~100 ms |
| 0 -> 300 | Pfeil | `translate(2px,-2px)` (rutscht Richtung Ecke) |
| Zeiger verlaesst Karte | Hover-Ende | exakt rueckwaerts, gleiche Dauern (400/300 ms) |
| Kartenwechsel | Ueberblendung | Karte A faerbt aus, Karte B ein, gleichzeitig (keine Sequenz) |

Im Video: Karte 3 @0.6 s -> Karte 2 @1.3 -> Karte 1 @2.25 -> Karte 2 @3.3 -> Karte 3 @4.3 -> raus @5.3 (je ~1 s Hover).
Keine Skalierung, kein Blur, kein Stagger, keine Federung - Foto wechselt nur den Farbfilter.

## Motion-Tokens
| Token | Wert |
|---|---|
| `--npc-dur-gray` / `--npc-ease-gray` | 400ms / `cubic-bezier(.25,.1,.25,1)` (= CSS `ease`) |
| `--npc-dur-btn` / `--npc-ease-btn` | 300ms / `cubic-bezier(.4,0,.2,1)` (Tailwind-Standard) |
| `--npc-icon-shift` | 2px (x +, y -) |
| Foto-Filter | `--npc-img-rest: grayscale(1)` -> `--npc-img-hover: grayscale(0)` |
Gefittet an die Video-Kurven (RMSE ~2%): Foto passt am besten zu `ease` 400ms, Kreis zu (.4,0,.2,1) 300-350ms.

## Look-Tokens
- Farben: Buehne `#131313`, Kerbe `#1f1f1f`, Kreis Ruhe `#1d1d1d`, Kreis Hover `#520000`, Icon `rgba(255,255,255,.66)`, Titel `#e5e5e5`, Text `#a3a3a3`, Tag-Bg `#1d1d1d`, Tag-Text `#cfcfcf`, Jahres-Pille `rgba(46,46,46,.86)` + `blur(8px)`
- Geometrie (Referenz 1234x673): Karte 350 breit, Foto 4:3 (350x262.5), Abstand 32, Seitenrand 60, Inhalt mittig; Radius 28; Kerbe 82x83, r50, Ohren r28; Kreis ~69px, buendig und ~1.5px ueber Kartenkante hinausragend
- Typo (Roboto-artig im Video, Stack Inter/Geist/Roboto): Titel 24px/30 weight 500 tracking -0.02em; Text 15px/23; Tags 11px/17 weight 500 uppercase, Padding 3x8, Radius 8, Gap 8; Jahr 12px, Pille 26px hoch, 16px vom Fotorand
- Abstaende: Foto -> Titel 20, Titel -> Text 11, Text -> Tags 16
- Icon: Lucide `arrow-up-right`, 20px, stroke 2

## Interaktion & Barrierefreiheit
- Ausloeser: **Maus-Hover ueber die ganze Karte** (Foto, Text, Tags, Kerbe) - im Video ein sichtbarer Maus-Zeiger, kein Drag
- Karte ist ein `<a>`; Tastatur-Fokus (`:focus-visible`) zeigt denselben Zustand + Fokusring ums Foto
- Touch: erster Tap = Farb-Vorschau (`.is-active`), zweiter Tap folgt dem Link; Tap daneben loest alles (`touchPreview:false` schaltet das aus)
- `@media (hover:hover)` kapselt `:hover`, damit Touch nicht "klebt"
- `prefers-reduced-motion`: Uebergaenge 0.01ms (Zustand wechselt, aber ohne Animation)
- Kerbe/Kreis/Icon sind `aria-hidden`; Fotos brauchen sinnvolles `alt`

## Einbindung (assets/notched-project-card.html)
- Markup/CSS zwischen `<!-- COMPONENT:START/END -->` bzw. `/* COMPONENT CSS */` kopieren; Look/Motion nur ueber `:root`-Variablen (`--npc-*`) oben
- `initNotchedProjectCard(root, opts)` -> `{cards, activate(i|null), destroy()}`
  - `items: [{year,title,text,tags:[..],img,alt,href,iconSvg}]` rendert die Karten selbst (HTML-escaped), `root` darf leer sein
  - `touchPreview` (true), `exclusive` (true), `vars: {'--npc-dur-gray':'700ms'}` (Overrides nur fuer dieses root), `onActivate(card,i)`
- Hover braucht kein JS (reines CSS); das JS ist nur Touch-Vorschau + Rendering
- Demo-Fotos sind winzige eingebettete Platzhalter (210x158) - echte Bilder per `<img src>` einsetzen (4:3, mind. 700px breit)

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich React + Tailwind, **ohne Framer-Motion-Spring** (nur CSS-Transitions via `group-hover`):
```tsx
<a className="group block">
  <div className="relative aspect-[4/3] [clip-path/mask: notch]">
    <img className="size-full object-cover grayscale transition-[filter] duration-[400ms] ease group-hover:grayscale-0" />
    <span className="absolute -bottom-0.5 -right-0.5 grid size-[69px] place-items-center rounded-full bg-[#1d1d1d]
      transition-colors duration-300 group-hover:bg-[#520000]">
      <ArrowUpRight className="size-5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </span>
  </div>
</a>
```
Mit Framer Motion wuerde es gleichwertig: `whileHover={{ filter:"grayscale(0)" }} transition={{ duration:.4, ease:[.25,.1,.25,1] }}`. Spring waere hier falsch (kein Overshoot im Video).

## Kreativ remixen
1. **Spotlight-Wave**: Farbe haengt an der Zeigernaehe statt am Hover (`--p` = 1 - Distanz/Radius pro Karte per `pointermove`) - beim Wischen ueber das Raster laeuft eine Farbwelle durch alle Karten.
2. **Herzrasen-Kreis**: Kreis mit Spring-Overshoot (scale .6 -> 1.12 -> 1, stiffness 500 / damping 18), Pfeil dreht 45 Grad "ab", `#520000` -> Neon `#ff2a2a` + `box-shadow: 0 0 40px rgba(255,42,42,.6)`.
3. **Kerbe waechst**: per `@property` `--npc-notch-w/h` 82 -> 150 animieren, im Tab erscheint ein Label ("Open project") - die Kerbe wird zum Button.
4. **Fokus-Zug**: `.npc-grid:has(.npc:hover) .npc:not(:hover){opacity:.45; scale:.97}` - Geschwister treten zurueck, der Hover-Treffer bekommt Sog.
5. **Kombi**: Foto-Zoom 1.06 + 3D-Tilt (+-4 Grad nach Zeiger) + Farb-Wipe als Radial-Maske ab Zeigerposition (Taschenlampe) - auch fuer Pricing-Tiers, Team-Seiten, Logo-Walls, Video-Karten (Autoplay erst bei Farbe).

## Bekannte Abweichungen (ehrlich)
- **Fotos sind Platzhalter**: aus dem Video extrahierte, auf 210x158 verkleinerte JPEGs (Kerbe/Pille wegretuschiert) - weicher als die Originalfotos; Originalbilder lagen nicht vor
- Schrift: im Video Roboto-artig (Android-Fallback), hier Inter/Geist/Roboto-Stack; Breiten/Umbrueche und Weights koennen je nach Schrift um 1-3% und 1px vertikal abweichen
- Farben sind aus einer komprimierten Bildschirmaufnahme gemessen (+-2 Stufen); die Buehne wirkt insgesamt gedimmt, echte Design-Tokens (z.B. weiss/90%) sind unbekannt
- Jahres-Pille (Alpha/Blur), Kreisdurchmesser (68-70px) und Ohr-Radius (+-2px) sind geschaetzt; Kreis beginnt im Video evtl. ~20 ms vor dem Foto (nicht uebernommen)
- Nicht im Video erkennbar: `:active`-Zustand, Klick-Ziel, Eingangs-/Scroll-Animation, Touch-Verhalten des Originals, Hover direkt auf dem Pfeil-Kreis (sah gleich aus)
- Replica-Video (VP8, 25 fps) glaettet Farbuebergaenge; Timing wurde deshalb numerisch gegen die Video-Kurven gefittet, nicht per Pixelvergleich
