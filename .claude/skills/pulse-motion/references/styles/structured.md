# Structured (structured)
> Renaissance-Galerie auf Spachtelpapier: monumentale Serife, klassische Ölgemälde, harte Hell/Dunkel-Schnitte; Finanzen als Hochkunst.

**Theme:** mixed (Putty-hell ↔ Ink-dunkel) · **CSS:** `assets/styles/structured.css` (`data-style="structured"`, dunkel: `data-tone="ink"`) · Stichworte: Krypto/Yield, Luxus-Editorial, Wortmarken-Hero, EN: serif wordmark, oil painting, gallery

## Signature-Moves
- **Hero-Wortmarke 374px**, Serif 500, Tracking −3.37px, Zeile 0.84 — **am Viewport-Rand beschnitten**, immer größer als der Bildschirm.
- **Hell/Dunkel hart geschnitten** (Putty `#c4c3b6` ↔ `#000`), keine Verläufe dazwischen; Tiefe nur durch Wechsel.
- **Zwei Stimmen, nie vermischen:** Serif nur für „Momente“ (≥ 34px), Grotesk nur für „System“ (9–26px).
- **Klassische Gemälde** (Landschaft, Architektur, Stillleben) als Vollbild-Atmosphäre; **runde Ausschnitte** für Feature-Vignetten.
- **Hexagon** als zweite Markenform (Pagination/Indikatoren, ~12px Outline); „gekerbte“ dunkle Produktkarte (Hexagon-Ecken) schwebt über dem Bild.
- **Minimalster Header:** nur Logo-Monogramm (Kreis-„S“) + ein Textlink; Stat-Paare „TVL: 85 BTC · APY: 6%“ in 16px/500.
- **Kompakte Pille:** schwarze Pill, Padding 9×17, 12px — wirkt wie ein Etikett.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Putty | `#c4c3b6` | Haupt-Canvas hell |
| Ink | `#000000` | dunkle Sektionen, Primär-Button, Text |
| Bone | `#e7e5e4` | erhabene Karten |
| Chalk | `#ebebeb` | Footer/hellste Stufe |
| Vellum | `#dfdcd5` | Haarlinien (wie Papierkante) |
| Graphite | `#595855` | gedämpfter Text (auf Putty nur 4.0:1 → für kleinen Sekundärtext abgeleitet `#444340`) |
| Ash | `#808080` | Bild-Platzhalter |
| Paper | `#ffffff` | Text auf Dunkel, Icon-Striche |

## Typografie
Davinci Serif 400/500 (Ersatz **Canela/Tiempos/GT Super/Playfair**) · Helvetica Now 400/500 (Ersatz **Inter/Neue Haas**).
body-sm 15/1.5 · sub 22/1.33 (−0.11) · heading-sm 26/1.33 (−0.13) · heading 43/1.1 (−0.215) · heading-lg 52/1 (−0.47) · **display 374/0.84 (−3.37)**; Sektionstitel 94px/500 (−0.85px, Zeile 0.84, zentriert).

## Form & Raum
Basis 4px, kompakt (4·16·20·28·32·36·40·52·60·96·168). Radius: Karten **9**, Links 2, Buttons **28.8** — nichts dazwischen. Section-Gap 80, Padding 24, Gap 6. Voll-Bleed, **kein Max-Width**; keine Schatten/Verläufe.

## Komponenten (Kurzrezepte)
- **Pill-Action:** #000, #fff, 12px/400, Padding 9×17, Radius 28.8, einmal pro Viewport.
- **Ghost-Textlink:** nur Text, #000, Unterstrich bei Hover.
- **Zirkuläre Feature-Vignette:** ~200px Kreis-Ausschnitt, Serif-Caption 22–24px darüber, Hexagon-Dots (3) darunter; 3-Spalter, Gap 28.
- **Gekerbte Produktkarte:** ~400px, #000, Hexagon-Ecken, 9px Radius an Hauptkanten, „SCROLL“ 9px weiß.
- **Gemälde-Panel:** randlos, ohne Overlay.

## Do / Don't
- Do: Display ≥ 94px für Titel; 374px für die Wortmarke; Kreis-Crops für Bilder; Hexagone für Indikatoren.
- Don't: gesättigte Farben; Schatten/Verläufe; Serif im Fließtext; Stockfotos/moderne Illustrationen; sichtbare Menüleiste; Body < 12 oder > 26px.

## Passt zu pulse-motion
`glyph-portal`, `cinematic-orbit-hero`, `text-morphing`, `parallax-strip-slider`, `immersive-full-screen-navigation`.
