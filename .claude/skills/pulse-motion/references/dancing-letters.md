# Dancing Letters (dancing-letters)
> Grosses Wort "ANIMATE": Buchstaben in der Naehe des Zeigers springen federnd weg (kleiner, hoeher/tiefer, teils gekippt), bleiben ca. 1.4 s verrutscht und gleiten dann weich zurueck.

## Wann einsetzen
- Hero-Wort / Markenname, das beim Beruehren "lebendig" wird, Wow beim ersten Hover/Touch
- Playful Brand, Kreativ-Agentur, Kinder-/Spiele-/Musik-Seiten, 404-Seite
- Ladescreens, Easter Eggs, Cursor-Naehe-Effekte auf Text
- Dunkle Buehne, ein fettes Wort, keine weiteren Elemente
- EN: dancing letters, playful hover text, per-letter spring, scatter letters, kinetic typography, text physics

## Anatomie & Zeitleiste
Jeder Buchstabe ist ein eigener inline-block-Span (transform: translateY, rotate, scale) mit eigener Feder. Treffer = Zeiger naeher als ~95 px an der Buchstabenmitte (Aufnahme: Zeiger 80 px ueber dem Wort reicht).

| Phase | Zeit (ms) | Beschreibung |
|---|---|---|
| Ruhe | bis Beruehrung | Wort sauber, mittig |
| Wegspringen | ca. 100-150 | zufaelliges Ziel: Scale 0.5-1.1, y bis ca. +/-0.3 em, selten Kippen bis ca. 35 Grad; im Video M/A ca. 60 ms nach Beruehrung auf ~0.5 geschrumpft |
| Halten | ~1400 nach letztem Kontakt | Buchstabe bleibt verrutscht; neuer Wurf alle >=420 ms solange der Zeiger nah ist |
| Zurueck | ca. 1000 | weiche Feder, Ende mit leichtem Nachschwingen (M im Video) |

Videozeiten: erster Kontakt ca. 2.1 s, Zeiger nach ca. 3.0 s am E, Rueckkehr ab ca. 6.4 s.

## Motion-Tokens
- kick-Feder: k 520, c 20 (schnell, ~1 leichter Overshoot)
- back-Feder: k 26, c 8 (zeta ~0.8, ~1 s)
- radius 95 px, holdMs 1400, cooldownMs 420
- scale 0.5-1.12, yMax 0.34 em, rotMax 34 Grad (80 % der Wuerfe nur ~10 % davon)

## Look-Tokens
- Buehne #131313, Buchstaben #EDEDED
- Schrift fett (800), Versalhoehe 70 px bei 1234x673 -> font-size 96 px, Laufweite ca. -0.02em, Inter/Roboto-artig
- Wort mittig, keine Rahmen/Schatten/Glow

## Interaktion & Barrierefreiheit
- Maus-Hover und Touch-Wischen (pointermove, touch-action: none); Video ist eine Touch-Aufnahme mit Zeigerpunkt
- role="img" + aria-label = Wort, Buchstaben aria-hidden
- prefers-reduced-motion: keine Animation (Wort bleibt statisch)
- Tastatur: nicht noetig (dekorativ); API poke(i) fuer Programm-Ausloesung

## 120 Hz
- rAF mit Zeitstempel, dt = min(t-last, 50); Federn semi-implizit mit festem Substep 1/240 s per Akkumulator
- Nur transform; will-change nur bei Aktivitaet; Rects einmal gemessen (Enter/Resize); pointermove nur gemerkt, 1x pro Frame angewendet; Loop stoppt im Leerlauf; DOM nur bei geaendertem Wert
- check120: VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine (4x: p95 2.7 ms, p99 4.4 ms, 0 % ueber Budget, Script 0.1 ms/Frame). Einziger INFO-Hinweis: Layout-Lesezugriffe nur in measure() (nicht pro Frame).

## Einbindung
`assets/dancing-letters.html`: Block COMPONENT:START..END und `/* COMPONENT CSS */` uebernehmen, dann
`initDancingLetters(el, {text, radius, holdMs, cooldownMs, kick:{k,c}, back:{k,c}, scale:[min,max], yMax, rotMax})` -> `{destroy, poke(i)}`.
CSS-Variablen oben: --font-size, --radius, --hold-ms, --kick-k/-c, --back-k/-c, --scale-min/-max, Farben.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich pro Buchstabe ein `motion.span` mit onHoverStart/Proximity, Zufallswerten und Timeout zurueck zum Ruhezustand:
```jsx
<motion.span animate={hit ? {y, rotate, scale} : {y:0, rotate:0, scale:1}}
  transition={hit ? {type:"spring", stiffness:520, damping:20}
                  : {type:"spring", stiffness:26, damping:8}} />
```
(Framer-stiffness/damping nehmen mass 1; Werte entsprechen den Tokens oben.)

## Kreativ remixen
1. Radius auf 200 px + holdMs 3000: Wort zerfaellt beim Anfassen komplett, setzt sich langsam wieder zusammen.
2. Zufall durch Geschwindigkeit des Zeigers skalieren (schneller Wisch = grosse Rotation, Streuung wie Konfetti).
3. Mit Text-Morphing kombinieren: Wort wechselt, Buchstaben tanzen beim Wechsel mit Stagger.
4. Scroll-Trigger: Buchstaben fallen beim Eintritt in den Viewport mit kick-Feder k 200/c 8 (Bounce) herein.
5. Farbe pro Wurf (Akzent-Hue je Buchstabe) plus Glow per filter: drop-shadow nur waehrend des Halte-Phase.

## Bekannte Abweichungen (ehrlich)
- Zufallswerte, Radius, Haltedauer und Federn sind gefittet; exakte Verteilung/Algorithmus des Originals nicht erkennbar (evtl. distanzabhaengig statt Zufall).
- Warum Buchstaben beim Zeiger-Verweilen am E leicht weiterwandern, ist nicht eindeutig; hier: Neuwurf nach Cooldown.
- Schrift: im Test-Chromium nur Fallback-Font (breiter, 471 vs. 429 px); mit Inter/Roboto naeher am Video.
- Seitliche Verschiebung (x) wurde im Video nicht erkannt und fehlt. Timing im Vergleich nur per Kontaktblatt, nicht Frame-genau.
