# Motion Footer (motion-footer)

> Scroll-Reveal-Footer: ein dunkler "Vorhang" (Hero "SCROLL DOWN TO REVEAL" mit gerundeten unteren Ecken) scrollt nach oben weg und gibt einen darunter festgepinnten Footer frei; ab ~72 % Scrollweg blendet "Ready to begin?" ein, danach gestaffelt Download-Buttons, Link-Pills und ein leicht geneigtes, endlos laufendes Ticker-Band.

Quelle: 21st.dev-Vorschau "Motion Footer" (Marke "Volvox"), rekonstruiert aus einer Touch-Aufnahme (Samsung Browser, 120 Hz). Datei: `assets/motion-footer.html`.

## Wann einsetzen
- Footer/Abschluss-CTA einer Landingpage mit "Wow" beim Ankommen am Seitenende - reveal footer, curtain footer
- App-Download-Sektion (iOS/Android) am Seitenende - app download CTA
- Seitenuebergang "Hero hebt ab, darunter wartet der naechste Block" - sticky reveal, curtain scroll
- Ticker/Marquee mit Claims (Features, Werte, Partner) in leichter Schraeglage - tilted marquee, brand ticker
- Dunkle, ruhige Premium-Seiten (SaaS, Apps, Studios) - dark neumorphic pills
- EN: scroll reveal, sticky footer, staggered fade-in, infinite marquee, dark UI

## Anatomie & Zeitleiste
Aufbau (Buehne 1234x673, Scroller mit nativem Scrollen): `.mf-curtain` (Buehnenhoehe + 117px, Radius 22px unten, Schatten) liegt ueber `.mf-foot` (`position:sticky; bottom:0`, volle Buehnenhoehe). Scrollweg ~785px. Footer-Inhalt: Riesenwort "SOBERS" + Raster (kaum sichtbar), Headline, 2 Buttons, 3 Pills, Ticker-Band oben, Leiste unten (Copyright | "Crafted with ♥ by Volvox" | Nach-oben-Kreis).

Zeitleiste im Video (Touch-Fling, ms ab Videostart):
| Phase | Zeit | Verhalten |
|---|---|---|
| Ruhe | 0 - 840 | Hero mittig, feiner Strich darunter, Zeiger ruht |
| Scroll 1 | 840 - 1840 | Heading steigt ~295px (Peak ~600px/s bei ~1.4 s), Footer-Leiste wird sichtbar |
| Scroll 2/3 | 1840 - 4200 | Vorhangkante steigt weiter (Kante y: 587 @1.5 s, 414 @2.5 s, 214 @3.3 s, 152 @3.6 s, ~6 @4.2 s) |
| Headline | 3360 - 3700 | Fade 0 -> 1 in ~400 ms, steigt ~27px |
| Buttons/Pills | 3520 - 4640 | Fade ~1.1 s, ease-out (37 % @3.56, 66 % @3.86, 99 % @4.64) |
| Ticker | 4160 - 4800 | gleitet ~50px von unten ein, Neigung ~-3.6deg -> -1.8deg, ~700 ms; danach Drift nach links ~52px/s |
Im Nachbau: Aufdecken bei Scroll >= 72 % (Hysterese: zurueck bei <= 50 %), danach feste Verzoegerungen (0 / 380 / 460 / 800 ms).

## Motion-Tokens
| Token | Wert |
|---|---|
| --mf-ease-out | cubic-bezier(.16,1,.3,1) |
| Headline | 450 ms, delay 0, translateY 27px -> 0, opacity |
| Buttons / Pills | 1100 ms, delay 380 / 460 ms, translateY 14px -> 0, opacity |
| Ticker | 700 ms, delay 800 ms, translateY 50px, rotate -3.6 -> -1.8deg |
| marqueeSpeed | 52 px/s (opts), Schleife nahtlos |
| Hover | translateY -2px, 250 ms |
| Federn | keine erkennbar (Scroll nativ, Einblendungen ease-out) |

## Look-Tokens
| Token | Wert |
|---|---|
| Buehne/Vorhang/Footer | `#1f1f1f` flach |
| Hero | 56px, Gewicht 300, Laufweite 0.3em, Grau `#8d8d8d`, Versal; Strich 1x90px `#2f2f2f` |
| Headline | ~100px, Gewicht 800, -0.055em, `#0d0d0d` (dunkler als Grund) + 2px heller Unterschatten (Plus-Jakarta-artig) |
| Buttons | 232x64 / 268x64 Pill, Rand `rgba(255,255,255,.07)`, Text 17px/600 `#f6f6f6`, Icon `#8f8f8f`, Abstand 18px, dunkler Schatten + heller Schein darunter (`#2b2b2b` gemessen) |
| Pills | 43px hoch, 15px `#a9a9a9`, Abstand 26px |
| Leiste | 13px/500 versal 0.09em; Crafted-Pill 48px hoch, Herz `#ff6b81`, "Volvox" 600 weiss; Kreis 48px |
| Ticker | Band 72px, -1.8deg, Text 15px/600, 0.3em, `#bdbdbd`, Trenner ✦ |
| Hintergrund | Riesenwort ~300px/800 mit 1.5 % Weiss, Raster 128px |

