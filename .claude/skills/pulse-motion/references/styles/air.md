# Air (air)
> Mitternachtshimmel durch Glasskulptur: Vollbild-Wolkenfotografie und 3D-Glasformen tragen die Emotion, die UI bleibt leicht.

**Theme:** dark · **CSS:** `assets/styles/air.css` (`data-style="air"`) · Stichworte: AI-Tool-Landing, Foto-Hero, Poster-Typo, EN: compressed display, cursive accent, ghost buttons

## Signature-Moves
- **Poster-Headline:** Compressed-Schnitt **Gewicht 900, 259px, Zeile 0.85, UPPERCASE**, läuft bis an den Viewport-Rand („MAKE IT ONCE.“).
- **Ein kursives Wort** im Headline (Cursive-Schnitt, z. B. „AI“/„real“) gegen aufrechte Sans — Persönlichkeit durch Kontrast.
- **Buttons nur Ghost oder Haze:** transparent + 1px weißer Rand, oder #f5f5f5 gefüllt — **nie farbig gefüllt**.
- **Helle Inseln auf dunklem Foto:** Haze-Karten (12px) für Produkt-Screenshots; kein Schatten, Tiefe durch Helligkeit.
- Sektionen **vollflächig** (Foto), Content max 1150px; Logo-Leiste monochrom weiß.
- UI-Typo ruhig: **ein Gewicht (500)** für Nav/Body/Buttons.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Whiteout | `#ffffff` | Text/Rahmen auf Dunkel |
| Haze | `#f5f5f5` | Karten, Inputs |
| Ink | `#1b1b1b` | Text/Rahmen auf Hell |
| Black Void | `#000000` | Canvas, Nav-Rand |
| Twilight Blue | `#426188` | einzige chromatische Heading-Farbe auf Dunkel |
| Signal Blue | `#2b7fff` | nur Links/Tags (nie Button) |

## Typografie
Control (Ersatz **Inter**) 500/400 · Control Compressed 900 (Ersatz **Anton/Druk**) · Control Cursive (Ersatz **Caveat**) · Control TNT (aufrechte Display-Variante).
caption 13/1.5 · body 16/1.5 · sub 20/1.4 · heading 32/1.1 · heading-lg 56/1 · **display 259/0.85**. Body nie < 16px / > 500.

## Form & Raum
Basis 4px. Radius: Inputs 4, Buttons 8, Bilder 11/14, Karten 12, Pills nur für Toggles. Max 1150, Section-Gap 48, Karten-Padding 20, Gap 8, Nav 72px. Keine Elevation, keine Verläufe.

## Komponenten (Kurzrezepte)
- **Ghost-Nav-Button:** transparent, 1px #fff, Text #fff, Radius 8, Padding 10×16, 14px/500.
- **Solid-Light:** #f5f5f5, Text #1b1b1b, 1px #1b1b1b, Radius 8, 8×16.
- **Pill-Toggle:** vollrund, halbtransparent dunkel (Filter/Segmente).
- **Underline-Link:** 2px Unterstrich, Signal Blue oder Ink.
- **Input:** #f5f5f5, 1px `rgba(0,0,0,.1)`, 4px, Padding 10.
- **Feature-Header:** Sub 20/500 + Titel 32–56px (Cursive/TNT), zentriert, 48px Abstand.

## Do / Don't
- Do: 8px für alle Buttons, 4px nur Inputs; Haze für Karten; ein kursives Wort pro Headline.
- Don't: farbig gefüllte Buttons; Schatten/Verläufe; zweite Akzentfarbe; Pills außer Toggles.

## Passt zu pulse-motion
`cinematic-orbit-hero`, `glyph-portal`, `reel-collage`, `text-prism-split`.
