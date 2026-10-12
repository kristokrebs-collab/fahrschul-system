# 120-Hz-Prinzipien & Code-Bausteine (gemeinsame Grundlage aller Animationen)

Ziel: Jede Animation läuft auf 60/120/144/240-Hz-Displays gleich schnell und ruckelfrei. Frame-Budget: 8,33 ms @120 Hz, 6,94 ms @144 Hz, 4,17 ms @240 Hz — JS pro Frame < 2 ms.

## Die 6 Regeln
1. **Zeit statt Frames.** Animation hängt an `performance.now()`/rAF-Zeitstempel, nie an „pro Frame += x“. Kein `setInterval`/`setTimeout` als Takt, kein `1000/60`, kein `16.67`.
2. **Nur Compositor-Eigenschaften** animieren: `transform` (translate3d/scale/rotate), `opacity`, `filter`. Nie `width/height/top/left/margin/padding/box-shadow` animieren, nie `transition: all`.
3. **Federn exakt lösen** (Formel unten) statt pro Frame zu integrieren. Glättung immer mit `1 - exp(-k·dt)`.
4. **Eingabe bündeln:** `pointermove` nur merken, im nächsten rAF **einmal** anwenden (bei 240-Hz-Mäusen kommen mehrere Events pro Frame).
5. **Nichts pro Frame messen/bauen:** kein `getBoundingClientRect`/`offsetWidth`/`getComputedStyle` im Frame, kein `innerHTML`; einmal messen, cachen (ResizeObserver). Spans/Elemente einmal erzeugen.
6. **Leerlauf = 0 Arbeit:** rAF-Schleife nur laufen lassen, solange etwas animiert; `will-change` nur während der Animation; `backdrop-filter`/große Blur-Flächen sparsam (kleine Flächen).

## Bausteine (getestet)

### Exakte gedämpfte Feder (Position 0→1, bildratenunabhängig)
```js
// t in Sekunden seit Start. Gleiche Parameter wie Framer-Motion { type:'spring', stiffness, damping, mass }.
function springAt(t, { stiffness = 300, damping = 24, mass = 1, velocity = 0 } = {}) {
  const w0 = Math.sqrt(stiffness / mass), z = damping / (2 * Math.sqrt(stiffness * mass));
  if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z);              // schwingt über (Overshoot)
    return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0 - velocity) / wd) * Math.sin(wd * t)); }
  if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + (w0 - velocity) * t);   // kritisch
  const wd = w0 * Math.sqrt(z * z - 1), r1 = -z * w0 + wd, r2 = -z * w0 - wd,
        c2 = (r1 + velocity) / (r1 - r2), c1 = 1 - c2;                      // überdämpft
  return 1 - (c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t));
}
// Nutzung:  const k = springAt((now - t0) / 1000, cfg);  value = from + (to - from) * k;
```
Faustwerte: weich/ruhig `stiffness 120–200, damping 20–26`; knackig `300–500 / 25–35`; verspielt-federnd `300–600 / 10–18` (ζ < 0,5 → deutlicher Overshoot). Overshoot ≈ `exp(-πζ/√(1-ζ²))`.

### rAF-Schleife mit dt, schläft im Leerlauf
```js
let raf = 0, last = 0;
function frame(t) {
  const dt = Math.min(t - last, 50) / 1000; last = t;      // s, Tab-Wechsel/Ruckler begrenzen
  const alive = update(dt, t);                              // true, solange etwas animiert
  raf = alive ? requestAnimationFrame(frame) : 0;
}
const wake = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
```

### Bildratenunabhängige Glättung (Lerp, Cursor-Folger)
```js
const a = 1 - Math.exp(-k * dt);        // k ≈ 10–30 (größer = straffer); NIE ein fester Faktor wie 0.1 pro Frame
x += (targetX - x) * a;
```

### Pointer bündeln (120–1000-Hz-Eingabe)
```js
let px = 0, py = 0, dirty = false;
el.addEventListener('pointermove', (e) => { const l = e.getCoalescedEvents?.().at(-1) ?? e; px = l.clientX; py = l.clientY; dirty = true; wake(); }, { passive: true });
// im frame(): if (dirty) { apply(px, py); dirty = false; }
```

### Typewriter/Zähler aus der Zeit
```js
const chars = Math.min(text.length, Math.floor((t - t0) / msPerChar));   // nie pro Frame +1
if (chars !== shown) { shown = chars; node.textContent = text.slice(0, chars); }   // DOM nur bei Änderung
```

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } }
```
JS: `matchMedia('(prefers-reduced-motion: reduce)').matches` → Endzustand direkt setzen.

## Prüfen
`node scripts/check120.cjs <html> <actions.cjs>` — statische Anti-Muster (FAIL/WARN) + Laufzeit-Frame-Zeiten (normal und 4× CPU-gedrosselt). Bestanden = `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine`.
Grenzen: Headless-Chromium mit Software-Raster, kein echtes 120-Hz-Display; auf dem Gerät (GPU-Raster) ist es meist günstiger. Ruhige Szenen (nichts animiert) zeigt der Prüfer wegen eines Dummy-Layers trotzdem ungedrosselt.
