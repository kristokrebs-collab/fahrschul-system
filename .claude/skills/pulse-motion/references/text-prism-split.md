# Text Prism Split (text-prism-split)

> Ein Wort in Fliesstext-Groesse, ueber dem ein schwarzes, weich gerandetes Linsenfenster federnd dem Zeiger folgt; darin ist der Text 6% groesser, 5px hoeher und besteht aus drei Farb-Kopien (lachsrot / gruen / lavendel), die bei schneller Linsenbewegung proportional zur Geschwindigkeit auseinanderrutschen (max. +-14px) und in der Ruhe deckungsgleich per `screen` zu reinem Weiss verschmelzen.

Quelle: 21st.dev-Vorschau "Text Prism Split" (Text "REFRACTION"), rekonstruiert aus einer Bildschirmaufnahme (Samsung Browser, 120-Hz-Display). Datei: `assets/text-prism-split.html`.

## Wann einsetzen
- Hero-Headline / Markenname / Portfolio-Name auf dunklem Grund (Wow beim ersten Hover) - hero title, brand word
- 404-, Splash- oder Loader-Seite mit einem einzelnen grossen Wort - single-word splash
- Nav-Eintrag oder Produktname als "Lupe" mit Glitch-Charakter - hover lens, glitch reveal
- Teaser, bei dem eine Linse Teile eines Titels "scannt" (auch per Scroll/Auto-Sweep) - scanner, scroll scrub
- Kreativ-/Tech-/Musik-/Gaming-Seiten, chromatische Aberration gewuenscht - RGB split, prism, refraction, motion trail

## Anatomie & Zeitleiste
Aufbau: Basistext (`#fafafa`) + absolut positionierte Linse (120x50px, Hoehe = Zeilenbox) mit 3 gestapelten, **immer eingefaerbten** Text-Ebenen (`mix-blend-mode: screen`, Farben `#ff8080` / `#00ff00` / `#ccccff`; deckungsgleich = Weiss).
Referenz-Viewport 1234x673, Schrift 48px; Tinte 288x41px mittig (x 473-761, y 312-353), Linsen-Ruhemitte x=617.

| Phase | Ausloeser | Dauer / Verhalten |
|---|---|---|
| Ruhe | kein Zeiger im Text | Linse ruht in der Textmitte, Ebenen deckungsgleich = Weiss (nur ~0.4px dickere Stege + feine Farbsaeume an Kanten), keine Idle-Animation |
| Eintritt | Zeiger betritt die Textbox (nur die Box; 20px darunter = nichts) | Feder zieht die Linse zur Zeiger-x; Split setzt im selben Frame ein (waechst mit der Geschwindigkeit, nach ~60ms am Anschlag 14px) |
| Folgen | Zeiger bewegt sich im Text | Linsenmitte = Zeiger-x mit Federnachlauf (~0.2s); Linse darf ueber das Textende hinausragen (kein Clamp) |
| Ausklang | Zeiger ruht | Split schrumpft mit der Feder-Geschwindigkeit: 11px -> 2.5px in ~0.3s, bei v=0 exakt Weiss |
| Austritt | Zeiger verlaesst die Textbox | gleiche Feder zurueck zur Mitte: 100px in ~190ms auf <3px, ~220ms auf <0.5px, ~1.5% Overshoot (1.5px bei 100px); Split-Peak ~0.06s nach Start (Anschlag 14px) |

## Motion-Tokens
| Token | Wert | Anmerkung |
|---|---|---|
| spring | stiffness 350, damping 30, mass 1 | omega0 18.7 rad/s, zeta 0.80; Fit an Rueckkehr-Kurven; Linsenmitte folgt Zeiger-x; im Code exakt analytisch geloest |
| split.gain | 0.02 s (= 20ms) | Ebenen-Versatz q = gain * Linsen-Geschwindigkeit (px je px/s); lachsrot +q (eilt in Bewegungsrichtung voraus), gruen 0, lavendel -q (haengt hinterher) |
| split.max | 14px (bei 48px Schrift = 0.29em) | harter Anschlag ab ~700px/s; skaliert mit der Schrift |
| Messung | q = clamp(-0.02 * v, +-14) | per Kreuzkorrelation der Ebenen-Masken im Original: RMSE ~2px ueber 180 Frames; Versatz laeuft ~1 Frame (8ms) VOR der Geschwindigkeit (nicht nachgebaut) |
| Linsen-Inhalt | scale 1.06 um Linsenmitte, translateY -5px (-0.105em) | Text bleibt exakt an Seitenkoordinaten verankert (nur vergroessert) |

