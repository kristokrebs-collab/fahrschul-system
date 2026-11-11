/**
 * Leaf host of the optional weekly-review reminder (Paket P): once the person switched it on (`reviewReminder.ts`, default OFF) and
 * the chosen weekday / hour has come while the app is open, ONE quiet toast says "Dein Rückblick für KW n ist bereit" with a button
 * that opens that week's report. Nothing else: no repeat (the week key is stored the moment it showed), none in the quiet hours,
 * none for a week without a closed trade or with a review that is already closed, none while the tab is hidden or the intro runs.
 */
import { useEffect } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { weekClosed } from "@/domain/coach";
import { useIntroSettled } from "@/intro/introStore";
import { useEnriched, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { pushToast } from "@/store/uiStore";
import { useMinuteClock } from "@/views/coach/hooks";
import { openReport } from "./berichteStore";
import { tradesIn } from "./hooks";
import { REMINDER_STRINGS, reminderDecision, useReminderPref } from "./reviewReminder";

export function ReviewReminderHost() {
  const allowed = useEntitlement("reports");
  const loaded = useJournal((s) => s.loaded);
  const settings = useJournal((s) => s.settings);
  const enriched = useEnriched();
  const now = useMinuteClock();
  const on = useReminderPref((s) => s.on);
  const day = useReminderPref((s) => s.day);
  const hour = useReminderPref((s) => s.hour);
  const quietFrom = useReminderPref((s) => s.quietFrom);
  const quietTo = useReminderPref((s) => s.quietTo);
  const lastKey = useReminderPref((s) => s.lastKey);
  const settled = useIntroSettled();

  useEffect(() => {
    if (!on || !loaded || !allowed || !settled) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    const d = reminderDecision({ pref: { on, day, hour, quietFrom, quietTo, lastKey }, now, tradesInWeek: (p) => tradesIn(enriched, p).length, closed: (k) => weekClosed(settings, k) });
    if (d.verdict !== "show") return;
    // remember it first: a reload or a second tab never shows it again this week
    useReminderPref.getState().set({ lastKey: d.period.key });
    pushToast({
      kind: "info",
      title: REMINDER_STRINGS.toast(d.period.short),
      detail: REMINDER_STRINGS.toastDetail,
      duration: 9000,
      action: {
        label: REMINDER_STRINGS.open,
        onClick: () => {
          navigate("berichte");
          openReport(d.period.key);
        },
      },
    });
  }, [on, day, hour, quietFrom, quietTo, lastKey, now, loaded, allowed, settled, enriched, settings]);

  return null;
}

export default ReviewReminderHost;
