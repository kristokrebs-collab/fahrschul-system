# 21st.dev Bookmarks — Mechanik-Spezifikation für den 1:1-Port

**Portierungsregel:** JSX → DOM, Tailwind → äquivalentes CSS, Framer-Motion/GSAP-Werte
→ identische Zahlen in CSS/WAAPI/GSAP. **Werte werden nicht verändert.**
Die visuelle Hülle (Farbe, Schrift, Radius, Korn) kommt aus dem Krebs-Designsystem.

Kein shadcn/Tailwind/TypeScript-Setup: Das Projekt ist eine einzelne Vanilla-HTML,
die per Doppelklick offline läuft. Die 21st.dev-Installationsanleitung ist für
React-Projekte gedacht und hier bewusst nicht anwendbar.

---

## ✅ #12213 — Hero Scrub  (Quelle: get_component, liegt vor)

| Konstante | Wert |
|---|---|
| PIN_VH_MULTIPLE | 3.2 → Sektionshöhe `(3.2+1)*100 = 420vh` |
| IMMERSE_OVERFILL | 1.04 |
| ENTRY_DELAY | 0.2 |
| CARD_START_SCALE | 0.6 Desktop / 0.82 Mobil (<768px) |

**Entry-Timeline** (delay 0.2)
```
bg      from opacity 0, dur 1.4,  ease power2.out,  @0
card    from opacity 0, dur 1.1,  ease power3.out,  @0.35
titleTop   from opacity 0 y  30, dur 1, ease expo.out, @0.5
titleBottom from opacity 0 y -30, dur 1, ease expo.out, @0.62
```

**ScrollTrigger** `start "top top"`, `end "bottom bottom"`, `scrub 0.4`, `invalidateOnRefresh true`
**Frame-Mapping** `mapped = clamp(0,1,(p-0.15)/0.63)` · `idx = min(count-1, floor(mapped*count))`

**Master-Timeline**
```
@0     card  scale→1              ease power2.out  dur 0.15
@0     titleTop x→-60vw (-70vw mobil), letterSpacing 0.02em, power2.inOut, 0.15
@0     titleBot x→+60vw (+70vw mobil), letterSpacing 0.02em, power2.inOut, 0.15
@0.15  card  scale→immerseScale   ease power2.in   dur 0.63
@0.15  titles opacity→0           ease power1.in   dur 0.22
@0.78  card  scale→startScale     ease power3.inOut dur 0.22
@0.78  titles x→0 opacity→1 letterSpacing -0.04em, power2.inOut, 0.22
```
`immerseScale = max(vw/baseW, vh/baseH) * 1.04`
`baseW = min(vw*0.96, vh*0.72*aspect)` · `baseH = min(vh*0.72, vw*0.96/aspect)`

**Frame-Laden** 20 initial (`fetchPriority high` für i<4), dann Batches à 20 alle 80 ms,
Start nach 200 ms · **Fallback** 5 Fehler ODER 4500 ms ohne Frame 0 → statisches Poster
**drawFrame** sucht bei fehlendem Frame nach außen den nächsten geladenen; überspringt Redraw

**Titel** `clamp(3.75rem,12vw,11rem)`, `line-height .85`, `letter-spacing -.04em`
> Angepasst im Krebs-Build: `clamp(2.9rem,9.4vw,8.4rem)` — Begründung siehe Abweichungsprotokoll.

**Einbauort:** Hero, Kapitel 01

---

## ✅ #5189 — Interactive Image Accordion  (Quelle: vom Auftraggeber geliefert)

| Eigenschaft | Wert |
|---|---|
| Höhe | 450px |
| Breite aktiv | 400px |
| Breite inaktiv | 60px |
| Transition | `all 700ms ease-in-out` |
| Radius | `rounded-2xl` (16px) |
| Overlay | schwarz 40% |
| Start-Index | 4 |
| Auslöser | `onMouseEnter` |

**Caption**
```
aktiv:   bottom 24px, left 50%, translateX(-50%), rotate(0deg)
inaktiv: bottom 96px, left 50%, translateX(-50%), rotate(90deg)
transition: all 300ms ease-in-out
```
**Einbauort:** Fahrzeugwelten (Pkw · Zweirad · Lkw · Bus · Beruf)
**Hüllen-Mapping:** Unsplash-Bilder → echte Fahrzeug-Keyvisuals; weißer Grund → Krebs-Bühne;
`text-gray-900` → `--chalk`; Button `bg-gray-900` → Krebs-Rot-CTA.
**Ergänzung Barrierefreiheit:** zusätzlich `onFocus`/Tastatur, da `onMouseEnter` allein
nicht bedienbar ist (Mechanik bleibt identisch, wird nur zusätzlich ausgelöst).

