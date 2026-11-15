# Relay Lime (relay-lime)
> Neon-Leitung auf Schwarz: tiefes Schwarz, EIN Limettengelb für Handlung, Headline halb Sans/halb kursive Serif und ein weiches Lichtband als Hintergrund.

**Theme:** dark · **CSS:** `assets/styles/relay-lime.css` (`data-style="relay-lime"`) · Stichworte: KI-Produkt, Workflow/Automation, Landing-Hero, EN: neon lime on black, light ribbon, serif italic accent

Quelle: Beobachtung einer KI-gebauten Produkt-Site (Reel „How I make sites like this in 5 minutes“, Oktober 2026). **Eigener Look, kein Markenmaterial.**

## Signature-Moves
- **Limette `#d7f23a` nur für Handlung** (Primärknopf, Chip, aktive Zustände); alles andere Schwarz und warmes Grau.
- **Gemischte Headline:** Sans für die Aussage, **kursive Serif** für das Schlusswort („The handoffs run *themselves.*“).
- **Lichtband** (`.rl-ribbon`): zwei weiche Radial-Verläufe (Limette, Glut) mit Blur 24 px und `screen`, langsam bewegt.
- **Mono-Tags** (11 px UPPERCASE) über Abschnitten, Produktfenster als dunkle Karte mit Haarlinie.
- Scroll-Szenen: Laptop/Produkt wird mit dem Scrollen „eingeschaltet“ (Fläche leuchtet limette, dann Inhalt).

## Farben
| Name | Hex | Rolle |
|---|---|---|
| Black | `#060705` | Canvas |
| Coal | `#101209` | Karten |
| Line | `#23271a` | Haarlinien |
| Text | `#f1f3e8` | Text |
| Dim | `#8c9378` | Labels |
| Lime | `#d7f23a` | Handlung |
| Ember | `#ff6a3d` | nur Lichtband/Warnung |

## Typografie
Inter 400/600 + Instrument Serif (Ersatz Playfair/Georgia) kursiv für Akzentwörter · JetBrains Mono für Tags. display 64–96/1 (−0.03em), body 16/1.55.

## Form & Raum
Basis 8 px. Radius Karten 14, Buttons 10. Max 1160, Section-Gap 112. Schatten nur als Limetten-Glow (0 0 40px rgba(215,242,58,.25)) um das aktive Produktfenster.

## Komponenten (Kurzrezepte)
- **Hero:** Tag, Headline, Untertitel, Limetten-Button + Ghost, darunter Produktfenster mit Lichtband dahinter.
- **Workflow-Zeile:** Karten mit Mono-Zahl, Pfeil, Limetten-Chip „live“.
- **Footer:** Mono-Links, Haarlinie.

## Do / Don't
- Do: Limette sparsam (1–2 Stellen je Bildschirm); Serif nur für ein bis drei Wörter.
- Don't: zweite Akzentfarbe als Fläche; Glas-Blur auf Limette; Headlines komplett in Serif.

## Passt zu pulse-motion
`product-launch-hero`, `light-and-depth` (Spotlight), `border-beam`, `text-prism-split`, `glyph-portal`.
