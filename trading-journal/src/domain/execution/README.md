# `src/domain/execution` – Ausführbarkeit (F44), der reine Teil

Eine Planungsgröße gegen **einen** Orderbuch-Schnappschuss. Kein React, kein I/O, deterministisch.

| Datei | Inhalt |
| --- | --- |
| `book.ts` | `bookOf` (sortiert, verwirft ungültige Stufen), `touchOf` (bester Kauf-/Verkaufskurs, Mitte, Spread in bp), `bandOf` (Menge und Wert in einem Band von ±x % um die Mitte), `walk` / `marketImpact` (Durchlauf einer Menge durch die Stufen: Durchschnittspreis, Abstand zur Mitte in bp, `complete` = das Buch hat gereicht) |
| `check.ts` | `checkExecution`: Spread-Wort (`spreadWord`: eng ≤ 2 bp, normal ≤ 10, weit ≤ 30, sonst sehr weit), Tiefe in den Bändern 0,1 / 0,5 / 1 %, Durchlauf beim Einstieg und beim Stop, **gehalten gegen die Slippage-Annahme des Plans** (`covered` / `low` / `unknown`), Anteil der Order am 24-Stunden-Umsatz (> 0,5 % „groß“, > 2 % „sehr groß“), ein Ton je Befund und der schlechteste Ton |

Die Wörter und Schwellen sind **Faustregeln dieser App**, keine Börsenregel (sie stehen als Konstanten da und die Karte nennt sie). Ein Befund, der
sich nicht lesen ließ, ist `unknown` – nie grün. Der Schnappschuss ist ein Moment: keine Zusage, dass eine Order so gefüllt wird (Teilausführung,
Iceberg-Orders und Latenz kommen nicht vor).

Daten: `src/market/execution/book.ts` (`/fapi/v1/depth`, 1000 Stufen, und `/fapi/v1/ticker/24hr`, auf Klick, direkt und bei 451 / CORS / Netzwerk über den
EU-Proxy; ein Fehler wird mit Grund zurückgegeben, nie geworfen und nie durch eine Zahl ersetzt). Karte: `src/views/plan/ExecutionCheck.tsx`.
Tests: `execution.domain.test.ts` (Handrechnung; ein echtes Spot-Orderbuch von `data-api.binance.vision` als Beispiel in
`tests/fixtures/binance-depth.json`), `execution.market.test.ts`, `views.plan.execution.test.tsx`, e2e `execution.spec.ts`. Nicht live gegen die
Futures-Endpunkte geprüft (aus dem Sandbox-Netz antwortet Binance mit 451).
