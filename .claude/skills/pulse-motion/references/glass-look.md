# Glass Look (glass-look)
> Glas als Linse (v2): Schalter fuer alles Gebaute. Durchscheinende Flaechen mit Blur vor einer treibenden Farbszene (Bernstein, Violett, Tuerkis) und EIN gemeinsames Licht: die dem Zeiger zugewandte Randkante leuchtet auf jeder Scheibe. Hell und dunkel; Hover-Anhub als Feder, Eintritt ease-out.

## Wann einsetzen
- Dashboards, Karten, Docks, Menues, Hero-Bereiche, die "Apple-Glas"/"Glassy" wirken sollen
- Bestehende Komponenten aus dieser Bibliothek ohne Umbau auf Glas stellen (Schalter statt Neuschrieb)
- EN: glassmorphism, glossy glass, frosted glass, liquid glass, glass card, backdrop blur dashboard

## Quelle und Ehrlichkeit
Look nach einem Reel-Screenshot ("Glassy Dashboard V2", Code: `motion.div whileHover={{y:-5}}`, `glass-card p-6 rounded-2xl`). Werte sind eigene, plausible Werte, nicht gemessen.

## Design-These und Signatur (v2)
- **These:** Glas ist eine Linse, kein Anstrich. Es zeigt, was hinter ihm liegt, und reagiert auf ein gemeinsames Licht. Alle Scheiben teilen dieselbe Lichtquelle; das schafft Zusammenhang statt Dekoration.
- **Signatur-Element (genau eins):** die lichtzugewandte Randkante. Pro Scheibe ein Einheitsvektor zum Licht; die Kante auf dieser Seite leuchtet (1,2-px-Innenschein + Halo), die Gegenseite bekommt Innenschatten, der Schlagschatten faellt vom Licht weg. Dazu ein Glanzfleck, der dem Licht folgt. Ohne Zeiger oder bei Reduced Motion steht das Licht oben links.
- **Typografie/Farbe:** eine Familie, grosse Zahlen leicht (300, enges Tracking), Beschriftung klein und gedaempft; Farbe kommt nur aus der Szene, Akzent nur semantisch (`.gl-up`).
- **Textur:** feines Korn ueber der Szene (gegen Banding), vierte kleine Violett-Kugel in der Mitte, damit hinter grossen Scheiben nie Schwarz steht.
- **Bewegung:** Licht folgt exponentiell geglaettet (110 ms, ease-out-Verhalten); Eintritt ease-out + 60 ms Stagger; Hover-Anhub per Feder; Szene 38 s; nichts linear.

## Entstehung (ehrlich, prototype-first)
Die erste Fassung (v1) entstand ohne Prototyp, die These kam erst danach. v2 wurde neu und in dieser Reihenfolge gebaut:
1. These + Signatur schriftlich vor dem Code; 21st.dev-Suche als Anregung (Zeiger-Glanz, Randlicht bei "Glass Card", "Liquid Glass").
2. Eigenstaendiger Prototyp (eine HTML-Datei, nicht im Skill), Screenshots dunkel, hell, 390 px.
3. **Durchgang 1** (gesehen): Mitte der dunklen Szene war schwarz und die Scheiben wirkten dort flach -> Szene staerker, vierte Kugel; hell fehlte die Kantendefinition -> Haarlinie + staerkerer Schatten; Chart-Fuellung endete hart -> Verlauf ueber drei Stops.
4. **Durchgang 2** (gesehen, plus Licht links unten, Zeigerbewegung, Frame-Messung): die vierte Kugel war rosa und brach die Dreifarb-Palette -> auf Violett gestellt; Chart-Kante als Diagramm-Ende erkannt (kein Fehler).
5. Erst dann Uebernahme in `glass.css`/`glass-look.js`. Beim Gegenpruefen der Vorlage gefunden und behoben: die erzwungene Textfarbe auf Glas machte gedaempfte Texte und das gruene Plus weiss -> Klassen `.gl-dim`/`.gl-up`; der Glas-Knopf war im hellen Thema kaum lesbar -> eigene Farbe.
6. Gegenprobe an 8 fremden Komponenten (ohne Skriptfehler, Licht reagiert); Reduced Motion geprueft (Licht statisch, keine Szenenfahrt).