## Interaktion & Barrierefreiheit
- Ausloeser: Scrollen (Touch-Fling/Wheel/Tastatur) im Komponenten-Scroller; Nach-oben-Button scrollt smooth zurueck, Footer blendet wieder aus.
- Scroller `tabindex=0`, `role=region`, aria-label; Links echte `<a>`, Button `<button aria-label>`; Ticker `aria-hidden`.
- `prefers-reduced-motion`: keine Transitions, Ticker steht, alles sofort sichtbar.

## 120 Hz
- Scrollen nativ (Compositor). Einblenden per CSS-Transitions nur auf `transform`/`opacity`. Ticker per rAF mit Zeitstempel (x = Zeit * Speed, dt<=50), nur `transform`, einmal gemessene Schleifenbreite, laeuft nur wenn aufgedeckt und Tab sichtbar. Scroll-Listener passiv, nur Schwellenvergleich.
- check120: `VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine` (4x: p95 2.3 ms, 0.1 % ueber Budget, script 0.05 ms/Frame).

## Einbindung
`assets/motion-footer.html`: Block `<!-- COMPONENT:START/END -->`, `/* COMPONENT CSS */`, `initMotionFooter(root, opts)`; root = Element mit fester Hoehe (z. B. 100vh). Optionen: `revealAt` (0.72), `hideAt` (0.5), `marqueeSpeed` (52), `items` (Ticker-Texte), `onReveal(bool)`. Rueckgabe `{scrollEl, destroy}`. Look/Timing ueber die Variablen oben (`--mf-*`).
Im echten Seitenlayout: Scroller = Seite; Vorhang = `main` mit `z-index:2`, Footer `position:sticky; bottom:0`.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
```jsx
// main: relative z-10 rounded-b-[22px] bg-[#1f1f1f]; footer: sticky bottom-0 h-screen
const { scrollYProgress } = useScroll({ target: ref, offset: ["start start","end end"] });
<motion.h2 initial={{opacity:0,y:27}} whileInView={{opacity:1,y:0}}
  transition={{duration:.45,ease:[.16,1,.3,1]}} />
<motion.div initial={{opacity:0,y:14}} whileInView={{opacity:1,y:0}}
  transition={{duration:1.1,delay:.38,ease:[.16,1,.3,1]}} />
<motion.div className="marquee" animate={{x:["0%","-50%"]}}
  transition={{repeat:Infinity,ease:"linear",duration:loopW/52}} />
```

## Kreativ remixen
1. Ticker auf Scrollgeschwindigkeit koppeln (schneller + staerker geneigt beim Scrollen, Feder zurueck) - marquee velocity skew.
2. Vorhang mit Parallax: Hero-Text skaliert/blur beim Wegscrollen, Footer-Inhalt faehrt von 15 % Tiefe heran.
3. Zweiter Ticker gegenlaeufig, Neigung +1.8deg, kreuzt den ersten (X-Band).
4. Buttons mit Magnet-Cursor und Glow-Puls, sobald aufgedeckt (Wiederholung alle 4 s).
5. Headline-Zeichen gestaffelt (30 ms) mit Blur 12px -> 0 statt Block-Fade; Riesenwort leuchtet beim Aufdecken kurz auf.

## Bekannte Abweichungen (ehrlich)
- Schrift: Original wirkt wie Plus Jakarta Sans (Headline) / Inter; Nachbau nutzt System-Fallback (keine Webfonts), daher breiter/anders.
- Ticker-Texte nach dem 3. Eintrag ("Accountability ...") nicht lesbar; weitere Eintraege erfunden. Riesenwort als "SOBERS" gelesen (sehr kontrastarm, unsicher).
- Genaue Kopplung (scroll-linked vs. Trigger) nicht eindeutig; Nachbau: Schwelle + feste Staffel. Zweistufige Button-Fade-Kurve nur als ein ease-out angenaehert; Neigungs-Verlauf des Tickers geschaetzt.
- Ende des Videos (Seite scrollt in 21st-UI aus der Vorschau) gehoert nicht zur Komponente. Hover/Active-Zustaende im Original nicht erkennbar (Touch).
- Scroll-Physik ist die des Browsers, nicht die des Originals.
