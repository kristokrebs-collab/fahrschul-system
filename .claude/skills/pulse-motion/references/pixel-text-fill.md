# Pixel Text Fill (pixel-text-fill)
> Vierzeiliger Satz in dunklem Grau; eine pixelig gerasterte orange "Glut"-Front läuft Zeile für Zeile von links nach rechts, direkt dahinter füllt weiches Weiß den Text.

## Wann einsetzen
- Hero-Statement / Manifest-Absatz, der sich beim Laden "entzündet" und sich Zeile für Zeile liest
- Lese-Fortschritt, Onboarding-Texte, Claim unter dem Logo, Intro-Sequenz vor Produktvorstellung
- Retro-/Pixel-/Halftone-Ästhetik auf dunklem Grund, "Scan"- oder "Thermal-Print"-Gefühl
- Text, der erst "ausgegraut" ist und dann aktiviert wird (Karaoke-/Teleprompter-Look)
- EN: text reveal, pixel dither text fill, scanline highlight, ember sweep, hero statement, line-by-line text animation

## Anatomie & Zeitleiste
Drei übereinanderliegende Kopien jeder Zeile: (1) Ruhetext grau, (2) orange Schicht mit Punktraster-Löchern (Dither), (3) weiße Schicht. Orange und Weiß sind Reveal-Fenster mit weichem rechten Rand; Auslöser: Autoplay beim Laden (Video: ca. 1 s Vorlauf), Klick/Tap/Enter wiederholt.

| Zeile | Orange-Front (Start, Dauer) | Weiß-Füllung (Start, Dauer) |
|---|---|---|
| 1 "Build with calm motion." | 1000 ms, ~1000 ms (Ease-In, beschleunigt) | 2100 ms, ~700 ms |
| 2 "Keep the rhythm crisp and clear." | 2100 ms, ~950 ms | 3300 ms, ~600 ms |
| 3 "Make each screen feel alive." | 3300 ms, ~800 ms | 4000 ms, ~700 ms |
| 4 "Let every detail guide focus." | 4000 ms, ~800 ms | 4800 ms, ~550 ms |

- Ende ca. 5.35 s, danach Ruhe (alles weiß). Kette: die Orange-Front der Zeile k+1 startet ungefähr, wenn die Weiß-Füllung der Zeile k beginnt; Weiß beginnt ~0.1 s nachdem Orange die Zeile verlassen hat.
- Orange-Zone ~20-30 Zeichen breit (Front bis Weiß-Kante), Weiß-Kante weich über ~170 px (Weiß -> Orange Verlauf, Orange scheint durch).
- Im Video stocken die Fronten teils ~0.3 s (Aufnahme-Ruckler, nicht übernommen); die Startzeiten sind aber so gemessen.

## Motion-Tokens
- `oStart [1000,2100,3300,4000]`, `oDur [1000,950,800,800]`, `wStart [2100,3300,4000,4800]`, `wDur [700,600,700,550]` (ms)
- `oPow 1.7` (Orange: p^1.7, beschleunigt; Zeile 1 gemessen ~p^2), `wPow 1.0` (Weiß linear)
- Kein Spring, kein Overshoot, keine Skalierung/Blur; reine Translation von Reveal-Fenstern.

## Look-Tokens
- Bühne `#020205`; Ruhetext `#252527` (~15 % Weiß); Orange `#ff5200`; Endweiß `#f4f0ec` (leicht warm)
- Schrift Inter/Geist/Roboto-artig, 500, 40px (3.24vw), Zeilenhöhe 1.2 (48px), Laufweite -0.01em, zentriert; Block ~585px breit (Zeile 2)
- Dither: Punktraster 4px, zwei versetzte Lochgitter (Radius ~1.2px), Ruhetext scheint durch; Feather Orange 2.2em, Weiß 4.4em
- Keine Schatten/Rahmen.

## Interaktion & Barrierefreiheit
- Autoplay; Klick/Tap/Enter/Leertaste auf den Absatz wiederholt (`role="button"`, `aria-label` = voller Satz); Fokusring sichtbar. Die Effekt-Schichten sind `aria-hidden`.
- `prefers-reduced-motion`: sofort weißer Endzustand, keine Animation.
- Im Video nicht erkennbar: Hover/Tap-Verhalten des Originals (nur Autoplay zu sehen).

