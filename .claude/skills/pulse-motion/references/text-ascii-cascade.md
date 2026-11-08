# Text ASCII Cascade (text-ascii-cascade)
> Ein Wort zerfaellt in zufaellige ASCII-/Block-Zeichen, sackt dabei ~1 Schriftgroesse nach unten und verblasst ins Blaugrau, steigt wieder auf, leuchtet auf und loest sich abrupt in den Klartext auf.

## Wann einsetzen
- Hero-Headline / Logo-Wort, das beim Laden oder Hover "decodiert" (Hacker-/Terminal-/Matrix-Look)
- Section-Titel beim Scroll-Eintritt, Status-Wort (z. B. "LOADING" -> "READY")
- Easter-Egg / Replay bei Klick oder Hover auf Marken-Text; 404-/Glitch-Seiten
- Cyber/Dev-Tool-Landingpages, Dark-UI, Text-Reveal-Alternative zu Typewriter
- Hero text reveal, scramble/decode text, glitch headline, ASCII transition, matrix style

## Anatomie & Zeitleiste
Zeiten ab Scramble-Start (Video: 0.40 s nach Aufnahmebeginn; davor steht "CASCADE" statisch).

| Phase | ab ms | Dauer | Verhalten |
|---|---|---|---|
| Ruhe | -400 | 400 | Klartext, #fafafa |
| Onset | 0 | 0-60 | Buchstaben starten einzeln (Jitter), werden zu Zufallszeichen |
| Fall | 0 | 550 | translateY 0 -> 47 px, cubic ease-out; Opazitaet 1 -> 0.58, Farbe Weiss -> Blauschiefer |
| Halten | 550 | 670 | unten, gedimmt, Zeichen wechseln weiter |
| Aufstieg | 1220 | 600 | 47 -> 0 px, cubic ease-out; hellt zurueck auf Weiss |
| Aufloesung | 1870 | - | alle Zeichen springen gleichzeitig auf Klartext (kein Stagger) |
Scramble-Takt ca. 70 ms, je Zeichen ~70 % Wechselchance. Zeichensatz `.:-=+*#%@&` + Bloecke `░▒▓█` (Bloecke ~25 % der Zeichen, deutlich hoeher als die Kappenhoehe).

## Motion-Tokens
- fall 550 ms / rise 600 ms, Easing `1-(1-p)^3`; Hold 670 ms; drop 47 px
- tick 70 ms, changeProb 0.7, onsetJitter 60 ms, resolveAt 1870 ms, startDelay 400 ms
- Deckkraft dim 0.58; Farbe d = y/drop: Weiss-Ebene = max(0, 1 - 1.6*d)

## Look-Tokens
- Buehne `#1f1f1f`, Text `#fafafa`, Scramble-Ton ~`#94b0d6` (gemessen im Dim-Punkt ~`#5e7489`, kurz nach Start ~`#a0aec8`)
- Mono-Schrift (Geist Mono / DejaVu Sans Mono Fallback), 46 px, Kappenhoehe ~36 px, Tracking 0.08em, Wort mittig
- Keine Rahmen/Schatten/Blur

## Interaktion & Barrierefreiheit
- Video: kein erkennbarer Ausloeser (Zeiger steht still am Rand) -> vermutlich Auto-Start/Intervall. Nachbau: Auto-Start nach 400 ms, optional `loopMs`; zusaetzlich Replay per Hover (pointerenter), Tap (pointerdown), Enter/Space.
- `role="img"` + `aria-label` mit dem echten Wort, Zeichen-Spans `aria-hidden`; fokussierbar (`tabindex=0`).
- `prefers-reduced-motion`: kein Scramble, Text bleibt statisch.

## 120 Hz
- Alles aus dem rAF-Zeitstempel: Position/Opazitaet analytisch (cubic ease-out), Scramble per `floor(elapsed/tick)`, DOM nur bei geaendertem Zeichen; Spans einmal erzeugt.
- Nur `transform`/`opacity` pro Frame (zwei Ebenen Weiss/Blau per Opazitaet kreuzblenden statt `color` zu animieren); `will-change` nur waehrend der Animation; `contain: layout paint`; einmaliger `getComputedStyle` beim Init.
- check120: `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine` (4x: p95 2.4 ms, 0 % ueber Budget, JS 0.08 ms/Frame). INFO zu getComputedStyle = nur Init.

## Einbindung
`assets/text-ascii-cascade.html` - Markup zwischen `COMPONENT:START/END`, `/* COMPONENT CSS */`, JS `initTextAsciiCascade(root, opts)`; Wort aus `data-text`. Optionen (= `TAC_CONFIG`): startDelay, drop, fall, hold, rise, resolveAt, tick, changeProb, onsetJitter, chars, loopMs, hoverReplay, autoPlay. Gibt `{play, destroy}` zurueck; Event `tac:end`. CSS-Variablen oben: Farben, Schrift, Tracking, Dim-Opazitaet.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich eine Zeichen-Scramble-Komponente (setInterval ~70 ms) plus `motion.div` mit animiertem `y`/`opacity`/`color`:
```jsx
<motion.div animate={{ y:[0,47,47,0], opacity:[1,.58,.58,1] }}
  transition={{ duration:1.87, times:[0,.29,.65,1], ease:"easeOut" }}>
  {chars.map(c => <span>{scrambling ? rnd(".:-=+*#%@&░▒▓█") : c}</span>)}
</motion.div>
```
(Spring unwahrscheinlich: beide Bewegungen passen auf cubic ease-out ohne Overshoot.)

## Kreativ remixen
1. Pro Buchstabe versetzter Fall (Stagger 40 ms) -> echte "Kaskade" von links nach rechts, Aufloesung buchstabenweise.
2. Drop auf 120 px, Dim auf 0.2 und Blur 6 px: Wort versinkt im Nebel und taucht neonblau auf.
3. Mit Scroll koppeln: Fortschritt p aus scrollY statt Zeit - Scrubbing-Decode.
4. Zeichensatz = Katakana/Hex/Binaer; gruener Phosphor-Ton fuer Matrix-Look, plus Scanline-Overlay.
5. Hover auf Nav-Links/Buttons: jeder Eintrag cascade-t kurz (drop 8 px, 600 ms) - Mikro-Interaktion fuer Menues; oder als Preisanzeige/Zaehler-Reveal.

## Bekannte Abweichungen
- Ausloeser im Video nicht erkennbar (Auto-Loop vs. Hover vs. Klick); Wiederholungsintervall unbekannt (Video endet 3.95 s).
- Exakte Zeichenfolge/Zufallsverteilung, genaue Block-Glyphen und Schriftart (Fallback-Mono) sind nicht identisch; Kappenhoehe/Breite angenaehert.
- Dim-Farbe per Weiss/Blau-Kreuzblende genaehert; Original wirkt im Tiefpunkt minimal blauer/dunkler.
- Per-Buchstabe-Onset (~60 ms) nur aus einem Frame abgeleitet.
- record.cjs nimmt mit 25 fps auf; Feinabgleich der Zeiten daher auf ~40 ms genau.
