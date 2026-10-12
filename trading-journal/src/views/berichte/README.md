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
