# Parallax Strip Slider (parallax-strip-slider)
> Vollflaechiger Bild-Slider: das naechste Bild "waechst" in 10 vertikalen Streifen von links nach rechts (oben nach unten) ueber das alte; Titel steigt danach Buchstabe fuer Buchstabe auf.

## Wann einsetzen
- Editorial / Mode / Fotografie-Hero, Kollektions- oder Case-Study-Slider (Fashion, Portfolio)
- Hero mit wechselnden Vollbildern, Autoplay-Teaser, Kampagnen-Seiten
- Image gallery transitions, full-bleed carousel, "curtain / blinds / strip reveal" Uebergang
- Szenenwechsel in Story-/Scroll-Sektionen, Produkt-Launch mit 3-5 Motiven
- Dramatischer Wechsel ohne Overlay-UI: grosse Serif-Typo + minimale Meta-Zeile

## Anatomie & Zeitleiste (ms ab Start eines Wechsels, t=0 = erster sichtbarer Streifen)
Buehne 1230x672; Ebenen: altes Bild (unten), neues Bild (darueber, per clip-path nur in Streifen sichtbar), UI (Linie, Label, Zaehler, Titel).
| Phase | Start | Dauer | Beschreibung |
|---|---|---|---|
| Streifen i (0..9) | 26*i | Breite 420, Hoehe ~tau 45 | Streifen i bei x=i*10 %, Breite 0->100 % von links (easeOutQuart), Hoehe von oben nach unten (1-exp(-t/45), voll nach 420) |
| Alter Titel + Label + Zaehler aus | 260 | 280 | Opacity 1->0 |
| Fortschrittslinie | 300 | 650 | Fuellung scaleX (alt -> (i+1)/3), easeInOutCubic |
| Neuer Titel | 560 | 320 + 30 je Buchstabe | jeder Buchstabe translateY 110 %->0 hinter Maske (easeOutQuart) |
| Neues Label/Zaehler ein | 600 | 260 | Opacity 0->1 |
| Ende | ~1050 | | neues Bild wird Basis, clip-path none |
Im Video (Autoplay, ohne Beruehrung der Buehne) starteten Wechsel bei ~1.04 s, ~2.9 s, ~4.2 s (Abstaende unregelmaessig; Demo nutzt 1900 ms Start-zu-Start).

## Motion-Tokens
`columns 10`, `colStagger 26`, `colWidthMs 420 (easeOutQuart)`, `colHeightTau 45`, `colHeightEnd 420`, `titleOutDelay 260 / Ms 280`, `titleInDelay 560`, `letterStagger 30`, `letterMs 320`, `metaInDelay 600`, `lineDelay 300 / Ms 650`, `totalMs 1050`, `autoplayMs 1900`, `firstDelayMs 1040`. Alles in `PS_CONFIG` (Script ganz oben).

## Look-Tokens
- Buehne #050505; Bilder vollflaechig (cover), unten leichter dunkler Verlauf
- Titel: weisse, hochkontrastige Condensed-Serif (Instrument Serif-artig), ~106 px (8.6cqw) @1230, Unterkante ~5.6 % ueber unten, links 41 px
- Label "Collection 0N": Sans 600, 12 px, links 41 px, ~65 px von oben; Zaehler "01/ 03": 11 px, 55 % weiss, rechts 41 px, auf Hoehe ~ Titelmitte
- Fortschrittslinie: 1 px, y=32 px, Grund 18 % weiss, Fuellung 65 % weiss, Fuellung = (i+1)/3
- Gemessene Bildfarben: Fire #1B100A..#24150B (Dunkelbraun/Gold), Allure #7F0913 oben -> #D9631F Horizont, Boden #06070A, Ember #010101 / Grau ~#7C7C7C

## Interaktion & Barrierefreiheit
- Video: reiner Autoplay (Zeiger lag ausserhalb der Buehne). Nachbau zusaetzlich: Pfeil-Buttons (nur Hover-Geraete), Pfeiltasten (Root hat tabindex 0), Swipe (>40 px), `go(i)`.
- `role=region`, `aria-roledescription=carousel`, aria-live-Ansage von Label+Titel, Titel-Spans `aria-hidden`.
- `prefers-reduced-motion`: nur 220 ms Ueberblendung, keine Streifen.

