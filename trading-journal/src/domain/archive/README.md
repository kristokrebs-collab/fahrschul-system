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
