# `src/domain/provenance` – Herkunft der Entscheidung und KI-Protokoll (F24)

Reine Domain-Logik (kein React, kein I/O): **wer hat entschieden – du, ein Regelwerk-Signal oder ein KI-Vorschlag?** Und: schneiden die drei
unterschiedlich ab? Die Oberfläche ist die Karte „Entscheidung: du, Regelwerk, KI“ unter Analyse › Vergleich (`src/views/analyse/decision`).

## Herkunft je Trade (`decision.ts`)

`Trade.decision?: { by: "own" | "rules" | "ai", via?: "plan" | "box", ref?: string }` – optional und additiv (`src/domain/types.ts`); fehlt es,
ist die Herkunft **unbekannt** (nie geraten). Es ist nicht `Trade.origin` (Herkunft des *Datensatzes*: manuell / API / CSV / Bot / Webhook).
`normalizeTrade` behält nur gültige `by`-Werte (unbekannte Schlüssel überleben), das Backup und der Cloud-Merge tragen das Feld als Teil des
Trades; im Editor steht es minimal als „Entscheidung“ (Offen · Ich · Regelwerk · KI, `src/journal/editor`).

`decisionOf(trade, inboxLinks)` wertet in fester Reihenfolge aus, die erste zutreffende gilt, und nennt den Grund (`basis`):

| Reihenfolge | Quelle | Herkunft | basis |
|---|---|---|---|
| 1 | `trade.decision` (Editor, Liste „Herkunft nachtragen“) | wie gesetzt | `set` |
| 1 | `trade.decision.via = "plan"` (Entwurf aus dem Handelsplan: Signal des Einstiegs-Timers = Regelwerk, eigener oder geplanter Einstieg = eigene Entscheidung) | wie gesetzt | `plan` |
| 1 | `trade.decision.via = "box"` („Als Trade eintragen“ aus einem Box-Setup) | Regelwerk | `box` |
| 2 | im Signal-Posteingang von Hand mit einem Signal verknüpft (`event.tradeId`) | Regelwerk | `inbox` |
| 3 | `trade.origin.kind` = Bot oder Webhook | Regelwerk | `source` |
| – | alles andere (auch Börsen-Sync, CSV, ein nur zeitlich passendes Signal) | unbekannt | – |

`signalHints` (`hints.ts`) findet zu einem Trade ohne Herkunft das Signal der App, das zeitlich zu ihm passt (Fenster der Verpassten Chancen).
Das ist ein **Hinweis**, den die Liste zeigt – geschrieben wird erst der Tipp des Händlers, und nur dieser eine Trade.

## Vergleich (`compare.ts`)

`compareDecisions(closed, inboxLinks)` → drei Gruppen (Anzahl, Treffer, Trefferquote mit 80-%-Wilson-Spanne, Ø R mit t-Spanne, Stichprobenwort
nach `missed/balance.ts`, Herkunft der Zuordnungen, Kontext: Märkte, Zeitraum, Long-Anteil) und alle Paare (Differenz Ø R nach Welch, Differenz der
Trefferquote nach Newcombe, **ein** Benjamini-Hochberg über alle Tests der Karte → `klar` / `Tendenz` / `offen` / `wenig`).

Was bewusst nicht behauptet wird:
- unter 5 Trades eine Gruppe nur die Anzahl („Zu wenig Daten“), nie eine kleinere, schönere Zahl; ein Paar wird erst ab 5 Trades je Seite verglichen;
- kein „besser“ / „schlechter“ ohne ein „klar“ (korrigiertes p ≤ 0,10); die Überschrift verneint den Rang ausdrücklich, wo nichts belegt ist;
- keine Ursache: ein Unterschied ist eine Beobachtung an diesen Trades – verglichen wird, was gehandelt wurde, nicht dieselben Kerzen, Zeiten,
  Kosten und Größen wie in einem Experiment (die Karte nennt, wie sich die Gruppen unterscheiden);
- Trades ohne Herkunft zählen nirgends mit; ihre Zahl steht auf der Karte.

## KI-Protokoll (`aiLog.ts`, Schreiber `src/store/aiLog.ts`)

`settings.aiLog = { v: 1, entries: [{ id, helper, model, version, at, adopted, ref? }] }` – versioniert, Passthrough (unbekannte Wurzelschlüssel und
unlesbare Einträge überleben, `withAiLog` gibt dasselbe Objekt zurück, wenn sich nichts ändert), eine Id-Liste (Cloud- und Zwei-Tab-Merge je
Eintrag), höchstens 100 Einträge (die ältesten fallen heraus). **Nichts außer Helfer, Modell, Zeit und „übernommen“**: keine Frage, keine Antwort,
kein Strategietext – die Eingabetypen haben kein Feld dafür (ein Test legt Text hinein und prüft, dass er nicht ankommt).

| Helfer | schreibt | „übernommen“ heißt |
|---|---|---|
| `assistant` | `src/assistant/route.ts` (Sprach-Router, nur mit Konto, Tarif und Server-Schlüssel) | mindestens eine vorgeschlagene Frage hat die lokale Prüfung bestanden |
| `studio` | `src/views/studio/aiClient.ts` (Strategie-Übersetzer) | die Lesart hat alle strengen Prüfungen bestanden und wurde dem Editor übergeben |
| `coach` | `src/views/coach/ask.ts` (Umformulierung) | der Text hat die Zahlenprüfung bestanden und wurde gezeigt |
| `optimizer` | `src/views/evolve/actions.ts` (`decideProposal`, erste Entscheidung) | gespeichert oder als Herausforderer gestartet; abgelehnt = nicht übernommen; ohne Modell (ein Suchverfahren) |

Das Modell steht so da, wie der Server es meldet (`res.model`); `version` ist die Datumsversion in der Kennung (`…-20250805`), sonst `null` („soweit
bekannt“). Der Screenshot-Leser (Vision) schreibt nichts: er ist kein Entscheidungshelfer. Ein Eintrag belegt, dass ein Helfer gefragt wurde – nicht,
dass ein Trade daraus entstand; ob ein Trade auf einem KI-Vorschlag beruht, sagt der Händler selbst.

## Tests

`tests/unit/provenance.decision.test.ts` (Datenmodell, Backup, Merge, `decisionOf`, Hinweise), `provenance.compare.test.ts` (Gruppen, Spannen, Urteile, Sätze),
`provenance.aiLog.test.ts` (Protokoll, Schreiber, die Helfer ohne Inhalt), `provenance.optimizer.test.ts` (echte Vorschläge), `provenance.form.test.ts`
(Editor-Formular, Entwürfe), `views.analyse.decision.test.tsx` (Karte, Liste, Protokoll); e2e `tests/e2e/herkunft.spec.ts` (mobil + Desktop, axe).
