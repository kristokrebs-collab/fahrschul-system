# Morphing Language Selector (morphing-language-selector)
> Eine Pille ("English v") morpht per Feder zu einer scrollbaren Sprachliste (dunkles Panel), nach Auswahl zieht sie sich zurueck zur Pille mit neuer Sprache ("Deutsch v").

## Wann einsetzen
- Sprach-/Region-/Waehrungs-Umschalter in Header, Footer, Settings (language switcher, locale picker)
- Jedes Dropdown, das sich "aus sich selbst heraus" entfaltet statt als Popover zu erscheinen (morphing dropdown / select)
- Kompakte Auswahl mit vielen Optionen (13+) auf Touch und Desktop (scroll list, bottom-sheet-Ersatz)
- Premium-Dark-UI, Landingpages, Onboarding ("Waehle dein Land/Plan/Theme")
- Wow-Moment bei einfacher Auswahl: Layout-Morph, Spring mit leichtem Overshoot

## Anatomie & Zeitleiste
Ein Element (`.lm-box`, 230x275) wird per `scale(sx, sy)` zwischen Pillengroesse (sx=Pillenbreite/230, sy=38/275) und 1 gemorpht, inkl. Inhalt (der Inhalt wird mit verzerrt, wie bei Framer-Layout-Projection). Das Pillen-Label (`.lm-trigger`) ist ein eigenes, unverzerrtes Element.

