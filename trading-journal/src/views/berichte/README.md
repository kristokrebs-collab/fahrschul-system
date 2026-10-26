# `src/views/berichte` – "Berichte" (P04)

`BerichteView` (export of `index.ts`, `h1` "Berichte") – day, week, month, quarter and year reports of the account of
the Hero's switch (`uiStore.acc`), built on the device by `@/domain/reports` (see its README). Every finished period
with trades is in the archive automatically; the running period opens too ("läuft noch").

| Row (lg, 12 columns) | Content |
|---|---|
| header | `PageHeader` (title, lead with `BERICHTE_LEAD_FILL` = `storageKey("fill-berichte")`, account switch) |
| toolbar | kind (`Segmented`: Tag · Woche · Monat · Quartal · Jahr) · ‹ period › · "Neuester" / "Laufend" · focus chips (Alles · Strategie · Risiko · Psychologie · Fehler) |
| report | `ReportHero` (8) · `ExportCard` + `ArchiveCard` (4) |
| sections | Performance (7) · Vergleich (5) · Strategie (7) · Risiko (5) · Psychologie (6) · Fehler (6) · Zielerreichung (12) – with a focus only that section, full width |

Phones: one column in the same order, no horizontal scroll at 390 px.

## Effects
- **Period switch**: the hero's period rolls on split-flap tiles (`SplitFlap`, down to an older period, up to a newer
  one) and the OLD equity curve peels away in ten strips over the new one (`playStripWipe` with a canvas snapshot
  painted by `paint.ts` with the geometry of `EquityDraw` – one layout read per switch, nothing per frame). The net
  result cascades (`NumberCascade`), the highlights cascade in (`StaggerItem`), bars / columns grow from the zero line.
- **Bericht bereit** (`ReportReady.tsx`, `ReportReadyHost`): once per period and device a `FullscreenWipe` (red curtain,
  black panel, the report name, net, trades, win rate rising in). The most important ready report wins (year > quarter
  > month > week); announcing it also covers the smaller ones that ended with it. "Bericht öffnen" selects the report
  (`openReport`) and calls `onOpen`; "Später" closes – the archive keeps "neu".
- **Discipline streak**: 3+ good days at the end of the period burst once per report and session from the streak
  figure (`celebrateStreak`, kind `streak`).

## Seen, archive, export
- A finished report on screen for 1.5 s counts as opened → `settings.coach.reports.seen` (`withReportSeen`, synced).
  The archive marks recent unopened reports "neu" (`NEW_DAYS`: week 14, month 45 days …).
- `ExportCard`: Markdown, CSV, JSON through `@/store/download` (claude.ai `downloads` capability or a Blob link), the
  focus limits the sections. **PDF** = `ReportPrint` (portal to `<body>`, `html.tj-report-printing`) + `print.css`
  (white A4, plain tables, a static SVG curve – always light) + `window.print()` ("Als PDF sichern"); cleaned up on
  `afterprint` (or right after a blocking `print()`). PDF is the plan feature `reportsPdf`: without it the button says
  "PDF · Premium" and opens the upgrade sheet. An empty period exports nothing and says so.

## State and hooks
- `berichteStore.ts`: kind, chosen key (`null` = newest finished period with trades), focus, flap direction.
  **Router seam** for P14: `#berichte?p=<key>` – `berichtePeriodFromQuery(query)`, `openReport(key)`,
  `berichteQuery(key)`.
- `hooks.ts`: `useReportPage()` (account view, events of the coach, archive, period, report, bars), `resolvePeriod`,
  `periodBars` (per trade for a day, per day for a week / month, per week for a quarter, per month for a year).

## Contracts for the integrator (P14)
- page `berichte` → `BerichteView` (lazy), `h1` "Berichte"; gate: plan feature `reports`.
- App.tsx: `<ReportReadyHost onOpen={() => navigate("berichte")} />` once, as a leaf with `data-layer`.
- Router: parse `p` of `#berichte?p=<key>` with `berichtePeriodFromQuery` and call `openReport(key)` (the router keeps
  the query of `trades` only today).