## 120 Hz
- Eine rAF-Schleife mit Zeitstempel (`t - t0`), Fortschritt pro Zeile aus der Zeit, kein setInterval; läuft nur während der ~5.5 s, danach 0 Arbeit.
- Nur `transform: translate3d` auf Reveal-Fenster (overflow:hidden) + gegenläufiger Inhalt; Masken (Feather, Dither) statisch; `will-change` nur während `.is-running`; DOM wird einmal gebaut, Breiten einmal gemessen/gecacht (ResizeObserver).
- Transform wird nur geschrieben, wenn sich der Wert (auf 0.25px gerundet) ändert.
- check120: `VERDIKT 120Hz: statisch=ok  laufzeit(4x CPU)=ok  fehler=keine` (1x: p95 1.2 ms, 4x CPU: p95 4.5 ms, 0.3 % über Budget, Script 0.14 ms/Frame). Verbleibende WARN: "style.width" - einmaliges Setzen der Fensterbreite beim Messen (init/resize), nicht pro Frame.

## Einbindung
`assets/pixel-text-fill.html`: Block `<!-- COMPONENT:START/END -->`, `/* COMPONENT CSS */`, `PTF_CONFIG` + `initPixelTextFill(root, opts)`.
```html
<p class="ptf" id="x"><span>Zeile 1</span><span>Zeile 2</span></p>
<script>const c = initPixelTextFill(document.getElementById('x'),
  { oStart:[800,1700], oDur:[900,900], wStart:[1700,2500], wDur:[600,600], loop:true }); c.replay();</script>
```
Optionen: `oStart/oDur/wStart/wDur` (je Zeile ein Eintrag; Länge = Zeilenzahl), `oPow`, `wPow`, `autoplay`, `loop`, `loopDelay`, `lines`. Rückgabe `{replay, destroy}`.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich pro Zeile eine Maske (mask-position / clip) per `useAnimate`, mit Dither-`radial-gradient`; Zeilen über `delay` gestaffelt.
```jsx
<motion.span style={{ WebkitMaskImage: dotGrid }}
  initial={{ clipPath: 'inset(0 100% 0 0)' }}
  animate={{ clipPath: 'inset(0 0% 0 0)' }}
  transition={{ duration: 1, ease: [0.55, 0, 1, 0.45], delay: 1 + i }} />
```

## Kreativ remixen
1. Farbe auf Cyan/Magenta + Glow (`filter: drop-shadow`) für Synthwave-Hero; Dither gröber (8px) für Retro-Konsole.
2. Scroll-gekoppelt: Fortschritt aus `scrollY` statt Zeit, Text "brennt" beim Lesen mit.
3. Zeitplan komprimieren (0.4 s je Zeile) + `loop` für Ticker/Breaking-News; Fronten schneller als der Blick.
4. Cursor-getrieben: Orange-Front folgt dem Zeiger, Weiß bleibt zurück (wie Text Prism Split, aber mit Pixel-Look).
5. Pro Wort statt pro Zeile staffeln und Orange kurz überschießen lassen (Front über das Zeilenende hinaus) für Funken-Gefühl; mit Typewriter kombinieren.

## Bekannte Abweichungen (ehrlich)
- Schrift: Original wirkt wie Roboto/Inter Medium; im Test-Chromium Fallback (Liberation Sans, schmaler/dünner) -> Zeilenbreiten ~5 % kleiner. Dither dort sichtbar, aber Feinstruktur/Pixelraster des Originals (evtl. Canvas/WebGL-Shader) nur angenähert.
- Orange-Front-Form (Dichteverlauf an der Spitze) und exakte Easing-Kurve nur geschätzt; Aufnahme-Ruckler (~0.3 s Stocken) nicht reproduziert, Startzeiten gemessen.
- Weiß-Kante im Original leicht schräg (oben früher weiß als unten); hier senkrecht.
- Nicht erkennbar: Loop/Replay-Verhalten, Hover, Verhalten bei Resize.
