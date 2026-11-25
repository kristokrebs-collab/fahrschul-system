# Text Animate (text-animate)
> Typewriter: Der Satz "Ship beautiful interfaces, fast." tippt sich Zeichen fuer Zeichen mit Cursor neu, ausgeloest per "Replay"-Button.

## Wann einsetzen
- Hero-Headline / Claim, der sich "live tippt" (typewriter, headline reveal)
- Terminal-, Chat-, KI-Antwort-Look; Prompt-Eingabe-Demo (AI prompt, command line)
- Tagline-Wechsel, Onboarding-Schritte, Code-/Log-Ausgabe
- Mikro-Moment auf dunkler Buehne: ruhig, minimal, Fokus auf einen Satz
- Replay-Button fuer Demos / Produkt-Showcases

## Anatomie & Zeitleiste
Buehne #131313, Text (zentriert) ueber dem Button, Mitte-zu-Mitte ~59 px, Gruppe vertikal zentriert.

| Phase | Zeit (ms) | Beschreibung |
|---|---|---|
| Ruhezustand | 0 | voller Text, Cursor blinkt (500 an / 500 aus) |
| Tap Replay | ~850 (im Video) | Text sofort geleert, 1. Zeichen erscheint sofort |
| Tippen | 31 x 65 = ~2000 | je 65 ms ein Zeichen, linear (kein Easing, kein Jitter erkennbar), Text bleibt waehrend des Tippens zentriert (waechst symmetrisch) |
| Fertig | ~2900 | letztes "." -> Cursor blinkt weiter |

Zeichenanzahl = floor(elapsed / 65) + 1. Keine Opacity-/Blur-/Translate-Animation pro Zeichen erkennbar (harter Einsatz).

## Motion-Tokens
- `--ms-per-char: 65` (linear, zeitbasiert), `--start-delay: 0`
- Cursor: 2 px breit, `--caret-blink: 1000` ms (steps, 50 % an), waehrend des Tippens solid
- Button-Press: scale .95, 120 ms cubic-bezier(.2,.8,.2,1) (im Video nicht erkennbar, dezente Annahme)

## Look-Tokens
- Buehne `#131313`; Text `#fafafa`, 500-600er Gewicht, ~30 px (Referenz 1234x673), Inter/Geist/Roboto-artig
- Button 64x32 px, Radius 8, `#494949`, Text 12 px / 500, `#f2f2f2`
- Cursor `#fafafa`, Hoehe ~1.05em

## Interaktion & Barrierefreiheit
- Ausloeser: Tap/Klick auf native `<button>` (Maus, Touch, Tastatur Enter/Space); Fokusring sichtbar
- Zeile hat `aria-label` mit dem vollen Text, Cursor `aria-hidden`; `prefers-reduced-motion`: Text erscheint sofort komplett, Cursor blinkt nicht

## 120 Hz
- Nur rAF mit Zeitstempel; Zeichenzahl aus `floor(elapsed/msPerChar)`, Textknoten wird nur bei Aenderung gesetzt (~15 DOM-Writes/s); Cursor-Blinken per CSS-Animation (Compositor); keine Layout-Lesezugriffe pro Frame; Button nur transform.
- check120: `VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine` (p95 2.4 ms bei 4x Drosselung; INFO zu getComputedStyle = einmalig beim Init).

## Einbindung
`assets/text-animate.html`: Marker COMPONENT:START/END, CSS-Block "COMPONENT CSS", CONFIG ganz oben.
`initTextAnimate(rootEl, {text, msPerChar, startDelay, autoplay, onDone})` -> `{replay, finish, destroy}`. Markup: `.ta > .ta__line[data-text]` + `.ta__btn`. Ohne Button ueber `replay()` selbst triggerbar (z. B. IntersectionObserver, Scroll).

## Vermuteter Original-Stack -> React/Framer-Motion
Vermutlich eine `TextAnimate`-Komponente mit per-Zeichen-Variants und Stagger; hier harter Einsatz:
```tsx
const chars = text.split("");
<motion.span key={replayKey} initial="hidden" animate="show"
  variants={{ show: { transition: { staggerChildren: 0.065 } } }}>
  {chars.map((c,i)=><motion.span key={i} variants={{hidden:{display:"none"},show:{display:"inline"}}}>{c}</motion.span>)}
</motion.span>
// Replay: setReplayKey(k => k+1); Cursor: <span className="animate-pulse w-0.5 h-[1.05em] bg-white"/>
```
## Kreativ remixen
1. msPerChar auf 25-35 + zufaelliger Jitter (+-40 %) fuer "Hacker/KI-streamt"-Gefuehl; an Satzzeichen 250 ms Pause.
2. Pro Zeichen kurzer Blur/Scale-Pop (blur 6px->0, scale 1.15->1, 140 ms) statt hartem Einsatz, Cursor mit Glow.
3. Rueckwaerts loeschen (Backspace) und naechsten Claim tippen: Rotation von 3-4 Taglines in Endlosschleife.
4. Mit Scroll/IntersectionObserver starten; Tippen an Scroll-Fortschritt koppeln (scrub).
5. Kombi: Tipp-Ton/Haptik (navigator.vibrate(5) pro Zeichen), Gradient-Text mit mitlaufendem Leuchtpunkt am Cursor.

## Bekannte Abweichungen
- Schrift im Video wirkt wie Roboto/Inter (Gewicht 500-600); Nachbau nutzt Systemstack, Breite kann abweichen (Video: Text 411 px breit).
- Exakter Tipp-Start (~0.85 s) und Cursor-Verhalten waehrend des Tippens (solid vs. Blinken) nur grob aus 40-fps-Messung ablesbar.
- Button-Hover/Press-Zustand und Ladeverhalten beim ersten Seitenaufruf nicht im Video sichtbar (dort Startzustand = fertiger Text).
