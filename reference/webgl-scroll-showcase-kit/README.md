# WebGL Scroll Showcase Kit

Wiederverwendbares Referenz-Kit für High-End-Produktseiten im Stil von
"ZOI ICE TEA" (dunkles 3D-Morph-Theme) und "DRIP Smart Bottle"
(helles, technisches Light-Theme mit Dark-Mode-Zoom). Steht unabhängig
von der Fahrschul-App in `reference/` und kann in jedes neue
Next.js/React-Projekt kopiert werden.

Kein statisches Bild irgendwo: **alles ist WebGL (Three.js/R3F)**,
Typografie ist ein räumliches Element (liegt hinter 3D-Objekten,
bewegt sich mit Scroll), und Sektionen morphen ineinander statt hart
zu schneiden.

## Tech-Stack

| Zweck | Library | Warum |
|---|---|---|
| 3D-Rendering | `three`, `@react-three/fiber` | React-Bindings für Three.js, deklarativ |
| 3D-Helper | `@react-three/drei` | `useGLTF`, `Environment`, `Float`, `MeshTransmissionMaterial` (Glas/Eis-Look) |
| Scroll-Engine | `gsap` + `ScrollTrigger` | `scrub`-basierte Timelines, robustester Standard für scroll-gebundene Animation |
| Smooth Scroll | `lenis` (`@studio-freight/lenis` / `lenis`) | physikbasiertes butterweiches Scrollen, Pflicht für dieses Feeling |
| Text-Split/Reveal | `gsap/SplitText` (Club-Plugin) oder `split-type` (frei) | Buchstaben-/Wort-weise Reveal-Animationen |
| Mikro-Interaktionen | `framer-motion` | Fades, Layout-Transitions, einfache Parallax-Layer, wenn kein Scrub nötig |
| Styling | Tailwind CSS + CSS-Variablen für Theme-Tokens | schnelle Theme-Shifts (dark→light→dark) |

Installation (Beispiel):
```bash
npm i three @react-three/fiber @react-three/drei gsap lenis framer-motion split-type
```

## Kern-Prinzipien (aus den 3 Referenz-Videos destilliert)

1. **Keine statischen Bilder** – Produkte sind 3D-Modelle (GLB/GLTF), die auf
   `scrollProgress` reagieren: Rotation, Scale, Position auf der Z-Achse.
2. **Typografie als räumliches Element** – große Hintergrundschrift liegt
   *hinter* dem 3D-Canvas (niedrigerer z-index), fadet/verblasst separat.
3. **Nahtloses Morphing statt Schnitten** – Sektionsübergänge sind
   `scrub`-Timelines, keine harten `IntersectionObserver`-Sprünge.
   Hintergrundfarben/-blur werden per GSAP-Timeline interpoliert, nicht
   per CSS-Klassenwechsel.
4. **Kamerazoom als Theme-Switch** – ein schneller Zoom in ein Detail ist
   der Trigger für den Dark/Light-Wechsel (siehe `BackgroundModeSwitch.tsx`).
5. **Mikro-Animationen überall** – sanfte Y-Achsen-Einblendungen, Glow via
   `box-shadow`/`filter: drop-shadow`, nie abrupt.

## Datei-Mapping: Video-Moment → Komponente

| Beobachtung aus dem Video | Datei |
|---|---|
| Lenis+GSAP Grundgerüst, ScrollTrigger-Sync | `lib/lenis-gsap-setup.tsx` |
| Eiswürfel→Dose Morph, Flasche Rotation/Scale beim Scroll | `components/ScrollDriven3DHero.tsx` |
| "EXPERIENCE" faded mittig ein, "Drink Freeze" Hintergrundschrift verblasst | `components/SplitTextReveal.tsx` |
| Blaues Masonry-Raster aus "Erinnerungsfragmenten" | `components/MasonryFadeGrid.tsx` |
| "South Africa" horizontaler Slider + Progress-Bar unten | `components/HorizontalScrollSection.tsx` |
| Schwarz→Rot-Orange radialer Verlauf im Finale / Beige→Schwarz Zoom bei DRIP | `components/BackgroundModeSwitch.tsx` |
| Flaschendeckel hebt ab, Texte links/rechts wechseln (Produktdemontage) | `components/ExplodedProductView.tsx` |
| Violette konzentrische Halbkreise als "Schallwelle" (Akku-Kapazität) | `components/PulseRings.tsx` |
| Drei Bildkarten sliden mit Parallax von unten über die Schrift | `components/ParallaxCardStack.tsx` |

## Recherchierte Quellen (echte Beispiele, keine Erfindungen)

