# Border Beam (border-beam)
> Wandernder oder atmender Glow um den Rand eines Elements: ein rotierender Farbstrahl mit hellem Kern, weichem Bloom und Hue-Shift (5 Größen, 8 Farbvarianten, hell/dunkel).

**Quelle:** Libraries.dev „Beam“ (npm `border-beam`, MIT, Jakub Antalik). Aus Doku, Typen und Funktionsprinzip der Bibliothek als **eigene Vanilla-Implementierung** nachgebaut (kein Video-Vergleich).

## Wann einsetzen
- Eingabefeld/Composer „die KI arbeitet“, Suchleiste (`line`), aktive Karte, Pricing-Highlight, Premium-CTA
- Statusrand: „live“, „recording“, „processing“ (`pulse-inner` / `pulse-outside`)
- Dunkle UIs mit Neon-Charakter, aber auch helle Seiten (`theme: light`)
- Fokus-/Hover-Verstärker für Karten, ohne die Karte selbst zu verändern (Inhalt bleibt unberührt)
- EN: border glow, animated gradient border, rotating conic border, glowing card, AI input highlight, pulse halo

## Anatomie & Zeitleiste
Wrapper `.bb` um ein Kind. Drei Ebenen (alle `pointer-events: none`, `aria-hidden`): **Bloom** (außen, geblurt) · **Innen-Glow** (innen am Rand geclippt, geblurt) · **Stroke-Ring** (nur die Randlinie sichtbar). Jede Ebene enthält ein großes Quadrat mit Kegel-Verlauf (heller Kern + 6 Farben), das per `transform: rotate` dreht; der Ring ist eine **statische** Maske (`content-box` XOR `border-box`).
| Phase | Dauer / Kurve | Ebene |
|---|---|---|
| Rotation `md`/`sm` | **1.96 s** linear, endlos | `.bb__spin` (transform) |
| Wandern `line` | **3.1 s** ease-in-out, hin und her | `.bb__line-run` (transform) |
| Atmen `pulse-*` | **2.3 s** ease-in-out; Opazität .22 → 1, `pulse-outside` zusätzlich Scale 1 → 1.025 | `.bb__pulse` |
| Hue-Shift | **12 s** ease-in-out alternate, ±`hueRange` (30°) | `.bb__hue` (filter) |
| active an / aus | Einblenden **.6 s** / Ausblenden **.5 s**, danach Animationen pausiert | `.bb__layers` (opacity) |
`mono` und `staticColors` schalten den Hue-Shift ab.

## Motion-Tokens (CSS-Variablen am Wrapper, oder Option)
| Token | Default | Option |
|---|---|---|
| `--bb-duration` | 1.96s (line 3.1s, pulse 2.3s) | `duration` |
| `--bb-strength` | 1 (0–1, nur Glow-Ebenen) | `strength` |
| `--bb-hue` | 30deg | `hueRange` |
| `--bb-brightness` / `--bb-saturate` | 1.3 / 1.2 (light 1.6) | `brightness` / `saturation` |
| `--bb-glow` | 1 (skaliert alle Blur-Radien; Bloom 8px, Innen 6px, sm 5px, pulse-outside 14px) | `glowSize` |
| `--bb-r` | auto aus erstem Kind (Fallback 16px, sm 12px) | `borderRadius` |