## Look-Tokens
| Token | Wert |
|---|---|
| Buehne | `#1f1f1f` (flach, kein Verlauf) |
| Text | `#fafafa`, 48px, Gewicht 600, Laufweite -0.05em, Zeilenhoehe 1.04 (=50px), Font Inter/Roboto-artig |
| Linse | 2.5em breit (120px), volle Zeilenhoehe (50px, oben/unten scharf), Hintergrund `#050505`, Rand links/rechts weich 0.25em (12px, Mask-Gradient), kein Radius, kein Schatten |
| Ebenen-Farben | `#ff8080` lachsrot, `#00ff00` gruen, `#ccccff` lavendel (gemessen +-5 Stufen, Video komprimiert) |
| Mischfarben (gemessen) | lachsrot+gruen = gelb `(255,255,128)`, gruen+lavendel = hellcyan, lachsrot+lavendel = rosa-weiss, alle drei = Weiss |

## Interaktion & Barrierefreiheit
- Im Video: Mauszeiger (Pfeil) => Hover. Umgesetzt mit Pointer Events (Maus/Stift/Touch): `pointerenter/move/leave`; Touch = Finger ziehen (`touch-action: pan-y`, getestet: Tippen bei 20% -> Linse 20%, Ziehen auf 80% -> 80%, Loslassen -> Mitte), Loslassen => Linse zurueck zur Mitte (Erweiterung, im Video nicht zu sehen).
- Tastatur: Element ist fokussierbar (`keyboard: true`), Pfeile links/rechts schieben die Linse (10% je Schritt), Home/End, Esc/Blur => Mitte.
- Basistext ist echter Text (Screenreader/Kopieren); Linse + Ebenen sind `aria-hidden`, `user-select: none`, `pointer-events: none`.
- `prefers-reduced-motion`: Linse folgt ohne Feder (springt), kein RGB-Split, Ebenen bleiben deckungsgleich (Weiss).

## 120 Hz
Technik (Pflicht des Nutzers: mindestens 120 fps; Ziel 120/144/165/240 Hz):
- Alles zeitbasiert: rAF mit Zeitstempel, `dt = min(now - last, 50ms)`; Feder = **exakte analytische Loesung** der gedaempften Feder (alle drei Daempfungsfaelle) => identische Bahn bei jedem dt; kein Frame-Zaehler, kein Intervall, keine 60-Hz-Konstante.
- Split ist eine reine Funktion der Feder-Geschwindigkeit (kein Zustand, kein Abklingzaehler).
- Pro Frame nur `transform` (4 Elemente: Linse + 3 Ebenen), keine Layout-/Paint-Eigenschaften (auch keine Farb-/Opacity-Animation, die Ebenen sind statisch eingefaerbt); `will-change` nur waehrend der Bewegung (Klasse `.is-live`), Loop stoppt in Ruhe; `contain: layout paint` an der Linse (Root nur `layout style`, damit die Linse ueber das Textende ragen darf).
- `pointermove` speichert nur `clientX` (passiv), angewendet wird einmal pro rAF; `getBoundingClientRect` nur bei Eintritt/Scroll/Resize, Metriken per ResizeObserver/`fonts.ready` gecacht.
- Ergebnis check120 (`choreografie 6.4s`): `VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine`; ohne Drosselung p95-Frame 0.7ms, Script 0.04ms/Frame; mit 4x CPU-Drosselung p95-Frame 3.1ms (Grenze 10.4), Script 0.14ms/Frame, 0 Layouts/Frame. Einziger INFO-Hinweis: Layout-Lesezugriffe nur bei Init/Resize/Eintritt (gewollt).
- Rate-Test (rAF auf 250/125/62.5 Hz simuliert, gleiche Eingabe): Linsenbahn 250 vs 125 Hz RMS 0.64px; der Rest bei 62.5 Hz stammt von der groeberen Eingabe-Abtastung (16ms = bis 16px Zeigerschritt), nicht vom Solver. Analytische Feder: Ergebnis nach 0.6s identisch (1e-6) fuer 30/60/120/240/1000 Hz.

