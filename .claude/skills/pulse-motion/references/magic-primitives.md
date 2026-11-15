# Magic Primitives (magic-primitives)
> Acht beliebte Effekte aus Magic UI als Vanilla-HTML/CSS: Shimmer Button, Meteors, Marquee, Shine Border, Ripple, Animated Gradient Text, Shiny Text, Aurora Text.

**Quelle:** Magic UI, github.com/magicuidesign/magicui (MIT, Commit efe76fc, 2026-10-17). Keyframes und Zahlen aus deren `globals.css` und Komponenten übernommen; Struktur als eigene Vanilla-Umsetzung (kein React, kein Tailwind). Kein Video-Vergleich, Optik ähnlich bis gleich.

## Wann einsetzen
- Premium-CTA (Shimmer), „Vertrauen/Partner“-Streifen (Marquee), Hero-Hintergrund (Meteors, Ripple), Highlight-Karte (Shine Border), Überschrift-Akzent (Gradient/Shiny/Aurora Text)
- Wenn die Seite **kein React** hat oder jede Abhängigkeit vermieden werden soll
- EN: shimmer button, meteor shower, marquee, animated border, ripple background, gradient text, shiny text, aurora text

## Effekte und Token
| Effekt | Mechanik | Token (CSS-Variablen) | 120-Hz-Charakter |
|---|---|---|---|
| Shimmer Button | Funke aus Conic-Verlauf rotiert (`spin-around`, 2×Speed) und gleitet seitlich (`shimmer-slide`, alternate) | `--shimmer-color --speed(3s) --radius --cut(.05em) --bg` | transform, Compositor |
| Meteors | ein Punkt + 50px-Schweif, `translateX(-500px)` gedreht, Opazität 1→0 ab 70 % | `number(20) minDelay(.2) maxDelay(1.2) minDuration(2) maxDuration(10) angle(215)` | transform/opacity |
| Marquee | 4 Spuren, `translateX(-100% - gap)` linear | `--duration(40s) --gap(1rem)`, `.is-reverse .is-pause .is-vertical` | transform |
| Shine Border | Radial-Verlauf 300 %, Position wandert, per Maske nur als Rand | `--border-width(1px) --duration(14s) --shine` | **background-position (Paint)**, klein halten |
| Ripple | Ringe `mainCircleSize 210 + i*70`, Opazität −.03 je Ring, Scale 1↔.9, Verzögerung .2 s·i | `mainCircleSize mainCircleOpacity numCircles(8)` | transform |
| Gradient Text | `background-position` 8 s linear | `--color-from(#ffaa40) --color-to(#9c40ff) --bg-size(300%)` | Paint, nur kurze Texte |
| Shiny Text | Glanz 100px, 8 s, nur 30–60 % der Zeit sichtbar | `--shiny-width` | Paint, kurze Texte |
| Aurora Text | Verlauf 200 %, ±5° Rotation, Scale .9–1.1, 10 s | `--aurora-speed`, 4 Farben | Paint + transform |

## Einbindung (assets/magic-primitives.html)
Block „COMPONENT CSS“ (nur den gewünschten Effekt) und bei Meteors/Ripple/Marquee den JS-Helfer kopieren: `initMeteors(el, opts)`, `initRipple(el, opts)`, `initMarquee(el, items)`.

## Messung (check120, Headless, 4× CPU-Drosselung)
Gesamte Demo mit allen 8 Effekten gleichzeitig: **p95 3.6 ms ungedrosselt, 10.4 ms bei 4× CPU-Drosselung, Schwelle 10.4 ms → „ok“**. Die Lint-Warnungen (box-shadow-Transition am Button, `style.left` bei Meteors) sind einmalig/klein und bewusst. Echtes 120-Hz-Gerät **nicht geprüft**.

## Barrierefreiheit
`prefers-reduced-motion`: alle Animationen aus, Meteors ausgeblendet. Aurora Text hat einen `sr-only`-Text, die animierte Kopie ist `aria-hidden`.

## Original-Bibliothek (React) — wenn exakt gewünscht
`npx shadcn@latest add @magicui/shimmer-button` (analog `meteors`, `marquee`, `shine-border`, `ripple`, `animated-gradient-text`, `animated-shiny-text`, `aurora-text`). Magic UI hat 70+ weitere Komponenten (Bento Grid, Dock, Particles, Globe …); ihr eigenes Skill liegt unter `.claude/skills/magic-ui`. In React-Projekten die Bibliothek bevorzugen.

## Bekannte Abweichungen
- Spark-Container nutzt Container-Query-Einheiten (`cqw/cqh`, moderne Browser).
- Meteors-Startpunkte werden aus der Containerbreite berechnet (Original: Fensterbreite).
- Nicht nachgebaut: Rainbow/Pulsating Button, Particles, Dot/Grid-Pattern, Number Ticker, Word Rotate, Blur Fade, Spinning Text, Text Reveal.
