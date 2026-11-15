# Factory (factory)
> Terminal-War-Room um Mitternacht: schwarze Kontrollfläche, auf der eine einzige weiße Karte wie ein Lichtkegel landet; Farbe nur für Live-Daten.

**Theme:** dark · **CSS:** `assets/styles/factory.css` (`data-style="factory"`) · Stichworte: Dev-Tool/Agent-Plattform, Dashboard-Hero, Metriken, EN: terminal, figure/ground, mono labels

## Signature-Moves
- **Figure/Ground statt Schatten:** helle Karte `#eeeeee` auf `#101010` = die Tiefe (bei Bedarf feines Grain-Overlay).
- **Gewicht 400 für alles** (500 nur Footer-Heading); Autorität durch **engen Tracking** (−0.04em @72px, −0.025em @44px, −0.02em @12px).
- **Zwei Stimmen:** Geist 400 (Marketing/Body) · **Geist Mono 12px UPPERCASE** (Labels, Status, Nav-Wortmarke) — Mono = „Instrument, nicht Marketing“.
- **Farbe = Daten:** Orange `#ee6018` (live/Fehler/Status-Puls 6px), Grün `#a0ca92` (positiv/Trend); **nie** als Button/Karte/Textfläche.
- **Dashboard-Hero:** macOS-Fenster (3 Dots) auf #0d0d0d, Metrik-Kacheln mit Mono-Label + 36px-Wert + 40px-Sparkline in Orange/Grün, 1px-Raster `#1d1a18`.
- **Primär-Aktion neutral:** dunkel gefüllt `#1f1d1c` oder hell `#fafafa` — keine Markenfarbe.
- **Bewegung mechanisch:** 0.15–0.2s `cubic-bezier(.4,0,.2,1)`, Farben/Stroke gemeinsam; Marquee-Logos, einmalige Dashboard-Einblendung; keine Federn/Parallax.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Obsidian | `#101010` | Canvas |
| Carbon Lift | `#1d1a18` | Nav-Wells, Raster-Linien, leichte Erhöhung |
| Ash Stroke | `#3d3a39` | Haarlinien, Ghost-Rand |
| Graphite Mid | `#4d4947` | Chart-Körper, neutrale Daten |
| Warm Granite | `#8a8380` | gedämpfter Text, Links, Logos |
| Pale Stone | `#b8b3b0` | Eyebrows, Tertiär |
| Bone | `#eeeeee` | Text, helle Karte |
| Chalk | `#fafafa` | helle Button-Füllung |
| Signal Orange | `#ee6018` | Live-Status, Sparkline (negativ) |
| Metric Green | `#a0ca92` | positiver Trend |
| (Extras) | `#1f1d1c` Button · `#0d0d0d` Dashboard-Panel | |

## Typografie
Geist (Ersatz **Inter**) 400/500 · Geist Mono (Ersatz **JetBrains/IBM Plex Mono**) 400.
caption 12/1 (−0.24px) · body-sm 14/1.43 · body 16/1.5 · heading 36/1.1 (−1.12) · heading-lg 44/1.12 (−1.1) · **display 72/1 (−2.88)**. Zeilenhöhe ≤ 1.5.

## Form & Raum
Basis 8px (8·16·24·32·40·56·80·96·120). Radius: Nav/Buttons **3**, Karten 10, große Panels 20. Max 1200, Section-Gap 96, Padding 24, Gap 24. Keine Schatten (nur 1px-Haarlinie).

## Komponenten (Kurzrezepte)
- **Nav:** transparent ~64px, Wortmarke Mono 12px UPPERCASE, Links 14px UPPERCASE; Log-In `#fafafa` Fill/3px; „Contact Sales“ = Ghost-Link mit Pfeil (1px #3d3a39, 0 Radius).
- **Helle Karte:** #eee, 10px, Padding 24, dunkler Text; Eyebrow Mono 12px mit Orange-Punkt.
- **Metrik-Kachel:** ohne Fläche, 1px-Linie, Padding 20; Label Mono #b8b3b0, Wert Geist 36.
- **Feature-Karten-Zeile:** nur 1px-Rand `#1d1a18`, 10px, „Read More →“.
- **Logo-Strip:** Wortmarken in #8a8380, ohne Boxen, 96px Luft. **Footer:** Mono-Headings, Links 14px #8a8380.

## Do / Don't
- Do: #101010 überall; Orange/Grün nur Daten; Radius 3/10/20; Mono für Instrument-Labels.
- Don't: Gewicht ≥ 600; Markenfarben auf Buttons; Schatten/Glow; Serif; zusätzliche Akzentfarben; Zeilenhöhe > 1.5.

## Passt zu pulse-motion
`agent-trace`, `draggable-widget-grid`, `autocomplete`, `text-ascii-cascade`, `motion-footer`.
