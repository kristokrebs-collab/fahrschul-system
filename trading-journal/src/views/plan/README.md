# `src/views/plan` – „Handelsplan“ (`#plan`, lazy, F44)

`PlanView` (export of `index.ts`, `h1` „Handelsplan“) führt in **fünf Schritten** vom Einstiegssignal zum Ticket: **1 Einstieg · 2 Ausstieg ·
3 Größe · 4 Risiko-Check · 5 Ticket**. Alle Zahlen kommen aus `@/domain/plan` (siehe dessen README) – die Seite rechnet nichts selbst, sie
zeigt es, fragt die Eingaben ab und schreibt, was der Nutzer ausdrücklich anklickt. Kerzen: `@/market/plan` (Krypto: Binance, Zwischenspeicher zuerst; Aktien: der Aktien-Datenvertrag, `stockCandles.ts`).
**Die App sendet nie eine Order**; das Ticket ist Text zum Kopieren.

| Teil | Datei | Inhalt |
| --- | --- | --- |
| Seite | `PlanView.tsx` | `PageHeader` (Lead mit `PLAN_LEAD_FILL`), Fortschrittsleiste, `SectionNav` (`hplan-entry` … `hplan-saved`), Bild zum Plan (rechts auf breiten Schirmen), die fünf Schritt-Karten, Zeitmaschinen-Platz, gespeicherte Pläne, **ein** `AnalysisNote` am Seitenende. |
| Zustand | `usePlanModel.ts` · `planStore.ts` | Das Modell der Seite (Form → Kerzen → `buildPlanModel`; Uhr: alle 10 s live, 60 s im Leerlauf, gar nicht für einen vergangenen Tag). `planStore`: das zuletzt benutzte Formular und der geöffnete Plan **pro Gerät** (`plan-form`, `plan-open`) – die gespeicherten Pläne tragen ihre eigene Kopie in `settings.plan`. |
| Schritte | `EntryStep.tsx` · `ExitStep.tsx` · `SizeStep.tsx` · `RiskStep.tsx` · `TicketStep.tsx` | Je eine große Karte mit Überschrift in Worten, den Eingaben, den Zahlen, **„Angenommen“** (was die App vorausgesetzt hat) und einer Schlusszeile „Keine professionelle Finanzberatung. · Quelle: … · Kerzen bis … · abgerufen …“. |
| Bausteine | `ui.tsx` · `Progress.tsx` · `PlanChart.tsx` | `StepCard`, `StatePill`, `Assumed`, `NumInput` (Eingabe, die beim Verlassen übernimmt), Fortschritt, Kerzenbild mit Range, Signal, Einstieg, Stop, Ziel (SVG, Beschriftungen als HTML, `spreadLabels`). |
| Link | `linkStore.ts` · `linkSeam.ts` | `#plan?symbol=AAPL&side=long` (so schreibt es die Seite Aktien, „Plan erstellen →“; andere Seiten dürfen es auch, Krypto mit `symbol=BTCUSDT`): der Router (`QUERY_PAGES`, `SEAM_LOADERS.plan`) reicht die Anfrage an die lazy geladene Naht, `applyPlanLink` füllt Markt, Sitzung und Richtung **im Speicher** (`planStore.prefill`: nichts wird geschrieben, bis die Person etwas ändert; der geöffnete Plan gilt nicht mehr), die Zeile oben (`hplan-link`) sagt, was übernommen und was übergangen wurde. Die Adresse zeigt den Link nur, solange das Formular ihm entspricht. Ungültiges wird ignoriert und gesagt. |
| Aktionen | `actions.ts` · `SavedPlans.tsx` | Plan speichern / aktualisieren / verwerfen (`settings.plan`), „Plan → 3 Alarme“ (zwei Schlüsselmarken in `settings.keyLevels` + Erinnerung „flat by close“), „Plan ins Journal“ (Entwurf im Trade-Editor – gespeichert wird erst dort). Jede Aktion hat **ihren eigenen Klick**. |
| Platz | `Slots.tsx` · `types.ts` | `TimeMachineSlot` (lazy, Props in `types.ts`): hier sitzt die Zeitmaschine: Knopf „Plan durchspielen“, dann lädt eine **Historienquelle** (`src/views/timemachine/historySources.ts`) die längere Kerzenhistorie desselben Markts (erst nach dem Klick, Fortschritt und Abbrechen) und die Karte `src/views/timemachine` rechnet; Krypto über den Lader des Labors (unverändert), Aktien über den Aktien-Datenvertrag mit **Stunden- oder Tageskerzen** (Wahl vor dem Klick); nur geschlossene Kerzen, bei einem vergangenen Plan nur solche, die vor dem Einstieg schlossen; zu wenige (`MIN_POOL_BARS`) oder ein Ausfall der Quelle bleiben mit Grund stehen (`slotsImpl.tsx`, Tests `views.plan.timemachine.test.tsx`, `views.plan.timemachine.stocks.test.tsx`). |

