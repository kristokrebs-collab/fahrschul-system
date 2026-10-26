# `src/domain/whatif` – „Was wäre wenn“ (F33)

Ein gebuchter Trade, auf **seinen eigenen Kerzen** mit anderen Regeln nachgerechnet: anderer Stopp, Break-even, Teilziel,
anderes Ziel, Trailing, Weiterlaufen oder Zeit-Ausstieg. Rein (keine I/O); die Kerzen kommen aus dem MAE/MFE-Lader
(`src/market/excursion.ts` `loadBars`, budgetiert und im IndexedDB gemerkt). **Nichts ändert einen gespeicherten Trade.**

| Datei | Inhalt |
|---|---|
| `simulate.ts` | `simulateScenario(trade, bars, intervalMs, scenario)`, `runScenarios`, `BASELINE` („Nachrechnung mit deinen Regeln“), `PRESET_SCENARIOS`, `deltaR`, `recordedOutcome`, `whatIfBlocker` (deutscher Grund, warum ein Trade nicht gerechnet werden kann), `candleAt` |
| `draft.ts` | das Formular „Eigene Variante“ als Daten (`CustomDraft`) → `Scenario`; unbrauchbare Zahlen lassen den Teil weg und werden gemeldet (`draftNotes`) |
| `tradeInput.ts` | `whatIfTradeOf(trade)`: (Ø-)Einstieg aus den Fills, Menge (`qty` oder Nominal ÷ Einstieg), Ausstiegszeit |

## Engine – wiederverwendet, nicht nachgebaut

Das Szenario geht an `runBacktest` (`src/domain/backtest/engine.ts`, F65): Stopp in Kraft → Teilziel → Ziel → Zeit-Stopp,
Management (Break-even / Trailing / Teilziel) an Kerzenschlüssen, wirksam ab der **nächsten** Kerze, der Stopp wird nur
nachgezogen. Kosten sind null (Gebühren, Slippage, Funding) – Beträge stehen **vor Gebühren**, der Ist-Wert des Journals nach Gebühren
(beides steht daneben, mit der Kursbewegung ohne Gebühren).

## Annahmen (alle in der UI sichtbar)

- **Reihenfolge innerhalb einer Kerze:** liegen Stopp und ein Ziel in derselben Kerze, gewinnt der Stopp (die schlechtere
  Annahme); `ambiguous` markiert den Fall, die Zeile sagt es. Ein Stopp, der erst am Schluss der Kerze festgelegt wird, kann in
  derselben Kerze nicht mehr füllen.
- Einstiegs- und Ausstiegskerze zählen **vollständig** (der Weg in der Kerze ist unbekannt): ein enger Stopp kann durch ein Tief
  vor dem tatsächlichen Einstieg als ausgelöst gelten. Dieselbe Näherung wie bei MAE/MFE.
- Einstieg zum **gebuchten** Kurs (die Einstiegskerze öffnet dort), gleiche Positionsgröße in jeder Variante.
- „Bis zum Ist-Ausstieg“: was dann noch offen ist, schließt zum gebuchten Ausstiegskurs. „Weiterlaufen“ läuft bis zum Ende der
  geladenen Kerzen (Ausstieg + 12–60 Kerzen, nie in die Zukunft).
- **R-Vielfache** von Break-even / Teilziel / Ziel / Trailing beziehen sich auf den Stopp-Abstand der **Variante**; das Ergebnis steht immer
  in R des **ursprünglichen** Stopps, damit die Zeilen vergleichbar sind. Betrag = Ergebnis je Einheit × gebuchte Menge.
- Ein Trade ohne Stopp, ohne Ausstiegszeit/-preis oder noch offen wird nicht gerechnet (`whatIfBlocker`).

## Rückschaufehler

Die Sicht „Was wäre wenn“ sagt es ausdrücklich: die Alternativen sind im Nachhinein gewählt, ein einzelner Fall ist keine
Empfehlung; geprüft wird eine Regel über viele Trades (Labor). Deshalb steht „Stichprobe: 1 Trade“ im Kopf und es gibt kein
„bestes Szenario“-Etikett.

Tests: `tests/unit/domain.whatif.test.ts` (Kerzen von Hand gebaut), E2E `tests/e2e/training.spec.ts`.
