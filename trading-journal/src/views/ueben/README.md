# `src/views/ueben` – Üben / Lernmodus (F38)

Ein Sheet (eigener Lazy-Chunk, `TrainingHost`; `DeferredHosts` lädt ihn erst beim ersten `openTraining`). Eintritt: Trade-Detail („Üben“), Replay-Sheet
(„Ähnliches üben“), Assistent („Ich will üben“ – öffnet nur). Fachlogik und Speicherformat: `src/domain/training/README.md`.

| Datei | Rolle |
|---|---|
| `trainingStore.ts` | winziger Öffnen-Store (`openTraining`, `closeTraining`, `dirty` für den Schließen-Schutz) – so klein, dass Detail, Replay und Assistent ihn ohne den Chunk importieren |
| `TrainingHost.tsx` | Sheet; Start (Setup wählen, Markt/Datum verdecken, Verlauf), Sitzung (≤ 6 Fälle), Rundenzusammenfassung |
| `CaseView.tsx` | ein Fall: eingefrorener Chart → Einordnen / Entscheiden / Regeln abhaken / Begründen → speichern → Aufdecken (`ScrubTimeline`) → Marken, „Damals im Journal“, „Dein Plan auf den echten Kerzen“, Reflexion |
| `HistoryCard.tsx` | Verlauf: drei Zählungen mit Stichprobe, Streifen der letzten Runden |
| `actions.ts` | Schreiben in `settings.training` (Reihenfolge: erst speichern, dann aufdecken) |

Der Chart ist `ReplayChart` (lazy). Wie beim eingefrorenen Bild des Bias-Tests (`clipAtAnchor`-Prinzip) bekommt er nur, was vor dem Einstieg geschlossen hat
(`decisionAt` / `visibleBars`); vor dem Aufdecken ist `showTrade` aus, nur die zusätzliche Linie „Dein Stopp“ (`lines`) erscheint. Die Kerzen laden über
`useCandles` (derselbe budgetierte Lader wie MAE/MFE): übbar sind nur Trades auf dem Paar des Live-Markts, jeder andere Fall hat eine ehrliche Meldung.

Bewegung: nur die vorhandenen Tokens (Sheet, `StaggerItem`, `tween.fade`); der Aufdeck-Lauf ist die `ScrubTimeline` (play / scrub / Tasten), unter reduzierter Bewegung steht das Ende sofort da.
Schließen mit ungespeicherter Eingabe fragt zuerst („Änderungen verwerfen?“), sonst nicht.
