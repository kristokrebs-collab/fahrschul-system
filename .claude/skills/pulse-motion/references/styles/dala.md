# Dala (dala)
> Konstellation auf schwarzem Samt: reines Schwarz, EIN violetter Akzent, Bernstein-Funken, riesige federleichte Headlines.

**Theme:** dark · **CSS:** `assets/styles/dala.css` (`data-style="dala"`) · Stichworte: AI/Knowledge-SaaS, Manifest-Seite, Partikel-Hero, Void-Look, EN: dark void, ultralight body, particle field

## Signature-Moves (Schnipsel zum Klauen)
- **Void statt Panels:** überall #000, keine Karten/Rahmen/Schatten — Inhalt schwebt, Abstand ersetzt Container.
- **Hierarchie nur über Größe:** Headlines Gewicht 400 bei 78–113px, Tracking −0.04em, Zeilenhöhe 1.1; Fließtext 18px **Gewicht 200** (ultraleicht).
- **Ein einziger Pill-Button** in Violett pro Ansicht; sonst Ghost-Textlinks.
- **Partikel-Hero:** tausende kleine **umrissene Dreiecke** (1–2px Strich) in vollem Spektrum (Violett, Amber, Teal, Magenta, Blau) formen eine Gehirn-/Wolkenform; ringsum ambient verstreut, niedrige Deckkraft. Animiertes Punktlicht-Feld.
- **Zickzack-Zwei-Spalter:** riesige Headline links ↔ Visual rechts, dann gespiegelt; 60–120px Abstand.
- Kleines **UPPERCASE-Label in Amber** (14px/600) über dem Fließtext.

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Void | `#000000` | Canvas, alle Sektionen |
| Bone White | `#ffffff` | Headlines, Text, aktive Nav |
| Ash Gray | `#9a9a9a` | gedimmte Nav, Ghost-Links |
| Silver Mist | `#bdbdbd` | Tertiärtext, Captions |
| Electric Iris | `#8052ff` | Primär-Button, Logo, Akzent (nie große Flächen) |
| Saffron Spark | `#ffb829` | Highlight-Text, Links, Labels |
| Deep Verdant | `#15846e` | Logo-Verlauf, dezente Washes |

## Typografie
PPNeueMontreal (Ersatz **Inter**), `ss01`. Gewichte 200/400/600/700.
| Rolle | Größe/Zeile | Tracking |
|---|---|---|
| caption | 12/1.5 | – |
| nav-label (600, UPPERCASE) | 14/1.2 | +0.025em |
| body (Gewicht 200) | 18/1.5 | normal |
| heading-2xs / xs / sub | 24/1.25 · 27/1.0 · 36/1.2 | −0.48px (24) |
| heading-sm / heading | 42/1.2 · 48/1.1 | −1.68px |
| heading-lg / display | 78/1.1 · 113/1.1 | −3.12px · −4.52px |

## Form & Raum
Basis 6px (6·12·18·24·30·36·60·96·120). Radius 24 (Nav/Karten/Buttons, praktisch 22.5 Pill), Tags 9999. Max-Breite 1280, Section-Gap 60–120. Keine Elevation — Hierarchie durch Größe, Kontrast, Weißraum.

## Komponenten (Kurzrezepte)
- **Primär-Pill:** #8052ff, weiß, 14px/600 UPPERCASE .025em, Padding 14.4×16, Radius 22.5.
- **Ghost-Link:** transparent, #fff/#9a9a9a, 14px/400, keine Box.
- **Nav:** transparent auf Schwarz, Logo links, Links 14px UPPERCASE (inaktiv #9a9a9a), Pill rechts; kein Blur, kein Rand.
- **Team-Karte:** Porträt 24px Radius, Rolle 12px UPPERCASE #8052ff, Name 27px; ohne Hintergrund.
- **Carousel-Dot:** 8px, aktiv #8052ff.

## Do / Don't
- Do: Violett nur für Buttons/Akzente; Body 200; Headlines nie fett; Links Amber oder Weiß.
- Don't: Violett als Flächenfüllung; Karten mit Rahmen/Schatten; Verläufe in UI (nur Logo + Partikel); Fotos im Hero.

## Passt zu pulse-motion
Text-Effekte auf Schwarz: `text-prism-split`, `pixel-text-fill`, `text-ascii-cascade`, `dancing-letters`; Hero-Partikel → eigene rAF-Canvas-Variante (Regeln: `principles-120hz.md`).
