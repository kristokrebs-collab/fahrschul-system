# Draggable Widget Grid (draggable-widget-grid)

> Dunkles Dashboard-Raster (4 Spalten, 8 "live" tickende Mono-Widgets): Karte gedrueckt halten, sie hebt ab (Scale 1.06 + heller Schein) und folgt dem Zeiger; ueberfaehrt ihre Mitte einen anderen Slot, rutschen die uebrigen Karten federnd nach, beim Loslassen setzt sie sich in ihren neuen Slot.

Quelle: 21st.dev-Vorschau "Draggable Widget Grid" (Hinweistext "Press and hold a widget, then drag to rearrange the layout."), rekonstruiert aus einer Bildschirmaufnahme (Samsung Browser, Maus-Zeiger). Datei: `assets/draggable-widget-grid.html`.

## Wann einsetzen
- Anpassbare Dashboards / Admin-Panels / Analytics- und Observability-Boards (Widgets umsortieren) - dashboard, widget grid, bento layout
- Home-Screen-/Launchpad-Raster, Favoriten-Kacheln, Link-Boards, Kanban-artige Karten-Listen mit Spannweiten - reorder tiles
- Portfolio-/Bento-Seiten, bei denen Besucher spielen duerfen (Wow-Moment durch Federphysik) - playful bento
- "Edit mode" in SaaS-Apps (Lift + Glow signalisiert: diese Karte ist jetzt in der Hand)
- Jede Liste/Raster mit gemischten Groessen (1x1, 2x1), die nach dem Umsortieren nahtlos neu fliessen soll
- Live-Daten-Optik: Kennzahlen, die per Hartwechsel (ohne Animation) ticken, plus Status-Wechsel (gruen -> orange)

## Anatomie & Zeitleiste
Raster 1234x672: Seitenrand 20, Abstand 12.5, Karten 289x289 (Runs/Tool Calls/Token/Traces 2 Spalten breit = 591x289), Hinweiszeile darueber. Jede Karte = Wrapper (`.dwg__item`: Position, Scale) + Glow-Ebene (heller Schein) + Karte (`.dwg__card`, deckender Grund, 1px Rand, Radius 22).
Ablauf (Video, Sekunden; Zeiger stoppt auf der Karte, dann Drag 1 "Total Cost", Drag 2 "Runs Today"):

| Zeit | Phase | Verhalten |
|---|---|---|
| ~0.97 | Druecken | Zeiger steht still auf der Karte (Druckzeitpunkt nicht sichtbar, aus Stillstand abgeleitet) |
| 1.245 | Lift (Halten ~250 ms) | Scale 1 -> 1.06 (Feder, ~120 ms, 99% bei ~150 ms, kleiner Overshoot) + Schein blendet ein (tau ~70 ms); Karte war waehrend des Haltens schon 60px "weggezogen" und holt per Tiefpass auf |
| 1.25-2.86 | Ziehen | Kartenmitte = Zeiger + Greif-Offset (beim Druecken gemerkt), Nachlauf-Tiefpass tau ~40 ms (Nachlauf = 40 ms * Geschwindigkeit, ~45 px bei 1.2 px/ms) |
| 1.42 | Umsortieren A | Mitte der Karte wandert in den Slot von "System Status" -> der rutscht nach rechts in die Luecke (Total Cost rueckt auf Index 1) |
| 2.15 | Umsortieren B | Mitte im Slot "Eval Score" -> Total Cost springt auf Index 4: Errors wandert hoch/rechts, Eval nach links, System zurueck (je 50% nach ~125 ms, 95% ~275 ms, Overshoot ~0.7%) |
| 2.86 | Loslassen (Drop) | Karte setzt sich in den Slot: Feder wie beim Umsortieren (38% der Strecke in 83 ms, ~0.3 s bis ruhig), Scale -> 1, Schein aus; waehrend des Settlens bleibt sie ueber den Nachbarn (z-index) |
| 4.28 / 4.90 / 5.46 | Drag 2 | Lift "Runs Today" (2 Spalten breit, Scale gleich); die Mitte erreicht den Slot "Tool Calls" -> ein einziger Sprung auf Index 5; Drop |
| 2.02, 4.52, 7.02 | Live: Runs Today | +1 (1,322 -> 1,325), harter Zifferntausch ohne Animation |
| 3.04, 6.01 | Live: Tool Calls | +6 (1,054 -> 1,060 -> 1,066) + Balkenzeilen (426/278/204/146 -> 428/280/205/147 -> 431/282/206/147) |
| 7.01 | Vorfall | Errors 24 -> 25 (2.0% rate), tool-error 5 -> 6, Status "Degraded performance" in Orange, blaue Saeule 32 -> 34 px |
Dauerhaft: gruener Status-/Live-Punkt mit kaum sichtbarem Ping-Ring (~2.4 s).