## So geht es
1. `assets/glass.css` einbinden, `assets/glass-look.js` einbinden (`<script src>`), Knopf "Glas" erscheint unten links; oder `?look=glass`; oder `document.documentElement.dataset.look='glass'`.
2. `glass-look.js` erkennt Flaechen selbst: deckende/Verlaufs-Hintergruende mit Radius >= 6 px werden `.gl`, vollflaechige Buehnen werden `.gl-stage` (durchsichtig, damit die Szene scheint). In eigenen Projekten `.gl` direkt vergeben.
3. Vollstaendige Vorlage: `assets/glass-look.html` (Stat-Karten, Pillen, Leiste).
Die Originalkomponenten bleiben unveraendert; ohne Schalter sehen sie aus wie vorher.

## Glas-Rezept (CSS-Tokens in glass.css)
- Tint: `linear-gradient(145deg, weiss 10 %, weiss 3 %, weiss 10 %)`; Blur `--gl-blur` 22 px, Saettigung 1,6
- Licht-Variablen je Scheibe (setzt `glass-look.js`): `--gl-ux/--gl-uy` (Einheitsvektor zum Licht), `--gl-mx/--gl-my` (Licht lokal), `--gl-near` (0-1)
- Rand: Haarlinie `--gl-hair`, Lichtkante `inset (-u*1,2px) 0 0 weiss --gl-rim`, Halo `--gl-halo`, Gegenseite `--gl-shade`, Schlagschatten gegen das Licht verschoben
- Szene: drei Farbkreise (`--gl-a/b/c`) + kleine Mitte, Korn, `animation: 38 s ease-out` alternate, nur `transform`
- Hell: Tint 55 %, Schatten violett-grau; Text immer `--gl-fg`; Abstufungen nur ueber `.gl-dim` (gedaempft) und `.gl-up` (positiv), weil die Textfarbe auf Glas erzwungen ist
- Bei > 24 Flaechen Blur auf 12 px senken (Rechenzeit)

## Motion-Tokens
`--ease-out`, `--ease-in`, `--spring` (Overshoot leicht). Hover: Anhub `-5px` per Feder; Eintritt: 520 ms ease-out, 60 ms Stagger. Nichts linear, Reduced-Motion: keine Szenenfahrt, kein Anhub; `prefers-reduced-transparency`: kein Blur.

## Interaktion & Barrierefreiheit
- Knopf mit `aria-pressed`, Fokusring sichtbar; Glasflaechen bleiben echte Elemente (kein Pseudo-Text)
- Kontrast auf Glas immer gegen die hellste Szenenfarbe pruefen (hell: dunkler Text)

## 120-Hz-Technik
Blur ist teuer: wenige, grosse Flaechen statt vieler kleiner; keine animierten Flaechen mit Blur auf alten Geraeten. Szene = ein fixes Element mit `will-change: transform`.

## Kreativ remixen
1. Echtes Lichtbrechen: SVG-Verschiebungsfilter als `backdrop-filter: url()` (nur Chromium; Fallback = Blur) wie bei 21st.dev "Liquid Glass"
2. Szene aus Foto statt Farbkreisen (warmer Raum, wie im Reel)
3. Kanten mit Border Beam kombinieren
4. Wassertropfen-/Water-Button-Effekt als Glas-Variante

## Bekannte Abweichungen (ehrlich)
- Auto-Erkennung ist eine Heuristik: Texte-only-Komponenten bekommen nur die Szene; Flaechen mit transparentem Hintergrund bleiben ohne Glas (z. B. `dock.html`: 0 Scheiben erkannt)
- Canvas, die ihren Hintergrund selbst malen (z. B. `glyph-portal.html`), bleiben deckend grau; nur ein Umbau der Komponente (Canvas transparent) hilft
- Licht-Schleife: ein Takt, nur solange das Licht wandert; maximal 48 Scheiben werden verfolgt, ausserhalb des Bildschirms ruhen sie
- Gemessen wurde nur in einer Software-Umgebung ohne Grafikkarte (alle Varianten 33 ms/Bild, auch v1); eine Aussage zu 120 Hz auf echten Geraeten ist damit NICHT belegt. Der Gerätetest bleibt offen
- Zeiger-Licht gibt es nur mit Zeiger oder Beruehrung; ohne Eingabe (und bei Reduced Motion) steht es oben links
- Echtes Liquid-Glass-Lichtbrechen (Verzerrung) ist nicht nachgebaut, nur Blur-Glas
- Browser ohne `backdrop-filter` zeigen nur den Tint
