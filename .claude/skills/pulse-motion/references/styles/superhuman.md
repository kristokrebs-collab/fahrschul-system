# Superhuman (superhuman)
> Goldene-Stunde-Editorial: warmes Pergament statt Weiß, ein Weinrot-Moment, Violett-Links, Produkt-UI als Glaskarten über Fotografie.

**Theme:** light · **CSS:** `assets/styles/superhuman.css` (`data-style="superhuman"`) · Stichworte: Produktivitäts-SaaS, Editorial, Cinematic-Hero, EN: parchment, weight 460, floating glass cards

## Signature-Moves
- **Pergament #f2f0eb als Canvas** (nie reines Weiß); Karten sind Weiß nur wenn sie abheben müssen.
- **Headline-Gewicht 460** (variable Schrift) bei 28–64px mit engem Tracking (−0.028em @64) — „leise Zuversicht“.
- **Schwebende Produkt-UI-Karten** (Weiß ~85 %, 16px, 1px `rgba(255,255,255,.2)`, **kein Schatten**) direkt über dem Vollbild-Foto.
- **Farbe nur als Punktuation:** Wein = der eine Primär-Button/Footer, Violett = nur Links, Lilac = Sekundär-Fläche, Lagoon = dunkles Feature-Band.
- Nav: transparent + `blur(12px)`, 1px-Rand blendet beim Scrollen ein.
- **Dunkles Teal-Band** (#0c4243) mit überlagerter Geometrie/Handschrift als einziger Tonwechsel; danach atmosphärisches Radial-Gradient-Band.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Midnight Wine | `#421d24` | Primär-Button, Banner, Footer |
| Royal Violet | `#714cb6` | nur Inline-Links |
| Lilac Mist | `#d4c7ff` | Sekundär-Button, aktive Tabs, Badges |
| Deep Lagoon | `#0c4243` | dunkles Feature-Band (nur Vollband) |
| Warm Parchment | `#f2f0eb` | Seite |
| Soft Mist | `#e3e3e2` | Haarlinien |
| Ink Charcoal | `#292827` | Text, Icons |
| Stone Gray | `#666666` | Sekundärtext |
| Paper White | `#ffffff` | erhabene Karten |

## Typografie
Super Sans VF (Ersatz **Inter/Söhne/General Sans**); Gewichte 460/500/540/600/700.
caption 12/1.5 · body-sm 14/1.5 · body 16/1.2 · label-bold 19/1.5 (700) · sub 26/1.3 · heading-sm 28/1.14 (−0.62px) · heading-lg 49/1.2 (−1.32px) · display 64/0.96 (−1.8px). Tracking: −0.022em @28, −0.014em @22, −0.008em @18, 0 ab ≤16.

## Form & Raum
Basis 4px (…36·40·48·64·80·96). Radius: Tabs 8, Karten/Buttons/Floating 16, kleine Buttons 8, Pills 999. Max 1200, Section-Gap 64–96, Padding 16, Gap 8. Einziger „Schatten“: inset 1px Violett `rgb(113,76,182) 0 0 0 1px`.

## Komponenten (Kurzrezepte)
- **Primär:** #421d24, weiß, 16px/460, Radius 16, Höhe ~48, optional Pfeil (8px Abstand).
- **Sekundär (Outlined-Light):** #d4c7ff, 1px #292827, Radius 8, Padding 6×16.
- **Ghost-Text:** transparent, #292827, Unterstrich bei Hover.
- **Ankündigungs-Banner:** Wein, weiß, Pille an den Rändern, Padding 12×16.
- **Trust-Logo-Zelle:** weiß, 1px #e3e3e2, Radius 0, 6 Zellen in einer Reihe, Logos monochrom.
- **Suite-Tab-Strip:** 4 gleich breite Tabs auf Weiß, aktiv = Lilac; **Suite-Karte:** weiß, 16px, Icon + Name 19/700 + „Learn more“ in Violett.
- **Footer:** Wein, 4 Link-Spalten, Weiß 70 %.

## Do / Don't
- Do: 460 ab 28px; Parchment als Canvas; Karten ohne Schatten; Links Violett mit 0.2s-Underline.
- Don't: Gewicht ≥ 700 für Headlines; Weiß-auf-Weiß; zweite Akzentfarbe (Blau/Grün/Rot); #000 als Text; Teal als Karte.

## Passt zu pulse-motion
`reel-collage`, `slanted-spread-hero`, `product-timeline`, `tactile-highlight`, `parallax-strip-slider`.