---

## ✅ #4582 — Minimalist Hero  (Quelle: vom Auftraggeber geliefert)

**Motion-Werte** (Framer Motion → identisch in GSAP/WAAPI)
```
Logo       opacity 0, x -20  →  dur 0.5
Haupttext  opacity 0, y  20  →  dur 0.6, delay 1.0
Kreis      scale 0.8, opacity 0 → scale 1, dur 0.8, ease [0.22,1,0.36,1], delay 0.2
Bild       opacity 0, y  50  →  dur 1.0, ease [0.22,1,0.36,1], delay 0.4, scale 1.5
Rechts-Typo opacity 0, y 20  →  dur 0.6, delay 1.2
Social     opacity 0, y 20   →  dur 0.5, delay 1.2
Ort        opacity 0, y 20   →  dur 0.5, delay 1.3
```
Typo rechts: `text-7xl / md:text-8xl / lg:text-9xl`, `font-extrabold`
Kreis: 300px / md 400px / lg 500px

**Einbauort:** Unterseiten-Hero (z. B. /handicap, /simulator)
**Hüllen-Mapping — bewusste Abweichung:** Der gelbe Kreis (`bg-yellow-400/90`) wird
**nicht** als 500px-Fläche übernommen. Das Krebs-Briefing schreibt vor: „Gelb bleibt
mikroskopisch — Detail, nie dritte Flächenfarbe." Der Kreis wird deshalb zur
dunklen Bühnenfläche mit rotem Lichtrand; das Gelb bleibt dem Logo-Doppelstrich
vorbehalten. **Die Motion-Werte bleiben unverändert.**
**Easing-Hinweis:** Diese Komponente nutzt `[0.22,1,0.36,1]`, das Projekt sonst
`cubic-bezier(0.16,1,0.3,1)`. Für die Komponente gilt 1:1 → Originalwert bleibt.

---

## ⏳ Noch nicht geliefert
13966 MarkerPopup · 990 Dock · 1825 Hero Section 2 · 5508 Shiny Button ·
5649 Paper-Shader-Hero · 2049 Sign In Flow · 3226 Minimal Dock · 8687 Hover Footer ·
2497 Image Auto Slider · 3052 Feature Carousel · 525 Animated Tabs · 9643 Morphing Cursor ·
5625 Shader Animation · 8341 Animated Profile Card · 4559 View Magnifier ·
2491 Reveal Text · 1081 Container Scroll Animation

---

## ✅ #10443 — Liquid Metal Button  (Quelle: get_component)

**Abhängigkeit:** `@paper-design/shaders` (WebGL) — muss lokal aus npm eingebettet werden.
Deckt vermutlich auch #5649 Paper-Shader-Hero ab (gleiche Bibliothek).

| Maß | Text-Variante | Icon-Variante |
|---|---|---|
| äußere Box | 142 × 46 | 46 × 46 |
| innere Fläche | 138 × 42 | 42 × 42 |
| Radius | 100px | 100px |

**Shader-Parameter (unverändert übernehmen)**
```
u_repetition 4 · u_softness 0.5 · u_shiftRed 0.3 · u_shiftBlue 0.3
u_distortion 0 · u_contour 0 · u_angle 45 · u_scale 8 · u_shape 1
u_offsetX 0.1 · u_offsetY -0.1 · Grundgeschwindigkeit 0.6
```
**Geschwindigkeitswechsel** hover → 1 · leave → 0.6 · click → 2.4, nach 300 ms zurück

**3D-Schichtung** (perspective 1000px)
```
Beschriftung  translateZ(20px)   Innenfläche  translateZ(10px)
Schattenlage  translateZ(0)      Button-Hit   translateZ(25px)
```
**Transition** `all 0.8s cubic-bezier(0.34,1.56,0.64,1)`
**Gedrückt** `translateY(1px) scale(0.98)` + inset-Schatten
**Ripple** 20px Kreis, `scale(0)→scale(4)`, `opacity .6→0`, `0.6s ease-out`, Entfernung nach 600 ms
**Innenfläche** `linear-gradient(180deg,#202020 0%,#000 100%)`

**Einbauort:** Primär-CTAs
**Hüllen-Mapping:** Beschriftung `#666` → `--chalk`; Metall-Shader bleibt, bekommt aber
den Krebs-Rotstich über einen Overlay-Tint statt eigener Shader-Farbe (Mechanik unverändert).

---

## ⚠️ #2591 · #1913 · #2520 — aus dem CLI-Befehl gebaut, nicht aus dem Quellcode

