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

## Nachtrag: Screenshot-Import – Orderhistorien (F29)

Eine Börsen-Auftragshistorie (z. B. Bitunix „Vertragsaufträge › Auftragshistorie“) zeigt Schließungen, deren Eröffnung nicht im Bild ist.
Die Vorschau hält dafür **eine** Pflichtzeile offen: „Einstieg“ (gestrichelt, „fehlt“) mit dem Satz „Einstieg fehlt im Bild – die
Eröffnungsorder ist nicht zu sehen.“, dazu eine warn-Pille „Einstieg fehlt im Bild“ am Kartenkopf; die Einstiegszeit ist dann nur ein
ruhiger optionaler Eintrag, die Menge kommt als „Menge (laut Ausstieg)“. Darunter steht die Prüfung „Vorschlag, nicht gelesen“ mit **beiden**
Lesarten des Realisierten PnL (vor / nach der sichtbaren Gebühr), der Differenz in USDT und im Preis und zwei Knöpfen „Einstieg aus PnL
berechnen · ohne / nach Gebühr (≈ …)“ – umbrechende, ruhige Ghost-Buttons, nichts vorgewählt. Ein übernommener Vorschlag bleibt eine
**Annahme**: Zeile „Einstieg (berechnet)“ im amber Rahmen ohne Sicherheitsprozent, Pille „Einstieg berechnet (Annahme)“, Prüfung mit
Angebot „andere Lesart“ / „Berechneten Einstieg verwerfen“, und der Entwurf trägt den Hinweis in den Notizen. Tippt der Trader einen
eigenen Einstieg, ist die Annahme weg. Der Editor behält sein Pflichtfeld: ohne Einstieg meldet „Speichern“ „Bitte einen Einstiegspreis
angeben.“. Fehler nennen den Grund im Klartext (kein Schlüssel / Schlüssel abgelehnt / Modell / Zeitlimit / Antwortformat) und zeigen den
Fehlercode klein in Mono; die Einstellungen-Karte unterscheidet „kein Schlüssel“ von „Server antwortet nicht“ („Status unbekannt“).
Keine neuen Tokens, keine neue Bewegung.

## Signal-Kette (F25 · F27 · F28 · F32 · F60)

Fünf Karten im Raster der Coach-Seite (unter „Profil“) und eine im Monatsbericht, alle mit `Card`, `Badge`, `Button`, Filter-Chips (`aria-pressed`,
≥ 44 px auf grobem Zeiger, gewählt = heller Rand) und Zeilen im Stil `rounded-xl border-line bg-ink-950/50` – keine neue Sprache, keine eigene Bewegung
(nur die `Reveal`-Zellen der Seite). **Posteingang** (volle Breite, einklappbar; die Wahl bleibt im Browser): Zeile = Zeit (Mono) · Status-`Badge`
(neu = steel mit Punkt, gehandelt = win, bewusst ausgelassen = warn, angesehen / abgelaufen = mute) · Richtung (Pfeil + Wort, nie Farbe allein) · Markt · Art · Stufe,
darunter die Überschrift des Signals und vier Aktionen (Ansehen · Ausgelassen – Grund · Im Labor testen · Im Journal verknüpfen); Ausgelassen und Verknüpfen
klappen eine Auswahl als Chips unter der Zeile auf. Die Reihenfolge steht als Satz unter der Liste. **Verpasste Chancen** trägt je Signal eine `Badge` mit dem
Ausgang (Ziel zuerst = win, Stopp zuerst = loss, offen = mute, nicht auswertbar = warn – immer mit Wort und, wo es gilt, „gleiche Kerze, Stopp zählt“ /
„Standardmaß“), darunter der Vergleich verpasster Gewinner und Verlierer als Zeilen mit Quote, Intervall und **immer** Gegenbeispielen. **Bilanz**: je Gruppe ein Block
(Zahlenpaare als `KV`, die Unsicherheit als Mono-Zeile „n … · Stichprobe … · Quote a … b“), mobil gestapelt statt Tabelle; der Vergleich „deine Trades
gegen alle Signale“ nennt den Auswahleffekt im Fließtext darunter. **Qualität**: ein Warn-Hinweis „Alarme laufen nur bei offener App“ steht immer oben;
Unbekanntes heißt „unbekannt“. **Monatsnutzen**: zwei Spalten `KV`-Blöcke, Lücken der Spuren in Warn-Ton, darunter der Satz, was nie behauptet wird.

## Forward-Test (F23), Versionen (F15) und Playbooks (F13 / F45)

Keine neue Sprache, alles im Labor. **Forward-Test:** ein Abschnitt mit zwei Teilen – das Formular „Neues virtuelles Konto“ (`Card`, Regeln-Auswahl als `MorphSelect`, darunter die Regeln
im Klartext in einer Fläche `border-line bg-ink-950/50`, vier Zahlenfelder, ein Satz zu den Kosten, ein primärer Knopf; der Grund, warum nicht gestartet werden kann, steht als Satz links daneben,
nie nur ein ausgegrauter Knopf) und die Liste der Konten, je eine `Card` mit Kopf aus Name, Markt · Zeiteinheit · Start und rechts den Marken (**Läuft** = Win-`Badge` mit atmendem Punkt, **Pausiert** = warn,
**Beendet** = mute; Quelle = steel; **fremd** = warn). Die erste Zeile jeder Karte ist der **Stand** („bis Kerzenschluss …“ oder „noch keine Kerze seit dem Start geschlossen“) in Mono-Ziffern, darunter eine
ruhige Statuszeile (`role="status"`: lädt / rechnet / zuletzt geprüft / Fehler mit Grund in Signalrot-Text). Dann die Eigenkapitalkurve (`EquityDraw`, Basislinie 0 %, 72 px), sechs `Kpi`-Kacheln
(Zahl groß, 80-%-Bereich oder „n = …“ als Unterzeile) und ein Satz zur Stichprobe in `text-faint` – unter 10 Trades steht dort, dass die Zahlen wenig sagen. Offene Position und wartender Einstieg stehen
in einer eigenen Fläche. Pausieren / Fortsetzen sind `Button sm`; Beenden und Löschen fragen mit einer Fläche („Ja, beenden“ / „Abbrechen“, `role="alert"`) nach. Regeln, Trades und der Rückblick-Vergleich
klappen auf (`Collapse`, `aria-expanded`); der Vergleich ist eine Tabelle (Kennzahl · Forward · Rückblick · Abweichung, daneben „im Bereich“ / „außerhalb“ in text-faint / warn) unter einem Urteilssatz (`thin` und `holds` in
Standardfarbe, `differs` in warn – nie rot, nie ein Siegel) und zwei Hinweisen; Mobil scrollt nur die Tabelle in ihrem Rahmen. **Versionen:** eine Karte, je Version eine Fläche mit Kopf (Versionsnummer, „aktuell“-Badge,
Zeit), den Änderungen als Punktliste in Klartext, einer Notiz und „Wiederherstellen“; darunter der Vergleich zweier Versionen als Tabelle, geänderte Zeilen mit leichter Aufhellung (`bg-white/[0.03]`), die Kennzahlen
aus dem Labor als zwei Kästen oder der Satz „Kein Lauf dieser Version“. **Playbook:** zwei Spalten (Export | Import, mobil untereinander); der Export zeigt den Text zum Lesen (Mono, `readOnly`), der Import
Fehler als Fläche in Verlust-Ton mit allen Gründen, sonst eine **Vorschau** mit dem Badge „fremdes Playbook“, Autor als ungeprüfte Angabe, den Regeln im Klartext, Hinweisen in warn und erst dann dem Knopf „Als fremden
Entwurf anlegen“, danach „Probe im Labor“. Bewegung: nur die vorhandenen `Reveal`-Zellen, `Collapse` und `EquityDraw`; reduzierte Bewegung zeigt das Ende sofort. Touch-Ziele über `Button` / `ChipPick` (≥ 44 px bei grobem Zeiger).

## Funktionen (Auffindbarkeit)

Keine neue Sprache, kein neues Gesicht: die Seite „Funktionen“ ist ein Verzeichnis im Stil der anderen Seiten (`PageHeader` mit Punkt, Wortstaffel und `LeadFill`,
Karten `rounded-2xl border-line bg-ink-850 p-4`, Abschnittsüberschriften als `Label`). Sie ist bewusst **nicht** im Dock und keine Dashboard-Karte; sie hängt in der
Befehlsnavigation (Nr. 16, Zusatzzeile „Index“), in der Suche (Art „Funktionen“), auf `g f`, in „Weitere Einstellungen“ und im Assistenten. Stand und Lücke sind
**Text + Punkt + Ton**, nie Farbe allein: Badge `Fertig` (Gewinn-Ton) / `Teilweise` (Warn-Ton), darunter in Mono-Versalien „Fehlt noch“ (warn) bzw. „Zu wissen“ (mute),
„So geht’s“, „Voraussetzung“, „Gerät“. Der Tarif steht als Steel-Badge („Ab Premium“); fehlt er dem Nutzer (nur bei aktiver Zahlung), wird er zum Warn-Badge „… ·
nicht in deinem Tarif“, der Knopf bleibt (die Zielseite zeigt dann den Tarif-Teaser). „Für dich“ und „Zuletzt benutzt“ sind zwei ruhige Listen aus Zeilenknöpfen; ohne
Daten steht ein ehrlicher Satz statt eines Platzhalters, und während gesucht oder gefiltert wird, verschwinden sie. Filter sind `Segmented` (Stand, Tarif), die Suche
ein `Input type=search`. Bewegung nur über `src/motion`: gestaffeltes `Reveal` je Abschnittskopf und Karte (`index % 3`, endet bei `transform: none`), reduzierte Bewegung →
Endzustand; keine Karten-Spotlights (siebzig Karten auf einer Seite). Mobil 390 px: eine Spalte, Segmente umbrechen, Tippflächen ≥ 44 px, kein horizontaler Scroll. Das
Öffnen einer Funktion scrollt die Zielkarte unter den Kopf und lässt einmal den Signal-Streifen darüber laufen (derselbe Griff wie bei Einstellungen in der Suche,
`src/app/reveal.ts`); fehlt die Stelle, steht der Grund in einem Toast. Die Zeile „Auch hier: …“ (`FeatureLinks`) ist Mono-Versal-Label plus Textlinks, nie auf dem Dashboard.

## Strategie-Bibliothek, Pine-Export, Parameter-Raster (F06 / F14 / F15 / F64)

Keine neue Sprache. **Bibliothek:** ein `Sheet` (groß) mit Einleitung und einem ruhigen Kasten „Bekannt heißt nicht wirksam“, Suchfeld, `ChipPick` für den Typ und einem
zweispaltigen Raster von Karten (`rounded-2xl border-line bg-ink-950/50`). Karte = Titel, `Badge` für den Typ (Ton nur zur Unterscheidung, nie Wertung), ein Satz, die Zeiteinheiten in Mono,
„Herkunft, Schwächen, typische Werte“ hinter dem runden `Expander`; unten drei Knöpfe Konservativ · **Standard** (primär) · Aggressiv. Typische Werte: je Zahl ein Block mit Name,
Erklärung und drei Werten in einem Dreier-Raster (Standard heller) – mobil ohne Scroll. Keine Gewinn- oder Verlustfarben auf Karten.
**Pine:** eine volle `Card` in der TradingView-Sektion: drei nummerierte Schritte, der Satz zum fehlenden Konto, dann „Pine-Skript erzeugen“ (primär) und der Chart-Link (Ghost-Knopf als `<a>`);
Ergebnis: Zusammenfassung, bei Lücken ein Warn-Kasten mit den Bausteinen beim Namen, ein schreibgeschütztes Mono-Textfeld (eigener Scroll, nie die Seite), Kopieren / Datei, Notizen eingeklappt.
**Raster:** ein Eintrag unter „Belastung, Bericht, Filter“; zwei `MorphSelect`, ein 3 × 3-Gitter aus Zellen (Σ R im Vorzeichen-Ton, darunter Trades und Ø R, die Mitte mit hellem Rand und „Deine Einstellung“,
Zellen unter 10 Trades gedimmt), eine Zusammenfassung ohne „beste“ Zelle. Bewegung nur die vorhandenen `Collapse`-/`Sheet`-Tokens; reduzierte Bewegung zeigt das Ende sofort.

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