Zustände je Schritt: **Fertig** (grün) · **Achtung** (gelb) · **Gesperrt** (rot, z. B. keine Kerzen geladen, eine Regel abgelehnt oder die Ampel Rot) · **Wartet** (grau). Ein Schritt, der auf einen früheren wartet,
sagt „Wartet auf Schritt N“ – nie ein geschätzter Wert. Ein vergangener Tag ist ein **Rückblick** und sagt es; Alarme dafür sind nur sinnvoll, wenn der Kurs heute noch dort liegt.

## Aktien auf dieser Seite

Die Sitzung „US-Börse“ ist wählbar; ein Wechsel zwischen Krypto und Aktien nimmt das passende Kürzel mit (die erste Aktie der Watchlist, sonst AAPL als Beispiel; zurück: der Markt aus den Live-Daten) und lässt zurück, was nur für den alten Markt galt (`formPatchFor`).
Statt der Hebel-Wahl steht „1× – nur eigenes Geld“, Mengen sind „Stück“, Preise haben zwei Stellen, die Währung ist USD. Unter der Kerzenzeile steht bei laufender Sitzung die **Verzögerung** der Quelle (`hplan-feed-lag`, Fakten: wann die neueste
geschlossene Kerze schloss, wann die nächste fällig war), bei einem Ausfall der Grund der Quelle im Schritt 1 („Keine Kerzen geladen: Yahoo Finance (inoffiziell): …“), bei einem zu alten Tag der Grund mit der Zahl der Tage (5- und 15-Minuten-Kerzen: höchstens ein Monat zurück).
„Neu laden“ fragt die Quelle noch einmal und umgeht dabei ihren frischen Zwischenspeicher. Die Aktion „Plan → 3 Alarme“ heißt bei Aktien „Erinnerung „flat by close““ und legt **keine** Schlüsselmarken an (sie werden nur für den Krypto-Live-Markt bewertet).

## Test-IDs (Vertrag für Unit- und e2e-Tests)

`plan-view` · `hplan-{entry,exit,size,risk,ticket}` mit `-headline`, `-state` (`data-status`), `-note`, `-assumed` · `hplan-progress` (`data-done`) · `hplan-range` · `hplan-signal` ·
`hplan-stop` · `hplan-target` · `hplan-qty` · `hplan-maxloss` · `hplan-binding` · `hplan-limit-{loss,position,power,day}` (`data-binding`) · `hplan-ampel` (`data-light`) ·
`hplan-ticket-{rows,text,csv}` · `hplan-copy-{text,csv}` · `hplan-save` · `hplan-alarms` · `hplan-journal` · `hplan-discard` · `hplan-saved-*` · `hplan-open-{id}`.
Aktien und Link: `hplan-link` (`-applied`, `-ignored`, `-close`) · `hplan-stocks-note` · `hplan-feed-lag` (`data-late`) · `hplan-no-leverage` · `hplan-alarms-stocks` · `hplan-timemachine-choice`.

## Tests

`tests/unit/views.plan.test.tsx` (der Ablauf), `views.plan.rules.test.tsx` (Regeln wechseln, Ablehnungen, Ampel Rot, Ladefehler), `views.plan.actions.test.tsx` (Ticket, Speichern, Alarme, Journal);
`tests/unit/market.plan.{candles,clock,stocks}.test.ts(x)`, `assistant.plan.test.ts`; Aktien: `views.plan.stocks.test.tsx` (die Seite mit einer nachgebauten Aktien-Quelle: Wechsel, Link, Ausfall, Verzögerung, Erinnerung statt Marken-Alarmen, Journal-Entwurf), `views.plan.timemachine.stocks.test.tsx` (Slot),
`store.router.plan.test.ts` (Link und Router-Naht); e2e `tests/e2e/plan.spec.ts` (mobil + Desktop, feste Kerzen, ohne Uhr-Sprünge; die Aktien-Fälle mit einem jungen Handelstag aus der Uhr, die Zahlen hängen nicht daran) und `tests/e2e/aktien.spec.ts` („Plan erstellen →“ Ende-zu-Ende).
