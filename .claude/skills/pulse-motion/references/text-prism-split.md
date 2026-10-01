# Text Prism Split (text-prism-split)

> Ein Wort in Fliesstext-Groesse, ueber dem ein schwarzes, weich gerandetes Linsenfenster federnd dem Zeiger folgt; darin ist der Text 6% groesser, 5px hoeher und zerfaellt bei Nachlauf in drei Farb-Kopien (lachsrot / gruen / lavendel), die in der Ruhe wieder zu reinem Weiss verschmelzen.

Quelle: 21st.dev-Vorschau "Text Prism Split" (Text "REFRACTION"), rekonstruiert aus einer Bildschirmaufnahme. Datei: `assets/text-prism-split.html`.

## Wann einsetzen
- Hero-Headline / Markenname / Portfolio-Name auf dunklem Grund (Wow beim ersten Hover) - hero title, brand word
- 404-, Splash- oder Loader-Seite mit einem einzelnen grossen Wort - single-word splash
- Nav-Eintrag oder Produktname als "Lupe" mit Glitch-Charakter - hover lens, glitch reveal
- Teaser, bei dem eine Linse Teile eines Titels "scannt" (auch per Scroll/Auto-Sweep) - scanner, scroll scrub
- Kreativ-/Tech-/Musik-/Gaming-Seiten, chromatische Aberration gewuenscht - RGB split, prism, refraction

## Anatomie & Zeitleiste
Aufbau: Basistext (`#fafafa`) + absolut positionierte Linse (120x50px, Hoehe = Zeilenbox) mit 3 gestapelten Text-Ebenen (`mix-blend-mode: screen`).
Referenz-Viewport 1234x673, Schrift 48px; Wort 288x50px mittig (x 473-761, y 311-361).

| Phase | Ausloeser | Dauer / Verhalten |
|---|---|---|
| Ruhe | kein Zeiger im Text | Linse ruht in der Textmitte (Mitte x=617), alle 3 Ebenen weiss, kein Split; keine Idle-Animation sichtbar |
| Eintritt | Zeiger betritt die Textbox (nur die Box; Zeiger 20px darunter = nichts) | Linse springt federnd zur Zeiger-x; Split setzt im selben Frame ein (Nachlauf 50-100px => Versatz bis ~30px) |
| Folgen | Zeiger bewegt sich im Text | Linsenmitte = Zeiger-x mit Federnachlauf (~0.2s); Linse darf ueber das Textende hinausragen (kein Clamp) |
| Split-Ausklang | Nachlauf schrumpft | Farb-Staerke und Versatz ~ Nachlauf, Abklingen mit tau ~40ms; bei Nachlauf ~0 wieder Weiss |
| Austritt | Zeiger verlaesst die Textbox | gleiche Feder zurueck zur Mitte: 100px in ~190ms auf <3px, ~230ms bis ruhig, ~1.5% Overshoot, dabei kurzer Split |

## Motion-Tokens
| Token | Wert | Anmerkung |
|---|---|---|
| spring | stiffness 350, damping 30, mass 1 | zeta ~0.8, Fit an die Rueckkehr-Kurven (Fehler ~3px); Linsenmitte folgt Zeiger-x |
| split.gain | 0.4 px je px Nachlauf | Ebenen-Versatz d: lachsrot -d, gruen 0, lavendel +d (Bewegungsrichtung vorn) |
| split.max | 40px | bei sehr schnellen Zuegen Anschlag |
| split.full | 16px Nachlauf | ab hier volle Einfaerbung, darunter anteilig (Weiss -> Farbe) |
| split.release | 40ms | Einsatz sofort, Abklingen exponentiell |
| Linsen-Inhalt | scale 1.06 um Linsenmitte, translateY -5px (-0.105em) | Text bleibt exakt an Seitenkoordinaten verankert (nur vergroessert) |

## Look-Tokens
| Token | Wert |
|---|---|
| Buehne | `#1f1f1f` (flach, kein Verlauf) |
| Text | `#fafafa`, 48px, Gewicht 600, Laufweite -0.05em, Zeilenhoehe 1.04 (=50px), Font Inter/Roboto-artig |
| Linse | 2.5em breit (120px), volle Zeilenhoehe (50px, oben scharf, unten scharf), Hintergrund `#050505`, Rand links/rechts weich 0.25em (12px, Mask-Gradient), kein Radius, kein Schatten |
| Text in Linse | `#ffffff` in Ruhe; Farb-Ebenen: `#ff8080` (lachsrot), `#00ff00` (gruen), `#ccccff` (lavendel) |
| Mischfarben (gemessen) | lachsrot+gruen = gelb `(255,255,128)`, gruen+lavendel = hellcyan, lachsrot+lavendel = rosa-weiss, alle drei = Weiss |
| Hinweis | In Ruhe sind die Linsen-Stege ~0.4px dicker als aussen (drei weisse Ebenen gestapelt) - bewusst nachgebaut |

## Interaktion & Barrierefreiheit
- Im Video: Mauszeiger (Pfeil) => Hover. Umgesetzt mit Pointer Events (Maus/Stift/Touch): `pointerenter/move/leave`; Touch = Finger ziehen (`touch-action: pan-y`), Loslassen => Linse zurueck zur Mitte (Erweiterung, im Video nicht zu sehen).
- Tastatur: Element ist fokussierbar (`keyboard: true`), Pfeile links/rechts schieben die Linse (10% je Schritt), Home/End, Esc/Blur => Mitte.
- Basistext ist echter Text (Screenreader/Kopieren); Linse + Ebenen sind `aria-hidden`, `user-select: none`, `pointer-events: none`.
- `prefers-reduced-motion`: Linse folgt ohne Feder (springt), kein RGB-Split, Ebenen bleiben weiss.