### Passt zu dir? (F49)

Eine `Card` im Raster des Labors (`lg:col-span-12`) unter der Diagnose, eigene Sektion „Passt zu dir?“. Oben eine Zeile Stichprobe (Idee: n Trades,
Zeitraum · Journal: n Trades) in `text-faint`. Darunter drei Gruppen mit `Label` und Punkt: **Reibungspunkte** (Warn-Punkt, `Badge tone="warn"`),
**Übereinstimmungen** (Aqua-Punkt, `Badge tone="teal"`), **Nicht beurteilbar** (neutral, `Badge tone="mute"`) – Reibung ist kein Verlust-Ton, weil es
keine Wertung ist. Jeder Eintrag ist eine `rounded-xl border-line`-Zeile: Badge + Thema, ein Satz mit den Zahlen in `text-mute`, die beiden Zahlen
(Idee | Du) als zweispaltige `dl` in Mono (mobil untereinander), darunter der Vorbehalt dieser Aussage in `text-faint`. Es gibt keine Gesamtnote,
kein Gauge, keine Ampel. Ein fester Kasten am Ende sagt, dass es ein Zahlenabgleich aus der Vergangenheit ist. Leerzustände sind ein ruhiger Kasten mit
der konkreten Zahl („Dein Journal hat 7 Trades abgeschlossen. Ab 20 …“). Keine eigene Bewegung (die Zelle blendet ein).

### Assistent: Auswertungen und Interessen

Keine neue Sprache. Die Antworten der Auswertungswerkzeuge sind gewöhnliche Werkzeug-Antworten (`ToolView`: Etikett mit Punkt, Fließtext mit Zahlen und Stichprobe, bis zu vier Kennzahlen-Kacheln, danach die Knöpfe). Beim Laden der Quelle zeigt der Eintrag den vorhandenen Warte-Takt („Ich suche die passende Auswertung …“). Knöpfe heißen nach dem Ziel („Prüfbericht öffnen“, „In Eigene Idee laden“) und schließen das Sheet, bevor die Seite wechselt; Ton nur für Vorzeichen (R, Ergebnis), nie für Wertung – „hängt an wenigen Trades“ bekommt den Verlust-Ton als Warnung, „passt“ keinen Gewinn-Ton. Im Gedächtnis-Bereich steht unter den Notizen „Was dich interessiert“: ein Satz, was gezählt wird (nur Fragen), je Thema eine `rounded-lg border-line`-Zeile mit Klartext-Name, Zähler in Mono und einem ×-Knopf (≥ 44 px bei grobem Zeiger), darunter „Interessen löschen“ (Ghost); ohne Eintrag ein ruhiger Satz. Keine eigene Bewegung.

### Muster-Entdecker (Auftrag B)

Keine neue Sprache: eine `Card` ganz unten im Labor (`lg:col-span-12`, eigene Sektion „Muster-Entdecker“), mit einem `Segmented` darüber (Letzter Backtest | Journal-Trades; gesperrt mit Grund). Der Kopf der Karte ist eine ruhige Fläche (`rounded-xl border-line bg-ink-950/40`): Quelle und Zahl der Trades, der Start-Knopf (primär), beim Lauf Fortschrittsbalken (`scaleX` auf einer Transform, `role="progressbar"`) mit Phase in Worten und „Abbrechen“, der Seed in `text-faint`. Zu wenige Trades: derselbe Kasten in Warn-Ton mit Soll und Ist, Knopf aus – nie ein Ergebnis aus Rauschen.
Das Ergebnis beginnt mit der **Zählzeile** (`text-[15px] font-semibold`: „Ich habe 412 Zusammenhänge geprüft, 3 halten stand.“), darunter die Aufschlüsselung inklusive „verworfen (Zufall)“ in `text-mute`. **Gewinn-Muster** und **Verlust-Muster** sind zwei Gruppen mit `label`-Kopf und Vorzeichen-Punkt (Gewinn-/Verlust-Ton **nur** als Vorzeichen), darunter einklappbar „Hinweise“ und „Verworfen (Zufall)“ (Zeilenknopf mit `+`/`−`, `Collapse`).
Jeder Befund ist eine **Ampel-Karte** (`rounded-xl border-line bg-ink-950/50 p-3.5`): Punkt (grün bestätigt, gelb Hinweis, nur Umriss = verworfen) **mit** dem Stufenwort im `Badge` – nie Farbe allein –, der Satz in `text-[14px] font-medium`, vier Kennzahlen als `dl` in Mono (2 × 2 mobil, 4 × 1 ab `sm`), „trifft auf x % der Gewinner und y % der Verlierer zu“, vier kleine Quadrate für die Zeitblöcke (✓ gleiche Richtung · ✗ Gegenrichtung · – zu wenige Trades, mit `aria-label`), Abzeichen (`steel`: „Kombination stärker als jede Einzelwirkung“, `mute`: „Merkmal, das kaum jemand prüft“, `warn`: „erst nach dem Trade bekannt“), Gründe als kurze Sätze, Details hinter einem Ghost-Knopf. „Mit diesem Filter testen“ ist ein primärer `Button sm` unter dem Befund (≥ 44 px bei grobem Zeiger), das Testergebnis eine `rounded-lg border-line`-Zeile (`role="status"`), die Gründe gegen den Filter stehen als `text-mute`-Satz. Unten: „So wurde geprüft“ als Textknopf mit Aufzählung und der feste Hinweis in einem `border-line`-Kasten (*Beobachtung, keine Ursache; kein Versprechen für die Zukunft. Keine professionelle Finanzberatung.*).
Mobil 390 px: eine Spalte, kein Querscroll, die Kennzahlen in zwei Spalten, Knöpfe umbrechen. Bewegung nur über vorhandene Bausteine (`Button`-Press, `Collapse`, die `Reveal`-Zelle des Labors); der Balken bewegt nur `transform`; reduzierte Bewegung zeigt den Endzustand.
## Hintergrund-Optimierer (F66)

Keine neue Sprache, nur bestehende Bausteine (`Card`, `Badge`, `Sheet`, `Button`, Mono-Zahlen). Eine `Card` im Raster des Labors (`lg:col-span-12`) in
der eigenen Sektion „Hintergrund-Optimierer“ nach dem Forward-Test. Ganz oben ein `border-line`-Kasten mit dem festen Satz **„Läuft nur, solange die App
offen ist.“** und dem Zusatz, dass nie von selbst etwas geändert wird – er ist nicht wegklickbar und steht vor jedem Start. Darunter die Strategien als
Zeilen mit Checkbox (≥ 44 px bei grobem Zeiger; Name, Symbol/Intervall, Freiheitsgrade in Mono, Grund in `text-mute`, wenn eine Strategie nicht laufen kann),
dann Start / Pause / Fortsetzen / Stopp (ein primärer Knopf zur Zeit), Budget und Tempo (Schonend / Normal / Volle Leistung) als zwei kleine Auswahlen.

**Lauf.** Ein dünner Balken (`h-1.5`, weiß auf `white/[0.06]`, nur `transform: scaleX`, im Reduced-Motion-Fall ohne Übergang) mit „Versuch n von N“ in Mono,
darunter je Strategie eine Zeile mit Phase. Eine ruhige Zeile (`evolve-throttle`) nennt, ob der Worker oder die Zeitscheiben im Hauptthread rechnen und warum
gebremst wird (Tab im Hintergrund, Energiesparmodus, Datensparmodus, Touch-Gerät, eigene Einstellung). Pausiert steht „Pausiert“. Der Status-`Badge` ist
neutral/blau, nur „Läuft“ trägt den Gewinn-Ton als Punkt, Fehler den Verlust-Ton.

**Ergebnis.** Je Strategie eine Zeile der Rangliste: jetzige Version | beste Variante auf den **Testfenstern** (Ø R, Trades, größter Rückgang in R), darunter
der Streifen der Fenster (`WindowsStrip`: Training | 4 Tests | Bestätigung, gleiche Breite wie die Zeit, Bestätigung gestrichelt umrandet, damit sichtbar
ist, dass sie nie zur Auswahl diente). Die Trainingszahl steht nie als Schlagzeile. Das **Turnier** ist eine Tabelle (mobil: eine Zeile-als-Karte je
Eintrag, kein Seitwärts-Scroll) der Bestätigungsfenster-Ergebnisse aller Strategien und Varianten mit der über ALLES Getestete korrigierten
Wahrscheinlichkeit; die naive Zahl steht klein daneben. „Nichts gefunden“ ist ein ruhiger Kasten (`evolve-nothing`) mit der Zahl der Versuche – kein Fehler.

**Vorschlag.** Je Vorschlag eine `Card` mit dem `Badge` „Überanpassung n %“ (gering = Aqua, unsicher = Warn, hoch = Verlust – ein geringer Wert ist **kein**
Gewinn-Ton). Inhalt: die Änderungen als Sätze (Liste, je Änderung eine Zeile), erwartetes Ergebnis gegen jetzige Version in Mono, Plateau („hält bei
kleinen Änderungen“ n von m), Warnungen (wenige Trades, hängt an wenigen Trades, Bestätigung schlechter) als `text-warn`-Zeilen vor den Knöpfen. Drei Knöpfe
gleichrangig, ≥ 44 px: **Als neue Version speichern**, **Als Herausforderer live testen**, **Ablehnen** (klappt ein Feld für den optionalen Grund auf).
Entschiedene Vorschläge wandern in eine eingeklappte Liste; „Hat sich der Vorschlag live bestätigt?“ zeigt Erwartung und Ergebnis in Prozent je 30 Tage
nebeneinander (bestätigt = Aqua, darunter = Warn, zu früh = neutral, mit den fehlenden Tagen/Trades in Worten).

**Was habe ich gelernt?** Eine eigene `Card` unter den Vorschlägen: Zeilen mit Zahl und Stichprobe („Trend-Filter: 3 von 3 angenommen“), Trefferquote der eigenen
Vorschläge mit 80-%-Bereich, Vorhersage gegen Live. Unter der Mindeststichprobe steht ein ruhiger Satz, was fehlt – nie eine Quote. Das Versuchsprotokoll ist
ein `Sheet` (lazy) mit den Versuchen als Zeilen.

Jede Karte endet mit „Vergangene Ergebnisse sind keine Prognose. Keine professionelle Finanzberatung.“ (`evolve-disclaimer`, `text-faint`, nicht wegklickbar).
Keine eigene Bewegung außer dem Balken; alles Weitere kommt aus `src/motion`.
### Strategie-Studio (F73)

Keine neue Sprache: die Seite `#studio` ist ein Raster aus den vorhandenen `Card`s (Zellen `Reveal`, Abschnittstitel wie im Labor). Oben links die **Strategie-Liste** (je Strategie eine
`rounded-xl border-line`-Zeile: Haken als `role="checkbox"` mit 44-px-Zielfläche, Name, darunter „v2 · 2 Versionen · 1 Papierkonto“ in `text-faint`; die geöffnete hat den helleren Rand), rechts der
**Editor**: großes Textfeld (`Textarea`, 14 px, Zeilen mit Luft), darunter Beispiel-Chips (`rounded-full border-line-2`, wie die Chips des Labors), Markt und Zeitraum, dann „Verstehen“ als
**einziger** weißer Primärknopf der Gruppe, „Als Entwurf speichern“ als Ghost.

