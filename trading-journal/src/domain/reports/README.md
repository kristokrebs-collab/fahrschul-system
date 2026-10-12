# `src/domain/reports` – reports (P04)

Pure TypeScript: periods, the report builder, the automatic archive and the exports. The Berichte page
(`src/views/berichte`) renders what is computed here; the PDF is the page's print view (`ReportPrint` + `print.css`).

| File | What |
|---|---|
| `periods.ts` | `ReportKind` day / week / month / quarter / year, `KIND_LABEL`, `KIND_REPORT` ("Wochenbericht" …). `ReportPeriod {kind, key, from, to, label, short, range}` in local time with stable keys `2026-10-12`, `2026-W41` (ISO week), `2026-10`, `2026-Q4`, `2026`. `periodOf(kind, date)`, `shiftPeriod(p, n)`, `periodFromKey(key)` (validates, `null` for garbage – the deep link seam), `isComplete`, `contains`, `lastComplete`. |
| `build.ts` | `buildReport({list, settings, days?, events, start, currency, period, now})` → `Report`: summary sentence, the three strongest highlights ("trade the best"), **Performance** (net, return on the capital at the period start, max drawdown, equity, days, best / worst day and trade, Σ R), **Strategie** (setups – best = highest net > 0, worst = lowest net < 0 –, sides, sessions), **Risiko** (risk per trade in % of capital, consistency, over the limit, leverage, worst R, losses over 1.1 R, day-limit breaches, longest losing streak), **Psychologie** (behaviours with excess vs. clean trades, emotions, mood / stress / confidence, plan rate), **Fehler** (mistake costs, the biggest leak, clean share), **Zielerreichung** (discipline Ø and streak, journaling, checklist, rule breaks, goals of the coach plan and of P08 measured by `goalActual`) and **Vergleich** with the previous period. `ReportFocus` all / strategy / risk / psychology / mistakes limits the sections. |
| `archive.ts` | No button, no job: `reportArchive(list, settings, kind, now)` = every finished period with closed trades, newest first, with the seen marker (`settings.coach.reports.seen`). `pendingReports` / `pendingReport`: the unopened reports that just became ready (only the period that ended last per kind, within `READY_DAYS` – week 6, month 10, quarter 21, year 31 days), most important first – the "Bericht bereit" wipe. |
| `export.ts` | `reportFilename(r, ext, focus)` → `bericht-2026-W41[-risiko].md`; `reportToMarkdown`, `reportToCsv` (the app's CSV dialect: BOM, `;`, decimal comma, formula guard), `reportToJson` (trades as ids only, never the records). |

Tests: `tests/unit/reports.domain.test.ts` (periods incl. ISO week edges, the builder, the archive and the ready logic,
an inline Markdown snapshot, CSV / JSON).