## Einbindung (assets/text-prism-split.html)
- Kopiere `/* COMPONENT CSS */`, `/* COMPONENT JS */` und das Markup `<h1 class="tps" data-tps>WORT</h1>`; Look per `--tps-*` Variablen im `:root`-CONFIG, Motion im `TEXT_PRISM_SPLIT_CONFIG`.
- `initTextPrismSplit(root, opts) -> { setPosition(frac|null), destroy() }`; `root` = Element mit Klartext (wird intern umgebaut).
- opts (alle optional, tief gemerged): `restAt` 0.5, `spring {stiffness, damping, mass}`, `split {gain, max, full, release}`, `keyboardStep`, `keyboard`, `magnify` (sonst `--tps-magnify`), `lift` (em, sonst `--tps-lift`).
- Alles in `em` => Schriftgroesse per `--tps-size` ueberall skalieren; mehrere Instanzen = je Element ein `init`-Aufruf.
- `setPosition(0..1)` faehrt die Linse programmatisch (Auto-Sweep, Scroll-Scrub, Audio); `null` = Ruhe.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich React + Tailwind + framer-motion: `useMotionValue` fuer Zeiger-x, `useSpring` fuer die Linse, Split aus der Differenz Ziel - Feder.
```tsx
const target = useMotionValue(0);
const lens = useSpring(target, { stiffness: 350, damping: 30, mass: 1 });
const lag = useTransform([target, lens], ([t, l]) => t - l);          // -> Versatz d = lag*0.4 (clamp 40)
// onPointerMove: target.set(e.clientX - rect.left)  | onPointerLeave: target.set(width / 2)
<motion.span style={{ x: lensLeft }} className="absolute inset-y-0 w-[2.5em] overflow-hidden bg-[#050505]
  [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
  {tints.map((c, i) => <motion.span key={i} className="absolute mix-blend-screen"
     style={{ color: mixWhite(c, a), x: textX + offs[i], y: -5, scale: 1.06 }}>REFRACTION</motion.span>)}
</motion.span>
```

## Kreativ remixen
1. Auto-Scan fuer Touch/Mobile: `setPosition(0.5 + 0.45*Math.sin(t*1.4))` per rAF als Idle-Sweep, bei Pointer-Eintritt uebernimmt der Nutzer - der Effekt lebt auch ohne Hover.
2. Hochdrehen: `--tps-lens-w: 6em`, `--tps-magnify: 1.35`, `--tps-lift: -0.25em`, `split {gain: 1.2, max: 120, release: 0.12}` + `stiffness: 160, damping: 12` => schmieriger Mega-Glitch mit Overshoot.
3. Lens-Inhalt tauschen: Linsen-Ebenen zeigen ein anderes Wort ("REFRACTION" -> "DISCOVER") oder ein Bild/Video im Linsenfenster: Geheimbotschaft/Reveal-Lupe ueber Hero-Titeln.
4. Mehrzeilig/mehrfach: eine Liste (Menue, Preise, Team-Namen) mit einer gemeinsamen Zeiger-x-Quelle - die Linse "wandert" ueber alle Zeilen gleichzeitig; oder vertikale Variante (Achse y) fuer Spalten.
5. Audio/Scroll-getrieben: Linsenposition = Scroll-Fortschritt oder Bass-Pegel (Web Audio), `gain` hoch + `navigator.vibrate(8)` beim Buchstabenwechsel - Loader, Musik-Landingpage, Spiel-Intro.

## Bekannte Abweichungen (ehrlich)
- Schrift: Original wirkt wie Inter/Roboto (semibold); in der Sandbox nur Liberation Sans verfuegbar => Kappenhoehe ~34 statt 35px, Wortbreite 291 statt 288px (+1%). Mit echtem Inter ~285px.
- Quellcode unbekannt: Spring (350/30), Split-Treiber (Nachlauf, Einsatz sofort, tau 40ms) und `full=16px` sind aus Videodaten gefittet, nicht abgelesen. Lens-Mitte vs. Original: RMS ~5px ueber 0.5-5.0s (Rueckkehr 3.9px).
- Split-Details: Beginn im Original ~1 Frame (15-20ms) spaeter, Farb-Kopien-Abstaende bei schnellen Zuegen im Detail nicht deckungsgleich (Nachlauf-Modell naeherungsweise); Farben aus komprimiertem Video (+-5 Stufen).
- Zeigerpfad: aus der Federkurve rueckgerechnet, daher nicht identisch mit der echten Handbewegung; bei Vergleich mit Original sieht man deshalb einzelne Frames mit anderer Linsenposition.
- Nicht erkennbar: Eintritts-Animation beim Laden (Video startet mitten im Zustand), exakte vertikale Hover-Grenzen (angenommen = Textbox), Verhalten auf echtem Touch, Hover-Cursor-Stil.
- Ein 1px heller Hof am unteren Linsenrand (`#242424`) im Video wurde als Kompressionsartefakt gewertet und nicht nachgebaut; Playwright-Screenshots zeigen auf Linux LCD-Subpixel-Raender am Basistext (kein Effekt-Bestandteil).
