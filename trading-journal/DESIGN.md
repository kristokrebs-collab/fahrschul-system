# Trade Journal – Design

Abgeleitet aus dem Bestand (PR #3: Übersicht, Trades, Grundlagen, Einstellungen; `src/styles/tokens.css`, `themes.css`,
`src/primitives`, `src/motion`). Keine neue Richtung – dieses Dokument hält fest, was die App schon ist, damit jede neue
Seite und jede Verfeinerung gleich aussieht. Regel des Owners: „alles in dem Stil lassen“ – nur verfeinern und ergänzen.

## Designthese

**Ein schwarzes Messinstrument im Nothing-Stil: Tinte, Haarlinien und Mono-Labels treten zurück, damit die eine Zahl
(Doto-Punktmatrix) und das eine Signal (Signalrot, Gewinn/Verlust-Ton) sofort lesbar sind – Bewegung meldet Zustände,
sie schmückt nicht.**

Warum: Ein Trader entscheidet unter Zeitdruck („trade the best, fuck the rest“). Der Bestand reduziert konsequent: eine
Grau-Rampe statt Farben, ein Akzent, Grün/Rot nur als Datenfarbe, pro Fläche genau eine große Zahl. Alles Animierte
hängt an Tokens und endet (endliche Loops) – das Produkt wirkt lebendig, aber eine ruhende Seite ist wirklich ruhig.

## Signature-Element

**Der Live-Box-zu-Box-Chart mit Punktmatrix-Glühen** (`views/markt/BoxChartCard.tsx` + `chart/NothingCandleChart`,
`BoxPrimitive`; Kleinform: die `A+`-Note als `GradeMatrix` mit roter Bloom).

- Er ist das Einzige, das alle drei Schichten des Produkts in einem Bild zeigt: den Live-Markt (Kerze formt sich,
  Preis-Puls), die Entscheidungslogik (Box, Ziele T1/T2, Stop, RSI-Bruch, nur A+/A zählt) und die Nothing-Ästhetik
  (monochrome Kerzen, gestrichelte vorläufige Kanten, ein grünes Glühen am RSI-Bruch, Punktmatrix-Note).
- Es ist das, was Konkurrenten nicht haben: Charts gibt es überall, Journale auch – ein Journal, das live sagt „das ist
  ein A+-Setup an dieser Box, Stop hier“, nicht.
- Einsatz: groß nur auf **Markt** (und als Ebene „Boxen“ im Übersichts-Chart); klein als `A+`-Matrix in Beste Setups,
  Scanner, Setup-Dialog, Preise-Teaser. Nie dekorativ kopieren, nie zwei große Instanzen auf einer Seite.

## Typografie (Rollen)

| Rolle | Schrift | Maß | Regel |
|---|---|---|---|
| Hero-Zahl | Doto 800 (`dot-num`), tabular | 34 – 96 px (`clamp`) | eine pro Hero/Karte; Einheit daneben in Plex Sans `text-lg font-medium text-mute` (Hero.tsx) |
| Punktmatrix-Glyphe | `DotMatrix` / `DotMatrixText` | 3 – 5 px Punkt | Noten (A+), kurze Zustände (OFFEN), Avatare, ∅ im Leerzustand – keine Wörter, die eine Überschrift wiederholen |
| Seitentitel `h1` | IBM Plex Sans 600 | `clamp(22px,7.2vw,28px)`, tracking-tight | roter Punkt (size-2, `spring.pop` + ein Ring), Wörter steigen gestaffelt |
| Lead | Plex Sans | 13,5 px, `text-mute`, max 62ch | `LeadFill`: einmal pro Sitzung Pixel-Glut, danach Marker auf dem Schlüsselbegriff |
| Abschnitt / Karten-Label | IBM Plex Mono 500 (`.label`) | 10,5 px, 0.14em, Versalien | roter 6-px-Punkt; Abschnitt = `!text-fg`, Karte = `text-mute`; Notiz darunter 12 – 13 px |
| Fließtext | Plex Sans | 14 px / 1.5 (sekundär 12,5 – 13 px) | `mute` sekundär, `faint` Meta |
| Zahlen in Tabellen/Kacheln | Plex Mono `num` | 12 – 14 px | tabular, Vorzeichen immer, Ton = Datenfarbe |
| Kleinste Schrift | Plex Mono | 9,5 px | nichts darunter |

## Farbrollen

