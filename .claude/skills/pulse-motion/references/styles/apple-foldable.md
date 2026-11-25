# Apple Foldable-Launch (apple-foldable)
> Foldable-Gerät in weißer Galerie: das Produkt-Render ist das Ereignis, Typo und blaue Controls bleiben bewusst leise.

**Theme:** light · **CSS:** `assets/styles/apple-foldable.css` (`data-style="apple-foldable"`) · Stichworte: Hardware-Launch, Preis-Callout, Highlights-Karussell, EN: product hero, local nav, pricing pill

## Signature-Moves
- **Hero-Stack zentriert:** Produktname 21px/600 → **80px/600-Statement** (Zeile 84, −1.2px) → Preis-Zeile → riesiges Geräte-Render direkt darunter, **ohne Karte**.
- **Local Nav** (Produktname 19px/600 + kleine rechtsbündige Pills) über der 44px-Global-Nav.
- **Schwebender Preis-Callout:** weiße 28px-Kapsel über dem Render, 14px/600 Preis + kompakte Blau-Pill, **ohne Schatten**.
- **Highlights-Band** #f5f5f7 mit horizontal laufenden weißen 28px-Karten; Medien dürfen über die Kartenkante hinausragen.
- **Editorial-Block:** kleiner Kicker, riesiges linksbündiges Statement, 17px-Body, Hardware-Bild groß von der Gegenseite hereingeschoben.
- Tiefe nur durch **1px-Konturen** (`0 0 0 1px`), nie durch Blur-Schatten.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Gallery White | `#ffffff` | Seite, Hero, Karten |
| Studio Mist | `#f5f5f7` | Bänder, Karussell-Hintergrund, Footer |
| Paper Frost | `#fafafc` | geöffnete Nav |
| Hairline Silver | `#d6d6d6` | 1px-Trenner, Kontur |
| Control Gray | `#e6e6e8` | deaktivierte Controls, Nav-Kante |
| Ink | `#1d1d1f` | Headlines, Text |
| Slate | `#707070` | Sekundärtext, Legal |
| Steel | `#86868b` | Outline-Rahmen, inaktiv |
| Apple Blue | `#0066cc` | Inline-/Section-Links |
| Pricing Blue | `#0071e3` | gefüllte Preis-/Mehr-Pills |
| Launch Orange | `#b64400` | „Neu“-Label als reiner Text |

## Typografie
SF Pro Display/Text (Ersatz **Inter**), `numr`. global-nav 12/1 (−0.12) · compact-control 12/1.33 · body-small 14/1.29 (−0.224) · body 17/1.47 (−0.374) · feature-copy 17/1.24 · product-nav-title 19/1.21 (+0.228, 600) · kicker 21/1 (+0.231, 600) · feature-heading 40/1 (600) · **hero 80/1.05 (−1.2px, 600)**. Anker-Nav 17px/500.

## Form & Raum
Basis 4px (4…52·64·76·80·128·144). Radius: Karten/Bilder 28, Links 10, Pills 36, Inputs 980, Buttons 9999, Navigation 20. Section-Gap 90, Karten-Padding 28, Element-Gap 20. Schatten nur `0 0 0 1px #e6e6e8 / #86868b`.

## Komponenten (Kurzrezepte)
- **Outlined-Explore-Pill:** transparent, 1px #86868b, 9999, 12px/400, Zeile 16 — keine Füllung.
- **Pricing-Pill:** #0071e3, #fff 12px/400, 9999, kompakt (nur in Bar/Callout).
- **Anker-Navigation:** Labels 17px/500, transparent, Padding 28px vertikal, keine Box/Unterstrich.
- **Carousel-Control:** Track `rgba(210,210,215,.64)`, 36px Radius, Glyphen `rgba(0,0,0,.56)`.
- **Such-Input:** weiß, 1px #86868b, 980px Radius, Padding links 24 / rechts 45, Text 13px Arial.

## Do / Don't
- Do: #ffffff als Standard-Canvas, #f5f5f7 für Bänder; 28px für Medien; #0066cc für Text-Links.
- Don't: Verläufe, Schatten auf Karten/Callout, #0071e3 als Hero-Fläche, Hero in 700, farbige Status-Pills.

## Passt zu pulse-motion
`product-launch-hero`, `slanted-spread-hero`, `dock`, `product-timeline`, `immersive-full-screen-navigation`.