**Verstehen = Lesen, nicht Raten.** Der eigene Text erscheint mit markierten Wörtern: verstanden = grünlicher Grund mit dünner Unterkante und kleiner Nummer (`sup`, 9,5 px) passend zur Liste darunter,
unklar = Bernstein. Die Farbe ist hier **keine Wertung**, sondern „gelesen / nicht gelesen“; deshalb steht eine Legende darunter und jede Markierung trägt ihren Grund im `title`. Die Liste „Das habe ich
verstanden“ ist je Zeile ein Paar „deine Wörter | was das Labor daraus macht“ (mobil untereinander). „Unklar“ sind `border-warn/25`-Zeilen mit dem Grund; „Fragen an dich“ sind Zeilen mit einer
Marke (Nötig = warn, vorläufig = mute, beantwortet = win) und den Antwort-Chips (`role="radiogroup"`, gewählt = hellerer Grund, ≥ 44 px bei grobem Zeiger); „Meine Annahmen“ nutzt dieselben Chips. Ändert
man den Text, wird der ganze Block gedämpft (`opacity-60`), die Chips sind gesperrt und ein Satz verlangt ein neues „Verstehen“ – nichts wird still neu gelesen.

**Ergebnis.** Der Backtest zeigt Kennzahlen als `Kpi`-Kacheln (Vorzeichen-Ton nur für Ø R und Netto), einen Kasten zur Stichprobe (unter 30 Trades Warn-Ton mit dem Satz dazu), die Eigenkapital-Kurve
(`EquityDraw`, eine Fläche, kein Fanfarenton), Train / Test als zwei ruhige Kacheln und höchstens drei Beobachtungen. **Jede Ergebniskarte endet mit „Keine professionelle Finanzberatung.“**, Backtest
und Vergleich davor mit dem einen ruhigen Satz, dass er die Vergangenheit zeigt.

**Vergleich („Alle testen“).** Die **Zahl der verglichenen Strategien** steht groß und in Mono über der Tabelle – schon vor dem Lauf –, darunter ein Warn-Kasten (`border-warn/30 bg-warn/[0.06]`) mit dem
Mehrfachtest-Satz. Ab 768 px eine echte Tabelle (Rang, Strategie, Trades, Trefferquote, Ø R, Profit-Faktor, Max. DD, Test-Fenster in zwei Mono-Zeilen, p angepasst, Stichprobe als `Badge`), darunter
als Karten je Strategie mit dreispaltigem `dl` – nie ein seitlich scrollender Seitenkörper. Rang 1 bekommt keine Krone und keine Farbe: es ist eine Zahl im Kreis. Nicht gerechnete Strategien stehen
mit Grund unter „Nicht verglichen“.

**Papierkonten** fragen immer zuerst (ein Kasten mit dem Satz „Kein Echtgeld, keine Order.“ und dem Bestätigen-Knopf). Die Slot-Karten „Muster entdecken“ / „Weiterentwickeln“ sind gestrichelte
Platzhalter („Kommt gleich.“), bis die echten Werkzeuge eingebaut sind; ein Vorschlag erscheint als Kasten mit dem Unterschied in Klartext und „Übernehmen“ / „Verwerfen“. Keine eigene Bewegung
außer den vorhandenen Tokens (Zellen-Reveal, `EquityDraw`); reduzierte Bewegung zeigt das Ende sofort.
### Screenshot importieren (lokale Texterkennung, F29)

Keine neue Sprache: ein `Sheet` mit den vorhandenen Bausteinen (`Button`, `Segmented`, `Collapse`/`Expander`, `Badge`). Drei Phasen im selben Sheet:
**Wählen** (gestrichelte Ablagefläche „Bilder hierher ziehen, einfügen oder wählen“, Miniaturen mit Entfernen, darunter eine ehrliche Zeile – die Erkennung
läuft nur auf dem Gerät und kann sich vertun, Bilder werden weder gespeichert noch gesendet, beim ersten Mal einmaliges Laden der Erkennungsdateien),
**Lesen** (ein ruhiger Fortschrittskasten mit Text je Schritt, Abbrechen möglich, keine Prozent-Zahl als Dekoration) und **Vorschau**. Die Vorschau beginnt mit
einer Zusammenfassung („2 Trades erkannt · 1 Karte unvollständig“), danach die Annahmen als Auswahl (Zeitzone mit Satz „keine Zeitzone im Bild – angenommen: …“,
Konto Scalp/Makro), dann je Trade eine `rounded-xl`-Zeile mit Häkchen (abgewählt = gedimmt), Titel „BTC/USDT · Long · 5×“ und einer Mono-Zeile mit den Kerndaten.
Aufgeklappt: der Ausschnitt des Originals (die Zeile im Bild, nur im Speicher) und die Felder als Zellen. **Gelb** (`border-warn/50 bg-warn/[0.07]`) =
unsicher gelesen oder angenommen, mit dem Grund darunter und einem Eingabefeld zum Ändern an Ort und Stelle; „abgeleitet“ = aus anderen Zahlen berechnet, nicht
gelesen (z. B. Gebühren). Eine Korrektur nimmt das Gelb sofort zurück, wenn die Zahlen wieder zusammenpassen. Unvollständige Karten stehen in eigenen Warn-Kästen
(„abgeschnitten … Bitte den nächsten Ausschnitt mit hochladen“) und haben keine Auswahl. Schon vorhandene Trades sind abgewählt mit „Schon vorhanden“.
Der Hauptknopf unten heißt „Alle N Trades eintragen“ (bei Abwahl „N Trades eintragen“); danach schließt das Sheet und ein Toast „N Trades eingetragen“ trägt die
Aktion „Rückgängig“ (9 s). Der feste Schlusssatz nennt: unvollständige Karten werden nicht eingetragen, Gelb/abgeleitet erklärt, „Keine professionelle
Finanzberatung.“ Bewegung nur die vorhandenen `Sheet`-/`Collapse`-Tokens; reduzierte Bewegung zeigt das Ende sofort. 390 px: Zellen untereinander, Ausschnitt oben,
kein horizontaler Scroll.
### Funktionen finden: Seite „Funktionen“, Inhalt-Leiste, Finder im Menü

Keine neue Sprache, aber ein neuer Grundsatz: **jede Funktion hat genau einen Ort in Worten der Aufgabe** („Trade prüfen & Chart“, nicht „Markt“) – und man
kommt in drei Handgriffen hin: suchen, Kachel wählen, Zeile antippen.

- **Seite**: `PageHeader`, darunter ein einziges, großes Suchfeld (`Input`, 56 px, 16 px Schrift, Lupe links, ✕ rechts ≥ 44 px) mit der Frage „Was willst du tun?“ als
  sichtbarem Label (kein Platzhalter-Ersatz). Danach – nur wenn etwas da ist – „Zuletzt benutzt“ und „Empfohlen“ (`Label` + eine Zeile Notiz + kompakte Zeilen: Punkt, Name,
  Tag `Badge` „Neu“ / „Für dich“ / „Empfohlen“, darunter nur die Gruppe, `text-mute`). Dann die **Aufgaben** als Kacheln: `rounded-2xl border-line bg-ink-850`, Symbol in
  `size-11 rounded-xl border-line-2`, rechts oben in Mono Anzahl · Zustand, Name 17 px / 600, darunter ein Satz 13 px `text-mute`; eine Spalte mobil, zwei ab `md`, drei ab
  `xl`; Hover nur Rand (`border-line-2`), kein Spotlight, keine Neigung.
- **Zustandspunkt**: grün = fertig, bernstein = teilweise – der Punkt ist nie allein: bei „teilweise“ steht das Wort in Mono-Versalien daneben, auf der Kachel die Zahl
  („9 teilweise“), in den Details „Fehlt noch“. Der Tarif steht als Teil der Ortszeile („Labor › Diagnose · Premium“), nicht als Pille auf jeder Zeile; nur was der eigene
  Tarif *nicht* enthält, trägt die bernsteinfarbene `Badge`.
- **Gruppenliste**: „← Alle Aufgaben“ (`Button size="sm"`), Titel `clamp(20px,5.4vw,24px)` mit Symbol, Satz, dann je Zwischenüberschrift ein `Label as="h3"` mit Zähler und die
  Zeilen (eine Spalte, ab `xl` zwei). Eine Zeile ist ein `article` mit zwei Knöpfen: die Fläche öffnet die Stelle, ein stiller Knopf rechts (Haarlinie links, der Pfeil dreht
  um 180°) klappt die Details (`Collapse`). Mobil nichts unter 56 px.
- **Inhalt-Leiste** (`SectionNav`): ein Streifen aus `rounded-full`-Chips (Rand `line-2`, aktiv `border-white/40 bg-white/[0.07] text-fg`) mit dem Mono-Label „Inhalt“ davor, in der
  Seite eingebaut unter dem Kopf, oben **klebend direkt unter dem Header** (`top = env(safe-area-inset-top) + 64 px`, Fläche `ink-900`, Haarlinie unten). Er sitzt im Fluss –
  beim Ankleben springt nichts –, ist 53 px hoch (65 px mit 44-px-Chips auf grobem Zeiger), scrollt waagerecht nur in sich (Scrollbalken aus, kein Seiten-Scroll) und verdrängt
  nichts: `--section-nav-h` erweitert `scroll-padding-top`, damit jedes Ziel (Chip, Suche, „Alle Funktionen“) unter dem Streifen landet.
- **Anspringen** (`revealSection` / `revealCard`): weiches Scrollen, danach hebt sich der Abschnittstitel kurz (Deckkraft .3 → 1, 8 px nach oben, `tween.reveal`) – oder die Karte
  bekommt die eine rote Signal-Welle –, beides nur `opacity` / `transform`; reduzierte Bewegung springt und lässt die Hervorhebung weg. Kommen darüber noch Karten nach (Lazy), holt
  `keepAligned` das Ziel zurück an die Linie, bis die Person selbst scrollt.
- **Finder im Menü**: über den Seitenlinks ein 48-px-Feld („Funktion suchen: …“), rechts neben dem Label der Textlink „Alle Funktionen →“. Treffer sind Navigations-Elemente
  (Name, Aufgabe, Gruppe · Ort) im Stil der Schnellaktionen; ohne Treffer ein Satz und der Weg zur ganzen Liste.
- **Kontrast**: lesbarer Text ist `text-fg` oder `text-mute` (≥ 4,5 : 1, hell und dunkel, axe-geprüft); `text-faint` bleibt Dekor. **Fokus**: der globale Ring (`:focus-visible`), nie
  entfernt. **Landmarken**: `role="search"` um das Feld, `nav "Inhalt dieser Seite"`, `section` + `aria-labelledby` je Liste, `aria-current="location"` im Streifen, `aria-expanded` an den
  Details, `role="status"` für die Trefferzahl. **Zurück-Taste**: die offene Gruppe ist ein History-Eintrag (`openBackEntry`).

### Selbstprüfung: der ruhige Hinweis, Quelle und Stand, lesbare Kleinschrift

Drei kleine Bausteine, keine neue Sprache; Bewegung: keine.

- **Hinweis** (`src/ui/AnalysisNote.tsx`): ein einziger Absatz `text-[12px] text-mute`, ohne Rahmen, ohne Symbol, am **Ende** der Seite (letztes Rasterkind, `lg:col-span-12`, höchstens 72 Zeichen
  breit) – „Auswertung deiner Daten und historischer Kurse – keine Prognose. Keine professionelle Finanzberatung.“ Wo der erste Satz nicht stimmt (Risiko, Berichte, Wachstum, Labor …), setzt die Seite
  ihren eigenen (`lead`); der zweite Satz ist immer derselbe. Im Assistenten steht die Dauerzeile (`variant="assistant"`) im klebenden Block **unter dem Eingabefeld**, nie in einer Antwortblase. Nie auf der
  Startseite, dem Cockpit oder den Seiten ohne Auswertung (Konto, Preise, Community, Einstellungen, Funktionen).