## Einbindung (assets/text-prism-split.html)
- Kopiere `/* COMPONENT CSS */`, `/* COMPONENT JS */` und das Markup `<h1 class="tps" data-tps>WORT</h1>`; Look per `--tps-*` Variablen im `:root`-CONFIG, Motion im `TEXT_PRISM_SPLIT_CONFIG`.
- `initTextPrismSplit(root, opts) -> { setPosition(frac|null), destroy() }`; `root` = Element mit Klartext (wird intern umgebaut).
- opts (alle optional, tief gemerged): `restAt` 0.5, `spring {stiffness, damping, mass}`, `split {gain, max}`, `maxDt`, `keyboardStep`, `keyboard`, `magnify` (sonst `--tps-magnify`), `lift` (em, sonst `--tps-lift`).
- Alles in `em` => Schriftgroesse per `--tps-size` ueberall skalieren (`split.max` skaliert mit); mehrere Instanzen = je Element ein `init`-Aufruf.
- `setPosition(0..1)` faehrt die Linse programmatisch (Auto-Sweep, Scroll-Scrub, Audio); `null` = Ruhe.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich React + Tailwind + framer-motion: `useMotionValue` fuer Zeiger-x, `useSpring` fuer die Linse, `useVelocity` -> `useTransform` fuer den Versatz.
```tsx
const target = useMotionValue(0);
const lens = useSpring(target, { stiffness: 350, damping: 30, mass: 1 });
const vel = useVelocity(lens);
const q = useTransform(vel, [-700, 700], [-14, 14], { clamp: true }); // px = Versatz der lachsroten Ebene (+q), gruen 0, lavendel -q
// onPointerMove: target.set(e.clientX - rect.left) | onPointerLeave: target.set(width / 2)
<motion.span style={{ x: lensLeft }} className="absolute inset-y-0 w-[2.5em] overflow-hidden bg-[#050505]
  [mask-image:linear-gradient(90deg,transparent,#000_10%,#000_90%,transparent)]">
  {[['#ff8080', 1], ['#00ff00', 0], ['#ccccff', -1]].map(([c, s]) => <motion.span key={c} className="absolute mix-blend-screen"
     style={{ color: c, x: useTransform(q, v => textX + s * v), y: -5, scale: 1.06 }}>REFRACTION</motion.span>)}
</motion.span>
```

## Kreativ remixen
1. Auto-Scan fuer Touch/Mobile: `setPosition(0.5 + 0.45*Math.sin(t*1.4))` per rAF als Idle-Sweep, bei Pointer-Eintritt uebernimmt der Nutzer - der Effekt lebt auch ohne Hover; der Split entsteht von selbst aus der Geschwindigkeit.
2. Hochdrehen: `split {gain: 0.06, max: 40}`, `--tps-lens-w: 6em`, `--tps-magnify: 1.35`, `spring {stiffness: 160, damping: 12}` => schmieriger Mega-Glitch mit Overshoot; je schneller der Wisch, desto weiter fliegen die Farbkanaele auseinander.
3. Lens-Inhalt tauschen: Linsen-Ebenen zeigen ein anderes Wort ("REFRACTION" -> "DISCOVER") oder ein Bild/Video im Linsenfenster: Geheimbotschaft/Reveal-Lupe ueber Hero-Titeln.
4. Mehrzeilig/mehrfach: eine Liste (Menue, Preise, Team-Namen) mit einer gemeinsamen Zeiger-x-Quelle - die Linse "wandert" ueber alle Zeilen gleichzeitig; oder vertikale Variante (Achse y) fuer Spalten.
5. Audio/Scroll-getrieben: Linsenposition = Scroll-Fortschritt oder Bass-Pegel (Web Audio), `gain` hoch + `navigator.vibrate(8)` beim Buchstabenwechsel - Loader, Musik-Landingpage, Spiel-Intro; Scroll-Geschwindigkeit liefert den Split gratis.

## Bekannte Abweichungen (ehrlich)
- Schrift: Original wirkt wie Inter/Roboto (semibold); Sandbox nur Liberation Sans => Tinte 287 statt 288px, Kappenhoehe ~34 statt 35px, Boxbreite 291px. Mit echtem Inter minimal anders.
- Quellcode unbekannt: Spring (350/30) und Split-Gesetz (gain 0.02 s, max 14px) sind aus Videodaten gefittet, nicht abgelesen. Lens-Mitte vs. Original: RMS 5.6px ueber 0.5-5.0s (Rueckkehr 3.0px); Versatz-RMSE 2.8px. Ausklang-Schwanz des Splits im Nachbau 1-2px laenger als im Original.
- Zeigerpfad aus der Federkurve rueckgerechnet, daher nicht identisch mit der echten Handbewegung; im 25ms-Vergleich reagiert der Nachbau ~1 Frame (8-25ms) frueher als das Video (Display-/Eingabelatenz der Aufnahme, nicht Teil der Komponente).
- Erstes Videobild (t<0.03s) zeigt reines Weiss ohne Farbsaeume (vermutlich Vor-Hydration); danach sind die Farb-Ebenen auch in der Ruhe vorhanden (feine Saeume max. 22 Stufen im Video, 38 im Nachbau - Video-Chroma-Subsampling daempft).
- Nicht erkennbar: Eintritts-Animation beim Laden, exakte vertikale Hover-Grenzen (angenommen = Textbox), Verhalten auf echtem Touch, Hover-Cursor-Stil, ob die Geschwindigkeit aus Feder oder Zeiger stammt (Feder gefittet).
- Ein 1px heller Hof am unteren Linsenrand (`#242424`) im Video wurde als Kompressionsartefakt gewertet; Playwright-Screenshots zeigen auf Linux LCD-Subpixel-Raender am Basistext (Headless-Artefakt, kein Effekt-Bestandteil).