## Motion-Tokens
| Token | Wert | Anmerkung |
|---|---|---|
| holdMs | 250 ms | Halten bis Lift; Maus darf dabei bis 120 px wandern, Touch/Stift nur 10 px (sonst Scrollen) |
| liftScale | 1.06 | gemessen 305.5 / 288.5 |
| followTau | 40 ms | Tiefpass 1. Ordnung `a = 1 - exp(-dt/tau)`; Feder (2000/80) passt gleich gut (RMS ~5 px) |
| springs.layout | stiffness 230, damping 27 | Umsortieren + Drop (zeta ~0.89); Fit ueber ~25 Frames, RMS ~5 px auf 300 px Weg |
| springs.scale | stiffness 900, damping 40 | Lift/Drop, ~120 ms |
| glowTau | 70 ms | Schein ein/aus |
| reorderDelay / hitInset / cooldown | 10 ms / 10 px / 90 ms | Hit-Test = Mitte der Karte liegt im Slot eines anderen (Versatz zum sichtbaren Start im Video 0-50 ms) |
Hit-Test-Regel (aus 3 Ereignissen abgeleitet): nicht der Zeiger, sondern die Kartenmitte entscheidet; beim Eintritt wird die Karte direkt auf den Index dieses Slots gesetzt (Array-Move, auch ueber mehrere Karten hinweg), die anderen fliessen in Zeilenreihenfolge nach (CSS-Grid-Auto-Flow ohne dense).

## Look-Tokens
Buehne und Karten `#1f1f1f` (flach), Rand 1px `#4e4e4e`, Radius 22, Innenabstand 21.5, Schein `0 20px 40px rgba(255,255,255,.075)` (**hell**, nur nach unten/seitlich sichtbar, oben ~0), Text `#f8f8f8`, gedaempft `#adacb5`, gruen `#4ee9b6` (Punkt `#29e4a5`), pink `#fa77b5` (Punkt `#fe6ba2`), orange `#fc8c1b` (Punkt `#e07b00`), Akzent-Blau `#001899`.
Schrift JetBrains Mono (Fallback: ui-monospace/DejaVu): Label 12px, Tracking .11em, GROSSBUCHSTABEN; Meta 13.3px/.045em; Wert 28px; Zeilen 13.3px; Hinweis 14.2px (System-Mono). Heatmap 5x32 Zellen (45 min), Zelle 12.6px quadratisch, Abstand 3, Radius 3, Stufen als Deckkraft von `rgb(89,160,221)`: .22/.40/.64/1, "jetzt" `#78c1fe`, Zukunft `#2c2c2c`. Balken 4px (Spur `#1b1b1b`, Fuellung `#161616`, Spitze Blau); 30 Status-Segmente (2 gelbbraun `#a0680e`); 14 Saeulen (Pillen, `#191919`, letzte Blau).

## Interaktion & Barrierefreiheit
- Im Video: Maus (Pfeil) mit Druecken+Halten+Ziehen. Umsetzung mit Pointer Events (Maus/Touch/Stift), Pointer-Capture, `pointermove` nur merken und im rAF anwenden. Touch: `touch-action: pan-y` bis zum Lift, danach nicht-passiver `touchmove`-Blocker (kein Scrollen), `navigator.vibrate(8)`; Fenster-Autoscroll am Rand.
- Tastatur: Widget fokussierbar; Leertaste/Enter greift, Pfeile (Home/End) verschieben, Leertaste legt ab, Esc bricht ab; Ansagen ueber `aria-live`; Rolle `listitem` + `aria-roledescription`.
- `prefers-reduced-motion`: kein Federn/Scale (Karten springen in den Slot), Schein statisch, kein Ping-Ring.
- Responsiv (Erweiterung): <900 px 2 Spalten, <520 px 1 Spalte; Karten bleiben quadratisch.

## 120 Hz
Alles zeitbasiert: ein rAF-Loop mit `dt = min(t - last, 50)`, Federn **analytisch exakt** (unter-/kritisch-/ueberdaempft, keine Substeps noetig), Tiefpass/Glow als `1 - exp(-dt/tau)`. Nur `transform: translate3d()+scale()` und `opacity` (Schein als eigene Ebene, nicht `box-shadow` animiert); `will-change` nur waehrend der Bewegung, `contain: layout paint` je Karte; Layout nur bei Resize/Umsortieren berechnet (Groessen als CSS-Variablen), keine Layout-Lesezugriffe pro Frame (Gitter-Ursprung bei pointerdown gecacht). Loop laeuft nur, solange etwas in Bewegung ist; Halte-Timer und Daten-Ticks sind einmalige `setTimeout`, kein Animationstakt.
check120: `VERDIKT 120Hz: statisch=ok laufzeit(4x CPU)=ok fehler=keine`. Normal p95 0.9 ms (0% ueber Budget), bei 4x Drosselung p95 3.4 ms, p99 5.2 ms, Skript 0.16 ms/Frame, 0 Layouts/Frame. Keine WARN, 1 INFO (Layout-Reads nur bei pointerdown/Resize).

