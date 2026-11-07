# `src/views/timemachine` – Zeitmaschine (UI)

Die Karte zur Domain `@/domain/timemachine` (README dort). Sie nimmt einen Plan und die geschlossenen Kerzen des Markts und zeigt, was 10 000 neu gemischte Sitzungen und jeder frühere Vorfall dazu sagen.
Rechnet in einem Web Worker (Fortschritt, Abbruch, Rückfall ohne Worker in Scheiben); sendet **nie** eine Order und ändert **nie** den Plan.

| Datei | Inhalt |
|---|---|
| `types.ts` | **`TimeMachineProps`** `{ symbol, side, entry, stop, target, candles, interval, costs?, seed?, onClose? }` + additiv `options?`, `startMs?`, `source?`, `fetchedAt?`, `autoStart?`, `note?`, `framed?`, `market?`, `className?` – daran bindet der Handelsplan (`src/views/plan/Slots.tsx`, Slot `TimeMachineSlot`) an; `market: "stocks"` lässt jedes Wort über Funding weg |
| `historySources.ts` | **Marktneutrale Historienquelle** des Handelsplan-Slots: `historySourceOf(market)` → `{ choices, until, announce, load, setup }`. Krypto: der Lader des Labors (Binance, Cache zuerst), unverändert. Aktien: der Aktien-Datenvertrag, **Stunden-Kerzen** (bis zu 2 Jahre) oder **Tages-Kerzen** (bis zu 5 Jahre) von Yahoo Finance; nur geschlossene Kerzen (`stockCloseOf`: nie später als der Schluss der Sitzung), bei einem vergangenen Plan nur solche, die vor dem Einstieg schlossen (`until`), `MIN_POOL_BARS` mit Grund; `setup` liefert Zeitstopp (Stunden: bis „Flat by“, mindestens 2 Kerzen; Tage: 5 Handelstage), Startzeit (die Stunde des Einstiegs auf dem Raster 9:30, 10:30 …) und den Satz zu Lücken über Nacht / Wochenende; ein alter Stand aus dem Zwischenspeicher wird benannt. |
| `TimeMachineCard.tsx` | die Karte (Standardexport, `lazy(() => import("@/views/timemachine/TimeMachineCard"))`), `data-testid="tm-card"` mit `data-status` (`idle` · `running` · `done` · `cancelled` · `error` · `invalid`) |
| `useTimeMachine.ts` | startet den Lauf aus den Props (Worker, Fortschritt, Abbruch); ein geänderter Plan bricht ab und startet mit `autoStart` nach 250 ms neu, ohne markiert er das Ergebnis als veraltet |
| `model.ts` | Props → Domain-Eingabe (`inputOf`, Gründe statt Absturz), `runKey`, `barsOf` |
| `FanChart.tsx`, `Histogram.tsx`, `geometry.ts` | die beiden Bilder (SVG) und ihre reine Geometrie |
| `HistoryList.tsx`, `parts.tsx`, `strings.ts` | Liste der Vorfälle, Kacheln / Anteilsbalken / Messung der Breite, deutsche Texte |
| `LaborSection.tsx`, `formModel.ts` | Labor-Abschnitt „Zeitmaschine“ (ganz unten): Plan per Hand, Kerzen laden (Lader des Labors, Cache zuerst), die Karte darunter; das Formular merkt sich der Browser (`storageKey("timemachine")`, versioniert, Komfort) |
| `TradeSheet.tsx`, `sheetStore.ts`, `tradePlan.ts` | Blatt „Zeitmaschine für diesen Trade“ am Trade-Detail (Knopf neben „Was wäre wenn“, gleiche Sperre `replay`): Plan aus dem Trade, **nur Kerzen vor dem Einstieg**, daneben „Was wirklich passiert ist“ |
| `simStore.ts`, `simulations.ts`, `simCloud.ts` | **A3** Ablage der gespeicherten Simulationen: IndexedDB (`<Präfix>timemachine` / `simulations`, Schlüssel = `simulationId`; ohne IndexedDB im Speicher, `persistent: false` – die Karte sagt es), freie Simulationen bis `KEEP_FREE` = 100 (die ältesten gehen zuerst), die eines Trades bleiben; **Wolke nur eingeloggt** (`canSyncSimulations`: angemeldet, 2FA erledigt, Abgleich an, Tarif erlaubt) über die Tabelle `simulations` (Migration `0011`, RLS nur eigene Zeilen): nur Zahlen und Hashes, `sync` = `local` · `pending` · `synced`, ein Fehler lässt `pending` stehen, `flush()` holt nach, `pull()` holt Kennzahlen anderer Geräte. Das vorhandene Sync-Muster (`journal_docs`, Outbox, Drei-Wege) passt nicht zu einer eigenen Tabelle – darum eigener kleiner Adapter, kein Eingriff in die Engine |
| `PathsCanvas.tsx`, `pathPaint.ts`, `paintEngine.ts`, `paths.worker.ts` | **A3** „Alle Pfade (Alpha)“: jeder simulierte Lauf als blasse Linie auf einem Canvas; `pathPaint.ts` (rein: Stichprobe `sampleOf`, Durchsichtigkeit `alphaFor`, `PathPainter` mit `step(deadline)` in Zeitscheiben, `runPaint`, `weakDevice`), `paintEngine.ts` (Worker mit `OffscreenCanvas`, sonst die Seite in Scheiben), `paths.worker.ts` (inline); SVG-Schicht darüber für Achsen, Stop-/Zielllinie, Median |
| `TradeSimulationBlock.tsx` | **A3** „Gespeicherte Zeitmaschine“ am Trade (Lazy, im Trade-Detail ganz unten) und im Papier-Portfolio: ID, Zeit, Urteil, Ziel / Stop / Ø R, Seed, Modell, Läufe, Daten-Stand, Ablage – aus IndexedDB, auch nach einem Neustart |
| `lastResult.ts` | der letzte fertige Lauf, nur im Speicher – der Assistent zitiert ihn (Werkzeug `timemachine`), er rechnet nichts |