| Rolle | Dunkel (Standard) | Hell (`data-theme="light"`) |
|---|---|---|
| Grund | `ink-900` #0a0a0a + Punktraster 22 px + Rauschen | `ink-900` #ebebe9 (Papier), Raster `#0000000f` |
| Mulde (Kacheln in Karten, Inputs) | `ink-950` #040404 | #f2f2f0 – eine Stufe unter der Karte |
| Karte | `ink-850` #111 | #fdfdfc – hellste Ebene |
| Erhöht (Popover, Segment-Daumen) | `ink-800` / `ink-750` | #f6f6f5 / #efefed |
| Linie / Linie 2 | #1f1f1f / #2c2c2c | #dfdfdc / #cfcfcb |
| Text fg / mute / faint | #f2f2f2 / #9b9b9b / #5f5f5f | #121212 / #565656 / #6b6b6b |
| **Signal (der eine Akzent)** | #e5202e | #e5202e (Kobalt/Violett ersetzen nur ihn) |
| Gewinn / Verlust / Warnung | #3ddc84 / #ff4d4f / #ffb020 | #0a783b / #cc1e29 / #9a5b00 (≥ 4,5 : 1) |
| Vorläufig (bildende Kerze, unbestätigt) | win-soft #65b488 / loss-soft #d27a7b | #4f9a70 / #c25e61 |
| Primär-Button | Weiß-Verlauf auf Tinte | Tinte auf Papier |

- Signalrot = Label-Punkte, Live-Marker, FAB, A+-Bloom, Lead-Glut. **Nie** für Verlust (dafür `loss`), nie für Fehler-Text
  (dafür `--color-danger-text`).
- Schleier `bg-white/[α]` bedeuten „Tinte“: im Hellen tauscht `themes.css` Weiß/Schwarz – keine Literale.
- Dunkle Inseln im Hellen: Übersichts-Hero, Intro, Vollbild-Navigation (`[data-theme-scope="dark"]`).

## Raster / Abstände

- Container `max-w-[1320px]`, Rand 16 px (`px-4`), ab sm 24 px. Seitenraster `grid gap-5 lg:grid-cols-12`.
- Karte: `p-5`, Radius 16 (`rounded-2xl`), Kopf = Label + Notiz, `mb-4`. Kacheln/Inputs Radius 12, Segment-Daumen 8,
  Hero/Dialog/Sheet 28, Pillen voll rund.
- Reihen-Regel (Design-Pass v3, Übersicht): Karten einer Reihe enden auf einer Linie; freie Höhe nehmen Charts und
  Leerzustände, Fußzeilen sitzen unten – nie ein leerer Kartenboden.
- Mobil: eine Spalte in Seitenreihenfolge, Dock unten (`--safe-bottom`), Sheets statt Dialoge, Tippflächen ≥ 44 px.

## Motion-Map

Alles nur `transform` / `opacity` / `filter` / `clip-path`, alle Werte aus `src/motion/tokens.ts`, 120 Hz (MotionValues,
null React-Renders pro Tick), Loops endlich. Details: `src/motion/README.md`.

| Ebene | Wofür | Muster und Timing |
|---|---|---|
| Primär | Zustandswechsel, die der Nutzer auslöst oder sehen muss | Karte → Dialog-Morph (`spring.morph` 340/34), Sheet (`spring.sheet`), Seitenwechsel (`spring.pageEnter` + `tween.page` 0,35 s), Werte rollen/zählen (`spring.number`, `RollingDigits`), Toast-Insel (`spring.toast`), Live-Preis-Puls (nur solange Trades kommen), Ausbruch = eine `BorderBeam`-Runde (`tween.burst` 1,2 s) |
| Sekundär | erster Blick, einmalig | Blur-Fade-Reveal (`tween.reveal` 0,45 s, Staffel `stagger.reveal` 0,04), Linien-Draw (`tween.draw` 1,1 s), Lead-Glut 1× pro Sitzung, `NumberCascade` nur für Ergebnisse, `CardSpread` beim Austeilen, Ring-Gauges (`tween.gauge`) |
| Atmosphärisch | Raum, nie Information | Hero-Punktfeld (12 fps, schläft nach 4 s), Karten-Spotlight/Näherungsbogen (≤ 4 Karten), Seitenfilm (statisch), Footer-Laufband |

- Reduced Motion: `useReducedFx()` → Endzustand sofort; CSS-Loops laufen eine 0-ms-Iteration; kein Blur.
- Samsung/`data-safe-fx`: kein Blur, kein Backdrop-Filter, keine Masken auf fixen Ebenen.
- Ausnahmen nur deklariert (`// motion-exception: …`, z. B. `radar-sweep` nur solange ein Scan läuft).