## 120 Hz
Eine rAF-Schleife mit Zeitstempel; jeder Wert wird aus `e = t - t0` berechnet (keine Integration, bildratenunabhaengig). Streifen = EIN clip-path:path() (10 Rechtecke) auf der Next-Ebene, Groessen einmal per ResizeObserver gecacht; Titel-Buchstaben nur transform/opacity; Fortschrittslinie scaleX; Spans nur beim Wechsel gebaut; Schleife laeuft nur waehrend Wechsel (oder bei Autoplay); `will-change` nur waehrend `is-running`; `contain: layout paint`.
check120: `VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine` (4x: p95 3.9 ms, p99 6.7 ms, 0.2 % ueber Budget, Script 0.11 ms/Frame, 0 Layouts).

## Einbindung (assets/parallax-strip-slider.html)
Block `<!-- COMPONENT:START/END -->` + `/* COMPONENT CSS */` + `PS_CONFIG` + `initParallaxStripSlider(root, opts)` kopieren. Root = Element mit definierter Hoehe (Standard: 100vh).
opts: `slides:[{title,label,image}]` (image = Inline-SVG/HTML-String oder URL), alle `PS_CONFIG`-Werte ueberschreibbar (z. B. `columns:14, autoplayMs:0`), `onChange(i)`. Rueckgabe `{next,prev,go,destroy}`.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich pro Streifen ein `motion.div` (overflow hidden, Bild als Hintergrund an Streifenposition), `AnimatePresence`, Titel als gesplitteter Text.
```tsx
<motion.div style={{left:`${i*10}%`,width:"10%"}}
  initial={{clipPath:"inset(0 100% 100% 0)"}} animate={{clipPath:"inset(0 0% 0% 0)"}}
  transition={{duration:.42,delay:i*.026,ease:[.165,.84,.44,1]}}/>
// Buchstaben: initial={{y:"110%"}} animate={{y:0}} transition={{delay:.56+i*.03,duration:.32,ease:"easeOut"}}
```

## Kreativ remixen
1. `columns:24`, `colStagger:12` -> feine "Jalousie"; oder 4 breite Balken fuer brutalistischen Look.
2. Streifen von rechts / aus der Mitte / zufaellige Reihenfolge starten; abwechselnd von oben und unten wachsen lassen.
3. Scroll-gekoppelt: `e` aus scrollY statt Zeit -> Scrub-Transition in Sektionen.
4. Mit Cursor-Parallax kombinieren: Bild in jedem Streifen um einen anderen Faktor versetzen (echte Tiefe) + Titel mit Magnet-Effekt.
5. Farbblitz: Streifen vor dem Bild kurz in Akzentfarbe (rot) fahren und Titel mit Glitch/Blur-Scharfstellung einsteigen lassen; Beat-synchron zu Audio.

## Bekannte Abweichungen (ehrlich)
- Die Fotos sind als grobe Inline-SVG-Skizzen nachgemalt (Original-Bilder nicht verfuegbar); Farbverlauf/Komposition stimmen grob, Details nicht.
- Titelschrift: Original eine schmale, hochkontrastige Serif (Name nicht erkennbar); Fallback Liberation Serif mit scaleX 0.74, daher etwas andere Buchstabenformen.
- Streifen-Hoehenverlauf aus Frames grob geschaetzt (Plateau bei ~75 % im Video, Nachbau schneller voll); Streifenbreiten im Video leicht unregelmaessig, Nachbau gleichmaessig 10 %.
- Autoplay-Intervall im Video unregelmaessig (1.9 s / 1.3 s), Nachbau konstant; ob Loop oder Scripted unklar.
- Seitliche Pfeile ausserhalb der Buehne im Video gehoeren zur 21st-Seite, nicht zur Komponente.
