---
name: motion-js
description: Motion (motion.dev, frueher Framer Motion, MIT) - die Animations-Bibliothek fuer JavaScript, React und Vue mit Hardware-Beschleunigung (WAAPI), Federn, Stagger, Scroll- und Sichtbarkeits-Animationen, Gesten, Layout-Animationen und Exit-Animationen. Nutze bei "Motion", "Framer Motion", "motion/react", "animate()", "AnimatePresence", "whileHover", "layout animation", "Feder-Animation in React", "Scroll-Animation ohne GSAP", "Exit-Animation", "Liste animiert ein/aus". Liefert Installation (npm oder CDN mit fester Version), die Kern-API in einem Blick und die Hausregeln (Eintritt ease-out, Austritt ease-in, Interface als Feder mit leichtem Overshoot, nichts linear, reduced motion). EN: motion.dev, framer motion, react animation library, spring animation, gesture animation, layout animation, scroll linked animation, exit animation.
---

# Motion (motion.dev)

Quelle: github.com/motiondivision/motion, MIT (siehe `LICENSE-motion-MIT.md`). Stand der Pruefung: Version **14.14.0**.
Fuer Details zur aktuellen API zuerst Context7 befragen (`/websites/motion_dev`), nicht aus dem Gedaechtnis raten.

## Installation
- Projekt mit Paketmanager: `npm install motion`
- Einzelne HTML-Datei (Version immer fest, nie `latest`):
  ```html
  <script type="module">
    import { animate, scroll, inView, stagger } from "https://cdn.jsdelivr.net/npm/motion@14.14.0/+esm"
  </script>
  ```
  oder als globale Variable: `<script src="https://cdn.jsdelivr.net/npm/motion@14.14.0/dist/motion.js"></script>` → `const { animate } = Motion`

## Kern-API (JavaScript, framework-frei)
```js
import { animate, stagger, scroll, inView } from "motion"

animate(".card", { opacity: [0, 1], y: [16, 0] }, { duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: stagger(0.06) }) // Eintritt: ease-out
animate(".card", { opacity: 0, y: 8 }, { duration: 0.25, ease: [0.55, 0.08, 0.4, 0.95] })                          // Austritt: ease-in
animate(".btn", { scale: 1.06 }, { type: "spring", bounce: 0.3 })                                                // Interface: Feder mit leichtem Overshoot
scroll(animate(".bar", { scaleX: [0, 1] }))                                                                     // an Scroll koppeln
inView(".section", (el) => { animate(el, { opacity: 1, y: 0 }) })                                               // beim Sichtbarwerden
```

## React (`motion/react`)
```jsx
import { motion, AnimatePresence, useReducedMotion } from "motion/react"

<motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} transition={{ type: "spring", bounce: 0.3 }} />
<AnimatePresence>
  {open && <motion.div key="modal" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
           exit={{ opacity: 0, y: 8, transition: { ease: "easeIn", duration: 0.2 } }} />}
</AnimatePresence>
<motion.li layout />   // Layout-Animation beim Umsortieren (FLIP automatisch)
const reduce = useReducedMotion()  // true -> Endzustand ohne Bewegung zeigen
```

## Hausregeln (gelten immer, siehe pulse-motion)
- Eintritt ease-out, Austritt ease-in, Interface mit Feder (`type: "spring", bounce: 0.2-0.35`), nichts linear (`ease: "linear"` nie fuer UI).
- Nur `transform`/`opacity`/`filter`/`clip-path` animieren; Motion beschleunigt diese ueber WAAPI auf der GPU.
- `prefers-reduced-motion`: `useReducedMotion()` (React) oder `matchMedia` (JS) -> Endzustand sofort.
- Wahl: Motion fuer React-Apps, Gesten, Layout- und Exit-Animationen; GSAP (Skills `gsap-*`) fuer lange Timelines, ScrollTrigger-Pinning und SVG-Plugins.