- **Quelle und Stand** (`src/ui/SourceStand.tsx`): eine Zeile `text-[12px] text-mute`, Ziffern tabellarisch – „Quelle: Binance USDⓈ-M · Abruf 25.10. 01:35 · letzter Schluss 4h 24.10. 23:59“. Sie steht
  unter dem Kopf der Seite (Markt) oder am Ende der Karte, die Marktzahlen zeigt (Labor-Lauf, Korrelation, Benchmark). Was fehlt, heißt „keine Daten“ – nie eine Schätzung, nie ein leerer Platz.
- **Kleinschrift**: `--color-faint` ist im dunklen Thema #5f5f5f (≈ 3 : 1) – die Startseite behält ihn Pixel für Pixel. In allen anderen Seiten (`[data-page]` außer `overview` und `cockpit`) und in Sheets
  (`[role="dialog"]`) gilt dort #8c8c8c (≥ 4,5 : 1 auf ink-950 … ink-700), `src/styles/themes.css`. Hell braucht nichts (#6b6b6b). Touch: dichte Chip-Reihen und Export-Knöpfe werden bei grobem Zeiger
  44 px hoch (`pointer-coarse:min-h-11`), unsichtbare Trefferflächen kommen über `touch-hit`.

### Signal-Ausgänge: automatisch, mit ruhiger Statuszeile (F32)

Kein neues Bauteil, keine Bewegung. Der gemeinsame Ausgang-Block (`OutcomeControl`, in Verpasste Chancen und Signalbilanz) besteht aus: dem stillen `ghost`-Knopf **„Neu berechnen“** (`Rechne …`
und gesperrt, solange ein Lauf läuft) mit dem Zähler „x von y mit Ausgang“ in Mono; einer Zeile `text-[11.5px] text-mute` **„Wird automatisch ausgewertet.“** (bei einer Pause: „Automatische Auswertung
pausiert: der Datensparmodus ist an. „Neu berechnen“ rechnet trotzdem.“, im Lauf: „Gerade läuft ein Lauf im Hintergrund.“); der **Statuszeile** in `text-faint`, Mono-Ziffern, in Hausform von Quelle und Stand –
„Zuletzt berechnet: 25.10. 14:32 (automatisch) · Quelle: Binance USDⓈ-M, Kerzen 15 Minuten“ („(von dir gestartet)“ nach dem Klick, „Zwischenspeicher dieses Browsers“, wenn nichts geladen werden musste;
vor dem ersten Lauf „Noch nicht berechnet.“); einer Warnzeile (`text-warn`, `role="status"`) bei Fehlern und dem erklärenden Satz darunter. Wo der Ausgang eines Signals noch fehlt, steht an seiner Stelle
ein `text-faint`-Satz, der sagt, was gerade ist („Wartet auf die erste volle Kerze nach dem Signal.“, „Wird gleich automatisch ausgewertet.“, „Wird ausgewertet …“, „Noch nicht ausgewertet – pausiert, …“) –
nie ein geschätztes Ergebnis, nie ein Spinner.
### Barrierefreiheit der Startseite (Runde 5)

Auf ausdrückliche Erlaubnis des Nutzers, ohne das Aussehen zu ändern – Layout, Texte, Reihenfolge, Animationen, Dock und Kopfzeilen-Layout bleiben.

- **Kleinschrift** `--color-faint`: auf Startseite, Cockpit, Kopf- und Fußzeile dunkel `#868686` (kleinste Anhebung, die auf den dort gemessenen Flächen AA erreicht), hell `#686868`; auf allen anderen
  Seiten `#8c8c8c` / `#6b6b6b`. Linien, Punkte und Striche in „faint“ nehmen `--color-faint-line` (`bg-faint-line`, unverändert `#5f5f5f` / `#6b6b6b`): nur Text wird angehoben.
- **Plaketten** (hell): Text in Gewinn-, Verlust- oder Warnfarbe auf der eigenen Tönung (`bg-win/12 text-win` …, Statuspille) holt sich ≈ 6 % dunklere Töne (`--tint-ink-*`, `themes.css`); die dunklen
  Inseln (Hero, Navigation, `data-theme-scope="dark"`) behalten ihre Werte.
- **Dichte Raster** (Disziplin-Kalender, Wochentag × Uhrzeit): kein 44-px-Ziel je Zelle möglich – das Raster ist das Ziel: `data-hit-grid="<Fangradius px>"` am Raster, unsichtbarer Rand
  (`pointer-coarse:before:-inset-3` / `-inset-4`, hinter den Zellen), ein Tipp wählt die nächste Zelle; Raster-Abstand ≥ 24 px, wo die Breite es erlaubt.
- **Kennzahlenkacheln**: `role="list"` aus sieben Knöpfen (`role="listitem"`), kein `dl` um Knöpfe. **Seitenwechsel**: `overflow-x: clip` um Kopf und Seite – ein ein- oder auslaufendes Blatt macht das
  Dokument nie breiter als den Bildschirm.

### E-Mail-Alarm bei geschlossener App (F21)

Ein Abschnitt der Karte „Alarme & Zustellprotokoll“ (Markt), kein neues Bauteil und keine neue Bewegung: Überschrift im `label`-Stil, ein Satz `text-[12px] text-mute`, die `SwitchRow` (elastischer `Switch`, 44 px
Trefferfläche über `touch-hit`), darunter **ein Zustandskasten** (`border-line-2 bg-white/[0.03]`): `Badge` mit Punkt in der Tonart des Zustands (`mute` aus / nicht verfügbar, `warn` Einrichtung nötig / Tarif /
Cloud-Sync aus / Server nicht erreichbar, `win` an), ein Satz, der den Grund nennt, und – nur bei eingeschaltetem Alarm – eine Liste (`dl`: Zuletzt geprüft · Auf dem Server · Überwacht · Mails heute · Zuletzt
gemailt · Wartet · Versand · Nicht überwacht; ab `sm` zwei Spalten 9,5 rem / Rest, auf dem Handy untereinander, Warnzeilen `text-warn`). Darunter die Tagesgrenze als `Segmented` (3 · 6 · 12 · 24), der Knopf
„Testmail senden“ mit der Empfänger-Adresse aus der Sitzung, und drei kurze Absätze in `text-[11.5px] text-mute` – „Was er ist – und was nicht“, „Ruhig“ und **„Was an den Server geht“** (immer sichtbar, nie
eingeklappt). Texte: `src/views/schluesselmarken/emailStrings.ts`. Der Zustand folgt einer festen Reihenfolge (`emailAlertView`): kein Konto → nicht angemeldet → 2FA-Code fehlt → Tarif → Server wird gefragt →
nicht erreichbar → nicht eingerichtet → keine / unbestätigte Adresse → Cloud-Sync aus → aus → an; **Ausschalten geht in jedem Zustand**. Keine Zahl ohne Quelle: „Zuletzt geprüft“ ist der Herzschlag des
Zeitplans (`app_config`), fehlt er, steht „Noch keine Prüfung gemeldet“; ist er älter als 20 Minuten oder fehlgeschlagen, steht der Grund in `text-warn`. Mail-Text: Deutsch, knapp, jede Auslösung mit Symbol,
Regel, Zeit und Kurs beim Auslösen, „Kurs jetzt“ und „Stand: Quelle, Zeit (Zone)“, dazu „Keine professionelle Finanzberatung.“, der Link zur App und der Abmelde-Hinweis (Schalter in der App).
## Aktien-Panels: Zahlen-Analyst, DCF-Rechner, Kaufthese (F68 / F69)

Keine neue Sprache: drei `Card`s (`src/views/analyst`), eingebaut in das Raster der späteren Seite „Aktien“; innen nur `Field`/`Input`, `Segmented`, `Badge`, `Button`, `EmptyState`, `Skeleton`, `Expander`/`Collapse` und Mono-Zahlen (`num font-mono`). Keine eigene Bewegung außer den Tokens dieser Bausteine.

- **Ehrlichkeit vor Optik.** Eine fehlende Zahl heißt immer **„keine Daten“** (`text-faint`) – nie ein Strich, der eine Null sein könnte. `*` (in `text-warn`) hinter einer Zahl = abgeleitet (Differenz kumulierter Werte, Jahr minus Quartale), `≈*` = auch näherungsweise (EPS); die Legende steht unter der Tabelle, das Quartal trägt auf dem Handy ein `Badge` „abgeleitet *“. Der Satz **„kein Konsens, nur gemeldete Zahlen“** steht als `Badge` im Kopf des Analysten, **„Keine professionelle Finanzberatung.“** am Ende jeder Karte (`AnalysisNote`, `lead` je Karte: „Gemeldete Zahlen aus SEC-Berichten – keine Prognose, kein Konsens.“ / „Modellrechnung aus den eingegebenen Annahmen – keine Prognose.“ / „Deine These und deine Annahmen – keine Prognose der App.“).
- **Quelle und Stand** (`SourceStand` + eigene Zeile): „Quelle: SEC EDGAR (XBRL) · Abruf 25.10. 13:00“ und darunter „neuestes Quartal bis 27.06.2026 · Quelle bei der SEC“ (Link). „Abruf“ ist die Zeit, zu der der **Server** die SEC gelesen hat – eine zwischengespeicherte Antwort wirkt nie frischer als sie ist; eine letzte gute Kopie sagt das in `text-warn`.
- **Fehler** (`SecErrorBox`, `role="alert"`, `border-warn/30 bg-warn/[0.06]`): erst die Meldung des Servers in Klartext, darunter ein ruhiger Satz, was das heißt („Einrichtung nötig“ trägt den Namen der Env-Variablen). Nie ein leerer Platz, nie eine geschätzte Zahl.
- **Analyst.** Kopf (Name 17 px / 600, Mono-Zeile Kürzel · CIK · Währung), Sätze „Was sich geändert hat“ (13,5 px, keine Wertungsfarben – nur Richtung und Größe), dann die Quartale: ab `lg` eine Tabelle (Spaltenköpfe 10,5 px Versalien, Zahl in Mono, darunter die **kleine Zeile** „Veränderung zum Vorjahresquartal“, die neueste Zeile leicht hinterlegt), darunter und auf dem Handy je Quartal eine Karte (`rounded-xl border-line`, `dl` in zwei Spalten; die drei neuesten offen, die übrigen hinter „Ältere Quartale“) – nie ein seitlich scrollender Seitenkörper. Termine/Ereignisse, die letzten Meldungen (Form als `Badge`, 8-K-Punkte in Klartext) und die Hinweise liegen hinter einer Überschrift mit `Expander`.
- **DCF.** Zwei Spalten ab `lg` (Eingaben 5 : Ergebnis 7), darunter eine. Das Ergebnis ist **die Spanne** („55,34 bis 94,93 USD“, Mono 26–30 px – die eine große Zahl der Karte), darunter der Rechenwert, Unternehmens- und Eigenkapitalwert und der **Endwert-Anteil** mit einem dünnen Balken (`h-1.5`, nur `scaleX`) und seinem Satz. Die Sensitivitätstabelle ist 5 × 5 mit fester Spaltenbreite (passt in 390 px ohne Scroll): Mitte kräftig hinterlegt, der innere 3 × 3-Block schwach, Werte ≤ 0 in `text-loss`, „–“ wo der WACC nicht über dem Endwachstum liegt. Die Jahr-für-Jahr-Rechnung ist ab `md` eine Tabelle (offen), auf dem Handy Karten (zu).
- **These.** Liste links (ab `lg` 260 px, sonst oben) mit `aria-current`, rechts der Editor in Abschnitten (`data-section` für die `SectionNav` des Gastgebers: Begründung · Szenarien · Widerlegen · Versionen). Szenarien: drei `rounded-xl`-Spalten (eine Spalte mobil), je Szenario Eingaben, darunter nach einer Haarlinie die Spanne und der Abstand zum eingegebenen Kurs. Bedingungen als Zeilen „Widerlegt, wenn …“ mit `Badge` **Ausgelöst** (`warn`, Punkt) / **Nicht ausgelöst** / **Keine Daten** (beide `mute`) – Farbe nie allein, immer das Wort. Ein ausgelöster Fall erzeugt einen **Vorschlag**-Kasten (`warn`), dessen Knopf nur eine Version speichert. Alle Felder ≥ 44 px bei grobem Zeiger; Zahlenfelder lesen „1,5“ und „1.5“.
- **Zahlenformate.** Beträge „109,42 Mrd. USD“ / „412,3 Mio. USD“, Prozent „+16,4 %“, Margenänderung „+1,2 Pkt.“, Daten „27.06.2026“ (Meldungen), „25.10. 13:00“ (Abruf).