**21st.dev** (Component-Marktplatz, React+Tailwind):
- [Reveal Text](https://21st.dev/community/components/isaiahbjork/reveal-text/default) – Buchstaben-Reveal mit Spring + Hover-Image-Mask
- [Modern Hero](https://21st.dev/community/components/uniquesonu/modern-hero) – Lenis + Framer Motion Parallax-Hero
- [Halide Topo Hero](https://21st.dev/community/components/shivendra9795kumar/halide-topo-hero/default) – monochromes 3D-Hero mit Parallax-Layern
- [3D Marquee](https://21st.dev/community/components/Shatlyk1011/3d-marquee) – rotierender 3D-Bilderlauf
- [Hero Parallax (Aceternity)](https://21st.dev/community/components/aceternity/hero-parallax/default)
- [Pixel Perfect Hero](https://21st.dev/community/components/easemize/pixel-perfect-hero/default) – Canvas-Pixel-Ripple + Glassmorphism-Header
- Browse-Kategorien: [Hero-Komponenten](https://21st.dev/community/components/s/hero) · [Feature-Komponenten](https://21st.dev/community/components/s/features)

**Tutorials/Code-Referenzen für Scroll-3D:**
- [Codrops – Reactive Depth: Scroll-Driven 3D Image Tube mit R3F](https://tympanus.net/codrops/2026/02/17/reactive-depth-building-a-scroll-driven-3d-image-tube-with-react-three-fiber/)
- [Codrops – Cinematic 3D Scroll Experiences mit GSAP](https://tympanus.net/codrops/2025/11/19/how-to-build-cinematic-3d-scroll-experiences-with-gsap/)
- [Wawa Sensei – R3F Scroll Animations Tutorial](https://wawasensei.dev/tuto/react-three-fiber-tutorial-scroll-animations)
- [Scroll-Driven Presentation in Three.js mit GSAP (Medium)](https://medium.com/@pablobandinopla/scroll-driven-presentation-in-threejs-with-gsap-a2be523e430a)
- [three.js forum – Cinematic 3D Scroll Experience Showcase](https://discourse.threejs.org/t/cinematic-3d-scroll-experience-r3f-gsap/92558)
- [Lenis (offizielles Repo, darkroomengineering)](https://github.com/darkroomengineering/lenis)
- [Codrops – Seamless Infinite Scroll mit GSAP & Lenis](https://tympanus.net/codrops/2026/05/28/the-never-ending-story-building-a-seamless-infinite-scroll-experience-with-gsap-lenis/)
- [GSAP Forum – Horizontal Scroll + Progress Bar](https://gsap.com/community/forums/topic/30699-progress-bar-and-horizontal-section-sequences/)
- [CodePen – Scroll progress & GSAP ScrollTrigger](https://codepen.io/GreenSock/pen/GRovmpJ)
- [CodePen – Horizontal Scroll with GSAP (pin + xPercent + snap)](https://codepen.io/oldskool123/pen/mdrrbyo)
- [devdojo – Exploded View eines 3D-Modells mit R3F](https://devdojo.com/amp/axiome/exploded-view-of-a-3d-model-using-react-three-fiber)
- [Codrops – SplitText/MorphSVG kreative Demos](https://tympanus.net/codrops/2025/05/14/from-splittext-to-morphsvg-5-creative-demos-using-free-gsap-plugins/)

## Farbsystem der beiden Referenzprojekte (als CSS-Variablen-Tokens)

```css
/* ZOI ICE TEA – dark, kühl→warm */
--zoi-bg-black: #05070a;
--zoi-ice-blue: #7fd8ff;
--zoi-teal: #0a3d3a;
--zoi-warm-orange: #ff5a1f;
--zoi-warm-red: #d81e1e;

/* DRIP Smart Bottle – light, technisch */
--drip-bg-beige: #efe9e1;
--drip-ink-black: #0c0c0d;
--drip-neon-violet: #9b5cff;
--drip-dark-bg: #050505; /* Umschaltet beim Zoom-Trigger */
```

## Nächste sinnvolle Ergänzungen (für später vorgemerkt)

- Shader-Material für den fotorealistischen Eiswürfel (`MeshTransmissionMaterial`
  aus drei, refractionRatio + roughness tunen für "Frost"-Look)
- `useGLTF.preload()` + Draco-Kompression für schnelle Ladezeiten der 3D-Modelle
- Scroll-gebundener `Environment`-Preset-Wechsel (drei) für Reflexionen bei
  Theme-Switch
- Page-Transition-Layer (View Transitions API) für Mehrseiten-Varianten
