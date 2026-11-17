# `src/domain/thesis` – Kaufthese (F69)

Eine langfristige These zu einem Unternehmen als Karte: eigene Begründung, Szenarien Bär/Basis/Bulle (über den DCF), Katalysatoren, Risiken, Gegenargumente, **prüfbare Widerlegungsbedingungen**, die Prüfung gegen die gemeldeten Zahlen und Versionen. Reine Domain-Logik; Oberfläche: `src/views/analyst` (`ThesisPanel`). Die These ist die der Person – die App bewertet sie nicht, ändert nichts von selbst und sendet keine Order. Keine professionelle Finanzberatung.

| Datei | was |
|---|---|
| `types.ts` | `Thesis`, `ThesisSnapshot`, `ThesisVersion`, `Scenario`, `Criterion`, `CheckState`, Grenzen (30 Thesen, 30 Versionen, 12 Bedingungen). |
| `config.ts` | `settings.theses` (versioniertes Passthrough): Lesen (`thesesCfgOf`), Schreiben (`withTheses`), `newThesis`, `updateThesis`, `saveVersion`. |
| `criteria.ts` | `evaluateCriteria`: Bedingung gegen das neueste Quartal → `triggered` / `clear` / `unknown`; `checkThesis`, `checkDue`. |
| `scenarios.ts` | `computeAll`/`computeScenario` (je Szenario ein DCF mit Spanne), `versusPrice`, `whatMustHold` (Rückwärts-DCF). |
| `diff.ts` | `diffSnapshots`: was sich zwischen zwei Versionen geändert hat, mit dem Wert je Aktie davor → danach. |

## `settings.theses`
`{ v: 1, theses: [{ id, ticker, name, text, horizonYears, buyZone, price, base, scenarios, criteria, catalysts, risks, counter, nextReport, reviewAt, monitoring, check, versions[] }] }`. Wie `settings.studio`/`settings.keyLevels`: übersteht `normalizeSettings` (Spread), Backup und den Cloud-/Zwei-Tab-Merge (`merge3`: Thesen, Bedingungen und Versionen sind Arrays von Objekten mit `id`, zwei Geräte fügen je ihre hinzu; zwei gleiche Versionsnummern bekommen beim Lesen die nächste freie). Lesen ist nachsichtig **in** einer These (eine kaputte Zahl wird „nicht eingetragen“, eine Bedingung dieser Version unbekannter Art bleibt in `criteriaExtra` und wird unverändert zurückgeschrieben), streng an ihrem Rand (kein lesbares `id` → `rejected`, unverändert zurückgeschrieben); unbekannte Schlüssel der Wurzel und einer These überleben. `withTheses` gibt dasselbe Objekt zurück, wenn sich nichts ändert (kein Speichern).

## Was die Person schreibt, was die App rechnet
- **Eigene Eingaben** (nie umgeschrieben): Begründung (Freitext, bis 4.000 Zeichen), Horizont, Listen, Kaufzone, **Kurs mit Datum und Quelle** (ohne Quelle kein Vergleich), **Termin des nächsten Berichts mit Quelle** (SEC-Daten enthalten keinen), Wiedervorlage, alle Annahmen.
- **Szenarien:** gemeinsame Ausgangszahlen (getippt oder per Klick aus den gemeldeten SEC-Zahlen – nur was gemeldet ist, Lücken bleiben leer, Quelle steht dabei) + je Szenario Wachstum Jahr 1 / letztes Jahr, Marge im letzten Jahr, Reinvestition, WACC, Endwachstum. Es gibt **keine Wahrscheinlichkeiten und keinen gemittelten Zielkurs** (der Bauplan verlangt Wahrscheinlichkeiten nur mit dokumentierter Grundlage). Fehlt eine Annahme, nennt das Szenario sie und rechnet nicht.
- **„Was müsste stimmen?“** (BYD-Beispiel des Bauplans): bei Kurs mit Quelle das gleichbleibende Wachstum, das das Basis-Szenario für +50 % / ×2 / ×3 bräuchte – eine Hypothese der Person, kein Ziel der App.
- **Bedingungen:** „Die These ist in Frage gestellt, wenn <Kennzahl> <unter/höchstens/über/mindestens> <Schwelle>“ – Umsatzwachstum (Vorjahr/Vorquartal), Brutto-/operative/Netto-/FCF-Marge, Nettoergebnis- und EPS-Wachstum, Aktienzahl-Wachstum (Verwässerung), freier Cashflow, Nettoverschuldung, EPS. Eine Zahl, die fehlt, oder ein Prozentwert gegen einen Vorwert ≤ 0 ist **`unknown`** („Keine Daten“), nie `clear`.
- **Prüfung** (`CheckState`): Quartal, Datum der Meldung, Link auf die Meldung, Quelle, Zeit des Abrufs, Wert je Bedingung. Ein Quartal, das neuer ist als das der letzten Prüfung, ist `newQuarter` (bis „Gesehen“). Ist eine Bedingung ausgelöst, **schlägt** das Panel vor, die These anzusehen und eine Version zu speichern – es ändert nichts. Läuft nur, solange ein Panel mit eingeschaltetem Monitor offen ist (`useThesisMonitor`), höchstens einmal je Tag und These, nie als Dauerschleife bei einem Fehler.
- **Versionen:** unveränderliche Schnappschüsse (Text, Szenarien, Ausgangszahlen, Bedingungen, Listen, Kurs, Kaufzone) mit Notiz und dem Prüfergebnis; „keine Änderung seit der letzten Version“ speichert nichts (außer die Version dokumentiert ein Prüfergebnis). Jede Änderung des Wertes je Aktie lässt sich über `diffSnapshots` auf geänderte Annahmen zurückführen.

## Grenzen
Keine Staffelkäufe als eigene Struktur (Freitext), keine automatische Prüfung außerhalb der offenen App (kein Server-Job), keine Konsens- oder Preisdaten, Prüfung nur über die SEC-Quartalszahlen. Tests: `tests/unit/thesis.test.ts`, `tests/unit/views.analyst.test.tsx`.