## Speichern und „Alle Pfade“ (A3)

- **Speichern.** Jeder fertige Lauf wird als Datensatz gesichert (`useTimeMachine`): ID, Seed, Modellversion, Hash der Kerzen, Kosten, Größe, Kennzahlen, `tradeId` (Prop). Der Block „Diese Simulation“ in der Karte zeigt es samt Ablage. **Vor** einem Lauf fragt die Karte den Speicher nach derselben Simulation (gleiche ID): ein Treffer erscheint sofort, ohne Rechnung („Gespeicherte Simulation geladen – nichts neu gerechnet“); „Neu rechnen“ rechnet immer und sagt, ob dieselben Zahlen herauskamen. Am Trade (`TradeSimulationBlock`) steht die Simulation nach Reload / Neustart ohne Netz.
- **Alle Pfade.** Im Fächer wechselt „Bänder | Alle Pfade (Alpha)“ zu einer Canvas-Ansicht mit allen berechneten Läufen. Titel: „berechnet: 10.000 · gezeichnet: N“, dazu „alle berechneten Läufe“ oder „jeder 5. Lauf“. Auf schwachen Geräten (grober Zeiger, ≤ 4 Kerne, ≤ 4 GB) ist die **Stichprobe** (2 000, jeder 5.) die Voreinstellung und beschriftet; „Alle 10.000“ zeichnet alles, nur langsamer; die Wahl merkt sich der Browser. Gezeichnet wird im Worker auf einem `OffscreenCanvas`, sonst auf der Seite in Scheiben von 8 ms; 16 Pfade teilen sich einen Strich-Aufruf (10 000 Pfade = 625 Aufrufe), der Stapel schrumpft auf einem langsamen Gerät. Eine gespeicherte Simulation hat keine Pfade: sie werden mit demselben Seed nachgerechnet und die Zahlen mit den gespeicherten verglichen.
- **Messung (Chromium, CPU-Drosselung ×4 per CDP `Emulation.setCPUThrottlingRate`, `tests/e2e/timemachine-perf.spec.ts`)** – siehe unten.

## Was die Karte zeigt

Urteil (Panel, eine Zeile + Zusatzzeilen) · **Wer kommt zuerst?** (Ziel / Stop / weder noch mit 95 %-Spanne, Anteilsbalken ausgefüllt / schraffiert / gepunktet) · **Erwartungswert** nach Kosten mit Spanne und Kosten in R ·
**Fächer** (Bänder 90 / 50 %, Median, Einzelpfade mit Endmarken ● Ziel · ✕ Stop · ◇ nachgezogen, Stopp-Linie gestrichelt, Ziel-Linie durchgezogen, Beschriftung auf den Linien, Ablesen per Zeiger / Tastatur, Zahlen in einer Tabelle) ·
**Histogramm** (Spalten links von 0 schraffiert, Achse mit Stop und Ziel, Anteile als Text, Zahlen in einer Tabelle) · **schlechtester / mittlerer / bester Fall** · **Zeit bis zum Ausgang** und größte Gegenbewegung · **Echte Vorfälle**
(Liste, Zahl, Intervall – erst ab 10 Prozentwerte, ab 20 Vergleich) · **Vergleich mit Warnhinweis** · **Hinweise** (dünne Datenbasis, Schwankung, Trend, gleiche Kerze) · **Annahmen** · Quelle + Stand (`SourceStand`) und der Satz „Keine professionelle Finanzberatung.“ (`AnalysisNote`).

Zustände: ungültiger Plan (Grund) · wartet auf den Knopf (ohne `autoStart`) · rechnet (`tm-busy`, `role="progressbar"`, Phase, Prozent, „Abbrechen“) · fertig · abgebrochen · Fehler mit Grund (nie als Netzwerkfehler getarnt) · veraltet.

