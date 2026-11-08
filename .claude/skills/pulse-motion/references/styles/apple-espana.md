# Apple España (apple-espana)
> Kathedrale aus Weißraum: riesige Headlines schweben auf fast weißem Grund, Farbe kommt nur aus dem Produkt, ein einziger blauer Faden.

**Theme:** light · **CSS:** `assets/styles/apple-espana.css` (`data-style="apple-espana"`) · Stichworte: Produktseite, Hardware-Launch, Pastell-Finishes, EN: white gallery, SF Pro, pill CTA

## Signature-Moves
- **Riesige Display-Headline** (80–96px, Gewicht 600–700, Tracking −1.2…−1.44px, Zeilenhöhe ~1.04) zentriert über dem Produkt.
- **Sektions-Rhythmus durch Farbwechsel** Weiß ↔ #f5f5f7 mit 100–120px Abstand — **keine Linien, keine Schatten**.
- **28px-Radius** für alle Karten/Produktbilder; Buttons Pill (980px).
- **Blau nur für Interaktion:** Füll-Pill #0071e3, Inline-Links #0066cc mit Pfeil `›`.
- **Produkt trägt die Farbe:** zwei Karten nebeneinander, jede mit Finish-Farbe als Fläche; UI bleibt monochrom.
- Kontrast Display (Zeile 1.04) ↔ Body (Zeile 1.47) statt Größensprüngen.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Primary Ink | `#1d1d1f` | Headlines, Text, Buttonlabel |
| Mid Gray / Deep Gray | `#707070` / `#474747` | Sekundärtext, Nav |
| Hairline | `#d6d6d6` | Haarlinien (selten) |
| Canvas / Paper | `#f5f5f7` / `#ffffff` | abwechselnde Bänder / Karten + Seite |
| Cool Wash | `#e8e8ed` | Hover, Pagination-Füllung |
| Faded Surface | `#fafafc` | geöffnete Nav, Panels |
| Quiet Dot | `#777779` | inaktive Dots |
| Electric Blue | `#0071e3` | gefüllte CTA (nur das) |
| Link Blue | `#0066cc` | Textlinks |
| Ember | `#b64400` | „Nuevo“-Label (Text, 1×/Seite) |
| Finishes | Sky `#c8d8e0` · Citrus `#dddc8c` · Starlight `#f0e4d3` · Silver `#e3e4e5` · Blush `#e8d0d0` · Indigo `#596680` · Midnight `#2e3642` | nur Produkt-Flächen |

## Typografie
SF Pro Display / Text (Ersatz **Inter**), `numr`.
| Rolle | Größe/Zeile | Tracking |
|---|---|---|
| micro / caption | 12/16 · 14/18 | −0.12 · −0.224px |
| body-sm / body | 17/25 · 21/29 | −0.374 · +0.231px |
| body-lg / subheading | 28/32 · 32/36 | +0.196 · +0.128px |
| heading-sm / heading | 40/48 · 56/60 | – · −0.28px |
| heading-lg / display | 80/84 · 96/100 | −1.2 · −1.44px |
Display 600–700, Section-Header 600, Body 400.

## Form & Raum
Basis 4px (…28·32·40·44·48·52·76·80·120·144). Radius: Karten/Bilder 28, Links 10, Badges 36, Buttons 980/999. Max-Breite 1200, Section-Gap 100–120, Karten-Padding 28, Element-Gap 8–10. **Keine Schatten.**

## Komponenten (Kurzrezepte)
- **Füll-Pill:** #0071e3, weiß, 17px/400, Padding 16×11, Radius 980; max. 1× pro Sektion.
- **Ghost-Pill:** transparent, 1px #1d1d1f, 999px, 17px.
- **Textlink:** #0066cc + `›`, Unterstrich nur Hover.
- **Nav:** 44px, weiß→#fafafc beim Scrollen, `backdrop-filter: blur(20px)`, Links 12px.
- **Feature-Karte:** 28px, weiß/#f5f5f7, Padding 28–40, Headline 40–56px 600.
- **Finish-Swatch:** ~80px Quadrat 28px Radius, ohne Label. **Dots:** 8px, aktiv #1d1d1f.

## Do / Don't
- Do: Weiß/#f5f5f7 abwechseln; 17px/−0.022em Body; Headlines ≥ 40px; Produktbild trägt Farbe.
- Don't: Schatten, Verläufe auf UI, Border-Radius < 10px bei Interaktivem, #0071e3 als Text, zentrierte Mehrzeiler-Absätze.

## Passt zu pulse-motion
`dock`, `product-timeline`, `slanted-spread-hero`, `product-launch-hero`, `parallax-strip-slider`, `morphing-language-selector`.