### Termine, Heute wichtig, Ereignisphasen, Transaktionsbuch (F43, F70)

Keine neuen Bauteile, keine neue Bewegung – vorhandene Primitives (`Card`, `Segmented`, `MorphSelect`, `Badge`, `Button`, `Field`/`Input`) und die Chip-Form der Berichte (`rounded-full`, `min-h-9`, bei grobem Zeiger `min-h-11`).
- **Zeilen mit Quelle:** jeder Termin und jede Briefing-Zeile ist eine ruhige Zeile (`rounded-xl border border-line bg-ink-950/40`), Zeit in Mono (`num font-mono`), darunter in `text-faint` „Quelle: … · 14:30 Uhr“ oder „keine Zeit“. Die Quelle eines Termins klappt auf Tipp auf (Knopf mit `aria-expanded`, Trefferfläche ≥ 44 px bei grobem Zeiger). „keine Daten“ steht in `text-mute`, nie in einer Signalfarbe.
- **„gleich“:** eine `Badge` (warn, Punkt) an Terminen in höchstens 60 Minuten; sonst nur bei hoher Wichtigkeit die Badge „hoch“, die Wichtigkeit als sr-only-Text.
- **Monat:** 7 Spalten, Zellen 48 px hoch (Trefferfläche), Tag als Zahl, darunter bis zu vier Punkte (`size-1.5`) je Art; heute mit `ring-steel/60`, gewählt mit `bg-ink-750`. Die Tagesliste steht darunter, nicht im Raster.
- **Phasen:** je Phase eine Karte-in-der-Karte mit zwei Spalten „In der Phase“ / „Außerhalb“ (ab `sm`), das Urteil als `Badge` (klar = steel, Tendenz = warn, offen/zu wenig = mute) – nie grün/rot, weil das Urteil die Sicherheit beschreibt, nicht die Richtung. Der Zufallshinweis steht als `role="note"` in der Form der anderen Hinweise (`border-line-2 bg-white/[0.03]`).
- **Transaktionsbuch:** Zeilen als Raster – ab `md` acht Spalten mit Kopfzeile (Zahlen rechtsbündig), darunter (390 px) zwei Spalten mit Beschriftung je Zelle (leere Zellen entfallen); eine Zeile mit Warnhinweis bekommt `border-warn/30`, ihre Hinweise stehen darunter als `Badge` + Satz. Die Jahreszusammenfassung ist ein Block je Jahr (`dl`, 2 / 3 / 6 Spalten). Druck: weißes A4 wie das PDF der Berichte, nur dichter (7 pt).
### Handelsplan (`#plan`)

Kein neues Bauteil, keine neue Bewegung: fünf große `Card`s (Einstieg · Ausstieg · Größe · Risiko-Check · Ticket) untereinander, darüber der Kopf mit einer **Fortschrittsleiste** (fünf Segmente, `h-1`, grün = fertig, die laufende zu 12 % gefüllt, Text „3 von 5 Schritten fertig · jetzt: Größe“) und die `SectionNav`. Auf breiten Schirmen (lg) steht „Bild zum Plan“ (Kerzen mit Range, Signal, Einstieg, Stop, Ziel) rechts neben dem ersten Schritt, auf dem Handy davor in einer Spalte. Jede Karte: Kopf mit Zustandspille (Fertig grün · Achtung gelb · Gesperrt rot · Wartet grau, **immer mit Wort**, nie nur Farbe), eine Überschrift in Worten (`text-[18px] font-semibold`), die Eingaben als `ChipPick` / `Segmented` / `NumInput` (≥ 44 px bei grobem Zeiger), die Zahlen als Kennzahlenkacheln (`Kpi`, `div` im Raster – kein `dl` um Kacheln), „Angenommen“ als ruhiger Kasten mit Aufzählung und zuletzt die Schlusszeile in `text-faint`: „Keine professionelle Finanzberatung. Quelle: … · Kerzen bis … · abgerufen …“. Die Ampel des Risiko-Checks sind drei Punkte plus das Wort („Grün“, „Gelb“, „Rot“); Rot trägt zusätzlich die Zeile, die das Ticket sperrt. Alle Aktionen (Kopieren, Speichern, „Plan → 3 Alarme“, „Plan ins Journal“, Verwerfen) sind eigene, gleich große Knöpfe mit einem Satz darüber, was sie tun – nichts davon geschieht ohne Klick, und es gibt keinen Knopf, der etwas an eine Börse sendet. Farben, Abstände, Federn nur aus den Tokens von `src/primitives` und `src/motion`.
### Aktien (F67 / F68)

Keine neue Sprache: die Seite `#aktien` ist ein Raster aus den vorhandenen `Card`s (Zellen `Reveal`, Abschnittstitel `SectionTitle`, Inhalt-Leiste `SectionNav`: Scanner · Watchlist · News · Analyse · Kongress). **Jede Zahl trägt ihre Quelle und ihre Zeit** in einer ruhigen Mono-Zeile in `text-faint` („Quelle: Yahoo Finance (inoffiziell) · Abruf 25.10. 22:55 · letzte Kerze 23.10. 21:55“, `StampLine` = `SourceStand`); ein Treffer trägt sie **je Zeile**, ein veralteter Zwischenspeicher dazu eine `Badge tone="warn"` mit dem Grund.

**Scanner.** Oben die Wahl (Segmented für Markt und Modus, Quelle, Zahl der Charts), darunter „Regeln und Schwellen“ als `Expander`: je Regel ein `fieldset` mit den Zahlenfeldern (`NumField`, committet bei Blur / Enter, ≥ 44 px bei grobem Zeiger), jede Schwelle sichtbar und änderbar, „Auf Standard zurücksetzen“ als Ghost. „Scan starten“ ist der **einzige** weiße Primärknopf der Karte, „Abbrechen“ ersetzt ihn während des Laufs; der Fortschritt ist ein `role="progressbar"` mit Klartext („120 von 400 Charts · 98 gescannt …“). Nach dem Lauf steht die **Bilanz** als fünf `Figure`-Kacheln (Angefragt · Gescannt · Übersprungen · Fehlgeschlagen mit Fehlerquote · Treffer), darunter „Übersprungen, weil …“ / „Fehlgeschlagen, weil …“ je Grund und der Stichprobensatz – ein Fehler wird nie in Grau versteckt; ein nicht erreichbares Verzeichnis ist ein gestrichelter Kasten (`border-dashed`) mit dem Grund, kein leeres Ergebnis.

**Treffer.** Je Treffer eine `rounded-xl border-line`-Zeile: Rang (Mono, `text-faint`, **keine Farbe, keine Krone** – eine Position in der gewählten Sortierung, der Satz darüber sagt das), Kürzel, Long / Short und Setup als `Badge`, rechts die Kennzahl des Setups; darunter der Satz, **warum der Chart auf der Liste steht**, mit Zahlen. Die Vorschau („Chart“) ist ein statisches SVG ohne Bibliothek und ohne Bewegung: Kerzen in `text-win` / `text-loss` (nur Richtung der Kerze), die Linien der Regel gestrichelt in `text-signal` mit ihrem Preis (Beschriftungen halten ≥ 11 px Abstand), eine dünne Marke dort, wo die Regel anschlug; daneben die geprüften Bedingungen mit Haken. Die Aktionen sind Ghost-Knöpfe; „Plan erstellen →“ erscheint nur, wenn die Seite `plan` existiert.

**Watchlist und News.** Zeilen im selben Muster (Kürzel, Name, Kurs und Änderung in Mono, Quelle und Kurszeit darunter). Eine Meldung ist ein `article`: oben `Badge`s (**Neu** = teal mit Punkt, **Wichtig** = warn, **Mittel** = steel, Themen in mute) und die Kürzel, die Überschrift als Link (neuer Tab, `noopener`), darunter Quelle, Zeit und – wenn die Einstufung auf Stichwörtern beruht – die **Stichwörter, die sie ausgelöst haben**. Die Einstufung ist ein Hinweis, was zuerst gelesen werden will, **kein Signal**; deshalb nennt jede Karte ihre Wörter und schließt mit „Keine professionelle Finanzberatung.“ Die Platzhalter „Analyse“ und „Kongress“ sind gestrichelte Karten („Kommt gleich“), bis die echten Teile eingebaut sind. Keine eigene Bewegung außer dem Zellen-Reveal.
## Zeitmaschine (Labor, Trade-Detail)

Eine Karte, die rechnet (`src/views/timemachine`), im Nothing-Stil: ruhig, Zahlen in Mono, Beschriftung auf den Linien, nichts, das nur durch Farbe verstanden wird.

- **Aufbau der Karte** von oben: Plan-Zeile (Mono) → Urteil (`VerdictPanel`, eine Zeile, darunter die Zusatzzeilen des Skills) → „Wer kommt zuerst?“ (drei Kacheln + **Anteilsbalken**) → Erwartungswert → Fächer → Histogramm → schlechtester / mittlerer / bester Fall → Zeit bis zum Ausgang → Echte Vorfälle → Vergleich (Warnhinweis) → Hinweise → Annahmen (`details`) → Quelle + Stand und „Keine professionelle Finanzberatung.“ Jeder Block hat eine Überschrift in Kapitälchen (`Block`) und eine ruhige Zeile darunter.
- **Nicht nur Farbe.** Anteilsbalken: Ziel = ausgefüllt, Stop = schraffiert, weder noch = gepunktet (Gradienten, `HATCH` / `DOTS`), nachgezogener Stop = leer; jedes Segment steht auch als Text in der Kachel und in der Legende. Fächer: Stop-Linie **gestrichelt** und beschriftet („Stop −1,00 R“), Ziel-Linie **durchgezogen** und beschriftet, Endmarken ● Ziel · ✕ Stop · ◇ nachgezogen, Legende mit denselben Formen; Median als dicke Linie, Bänder 90 / 50 % mit gestricheltem Rand für 90 %. Histogramm: Verlust-Spalten **schraffiert**, Gewinn-Spalten voll, Stop und Ziel als Markierung auf der R-Achse mit Wort, die höchsten Spalten mit Prozent als Text. Warnhinweis: Rahmen + „⚠“ + Wort „Warnung:“, `role="alert"`.
- **Zahlen zu den Bildern** (`details`: „Zahlen zum Fächer“, „Zahlen zur Verteilung“) als echte Tabellen mit Kopfzeilen; der Fächer liest per Zeiger, Tipp und ← → (Fokus sichtbar), die Spalten des Histogramms per Zeiger / Tipp.
- **Bewegung** nur `src/motion`: Fächer wischt einmal von links ein (`tween.draw`, clip-path), Histogramm-Spalten wachsen von der Grundlinie (`spring.enter`, gestaffelt), Fortschrittsbalken `spring.smooth`; veraltete Ergebnisse dimmen über `opacity` (`duration-200`). Reduzierte Bewegung: Endzustand sofort. Die Bilder sind eigene Chunks (`lazy` in der Karte).
- **Mobil (390 px).** Kacheln dreispaltig mit festem Beschriftungsraum (zwei Zeilen), die Vorfälle als dreispaltige Tabelle (Einstieg · Ausgang · Ergebnis mit „Gegenzug“ darunter), der Vergleich als Liste mit drei Werten je Zeile, Bilder messen ihre Breite (`ResizeObserver`) und beschriften an den Rändern nach innen; Knöpfe und Chips ≥ 44 px bei grobem Zeiger.
- **Formular** im Labor: `FieldRow` / `Input numeric` / `ChipPick` / `Segmented` wie im Versuchsaufbau; Eingabe von Preisen mit Komma oder Punkt; ungültige Pläne stehen als ruhige Zeile mit Grund unter dem Formular, nie als Fehlerdialog. Das Blatt am Trade-Detail ist ein `Sheet` (`size="lg"`) wie „Was wäre wenn“.


