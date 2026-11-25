# Scroll & Timeline: Lenis und GSAP (Notizen)

Stand 2026-10-28, aus lenis.dev, deren README (github.com/darkroomengineering/lenis) und gsap.com/showcase. Die Originalseite von **Originkit** war nicht erreichbar (HTTP 503), daher keine Werte von dort.

## Lenis (Smooth-Scroll, frei, unter 5 kb)
Eigenes Vorgehen: nativen Scroll glaetten, nichts per CSS-Transform kapern (Barrierefreiheit bleibt).
| Option | Standard | Hinweis |
|---|---|---|
| `lerp` | 0.1 | Glaettungsstaerke 0..1; wenn gesetzt, werden `duration`/`easing` ignoriert |
| `duration` | 1.2 s | nur ohne `lerp` |
| `easing` | `t => Math.min(1, 1.001 - 2**(-10*t))` | expo-out (ease-out) |
| `smoothWheel` | true | Mausrad glaetten |
| `syncTouch` | false | Touch-Traegheit nachbilden (kann auf iOS < 16 instabil sein); `syncTouchLerp` 0.075, `touchInertiaExponent` 1.7 |
| `autoRaf` | false | eigene rAF-Schleife; sonst `lenis.raf(time)` selbst aufrufen |
| `anchors` | false | weiches Scrollen zu Ankern |
| `respectReducedMotion` | true | Glaettung aus bei reduzierter Bewegung |
| `orientation` / `gestureOrientation` | vertical | auch horizontal/both; `infinite` fuer Endlosscroll |
GSAP-Kopplung: `lenis.on('scroll', ScrollTrigger.update)`, `gsap.ticker.add(t => lenis.raf(t*1000))`, `gsap.ticker.lagSmoothing(0)`.
Regel hier: Eintritts-Easing von Lenis ist ease-out (expo); passt zu den Easing-Regeln des Skills.

## GSAP-Showcase (Werkzeug-Liste der Seite)
Scroll: ScrollTrigger, ScrollSmoother, ScrollTo. SVG: DrawSVG, MorphSVG, MotionPath. UI: Flip, Draggable, Inertia, Observer. Text: SplitText, ScrambleText, TextPlugin. Physik: Physics2D. Die Seite nennt selbst keine Easings; Ideen fuer diese Bibliothek: Flip-Layoutuebergaenge, DrawSVG-Linienzeichnen, ScrambleText-Reveal, Observer-getriebene Navigation.

## Aus dem Originkit-Screenshot (nur Sichtung, keine Quelle)
Water Button, Glaskugel-Orb, 3D-Korridor mit Fotokacheln, schwebende Avatar-Blasen, "Smoky"-Text. Als Ideen fuer weitere Nachbauten vormerken; der Code liegt nicht vor.
