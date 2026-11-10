# `src/domain/playbook` – Strategie-/Playbook-Austausch (F13 / F45)

Pure TypeScript. A rule draft as a small, versioned JSON text; no server, no marketplace, no code execution.

```ts
playbookText(config, { title, description, author, symbol })  // -> JSON text for a file / the clipboard
readPlaybook(text)  // -> { ok: true, playbook, warnings } | { ok: false, errors }   never throws
```

Format `tj-playbook` version 1: `{ format, version, title, description?, author?, symbol?, idea: <CustomConfig version 1>, key }` – the rule tree
with stop / target / management, a checksum (`customKey`), nothing from the journal (no trades, notes, accounts, amounts).

## What the import refuses (each with its reason, in German)
too large (`MAX_PLAYBOOK_CHARS`; the UI checks `MAX_PLAYBOOK_BYTES` of a file before reading it) · not JSON · not an object · wrong `format` · missing /
newer `version` · forbidden keys at ANY depth (`__proto__`, `constructor`, `prototype`) · too many nodes / too deep / too long strings or lists /
non-finite numbers (an iterative scan with hard limits, no recursion) · **unknown building blocks (named; they block the import instead of falling
away silently)**, unknown timeframes, group operators, node types, stop / target kinds, execution intervals · wrong value types · a tree beyond the
app's limits (depth, children, leaves per side) · rules the lab cannot run (`validateCustom` errors, e.g. no condition).
Warnings (import allowed): values outside the allowed range are clamped and listed, a checksum that no longer matches (changed after the export),
unknown top-level fields (ignored), texts that were shortened, the lab's own warnings. The result is rebuilt field by field (`sanitizeCustom`), text
fields are cleaned of control characters and bounded; foreign text in a message is reduced to a safe, bounded name.

Tests: `tests/unit/lab.playbook.test.ts` (round trip incl. every template, refusals, prototype pollution, huge / deep input, clamps).

## Fassungen und Checkliste (F45, `update.ts`)
Format `tj-playbook` bleibt Version 1; vier **optionale** Wurzelfelder kamen dazu (ältere Dateien bleiben gültig, ältere App-Versionen warnen nur „unbekanntes Feld“):
`id` (`pb-…`, stabil über alle Fassungen), `rev` (1 … 9999), `changes` (≤ 300 Zeichen, was neu ist) und `checklist` (≤ 12 Punkte zu ≤ 100 Zeichen, von Hand zu prüfen – keine Regeln, die das Labor rechnet; als Text gelesen, nie als Markup). `id` und `rev` gelten nur zusammen; ein kaputter Wert wird mit Warnung verworfen, nie abgelehnt.
- `newPlaybookId(random)` / `nextRevision(letzterExport, schlüssel)`: die erste Fassung ist 1, gleiche Regeln behalten die Nummer, geänderte Regeln zählen eine hoch. Nur **eigene** Entwürfe bekommen Kennung und Fassung (der Entwurf merkt sich den letzten Export in `exported`); fremde Entwürfe und der Editor-Stand exportieren einmalig.
- `playbookRelation(link, regelnDesEntwurfs, datei)`: `none` / `other` (anderes Playbook) / `newer` / `same` / `same-rev-changed` (gleiche Nummer, andere Regeln) / `older`; mit dem Unterschied in Klartext (`diffConfigs`, der Name des Entwurfs gehört dem Leser) und `localEdits` (der Entwurf weicht von dem ab, was übernommen wurde). **Nichts wird von selbst übernommen**; ein Update ist eine neue Datei, die man selbst einliest – es gibt kein Abo und keinen Abruf.
- `setupFromPlaybook(pb, vorhandene, farbe, id)`: die Checkliste wird die einer Entscheidungsgrundlage (Journal), die Regeln in Worten die Einstiegs- und Ausstiegskriterien, der Ursprung („Aus einem Playbook von … (Fassung n) – fremde Regeln, nicht von dir geprüft“) steht in der Beschreibung. Tests: `tests/unit/lab.playbook.update.test.ts`.

