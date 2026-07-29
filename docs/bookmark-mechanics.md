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

## ⏳ Noch ausstehend (vom Auftraggeber angekündigt)
`view-magnifier` (4559) · `reveal-text` (2491) · `container-scroll-animation` (1081)

## ⏳ Noch nicht geliefert
2520 Gradient Selector · 10443 Liquid Metal Button · 13966 MarkerPopup · 990 Dock ·
2591 Glowing Search Bar · 1825 Hero Section 2 · 5508 Shiny Button · 5649 Paper-Shader-Hero ·
2049 Sign In Flow · 3226 Minimal Dock · 1913 Section With Mockup · 8687 Hover Footer ·
2497 Image Auto Slider · 3052 Feature Carousel · 525 Animated Tabs · 9643 Morphing Cursor ·
5625 Shader Animation · 8341 Animated Profile Card

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