Bewegung nur über `src/motion`-Tokens (transform / opacity / clip-path): der Fächer wischt einmal von links ein (`tween.draw`), die Histogramm-Spalten wachsen von der Grundlinie (`spring.enter`), der Fortschrittsbalken federt (`spring.smooth`); reduzierte Bewegung zeigt sofort den Endzustand.
Touch-Ziele ≥ 44 px bei grobem Zeiger, kein Seitwärtsscrollen bei 390 px (die Tabellen der Vorfälle haben drei Spalten, der Vergleich ist eine Liste).

Tests (A3): `views.timemachine.paths.test.ts` (Stichprobe, Durchsichtigkeit, gebündelte Aufrufe, Zeitscheiben mit falscher Uhr, wo ein Pfad endet), `views.timemachine.persist.test.tsx` (Karte: speichern, Neustart, „Neu rechnen“, Alle Pfade, Stichprobe, Trade-Block), e2e `timemachine-persist.spec.ts` und `timemachine-perf.spec.ts`. Tests: `tests/unit/views.timemachine.stocks.test.tsx` (Aktien-Worte ohne Funding), `tests/unit/timemachine.stocks.test.ts` (Stunden- und Tageskerzen einer Aktie durch die echte Rechnung), `tests/unit/views.timemachine.test.tsx` (Modell, Geometrie, Trade → Plan mit Gründen, Formular, Karte in allen Zuständen), `tests/e2e/timemachine.spec.ts` (Labor und Trade-Detail, mobil + Desktop).

## Messung der Bildzeit „alle 10 000 Pfade“ (A3)

`tests/e2e/timemachine-perf.spec.ts` (Chromium, Desktop-Projekt): Plan durchgespielt, „Alle Pfade (Alpha)“ gewählt, dabei die CPU per CDP (`Emulation.setCPUThrottlingRate`) auf ×1 und ×4 gebremst; einmal mit dem Worker auf einem `OffscreenCanvas`, einmal mit der Seite in Scheiben (`OffscreenCanvas` entfernt). Gemessen wird die Zeichenzeit, die längste Scheibe (vom Maler selbst, Wanduhr), Long Tasks (`PerformanceObserver`) und die Bildabstände (`requestAnimationFrame`) – dazu ein Grundrauschen: 1,5 s derselben ruhenden Seite bei gleicher CPU-Rate.

**Wichtig – wie belastbar das ist:** gemessen auf einer geteilten Maschine mit Last ≈ 18–35 auf 4 Kernen (sechs Agenten gleichzeitig), nicht auf einem ruhigen Messplatz und nicht auf einem echten Gerät. Die Zahlen schwanken von Lauf zu Lauf stark (siehe Spanne); sie belegen die Größenordnung, keine Garantie.

| Variante | gezeichnet | Zeichenzeit | längste Scheibe | Strich-Aufrufe | Long Tasks im Fenster (Anzahl, längster) | größter Bildabstand |
|---|---|---|---|---|---|---|
| Worker, CPU ×1 | 10 000 | 38 ms | 23 ms | 627 | 4, 668 ms | 433 ms |
| Worker, CPU ×4 | 10 000 | 27 ms | 9 ms | 630 | 7, 402 ms | 433 ms |
| Seite in Scheiben, ×1 | 10 000 | 648 ms | 8,6 ms | 626 | 3, 357 ms | 600 ms |
| Seite in Scheiben, ×4 | 10 000 | 0,8–3,7 s (drei Läufe) | 8,0–8,4 ms | 625 | 6–10, 543–2 502 ms | 1 000–2 600 ms |

Was daraus folgt, ehrlich:
- **Der Maler hält sein Versprechen:** jede Scheibe dauert (Wanduhr) etwa so lang wie ihr Budget, 8–9 ms – auch bei ×4 und auch auf dieser Maschine (einmal 23 ms beim ersten Stück). 10 000 Pfade sind 625 Strich-Aufrufe (16 Pfade je Aufruf); der Stapel schrumpft bis auf einen Pfad, wenn die Zeit nicht reicht. Im Worker braucht das Bild 27–38 ms und die Seite zeichnet nichts.
- **Das heißt nicht „kein Long Task“:** im Fenster nach dem Klick gab es Long Tasks (51–2 500 ms) – **auch in der Worker-Variante, in der die Seite nichts zeichnet**, und in der ruhenden Vergleichsseite nur selten. Sie kommen also vom Umschalten (Einhängen der Ansicht, Layout der langen Seite) und von der Last der Maschine, nicht vom Zeichnen; getrennt nachgewiesen habe ich das nicht. „Kein Long Task > 50 ms“ für das Umschalten selbst ist damit **nicht belegt** – es braucht eine ruhige Maschine (offen).
- Weicht ein Browser aus (kein `OffscreenCanvas`, kein Worker), zeichnet die Seite in Scheiben; bei ×4 dauert das Bild dann Sekunden, die Seite bleibt bedienbar, das Bild baut sich sichtbar auf.