Du hast am 29.07. sechs `npx shadcn@latest add …`-Befehle geschickt. Drei davon
waren bereits verbaut (Hero Scrub, Liquid Metal Button, Image Accordion), drei
nicht. Für diese drei **liegt mir der Originalcode nicht vor**:

| Weg | Ergebnis |
|---|---|
| `npx shadcn add` ausführen | ruft `21st.dev` auf → aus dieser Umgebung 403 (Proxy-Policy) |
| MCP `get_component` | Free-Tier: 2 Abrufe/Tag, heute 0 übrig (`get_usage` bestätigt) |
| Direkter Abruf (curl/WebFetch) | 403 |

**Konsequenz, klar benannt:** Die drei folgenden Komponenten sind
**nachgebaut**, nicht 1:1 portiert. Mechanik und Maße stammen aus dem
dokumentierten Verhalten der Komponenten, nicht aus ihrem Quelltext. Sobald der
Originalcode vorliegt (Copy-Code aus dem Browser oder ein 21st.dev-Upgrade),
gleiche ich die Zahlenwerte an — der Einbauort bleibt derselbe.

### #2591 — Animated Glowing Search Bar (`minhxthanh`)
**Einbauort:** Kapitel 02, Klassen-Finder über dem Accordion
```
Ring      conic-gradient(from 0deg, transparent 0 52%, red 66%, gold 76%, red-lit 86%, transparent 97%)
          Element 210% breit, aspect-ratio 1, zentriert, rotate 1turn / 4.6s linear infinite
Halo      identische Kopie, inset -9px, blur(15px), opacity .42
Fokus     Halo opacity .9, Umlaufzeit 1.9s
Feld      Höhe 60px, radius 100px, Grund var(--ink2)
Liste     max. 6 Treffer, radius 16px, Zeilen 14/20px, Trennlinie var(--line)
```
**Funktion:** Der Finder ist nicht dekorativ — Eingabe filtert 13 echte Klassen
(B, BF17, B197, BE/B96, Mofa/AM/A1, A2/A, C1/C1E, C/CE, D/DE, BKF, ADR, Stapler,
Handicap) und springt bei Auswahl auf die passende Kachel im Accordion.
Tastatur: `Enter` = erster Treffer, `↓` = in die Liste, `Esc` = schließen.

### #1913 — Section With Mockup (`aghasisahakyan1`)
**Einbauort:** Kapitel 03, Schaufenster für das Krebs-Cockpit
```
Grundriss   Text 1.02fr / Bühne .98fr, gap clamp(30px,6vw,86px), ab 900px einspaltig
Rückebene   min(360px,80%) × 440px, radius 26px, Verlauf rot→transparent
            Scroll: xPercent 14 konstant, yPercent 10 → −20, rotation 9° → 3°, scrub .6
Gerät       min(310px,74vw), aspect 310/634, radius 42px, gegenläufig yPercent 7 → −7
Glow        min(420px,92%) Kreis, blur(26px), rot 24 %
```
**Bewusste Abweichung:** Das Original setzt zwei **Bilder** übereinander. Hier ist
das Gerät echtes Markup (Rahmen, Notch, Fortschrittsring 78 %, fünf Balken,
Statuszeile). Gründe: bleibt bei jeder Auflösung scharf, braucht keine Bilddatei,
funktioniert offline. Die Bewegungsmechanik der beiden Ebenen bleibt erhalten.
Die Balken füllen sich einmalig bei Sichtbarkeit (IntersectionObserver, 1.1s).

### #2520 — Gradient Selector Card (`isaiahbjork`)
**Einbauort:** Kapitel 04, Wahl des Ausbildungswegs
```
Raster      4 Spalten → 2 ab 1080px → 1 ab 560px, gap 14px
Karte       radius 18px, padding 26/24/30, Grund var(--ink2), border var(--line)
Zeiger      --x/--y aus pointermove → radial-gradient(240px circle at var(--x) var(--y),
            rgba(225,10,23,.26), transparent 72%), opacity 0→1 in .4s
Gewählt     Verlaufsrand über mask-composite: linear-gradient(140deg, red, gold 46%, red-lit),
            padding 1px, opacity .45s; Punkt rechts oben rot mit 12px Glow
Hover       translateY(−4px), .5s
```
**Semantik:** `role="radiogroup"` mit vier `role="radio"`-Karten, Roving-Tabindex,
Pfeiltasten wechseln. Die Wahl filtert das Leistungsband darunter
(Erster Führerschein · Erweiterung · Beruf & Gewerbe · Seminare & Individuell) —
19 echte Leistungen, keine erfundenen Preise.
