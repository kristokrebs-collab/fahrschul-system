# `src/domain/demo` – Rechenseite der Demo mit Beispieldaten (F58)

Reine Domain-Logik (kein React, kein I/O, kein Zufall, keine Uhr). Die Demo (`src/views/demo`) zeigt die Kernschritte der App mit **erfundenen,
deutlich markierten Beispieldaten** und rechnet dafür mit den **echten Funktionen der App** – damit sie ehrlich zeigt, was die App kann:

| Datei | Schritt | echte Funktion darunter |
|---|---|---|
| `candles.ts` | – | 6 000 Stunden-Kerzen aus Sinus-Wellen (Trend, drei Wellen, schwankende Höhe), 2h / 4h / 1D als vollständige Fenster (`aggregateBars`); auf drei Nachkommastellen gerundet, dieselben Zahlen auf jedem Gerät. **Keine echten Kurse, kein Datum, keine Uhrzeit.** |
| `csv.ts` | 1 Import | `parseCsv` → `detectFormat` → `format.parse` → `toJournalTrade` (`@/exchanges/csv/parse`, `formats`, `model` – bewusst nicht `csv/index.ts`, das den Speicher einbindet). Die Beispieldatei (Kürzel `DEMOUSDT`) ist erfunden. |
| `ideas.ts` | 2 Regelentwurf | in Worten: `parseStrategyText` (der lokale Übersetzer des Strategie-Studios); Baukasten: derselbe Regelbaum wie im Labor (`newGroup`, `defaultParams`, `mirrorGroup`, `sanitizeCustom`); Klartext: `summarizeCustom`. |
| `backtest.ts` | 3 Test | `customStrategy.prepare/build/funnel` → `runBacktest` → `runStats` mit festen, genannten Annahmen (Demo-Konto 10 000, 1 % Risiko, Gebühren und Slippage wie im Labor, kein Funding); `meaningLines` schreibt mit den Zahlen des Laufs, was sie bedeuten und was nicht. |
| `paper.ts` | 4 Demokonto | `runBacktest` mit `keepOpen` auf der bis zur aufgedeckten Kerze abgeschnittenen Reihe (kein Blick nach vorn): Einstieg zur nächsten Eröffnung, Stop vor Ziel, Gebühren und Slippage. |
| `alarm.ts` | 5 Alarm | `evaluateLevel` → `observe` → `stepStages` → `stageMessage` der Schlüsselmarken, Kerze für Kerze; die Marke lebt nur in der Rückgabe. |

## Isolation (hart)

Die Demo schreibt **nie** in das Journal, in `settings.*`, in den Browser-Speicher oder in die Cloud und sendet nichts. Ihr Zustand ist eine Sitzung im
Speicher (`src/views/demo/session.ts`), die beim Öffnen und beim Schließen geleert wird. `tests/unit/demo.domain.test.ts` liest die Quellen von
`src/domain/demo` und `src/views/demo` und schlägt fehl, wenn eine Datei Journal-Speicher, Browser-Speicher, Cloud, Netz oder Schreib-Aufrufe
des Journals anfasst – oder (Rechenseite) `Math.random`, `Date.now`, `new Date()`.

## Grenzen

Die Kerzen sagen nichts über einen Markt; die Demo rechnet auf 1h, 2h, 4h und 1D (eine Idee auf einer anderen Zeiteinheit läuft auf 1h, mit Hinweis);
eine Regel, die mehr Aufwärmzeit braucht, als die Kerzen hergeben (z. B. EMA 200 auf 1D), sagt das, statt still null Trades zu zeigen.

## Tests

`tests/unit/demo.domain.test.ts` (deterministische Kerzen, Parser, Übersetzer, Baukasten-Kombinationen, Engine gegen den Hand-Rechenweg, Demokonto, Alarm,
Isolation), `tests/unit/views.demo.test.tsx` (Blatt, Karten, Ablauf, nichts geschrieben), e2e `tests/e2e/demo.spec.ts` und `a11y-demo.spec.ts`.
