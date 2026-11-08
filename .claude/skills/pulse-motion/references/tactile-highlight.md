# Tactile Highlight (tactile-highlight)
> Zweizeiliger Claim-Text, dessen Schlusswort ("Better Interfaces.") auf einem fast schwarzen Marker-Balken liegt, der per kurzem "Tab" und exponentiellem Wisch von links aufwaechst; Text wird dabei weiss, Textauswahl ist nativ blau.

## Wann einsetzen
- Hero-/Mission-Statement, in dem ein Schluesselbegriff hervorgehoben werden soll (Marker statt Farbe)
- Manifest-, About-, Pitch-Deck-Zeilen; "Highlight on reveal" beim Scrollen (trigger inview)
- Dark-UI mit minimalem Look: Kontrast durch Schwarz-auf-Dunkelgrau statt Akzentfarbe
- Text-Reveal ohne Bewegung des Textes (Marker wischt, Text bleibt)
- Highlighter / marker / text emphasis / underline-alternative / mission statement / heading reveal

## Anatomie & Zeitleiste
Stage #131313, Text zentriert, 2 Zeilen, 64px Bold (Referenz 1234x673), Zeilenabstand 74px.
Marker = Balken hinter Zeile 2 (x 394..840, y 336..409 in Stage-Koordinaten, ~10px Innenabstand, Radius ~5px).
Auf dem Video war nur der Wiedereintritt (Seite neu geladen) mit Animation sichtbar; Zeiten ab Start (t=0 = erster Marker-Frame):

| Phase | ms | Verlauf |
|---|---|---|
| Text-Fade | 0-120 | opacity 0 -> 1 (Seitenblende, im Video ~100 ms) |
| Tab-Pop | 0-15 | schwarzer Block links vom Marker (88px breit, rechte Kante = Marker-Linkskante), scaleX 0.72 -> 1 |
| Tab-Hold | 15-45 | steht |
| Tab-Rueckzug | 45-87 | Breite 88 -> 0 nach rechts (ease-in, quadratisch) |
| Marker-Wisch | 90-~500 | scaleX 0 -> 1 von links, p = 1 - exp(-t/150ms): 19% @33ms, 58% @125ms, 74% @190ms, 91% @360ms |
| Textfarbe | mit Wisch | Zeichen werden #f2f2f2 -> #fff, sobald die Marker-Kante ihre Rechtskante passiert |
| Ruhezustand | danach | Marker + weisser Text + zarter heller Schein unter dem Marker |

## Motion-Tokens
- Wisch: exponentiell (entspricht ease-out / kritisch gedaempfter Naeherung), tau = 150 ms, kein Overshoot
- Tab: pop 15 ms, hold 30 ms, retract 42 ms ease-in; Wisch-Delay 90 ms
- Fade 120 ms linear. Keine Blur-/Translate-Bewegung des Textes.

## Look-Tokens
- Stage #131313; Text #f2f2f2 (Zeile 1 und Zeile 2 vor dem Wisch); Marker-Text #ffffff
- Marker #030205 (gemessen 020104), Radius 5px, Padding-x 0.16em, Schein `0 8px 20px rgba(255,255,255,.07)` (Pixel unter dem Marker 1A -> 14 ueber ~22px, links kein Schein)
- Auswahlfarbe #3872ac (native Android-Auswahl)
- Font Roboto-artig Bold 700, 64px, letter-spacing ca. -0.05em, line-height 1.15; Cursor: Hand (pointer)

## Interaktion & Barrierefreiheit
- Ausloeser: Mount (Standard) oder `trigger:'inview'`; `root._th.replay()` startet neu. Im Video kein Hover-Effekt am Marker erkennbar.
- Das Blau mit Anfassern und Kontextleiste (Kopieren/Uebersetzen/...) im Video ist die NATIVE Textauswahl des Samsung-Browsers (Long-Press), nicht Teil der Komponente. Nachbau: Text bleibt auswaehlbar, `::selection` blau.
- `h1` mit `aria-label` des ganzen Satzes, Zeilen `aria-hidden`; `prefers-reduced-motion`: sofort Endzustand ohne Tab/Wisch.

