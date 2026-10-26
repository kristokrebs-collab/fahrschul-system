# `src/domain/archive` – Historisches Datenarchiv (F26), der reine Teil

Pure TypeScript, kein React, kein I/O. Der Speicher, der Sammler und die Ansicht stehen in `@/market/archive` und
`@/views/settings/ArchiveCard`; die Beschreibung des Ganzen steht in `src/market/README.md` (Abschnitt „Datenarchiv“).

| Datei | Inhalt |
|---|---|
| `types.ts` | `ArchivePoint` (`series`, `symbol`, `t`, `d`), `TickRecord` (das Protokoll, das Lücken erklärt), `SeriesInfo`, `ArchiveCfg`, `Gap`, `GapCause` |
| `series.ts` | die neun Reihen als eine Tabelle: Name, Quelle, Felder mit Einheit, erwarteter Abstand, Ringpuffer-Größe, geschätzte Bytes (`SERIES`) |
| `config.ts` | `parseArchiveCfg` (lenient, **Standard aus**; `on` nur bei genau `true`), `withArchiveCfg`, `effectiveSymbols` (Auswahl oder Markt-Symbol + Watchlist, höchstens 8), `ringCap` (gleicher Anteil am Größenlimit je Reihe) |
| `gaps.ts` | `findGaps` (Abstand > 2,5 × erwarteter Takt), `explainGap` (kein Abruf → App zu; Abruf gescheitert → Grund; Symbol nicht gewählt; Auswertung lag nicht vor; sonst „unbekannt“) |
| `export.ts` | `pointsToCsv` (Komma, Dezimalpunkt, UTC-ISO + Epoch), `archiveToJson` (Punkte + Lücken + ehrlicher Hinweis), Dateinamen |

Regeln: nichts wird geschätzt, nichts aufgefüllt; ein Abschnitt ohne Punkt ist eine Lücke. Der Schalter liegt NICHT in
`settings` (Gerätesache, nicht in Backup und Cloud-Sync). Tests: `archive.domain.test.ts` (Handrechnung).

## Börsenhistorie nachladen (`backfill.ts`, F26/F07)

Der reine Teil der ausdrücklichen Aktion „Börsenhistorie nachladen“ (Einstellungen › Datenarchiv). `backfillRange` (ganze 5-Minuten-Schritte, nie
älter als die rund 30 Tage der Börse minus 6 h Rand), `cutWindows` / `windowsOf` (jedes Fenster hält höchstens `limit` Schritte, damit die
Reihenfolge der Antwort keine Rolle spielt), `planBackfill` (Abrufe, Einträge, ≈ Größe, Dauer für den Satz vor dem Klick), die Abbildung der
Antworten auf Archivpunkte (`fundingHistPoints`, `markHistPoints`, `oiHistPoints`, `ratioHistPoints`; nicht endliche Werte fallen weg) und das
Protokoll der Läufe (`BackfillRun`, zehn Stück). Was ankommt, ist eine **eigene Reihe** (`fundingHist`, `markHist`, `oiHist`, `lsAccHist`,
`lsTopPosHist`, `lsTopAccHist`; Art `backfill`): außerhalb des Ringpuffers, nicht in der Größenschätzung des Sammlers, nie mit Gesammeltem
verrechnet oder geglättet; ein nicht beantwortetes Fenster bleibt eine Lücke. Die Netzseite steht in `src/market/archive/backfill.ts` (ein
Abruf zugleich, Pause dazwischen, Abbruch, ein 429 beendet den Lauf). Tests: `archive.backfill.domain.test.ts` (Handrechnung),
`archive.backfill.run.test.ts` (gemockte Börse, `fake-indexeddb`), `views.settings.backfill.test.tsx`, e2e `backfill.spec.ts`. Nicht live gegen die
Futures-Endpunkte geprüft (aus dem Sandbox-Netz antwortet Binance mit 451).
