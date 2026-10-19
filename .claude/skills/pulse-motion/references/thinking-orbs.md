# Thinking Orbs (thinking-orbs)
> Neun „Denk“-Zustände aus gepunkteten 3D-Kugeln (Canvas 2D, monochrom, Tiefenschattierung) als Ersatz für den Spinner in KI-/Agent-UIs; zwei abgestimmte Größen (64 / 20).

**Quelle:** Libraries.dev „Orb“ (npm `thinking-orbs`, MIT, Jakub Antalik). Aus README und Typen als **eigene Vanilla-Engine** nachempfunden — Geometrie, Takte und Zahlen sind eigene Annäherungen, **kein Video-Fit**.

## Wann einsetzen
- „Denkt/Arbeitet…“-Anzeige in Chats, Agenten-Läufen, Suchen, Uploads — statt Spinner
- Avatar-Maßstab (64) neben Nachrichten, Inline-Maßstab (20) im Fließtext/Statuszeilen
- Pro Agent-Phase ein Zustand: suchen · lösen · verbinden · weben · komponieren · zuhören
- Dezente, monochrome Alternative zu bunten Loadern (dunkel/hell automatisch)
- EN: AI thinking indicator, loading orb, agent status, dotted sphere, spinner replacement, particle loader

## Die neun Zustände
| State | Bild | Mechanik (diese Umsetzung) |
|---|---|---|
| `working` | Partikel auf geneigten Bahnen | 3 Bahnen (Neigung/Dreh/Tempo verschieden), je ~9 Partikel mit 7-Punkte-Schweif + schwache Geisterringe |
| `searching` | Scan-Meridian über Punkt-Globus | Fibonacci-Kugel (~170), Meridian läuft 1.5 rad/s, nahe Punkte heller/größer (Gauß) |
| `solving` | Bänder drehen in Vierteln, klicken zurück | 5 Breitenbänder; 9 s: 5 Viertel-Drehungen (ease, je .45 s) → halten → in Gegenreihenfolge zurück → gelöst |
| `listening` | Wellenform rollt durch Breitenkreise | 9 Ringe, Welle `sin(2π·.9·i/8 − 3t)` verschiebt/skaliert Ringe, Wellenberg heller |
| `connecting` | Konstellation verdrahtet sich | ~16 Knoten, Kanten zeichnen sich nacheinander (5.2 s), Pakete laufen, Ausblenden, 7 s Zyklus |
| `weaving` | drei Stränge flechten sich | 3 Spiralen (2.2 Windungen, 120° versetzt) um die Y-Achse |
| `composing` | wogende Mehrband-Schärpe | 4 undulierende Bänder (`sin(2ψ+1.4t)`) |
| `breathing` | frontaler Ring, langsam morphend | 2 Ringe, Radius mit 2./3./5. Harmonischen + Atmen |
| `shaping` | Kontur Kreis → Dreieck → Quadrat | 64 Punkte entlang des Umfangs, 2.4 s je Form, 1.1 s Morph (smoothstep) |

## Motion-/Look-Tokens
| Token | Wert |
|---|---|
| Preset 64 | Dichte 1.0 · Punktradius 1.3px · Tempo 1.0 |
| Preset 20 | Dichte 0.34 · Punktradius 0.95px · Tempo 1.12 |
| Größe 32 | im **Log-Raum** zwischen 20 und 64 interpoliert (nicht separat getunt) |
| Tiefenschattierung | `k=(z+1)/2` → Alpha `.18+.82·k^1.3`, Radius `×(.62+.55k)`, leichte Perspektive `1+z·.08` |
| Tinte | dunkel: `rgb(236,236,242)`, hell: `rgb(22,22,28)`; `color` tönt (hex/rgb) |
| Zeit | `tau += dt·speed·presetTempo` (dt ≤ 50 ms), ein geteilter rAF-Takt für alle Instanzen |
Optionen: `state, size (64|32|20), theme ('auto'|'dark'|'light'), speed, paused, color, dots (Dichte), dotSize (Radius), label`.

## Interaktion & Barrierefreiheit
- Canvas `role="img"` + Standard-`aria-label` je Zustand (überschreibbar per `label`).
- `prefers-reduced-motion`: **Standbild** mit repräsentativem Frame, folgt weiter dem Theme.
- Pausiert automatisch **außerhalb des Sichtbereichs** (IntersectionObserver) und bei **verstecktem Tab**; setzt in Phase fort.
- Theme `auto`: Ahnen-`data-theme="dark|light"` bzw. Klasse `dark|light` (MutationObserver), sonst `prefers-color-scheme` (live).
- DPR auf 2 begrenzt; nur 2D-Arcs/Linien (kein Filter, kein WebGL).