## 120 Hz
- Einzige rAF-Schleife mit Zeitstempel, analytische Kurve (kein Frame-Zaehler), Schleife stoppt nach Ende.
- Nur `transform: scale3d` (Marker/Tab) und `opacity`; `will-change` nur waehrend der Animation; `contain: layout paint`.
- Zeichen-Spans einmal erzeugt, Kanten einmal gemessen (Start, ResizeObserver im Ruhezustand), Klassenwechsel nur bei Aenderung.
- check120: `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine` (p95 0.6 ms normal, 3.9 ms bei 4x Drosselung, 0 % ueber Budget; ein INFO-Hinweis zu Layout-Lesezugriffen = die einmalige gecachte Messung).

## Einbindung
`assets/tactile-highlight.html`: Marker `COMPONENT:START/END`, CSS-Block "COMPONENT CSS", Variablen oben in `:root`.
```js
initTactileHighlight(rootEl, {trigger:'mount'|'inview', replayOnView:false,
  enterFadeMs, leadDelayMs, tabPopMs, tabHoldMs, tabRetractMs, wipeDelayMs, wipeTauMs});
```
Markup: `.th` > `.th__l` (Zeile 1) + `.th__l--hl` > `.th__hl` > `i.th__tab` + `i.th__bg` + `.th__txt` (Zeichen werden per JS gesplittet).

## Vermuteter Original-Stack -> React/Framer-Motion
```tsx
<span className="relative px-2.5">
  <motion.span className="absolute inset-0 origin-left rounded-[5px] bg-[#030205]"
    initial={{scaleX:0}} animate={{scaleX:1}}
    transition={{type:"spring", stiffness:60, damping:14, delay:.09}} />  // ca. tau 150 ms, kaum Overshoot
  <motion.span initial={{color:"#f2f2f2"}} animate={{color:"#fff"}} className="relative">Better Interfaces.</motion.span>
</span>
```

## Kreativ remixen
1. Mehrere Marker nacheinander (Stagger 200 ms) ueber ein ganzes Manifest wischen lassen, jeder in eigener Farbe (Neon-Gelb, Magenta).
2. Wisch auf Scroll-Progress binden (scaleX = Scroll-Fortschritt) und Textfarbe von Zeichen zu Zeichen mitlaufen lassen.
3. tau auf 60 ms + leichter Overshoot (Feder) und der Tab als "Schlag": Marker knallt rein, Screenshake 2px.
4. Marker mit Cursor verheften: Wisch folgt dem Zeiger ueber Woerter (Hover-Highlighter), Schein wird zum Glow in Akzentfarbe.
5. Kombination mit Text Morphing: das markierte Wort wechselt, der Marker faehrt zurueck und neu ueber das neue Wort.

## Bekannte Abweichungen (ehrlich)
- Nur der Wiedereintritt nach Seitenwechsel war zu sehen; Ausloeser im Original (Mount vs. In-View) ist nicht erkennbar, ebenso ob Hover etwas bewirkt.
- Der "Tab" (Block links vom Marker, Aufblitzen und Zurueckziehen) ist aus ~8 Videobildern rekonstruiert; die Ursache im Original-Code ist unklar.
- Blaue Auswahl, Anfasser, Kontextleiste und Zeigersymbol sind OS/Browser, nicht nachgebaut.
- Schrift: Roboto war im Test-Chromium nicht installiert; Fallback Liberation Sans ist ~14 % breiter (Zeile 1: 621 statt 542 px). Auf Systemen mit Roboto passt es naeher.
- Wisch-Kurve aus 120-Hz-Messpunkten gefittet (Exponential); der Ausklang kurz vor 100 % war durch die blaue Auswahl verdeckt.
- Nachbau-Zeitvergleich nur per Messwerte und Endbild, keine 120-fps-Gegenaufnahme.