| Phase | Zeit (ab Tap) | Verhalten |
|---|---|---|
| Tap auf Pille | 0 | Label sofort weg, Panel sichtbar bei Pillengroesse, Radius = Pille |
| Oeffnen (Feder) | 0-~190 ms bis erster Peak | sx/sy gleiche Feder, ~90 % nach 120 ms, Peak ~+1.8 % bei ~195 ms, Ruhe ~350 ms |
| Radius | 0-140 ms | von Pillen-Radius (ellipt.) zu 24 px, ease-out cubic |
| Inhalt | 0-90 ms | Opacity 0 -> 1 (Header + Zeilen mitskaliert) |
| Liste scrollen | frei | Touch/Wheel nativ; Scroll-Daumen (4 px, #5a5a5a) erscheint, blendet 1.4 s nach letzter Bewegung aus |
| Tap auf Sprache | 0 | Panel-Inhalt sofort weg, Pillen-Label ("Deutsch v") erscheint oben-links an der Box (16 px Padding) |
| Halten | 0-40 ms | Box bleibt ~Panelgroesse, Radius sofort elliptisch ("Tonnen"-Form: rx=R/sx, ry=R/sy) |
| Schliessen (Feder) | 40-~280 ms | Box schrumpft kritisch gedaempft zur Pille, Label wandert mit zur Mitte, kein Overshoot |

Panel gemessen: 230x275 px (Referenz 1234x673, zentriert), Radius 24, Kopf 36 px (Text 20 px von oben, Trennlinie 1 px bei y=35), Zeilen 40 px + 3 px Gap (Raster 43 px), Scrollbereich endet 10 px ueber Panelunterkante. Pille 128x38 (Label "English").

## Motion-Tokens
- SPRING_OPEN: stiffness 660, damping 40, mass 1 (zeta ~0.78, Overshoot ~1.8 %, Peak ~195 ms)
- SPRING_CLOSE: stiffness 560, damping 47 (zeta ~1.0), CLOSE_DELAY 40 ms
- RADIUS_OPEN_MS 140 (ease-out cubic), CONTENT_IN_MS 90, Hover-Zeile 120 ms, Daumen-Fade 300 ms
- Gemessen aus Video (Aufloesung ~8 ms): Breite 145 -> 232 px in ~170 ms; Hoehe 72 -> 279 px; Schliessen 270 -> 38 px Hoehe in ~200 ms nach 50 ms Halten

## Look-Tokens
- Buehne #131313; Panel #1e1e1e, Rahmen 1 px #303030, Schatten `0 14px 40px rgba(0,0,0,.45)`
- Pille #1d1d1d, Rahmen #2b2b2b, Text #e3e4f3 (13.5 px / 500), Chevron #999aaa; Gaps 9 / 12 px, Padding 16/20
- Zeilen: Text #d0d2e4 14 px, Flagge 16 px Emoji, aktiv: Text #60a5fa, Hintergrund #151d27, Haken rechts; Hover/Touch #1a1a1a
- Kopf "SELECT LANGUAGE": 11 px, 600, Tracking .08em, #8e8e9c; X-Icon 12 px
- Schrift: Inter, Geist, Roboto, ... (Original wirkt Roboto-artig = Android-Systemschrift)

## Interaktion & Barrierefreiheit
- Tap/Klick auf Pille oeffnet; Tap auf Zeile waehlt + schliesst; X, Escape, Tap ausserhalb schliesst ohne Aenderung
- Scrollen nativ per Touch (`touch-action: pan-y`, `overscroll-behavior: contain`), eigener Overlay-Daumen
- Tastatur: Pille Enter/Space/Pfeil runter oeffnet; Pfeile/Home/End bewegen Fokus, Enter/Space waehlt, Escape zu
- ARIA: `aria-haspopup="listbox"`, `aria-expanded`, `role=listbox/option`, `aria-selected`; Fokus-Ring sichtbar
- `prefers-reduced-motion`: kein Morph, Zustand springt direkt

## 120 Hz
- Technik: Ein rAF-Loop mit Zeitstempel (dt <= 50 ms), Feder per semi-implizitem Euler mit festem Substep 1/240 s im Akkumulator, Restzeit wird interpoliert; Loop stoppt, sobald Feder ruht (und Daumen ausgeblendet)
- Nur `transform` (scale/translate3d) und `opacity` pro Frame; `will-change` nur waehrend der Animation; `contain: layout paint`; Metriken (Pillenbreite, scrollHeight) nur bei Zustandswechsel gemessen
- Ausnahme: `border-radius` wird waehrend 140 ms (Oeffnen) bzw. einmalig (Schliessen) gesetzt - kleine Flaeche, kein Layout
- check120: `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine` (4x: p95 3.4 ms, p99 5.9 ms, 0.1 % ueber Budget). Verbleibendes WARN "style.height": einmaliges Setzen der Daumenhoehe beim Oeffnen, nicht pro Frame.

## Einbindung
`assets/morphing-language-selector.html`: Block `COMPONENT:START..END` (HTML) + `/* COMPONENT CSS */` + `initMorphingLanguageSelector(root, opts)`.
- `opts.languages`: `[{code,label,flag}]`, `opts.value`: Start-Code, `opts.onChange(lang)`, `opts.config`: ueberschreibt `MLS_CONFIG` (Federn, Delay, Groessen)
- Rueckgabe: `{open, close, setValue, getValue, state}`
- Panel-Groesse in CSS (`--panel-w/h`) UND `MLS_CONFIG.PANEL_W/H` gleich halten; `--btn-h` = `BTN_H`

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich ein `motion.div` mit `layout` (shared layout, `layoutId`) zwischen Button und Liste, Radius via `borderRadius`-Style (Framer korrigiert Radius, daher die Tonnenform).
```tsx
<motion.div layout style={{ borderRadius: open ? 24 : 999 }}
  transition={{ type: "spring", stiffness: 660, damping: 40 }}>
  {open ? <List/> : <motion.span layout="position">{flag} {label}</motion.span>}
</motion.div>
```
Schliessen eher `stiffness ~560, damping ~47` (ohne Overshoot).

## Kreativ remixen
1. Overshoot hochdrehen (damping 40 -> 18): Panel "plopt" wie Gummi auf, mit Glas-Blur (`backdrop-filter`) auf dem kleinen Panel
2. Stagger: Zeilen nach dem Oeffnen mit 25 ms Versatz einblenden/hochgleiten (translateY 8 -> 0)
3. Als Waehrungs-/Land-/Theme-Picker, bei Auswahl Farbe der ganzen Seite per View-Transition morphen
4. Magnetisches Panel: leichtes Folgen des Zeigers (3D-Tilt, rotateX/Y +-4 deg) im geoeffneten Zustand
5. Haptik/Sound: Vibration + weiches Tick beim Einrasten, Flagge der Auswahl springt per Spring in die Pille

## Bekannte Abweichungen
- Schrift im Test-Chromium ist Fallback (Liberation/Arial statt Roboto); Pillenbreite haengt von der Schrift ab (Original 128 px)
- Emoji-Flaggen kommen vom System-Emoji-Font, nicht identisch zum Video
- Rahmen wird beim Morph mit skaliert (dünner/dicker), im Original aehnlich, Detail nicht erkennbar
- Zeilen-Hover-Ton aus Einzelframe geschaetzt; Feder-Konstanten aus 10-ms-Messpunkten gefittet, nicht aus Quellcode
- Scroll-Daumen-Ausblendezeit und Scroll-Physik (nativ) nicht exakt erkennbar; Aufnahme beim Oeffnen zeigt vorangehende Browser-Overlay-Glitches (ignoriert)
