# Radial Share (radial-share)
> Teilen-Knopf, aus dem fuenf Kanaele (WhatsApp, X, LinkedIn, E-Mail, Link kopieren) federnd auf einem Bogen aufgehen; der Bogenradius wird aus Winkelabstand und Mittenabstand gerechnet, Druck flutet die Kanalfarbe vom Druckpunkt aus.

## Wann einsetzen
- Teilen-/Aktionsmenue unter Artikeln, Karten, Produktseiten; Floating Action Button mit Optionen
- Radiale Menues mit wenigen Eintraegen (3 bis 7)
- EN: radial share button, radial menu, fan out buttons, floating action menu, social share, press flood

## Quelle und Ehrlichkeit
Nachbau nach einem Reel-Screenshot ("Share Button Animation", Code teilweise lesbar). **Eigener Code** nach Beschreibung; Zeiten und Farben sind plausible Werte, nicht gemessen. Teilen-Links sind oeffentliche Standard-URLs (wa.me, x.com/intent, LinkedIn share-offsite, mailto).

## Anatomie & Zeitleiste
| Phase | ms | Verlauf |
|---|---|---|
| Aufgehen | 520 | je Kanal translate auf den Bogen + scale .4 -> 1, Feder `cubic-bezier(.34,1.56,.64,1)` (leichter Overshoot), Stagger 38 ms |
| Zugehen | 220 | zurueck zum Toggle, `cubic-bezier(.55,.08,.4,.95)` (ease-in), ohne Stagger |
| Toggle-Icon | 300 | Teilen-Symbol dreht weg, X dreht ein |
| Fluten | 420 | Kreis (registrierte Eigenschaft `--fr`) waechst ab Druckpunkt, ease-out; Glyph doppelt (neutral unten, weiss oben), beide mit demselben Kreis beschnitten |

## Geometrie
Sehne zwischen Nachbarn = `gap * d`; Bogenradius `--r = d * gap / (2 * sin(pitch / 2))` (CSS `sin()`); Position je Kanal i: Winkel `a = (i - mid) * pitch`, `translate(r*sin(a), -r*cos(a))`. Standard: d 48 px, pitch 46 Grad, gap 1,5.

## Motion-Tokens
`--open-ms:520`, `--close-ms:220`, `--stagger-ms:38`, `--flood-ms:420`, `--spring`, `--ease-out`, `--ease-in`. Eintritt ease-out/Feder, Austritt ease-in, nichts linear.

## Interaktion & Barrierefreiheit
- Toggle mit `aria-expanded`; Kanaele sind echte Buttons mit Namen, geschlossen `tabindex=-1` und `visibility:hidden`
- Pfeiltasten wandern durch die Kanaele, Esc schliesst und fokussiert den Toggle; Klick ausserhalb schliesst
- Kopieren schreibt in der Klick-Geste in die Zwischenablage und meldet das Ergebnis per `aria-live`
- `prefers-reduced-motion`: nur Blende, kein Bogenflug, kein Fluten
- Demo steht auf `dryRun:true`: es wird nichts geoeffnet oder gesendet; im Einsatz `dryRun` weglassen

## 120-Hz-Technik
Transform/Opacity per CSS-Transition. Das Fluten animiert `clip-path` ueber `--fr` auf einem 48-px-Knopf (Paint, kleine Flaeche, gemessen ok). Test: `check120.cjs` = ok (4x CPU).

## Einbindung
`initRadialShare(rootEl, {url, title, text, dryRun})`; Anzahl der Kanaele im HTML und `--count` angleichen, Kanal-Farben ueber `--brand` je Knopf.

## React/Framer-Motion-Mapping
```tsx
<motion.button animate={{x: r*Math.sin(a), y: -r*Math.cos(a), scale: open?1:.4, opacity: open?1:0}}
  transition={{type:"spring", stiffness:420, damping:22, delay: open? i*.038 : 0}} />
```

## Kreativ remixen
1. Voller Kreis (pitch 360/count) oder Halbkreis nach unten, wenn oben kein Platz ist
2. Kanalfarbe als Glow-Ring (Border Beam) beim Hover
3. Tooltip-Labels mit Dock-Magnification kombinieren
4. Nach dem Kopieren: Haken-Morph im Kopier-Knopf

## Bekannte Abweichungen (ehrlich)
- Nachbau aus Screenshot; Originalfarben und Zeiten nicht belegt
- Kopieren in Headless-Chromium ohne Berechtigung meldet "nicht moeglich"; im echten Browser per HTTPS/localhost mit Klick-Geste ok
- Marken-Glyphen sind vereinfachte eigene Pfade, keine offiziellen Logos
