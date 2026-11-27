/**
 * Data of the closing ritual (Paket F2): the growth context of the page (`prepare` – the same prepared journal the streaks read),
 * memoised per journal change and per minute, plus the keys of a week. Read-only.
 */
import { useMemo } from "react";
import { prepare, weekDots, weekDotsText, weekKeys, type Prepared } from "@/domain/growth";
import { localDateKey, weekStart } from "@/lib/dates";
import type { ReportPage } from "./hooks";

/** The prepared journal of the page's account view (trades, events, day notes, settings, now). */
export function usePrepared(page: Pick<ReportPage, "view" | "events" | "days" | "settings" | "now">): Prepared {
  const { view, events, days, settings, now } = page;
  return useMemo(() => prepare({ list: view.list, events, days, settings, now }), [view.list, events, days, settings, now]);
}

/** The dots of the week that starts on `from` (epoch ms, local Monday) and their sentence; `running` = the week is not over. */
export function useWeekDots(p: Prepared, from: number, running: boolean) {
  return useMemo(() => {
    const { dots, done } = weekDots(p, weekKeys(localDateKey(new Date(from))));
    return { dots, done, text: weekDotsText(done, running) };
  }, [p, from, running]);
}

/** Monday (epoch ms, local midnight) of the week `now` falls in. */
export const mondayOf = (now: number): number => +weekStart(new Date(now));