## Do / Don't

**Do**
- Neue Seite = `PageHeader` (Punkt, Wort-Staffel, `LeadFill`) + `Card`/`Label` + 12er-Raster + `gap-5`.
- Eine Hero-Zahl in Doto pro Seite/Karte, Einheit in Plex Sans gedämpft daneben.
- Einfachauswahl über `Segmented` (Tinten-Daumen); Weiß/Tinte-Fläche nur für die eine Primäraktion.
- Lade-, Leer-, Aus- und Fehlerzustand ehrlich benennen („Lade Kerzen …“, „bisher 11 von 20 Trades“).
- Platz für spät ankommende Inhalte reservieren (kein Layout-Sprung).

**Don't**
- Keine zweite Akzentfarbe, kein Signalrot als Verlust oder Fehler, keine Farb-Literale (Tokens/Schleier).
- Keine Punktmatrix-Wörter, die den `h1` wiederholen; keine zweite große Chart-Instanz pro Seite.
- Keine Endlos-Loops im Ruhezustand, keine Layout-Animation außer `layout`/`layoutId`, keine lokalen Timing-Werte.
- Keine Schrift unter 9,5 px, keine abgeschnittenen Kennzahlen.

## Visuelle Verfeinerung

### Durchgang 1

Stand `cbfa61e`, Produktions-Builds (`npm run build` → :4301 lokal, `npm run build:e2e-cloud` → :4302 Cloud, Premium,
angemeldet), Seed + Netz-Mocks aus `tests/e2e` (echte BTCUSDT-4h/1D-Kerzen der Box-Fixture). Alle 15 Seiten bei
1440 × 900 und 390 × 844, dunkel und hell, ganzseitig; Trade-Detail, Editor, Setup-Dialog; Bildfolgen (Seitenwechsel,
Detail-Morph, Markt- und Übersichts-Einstieg). Ergebnis: Die elf neuen Seiten sprechen dieselbe Sprache wie
Übersicht/Trades (PageHeader, Karten, Labels, Doto, Raster, Hell-Modus sauber, kein horizontaler Scroll, keine
Konsolenfehler). Die Abweichungen sind Details – hier nach Wert sortiert.

Screenshots: `/tmp/claude-0/-home-user-fahrschul-system/ea6eba86-cdfb-5e41-8d55-3f601fe46a74/scratchpad/shots/refine/pass1/`
(Dateien `<seite>-<1440|390>-<dark|light>.png`, Kacheln unter `tiles/`, Bildfolgen unter `frames/`). Skript:
`…/scratchpad/refine/shots.spec.ts` (`SET=pages|sheets|details|frames`).

