# Origin Financial (origin-financial)
> Mitternachts-Galerie: Near-Black, Whisper-Serif in 80–96px und leuchtende Farbkacheln; Finanzen als kuratierte Kunst.

**Theme:** dark · **CSS:** `assets/styles/origin-financial.css` (`data-style="origin-financial"`) · Stichworte: Fintech-App, AI-Advisor, Feature-Kacheln, EN: serif display, mono labels, glass nav

## Signature-Moves
- **Drei Stimmen:** Serif-Display (emotional, Gewicht **300**) · neutrale Grotesk (UI, 300/400) · **Mono UPPERCASE** (Labels/Daten ≤ 12px).
- **Display 96px / Zeile 0.9, Gewicht 300** — ein Wort kursiv gegen Roman (editorial); anti-Konvention zu fettem Fintech.
- **Farbe nur in Kacheln:** 30px-Vollflächen (Iris, Cyan, Pale Iris, Deep Iris, Orchid, Periwinkle); sonst Graustufen. Cyan nur für Datenlinien/Sparklines.
- **Stufen statt Schatten:** #0f1011 → #2e2e2e → #cacaca; heller Silver-Stat-Block bricht den Dunkelrhythmus (max. 1–2/Seite).
- **Glas-Nav:** `rgba(255,255,255,.1)` + `backdrop-filter: blur(24px)` über Obsidian.
- **AI-Prompt-Feld:** schwarz, 8px Radius, asymmetrisch (22px links), runder Submit-Button.
- **Phone-Mockup-Modul:** Graphite, 16px Radius, **90px Padding** — Premium-Rahmung.
- Eyebrow-Pille: `rgba(255,255,255,.12)`, 1px `.15`, Mono 12/500 UPPERCASE („$1 FOR 1 YEAR — LIMITED TIME“).

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Iris Gleam | `#847dff` | Haupt-Kachelfarbe |
| Cyan Signal | `#00b3dd` | Daten/Charts |
| Pale / Deep Iris | `#d1c9ff` / `#4b49aa` | helle / dunkle Kachel |
| Orchid Bloom / Periwinkle | `#dd90d8` / `#90b8f0` | Lifestyle- / Advisory-Kachel |
| Obsidian / Abyss | `#0f1011` / `#090a0b` | Canvas / tieferes Band |
| Graphite / Steel | `#2e2e2e` / `#3f4041` | Karte / Hover |
| Silver | `#cacaca` | invertierte Karte |
| Fog / Ash | `#6a6b6b` / `#9f9fa0` | Muted / Body |
| Cloud / Pure / Void | `#f5f5f7` / `#ffffff` / `#000000` | Heading-Variante / Aktion / Icon |

## Typografie
Lyon Display 300 (Ersatz **Playfair/DM Serif Display**) · Suisse Int'l 300/400 (Ersatz **Inter/Geist**) · Roboto Mono 400/500 UPPERCASE.
mono-label 12/2 · body-sm 14/1.67 · body 16/1.5 · sub 18/1.5 (300) · heading-lg 38/0.9 · display-sm 80/1 · **display 96/0.9**. Labels 11px UPPERCASE Tracking 0.182em; Mono-Tracking 0.016–0.021em.
Body nie reines Weiß: Ash #9f9fa0; Headings Cloud.

## Form & Raum
Basis 4px (…60·68·100·120·140). Radius: Karten 16, Inputs/Buttons/Nav 8, Kategorie-/Feature-Kacheln 30, Pille 9999. Max 1200, Section-Gap 80, Padding 32. Einziger Schatten: `rgba(0,0,0,.2) 0 18px 20px` (1 Button). Verläufe: **Dark-Chrome** `135° #2b2b2c→#131313`; **Sky** `#0f1011 → #131d27 18% → #1a4788 37% → #408ac1 69%`.

## Komponenten (Kurzrezepte)
- **Primär-CTA:** #fff, #000-Text, 8px, 12×18, 16px/400 + Pfeil `→`.
- **Ghost:** transparent, 1px weiß; **Nav-Glas:** 9×12, Radius 8.
- **Feature-Karte:** Vollfarbe, 30px, Padding 32, Titel Serif 38px/300 weiß + 16px Beschreibung.
- **Award-Laurel:** weiße Lorbeer-SVG + Name Serif 18/300 + Mono 10–12 UPPERCASE.
- Motion: **0.2s ease** (Hover), **2.5s cubic-bezier(.455,.03,.515,.955)** (Reveals), `borderTurn` (1px-Kontur wandert um Hexagon/Kreis).

## Do / Don't
- Do: Serif nie fetter als 300; Akzentfarben nur auf Kacheln; Weiß-auf-Schwarz als einzige Primäraktion.
- Don't: Schatten auf Karten; Akzentfarbe als Text < 18px; Cyan als Fläche/Body; Verläufe auf UI (nur die zwei oben).

## Passt zu pulse-motion
`agent-trace`, `text-morphing`, `autocomplete`, `reel-collage`, `immersive-full-screen-navigation`.