### Datenarchiv und Squeeze-Beobachtung (F26, F07)

Keine neue Sprache und keine neue Bewegung: zwei `Card`s aus den vorhandenen Bausteinen (`Switch`, `Segmented`, `Button`, `HoldConfirm`, `Input`), nur transform/opacity aus den Tokens, reduzierte Bewegung = Endzustand sofort.
- **Ehrlichkeit vor Optik.** Beide Karten sagen zuerst, was sie sind. Das Archiv: drei Sätze in `text-mute` 12 px über dem Schalter (was gespeichert wird · nichts verlässt das Gerät, kein Teil von Backup und Cloud-Sync · kein Server-Archiv, Lücken nie gefüllt); der Schalter steht **aus**, die Zeile darunter sagt „Aus – es wird nichts gesammelt.“ Die Squeeze-Karte: ein Satz „kein Handelssignal und keine Prognose“ und am Ende „Keine professionelle Finanzberatung.“ (Kontrast `text-mute`, nicht `text-faint`).
- **Lücken sind sichtbar, nicht still.** Eine Reihe zeigt „3 Einträge · ca. 1 KB“, den Zeitraum in Mono und darunter „1 Lücke, zusammen 3 h“ in `text-warn` (mit Knopf „Lücken anzeigen“, `aria-expanded`); die Liste nennt je Lücke Zeitraum, Dauer und den **Grund in Worten** („App war zu oder pausiert – kein Abruf versucht“, „Abruf fehlgeschlagen: Binance sperrt den Standort (451)“). Nie eine Linie, die eine Lücke überbrückt; Größen tragen „ca.“ / „geschätzt“.
- **Messwerte** (Squeeze): je Messwert eine ruhige Zeile (`rounded-xl border-line`) mit Name, Zustand als **Wort** („erfüllt“ / „nicht erfüllt“ / „keine Daten“, dazu ✓ / – / ?, Farbe nie allein), dem Wert in Mono, der Schwelle in Worten und – bei fehlenden Daten – dem Grund. Drei Spalten ab `lg`, eine mobil. Die Überschrift trägt einen Punkt (`bg-warn` bei einer Beobachtung, sonst `bg-faint`) und den Satz; keine Ampel, kein Grün/Rot für „gut/schlecht“ – „Long-Seite überfüllt“ ist keine Wertung.
- **Löschen** wie im Rest der App: Halten bestätigt sofort, Tippen fragt „Wirklich löschen? Ja / Nein“ (`HoldConfirm` + `useConfirmFocus`, Fokus auf „Nein“). Alle Knöpfe, Chips und Segmente ≥ 44 px bei grobem Zeiger (`pointer-coarse:min-h-11`), kein horizontales Scrollen bei 390 px (Zeilen umbrechen, Chips `flex-wrap`).
- **Eingaben** der Schwellen übernehmen bei Blur / Enter (Komma oder Punkt), werden auf ihre Grenzen gesetzt und stehen mit „von … bis …“ unter dem Feld; der Alarm-Schalter ist ein eigener Block darunter, standardmäßig aus, mit dem Satz, was er tut.
- **Grenzen der Börsen-Anbindung (F42).** Im CSV-Dialog und in der Sync-Karte steht ein ruhiger Block `text-mute` 11,5 px („Unterstützt: … Nicht unterstützt: Coin-M / inverse Kontrakte, Hedge-Modus“); ausgelassene Zeilen erscheinen in der Vorschau als `text-warn`-Zeile mit Zahl und Grund – wie die übrigen Hinweise des Dialogs, nie als Fehlerdialog.
### Kongress-Tracker (Abschnitt Kongress der Seite Aktien)

Keine neue Sprache, keine neue Bewegung: eine `Card` (`aktien-kongress`) mit den vorhandenen Bausteinen (`Segmented`, `Field`/`Input`, `CheckChip`, `Badge`, `Button`, `SourceStand`, `CardNote`, Einblenden der Zeilen über `RevealGroup`/`RevealItem`). Von oben: ein Einleitungssatz → **„Bevor du die Zeilen liest“** (ein ruhiger Kasten `border-line-2 bg-ink-950/50`, zwei Spalten ab `sm`; die vier Vorbehalte – bis zu 45 Tage zu spät, Spannen, Mitglied ist nicht Absicht, kein Signal – stehen **immer** da und lassen sich nicht einklappen) → Filter (Mitglied und Ticker/Name als `Input`, Art und „Gemeldet in den letzten“ als `Segmented`, drei `CheckChip`s) → der Zustand der Quellen in Worten (`role="status"`: Fortschritt „Meldungen gelesen: 12 von 46“ als dünne Leiste `h-1`, gefüllt über `scaleX` – nur transform –, danach „nicht lesbar“, „nicht abrufbar (Grund)“, „aus dem Zwischenspeicher“) → die Zeilen → der Senat-Hinweis → Quelle, Index-Stand, Abruf.
- **Eine Zeile** ist ein `article` (`rounded-xl border-line bg-ink-950/30`): Kürzel als Knopf (Mono, Rahmen; **gewählt** = hellerer Rahmen und `aria-pressed`, ≥ 44 px bei grobem Zeiger), Name des Wertpapiers, rechts die `Badge`s (**Kauf** = teal, **Verkauf** = steel – bewusst nicht grün/rot: Kauf und Verkauf sind hier keine Wertung –, **Call-/Put-Option** = steel, **Auf deiner Watchlist** und **Neu** = teal mit Punkt, **über 45 Tage** = warn). Darunter Mitglied · Wahlkreis · Eigentümer, vier Werte als `dl` (Handel am · Gemeldet am · Meldeverzug · Betrag, Mono, zwei Spalten mobil, vier ab `sm`), bei Optionen eine Zeile „Call · 100 Kontrakte · Strike $100 · Verfall 17.06.2027“, die Beschreibung der Meldung in Anführungszeichen und der Link „Original-PDF (DocID …) ↗“. **Der Betrag heißt „Betrag (Spanne)“ und steht so, wie er gedruckt ist** („$1,000,001 – $5,000,000“); steht in der Meldung eine einzelne Zahl, heißt er „Betrag laut Meldung“ – nie eine Spanne, nie ein Mittelwert.
- **„Nicht lesbar“** ist eine Karte mit gestricheltem Rahmen (`border-dashed`), Badge **Nicht lesbar** (warn), dem Grund in einem Satz und demselben PDF-Link; nichts davon sieht aus wie eine gelesene Zeile.
- **Ausfall:** ein Kasten `border-warn/30 bg-warn/[0.06]` mit Titel, dem Satz des Servers, „Behördenseite ohne Zusage zur Erreichbarkeit“ und **Nochmals versuchen**; eine ältere Kopie steht darunter als ruhige warn-Zeile mit ihrem Abrufzeitpunkt. Die Vorbehalte bleiben auch dann stehen.
- **Mobil (390 px):** alles einspaltig, Wertpapiername bricht um, keine Tabelle (also nichts, das seitlich scrollt); Chips und Kürzel `pointer-coarse:min-h-11`. **Bewegung** nur die der Primitives (Einblenden der Zeilen, Segmented-Daumen, Fortschrittsleiste über `transform`, `motion-reduce:transition-none`).
## Demo mit Beispieldaten (F58)

Ein Blatt (`Sheet`, `size="lg"`) mit fünf Schritten – **Import · Regeln · Test · Demokonto · Alarm** –, ruhig im Nothing-Stil: Stufenleiste mit Zahl und Wort (nie nur Farbe), ein Fuß mit Zurück · „Schritt n von 5“ · Weiter (am Ende „Demo beenden“), danach eine Schlusskarte mit den echten Wegen (Import, Labor, Handelsplan, Schlüsselmarken).

- **Kennzeichnung.** Jede Karte trägt oben „Beispiel – nicht deine Daten“ (`Badge`, Mono, Kapitälchen, `text-mute`) und unten „Keine professionelle Finanzberatung.“; Karten mit Kerzen nennen deren Quelle („künstlich berechnet, kein Markt“). Die Kennzeichnung ist Text, nicht Farbe.
- **Zahlen und Bild.** Zahlen in Mono (Doto nur dort, wo die App sie schon so zeigt); das Kerzenbild (`DemoChart`) ist ein statisches SVG, misst seine Breite (`ResizeObserver`), Kerzenfarbe nur als Richtung, jede Linie (Einstieg, Stop, Ziel, Marke) und jede nummerierte Marke steht zusätzlich als Wort in der Legende darunter. Kleinschrift ist `text-mute`, nie `text-faint`.
- **Auswahl** (Beispiele, Antworten, Baukasten, Alarmregel) über `ChipPick` / umbrechende Chips mit 44 px Tippfläche bei grobem Zeiger und `gap-y-4` (die `touch-hit`-Flächen dürfen sich nicht überlappen); keine umbrechende `Segmented`.
- **Mobil (390 px).** Eine Spalte, kein horizontaler Scroll: lange Badges brechen um (`whitespace-normal text-left`), Ids und Pfade brechen, Tabellen werden Listen.
- **Bewegung** nur `src/motion` (`Sheet`, `StaggerItem`; Schrittwechsel `tween.fade` / `spring.enter`); reduzierte Bewegung: sofort. Nichts blinkt, nichts startet von selbst, der Demokonto-Schritt deckt Kerzen nur auf Tipp auf.

## Entscheidung: du, Regelwerk, KI (F24)

Eine Karte in Analyse › Vergleich (`ana-decision`), dieselbe Bauweise wie die Nachbarkarten (`AnaCard`, `InsightCard`): drei Spalten (mobil gestapelt) mit Name der Herkunft in Kapitälchen, Anzahl und Trefferquote in Mono, die Spanne als Zahlenpaar und Ø R mit der Spanne als Linie (`CiWhisker`, Zahlen daneben). Eine Gruppe unter 5 Trades zeigt nur ihre Anzahl und „Zu wenig Daten“ – keine kleinere, schönere Zahl. Das Urteil je Paar steht als Wort (klar / Tendenz / offen) mit Satz; die Überschrift verneint einen Rang, solange nichts „klar“ ist; ein Satz nennt, dass ein Unterschied keine Ursache beweist. „Herkunft nachtragen“ ist eine ruhige Liste (Tipp auf Ich · Regelwerk · KI, 44 px), das KI-Protokoll ein einklappbarer Bereich ohne Gesprächstext. Im Editor ein einziges Feld „Entscheidung“ (Offen · Ich · Regelwerk · KI) im Abschnitt „Ausführung“.
### Handelsplan · Aktien, Link und Zeitmaschine für Aktien (Anhang)

Keine neuen Bauteile, keine neue Bewegung – vorhandene Primitives (`Card`, `Segmented`, `ChipPick`, `Button`, `Input`); was neu auf der Seite steht, ist Text in den gewohnten ruhigen Zeilen:

- **Zeile zum Link** (`hplan-link`): zwischen Kopf und Fortschrittsleiste, nur wenn ein Link `#plan?symbol=…&side=…` kam – ein ruhiger Kasten (`rounded-xl border-line-2 bg-ink-950/40`, 12,5 px, `text-mute`): „**Aus dem Link übernommen:** Markt AAPL (US-Aktie) · Sitzung US-Börse (9:30 New York) · Richtung Long. Es wurde nichts gespeichert und nichts gesendet.“ Was der Link verlangt und die Seite nicht versteht, steht darunter, je Teil eine Zeile in `text-warn` („Das Kürzel „@@@“ … – ignoriert.“). Rechts „Schließen“ (Ghost, bei grobem Zeiger ≥ 44 px). Kein Toast, keine Bewegung: die Zeile ist da oder nicht.
- **Hinweis zur Quelle** (`hplan-stocks-note`) unter der Sitzungswahl, solange die US-Börse gewählt ist: `text-mute`, 11,5 px – Yahoo Finance ist inoffiziell, ohne Garantie, möglicherweise verzögert; 5- und 15-Minuten-Kerzen reichen nur rund vier Wochen zurück. Dieselben Sätze stehen unter „Angenommen“ von Schritt 1.
- **Verzögerung** (`hplan-feed-lag`) als eigene Zeile unter der Kerzenzeile, nur bei laufender Sitzung: in Ruhe `text-mute`, bei Verzug `text-warn` mit `role="status"` – nur Uhrzeiten und Abstände („Die neueste geschlossene Kerze schloss um 10:30 Uhr (vor 8 Minuten); nach der Uhr wäre die von 10:35 Uhr fällig – die Daten hängen hinterher.“), keine Schätzung der Verzögerung und keine Ursache.
- **Aktien-Zahlen:** Mengen in „Stück“ (ganze Zahlen), Preise mit zwei Stellen, Währung USD; die Hebel-Wahl entfällt zugunsten einer Mono-Zeile „1× – nur eigenes Geld“; das Ticket nennt keinen Hebel, keine Funding-Zeile; die Alarm-Aktion heißt „Erinnerung „flat by close““ (kein Preis-Alarm: die Schlüsselmarken lesen nur den Krypto-Live-Markt, und der Text daneben sagt das).
- **Zeitmaschine im Plan:** vor dem Klick bei Aktien eine `Segmented` (Stunden-Kerzen · Tages-Kerzen, `SEG_TOUCH`) mit der Reichweite darunter („Reichweite: bis zu 2 Jahre.“); nach dem Klick die Karte der Zeitmaschine wie im Labor, darüber der Satz, auf wie vielen Kerzen sie läuft, bis wann der Zeitstopp reicht und was Lücken (Nacht, Wochenende) für die Rechnung heißen. Für Aktien steht in Erwartungswert und Annahmen **kein Wort über Funding**.
- Mobil (390 px): alles in einer Spalte, kein seitliches Scrollen, Touch-Ziele ≥ 44 px (e2e misst es für den Aktien-Zustand), Kontrast in beiden Themen mit axe geprüft.

## Belege, Herkunft und Chartfälle (F57 / F50 / F71 / F47)

- **Beleg-Seite** (`#share/<token>`): kein Tacho, kein Siegel. Oben die Summe in R als Punktmatrix (grün/rot nach Vorzeichen) und daneben der Drawdown; darunter Kennzahlen als ruhige Kacheln, die R-Kurve als SVG-Linie mit Nulllinie und dem tiefsten Rückgang in Rot (Beschriftung als HTML, nicht im SVG), dann Vollständigkeit, Herkunft, Kosten, Fortschreibung und die ganze Trade-Liste. Nebentext in `text-mute` (`text-faint` besteht den Kontrast auf dieser Fläche nicht). Die Grenzen stehen auf der Seite, nicht im Kleingedruckten.
- **Rangliste**: Drawdown als vierte Ansicht (kleiner ist besser, deshalb aufsteigend) und als eigene Zeile unter jedem Namen; "Herkunft der Daten" ist ein zweiter Segment-Schalter. Bei 390 px bricht der Vierer-Schalter auf eine zweite Zeile um – gewollt, die Tippflächen bleiben 44 px.
- **YouCard**: vier Kacheln, unter 640 px und ab 1024 px zu zweit nebeneinander (die Spalte ist dort schmal), dazwischen vier in einer Reihe; Beschriftung wird gekürzt statt überzulaufen.
- **Chartfall**: SVG-Kerzen; vor der Hypothese liegt der Verlauf nach dem Anker weder im Bild noch in der Preisskala (sonst verriete die Skala die Richtung). Entscheiden → Warten → Ergebnis ist eine Karte mit drei Zuständen, keine drei Karten. Die Richtung steht immer als Wort (Abzeichen), die Farbe ist nur Zusatz.
- **Passt zu dir?**: drei weitere Aussagen in derselben Gruppierung (Reibung, Übereinstimmung, nicht beurteilbar); das Zeitbudget steht nie unter "Reibung" oder "passt", nur unter "nicht beurteilbar" mit beiden Zahlen.


## Verwaltung planen und vergleichen (F65)

Keine neue Sprache, keine neue Bewegung: zwei Bausteine aus den vorhandenen Primitives (`CheckboxRow`, `ChipPick`, `NumInput`, `Collapse`, `ScrollTable`, `RunBar`), nur transform/opacity aus den Tokens, reduzierte Bewegung = Endzustand sofort.

- **Karte „Verwaltung nach dem Einstieg“** (Handelsplan, Positionsrechner): ein ruhiger Kasten `border-line bg-ink-950/40` mit drei `CheckboxRow`s (Break-even · Teilziel · Trailing-Stop); die Felder einer Regel klappen mit `Collapse` darunter auf (zwei Spalten ab `sm`, mobil eine; Einheit und Zahl nebeneinander, die Zahl mit sichtbarem Etikett und Einheit im Feld). Ohne Regel nur der Satz „Keine Verwaltung geplant“.
- **Ablauf statt Formel.** „Dein Ablauf“ ist eine nummerierte Liste von Kästchen: Kapitälchen mit Regel („1 · BREAK-EVEN“), darunter „Wenn der Kurs 100.695,0 erreicht hat …“ in `text-mute` und „→ Stop von … auf …“ in `text-fg`. Eine Regel, die nie greifen kann, bekommt `border-warn/30` und das Wort „greift nie“ im Kapitälchen – Farbe nie allein.
- **Beispielrechnungen** als Liste mit 1-px-Trennern (`gap-px bg-line`): links Satz und Detail, rechts Geld und R in Mono (`+19,58 USDT · +1,68 R`; Vorzeichen als Zeichen, Gewinn `text-win`, Verlust `text-loss`). Darunter ein Satz „Rechenbeispiele … keine Prognose“.
- **Vergleich im Labor:** zwei `ScrollTable`s (Ergebnis je Variante; weitere Kennzahlen), die erste Zeile „Stop unverändert“ ist der Vergleichspunkt (`bg-white/[0.03]`); Spaltenköpfe in Kapitälchen, Zahlen in Mono, Δ-Spalte mit `deltaTone`. Kein „bester“ Eintrag, keine Hervorhebung einer Zeile; die Warnung bei unter 30 Trades in `text-warn`.
- **Mobil (390 px):** Karte einspaltig, Tabellen scrollen in ihrem eigenen Bereich (`role="region"`, fokussierbar), nie die Seite. Alle Schalter, Chips und Felder ≥ 44 px bei grobem Zeiger.

## Playbook-Fassungen und Checkliste (F45)

Keine neue Sprache: die vorhandene Karte „Playbook austauschen“ (`Card`, `FieldRow`, `Input`, `Textarea`, `MorphSelect`, `Badge`, `Button`), nichts bewegt sich außer dem, was die Primitives schon tun.
- **Fassung** ist ein `Badge` (mute) neben „fremdes Playbook“; die Zeile „Neu in dieser Fassung: …“ steht in `text-fg/90`, die Checkliste des Autors als Liste mit leerem Kästchen vor jedem Punkt (`border-faint-line`, nur Zierde, `aria-hidden`) und einem Satz, dass es Prüfpunkte von Hand sind.
- **Update-Karte** (`playbook-update`): ein ruhiger Kasten `border-line-2 bg-white/[0.03]` im Vorschaukasten; erste Zeile in Worten („Neuere Fassung eines Playbooks, das du schon hast: …“), darunter „Was sich in deinem Entwurf ändern würde“ als Liste in Klartext, die Warnung bei eigenen Änderungen in `text-warn` mit `role="status"`, der Satz „Die App abonniert nichts …“ in `text-faint`. Der Knopf „Als neue Version … übernehmen“ ist die primäre Aktion, „Als eigenen neuen Entwurf anlegen“ tritt dann zurück (ghost); eine ältere oder gleiche Fassung bekommt keinen Übernehmen-Knopf.
- **Export:** unter dem Entwurf steht in einem Satz (`text-mute`), welche Fassung die Datei wird; das Feld „Was ist neu?“ erscheint nur bei eigenen Entwürfen.
- Mobil: eine Spalte, Texte brechen um (`[overflow-wrap:anywhere]`), Knöpfe `pointer-coarse:min-h-11`.

## Indikator-Vertrag und Abgleich (F14 / F64)

Keine neue Sprache: eine `Card` in der Labor-Sektion „TradingView“ (volle Breite), `Button` (ghost), `Input`, `MorphSelect`, `Badge`; nichts bewegt sich außer dem, was die Primitives schon tun.
- **Vertrag** zugeklappt: Überschrift mit Anzahl, ein Satz über „gemessen, nicht behauptet“ und die Zeile „kein Wiederzeichnen“ in `text-mute`; aufgeklappt eine Liste, je Indikator Name, Pine-Aufruf in Mono, Eingaben und die Zeile „ab Kerze N · eingeschwungen nach etwa M“ in Mono (N gemessen, M eine Faustzahl). Die Prüfaussage („gegen TradingView-Werte geprüft“ / „nach Definition nachgebaut“) steht in Worten, nie als Farbe allein.
- **Abgleich:** je Spalte ein ruhiger Kasten (`border-line-2`), Auswahl „Vergleichen mit“, Eingabefelder des Indikators, dann das Urteil als `Badge` (gleichwertig validiert = Gewinnton, weicht ab = Warnton, offen/zu wenige Werte = neutral) mit dem Satz dazu und den Zahlen (verglichen, erster Wert, größte und mittlere Differenz) in Mono. „Weicht ab“ listet die fünf größten Abweichungen. Der Hinweis „kein allgemeines Zertifikat“ steht in `text-faint` darunter.
- Mobil: einspaltig, Zahlenraster zweispaltig, Texte brechen um, nie seitliches Scrollen; Felder und Knöpfe ≥ 44 px bei grobem Zeiger.

## Börsenhistorie, Ausführbarkeit, Signalprotokoll, Quellenzeilen (F26, F07, F44, F25, F28, F27, F31)

