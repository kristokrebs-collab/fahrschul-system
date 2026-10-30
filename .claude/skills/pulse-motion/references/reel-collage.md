# Reel Collage (reel-collage)
> Zwei Headline-Zeilen rahmen ein Fenster, in dem Video-Reels im Schnelldurchlauf wechseln; das Fenster klappt per scaleY zu, der Text wechselt und sechs Karten fliegen aus der Mitte auseinander (3,2-s-Loop).

## Wann einsetzen
- Launch-/Produkt-Hero ("The videos / That you ship"), Showreel, Agentur-Intro
- Montage-Gefuehl: schnelle Schnitte, dann Kollaps und Reveal (hard cut / fast cut / reveal)
- Feature-Aufzaehlung als Bilder-Collage, Social-Proof-Karten (Chat, Follower, Terminal)
- Loading-/Idle-Hero, Autoplay-Loop ohne Interaktion
- Titel, der sich per Kollaps-Zwischenschnitt "umschreibt" (Textwechsel auf Zeilenmitte)

## Anatomie & Zeitleiste
Loop 3200 ms, Zeit ab erstem Reel (Referenz 1234x673). Messung aus echten Frame-Zeiten (Loop 2: 5,973 s, Loop 1: 2,774 s).

| Phase | ab ms | Dauer | Inhalt |
|---|---|---|---|
| Reel 1 Universe | 0 | ~95 | Schnitt (hart, kein Fade) |
| Reel 2 Browse scenes | 95 | ~110 | |
| Reel 3 Sunset | 205 | ~130 | |
| Reel 4 Laptop | 335 | ~133 | |
| Reel 5 "5 clips" | 468 | ~162 | Dauer waechst leicht |
| Reel 6 "snapcn is installed" | 630 | ~205 | |
| Reel 7 Fan-Stapel | 835 | ~70 | |
| Kollaps | 906 | 340 | Fenster scaleY 1->0, Zeilen ruecken von +/-202 auf +/-20 px zusammen |
| Hold (nur Text) | 1250 | ~280 | "The videos / That you ship" |
| Textwechsel | 1531 | 0 | hart auf "Especially on / Launch day" |
| Spread | 1690 | 440 | Zeilen + 6 Karten gleiten nach aussen, Karten blenden ein (260 ms, Stagger 22 ms) |
| Hold Tableau | 2130 | ~1070 | statisch, dann harter Schnitt zu Reel 1 |

Fenster 490x337 (Mitte), Zeilen 36 px hoch. Karten (Mitte x/y): Gruen-Phone 289/272 (176x196), Terminal 505/334 (237x161), UI "Install all" 796/183 (270x180), Follower-Strip 753/382 (233x162), Chat 360/517 (251x171), Doppel-Panel 953/500 (238x162). Zeilen im Tableau: "Especially on" (-118,-173), "Launch day" (+70,+162) relativ zur Mitte.

## Motion-Tokens
- Schnitte: hart (keine Ueberblendung), 95-205 ms pro Reel
- Kollaps: ease-out cubic (1-(1-p)^3), 340 ms, nur transform scaleY (Mitte), Opacity des Fensters konstant .64
- Spread: ease-out cubic 440 ms; Karten Start: 72 % des Mittenabstands, scale .86, opacity 0->.7 (260 ms)
- Roter Rand-Glow: Opacity 0->1 in 300 ms mit Spread
- Alles in `REEL_CONFIG` (JS) und `:root` (CSS) oben in der Datei

## Look-Tokens
- Buehne #1d1d1a; Text #f3f3f3, Inter/Geist 36 px, Gewicht 500, Laufweite -0.045em
- Reels/Karten wirken gedimmt: weisse Flaechen = #aeaeae -> opacity .64 ueber Buehne
- snapcn-Blau #2f76e8 (aus gedimmtem #28569e rueckgerechnet), "installed" als schwarze Pille mit 6 px Radius
- Karten: eckig (0-4 px), Gruen-Phone oben abgerundet; Glow rgba(150,40,14,.2) am Rand

## Interaktion & Barrierefreiheit
Autoplay-Loop (im Video keine Interaktion sichtbar). Nachbau: Tippen/Klick oder Leertaste/Enter pausiert/startet, `role="img"` mit aria-label, Fokusring. `prefers-reduced-motion`: statisches Tableau, keine Animation. Pausiert bei `visibilitychange`.

## 120 Hz
Ein rAF-Loop mit Zeitstempel, `dt = min(now-last, 50)`, Zeit wird akkumuliert, alle Phasen sind reine Funktionen der Loop-Zeit (keine Pro-Frame-Inkremente). Nur transform/opacity; Reel-Wechsel nur per Klassenwechsel bei Index-Aenderung, DOM-Writes nur wenn sich der Wert aendert (Cache-Keys). Buehnen-Skalierung einmal per ResizeObserver. will-change nur waehrend Wiedergabe. check120: `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine` (p95 3 ms bei 4x Drosselung, 0,12 ms Script/Frame, 0 Layouts).

## Einbindung
`assets/reel-collage.html`: Block `<!-- COMPONENT:START/END -->` + `/* COMPONENT CSS */` + `function initReelCollage(root, opts)`; `root` ist `.rc` (fuellt Elternelement). Optionen = Keys von `REEL_CONFIG` (loop, reelStarts, collapseAt/Dur, swapAt, spreadAt/Dur, cardStartK, cardOpacity, spreadTop/Bot, autoplay, pauseOnTap). Rueckgabe `{play, pause, toggle, seek(ms), destroy}`. Reel-/Karteninhalte sind CSS-Naeherungen: eigene Bilder in `.rc-reel`/`.rc-card` einsetzen.

## Vermuteter Original-Stack -> React/Framer-Motion
Vermutlich `useEffect`-Timeline mit Index-Wechsel (steps) und `motion.div` fuer Kollaps/Spread.
```tsx
<motion.div animate={{ scaleY: collapsed ? 0 : 1 }} transition={{ duration: .34, ease: [.215,.61,.355,1] }} />
<motion.div initial={{ opacity:0, scale:.86, x:k*dx, y:k*dy }} animate={{ opacity:1, scale:1, x:0, y:0 }}
  transition={{ duration:.44, ease:"easeOut", delay: i*.022 }} />
```

## Kreativ remixen
1. Schnittfolge beschleunigen (Reels 40-60 ms) und Beat-synchron triggern: Montage-Rausch.
2. Kollaps mit Blitz: bei scaleY->0 kurz Glow/Chromatic-Aberration (filter) auf der Linie.
3. Karten mit Spring-Overshoot und leichter Rotation + Parallax per Pointer.
4. Kollaps-Linie als Scanline ueber die ganze Breite ziehen, danach Text per Glyph-Stagger tauschen.
5. Echte Videos in die Reels, Karten werden Produkt-Screens; Loop auf Scroll-Position koppeln.

## Bekannte Abweichungen
- Reel- und Karteninhalte (Universe, Sunset, Fotos, Chat-Avatare) sind grobe CSS-Naeherungen, keine echten Bilder.
- Schnittzeiten auf ~10-20 ms genau, Easing der Kollaps-/Spread-Phase als ease-out cubic geschaetzt; Kartenstartpositionen und Stagger nur grob erkennbar.
- Roter Rand-Glow im Video schwach/unsicher (evtl. Aufnahmeartefakt); Textschrift nur Inter-aehnlich.
- Dimmung (opacity .64) ist aus Farbmessung abgeleitet; Original-Mechanismus unbekannt.