## Look-Tokens
- **Farbvarianten (8):** `colorful` (#ff3264 #288cff #32c850 #6446ff #ff7828 #f032b4) · `mono` (Grautöne) · `ocean` · `sunset` · `forest` · `candy` · `ice` · `gold` — je 6 Farben `--bb-c1…6`.
- **Kern:** dunkel `rgba(255,255,255,.9)`, hell `rgba(0,0,0,.6)`. Randbreite 1px (`--bb-bw`).
- **Gewichte** (Stroke / Innen / Bloom): dunkel ≈ .95 / .5 / .5, `sm` 1 / .38 / .55, `pulse-inner` Innen .85, `pulse-outside` Bloom .9 + Brightness 1.9.

## Interaktion & Barrierefreiheit
- Rein dekorativ: Ebenen `aria-hidden`, blockieren keine Klicks; Inhalt/Fokus unverändert.
- `prefers-reduced-motion`: alle Animationen aus (statischer Ring), Fade-Zeiten ~0.
- `theme: 'auto'` folgt `prefers-color-scheme` live.
- `pulse-outside` braucht ein **deckendes Kind** (Halo liegt hinter dem Inhalt, `z-index: -1`) und idealerweise eine eigene 1px-Kontur.

## 120 Hz (Technik + check120)
- **Takt komplett in CSS** (Compositor: `transform`, `opacity`, `filter`); JS nur bei Init/Resize/Optionswechsel (Diagonale für das Dreh-Quadrat messen, nie pro Frame). Kein rAF, kein `setInterval`.
- Statische Maske statt animierter Maske (Library animiert den Kegel-Winkel per `@property` → Repaint pro Frame; hier dreht nur ein Layer).
- **Messung** (check120, Headless-Software-Raster, 4× CPU-Drosselung, Schwelle p95 ≤ 10.4 ms): **eine** Instanz je Größe: md **5.2** · sm **6.1** · line **3.4** · pulse-inner **3.6** · pulse-outside **5.1 ms**. Demo mit 4 Beams gleichzeitig: p95 **10.1 ms** (knapp ok), mit 6 Beams 17 ms (Lite-Modus: 11.9 ms) → auf Mobilgeräten **≤ 2–3 volle Beams pro Bildschirm**, in Listen/Rastern `quality: 'lite'` (kein Innen-Glow, kleinerer Bloom).
- Blur-Flächen bleiben klein (Rand-Ringe, keine Vollbild-Blurs).

## Einbindung (assets/border-beam.html)
```html
<div id="card"><div class="my-card" style="border-radius:16px">…</div></div>   <!-- Wrapper so groß wie das Kind: display:block + width:fit-content / inline-block -->
<script>const beam = initBorderBeam(document.getElementById('card'), { size: 'md', colorVariant: 'ocean', strength: .8 });
beam.update({ active: false });   // blendet aus (.5s), danach pausiert; update({active:true}) blendet ein</script>
```
Block `<!-- COMPONENT:START/END -->` + `<style>`-Abschnitt „COMPONENT CSS“ + `initBorderBeam()` ins Zielprojekt kopieren. Optionen: `size, colorVariant, theme, strength, active, duration, borderRadius, brightness, saturation, glowSize, hueRange, staticColors, quality ('full'|'lite'), onActivate, onDeactivate`. Rückgabe `{ update(partial), destroy() }`.

## Original-Bibliothek (React) — wenn exakt gewünscht
```bash
npm install border-beam      # MIT, React ≥ 18, keine Laufzeit-Abhängigkeiten
```
```tsx
import { BorderBeam } from 'border-beam';
<BorderBeam size="md" colorVariant="colorful" strength={0.7} theme="dark" active>
  <YourCard>Content</YourCard>
</BorderBeam>
```
Props (identisch benannt zu `initBorderBeam`): `size` (`md|sm|line|pulse-inner|pulse-outside`), `colorVariant` (colorful, mono, ocean, sunset, forest, candy, ice, gold), `theme` (`dark|light|auto`), `strength` 0–1, `active`, `duration`, `borderRadius`, `brightness`, `saturation`, `glowSize`, `hueRange`, `staticColors`, `onActivate/onDeactivate`. Docs: https://libraries.dev/beam.html. In React-Projekten die Bibliothek bevorzugen, die Vanilla-Version für Artefakte/HTML ohne Build.

## Kreativ remixen
1. **Status-Rand:** `colorVariant` an Zustand koppeln (ocean = denkt, gold = Erfolg, candy = Fehler) und beim Wechsel `duration` kurz auf 0.8 s drehen.
2. **Composer-Fokus:** Beam nur bei `:focus-within` (`active` toggeln) → Eingabefeld „leuchtet auf“, sonst unsichtbar.
3. **Cursor-Nähe:** Strength per `pointermove` aus der Distanz zur Karte (1× pro rAF) → Karten glühen, wenn man sich nähert.
4. **Doppelring:** zwei Wrapper ineinander (außen `ocean` langsam, innen `colorful` schnell); gegenläufig, indem am inneren Wrapper `.bb__spin { animation-direction: reverse }` gesetzt wird.
5. **Kombi:** Beam um den Orb-Avatar (`thinking-orbs`) oder um die `autocomplete`-Eingabe; mit Dala/Factory-Style als Void-Look.

## Bekannte Abweichungen (ehrlich)
- **Nicht pixelgenau gegen das Original verglichen.** Technik und Defaults (Dauern, Fades, Hue-Zyklus, Größen, Props) folgen der Bibliothek; Farbverteilung und Kern-Form sind eigene Umsetzung.
- Original platziert farbige Flecken **fest** am Umfang und lässt eine rotierende Maske darüber laufen; hier **dreht der farbige Kegel selbst** (Kometen-Look) — Compositor-freundlicher, wirkt leicht anders.
- `forest/candy/ice/gold`-Paletten und `quality: 'lite'` sind eigene Ergänzungen; `line` wandert hin und her statt dem Umfang zu folgen.
- Light-Theme-Gewichte grob nachempfunden.
