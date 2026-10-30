# Fintech Glass (fintech-glass)
> Vertrauen aus Licht: fast schwarzer Grund, Glaskacheln mit Glanzkante über weichen Farbverläufen, leichte Display-Schrift mit gedimmten Anfangswörtern und große Mono-Zahlen.

**Theme:** dark · **CSS:** `assets/styles/fintech-glass.css` (`data-style="fintech-glass"`) · Stichworte: Fintech, Kredit/Score, Dashboard, Trading-Prüfstand, EN: dark glass cards, finance case study, big numerals

Quelle: Beobachtung einer dunklen Fintech-Fallstudie (Instagram-Karussell, Studio rondesignlab, Oktober 2026). **Eigener Look, keine Marken- oder Layout-Übernahme.**

## Signature-Moves
- **Gedimmte Anfangswörter:** Headline in Gewicht 300, erste Wörter 46 % Deckkraft, Schlusswort voll („Where Credit Meets **Confidence**“).
- **Glaskachel statt Box:** Verlauf 7 % → 2 % → 7 % Weiß, Blur 22 px, 1-px-Glanzkante oben, Schatten tief; dahinter ein weicher Farbverlauf (Bernstein/Violett/Mint).
- **Große Mono-Zahlen** (44 px, Gewicht 300) mit kleiner Einheit; Sparkline-Haarlinie daneben.
- **Nummerierte Sektionen** („01 / 04“) und Haarlinien mit Verlauf statt Kästen.
- **Pillen** für Tabs und Filter (999 px, 1-px-Rand), aktive Pille hell gefüllt.
- Farbe nur als **Ergebnis** (Mint = gut), nicht als Fläche.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Night | `#050608` | Canvas |
| Ink | `#0b0d11` | tiefere Fläche |
| Text | `#f4f6fb` | Text, aktive Pille |
| Dim | `rgba(244,246,251,.46)` | gedimmte Wörter, Labels |
| Glass | `rgba(255,255,255,.07→.02)` | Karten |
| Mint | `#3be0a8` | positiv/Gewinn |
| Amber / Violett | `#ff9a62` / `#7a6cff` | nur Szenenlicht |

## Typografie
Inter (Geist) 300/400/500 · JetBrains Mono für Zahlen/Labels. display 56–88/1.04 (−0.035em), heading 28/1.15, body 15/1.55, label 11 Mono UPPERCASE .08em.

## Form & Raum
Basis 8 px. Radius: Karten 22, Pillen 999, große Szenen 28. Max 1180, Gap 16, Padding 20. Schatten nur unter Glas.

## Komponenten (Kurzrezepte)
- **Stat-Kachel:** Label Mono 11, Zahl 44/300, Delta in Mint, Sparkline 40 px.
- **Pillen-Nav:** 4–5 Pillen oben, aktive Pille Weiß mit dunkler Schrift.
- **Foto-Kachel mit Unschärfe:** Foto stark weichgezeichnet als Szene, Karte darüber (Glas), Text 12 px.
- **FAQ-Liste:** Haarlinien, „+“ rechts, Antwort per Höhen-Wechsel mit ease-out.

## Do / Don't
- Do: wenige große Zahlen; Glas nur auf 3–6 Flächen; Szene langsam treiben lassen (30–40 s).
- Don't: Farbflächen für Buttons (außer Weiß); mehr als drei Szenenfarben; Blur auf vielen kleinen Elementen (Rechenzeit).

## Passt zu pulse-motion
`glass-look` (Schalter und Demo), `draggable-widget-grid`, `agent-trace`, `light-and-depth`, `thinking-orbs`, Dashboards wie `industry-trend-lab/assets/megatest.html`.
