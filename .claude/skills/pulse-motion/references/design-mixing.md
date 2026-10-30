# Style-Schnipsel nutzen & mischen

Die 12 Styles in `references/styles/` sind **Inspiration, keine Vorlagen zum 1:1-Nachbau**. Gedacht ist: Schnipsel klauen (Palette, Typo-Haltung, eine Signature-Geste), an das eigene Projekt anpassen und mit den `pulse-motion`-Animationen kombinieren. Marken, Logos, Wortmarken, Fotos und Texte der Originalseiten **nicht** übernehmen; die Schriften sind proprietär → immer die genannten Ersatzschriften (Inter, Playfair …) nutzen.

## 1) Drop-in in 3 Schritten
```html
<link rel="stylesheet" href="assets/styles/_base.css">
<link rel="stylesheet" href="assets/styles/factory.css">
<section data-style="factory">
  <h1 class="s-display">Software at scale.</h1>
  <p class="s-muted">Text</p>
  <button class="s-btn">Start</button> <button class="s-btn s-btn--ghost">Docs</button>
  <div class="s-card"><span class="s-eyebrow s-pulse">Live</span> …</div>
</section>
```
- Jeder Style setzt nur Variablen im Scope `[data-style="<slug>"]`; **Namen der Semantik-Schicht sind überall gleich:** `--s-bg --s-surface --s-fg --s-fg-muted --s-border --s-accent --s-link --s-action-bg --s-action-fg --s-radius-card --s-radius-btn --s-font-display --s-font-ui --s-font-mono --s-display-weight/leading/tracking`. Eigener CSS-Code nutzt `var(--s-…)` → Style wechselbar per Attribut.
- Markenwerte liegen mit Prefix daneben (`--fa-…`, `--sl-…`), damit **mehrere Styles auf einer Seite kollisionsfrei** sind.
- **Inseln:** `data-style` darf verschachtelt werden und auch am selben Element wie `.s-card` stehen (z. B. helle Factory-Karte in dunkler Dala-Sektion).
- Vorschau aller Styles nebeneinander: `assets/styles/_preview.html` (Mix-Demo unten).

## 2) Mischregeln (damit es nicht beliebig wird)
1. **Ein Host-Style pro Sektion** bestimmt Canvas, Primär-Button, Radius-Vokabular und Display-Schrift.
2. Davon **max. 1–2 Signature-Moves** aus anderen Styles borgen (Tabelle unten), nicht ganze Paletten mischen.
3. **Nie zwei Akzentfarben als Button-Füllung.** Akzent bleibt dort, wo der Host-Style ihn erlaubt (z. B. Factory: nur Daten, Superhuman: nur Links).
4. **Ein Radius-Vokabular** pro Sektion (z. B. 3/10/20 oder 8/16/30) — nicht aus zwei Styles mischen.
5. **Hierarchie über Größe/Kontrast**, nicht über zusätzliche Gewichte; Zeilenhöhe der Display-Zeile eng (0.8–1.1), Body 1.4–1.5.
6. Animationen: nur `transform`/`opacity`/`filter` (siehe `principles-120hz.md`); Hover-Zeiten 0.15–0.3 s, Reveals 0.6–2.5 s.

## 3) Signature-Moves zum Klauen
| Move | Quelle | Kern-CSS |
|---|---|---|
| Hellkarte als Lichtkegel auf Schwarz | Factory | `.s-card{background:#eee;color:#101010}` auf `#101010`, kein Schatten |
| Void ohne Panels, Hierarchie nur durch Größe | Dala | `background:#000`, Headline 78–113px/400, `letter-spacing:-.04em`, Body `font-weight:200` |
| Gequetschte Display-Typo | Slush / Air / ORYZO | `line-height:.75–.9; text-transform:uppercase; font-weight:800–900` |
| Whisper-Serif-Headline | Origin / Structured | Serif `font-weight:300–500`, 80–96px, `line-height:.9`, ein Wort `<em>` |
| Hell/Dunkel-Rhythmus ohne Linien | Apple / Structured / Slush | Sektionen wechseln `#fff ↔ #f5f5f7` bzw. `#c4c3b6 ↔ #000`, Gap 90–120px |
| Sticker mit 1px-Kontur | Slush | `border:1px solid #000; border-radius:20px; transform:rotate(-4deg)` (`.s-sticker`) |
| Gestrichelte Haarlinie | ORYZO | `border-top:1px dashed #40372e` |
| Glas-Nav | Origin / Apple / Superhuman | `background:rgba(255,255,255,.1); backdrop-filter:blur(12–24px)` (nur kleine Fläche) |
| Ein Wort kursiv/Cursive in der Headline | Air / Origin | `.s-accent-word{font-family:cursive-Schnitt;font-style:italic}` |
| Mono-UPPERCASE-Eyebrows | Factory / Origin | `font-family:mono; font-size:12px; text-transform:uppercase; letter-spacing:-.02em` |
| Status-Puls | Factory | `.s-pulse::before{6px Kreis in Signal-Orange}` |
| Pill-CTA kompakt | Structured / Apple | `padding:9px 17px; border-radius:28.8px / 980px` |
| Poster-Wortmarke am Rand beschnitten | Structured / Air | `font-size:374px; letter-spacing:-.9%; white-space:nowrap; overflow:hidden` |
| Helle Insel auf dunklem Foto | Air / Superhuman | Karte `rgba(255,255,255,.85)`, 12–16px, kein Schatten |
| Partikel-/Punktlicht-Feld | Dala | Canvas, kleine Dreiecke 1–2px Kontur, rAF mit `dt` (siehe 120-Hz-Regeln) |

