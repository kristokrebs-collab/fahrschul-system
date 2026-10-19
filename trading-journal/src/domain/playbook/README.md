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
