# Immersive Full Screen Navigation (immersive-full-screen-navigation)
> Menue-Button: ein schwarzes Vollbild-Panel faehrt per Wipe von links auf, danach erscheinen Brand-Block, Links, Bilder und Socials gestaffelt (Fade + Anhub); Schliessen wipet das Panel nach rechts weg.

## Wann einsetzen
- Fullscreen-/Overlay-Navigation fuer Studio-, Agentur-, Portfolio-Sites (Editorial-Look)
- Hamburger -> X Menue mit "Reveal in Sequence"
- Page-Transition / Szenenwechsel per Wipe (links -> rechts rein, rechts raus)
- Staggered Content-Reveal nach einem Container-Wipe (Fade-up)
- Fullscreen menu, curtain/wipe transition, staggered reveal, hamburger-to-X

## Anatomie & Zeitleiste (ab Klick, t=0; gemessen aus 60-fps-Zerlegung der Aufnahme)
| Phase | Start ms | Dauer ms | Charakter |
|---|---|---|---|
| Wipe auf (Panel #020106, linke Kante fix, rechte Kante laeuft nach rechts) | 0 | ~800 | langsamer Start, schnelle Mitte (~50 % bei 430 ms), langer Auslauf (in/out, ~quart) |
| Hamburger -> X (Linien 1/3 drehen, Mitte faded) | 0 | 450 | ease in-out |
| Brand-Block "NORTHLINE STUDIO" + Claim | ~620 | 650 | Fade + 24 px Anhub, ease-out |
| Links Work / Studio / Journal / Contact | 620 / 720 / 820 / 900 | 650 | Fade + 24 px Anhub |
| Bilder (2 Kacheln) | 720 / 800 | 650 | Fade + Anhub |
| Socials (3 Icons) + "Lisbon, Portugal" | ~2250 / 2300 | 650 | Fade + Anhub (auffaellig spaet, so im Video) |
| Wipe zu (linke Kante laeuft nach rechts, Inhalt bleibt sichtbar, kein Fade) | Klick | ~800 | gleiche Kurve wie auf |

Hinweis: Das Original nutzt vermutlich clip-path; der Nachbau erzeugt denselben Wipe nur mit transform (Huelle translateX + Inhalt gegenlaeufig) - optisch identisch, kompositorbeschleunigt.

## Motion-Tokens
- Wipe: 800 ms, cubic-bezier(.76,0,.24,1)
- Elemente: 650 ms, cubic-bezier(.22,1,.36,1), translateY 24 px -> 0, opacity 0 -> 1
- Stagger Links: 100 / 100 / 80 ms; Delays siehe CONFIG.delays
- Icon-Morph: 450 ms cubic-bezier(.76,0,.24,1), Linienabstand 8 px

## Look-Tokens
- Buehne #1f1f1f (Radius 14), Panel #020106, Text #fff, Grau #8e8e8e
- Brand "NORTHLINE": 16 px, 600, Tracking .24em, links oben (36 px, mittig in 82 px Header)
- Links: ~76 px, Weight 400, Zeilenabstand 110 px, linke Spalte x=118 (9.55 % Breite)
- Bilder 306x220 px, Radius 14, Abstand 32 px, ab x=470 / y=276
- Hamburger 41x2 px #5c5c5c; X in #8c8c8c, 1.5 px
- Schrift: Inter, Geist, Roboto ... (Aufnahme wirkt wie Roboto)
- Einheiten in cqw/cqh -> skaliert mit der Komponente

## Interaktion & Barrierefreiheit
- Klick/Tap auf den Button toggelt; Esc schliesst; Klick auf Link schliesst
- aria-expanded/aria-controls am Button, Panel role="dialog", aria-hidden + inert wenn zu
- Hover auf Link dimmt die anderen auf 45 %
- prefers-reduced-motion: Dauern ~0, kein Stagger
- Touch-Aufnahme: Ausloeser ist ein Tap auf den Hamburger

## 120 Hz
Reine WAAPI (Element.animate) auf transform/opacity -> Compositor, vom Browser bildratenunabhaengig getaktet; kein rAF/JS pro Frame, keine Layout-Eigenschaften, will-change nur waehrend der Animation, contain: layout paint.
check120: `VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine` (p95 3.3 ms @4x Drosselung, 0.2 % ueber Budget, 0 Layouts/Frame).

## Einbindung (assets/immersive-full-screen-navigation.html)
```js
const nav = initImmersiveFullScreenNav(document.querySelector('.ifn'), {
  config: { wipeOpenMs: 800, itemMs: 650, delays: { links: [620,720,820,900] } },
  onToggle: open => {}
});
nav.open(); nav.close(); nav.toggle(); nav.isOpen();
```
Markup zwischen COMPONENT:START/END kopieren (Header, .ifn__wipe > .ifn__inner mit Items); CSS-Variablen oben im Dokument.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
```jsx
<motion.div initial={{clipPath:'inset(0 100% 0 0)'}}
  animate={{clipPath:'inset(0 0% 0 0)'}} exit={{clipPath:'inset(0 0 0 100%)'}}
  transition={{duration:.8, ease:[.76,0,.24,1]}}>
  {items.map((it,i)=>(<motion.a key={i} initial={{opacity:0,y:24}} animate={{opacity:1,y:0}}
    transition={{delay:.62+i*.1, duration:.65, ease:[.22,1,.36,1]}}/>))}
</motion.div>
```
(Tween, keine Feder erkennbar.)

## Kreativ remixen
1. Wipe in Akzentfarbe vorlaufen lassen: zweites, schnelleres Panel (Staffel 80 ms) als "Doppelvorhang".
2. Link-Zeilen per Maske hochschieben (overflow:hidden-Zeile, Text translateY 110 % -> 0) und Stagger auf 60 ms - viel mehr Druck.
3. Bilder bekommen scale 1.15 -> 1 + leichten Parallax per Zeiger (lerp mit 1 - exp(-k dt)).
4. Wipe-Richtung aus Klickposition ableiten (von der Tap-Stelle als Kreis/Diagonale).
5. Als Szenen-Transition zwischen Routen verwenden: gleicher Wipe, Content der naechsten Seite statt Menue; Ton/Haptik beim Mittelpunkt.

## Bekannte Abweichungen (ehrlich)
- Die beiden Bilder (iridisierende Falten, 3D-Kreuz) sind als SVG/Gradient nur grob angenaehert, keine Fotos.
- Wipe nutzt transform statt clip-path; Kurve per cubic-bezier angenaehert (Auslauf im Original minimal laenger).
- Socials/Ort-Delay (~2.25 s) aus dem Video abgelesen; Grund unklar (evtl. Scroll-/Viewport-Trigger).
- Schrift: Roboto-artig im Video, Fallback-Stack hier; Linkgroesse +-2 px.
- Hover-Dimmen und Esc/Fokus-Handling sind ergaenzt, im Video nicht sichtbar. Hamburger-Morph-Details nicht erkennbar.