Keine neue Sprache und keine neue Bewegung: vorhandene Bausteine (`Segmented`, `Button`, `Badge`, `SourceStand`), nur transform/opacity aus den Tokens, reduzierte Bewegung = Endzustand sofort. Gemeinsam gilt: **zuerst sagen, was es ist und woher es kommt**, dann die Zahl; was fehlt, steht als Wort („keine Daten“, „nicht erfüllt“, „Lücke“), Farbe ist nie allein der Träger.
- **Börsenhistorie nachladen** (Datenarchiv-Karte, `rounded-xl border-line bg-ink-950/40 p-3.5`): drei Sätze in `text-mute` vor dem Knopf (was, woher, getrennt und gekennzeichnet; nur etwa 30 Tage; nichts wird hochgeladen), Spanne als `Segmented` (7 / 14 / 30 Tage), Symbole als umbrechende Chips (`aria-pressed`, 44 px bei grobem Zeiger, `gap-y-4`), die Vorschau in einer Zeile in Mono („23 Abrufe für 1 Symbol · ≈ …“). Der Fortschritt ist ein ruhiger Balken (`h-1.5`, `scaleX` auf `spring.smooth`, nur Transform) **mit Text darunter** (Abrufe, Einträge, Weg) – der Balken allein sagt nichts; „Abbrechen“ steht daneben, das Ergebnis nennt je Reihe und Symbol, was geladen ist und was nicht abgefragt wurde (`text-warn`, mit Grund). Geladene Reihen tragen in „Was vorliegt“ die Marke „nachgeladen“ (`Badge`, Wort statt Farbe) und eine eigene Summenzeile – sie stehen nie in einer Reihe mit Gesammeltem.
- **Ausführbarkeit jetzt** (Schritt Ticket): eine ruhige Karte, kein Dauerwert – erst der Knopf „Spread und Tiefe prüfen“, dann die Befunde als Liste (Spread mit Wort und bp, Tiefe in drei Bändern, Durchlauf beim Einstieg und am Stop, Slippage-Annahme „gedeckt“ / „zu niedrig angenommen“, Anteil am Tagesumsatz), jeder mit einem **Wort** für den Ton (`ok` / `warn` / `bad` / `unknown`, dazu ein Punkt, Farbe nie allein; ein `ok` ist ein Befund über diesen Moment, keine Freigabe, und ein gescheiterter Abruf ist `unknown` (grauer Punkt) und sagt „keine Daten“ mit Grund). Darunter die Quellenzeile (Quelle, Stand, abgerufen, Größe) und „Keine professionelle Finanzberatung.“; der Satz „Eine Momentaufnahme …“ steht in der Karte, ein Alter über einer Minute bekommt eine `text-warn`-Zeile.
- **Signalprotokoll** (aufgeklappter Posteingang-Eintrag): drei Blöcke mit Kapitälchen-Überschrift (`text-mute`, 10 px) – Voraussetzungen (Zeile = Wort + ✓ / ✗ / ?, Beschriftung des Zustands zuerst, `whitespace-nowrap`), Regelstand (Mono, mit `text-warn`-Zeile, wenn sich die Einstellungen seitdem geändert haben) und Verlauf (`ol`, Zeit in Mono `text-faint`, Zeilen aus Journal / Kerzen / Uhr tragen „aus Journal, Kerzen oder Uhr“, die Zeilen derselben Marke „dieselbe Marke / Box“ sind `text-mute`). Fehlt ein Block, sagt er in einem Satz, warum (älteres Signal, Quelle nennt keine).
- **Quellen- und Lückenzeilen**: `SourceStand` (`num text-[12px] text-mute`, auf der Coach-Seite 11,5 px am Ende der Karte), „Quelle: … · Abruf …“, fehlende Zeit = „keine Daten“; die Lückenanzeige unter den Live-Daten ist eine Liste (`text-[11.5px] text-faint`, bei einer Lücke `text-warn` mit dem Wort „Lücke“ und der Zahl der fehlenden Einträge), jede Zeile eine Reihe.
- **Spracheingabe**: ein Pillen-Knopf „Diktieren“ unter dem Textfeld (`aria-pressed`, 32 px, bei grobem Zeiger 44 px), beim Zuhören „Beenden“ mit Stopp-Zeichen und einer `role="status"`-Zeile („Hört zu … „…““); Probleme (kein Mikrofon, kein Netz, nichts gehört) stehen als `text-warn`-Zeile, nicht als Dialog; der Datenschutzsatz („Die Sprache erkennt der Dienst deines Browsers … Die App nimmt nichts auf“) steht dauerhaft darunter in 11 px `text-faint`.


## Zusammenhang & Navigation (Feinschliff, Runde 8)

Keine neue Sprache, nur ruhigere Wege. **Befehlsnavigation:** die fünf Dock-Seiten groß (wie bisher die ersten vier), darunter die übrigen Seiten in vier kleinen Gruppen (Kapitälchen-Überschrift `font-mono text-[10.5px] text-faint`,
dasselbe Raster mit Symbol, Name, Zähler und Ziffer); die jüngsten Seiten tragen eine Pille „Neu“ (`rounded-full border-line-2`, `text-mute`, 9,5 px Mono), bis sie einmal offen waren – kein Farbakzent, keine Bewegung.
**„Siehe auch“** (`FeatureLinks`): eine Zeile aus Kapitälchen-Anker und unterstrichenen Textlinks mit Pfeil (`text-[12.5px] text-mute`), in Karten durch eine Haarlinie abgesetzt; Touch ≥ 44 px bei grobem Zeiger;
höchstens drei Links, nie auf der Startseite. **Einführung, Schritt „Mehr“:** eine Liste aus vier schlichten Kästen (Name, ein Satz) und ein einziger Knopf („Demo mit Beispieldaten“); nichts startet von selbst.
## Bewegung & Leistung global (Feinschliff)

Keine neue Sprache, sondern eine gemeinsame: dieselben Federn und Dauern aus `src/motion/tokens.ts` bei jedem Baustein, dazu Bausteine für lange Seiten. Details: `src/motion/README.md`, `src/primitives/README.md`.
- **Press-Skalierung nach Zielgröße** (`pressScale`): 24-px-Schalter .88, Icon-Knöpfe (Kopfzeile, Dock) .92, Buttons .96, Label im Segmented und Toast .97, Karten .985. Gleiche Art Element = gleiches Drücken (Feder `spring.press`).
- **Platz für spät ladende Karten** (`Reserve`, `ReserveFallback`, `ReserveSuspense`, `CardSkeleton`): die Endgröße der Karte steht ab dem ersten Bild (Mindesthöhe je Breakpoint, Platzhalter in Kartenform), nichts darunter rutscht. Die Höhen sind gemessene Pixel; ungefähr reicht.
- **Lange Seiten**: Zellen unterhalb des ersten Bildschirms als `Reveal defer` (Stil, Layout und Malen entfallen, solange die Zelle weit weg ist) und die Karten darin als `Later` (eigener kleiner Commit nach dem ersten Bild, nie beim Scrollen, sofort wenn sie näher als 500 px kommen). Der Seitenwechsel ist dann nicht mehr ein einziger langer Task.
- **Reveal** löst auch bei sehr hohen Karten aus (15 % der Karte ODER ein Fünftel des Bildschirms); vorher blieb eine Karte über ≈ 5 000 px auf dem Handy bei Deckkraft 0 (gemessen: Markt, 390 px).
- Reduzierte Bewegung: jede Seite zeigt alles sofort, keine Endlos-Animation (e2e `motion-global`).

## Feinschliff Runde 8 – Seiten A (Trades, Grundlagen, Einstellungen, Berichte, Konto, Preise, Wachstum, Community, Funktionen)

Stand: `happy-gates` (Feinschliff 1 und 4 gemergt). Alle neun Seiten dunkel und hell, 390 und 1280 px, mit Beispieldaten und leer durchgesehen
(Skripte im Scratchpad, ganzseitige Kacheln nach einem Durchlauf, damit Einblendungen gelaufen sind). Die Seiten waren schon aus einem Guss
(drei frühere Durchgänge) – geändert wurde, was ein kritischer Blick noch fand.

| Seite | Befund | Änderung |
|---|---|---|
| Trades | eigene Kopfzeile (28 px, nackte Zahl) neben der gemeinsamen der anderen Seiten; im leeren Journal eine Filterleiste über nichts und zwei Sätze, die dasselbe sagen („Klick auf … um loszulegen“ + „Bereit für den ersten Eintrag.“) | gemeinsame `PageHeader` mit Zahlen-Pille („13 Trades“); ohne Trades keine Filterleiste, ein Satz, CSV-Import / Backup als „Auch hier“; mit Trades Replay · Was wäre wenn · CSV-Import · Berichte |
| Grundlagen | – | geprüft, unverändert (Zeilen bündig, Texte ohne Befund) |
| Einstellungen | 9 000 – 16 000 px, 16 lose Karten, 16 Chips in der Leiste; Datenarchiv mit vier Absätzen Kleingedrucktem; Lead nannte nur „Startkapital, Chart-Level“; Karten mit leerer Nachbarhälfte | fünf Gruppen mit Titel + Satz (`SettingsGroup`), fünf Chips; Kleingedrucktes als `MoreInfo` (Archiv −441 px bei 390); Lead neu; Fehler-Tags links hoch, Grundregeln und Limits rechts gestapelt, Daten / Archiv / Speicher in voller Breite; Karten ab Chart-Level mit `Later` + Reserve-Boden, Archiv-Platzhalter in Kartenhöhe |
| Berichte | leere 5er-Spalte neben dem Wochenreview und ein „Experiment“-Chip, der nach 3 s verschwindet (vergangene Woche); Ziele ohne Weg weiter | `experimentVisible` – Review über die ganze Zeile; „Siehe auch“ Kennzahlen · Aufschlüsselung · Gebühren und Funding; „Plan im Coach“ / „Ziel anlegen“; acht Zellen `defer` + `Later`; Buch-Platzhalter mit Kopfhöhe |
| Konto | 142 px Sprung beim Laden der Sitzung (390 px: CLS 0,093), lange Seite ohne Leiste, Börsen-Fehler nur „Nicht gefunden.“ | `AuthCard`-Skeleton in der Form der Karte, Reserve-Böden (Sicherheit, Datenschutz, Daten, Tarif, Empfehlung), Leiste (Anmeldung · Sicherheit · Deine Daten · Tarif · Börse · API), „Siehe auch“ Preise, Fehler mit Grund |
| Preise | Raster `gap-6` statt `gap-5`, Lead „… mehr können soll als du“ | `gap-5`, Lead neu; „Siehe auch“ Konto · Einladen |
| Wachstum | zwei Karten wiederholen den Satz ihres Abschnitts („Prozessziele zuerst“, „Prozess, nicht Profit“) | Texte gekürzt; elf Zellen `defer` + `Later` |
| Community | Ergebnisbeleg („Deine Links“) und Chartfälle (in der Gruppe) nur zufällig zu finden; Ladezustand der Rangliste ein Viertel der Endgröße | Leiste (Du · Rangliste · Gruppen · Links und Belege · Feedback) + „Auch hier“ Ergebnisbeleg · Chartfälle · Reviews; Rangliste lädt als Podium + 7 Zeilen, „Wo du stehst“ als Platzhalter |
| Funktionen | – | geprüft, unverändert |
| alle | Textlinks in acht Handschriften (Hover ohne Übergang, Fokus uneinheitlich) | `textLink` (`src/lib/textLink.ts`): 200 ms Farbe, Unterstrich, Fokus wie Hover; die kleinen Aktionen (Challenge aufgeben, Gewohnheit archivieren) mit Übergang |

Messwerte (Chromium headless, Seite nach dem Laden, Cloud-Seiten angemeldet über neu geladene Sitzung; **CLS** = Layout-Verschiebung der 5 s nach der
Überschrift; **Höhen-Drift** = Seitenhöhe nach 5 s minus Seitenhöhe bei der Überschrift, also wie viel die Seite nachwächst):

| Seite | CLS 390 vorher → nachher | CLS 1280 | Drift 390 | Drift 1280 |
|---|---|---|---|---|
| Trades | 0 → 0 | 0 → 0 | 0 → 4 | 0 → 0 |
| Grundlagen | 0 → 0 | 0 → 0 | 0 → 0 | 21 → 0 |
| Einstellungen | 0 → 0 | 0 → 0 | 2 309 → 0 | 1 135 → 1 |
| Berichte | 0 → 0 | 0,0005 → 0 | 7 503 → 6 837 (Buchzeilen) | 2 903 → 2 497 |
| Wachstum | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Funktionen | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Konto | **0,093 → 0** | 0,007 → 0,004 | 553 → 4 | 357 → −7 |
| Preise | 0,003 → 0 | 0,004 → 0,001 | 0 → 0 | 0 → 0 |
| Community | 0,003 → 0,0003 | 0,004 → 0,001 | 981 → 3 049 (*) | 1 085 → 244 |

(*) Community 390: die Überschrift erscheint vor der Sitzung; der Platzhalter („Lade …“, 192 px) wächst, sobald sie da ist – derselbe Code wie vorher, der
Wert hängt am Zeitpunkt. Das Platzhalter-Layout der Community während der Sitzungsprüfung bleibt eine offene Entscheidung (ein angemeldeter Besucher
sähe sonst ein Gerüst, ein abgemeldeter ein Gerüst, das zur kurzen Werbeseite schrumpft).
