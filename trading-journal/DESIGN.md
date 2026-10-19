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

#### Umsetzung Durchgang 1

Alle 21 Befunde bearbeitet, 20 umgesetzt, einer teilweise (#8 Labor). Nachher-Shots mit denselben Builds/Mocks/Seeds:
`…/scratchpad/shots/refine/pass1-after/` (alle 15 Seiten 1440/390 dunkel/hell, Sheets, Details, Markt-Bildfolge;
Kacheln unter `tiles/`, Ausschnitte unter `crops/`). Keine Konsolenfehler, kein horizontaler Scroll; Messung
„abgeschnittener Text“: Kosten-Kachel und Strategienamen nicht mehr gekürzt.

| # | Was geändert wurde (oder warum nicht) | Nachher |
|---|---|---|
| 1 | `BoxStateCard`: ohne Analyse und solange `view.state` lädt/idle → Punktmatrix-Lader + `view.detail` („Lade Kerzen …“) und Pille „Lädt“; aus/Fehler → Grund des Stores (Pillen „Aus“ / „Keine Kerzen“). Der Lader hält die Höhe des geladenen Körpers (41 + 16 + 144 px). „Noch keine saubere Box.“ nur noch nach dem Laden. | `crops/markt-1440-loading-vs-loaded.png`, `crops/markt-frames-1235.png` |
| 2 | `AlertBand` bleibt beim Laden (und ohne Box) als Hülle `min-h-[38px]` mit einer gedämpften Zeile stehen; Hülle und Laufband teilen die Klasse – Karten und Chart stehen in Lade- und Fertig-Bild auf derselben y. | `frames/markt-1440-2.png` → `-5.png` |
| 3 | `PrivacyCard` ruft angemeldet `followServerOptIn()` (Social-Store per dynamischem Import, ein GET der Rangliste, still übernommen; während der Antwort umgelegter Schalter gewinnt). Wortlaut beider Schalter „In der Rangliste erscheinen“. | `konto-1440-dark.png` (an, wie Community) |
| 4 | `Header`: Modus-Pille nur, solange die Konto-Pille nicht angemeldet ist (Ausnahme: Speicher nicht verfügbar). | `crops/header-konto-1440.png` |
| 5 | `plans.ts` Premium-Glyphe `PREMIUM` (passt in Karte und Konto-Kachel, auch bei 390). | `tiles/dl/preise-0.png`, `crops/konto-abo-1440.png` |
| 6 | Labor `ChipPick`: Daumen `border-line-2 bg-ink-750` (−1 px auf die Chip-Kante), aktiver Text `text-fg`; Berichte-Fokus gleich. Weiß bleibt der Primäraktion. | `tiles/d/labor-0.png`, `crops/chips-light.png` |
| 7 | `SectionTitle`: `grid gap-1.5 pt-6`, Sub 13 px `text-mute max-w-[60ch]` unter dem Titel (Analyse, Risiko, Labor, Wachstum). | `tiles/d/analyse-0.png`, `tiles/d/labor-0.png` |
| 8 | Wachstum Check-in: Review-Fuß `mt-auto`; Community: „Jetzt neu berechnen“-Zeile `mt-auto`; Berichte: Kurvenmulde `flex-1`, mind. 132 px, Zeichnung absolut darin (misst ihre Höhe per ResizeObserver, hält die Reihe nie offen) → „Stärkstes Setup“ sitzt unten. **Labor „Annahmen“ nicht geändert**: die Karte ist eine reine Liste ohne Fuß; nach einem Lauf füllen 8 – 9 Zeilen sie, vorher bleibt Raum. | `tiles/d/wachstum-0.png`, `tiles/d/community-0.png`, `tiles/d/berichte-0.png` |
| 9 | Orbit-Mindestmaße 9,5 / 10 / 10 px (Label-Laufweite 0.06em, Detail zweizeilig statt gekürzt), Mittel-Zeile auf Tinten-Grund `relative z-20`; Kopfzeile „stark am Wochenende“ / „in London“ / „in der Spät-Session“ (`sessionPhrase`). | `detail-coach-profile-1440-dark.png` |
| 10 | Coach-Hero: Wortmarke „COACH“ entfernt; Trading-Score ist die Hero-Zahl (`ScoreHero`: Doto `clamp(56px,13vw,96px)` wie Analyse-Sharpe, `/ 100` Plex Sans gedämpft, Urteil als Pille); rechts nur noch die vier Teile (`ScoreParts`). | `tiles/d/coach-0.png` |
| 11 | `EmptyState`: `progressLine(have, need)` („11 / 20 Trades“) und `EMPTY_LINE_CLOSED` („Wartet auf den ersten abgeschlossenen Trade.“). Schwellen: Risk of Ruin, Kennzahlen, Verteilung, Serien, MAE/MFE („… Trades gemessen“), Rolling; nur offene Trades: Heatmap, Benchmark, Edge-Score, Erkenntnisse, Drawdown, Zeit, Fehler; sonst `line={false}` (Breakdown, Win/Loss, Disziplin, Rückblick, Signal, R, Cockpit). Übersicht/Trades behalten die Standardzeile – dort fehlt wirklich der erste Eintrag. | `detail-analyse-ror-1440-dark.png` |
| 12 | Trade-Editor (neuer Trade, unter sm): `grid-cols-[auto_1fr_1fr] gap-2`, drei Knöpfe in `size="sm"`-Maßen, Fehlerzeile darüber über die ganze Breite; Bearbeiten behält die Flex-Zeile (passt). | `sheet-editor-390-dark-1.png` |
| 13 | Rangliste: `NumberCascade` nur Podium + eigene Zeile, übrige Zeilen zeigen den fertigen Wert mit der Zeilen-Reveal. | `tiles/d/community-0.png` (Plätze 11 – 13 ruhig) |
| 14 | Berichte-Netto: Einheit `font-sans text-lg font-medium text-mute` neben der Doto-Zahl. | `tiles/d/berichte-0.png` |
| 15 | Split-Flap je Wort („KW“ · „17“, `gap-3`), keine Leerkachel. | `tiles/d/berichte-0.png` |
| 16 | Kein Marker im „Sharpe“-Stärken-Chip. | `tiles/d/analyse-0.png` |
| 17 | KPI-Streifen: Einheit `max-sm:sr-only` (Screenreader liest sie weiter), Kachel `flex flex-col justify-start`. | `crops/trades-390-mid.png` |
| 18 | Kosten-Kachel „Brutto“ (Notiz sagt „vor Gebühren und Funding“); Risiko je Strategie unter sm Name über den Zahlen (`grid-cols-1`). | `tiles/d/analyse-0.png`, `crops/risiko-390-spread.png` |
| 19 | Vergleichstabelle: empfohlene Spalte im Hellen `bg-fg/[0.04]` (`[:root[data-theme=light]_&]`), dunkel unverändert Signal-Hauch. | `tiles/dl/preise-0.png` |
| 20 | Marker: „öffnet den Trade“, „Dashboard“, „echter Binance-Historie“. | `crops/trades-390-top.png`, `tiles/d/labor-0.png` |
| 21 | „Ähnliche Trades“: Chip = Tag + R (ohne Stop: P&L), Ton nach Ergebnis, `aria-label` „Trade vom … öffnen“. | `sheet-detail-390-dark-2.png` |

Neu gesehen, für Durchgang 2 (nicht in diesem Durchgang geändert):
- Markt „Beste Setups“ bei 1440 mit zwei Setups nebeneinander: Einstieg/Stop/Ziel-Kacheln kürzen auf 48 px
  („82.77…“) – verstößt gegen „keine abgeschnittenen Kennzahlen“ (z. B. 2 × 2 statt 4 × 1 bei schmaler Karte).
- Konto: „Datenschutz“ neben „Sicherheit“ und „Rechnungen“ neben „Abo“ mit leerem Kartenboden (Reihen-Regel).
- Preise hell: empfohlene (Pro) und eigene Spalte (Premium) haben jetzt denselben Tinten-Ton.
- Markt beim Laden: „Lade Kerzen …“ steht viermal (Kopf-Pille, Band, Beste Setups, Box-Status) – ehrlich, aber laut.

### Durchgang 2

Stand `6e284ab` (alle Pass-1-Commits), Produktions-Builds in den Scratchpad (`vite build` → :4306 lokal,
`build:e2e-cloud`-Variante → :4307 Cloud, Premium, angemeldet), dieselben Seeds + Netz-Mocks aus `tests/e2e`. Alle 15
Seiten bei 1440 × 900 und 390 × 844, dunkel und hell (ganzseitig + Falz); Trade-Detail, Editor, Setup-Dialog; dazu
das Signature-Element bei DPR 2 (14 Bilder Einstieg + Ruhebild, dunkel/hell, beide Breiten) und die Markt-Ladefolge.
Keine Konsolenfehler, kein horizontaler Scroll.

Screenshots: `/tmp/claude-0/-home-user-fahrschul-system/ea6eba86-cdfb-5e41-8d55-3f601fe46a74/scratchpad/shots/refine/pass2/`
(`<seite>-<1440|390>-<dark|light>.png`, Kacheln `tiles/` und `dp/` (1440 paarweise), `cols/` (390 in Spalten),
Signature `sig/`, Ausschnitte `crops/`). Skripte: `…/scratchpad/refine/shots.spec.ts` mit
`SHOT_DIR=…/pass2 PW_BASE_URL=:4306 CLOUD_URL=:4307`, Signature/Ladefolge `…/scratchpad/refine/p2/p2.spec.ts`.

**Pass-1-Fixes geprüft:** #1 – #8, #10 – #18, #20, #21 sitzen in beiden Themes und Breiten (Lader und Band-Hülle halten
die y-Lage der Karten in der Ladefolge, Schalter Konto = Community, ein Sync-Status, `PREMIUM`, Tinten-Daumen in Labor
und Berichte, Abschnittsköpfe, bodenverankerte Fußzeilen, Coach-Score als Hero, „11 / 20 Trades“, Editor-Fuß in einer
Zeile, Ranglisten-Kaskade nur Podium + eigene Zeile, „+294 USDT“, „KW · 17“, Chips ohne Marker, KPI-Streifen 390,
„Brutto“, Marker-Wörter, Ähnliche-Trades-Chips). Keine Regression auf anderen Seiten gefunden. Nur teilweise: #9 (bei
1440 gut, bei 390 kürzt der Orbit weiter – #7 unten) und #19 (rosa Ton weg, dafür sind Pro und Premium im Hellen jetzt
gleich – #10 unten).

