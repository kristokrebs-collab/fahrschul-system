# ORYZO AI (oryzo-ai)
> Dunkelkammer-Editorial: ein einzelnes Objekt schwebt im warmen Dunkel, Creme-Typografie ist die einzige Dekoration.

**Theme:** dark · **CSS:** `assets/styles/oryzo-ai.css` (`data-style="oryzo-ai"`) · Stichworte: Produkt-Reveal, 3D-Objekt, Studio-Credit, EN: warm dark, uppercase editorial, museum label

## Signature-Moves
- **Warm-Dunkel statt Schwarz:** Canvas #100904, Text **Creme #ffedd7** — nie reines #fff/#000.
- **Alles UPPERCASE / Gewicht 500** (Nav, Headlines, Labels, Buttons). Einzige Ausnahme: **29px/400 gemischte Schreibung** als „Erklärstimme“ — der Wechsel signalisiert „jetzt wird beschrieben“.
- **Display-Zeilenhöhe 0.9** bei 41–51px: die Versalien stapeln sich zu einem Block.
- **Void-Reveal:** 100vh-Sektionen, 3D-Objekt mittig, links Heading, rechts Body — **3 Spalten (Text / Objekt / Text)**, 18px Gutter.
- **Gestrichelte Haarlinie** (1px dashed #40372e) als einziger Trenner; Aktiv-Nav mit gestricheltem Unterstrich.
- **Vertikales Seiten-Label** rechts (90° gedreht, „ORYZO 1-MODEL“) wie eine Seriennummer.
- Orange nur für **Credit-Zeile / Studio-Link**, nie für Buttons.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Warm Cream | `#ffedd7` | Text, Rahmen, Nav |
| Walnut Shadow | `#100904` | Canvas |
| Bark Brown | `#382416` | gefüllter Button, einzige Erhöhung |
| Cork Border | `#40372e` | Haarlinien, gestrichelte Trenner |
| Driftwood | `#6c5f51` | sekundäre Trenner, gedämpft (als Textfarbe zu blass → für Sekundärtext abgeleitet `#b8a995`) |
| Ember Accent | `#dc5000` | Credit/Link-Akzent (selten) |
| Pure Black | `#000000` | nur SVG-Füllungen |

## Typografie
Halyard Display Variable (Ersatz **Inter/Söhne**), `ss01`, Tracking normal. Arial 8px nur für Legal („* ADOBE ILLUSTRATOR“).
subheading 18/1 · heading-sm 24/1.09 · **body 29/1.26 (400, gemischt)** · heading 41/0.9 · display 51/0.9 (alle 500 UPPERCASE). Größen 8–51px.

## Form & Raum
Radius: Karten 12, Inputs 0, Pill-Button 36, Outlined 22.5, voll 9999. Padding 24, Gap 18; Abstände 6·8·9·10·12·14·18·24·31·41·45·68·204. **Full-Bleed, kein Max-Width**, jede Sektion 100vh. Keine Schatten — Tiefe durch Stufe #100904 → #382416.

## Komponenten (Kurzrezepte)
- **Pill gefüllt:** Bark #382416, Creme, Padding 14×24, Radius 36, UPPERCASE 8–14px — 1× pro Seite.
- **Outlined-Ghost:** transparent, 1px Creme, Radius 22.5, Padding 7.5×0.
- **Underline-Link / Underline-Input:** 0 Radius, Creme; Input nur untere 1px-Linie.
- **Fixed Nav:** transparent, 4 Punkte (INTRO · FEATURES · PRODUCT · CONTACT) 12px.
- **Hero-Info-Karte:** 12px, halbtransparent, Überschrift UPPERCASE + gestrichelte Trennung + Body.
- **Video-Thumb:** klein, 12px Radius, Mini-Wortmarke + Play.

## Do / Don't
- Do: Creme statt Weiß; Orange sparsam; ein gefüllter Button pro Sektion; Text immer linksbündig.
- Don't: Schatten; Radius < 12px bei Containern; Kleinschreibung in Headings/Nav; Body zentrieren.

## Passt zu pulse-motion
`cinematic-orbit-hero`, `glyph-portal`, `product-launch-hero`, `text-morphing`, `motion-footer`.
