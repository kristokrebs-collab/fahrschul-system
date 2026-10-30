# Glass Look (glass-look)
> Glossy-Glas-Schalter fuer alles Gebaute: durchscheinende Flaechen mit Blur, Glanzkante oben, Innenlicht und Tiefenschatten vor einer treibenden Farbszene (Bernstein, Violett, Tuerkis); hell und dunkel; Hover-Anhub als Feder, Eintritt ease-out.

## Wann einsetzen
- Dashboards, Karten, Docks, Menues, Hero-Bereiche, die "Apple-Glas"/"Glassy" wirken sollen
- Bestehende Komponenten aus dieser Bibliothek ohne Umbau auf Glas stellen (Schalter statt Neuschrieb)
- EN: glassmorphism, glossy glass, frosted glass, liquid glass, glass card, backdrop blur dashboard

## Quelle und Ehrlichkeit
Look nach einem Reel-Screenshot ("Glassy Dashboard V2", Code: `motion.div whileHover={{y:-5}}`, `glass-card p-6 rounded-2xl`). Werte sind eigene, plausible Werte, nicht gemessen.

## Design-These und Signatur
- **These:** Glas ist ein Instrument, keine Dekoration: Es zeigt, was dahinter liegt (Farbszene), und trennt Ebenen durch Licht statt durch Linien. Ruhige Typografie (ein Schnitt, grosse Zahlen), Farbe kommt nur aus der Szene, nie aus den Flaechen.
- **Signatur-Element:** die Glanzkante oben (1-px-Innenlicht) zusammen mit der langsam treibenden Dreifarb-Szene; beides zusammen macht den Look wiedererkennbar.
- **Bewegung:** Eintritt ease-out mit 60 ms Stagger, Hover-Anhub per Feder, Szene 38 s, nie linear.
- **Pruefung:** zwei Durchgaenge mit Screenshots (dunkel/hell, dann Handybreite); der zweite fand und behob einen Knopf, der die Kopfzeile ueberdeckte.

## So geht es
1. `assets/glass.css` einbinden, `assets/glass-look.js` einbinden (`<script src>`), Knopf "Glas" erscheint unten links; oder `?look=glass`; oder `document.documentElement.dataset.look='glass'`.
2. `glass-look.js` erkennt Flaechen selbst: deckende/Verlaufs-Hintergruende mit Radius >= 6 px werden `.gl`, vollflaechige Buehnen werden `.gl-stage` (durchsichtig, damit die Szene scheint). In eigenen Projekten `.gl` direkt vergeben.
3. Vollstaendige Vorlage: `assets/glass-look.html` (Stat-Karten, Pillen, Leiste).
Die Originalkomponenten bleiben unveraendert; ohne Schalter sehen sie aus wie vorher.

## Glas-Rezept (CSS-Tokens in glass.css)
- Tint: `linear-gradient(145deg, weiss 10 %, weiss 3 %, weiss 10 %)`; Blur `--gl-blur` 22 px, Saettigung 1,6
- Glanzkante: `inset 0 1px 0 weiss 26 %`, Unterkante 7 %; Tiefe: `0 14px 40px` dunkel
- Szene: drei Farbkreise (`--gl-a/b/c`), `animation: 38 s ease-out` alternate, nur `transform`
- Hell: Tint 55 %, Schatten violett-grau; Text immer `--gl-fg` (Kontrast pruefen)
- Bei > 24 Flaechen Blur auf 12 px senken (Rechenzeit)

## Motion-Tokens
`--ease-out`, `--ease-in`, `--spring` (Overshoot leicht). Hover: Anhub `-5px` per Feder; Eintritt: 520 ms ease-out, 60 ms Stagger. Nichts linear, Reduced-Motion: keine Szenenfahrt, kein Anhub; `prefers-reduced-transparency`: kein Blur.

## Interaktion & Barrierefreiheit
- Knopf mit `aria-pressed`, Fokusring sichtbar; Glasflaechen bleiben echte Elemente (kein Pseudo-Text)
- Kontrast auf Glas immer gegen die hellste Szenenfarbe pruefen (hell: dunkler Text)

## 120-Hz-Technik
Blur ist teuer: wenige, grosse Flaechen statt vieler kleiner; keine animierten Flaechen mit Blur auf alten Geraeten. Szene = ein fixes Element mit `will-change: transform`.

## Kreativ remixen
1. Glanz folgt dem Zeiger (Radial-Gradient an der Maus, ein rAF-Takt)
2. Szene aus Foto statt Farbkreisen (warmer Raum, wie im Reel)
3. Kanten mit Border Beam kombinieren
4. Wassertropfen-/Water-Button-Effekt als Glas-Variante

## Bekannte Abweichungen (ehrlich)
- Auto-Erkennung ist eine Heuristik: Texte-only-Komponenten bekommen nur die Szene; Flaechen mit transparentem Hintergrund bleiben ohne Glas
- Echtes Liquid-Glass-Lichtbrechen (Verzerrung) ist nicht nachgebaut, nur Blur-Glas
- Browser ohne `backdrop-filter` zeigen nur den Tint