## Einbindung (assets/draggable-widget-grid.html)
- Markup: `<div class="dwg__grid" id="dwg" role="list"><article data-id="a" data-span="2" data-label="Name">...</article>...</div>`; Kind-Elemente = Widgets (frei befuellbar, `.w*`-Klassen sind nur das Demo-Styling). `data-span` (Spalten), `data-rows`.
- `initDraggableWidgetGrid(root, opts) -> { getOrder(), setOrder(ids), relayout(), destroy() }`; opts: `holdMs, holdTolerance{mouse,touch,pen}, liftScale, followTau, springs{layout,scale}, glowTau, reorderDelay, hitInset, reorderCooldown, columns[[minW,cols]], gap, aspect, autoscroll, keyboard, texts, order, onReorder(ids), onDragStart(id), onDragEnd(id)`.
- CSS-Variablen im `:root`-CONFIG: `--dwg-stage/-card-bg/-border/-radius/-pad/-gap/-glow/-glow-max`, Palette `--w-*`.
- Kopieren: Block `/* COMPONENT CSS */`, `/* COMPONENT JS */`, Markup zwischen `COMPONENT:START/END`; Demo-Daten (`DEMO`) und `WIDGET CONTENT CSS` nach Bedarf.

## Vermuteter Original-Stack -> React/Framer-Motion-Mapping
Vermutlich React + Tailwind + framer-motion: `motion.div layout` (Spring fuer das Nachrutschen), Long-Press per Timer, `drag` erst nach dem Lift, Umsortieren per `onDrag`-Hit-Test + `arrayMove`.
```tsx
<motion.div layout transition={{ type: 'spring', stiffness: 230, damping: 27 }}
  animate={{ scale: lifted ? 1.06 : 1 }} whileDrag={{ zIndex: 30 }}
  style={{ boxShadow: lifted ? '0 20px 40px rgba(255,255,255,.075)' : 'none' }}
  drag={lifted} dragMomentum={false} dragElastic={0} dragSnapToOrigin
  onPointerDown={() => (t = setTimeout(() => setLifted(true), 250))} onPointerUp={() => { clearTimeout(t); setLifted(false); }}
  onDrag={(_, i) => { const j = slotUnder(centerOf(i)); if (j >= 0 && j !== idx) setItems(arrayMove(items, idx, j)); }} />
```

## Kreativ remixen
1. **Jiggle-Edit-Mode**: Langdruck schaltet ALLE Karten in iOS-Wackeln (+-1.2 deg, versetzte Phasen, nur `rotate`), gehobene Karte `liftScale: 1.12` + farbiger Schein (`--dwg-glow: 0 24px 60px rgba(0,255,170,.25)`).
2. **Wellen-Reflow**: `layout`-Feder weich (stiffness 120, damping 12) und je Karte `delay = Abstand zum Slot * 25 ms` - die Umsortierung rollt als Kaskade durchs Raster, mit Overshoot-Pendeln.
3. **Neigung in Bewegungsrichtung**: gehobene Karte kippt per `perspective` + `rotateX/rotateY = clamp(v * 0.02)` und federt beim Drop zurueck; dazu Haptik (`vibrate`) bei jedem Umsortieren.
4. **Live-Daten mit Herzschlag**: bei jedem Tick kurzer Akzent-Ring-Puls an der Karte, Zahlen als Ziffern-Roller; ein Vorfall ("Degraded performance") springt die Karte automatisch an Position 1 und schuettelt sie einmal (Aufmerksamkeit).
5. **Andere Kontexte**: Spotify-artige Playlist-Kacheln, Bento-Portfolio (Besucher bauen ihr eigenes Layout, Reihenfolge in `localStorage`/URL), Trading-Watchlist (Kacheln mit Sparkline), Smart-Home-Szenen; `onReorder` -> Layout persistieren.

## Bekannte Abweichungen (ehrlich)
- JetBrains Mono wird nicht mitgeliefert (keine Webfonts): Glyphen (1, Komma, $), Pfeil (als SVG nachgebaut) und Zeilenmetrik weichen um bis zu 2 px ab; mit DejaVu Sans Mono sonst deckungsgleich (Gesamtbild RMSE ~7%, nur Text/Zeiger).
- Inhalte von "Token Usage" und "Recent Traces" sind im Video abgeschnitten: nur Kopfzeilen (`TOKEN USAGE`, `by model - 24h`, `RECENT TRACES`, `live`) sind echt, der Rest (2.41M, Modelle, Traces) ist erfunden.
- Druckzeitpunkt, Halte-Dauer (250 ms) und exakte Hit-Test-Regel sind nicht sichtbar, sondern aus Stillstand/Zeiger- und Kartenbahnen abgeleitet; Umsortier-Start im Nachbau streut +-30 ms gegen das Video (60-Hz-Messlauf).
- Der Original-Folgemechanismus (Tiefpass tau 40 ms vs. steife Feder) ist nicht unterscheidbar; Drop-Auslauf nur bis ~3.0 s messbar (danach Feder angenommen).
- Aufnahme zeigt Maus, kein Touch: Touch/Tastatur/Responsiv/Autoscroll sind Erweiterungen. Die duenne Scrollleiste der Vorschau ist nicht nachgebaut.
- Video-Pixel != CSS-Pixel (Schriften wirken ~2.5% groesser als 13/14/12 px): alle Masse sind in Video-Pixeln des 1234x672-Ausschnitts angegeben.