## 4) Style → Animation verdrahten
Die Komponenten in `assets/*.html` haben eigene Variablen mit Prefix (z. B. `--npc-*`). Eine Brücke reicht:
```css
[data-style] .npc { --npc-bg: var(--s-bg); --npc-fg: var(--s-fg); --npc-radius: var(--s-radius-card); font-family: var(--s-font-ui); }
```
Faustregel: **Farben/Radien/Schriften kommen aus dem Style, Timing/Easing/Federn bleiben die der Animation.** Passt die Stimmung nicht (z. B. verspielte Feder in Factory), Feder dämpfen (`damping` ↑) statt den Style zu brechen.

## 5) Passende Kombinationen (Vorschläge)
| Ziel / Stimmung | Host-Style | typische Animationen |
|---|---|---|
| Dev-/Agent-Tool, Dashboard | Factory | `agent-trace`, `draggable-widget-grid`, `autocomplete`, `text-ascii-cascade` |
| AI-/Knowledge-Produkt, mystisch | Dala | `text-prism-split`, `pixel-text-fill`, `glyph-portal` |
| Hardware/Produkt-Launch, ruhig | Apple España / Foldable | `dock`, `product-launch-hero`, `slanted-spread-hero`, `product-timeline` |
| Premium-Produktobjekt, warm | ORYZO AI | `cinematic-orbit-hero`, `glyph-portal`, `motion-footer` |
| Fintech, edel | Origin Financial / Structured | `text-morphing`, `parallax-strip-slider`, `immersive-full-screen-navigation` |
| Verspielt/Event/Wallet | Slush | `dancing-letters`, `reel-collage`, `pixel-text-fill` |
| Editorial-SaaS, warm | Superhuman | `reel-collage`, `tactile-highlight`, `morphing-language-selector` |
| Foto-/Medien-Landing | Air | `cinematic-orbit-hero`, `glyph-portal`, `reel-collage` |

## 6) Neue Style-Referenz aufnehmen
Der Nutzer pastet weitere „Style Reference“-Blöcke (Name, Farben, Typo, Komponenten, Do/Don't, Quick-Start-CSS):
1. **Verdichten statt kopieren:** `references/styles/<slug>.md` nach dem Muster der vorhandenen (Signature-Moves, Farben-Tabelle, Typo-Skala, Form & Raum, Komponenten-Kurzrezepte, Do/Don't, Passt zu pulse-motion). Doppelte Tailwind-Blöcke, „Similar Brands“ und widersprüchliche Auto-Prompts weglassen; **Regeln aus Komponenten- und Do/Don't-Abschnitten haben Vorrang** vor den generierten Beispiel-Prompts.
2. **Tippfehler der Quelle korrigieren** (z. B. fünfstellige Hexwerte wie `#15846` → `#15846e`).
3. `assets/styles/<slug>.css` nach dem Muster (Marken-Variablen mit Slug-Prefix + Semantik-Schicht `--s-*`, Scope `[data-style="<slug>"]`).
4. `_preview.html` um den Style erweitern, `python3 scripts/build_index.py`, `scripts/package.sh`.

> Easing-Regeln (Eintritt ease-out, Austritt ease-in, Feder, nichts linear): siehe `references/principles-120hz.md` und SKILL.md, gelten für jeden Style.