| # | Seite | Schwere | Befund | Fix | Screenshot |
|---|---|---|---|---|---|
| 1 | Markt (1440) | hoch | Beste Setups mit zwei Karten nebeneinander: Einstieg/Stop/Ziel kürzen auf „82.77…“, „82.26…“, „79.21…“ (Kachel 48 px) – die drei Zahlen, für die die Karte da ist (aus Pass 1 „neu gesehen“). | `BestSetupsCard.tsx` `SetupTile`: MorphCard bekommt `@container`, das `dl` `grid-cols-2 @md:grid-cols-4` statt `sm:grid-cols-4` (Kachelbreite statt Fensterbreite → 2 × 2 bei ~320 px Karte, 4 × 1 bei voller Breite). | `sig/best-1440-dark.png`, `markt-1440-dark.json` |
| 2 | Markt – Signature | hoch | Beschriftung im Box-Chart: „Bruch ↑“ steht auf Höhe des Punkts links daneben und wird von der weißen RSI-Linie und der grünen Trendlinie durchgestrichen; die Stop-Linie lugt rechts als einzelner Strich hinter dem Label hervor („82.264,96 -“ liest sich wie ein Minus); die Legende kennt nur „gebrochen“ in Grün, die nach unten gebrochene Box (16. – 19.09.) ist rot. | `RsiOverlay.ts:127-133`: Label über den Punkt (`y - r - 7 * vr`, zentriert) und vorher `strokeText` mit `ink.bg`, `lineWidth 3 * hr` (Freistellung); `BoxPrimitive`: Stop-Linie erst nach Plattenende + 4 px beginnen oder Label ans rechte Linienende wie T1/T2; `BoxChartCard.tsx` LEGEND: „gebrochen ↑“ (win) und „gebrochen ↓“ (loss) als zwei Glyphen. | `crops/sig-rsi-break.png`, `crops/sig-stop-label.png`, `sig/chart-1440-dark-settled.png` |
| 3 | Coach (1440) | hoch | Verbesserungsplan (5 Spalten, ~330 px Inhalt) steht neben der Timeline mit allen 12 Einträgen (~1 100 px) – ~750 px leerer Kartenboden, der größte Reihen-Regel-Bruch der App. | `TimelineCard.tsx:20` `PAGE = 6` (der vorhandene „Mehr“-Knopf lädt nach, wie „Alle anzeigen (11)“ im Berichte-Archiv); im Plan „Plan übernehmen“ `mt-auto`. | `tiles/d/coach-1.png` |
| 4 | Markt – Signature, hell + dunkel | mittel | Achsenbeschriftung gemessen (DPR 2, Kantenglättung frisst ~25 % des Tons): dunkel Preisachse 2,0 : 1, Zeitachse 2,3 : 1, Legende 3,0 : 1; hell 3,0 / 3,5 : 1. Preise an der Achse sind Arbeitsinformation, nicht Atmosphäre. Im Hellen wird das grüne Bruch-Glühen (shadowBlur + DOM-Halo) zum matschigen Fleck auf Papier. | `chart/ink.ts` `tick: "#5f5f5f"` → `#808080`, `themes.css:156` `--chart-ink-tick: #6b6b6b` → `#555555` (Ziel gemessen ≥ 3 : 1, Legende `text-faint` → `text-mute`); hell: `RsiOverlay` `shadowBlur` nur im Dunklen, `GlowBreak` Halo-Deckkraft im Hellen halbieren (Ring statt Wolke). | `sig/chart-1440-light-settled.png`, `crops/sig-rsi-break-light.png` |
| 5 | Markt, Community, Risiko, Wachstum | mittel | Einheiten in Doto: das Doto-„%“ ist ein Schachbrett-X („88⊠“, „81⊠“, „72⊠“, „0⊠“, „30,4 ⊠“), „R“ und „×“ ebenso – gegen die eigene Regel „Einheit daneben in Plex Sans gedämpft“ (Hero, Berichte #14). | Einheit als eigener `font-sans font-medium text-mute`-Span hinter der Doto-Zahl: `motion/fx/ConfidenceMeter.tsx:94`, `community/YouCard.tsx:26,108` (`suffix="%"` raus), `risiko/LimitsCard.tsx:68,121`, `risiko/LiquidationCard.tsx:99`, `risiko/ScenarioCard.tsx:118`, `wachstum/TrackersCard.tsx:60` (`×`), `wachstum/ProgressCard.tsx:32`. | `crops/community-doto-pct.png`, `crops/doto-pct.png`, `crops/risiko-1440-jetzt.png` |
| 6 | Wachstum, Konto, Community | mittel | Leerzustände in drei Dialekten: `EmptyState` (Strichrahmen + ∅-Glyphe: Ziele, Leaks & Edges, Risk of Ruin, Margin), nackte Zeile in einer sonst leeren Karte (Gewohnheiten, Emotionstagebuch, Stimmung & Ergebnis, Rechnungen) und Strichrahmen ohne Glyphe (Community „Deine Links“, Gruppen-Reviews). Die nackten Zeilen hinterlassen dazu 100 – 200 px leeren Boden. | Regel: ganze Karte leer → `EmptyState` (`h-full`, füllt die Reihe, `line={false}` wo nichts fehlt); leere Teil-Liste in einer Karte mit Inhalt → eine `text-mute`-Zeile ohne Rahmen. Umstellen: `wachstum/strings.ts:105,118,120` (Karten), `billing`-Rechnungen, `social/strings.ts:179,252` (Rahmen → `EmptyState`). Berichte Psychologie/Fehler bleiben Zeilen (Karte hat weitere Werte). | `dp/wachstum-dark-0.png`, `dp/wachstum-dark-1.png`, `dp/community-light-0.png` |
| 7 | Coach (1440 + 390) | mittel | „Long-lastig, stark am Wochenende“ steht dreimal auf der Seite: 12 px rechtsbündig mitten im Hero (losgelöst zwischen Score und „Teile“), als `h3` in „Dein Profil“ und noch einmal in der Orbit-Mitte. Bei 390 kürzt der Orbit seine Karten („EMOTION…“, „TEUERST…“, „BESTE S…“, „RISIKO …“) und wiederholt nur die Tabelle direkt darüber. | `HeroCard.tsx:101` `headline` im `ScoreHero` streichen (das Profil trägt sie); `ProfileCard`: Orbit-Mitte nur „Du.“, Satelliten unter sm `max-sm:hidden` (die Tabelle hat alle Werte) – der Orbit bleibt als ruhiges Bild. | `tiles/d/coach-0.png`, `detail-coach-profile-390-dark.png` |
| 8 | Konto | mittel | „Rechnungen erscheinen hier, sobald du ein Abo hast.“ direkt neben „Premium · Aktiv · über den Team-Tarif deiner Gruppe“ – Widerspruch. Dazu Datenschutz neben Sicherheit mit ~340 px leerem Boden, Rechnungen mit ~120 px (aus Pass 1 „neu gesehen“). | `billing/strings.ts:39`: eigene Zeile für Sitz-Tarife („Dein Tarif läuft über das Team deiner Gruppe – die Rechnungen bekommt der Inhaber.“), sonst `EmptyState` (#6); `PrivacyCard`: Fuß `mt-auto` mit Link „Daten exportieren oder löschen ↓“ (springt zu „Deine Daten“) – wie die Community-Fußzeile. | `dp/konto-dark-0.png`, `crops/konto-rechnungen.png` |
| 9 | Markt (Laden) | mittel | „Lade Kerzen …“ steht viermal gleichzeitig (Kopf-Pille, Band, Beste Setups, Box-Status) – ehrlich, aber laut (aus Pass 1 „neu gesehen“). | Ein Satz, eine Stelle: Kopf-Pille zeigt beim Laden `BTCUSDT` mit Lade-Punkt statt Text; Band-Hülle nur `DotMatrix preset="loader"` ohne Text; Box-Status nur die Pille „Lädt“ + Lader (ohne Zeile); der Satz bleibt in Beste Setups (der Inhalt, auf den man wartet). | `crops/markt-load-frames.png` (Bild 1) |
| 10 | Preise | mittel | Vergleichstabelle: im Hellen tragen empfohlene (Pro) und eigene Spalte (Premium) denselben Tinten-Ton – nicht zu unterscheiden. Bei 390 kleben „2 GB20 GB20 GB“ zusammen, der Kopf „Premium“ kürzt (55 > 44 px), Striche gemischt („—“ in Funktionen, „–“ in Limits), „∞“ halb so groß wie die Ziffern. | Eigene Spalte ohne Flächenton, nur Kopf-Pille „Dein Tarif“ + 2 px `border-t-fg`; Limits-Zeilen: Einheit ins Zeilenlabel („Screenshot-Speicher (GB)“), Zellen nur Zahlen; ein Strich „—“ `text-faint` überall; „∞“ in Plex Sans 15 px; Kopf unter sm `text-[11px] tracking-tight`. | `dp/preise-light-0.png`, `tiles/m/preise-4.png` |
| 11 | Setups, Übersicht, Analyse, Cockpit, Markt, Risiko, Labor, Preise | niedrig | 19 Stellen mit `text-[9px]` – unter der eigenen Untergrenze 9,5 px (z. B. Setup-Kennzahl-Labels „Erwartung“, „Profit-Faktor“, Lage „Kurs vs. EMA“, Heatmap-Stunden, „RSI“, „A+ SETUP“). | `text-[9px]` / `!text-[9px]` → `text-[9.5px]` in `setups/SetupCard.tsx:386`, `overview/LagePanel.tsx:209`, `overview/signalParts.tsx:614`, `analyse/HeatmapCard.tsx:34`, `ExcursionCard.tsx:41,79`, `RiskOfRuinCard.tsx:63,67`, `RollingCard.tsx:168,170`, `markt/RsiLinesCard.tsx:110`, `risiko/MarginCard.tsx:36`, `labor/RobustCards.tsx:286`, `preise/PricingHero.tsx:37`, `insights/DisciplineCard.tsx:123,240`, `journal/editor/ExecutionSection.tsx:407`, `journal/ui/FillsTimeline.tsx:56`, `onboarding/steps.tsx:100`; ein Lint-Grep auf `text-\[(8\|9)px\]` im Gate. | `setups-390-dark.json`, `overview-1440-dark.json` |
| 12 | Trades (390) | niedrig | Filter: das Ergebnis-Segment bricht „Offen“ in eine zweite Zeile innerhalb der Pille (Segment sieht kaputt aus); „Alle Grundlagen“ endet 68 px vor der Suchfeld-Kante darüber. | `TradeFilters.tsx`: Ergebnis-`Segmented` unter sm `flex-nowrap overflow-x-auto snap-x` (eine Zeile, wischbar, Fade am Rand) oder `grid grid-cols-5` mit gleich breiten Zellen; Grundlagen-Select `max-sm:w-full`. | `tiles/m/trades-0.png` |
| 13 | Trades, Community (390) | niedrig | Einsame Platzhalter-Punkte: „Check 7/7 ·“ (Signal-Badge ohne gespeicherten Check) und „#4 ·“ … „#13 ·“ (Rang unverändert) lesen sich wie verirrte Satzzeichen; die Rangspalten (2,4 + 1,6 rem) kosten bei 390 so viel Platz, dass „Geduldige Robbe …“ und „Du · Stiller Falke …“ kürzen. | `trades/tradeCells.tsx` `SignalBadge`: ohne Signal in Karten nichts rendern (Tabelle behält „–“ in eigener Spalte); `LeaderboardCard.tsx:29` Delta 0 → `null`, Zeile unter sm `grid-cols-[2rem_auto_minmax(0,1fr)_auto]`, Delta ≠ 0 als kleine Hochzahl am Rang. | `tiles/m/trades-0.png`, `tiles/m/community-1.png` |
| 14 | Berichte (1440) | niedrig | Spaltenfuge springt: Reihen 2 – 3 teilen 7 / 5 (Fuge bei x ≈ 820), Psychologie / Fehler 6 / 6 (x ≈ 712) – die Kanten laufen nicht durch; Strategie (eine Zeile pro Tabelle) neben Risiko (10 Zeilen) ~200 px leerer Boden. | `BerichteView.tsx:179,184` `lg:col-span-6` → `7` / `5`; Strategie: Fuß `mt-auto` mit „Stärkstes · Schwächstes Setup“ (dieselbe Zeile wie unter der Kurve) statt leerer Fläche. | `tiles/d/berichte-1.png` |
| 15 | Markt (390), Analyse (1440), Berichte (390) | niedrig | Abgeschnittene Kennzahlen/Namen: Scanner-Zeile „… · Einstieg 82.7…“ (219 > 200 px – der Einstieg ist die Zahl), Breakdown „4H-Neckline-Short unter 84.5…“ (190 > 162), Berichte „BSL/EQL Liquidity Sw…“ (135 > 108). | `ScannerCard.tsx` Row: „Einstieg 82.760“ als eigene `num`-Zeile rechts über CRV (Spalte `justify-items-end`), Text links nur Art · Phase; Breakdown- und Berichte-Setupnamen `line-clamp-2` statt `truncate`. | `markt-390-dark.json`, `analyse-1440-dark.json`, `berichte-390-dark.json` |

Geprüft und ohne Befund: Signature-Einstieg bei DPR 2 (Boxen zeichnen ein, Bruch-Ring atmet endlich und läuft ruhig aus,
keine Sprünge in 14 Bildern à 140 ms), Live-Box-Kanten und Ziel-Platten, `A+`-Bloom und Score-Matrix, Setup-Dialog,
Trade-Detail und Editor (beide Themes, beide Breiten), dunkle Inseln im Hellen, Seitenköpfe, Karten-Radien.
Aufnahme-Artefakte, keine App-Fehler: schwarze/weiße Rechtecke in ganzseitigen 390-Aufnahmen der Übersicht
(`captureBeyondViewport`), Datumsfelder im US-Format (Headless-Chromium ignoriert `locale` für native Eingaben),
Zwischenziffern der Ranglisten-Kaskade in Ganzseiten-Bildern (Zeitleiste pausiert außerhalb des Viewports, im Browser
läuft sie beim Hineinscrollen zu Ende).

#### Umsetzung Durchgang 2

Alle 15 Befunde umgesetzt, fünf in einer abgewandelten Form (#4, #8, #10, #12, #13 – Grund in der Zeile).
Nachher-Shots mit denselben Seeds/Mocks, Produktions-Builds auf :4308 (lokal) / :4309 (Cloud): betroffene Seiten,
Signature bei DPR 2 und Markt-Ladefolge unter `…/scratchpad/shots/refine/pass2-after/` (Kacheln `tiles/`, Ausschnitte
`crops/`, Signature `sig/`); der volle Satz (15 Seiten × 1440/390 × dunkel/hell, Trade-Detail, Editor, Setup-Dialog)
unter `…/scratchpad/shots/refine/final/`. Pfade in der Tabelle relativ zu `pass2-after/`, `final/…` zum finalen Satz.
Dabei gefunden und mit behoben: der DOM-Glow am RSI-Bruch saß 5 px über seinem Leinwand-Punkt (Zeile 2).

| # | Was geändert wurde (oder warum anders) | Nachher |
|---|---|---|
| 1 | `SetupTile`: MorphCard `@container`, Kennzahlen `grid-cols-2 @md:grid-cols-4` – die Kachelbreite entscheidet: zwei Karten nebeneinander (~330 px) 2 × 2, eine breite Karte 4 × 1. „82.777,2“, „82.264,96“, „79.217,35“ stehen ganz (Messung Markt 1440: 5 gekürzte Kennzahlen → 0). | `sig/best-1440-dark.png`, `tiles/d/markt-0.png` |
| 2 | `RsiOverlay`: „Bruch ↑“ mittig über dem Punkt (darunter, wenn oben kein Platz ist), in der Fläche gehalten, auf einer fast deckenden Platte in der Fensterfarbe wie die Box-Labels – die reine `strokeText`-Freistellung ließ die Linien zwischen den Buchstaben durch („Bruch–↑–“), daher Platte. `BoxPrimitive`: ein Label auf seiner Linie ist ihr Ende (der Strich stoppt 2 px vor der Platte, nichts lugt dahinter hervor; ein ausgewichenes Label lässt die Linie voll; Geometrie und Tests unverändert). Legende „gebrochen ↑“ (Gewinn-Ton) und „gebrochen ↓“ (Verlust-Ton). Mitbehoben: `NothingCandleChart` maß die Oberkante der RSI-Pane einmal beim Resize im DOM; nach dem späteren Neu-Layout der Panes war der Wert 5 px zu klein, Glow-Kern und Leinwand-Punkt lagen versetzt (zwei Punkte). Jetzt aus dem Modell (Pane-Höhen + 1 px Trenner, kein Layout-Read) bei jedem `place` – Kern und Punkt decken sich, die RSI-Legende folgt. | `crops/sig-rsi-break-dark.png`, `crops/sig-stop-label-dark.png`, `sig/chart-1440-dark-settled.png` |
| 3 | `TimelineCard` `PAGE = 6` („Ältere anzeigen (6)“ lädt je sechs nach); `PlanCard`: Inhalt `flex-1`, „Plan übernehmen“ als Kartenfuß `mt-auto` mit Haarlinie. Leerer Boden ~750 → ~300 px, und der Rest liegt über einem Fuß statt offen. | `tiles/d/coach-1.png` |
| 4 | Statt `tick` aufzuhellen (das Grau trägt auch Level-Linien, Pivots, Ziel-Linien) ein eigener Ink-Schlüssel `axis` nur für den Text der Preis-/Zeitachse: dunkel `#808080`, hell `#555555` (`chart/ink.ts`, `--chart-ink-axis` in `themes.css`, `syncChartInk`); Legende `text-mute`. Gemessen bei DPR 2 (Spitzenkontrast der Glyphen): dunkel Preisachse 2,2 → 3,2 : 1, Zeitachse 2,4 → 3,8 : 1; hell 3,3 → 4,0 und 3,9 → 5,0 : 1. Hell: kein `shadowBlur` an der Leinwand (`inkIsPaper()`), `GlowBreak`-Halo halb so stark (Hülle `opacity-50` unter `[data-theme=light]`, die WAAPI-Keyframes bleiben) – ein Ring statt einer Wolke. | `crops/sig-rsi-break-light.png`, `sig/chart-1440-light-settled.png` |
| 5 | Neu `primitives/DotUnit.tsx`: Einheit in Plex Sans medium `text-mute`, 0,62 em, nie unter 9,5 px. Eingesetzt in `ConfidenceMeter` („88 %“), `YouCard` (Kennzahlen + Perzentil, `suffix` raus), `LimitsCard` (Ringe `%`/`×`, Tageslimit), `LiquidationCard`, `ScenarioCard` (Zahl als MotionValue, „ %“ daneben; Text und `aria-valuetext` unverändert „−30,0 %“), `TrackersCard` (`×`), `ProgressCard`, dazu `MarginCard` (derselbe Fehler auf derselben Seite). | `sig/best-1440-dark.png`, `tiles/d/risiko-0.png` |
| 6 | Regel umgesetzt: ganze Karte leer → `EmptyState` (`flex-1`, füllt die Reihe; `line={false}`, wo nichts fehlt): Gewohnheiten, Emotionstagebuch, Stimmung & Ergebnis (mit `progressLine` „3 / 8 Tage“ statt eigenem Balken), Rechnungen (#8), Deine Links, Gruppen-Reviews; Titel und Text getrennt (`…Title` + Text), „Noch kein Ziel. Noch kein Ziel …“ entdoppelt. Leere Teil-Listen in Karten mit Inhalt bleiben eine `text-mute`-Zeile (Berichte, Sicherheitsprotokoll, Rechnungsliste eines Kunden). | `tiles/d/wachstum-1.png`, `tiles/d/wachstum-2.png`, `tiles/d/community-2.png` |
| 7 | `ScoreHero` ohne Headline (Prop entfernt); Orbit-Mitte nur „Du.“; unter sm ruht der Orbit ohne Karten (`max-sm:[&>ul]:hidden`, Bühne 2 : 1, „Du.“ 9 cqw) – die Tabelle darüber trägt alle Werte. Die Headline steht einmal: im Profil über der Tabelle. Messung Coach 390: 8 gekürzte Orbit-Texte → 0. | `tiles/d/coach-0.png`, `detail-coach-profile-390-dark.png`, `detail-coach-profile-1440-dark.png` |
| 8 | `BillingCard`: ohne Stripe-Kunden ein `EmptyState`; ein Sitz eines Team-Tarifs (Plan ≠ Free, kein eigenes Abo – dieselbe Regel wie „Über den Team-Tarif deiner Gruppe.“ in der Abo-Karte) sagt „Keine eigenen Rechnungen – Dein Tarif läuft über das Team deiner Gruppe – die Rechnungen bekommt der Inhaber.“, sonst „Noch keine Rechnungen – … sobald du ein Abo hast.“ (Test). `PrivacyCard`: Fuß `mt-auto` mit Haarlinie, „Deine Daten gehören dir.“ + Ghost-Knopf „Exportieren oder löschen ↓“ – scrollt zu „Deine Daten“ und setzt den Fokus dorthin (kein Link: Hash-Routing). Abweichung im Wortlaut: „Daten exportieren oder löschen“ enthielte den Namen des Export-Knopfs darunter (zwei Knöpfe „Daten exportieren“ für Screenreader und Tests). | `tiles/d/konto-0.png`, `tiles/d/konto-1.png` |
| 9 | Ein Satz, eine Stelle: Kopf-Pille beim Laden `BTCUSDT` mit Warn-Punkt (Satz als `title` und `sr-only`), Band-Hülle nur der Punktmatrix-Lader, Box-Status Pille „Lädt“ + Lader; „Lade Kerzen …“ steht sichtbar nur in Beste Setups, Screenreader hören ihn weiter an allen Stellen (Test erweitert). | `crops/markt-load-frames.png` (Bild 2) |
| 10 | Eigene Spalte ohne Flächenton; ihr Kopf trägt eine 2-px-Linie in `fg` und die Pille „Dein Tarif“ (unter sm „Du“ – 44 px Spalte); die empfohlene Spalte behält ihre Tönung. Limits: Einheit im Zeilenlabel („Screenshot-Speicher (GB)“), Zellen nur Zahlen (2 · 20 · 20); „nicht enthalten“ überall dieselbe Marke wie bei den Funktionen; „∞“ Plex Sans 15 px. Abweichung: Kopf unter sm 10,5 statt 11 px, ohne Innenabstand, Spalten 1 : 1,45 – mit 11 px kürzte „Premium“ weiter (44 > 40 px); jetzt 0 gekürzt. | `tiles/m/preise-3.png`, `tiles/m/preise-4.png` |
| 11 | 20 Stellen `text-[9px]` → `text-[9.5px]` (die 19 genannten + `app/LayerDiagnostics.tsx`). Lint im Gate: `eslint.config.js` `no-restricted-syntax` verbietet in `src` jede Tailwind-Schriftgröße unter 9,5 px in Klassen-Strings und Template-Literalen (`text-[9px]`, `!text-[8.5px]`, `text-[9.25px]` …) – läuft mit `npm run lint`. Messung der nachgeschossenen Seiten: keine Schrift unter 9,5 px. | `final/*.json` (`small`) |
| 12 | Abweichung: kein Scroll-Container (der Gleit-Gestus des `Segmented` braucht die horizontale Wischgeste) und kein festes 5er-Raster („Break-even“ bräche bei 62 px um) – unter sm eine Zeile über die volle Breite, die Optionen wachsen von ihrer eigenen Breite (`flex-auto`, `whitespace-nowrap`, `px-1`). Grundlagen-Select `max-sm:w-full`. | `crops/trades-390-filters.png`, `tiles/m/trades-0.png` |
| 13 | `SignalBadge hideEmpty` in den Karten (Tabelle behält den Platzhalter in ihrer Spalte; Test). Rangliste: unveränderter Rang → nichts; unter sm keine Bewegungsspalte (`grid-cols-[2rem_auto_minmax(0,1fr)_auto]`), die Bewegung steht klein (9,5 px) unter dem Rang statt als Hochzahl daneben – „#13“ und „▲12“ passen nicht nebeneinander in 2 rem. „Geduldige Robbe 18“ und „Du · Stiller Falke 27“ stehen ganz. | `tiles/m/community-1.png`, `tiles/m/trades-0.png` |
| 14 | Psychologie / Fehler 7 / 5 wie die Reihen darüber – die Fuge läuft durch; Strategie als Flex-Spalte, Fuß `mt-auto` mit Haarlinie: „Stärkstes Setup … · Schwächstes …“ und „Beste Session …“. | `tiles/d/berichte-1.png` |
| 15 | Scanner: „Einstieg 82.760“ als eigene Zahlzeile rechts über „CRV“, „Werte bei Kerzenschluss …“ als eigene Zeile unter Text und Zahlen über beide Spalten (in der Mittelspalte wäre sie jetzt gekürzt worden), „Range-Trade · In der Box“ darf zweizeilig werden (die breitere rechte Spalte nahm ihr 7 px); Breakdown- und Berichte-Setupnamen `line-clamp-2` + `overflow-wrap:anywhere`. Messung: Markt 390, Analyse 1440, Berichte 390 ohne gekürzte Texte. | `final/markt-390-dark.json`, `final/analyse-1440-dark.json` |

Finaler Satz (`…/shots/refine/final/`, 60 Seitenbilder + Falz, 12 Sheet-Läufe à 2 – 3 Bilder, Signature bei DPR 2):
keine Konsolenfehler, kein horizontaler Scroll, keine Schrift unter 9,5 px, keine gekürzte Kennzahl. Gekürzte Texte
gesamt (alle Seiten, beide Breiten, dunkel): Durchgang 2 → final Markt 7 → 0, Coach 9 → 1, Community 5 → 3, Analyse,
Berichte und Preise je 1 → 0 (Summe 24 → 4); die übrigen Seiten (Übersicht, Trades, Grundlagen, Labor, Cockpit,
Einstellungen) und die Sheets unverändert – keine Regression gefunden. Gate je Commit (typecheck, lint mit der neuen
Regel, vitest, build, build:share, budget, E2E der berührten Specs + Übersicht/Smoke/Theme/Motion/Markt mobil und
Desktop, CI-artiges Hinting für Übersicht und Signal-Teile) und einmal die volle E2E-Suite auf Standard- und
Cloud-Build: 504 Tests, 458 grün, 42 übersprungen (projektgebunden), 4 rot nur im Berliner Mitternachtsfenster (die
Seeds legen „heutige“ Verlust-Trades 8 – 65 min vor jetzt; um 00:10 fielen sie auf gestern) – dieselben vier auf
derselben Build nach 00:30 grün, mobil und Desktop.

Neu gesehen, für Durchgang 3 (nicht in diesem Durchgang geändert):
- Doto-Einheiten auf PR-#3-Flächen der Übersicht: Einstiegs-Check „53 % LONG“, Top-Trader „62,4 %“, Disziplin-Ring – bewusst
  nicht angefasst (Owner-Regel „alles in dem Stil lassen“, dort laufen die CI-Hinting-Specs); mit `DotUnit` ein Einzeiler je
  Stelle. Ebenso Währungen in Doto: Risiko „Unrealisiert −222 USDT“, Konto „Guthaben 10 €“.
- Community 390: Mitgliedszeile „+0,31R · 74 % Disz. · 34 Tr.“ und die Setup-Auswahl in „Deine Links“ („Früher
  Makro-Trendbruch“) kürzen; Coach 390: Timeline-Notizen einzeilig gekürzt.
- Coach: zwischen Plan-Schritten und Fuß bleiben ~300 px – der Plan könnte die Wochenwerte je Schritt zeigen.

### Nachtrag

Die offenen Punkte aus „Neu gesehen, für Durchgang 3“ (ohne den Coach-Plan) und die letzten Testabhängigkeiten von der
Uhrzeit. Shots (390 / 1440, dunkel / hell, Element-Ausschnitte): `…/scratchpad/shots/refine/pass3/`
(`<seite>-<stelle>-<390|1440>-<dark|light>.png`); Messung aller 15 Seiten vorher / nachher unter `pass3/probe-before/`,
`pass3/probe-after/` (Doto-Einheiten und gekürzte Texte je Seite und Breite).

| Was | Änderung | Nachher |
|---|---|---|
| Community 390: Mitgliedszeile | „+0,31R · 74 % Disz. · 34 Tr.“ bricht zwischen ihren Teilen um (jeder Teil `nowrap`, der Punkt beginnt die neue Zeile) statt gekürzt zu werden. E2E: keine gekürzte Zeile in `member-row`. | `community-members-390-dark.png` |
| „Früher Makro-Trendbruch“ (Deine Links, 390 + 1440) | `MorphSelect` ohne `max-w-[180px]`, neue Option `wrap` (ein langer Name bricht um, nie Ellipse); die offene Liste wird so breit wie der längste Name (`panelContentWidth`, Textbreite über `OffscreenCanvas`, kein Layout-Read) – vorher kürzten dort „4H-Neckline-Short unter 84.500“ und „Multi-TF Signal (MCB + RSI + Discount)“. E2E prüft Feld und offene Liste, Unit-Tests Breite und `wrap`. | `community-shares-*.png`, `community-select-open-*.png` |
| Community 1440: eigene Kennzahl | „+0,42R“ war 2 px gekürzt: die Kacheln bleiben ab `lg` bei 17 px (kein `xl:19px`). | `community-you-1440-dark.png` |
| Coach 390: Timeline-Notiz | Notiz bricht um (`overflow-wrap:anywhere`) statt einzeilig gekürzt. E2E: keine gekürzte Zeile in der Timeline. | `coach-timeline-390-dark.png` |
| Doto-Einheiten | Neu `DotFigure` (+ `splitUnit`): eine formatierte Zahl bleibt in Doto, ihre Einheit (`%`, `R`, `×`, `€`, `USDT` …) kommt in `DotUnit` – Textinhalt unverändert. Übersicht: Einstiegs-Check „53 % LONG“, Top-Trader „64,6 %“, Win-Rate-Ring (auch im Cockpit), Disziplin-Ring; Risiko „Unrealisiert −222 USDT“; Konto „Guthaben 10 €“. Per Grep und Seitenmessung dazu: Analyse (eigene Kennzahl, Exit-Effizienz, Risk of Ruin, Kennzahl-Dialog), Grundlagen (R im Trade-Bild), Bericht-bereit-Wipe, Befehlsnavigation, Toast-Werte, Onboarding-Konten. Messung: 0 Doto-Einheiten auf allen Seiten (vorher 8 Stellen auf Übersicht, Cockpit, Analyse, Risiko, Konto). | `overview-bias-*.png`, `overview-toptrader-*.png`, `overview-winrate-*.png`, `overview-discipline-*.png`, `risiko-exposure-*.png`, `konto-referral-*.png`, `analyse-custom-*.png`, `cockpit-winrate-*.png` |
| Tests und Uhrzeit | Risiko- und Wachstums-Seeds (E2E und Unit) laufen auf einer festen Mittagszeit (`middayToday` + `pinClock`, Unit `pinMidday`): vorher rot zwischen 00:00 und ~00:25 (Berlin bzw. UTC in CI) und – Wachstum – zwischen 23:00 und 24:00. Übersicht „FAB …“ speichert Trades mit Stop (sonst stand ein 5,2-s-Coach-Toast vor „Trade gespeichert“). Der CI-Fehler auf `95eb012` (Unit „Check-in …“) war ein Lastrennen: die Seite wird einen Scheduler-Takt nach dem Entfernen des Sheets freigegeben; der Test wartet jetzt darauf. | – |

Gemessen danach (alle 15 Seiten, 390 + 1440): keine Doto-gesetzte Einheit, keine gekürzten Texte außer den
Absichts-Überläufen (Kopien der Prisma-Linse in Netto- und Sharpe-Zahl – die Sharpe-Linse misst bei 1440 2 px mehr als
ihre Box, die Zahl steht sichtbar ganz –, Rollziffern-Streifen der Preise), keine Konsolenfehler.

Nachgezogen: Der „Bericht bereit“-Wipe kürzte seine Zahlen (`truncate`): „−1.235 USDT“ schon bei 390 (110 > 106 px),
„−123.457 USDT“ 134 > 106 / 201 > 179 px (390 / 1440, gehintet ±1 px). Jetzt ganz: Spalten `minmax(max-content,1fr)`,
gleiche Drittel, solange alles passt; E2E mit langen Werten, Berichte-E2E auf festem Mittwoch (sonntags kam kein Wipe).
Übersicht „FAB …“ mit angehaltener Seitenuhr erzwungen: 95eb012 rot wie in CI, HEAD grün; geprüft wird der zweite Toast.

### Anhang: Labor „Eigene Idee“ und „Warum so schwach?“ (F65 / F73)

- Auswahl: „Eigene Idee“ ist die erste und breiteste Kachel (volle Zeile), die drei Vorlagen folgen darunter. Der Baukasten sitzt in
  der Versuchsaufbau-Karte; bei „Eigene Idee“ bekommt sie 8 statt 7 Spalten.
- Gesperrte Optionen bleiben sichtbar (halbtransparent, `disabled`, `title` + sichtbarer Satz) und nennen ihren Grund – nichts wird
  stillschweigend ignoriert. Fehler (rot, `--color-danger-text`) sperren den Start, Hinweise (`text-warn`) nicht.
- Die Diagnose-Karte ist eine eigene Sektion unter dem Lauf: Befunde als nummerierte Liste (Gewicht als `Badge`: „Wichtig“ in
  `warn`, sonst `mute` – kein Signalrot), darunter einklappbare Details (Trichter, Vergleich, Kosten, Ausstiege, Richtung & Zeit,
  Daten). Texte sind Beobachtungen mit Zahlen („71 % der Stopp-Verluste kamen innerhalb von 3 Kerzen …“), nie bewiesene Ursachen.
- Bewegung: nur Einblenden (`tween.fade`, 6 px) neuer Zeilen und die vorhandene `Collapse`; `useReducedFx` → Endzustand. Tippflächen
  ≥ 44 px bei grobem Zeiger, alle Felder mit `aria-label`, keine zusätzliche Live-Region (Toast-Insel bleibt die einzige).

## Chart spiegeln / Bias prüfen (F62)

Ein Prüfwerkzeug, kein neues Gesicht: unter dem Markt-Box-Chart und im Trade-Replay sitzt dieselbe Leiste – der Schalter
„Chart spiegeln“ (`Switch`, Beschriftung + eine Zeile „Nur die Preisachse steht auf dem Kopf. Kurse, Zeiten und Signale bleiben
unverändert.“), darunter die Ebenen als Chips (`aria-pressed`, ≥ 44 px auf groben Zeigern: Ausbrüche · Trendlinien · Boxen ·
Eigene Trades · RSI) und die ausdrückliche Option „RSI als 100−RSI spiegeln“. Der geführte Test erscheint als eine ruhige
Fläche (`rounded-2xl border-line-2 bg-ink-950/40`, Überblendung `tween.fade`) mit drei Schritten; gesprochen wird nüchtern –
„Widerspruch“ statt „Bias“, nie eine Zahl, die eine Person bewertet. Blindmodus heißt: keine Farbe als Aussage – Long/Short
laufen in der Grau-Rampe, Stop und Ziel unterscheiden sich über die Strichform. Während des Tests zeigt die Markt-Seite nur
den Chart (Setups, Box-Status und Alarme würden die Richtung verraten). Keine Animation außer der Überblendung, keine neuen
Tokens, keine Schleifen.

## Täglicher Check-in (F61)

Kein neuer Dialog, sondern das bestehende Check-in-Sheet mit anderer Fußzeile: **Später** und **Heute überspringen** als Ghost-Buttons
links, **Erledigt** als die eine Primäraktion rechts (Tinte auf Weiß). Beim ersten Öffnen des Tages ein ruhiger Satz („Kurz einchecken,
freiwillig. Es bleibt auf deinem Gerät und in deinem Konto …“), darunter nur die eingeschalteten Felder – Regler mit Geisterdaumen
(„Ziehen zum Setzen“), nichts vorbelegt, nie ein „gut“ als Standard. „Nachgetragen“ ist eine kleine Warn-Pille (Mono, Versalien) mit einem
Satz, der sagt, was das für die Auswertung heißt. Das Anpassen (Felder, Zeitzone, Erinnerung, eigene Fragen) klappt unter dem Formular auf,
nicht in einem zweiten Dialog. Die Auswertungskarte „Check-in und Handelstag“ zeigt zuerst die Stichprobe („15 Tage mit 30 Trades“), dann
eine kleine Matrix aus ρ in Mono (unter 8 Tagen „–“), was nicht gezählt wurde, und immer „Keine Diagnose, keine Kausalität“ – kein
Gewinn-/Verlustton, keine Ampel. Bewegung: nur die vorhandenen Sheet-/Stagger-Tokens, keine neuen.

## Nachtrag: Screenshot-Import (F29 / F30)

„Aus Screenshot übernehmen“ ist ein Vorschlag, kein Automatismus: Der Knopf unter den Screenshots des **neuen** Trades (nur
mit Konto, Tarif und Server-Schlüssel – sonst fehlt er still, die Einstellungen → Daten → „Screenshot-Import“ erklären warum) öffnet
ein Sheet in drei Schritten: Bilder wählen (bis 4, Datenschutzhinweis direkt darunter) → Auslesen → **Vorschau**. Die Vorschau
zeigt jedes Feld mit seiner Sicherheit in Prozent; nur Unsicheres (amber Rahmen, „unsicher“) und Fehlendes (gestrichelt,
„fehlt“) bekommt ein Eingabefeld, Optionales ohne Wert bleibt ruhig („—“). Zusammengehörige Bilder erscheinen als **ein** Trade
mit den Quellbildern als Miniaturen, mögliche Dubletten tragen „Wahrscheinlich schon vorhanden“ und sind nicht vorgewählt.
Unter jedem Trade stehen die Prüfungen (Stop/Ziel auf der falschen Seite, Zahlenformat, Ergebnis laut Screenshot gegen
Ergebnis aus den Preisen – mit Angebot „Aus Preisen berechnen“, Richtung vertauscht …), die Zeitzone ist wählbar und die Annahme
steht im Klartext da. Regeln, die das Design trägt: nichts wird erfunden (unbekannt = leer), ein sichtbarer Stop einer laufenden
oder geschlossenen Position ist **nicht** der Original-Stop (Notiz, R bleibt leer – außer der Trader bestätigt ihn), geplante Orders
werden offene Trades mit geplantem Einstieg ohne Fills, und gespeichert wird erst im Editor mit „Speichern“ (mehrere Trades:
der erste öffnet sofort, die weiteren erscheinen nacheinander in der Pille „Noch n Entwürfe“). Das Sheet ist ein eigener
Lazy-Chunk (~18 KiB gzip), die Erstladung bleibt im Budget.

### Schlüsselmarken, Tagesplan, Alarme (F09 / F08 / F22) und „Warum handeln oder auslassen?“ (F10)

Keine neue Sprache, nur die vorhandene: auf der Markt-Seite drei Karten (`Card` + `Label`, Raster `lg:col-span-7/5/12`, kein
zweiter großer Chart, keine zweite Akzentfarbe). Status ist **Text + Glyphe + Ton**, nie Farbe allein: `○ Wartet` (mute),
`◐ Vorläufig` (warn, gestrichelt), `● Bestätigt` (Datenfarbe nach Richtung: über = Gewinn-Ton, unter = Verlust-Ton),
`✕ Ungültig` (mute), `? Keine Daten` (mute, gestrichelter Rand); „vorläufig“ (laufende Kerze) und „Schluss“ tragen immer eine eigene
Pille, im Verlauf getrennt protokolliert. Chart-Linien eigener Marken bleiben in der Grauleiter und lesen den Zustand an Strich
und Stärke (bestätigt durchgezogen 2 px, vorläufig gestrichelt, wartet gepunktet, ungültig/keine Daten weit gepunktet) – Signalrot bleibt
der harten Invalidierung. Nicht verfügbare Zeiteinheiten bleiben im Segment sichtbar, sind **deaktiviert und nennen den Grund**
darunter (nie still ersetzt). Der Tagesplan hebt das aktive Szenario durch Rahmen, `aria-current` und Wort („aktiv“) hervor,
„vorläufig“ und „überstimmt“ stehen als Wort; Bewegung nur bestehende Tokens (`tween.fade`, `tween.exit`, kein neues Timing).
Das Zustellprotokoll sagt ehrlich, was zurückgehalten wurde und warum, und die Karte sagt in einem Satz, dass Alarme nur bei geöffneter
App laufen – kein Server-Versprechen. „Warum handeln oder auslassen?“ sitzt eingeklappt im Einstiegs-Check (eine Zeile mit Urteil und
Pille), aufgeklappt in vier Gruppen (Pflicht · Optional · Widersprüche · Fehlende Daten) mit Glyphe `✓ ✕ ? !` und Klartext; der Skeleton
der Karte reserviert die Zeile (kein Layout-Sprung). Bekannte Abweichung: die `Segmented`-Radios (primitive `COARSE_HIT`-Regel) messen
im Hit-Box-Audit auf Touch 33 statt 44 px – genauso in der bestehenden Box-Einstellungen-Karte derselben Seite; die neuen Schaltflächen,
Schalter, Chips und Felder bestehen den Audit.

## Labor: Belastung, Prüfbericht, Filtervergleich (F20 / F18 / F17)

Unter der Diagnose, vor der Robustheit: drei zusammenklappbare Karten (`Card`, Kopfzeile mit kleinem Auf-/Zuklappen-Button, `Collapse`
mit den vorhandenen Tokens). Zugeklappt kosten sie eine Zeile; der Inhalt jeder Karte ist ein eigener Lazy-Chunk und wird beim ersten
Öffnen geladen. Gerechnet wird nichts vor dem Klick: die Szenarien und der Filtervergleich starten mit eigenem Knopf (Fortschritt als
dünner Balken, `scaleX`, daneben „Abbrechen“; der Hinweis sagt ehrlich, dass die Signale dafür noch einmal berechnet werden), der
Prüfbericht und die Verlustserien kommen sofort aus dem gezeigten Lauf. Tabellen scrollen **in sich** (`role="region"`, tastaturfokussierbar),
nie die Seite. Änderungen gegenüber dem Basislauf stehen als eigene Spalte: Netto-R in R, Drawdown in Prozentpunkten, PF absolut;
Ton nur bei echter Veränderung (grün besser, rot schlechter, bei Drawdown umgekehrt), nie als Urteil über die Strategie.
Ehrlichkeit vor Optik: ein Szenario ohne die nötigen Daten bleibt in der Tabelle, mit Pille **Ersatz** (gerechnet mit genannter Annahme)
oder **nicht gerechnet** und dem Grund in der Zeile darunter; gesperrte Filter (Top-Trader, Retest außerhalb von Box-zu-Box) zeigen
ihren Grund als sichtbaren Satz, nicht nur als Tooltip, der Schalter ist deaktiviert. Kleine Stichproben bekommen Pille und Satz („Mit 12
Trades …“), nie eine Ampel. Filterbeiträge tragen immer den Hinweis, dass sie sich überlappen. Der Prüfbericht zeigt Walk-forward und
Out-of-Sample als zwei statische Streifen (grau = nur Training bzw. Auswahl, hell = ungesehen); keine neue Farbe, keine neue Bewegung.
Touch: Schalter und Chips bestehen den Hit-Box-Audit (die Chips bekommen auf grobem Zeiger zusätzlich `min-w-11`).

### Wochenreview, Wochenexperiment (F37) und Verpasste Chancen (F32)

Keine neue Sprache. **Wochenreview**: eine `Card`, darin vier Befunde als ruhige Blöcke (`rounded-xl border-line bg-ink-950/50`): Mono-Versal-Titel
und die Stichprobe („n 6“) in einer Zeile, darunter der eine Satz, der zählt (Ton nur nach Vorzeichen des Ergebnisses, die Unsicherheit bleibt
immer `mute`), die Zahlen als Fließtext in `text-mute`. Zu jedem Befund öffnen Pillen-Schaltflächen („Regelverstöße · 2 Trades öffnen“,
`aria-expanded`) die Trades als Zeilen – kein Dauer-Auf, keine Bewegung außer dem Aufklappen. **Wochenexperiment**: der Status ist ein Badge
mit Punkt **und** Wort (erfüllt = win, nicht erfüllt = loss, zu wenig Daten = mute, läuft = warn), nie Farbe allein; der Sollwert steht als
eigener Satz in einem umrandeten Feld („Nächste Woche: … – bei mindestens 5 Trades.“). „Annehmen“ ist der einzige primäre Knopf der Karte,
„Ablehnen“ ghost; beides ist umkehrbar („Zurückziehen“, „Wieder öffnen“). Die Annahme hinter dem Vorschlag steht in `text-faint` und ist als
„in einer Woche nicht prüfbar“ gekennzeichnet. **Verpasste Chancen** (Coach-Seite, 12 Spalten): Leerzustand mit `EmptyState` (ohne Statuszeile),
sonst eine Kennzahlenzeile und Signalzeilen mit Zeit (Mono), Richtung (▲ Long / ▼ Short), Quelle (Badge), Markt · Zeiteinheit und den zwei
Knöpfen „Im Labor testen“ / „Beobachten“ (`aria-pressed`); die Einschränkungen („bewusst ausgelassen oder übersehen“, kein Ausgang gespeichert,
keine Ursache) stehen unter einer Trennlinie in `text-faint`, nie versteckt. Bewegung: nur die Zellen-`Reveal`s der Seiten, keine neuen Tokens.

### Diese Idee testen (F12) und TradingView im Labor (F14)

Keine neue Sprache. **Diese Idee testen** ist ein ruhiger `Button` (ghost, `sm` in Listen) neben den bestehenden Wegen („Als Trade
eintragen“, „Im Rechner öffnen“); er füllt vor, startet nichts und speichert nichts. Geht aus der Quelle keine Regel hervor, bleibt
das Labor unverändert und der Grund steht als Satz unter dem Knopf (`role="status"`, `text-mute`), nie als stiller Fehlschlag. Im
Labor steht darüber die Karte **Idee aus dem Journal** (volle Breite, ein `Card`): drei Listen – *Übernommen*, *Nicht abgebildet*
(jeder Punkt mit Grund in `text-mute`), *Näherungen und Standardwerte* – mit den Wegen „Vorheriges Setup zurück“ und „Ausblenden“.
Nicht Abbildbares ist Text, nie ein ausgegrauter Baustein. Der Abschnitt **TradingView** zeigt jeden Weg als Zeile mit `Badge`
(unterstützt = win, nur Forwardtest über Alert = warn, nicht unterstützt = mute) und den Grenzen in einem Satz; der Vergleich trennt
Zahlen (Kacheln, Differenz Netto) von Beobachtungen („Mögliche Gründe“, immer im Konjunktiv) und nennt Lesefehler mit „Zeile n“ in
Signalrot-Text, nie als Dialog. Bewegung: nur die vorhandenen `Reveal`-Zellen, nichts Eigenes. Mobil: alle Listen einspaltig, Paare
als Karten statt Tabelle (kein horizontaler Scroll), Touch-Ziele über `Button` / `ChipPick` (≥ 44 px bei grobem Zeiger).

### Preis- & RSI-Struktur (F05)

Keine neue Sprache: eine `Card` im Raster der Markt-Seite (`lg:col-span-12`), Kopf mit `Label`-Punkt, darunter Chips der Zeiteinheiten
(`aria-pressed`, Pille wie die Ebenen-Chips der Übersicht, ≥ 44 px auf grobem Zeiger, gewählt = weiße Pille) und je gewählter
Zeiteinheit eine Zeile (`rounded-xl border-line`) mit zwei Spalten (Preis | RSI, mobil untereinander) und je Linienart einer
Aussage aus **Punkt + Ton + Wort**: Annäherung (warn), Bruch nach oben/unten (Gewinn-/Verlust-Ton nach Richtung, wie der RSI-Bruchpunkt),
Retest läuft (warn) / bestätigt (Richtungston) / Bruch zurückgenommen (warn) / ohne Retest (mute), intakt (mute) – nie Farbe allein.
Nicht lieferbare Zeiteinheiten bleiben als **deaktivierter Chip mit Grund darunter** sichtbar. Im Chart: dünne Linien in der Grauleiter
(1,1 px, Verlängerung gepunktet), Annäherung `fg` und kräftiger, Bruch im Richtungston mit Kurzbeschriftung auf Platte (`4H ↘ Bruch ↑`);
Blind-Modus ohne Gewinn-/Verlusttöne. Keine eigene Bewegung der Karte (die Zelle blendet ein); der Chart-Layer ist statisch.

## Was wäre wenn (F33) und Üben / Lernmodus (F38)

Zwei Sheets im Stil des Replays, keine neue Sprache. **Was wäre wenn:** oben der Trade in einer Zeile, darunter ein ruhiger Hinweis im Warn-Ton
(„Im Nachhinein gewählt“ – Rückschaufehler, ein Fall ist keine Empfehlung), dann der Replay-Chart mit Stopp und Ausstieg der gewählten Variante, dann die Ergebniszeilen
(Karten mit `border-line`, die gewählte mit hellem Rand; rechts R und Betrag in Mono, darunter Δ zur Nachrechnung; die eigene Variante gestrichelt) und der Baukasten
(vier Gruppen mit `Segmented`, `CheckboxRow`, Zahlenfeldern). Zahlen tragen Vorzeichen-Ton, nie eine Bewertung wie „beste Variante“; die Reihenfolge-Regel
der Kerze und die Annahmen stehen als Fließtext darunter. **Üben:** erst die Auswahl des Setups (Radiogruppe, ≥ 44 px bei grobem Zeiger) mit der Zahl der Fälle,
der Schalter „Markt und Datum verdecken“ und die Verlaufskarte (drei Zählungen jeweils mit „n = …“ und, unter 10, „zu wenig für eine Aussage“; ein Streifen der letzten
Runden aus ✓ ✕ –, nie Gewinnfarben als Wertung). Im Fall: nummerierte Blöcke (Einordnen · Entscheiden · Regeln abhaken · Begründen), eingefrorener Chart ohne Trade; nach dem Speichern
läuft der Chart weiter (`ScrubTimeline`), drei Marken (Erkannt · Regeln · Reflexion) in Text + Glyphe + Ton, „Damals im Journal“, der gestrichelte Vergleichsplan und die Reflexion.
Belohnt werden Erkennen, Regelbefolgung und Nachdenken – es gibt keine Punkte aus Gewinn, kein Ranking, keine Animation für Treffer. Bewegung nur bestehende Tokens; reduzierte Bewegung zeigt das Ende sofort.

### Ähnliche Situationen (F19)

Keine neue Sprache: eine `Card` im Raster der Markt-Seite (`lg:col-span-12`) unter der Preis- & RSI-Struktur. Oben die Wahl in der
Reihenfolge Zeiteinheit (Chips wie bei der Struktur, gewählt = weiße Pille) → Verlauf danach und Einheit (`Segmented`) → „Merkmale ändern“
(Chips, gesperrte mit Grund). Das Ergebnis ist eine Aussage in Fließtext mit Zahl und Spanne (Überschrift `clamp(15px,3.8vw,18px)`, keine
Prozent als Dekoration), darunter ein ruhiger Balken (Gewinn-/Verlust-Ton **nur** für die Anteile höher/tiefer, flach = `faint`), die
Kennzahlen als `dl`-Zeilen in Mono, der Vergleich mit dem ganzen Zeitraum in einem `border-line`-Kasten. **Gegenbeispiele** haben eine
eigene Überschrift mit Warn-Punkt und stehen immer vor der Stichprobe; jede Fundstelle ist eine Zeile-als-Button (≥ 44 px bei grobem
Zeiger, mobil zwei Zeilen statt Tabelle, kein horizontaler Scroll), Gegenbeispiele tragen ein `Badge tone="warn"`. Unter 20 Fundstellen
steht statt der Verteilung ein ruhiger Kasten „Zu wenig Daten“ – nie eine Quote. Die Hinweise (keine Prognose, Mehrfachtest) sind ein
fester Kasten am Ende, nicht wegklickbar. Das Fundstellen-Sheet nutzt `Sheet` + Replay-Chart + `ScrubTimeline` unverändert; es öffnet
auf der Situation und zeigt den Verlauf erst, wenn man abspielt oder zieht. Keine eigene Bewegung der Karte.