## 120 Hz (Technik + check120)
- **Zeitbasiert:** jeder Frame ist eine reine Funktion von `tau` (Akkumulation mit `dt`, ≤ 50 ms), also bildratenunabhängig; kein `setInterval`, keine festen 16.67 ms.
- **Gemessener Engpass:** nicht Rechnen, sondern das **Rastern der Punkte** (Pfad-Arcs) im Software-Canvas. Probiert und verworfen: Einzel-Fills (langsamer), vorgerenderte Sprites + `drawImage` (**2–3× langsamer**). Geblieben: je Alpha-Stufe **ein Pfad + ein `fill`** (≤ 15 Füllvorgänge), vorberechnete Styles, Counting-Sort, Puffer statt Objekte.
- **Qualitätsregler** (`ORB_ADAPTIVE`, `GOV`): misst die synchrone Zeichenzeit aller Orbs je Frame (gleitender Mittelwert). Über **1.0 ms** → Punktdichte alle 12 Frames ×0.85 (Minimum 0.35), unter 0.5 ms → langsam ×1.03 zurück. Auf GPU-Geräten bleibt die Dichte bei 1; der Takt/Zeitbasis ändert sich nie. Unter Last werden Punkte weniger, nicht Frames.
- **Engine-Kosten** (Chromium, ungedrosselt, Berechnen+Zeichnen je Orb/Frame, 64px): working 208 µs (279 Punkte) · breathing 137 · searching 99 · listening 96 · weaving 76 · composing 75 · shaping 61 · solving 43 · connecting 34 µs (Budget bei 120 Hz: 8333 µs).
- **check120** (Headless-Software-Raster, 4× CPU-Drosselung, Schwelle p95 ≤ 10.4 ms, Budget 8.33 ms): **1 Orb 7.5 · 3 Orbs 7.4 · 5 Orbs 8.3 ms (ok)**; 8 Orbs 15.7, 13 Orbs 17.4 ms (Regler am Minimum, trotzdem zu langsam). Ohne Regler waren es 9.2 / 15.4 / 28.9 ms.
- **Demo-Seite** (3 große + 3 kleine spielen, 13 Canvas-Ebenen im DOM): **11–14 ms** → knapp **über** der Schwelle. Ursache vermutlich das Zusammensetzen aller Canvas-Ebenen pro Frame im Software-Compositor (selbst pausierte Kacheln), nicht die Engine. Auf echter GPU/Hardware **nicht geprüft**. Faustregel Mobil: ≤ 4–5 gleichzeitig sichtbare/animierte Orbs. Die Lint-Warnungen „style.width/left“ sind Fehlalarme (einmalig bei Init/Größenwechsel).

## Einbindung (assets/thinking-orbs.html)
```html
<span id="status"></span>
<script>const orb = initThinkingOrb(document.getElementById('status'), { state: 'searching', size: 64, label: 'Durchsuche Repository…' });
orb.set({ state: 'solving', speed: 1.5 });  orb.pause(); orb.play(); orb.destroy();</script>
```
Block `<!-- COMPONENT -->`-Teile (`.orb`-CSS, `FRAMES`, Painter, Takt, `initThinkingOrb`) ins Zielprojekt kopieren. Ziel: `<canvas>` oder Container (Canvas wird angelegt).

## Original-Bibliothek (React) — wenn exakt gewünscht
```bash
npm install thinking-orbs     # MIT, React ≥ 18, keine Laufzeit-Abhängigkeiten
```
```tsx
import { ThinkingOrb } from 'thinking-orbs';
<ThinkingOrb state="searching" size={64} />        // size 64 | 32 | 20, speed, paused, theme, color, dots, dotSize
```
Weitere Props der Bibliothek, die hier **nicht** nachgebaut sind: `opts` (rohe Engine-Parameter), `frame` (eigene Geometrie), `gravity` (Orb zieht am Zeiger). Docs: https://libraries.dev/orbs.html. In React-Projekten die Bibliothek bevorzugen.

## Kreativ remixen
1. **Agent-Timeline:** Zustand je Phase wechseln (searching → connecting → solving → composing) und beim Wechsel `tau` zurücksetzen — der Orb „erzählt“ den Ablauf.
2. **Echtes Zuhören:** `listening` mit Mikrofon-Pegel (`AnalyserNode`) statt Sinus füttern; Amplitude = Wellenhöhe.
3. **Statusfarbe:** `color` je Status (neutral = denkt, grün = fertig, rot = Fehler) — Tiefenrampe bleibt erhalten.
4. **Beam + Orb:** Orb als Avatar in einer Karte mit `border-beam` (`pulse-inner`), solange der Agent arbeitet.
5. **Orb als Fortschritt:** `shaping` Formwechsel an Prozent-Schritte koppeln (Kreis 0 % → Dreieck 33 % → Quadrat 66 % → …).

## Bekannte Abweichungen (ehrlich)
- **Eigene Geometrie:** Die neun Zustände folgen den Beschreibungen der Bibliothek, sind aber nicht dieselben Kurven/Punktzahlen/Takte; Optik ähnlich, nicht identisch. Kein Video- oder Pixelvergleich.
- Preset-Werte (64/20/32), Tempi und Dichten sind Schätzungen; 32 ist interpoliert (die Bibliothek sagt dasselbe über ihre 32). Der **Qualitätsregler** (Dichte sinkt bei langsamem Zeichnen) ist eine eigene Ergänzung.
- `gravity`, `opts`, `frame` fehlen; die Theme-Erkennung ist vereinfacht (Ahnen + Media-Query).
- Für einen exakten Fit: Bildschirmaufnahme der Bibliothek-Demo schicken → Skill-Ablauf „Neue Animation aufnehmen“.
