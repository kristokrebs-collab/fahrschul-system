/**
 * Data hooks of the Berichte page (P04): the chosen period (default = the newest finished period with trades), the
 * report of the account view of the Hero's switch, the archive of the chosen kind and the bars of the period
 * (trades of a day, days of a week / month, weeks of a quarter, months of a year). Pure helpers are exported for tests.
 */
import { useMemo } from "react";
import { buildReport, periodFromKey, periodOf, reportArchive, lastComplete, type ArchiveEntry, type Report, type ReportKind, type ReportPeriod } from "@/domain/reports";
import type { ChartRow } from "@/domain/coach/nlq";
import type { EnrichedTrade } from "@/domain/types";
import { tradeTime } from "@/lib/dates";
import { useCoachBase, useMinuteClock } from "@/views/coach/hooks";
import { useBerichteUi } from "./berichteStore";

/** The period to show: the chosen key, else the newest finished one with trades, else the last finished one. */
export function resolvePeriod(kind: ReportKind, key: string | null, archive: readonly ArchiveEntry[], now: number): ReportPeriod {
  const chosen = key ? periodFromKey(key) : null;
  if (chosen && chosen.kind === kind) return chosen;
  return archive[0]?.period ?? lastComplete(kind, now);
}

const BUCKET: Readonly<Record<ReportKind, ReportKind | "trade">> = { day: "trade", week: "day", month: "day", quarter: "week", year: "month" };

/** Bars of a report: one per trade (day), per day (week, month), per week (quarter), per month (year). */
export function periodBars(r: Pick<Report, "period" | "trades">): ChartRow[] {
  const by = BUCKET[r.period.kind];
  if (by === "trade")
    return r.trades.map((t, i) => {
      const v = t.pnl ?? 0;
      return { label: `${i + 1}. ${t.pair || "Trade"}`, value: v, n: 1, tone: v > 0 ? "win" : v < 0 ? "loss" : "mute" };
    });
  const m = new Map<string, { label: string; from: number; net: number; n: number }>();
  for (const t of r.trades) {
    const p = periodOf(by, tradeTime(t));
    const e = m.get(p.key) ?? { label: by === "day" ? p.short : by === "week" ? p.short : p.short.split(" ")[0]!, from: p.from, net: 0, n: 0 };
    e.net += t.pnl ?? 0;
    e.n++;
    m.set(p.key, e);
  }
  return [...m.values()].sort((a, b) => a.from - b.from).map((e) => ({ label: e.label, value: e.net, n: e.n, tone: e.net > 0 ? "win" : e.net < 0 ? "loss" : "mute" }));
}

/** Everything the page shows for the account of the Hero's switch. */
export function useReportPage() {
  const base = useCoachBase();
  const now = useMinuteClock();
  const kind = useBerichteUi((s) => s.kind);
  const key = useBerichteUi((s) => s.key);
  const { view, settings, days, events } = base;
  const archive = useMemo(() => reportArchive(view.list, settings, kind, now), [view.list, settings, kind, now]);
  const period = useMemo(() => resolvePeriod(kind, key, archive, now), [kind, key, archive, now]);
  const report = useMemo(() => buildReport({ list: view.list, settings, days, events, start: view.start, currency: settings.currency, period, now }), [view.list, settings, days, events, view.start, period, now]);
  const bars = useMemo(() => periodBars(report), [report]);
  return { ...base, now, kind, period, report, archive, bars };
}

export type ReportPage = ReturnType<typeof useReportPage>;

/** Closed trades of a list inside a period (helper for tests / widgets). */
export const tradesIn = (list: readonly EnrichedTrade[], p: Pick<ReportPeriod, "from" | "to">) => list.filter((t) => t.result !== "open" && +tradeTime(t) >= p.from && +tradeTime(t) < p.to);
