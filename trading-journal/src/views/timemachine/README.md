# `src/views/timemachine` – Zeitmaschine (UI)

Die Karte zur Domain `@/domain/timemachine` (README dort). Sie nimmt einen Plan und die geschlossenen Kerzen des Markts und zeigt, was 10 000 neu gemischte Sitzungen und jeder frühere Vorfall dazu sagen.
Rechnet in einem Web Worker (Fortschritt, Abbruch, Rückfall ohne Worker in Scheiben); sendet **nie** eine Order und ändert **nie** den Plan.

| Datei | Inhalt |
|---|---|
| `types.ts` | **`TimeMachineProps`** `{ symbol, side, entry, stop, target, candles, interval, costs?, seed?, onClose? }` + additiv `options?`, `startMs?`, `source?`, `fetchedAt?`, `autoStart?`, `note?`, `framed?`, `className?` – daran bindet der Handelsplan (`src/views/plan/Slots.tsx`, Slot `TimeMachineSlot`) an |
| `TimeMachineCard.tsx` | die Karte (Standardexport, `lazy(() => import("@/views/timemachine/TimeMachineCard"))`), `data-testid="tm-card"` mit `data-status` (`idle` · `running` · `done` · `cancelled` · `error` · `invalid`) |
| `useTimeMachine.ts` | startet den Lauf aus den Props (Worker, Fortschritt, Abbruch); ein geänderter Plan bricht ab und startet mit `autoStart` nach 250 ms neu, ohne markiert er das Ergebnis als veraltet |
| `model.ts` | Props → Domain-Eingabe (`inputOf`, Gründe statt Absturz), `runKey`, `barsOf` |
| `FanChart.tsx`, `Histogram.tsx`, `geometry.ts` | die beiden Bilder (SVG) und ihre reine Geometrie |
| `HistoryList.tsx`, `parts.tsx`, `strings.ts` | Liste der Vorfälle, Kacheln / Anteilsbalken / Messung der Breite, deutsche Texte |
| `LaborSection.tsx`, `formModel.ts` | Labor-Abschnitt „Zeitmaschine“ (ganz unten): Plan per Hand, Kerzen laden (Lader des Labors, Cache zuerst), die Karte darunter; das Formular merkt sich der Browser (`storageKey("timemachine")`, versioniert, Komfort) |
| `TradeSheet.tsx`, `sheetStore.ts`, `tradePlan.ts` | Blatt „Zeitmaschine für diesen Trade“ am Trade-Detail (Knopf neben „Was wäre wenn“, gleiche Sperre `replay`): Plan aus dem Trade, **nur Kerzen vor dem Einstieg**, daneben „Was wirklich passiert ist“ |
| `lastResult.ts` | der letzte fertige Lauf, nur im Speicher – der Assistent zitiert ihn (Werkzeug `timemachine`), er rechnet nichts |

## Was die Karte zeigt

Urteil (Panel, eine Zeile + Zusatzzeilen) · **Wer kommt zuerst?** (Ziel / Stop / weder noch mit 95 %-Spanne, Anteilsbalken ausgefüllt / schraffiert / gepunktet) · **Erwartungswert** nach Kosten mit Spanne und Kosten in R ·
**Fächer** (Bänder 90 / 50 %, Median, Einzelpfade mit Endmarken ● Ziel · ✕ Stop · ◇ nachgezogen, Stopp-Linie gestrichelt, Ziel-Linie durchgezogen, Beschriftung auf den Linien, Ablesen per Zeiger / Tastatur, Zahlen in einer Tabelle) ·
**Histogramm** (Spalten links von 0 schraffiert, Achse mit Stop und Ziel, Anteile als Text, Zahlen in einer Tabelle) · **schlechtester / mittlerer / bester Fall** · **Zeit bis zum Ausgang** und größte Gegenbewegung · **Echte Vorfälle**
(Liste, Zahl, Intervall – erst ab 10 Prozentwerte, ab 20 Vergleich) · **Vergleich mit Warnhinweis** · **Hinweise** (dünne Datenbasis, Schwankung, Trend, gleiche Kerze) · **Annahmen** · Quelle + Stand (`SourceStand`) und der Satz „Keine professionelle Finanzberatung.“ (`AnalysisNote`).

Zustände: ungültiger Plan (Grund) · wartet auf den Knopf (ohne `autoStart`) · rechnet (`tm-busy`, `role="progressbar"`, Phase, Prozent, „Abbrechen“) · fertig · abgebrochen · Fehler mit Grund (nie als Netzwerkfehler getarnt) · veraltet.

Bewegung nur über `src/motion`-Tokens (transform / opacity / clip-path): der Fächer wischt einmal von links ein (`tween.draw`), die Histogramm-Spalten wachsen von der Grundlinie (`spring.enter`), der Fortschrittsbalken federt (`spring.smooth`); reduzierte Bewegung zeigt sofort den Endzustand.
Touch-Ziele ≥ 44 px bei grobem Zeiger, kein Seitwärtsscrollen bei 390 px (die Tabellen der Vorfälle haben drei Spalten, der Vergleich ist eine Liste).

Tests: `tests/unit/views.timemachine.test.tsx` (Modell, Geometrie, Trade → Plan mit Gründen, Formular, Karte in allen Zuständen), `tests/e2e/timemachine.spec.ts` (Labor und Trade-Detail, mobil + Desktop).