| # | Seite | Schwere | Befund | Fix | Screenshot |
|---|---|---|---|---|---|
| 1 | Markt | hoch | Box-Status sagt beim Laden „Noch keine saubere Box.“ (falsche Aussage), während Beste Setups „Lade Kerzen …“ zeigt. | `BoxStateCard.tsx:121`: bei `view.state === "loading" \|\| "idle"` denselben Lader wie `BestSetupsCard.tsx:289-292` (`DotMatrix preset="loader"` + `view.detail ?? S.loading`) und Pille „Lädt“. | `frames/markt-1440-2.png`, `crops/markt-loading.png` |
| 2 | Markt | hoch | Das Alarm-Laufband erscheint erst nach dem Laden und schiebt Setups und Chart ~46 px nach unten (Layout-Sprung). | `MarktView.tsx:64`: `AlertBand` nicht `null` zurückgeben, solange `view.state` lädt – Band-Hülle mit fester Höhe (`min-h-[38px]`) und einem gedämpften Eintrag „Lade Kerzen …“. | `frames/markt-1440-3.png` → `-4.png` |
| 3 | Konto ↔ Community | hoch | Derselbe Schalter widerspricht sich: Community „In der Rangliste erscheinen“ = an, Konto/Datenschutz „In Ranglisten erscheinen“ = aus (folgt dem Server erst nach einem Community-Besuch, `social/store.ts syncOptIn`). | `cloud/ui/PrivacyCard.tsx`: beim Mount (angemeldet) `loadMe()` des Social-Stores auslösen bzw. die Zeile `leaderboard` aus `useSocial(s => s.me?.optIn)` lesen; ein Wortlaut für beide (`cloud/ui/strings.ts:188` → „In der Rangliste erscheinen“). | `konto-1440-dark.png`, `community-1440-dark.png` |
| 4 | Header (Cloud) | mittel | Zwei Sync-Status nebeneinander: „Synchronisiert“ (Modus-Pille) und „Sync · live“ (Konto-Pille). | `app/Header.tsx` (~206): Modus-Pille nur rendern, solange die `AccountPill` nicht angemeldet ist; angemeldet trägt die Konto-Pille den Zustand. | `konto-1440-dark-fold.png` |
| 5 | Preise | mittel | Tarif heißt „Premium“ (Kartentitel, Vergleich, „Dein Tarif“), die Punktmatrix-Glyphe sagt „MAX“. | `billing/plans.ts:146` `glyph: "PREMIUM"` (7 Zeichen passen bei der Kartenbreite) – Glyphe = Name. | `crops/preise-glyphs.png`, `preise-1440-dark.png` |
| 6 | Labor, Berichte | mittel | Gewählte Chips sind volle `bg-fg`-Pillen (weiß/tinte) – gleich laut wie die Primäraktion („Backtest starten“, „PDF / Drucken“); PR #3 wählt mit `Segmented` (Tinten-Daumen). | `labor/ui.tsx:61-63` Daumen `bg-fg` → `border border-line-2 bg-ink-750`, Text aktiv `text-fg`; `berichte/BerichteView.tsx:136` gleich. | `tiles/d/labor-0.png`, `tiles/d/berichte-0.png` |
| 7 | Analyse, Risiko, Labor, Wachstum | mittel | `SectionTitle` stellt den Untertitel rechtsbündig in eine eigene Spalte (Desktop: losgelöst, bei Labor zweizeilig versetzt); der PR-#3-Abschnittskopf „Auswertung“ setzt den Lead darunter. | `analyse/ui.tsx:41`: Layout wie `InsightsSection.tsx:94-103` – `grid gap-1.5 pt-6`, Sub `text-[13px] text-mute max-w-[60ch]` unter dem Titel. | `tiles/d/analyse-0.png`, `tiles/d/labor-0.png` |
| 8 | Wachstum, Community, Berichte, Labor | mittel | Leere Kartenböden (150 – 300 px) neben höheren Nachbarn – verletzt die Reihen-Regel. | Letzten Block bodenverankern (`mt-auto`): Check-in-Hinweis, Community-Zeile „Jetzt neu berechnen“, Berichte „Stärkstes Setup“; Berichte-Kurve `flex-1 min-h-[120px]`. | `tiles/d/wachstum-0.png`, `tiles/d/community-0.png`, `tiles/d/berichte-0.png` |
| 9 | Coach | mittel | „Dein Profil“-Orbit: Schrift 7 – 8,7 px (`max(7px,1.05cqw)`), hintere Karten überdecken die Mittel-Zeile; Text „stark in Wochenende“. | `coach/ProfileCard.tsx:20-22` Mindestmaße 9,5 / 10 / 10 px; Mittel-Zeile (`:55`) `relative z-20`; `domain/coach/recommendations.ts:330` Präposition je Session („am Wochenende“, „in London“). | `detail-coach-profile-1440-dark.png`, `coach-390-dark.json` |
| 10 | Coach | mittel | Punktmatrix-Wortmarke „COACH“ wiederholt den `h1` direkt darüber; die eigentliche Zahl (Score 68) ist klein. | `coach/HeroCard.tsx:144`: Wortmarke entfernen, den Trading-Score als Hero-Zahl dorthin (Doto, Größe wie Analyse-Sharpe); Lektion bleibt Headline. | `tiles/d/coach-0.png` |
| 11 | Analyse, Risiko, Coach | mittel | Leerzustände tippen „Bereit für den ersten Eintrag.“, obwohl kein Eintrag fehlt (Risk of Ruin: 11 von 20 Trades; MAE/MFE: Ausstiegszeit fehlt). | `line` an die ~32 `EmptyState`-Aufrufe ohne eigene Zeile: z. B. `RiskOfRuinCard.tsx:121` `` line={`${closed.length} / ${ROR_MIN_TRADES} Trades`} ``, sonst `line={false}`. | `detail-analyse-ror-1440-dark-vp.png` |
| 12 | Trade-Editor (390) | mittel | Fußleiste bricht in zwei Zeilen (Abbrechen allein, darunter Speichern & neu + Speichern) – ~150 px Fuß auf 844 px. | `overlays/TradeEditor.tsx:787`: unter sm `grid grid-cols-[auto_1fr_1fr] gap-2`, Abbrechen als `size="sm"` Ghost – eine 56-px-Zeile. | `sheet-editor-390-dark-1.png` |
| 13 | Community | mittel | 13 Ranglisten-Zeilen starten gleichzeitig `NumberCascade` – Sekundär-Bewegung überall, die Kaskade ist laut Motion-Map Ergebnissen vorbehalten. | `community/LeaderboardCard.tsx:43`: Kaskade nur für Podium (3) und eigene Zeile, übrige Zeilen statisch/`TextRoll` mit der Zeilen-Reveal. | `tiles/m/community-1.png` |
| 14 | Berichte | niedrig | „+294 USDT“: Einheit in Doto in Zahlgröße; im Hero steht sie gedämpft in Plex Sans. | `berichte/ReportHero.tsx:100`: `suffix` entfernen, danach `<span className="font-sans text-lg font-medium text-mute"> {cur}</span>`. | `tiles/d/berichte-0.png` |
| 15 | Berichte | niedrig | Split-Flap „K W ▢ 1 7“: das Leerzeichen wird eine leere Kachel und liest sich wie eine fehlende Ziffer. | `ReportHero.tsx:92`: Leerzeichen nicht als Kachel – zwei Flap-Gruppen „KW“ / „17“ mit `gap-3`. | `tiles/d/berichte-0.png` |
| 16 | Analyse | niedrig | Lead-Marker (`TactileHighlight`) im grünen „Sharpe“-Chip: weißer/schwarzer Block im Chip wirkt wie ein Fehler. | `analyse/KennzahlenHero.tsx:149`: Marker im Chip entfernen; der Chip-Ton ist die Betonung. | `crops/analyse-chips.png` |
| 17 | Trades (390) | niedrig | KPI-Streifen: „+1.232,00 USDT“ bricht um, die Kacheln werden ungleich hoch, Win-Rate steht ~30 px tiefer als Nachbarn. | `trades/KpiStrip.tsx`: Einheit erst ab sm (`hidden sm:inline`), Kachel-Inhalt oben ausrichten (`flex flex-col justify-start`). | `crops/trades-tiles-390.png` |
| 18 | Analyse, Risiko (390) | niedrig | Abgeschnitten: „Brutto vor Kost…“ (Kosten-Kachel); Strategienamen in „Risiko je Strategie“ auf 116 px gekürzt. | `analyse/CostsCard.tsx:22` `gross: "Brutto"`; `risiko/RiskSpreadCard.tsx`: Zeile unter sm zweizeilig (Name über dem Balken, `grid-cols-1`). | `analyse-390-dark.json`, `risiko-390-dark.json`, `tiles/m/analyse-1.png` |
| 19 | Preise (hell) | niedrig | Hervorgehobene Pro-Spalte im Vergleich wird auf Papier rosa (Signal-Tönung) und liest sich wie Warnung. | Spalten-Tönung im Hellen `bg-fg/[0.04]` statt Signal-Anteil. | `tiles/dl/preise-0.png` |
| 20 | Alle Seitenköpfe | niedrig | Marker-Wörter teils Bedienverben statt Seitenversprechen („Klick“, „gedrückt“, „echter“). | `highlight`: `TradesView.tsx:31` „öffnet den Trade“, `cockpit/copy.ts:28` „Dashboard“, `labor/strings.ts:5` „echter Binance-Historie“. | `trades-1440-dark-fold.png`, `cockpit-1440-dark-fold.png` |
| 21 | Trade-Detail | niedrig | „Ähnliche Trades“ zeigt Chips „Trade 1 … Trade 5“ ohne Inhalt. | `coach/TradeCoachPanel.tsx` (~75): Chip-Text = Datum + R (`26.04. +1,47R`), Ton nach Ergebnis. | `sheet-detail-390-dark-2.png` |

Geprüft und ohne Befund: Seitenwechsel- und Detail-Morph-Bildfolgen (Token-Timings, kein Ruckeln), Setup-Dialog
dunkel/hell, Hell-Modus aller Seiten (Kontrast, Inseln), kein horizontaler Scroll bei 390, keine Konsolenfehler.
Hinweis: Die weiche Chart-Schrift in 390-Shots ist ein Emulationsartefakt (Chromium-Emulation meldet
`devicePixelContentBox` ohne DPR), kein App-Fehler.

### Durchgang 2