## Wochenreview und Wochenexperiment (F37, `WeekReview.tsx`)
Only for the week report with the focus „Alles“ (lazy with the page, no new chunk).
- **`WeekReviewCard`** (7): four findings from `weekReview` – Ergebnis nach Kosten · Setups · Disziplin · Unsicherheit – each with
  its sample (`n`) and evidence buttons („Bester Trade · 1 Trade öffnen“, „Regelverstöße · 2 Trades öffnen“ …) that expand into
  trade rows (`TradeList` → trade detail). A week without trades says so.
- **`ExperimentCard`** (5): (1) „Experiment dieser Woche“ – the experiment the trader accepted for the displayed week, read
  against the journal: status pill (erfüllt · nicht erfüllt · zu wenig Daten · läuft), Sollwert, Ist, Stichprobe („n 6 · min. 5“),
  the sentence of the reading and the trades that count against the target. Shown even for a week without trades („zu wenig
  Daten“). (2) „Für nächste Woche“ – ONE hypothesis from the coach's plan with the target sentence („Nächste Woche: Revenge-Trade:
  0 – bei mindestens 5 Trades.“), the same measure in this week, the assumption behind it (labelled as not testable in a week),
  the evidence trades, and **Experiment annehmen** / **Ablehnen** – both the trader's click, both reversible („Zurückziehen“,
  „Wieder öffnen“). Offered only while the next week is not over and the report week has trades; no measurable recommendation →
  an honest „Kein Vorschlag“. Other report kinds show neither card.
- Settings key `settings.weekExperiment` (see `@/domain/reports` README); synced like every setting.
- Tests: `tests/unit/views.berichte.experiment.test.tsx`, `tests/e2e/week-experiment.spec.ts`.

## Monatsnutzen (F60, `MonthBenefitCard.tsx`)
Only for the month report with the focus „Alles“ (also for a month without trades). „Was hat dir das Journal diesen Monat gebracht?“ from `monthBenefit` (`@/domain/reports/benefit`): trades with a stored Einstiegs-Check / Box context at entry,
signals the archive recorded and lines the Zustellprotokoll sent, checklist complete / incomplete, logged rule violations, plan followed, days over the day limit, trades over the per-trade limit, the review share, check-in days,
the accepted weekly experiments of the month's weeks with their reading. A trace that does not reach back to the month's start is flagged. **Not claimed:** avoided rule violations, money „saved“, estimates, causes (the card says so).
Tests: `reports.benefit.test.ts`, `views.coach.signalchain.test.tsx`, e2e `signal-chain.spec.ts`.

## Inhalt-Leiste (Auffindbarkeit)

Unter dem Seitenkopf sitzt die `SectionNav` (`src/primitives/SectionNav.tsx`): ein Chip je Abschnitt, klebt unter dem Header, markiert den sichtbaren Abschnitt (`aria-current="location"`), ein Tipp scrollt weich (reduzierte Bewegung: Sprung) und hebt den Titel kurz hervor. Die Chips folgen Fokus und Art des Berichts (Performance/Vergleich nur bei Fokus „Alles“, Wochenreview/-experiment nur im Wochenbericht, Monatsnutzen nur im Monatsbericht); gefunden über `data-testid`. Test: `tests/e2e/funktionen-anker.spec.ts` (jeder Chip landet unter der Leiste), `tests/unit/primitives.sectionNav.test.tsx`.

## Transaktionsbuch (F70, `ledger/`)

Letzter Abschnitt der Seite (lazy, eigener Chunk, `data-testid="ledger-card"`, Chip „Transaktionsbuch“ in der „Inhalt“-Leiste), unabhängig von Zeitraum und Fokus des Berichts, folgt dem Konto-Schalter der Seite (Gesamt / Makro / Scalp). Eine **Hilfsrechnung ohne Steuerberatung** (der Kopf steht auf der Karte, im CSV und im Druck): das Journal als Buch mit FIFO-Zuordnung, Jahreszusammenfassung, wählbarer Zeitzone und Zuordnung (je Position / je Markt), den sichtbaren Hinweisen (Lücke im Bestand, mögliche Dubletten, fehlende Gebühr / Funding / Zeit, Abweichung vom Journal, Klärliste, noch Offenes) und CSV (Buch, FIFO-Zuordnung) und Druck (`LedgerPrint`, derselbe Mechanismus wie das PDF der Berichte: `html.tj-report-printing` + `print.css`). Domain, Regeln, Grenzen: `src/domain/ledger/README.md`. Tests: `views.berichte.ledger.test.tsx`, `tests/e2e/ledger.spec.ts`.
