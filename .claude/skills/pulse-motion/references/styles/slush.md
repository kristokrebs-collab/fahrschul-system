# Slush (slush)
> Aufblasbares Sticker-Universum auf Pastellpapier: riesige gequetschte Display-Typo, 3D-Ribbons in Electric Blue, Sticker-Konfetti mit schwarzer Kontur.

**Theme:** light · **CSS:** `assets/styles/slush.css` (`data-style="slush"`) · Stichworte: Event/Crypto/Wallet-Landing, Collage, Sticker, EN: sticker book, crushed display, black outlines

## Signature-Moves
- **Display als Skulptur:** Lateral **800**, 200–640px, **Zeile 0.75–0.80** — Wörter stapeln sich zu Blöcken; nie Zeilenhöhe > 0.85.
- **Alle sechs Brand-Farben als gemeinsame Sticker-Palette** (nie „eine“ Akzentfarbe): Blau, Mint, Lavendel, Ember, Sonne, Violett — als Sticker, Karte oder Wash.
- **1px-Schwarz-Kontur überall** (Buttons, Karten, Sticker) = „handgeschnitten“; keine Schatten.
- **Sticker überlappen die Headline**, leicht rotiert, nicht am Raster; 3D-Ribbon läuft *hinter* dem Text.
- **Sektionsbänder:** Sky `#dceeff` → Weiß → Grau `#ccc`, ohne Trenner; locker asymmetrische Poster-Komposition.
- **Marquee-Streifen** oben: schwarz, weiß UPPERCASE 12–13px/700.
- CTA = **schwarz gefüllt oder Outline** — Blau ist nie Aktionsfarbe.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Carbon | `#000000` | Text, Konturen, gefüllter CTA |
| Paper White | `#ffffff` | Karten, Outline-Button-Füllung |
| Sky Wash | `#dceeff` | Hero-Hintergrund |
| Concrete Gray | `#cccccc` | Zwischen-Sektion |
| Soft Mist | `#e9e9e9` | deaktiviert |
| Electric Blue | `#4da2ff` | 3D-Ribbon/dekorative Flächen (nie CTA) |
| Mint Pop | `#55db9c` | grüne Wash/Checkmark-Sticker (nicht „Success“) |
| Lavender | `#e9ccff` | weiche Karten-/Sticker-Füllung |
| Ember | `#fb4903` | heißer Sticker-Akzent (Rakete) |
| Sunburst | `#ffd731` | Münz-Sticker |
| Voltage Violet | `#5c4ade` | Wallet-Sticker, QR-Karte |

## Typografie
Lateral 800 (Ersatz **Druk/Bowlby One/Antonio**) nur Display · Aeonik Pro 500/700 (Ersatz **Inter/Satoshi/General Sans**), `ss01`, `tnum`.
caption 12/1.56 · body-lg 15/1.39 · sub 24/1.2 · heading-sm 30/1.1 · heading 64/1 (alle −0.01px) · display 200/0.8 · display-lg 640/0.75. Nav/Buttons 700 mit **+0.030–0.032em**, Labels UPPERCASE 0.032em; Body −0.010em.

## Form & Raum
Basis 4px (…128·180·224). Radius: Nav/Buttons/Pillen **1600** (voll), Karten 20, Elevated 40, Body 30, Wallet-Icon 16. Max 1440, Section-Gap 48, Padding 24, Gap 4–12. **Keine Schatten, keine Verläufe.**

## Komponenten (Kurzrezepte)
- **Pill-Nav-Button:** 1px schwarz, Weiß, 12–14px/700 .032em, Padding 15×12.
- **Filled CTA ("Launch App"):** schwarz, weiß, Radius 40, 10×12, 13–14px/700.
- **Outlined Ghost:** 1px schwarz, weiß, 1600 Radius, 10×12.
- **Logo-Mark:** Kreis mit „S“, 1px schwarz auf weiß. **Plus-Button:** runder Outline-Button.
- **QR-Download-Karte:** Violett, 20px, Split: weißes QR-Feld + „DOWNLOAD“ weiß 700.
- **Sticker:** flach illustriert, 1px schwarze Kontur, 16–20px Radius, rotiert, überlappend.

## Do / Don't
- Do: Display-Zeile ≤ 0.80; mehrere Sticker-Farben pro Screen; Sektionsbänder wechseln; 1px-Konturen.
- Don't: Radius < 16 bei Karten / < 1600 bei Buttons; Blau als CTA/Link; Grün als Semantik; Schatten/Verläufe; Max-Breite < 1280.

## Passt zu pulse-motion
`dancing-letters`, `pixel-text-fill`, `text-ascii-cascade`, `draggable-widget-grid`, `reel-collage`.
