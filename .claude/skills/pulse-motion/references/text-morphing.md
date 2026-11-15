# Text Morphing (text-morphing)
> Zentriertes Wort morpht alle 2 s per Blur-Crossfade + Alpha-Schwelle (Gooey-Effekt) von "Develop" ueber "Deploy" zu "Delight" und wieder von vorn.

## Wann einsetzen
- Hero-Claim / Tagline mit wechselnden Schluesselwoertern (Develop, Deploy, Delight)
- Rotating headline, word swapper, gooey / liquid text transition
- Statuswechsel, Loader-Text, Branding-Splash
- Dunkle Buehne, grosse fette Typo, ein Wort im Fokus
- Kein Nutzerinput noetig: Auto-Loop, Ambient Motion

## Anatomie & Zeitleiste
Zwei uebereinanderliegende Woerter in einem Container mit SVG-Filter (feColorMatrix, Alpha x255 - 140). Ausgehend wird unscharf + transparent, eingehend scharf + deckend; die Schwelle macht daraus organische Blobs.

| Phase | Zeit (ms) | Beschreibung |
|---|---|---|
| Hold | ~900 (erste), sonst 1000 | Wort scharf, ruhig |
| Morph | 1000 Fortschritt f 0..1 (sichtbar "blobbig" ca. 400) | Blur/Opacity per Potenzkurve |
| Zyklus | 2000 | Hold + Morph; Reihenfolge Develop -> Deploy -> Delight -> Develop |

Im Video: Morph-Start ca. 0.9 s, Wort sauber ca. 1.35 s; naechster Start bei ca. 2.9 s.

## Motion-Tokens
- eingehend: blur(px) = blurMax/f - blurMax (max 100), opacity = f^0.4
- ausgehend: gleiche Formeln mit g = 1 - f
- blurMax 8, morphMs 1000, holdMs 1000, Schwelle k=255, b=-140
- Kein Scale/Translate, nur filter + opacity.

## Look-Tokens
- Buehne #1f1f1f (gemessen), Text ~#f5f5f5
- Schrift fett (700) Roboto/Inter-artig, ca. 90 px bei 1234x673-Buehne, Laufweite ca. -0.01em
- Wort horizontal und vertikal zentriert, keine Rahmen/Schatten

## Interaktion & Barrierefreiheit
- Rein automatisch (Zeigerbewegungen im Video loesen nichts aus). Option clickToAdvance ueberspringt die Pause.
- role="img" mit aria-label, sichtbare Woerter aria-hidden, versteckter aria-live-Text meldet das aktuelle Wort.
- prefers-reduced-motion: kein Filter/Blur, Wort wechselt hart.
- Pausiert ausserhalb des Viewports (IntersectionObserver).

## 120 Hz
- rAF mit Zeitstempel, dt = min(t-last, 50); Fortschritt = elapsed/morphMs, rein zeitbasiert.
- Nur filter (blur) + opacity; will-change nur waehrend des Morphs; contain: layout paint; DOM-Schreibzugriff nur bei geaendertem f (4 Nachkommastellen); getComputedStyle nur einmal in init.
- check120: VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine (4x: p95 3.1 ms, p99 4.8 ms, 0 % ueber Budget, Script 0.08 ms/Frame). Der Schwellenfilter laeuft auf kleiner Flaeche (max ~900x135 px).

## Einbindung
`assets/text-morphing.html`: Block COMPONENT:START..END (inkl. SVG-Filter #tm-threshold) und `/* COMPONENT CSS */` uebernehmen, dann
`initTextMorphing(el, {words, morphMs, holdMs, blurMax, threshold:[k,b], startOffsetMs, clickToAdvance})` -> `{destroy, next}`.
CSS-Variablen oben: --morph-ms, --hold-ms, --blur-max, --threshold-k/-b, --font-size, Farben.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich React-Komponente mit zwei Spans, requestAnimationFrame-Loop (morph/cooldown) und `filter: url(#threshold)`; kein Spring erkennbar.
```tsx
// f = elapsed/morphTime
el2.style.filter = `blur(${Math.min(8/f-8,100)}px)`; el2.style.opacity = `${f**0.4*100}%`;
el1.style.filter = `blur(${Math.min(8/(1-f)-8,100)}px)`; el1.style.opacity = `${(1-f)**0.4*100}%`;
```
(Falls Framer: animate({filter:["blur(0px)","blur(40px)"], opacity:[1,0]}, duration 1, ease linear) - ohne Spring.)

## Kreativ remixen
1. Hero-Headline: "Design / Build / Ship" mit blurMax 16 und morphMs 1600 fuer weiche Lava-Lampen-Blobs.
2. Schwelle b auf -60 und Farbe auf Verlauf (background-clip:text laeuft nicht im Filter: stattdessen Farbe pro Wort wechseln, z. B. Neon-Cyan/Magenta).
3. Mit Cursor koppeln: pointermove steuert f direkt (Scrubbing), Wort folgt der Maus-x-Position.
4. Zahlen morphen (Preis 49 -> 99) oder Logos/Icons als SVG-Text-Shapes.
5. Hintergrund mit Aurora/Noise kombinieren, nur Text gooey; Mikro-Shake (translate 1 px) beim Peak fuer Herzrasen.

## Bekannte Abweichungen (ehrlich)
- Schrift: Original wirkt wie Roboto-Bold (Android-Rendering); Sandbox hat nur Liberation/DejaVu, Glyphenform/Breite weicht minimal ab. Groesse nur per Breitenmessung geschaetzt.
- Genaue morph-/cooldown-Aufteilung und Kurve (f^0.4, blur 8/f-8) aus dem Blob-Verlauf rekonstruiert; sichtbare Dauer (~0.4 s) passt, einzelne Blobformen sind nicht pixelgleich.
- Ob Tippen/Hover etwas ausloest, war nicht erkennbar (Zeiger bewegte sich ohne Wirkung).
- Videostart war bereits mitten im Hold; Startoffset 400 ms ist geschaetzt.
