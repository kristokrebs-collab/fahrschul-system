# `src/views/plan` – „Handelsplan“ (`#plan`, lazy, F44)

`PlanView` (export of `index.ts`, `h1` „Handelsplan“) führt in **fünf Schritten** vom Einstiegssignal zum Ticket: **1 Einstieg · 2 Ausstieg ·
3 Größe · 4 Risiko-Check · 5 Ticket**. Alle Zahlen kommen aus `@/domain/plan` (siehe dessen README) – die Seite rechnet nichts selbst, sie
zeigt es, fragt die Eingaben ab und schreibt, was der Nutzer ausdrücklich anklickt. Kerzen: `@/market/plan` (Binance, Zwischenspeicher zuerst).
**Die App sendet nie eine Order**; das Ticket ist Text zum Kopieren.

| Teil | Datei | Inhalt |
| --- | --- | --- |
| Seite | `PlanView.tsx` | `PageHeader` (Lead mit `PLAN_LEAD_FILL`), Fortschrittsleiste, `SectionNav` (`hplan-entry` … `hplan-saved`), Bild zum Plan (rechts auf breiten Schirmen), die fünf Schritt-Karten, Zeitmaschinen-Platz, gespeicherte Pläne, **ein** `AnalysisNote` am Seitenende. |
| Zustand | `usePlanModel.ts` · `planStore.ts` | Das Modell der Seite (Form → Kerzen → `buildPlanModel`; Uhr: alle 10 s live, 60 s im Leerlauf, gar nicht für einen vergangenen Tag). `planStore`: das zuletzt benutzte Formular und der geöffnete Plan **pro Gerät** (`plan-form`, `plan-open`) – die gespeicherten Pläne tragen ihre eigene Kopie in `settings.plan`. |
| Schritte | `EntryStep.tsx` · `ExitStep.tsx` · `SizeStep.tsx` · `RiskStep.tsx` · `TicketStep.tsx` | Je eine große Karte mit Überschrift in Worten, den Eingaben, den Zahlen, **„Angenommen“** (was die App vorausgesetzt hat) und einer Schlusszeile „Keine professionelle Finanzberatung. · Quelle: … · Kerzen bis … · abgerufen …“. |
| Bausteine | `ui.tsx` · `Progress.tsx` · `PlanChart.tsx` | `StepCard`, `StatePill`, `Assumed`, `NumInput` (Eingabe, die beim Verlassen übernimmt), Fortschritt, Kerzenbild mit Range, Signal, Einstieg, Stop, Ziel (SVG, Beschriftungen als HTML, `spreadLabels`). |
| Aktionen | `actions.ts` · `SavedPlans.tsx` | Plan speichern / aktualisieren / verwerfen (`settings.plan`), „Plan → 3 Alarme“ (zwei Schlüsselmarken in `settings.keyLevels` + Erinnerung „flat by close“), „Plan ins Journal“ (Entwurf im Trade-Editor – gespeichert wird erst dort). Jede Aktion hat **ihren eigenen Klick**. |
| Platz | `Slots.tsx` · `types.ts` | `TimeMachineSlot` (lazy, Props in `types.ts`): hier sitzt die Zeitmaschine: Knopf „Plan durchspielen“, dann lädt das Labor die längere Kerzenhistorie desselben Markts und Zeitrahmens (erst nach dem Klick, Fortschritt und Abbrechen) und die Karte `src/views/timemachine` rechnet; Fehler bleiben mit Grund stehen (`slotsImpl.tsx`, Test `views.plan.timemachine.test.tsx`). |

Zustände je Schritt: **Fertig** (grün) · **Achtung** (gelb) · **Gesperrt** (rot, z. B. keine Kerzen geladen, eine Regel abgelehnt oder die Ampel Rot) · **Wartet** (grau). Ein Schritt, der auf einen früheren wartet,
sagt „Wartet auf Schritt N“ – nie ein geschätzter Wert. Ein vergangener Tag ist ein **Rückblick** und sagt es; Alarme dafür sind nur sinnvoll, wenn der Kurs heute noch dort liegt.

## Test-IDs (Vertrag für Unit- und e2e-Tests)

`plan-view` · `hplan-{entry,exit,size,risk,ticket}` mit `-headline`, `-state` (`data-status`), `-note`, `-assumed` · `hplan-progress` (`data-done`) · `hplan-range` · `hplan-signal` ·
`hplan-stop` · `hplan-target` · `hplan-qty` · `hplan-maxloss` · `hplan-binding` · `hplan-limit-{loss,position,power,day}` (`data-binding`) · `hplan-ampel` (`data-light`) ·
`hplan-ticket-{rows,text,csv}` · `hplan-copy-{text,csv}` · `hplan-save` · `hplan-alarms` · `hplan-journal` · `hplan-discard` · `hplan-saved-*` · `hplan-open-{id}`.

## Tests

`tests/unit/views.plan.test.tsx` (der Ablauf), `views.plan.rules.test.tsx` (Regeln wechseln, Ablehnungen, Ampel Rot, Ladefehler), `views.plan.actions.test.tsx` (Ticket, Speichern, Alarme, Journal);
`tests/unit/market.plan.{candles,clock}.test.ts(x)`, `assistant.plan.test.ts`; e2e `tests/e2e/plan.spec.ts` (mobil + Desktop, feste Kerzen, ohne Uhr-Sprünge).

## Ausführbarkeit jetzt (F44, `ExecutionCheck.tsx`, `executionModel.ts`)

Im Schritt **Ticket**, unter den Kopier-Knöpfen: „Spread und Tiefe prüfen“ liest auf Klick ein Orderbuch (`@/market/execution`) und zeigt Quelle, Stand, Abrufweg
(direkt / EU-Proxy) und Alter, den Spread in Basispunkten mit Wort, die Tiefe in drei Bändern, den Durchlauf der geplanten Größe beim Einstieg und beim Stop, die
Slippage-Annahme des Plans daneben („gedeckt“ / „zu niedrig angenommen“) und den Anteil am 24-Stunden-Umsatz (Rechenkern: `@/domain/execution`). Ein gescheiterter
Abruf sagt „keine Daten“ mit Grund und ist nie ein grünes Licht; für Aktien gibt es keine Quelle (die Karte sagt das, die App schätzt nichts). Test-IDs: `hplan-exec` ·
`hplan-exec-run` · `hplan-exec-result` (`data-tone`) · `hplan-exec-headline` · `hplan-exec-failed` · `hplan-exec-stocks` · `hplan-exec-stand`. Tests:
`views.plan.execution.test.tsx`, e2e `execution.spec.ts`.
