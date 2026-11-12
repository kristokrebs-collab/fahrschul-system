/**
 * "Heute abschließen" (Paket F2) – the closing of the running day, merged with the weekly closing: the same `CloseRitual`, the same
 * quiet confirmation (`processDone`), the same discipline predicate as the streaks. It looks at PROCESS only –
 *
 *   Checkliste vollständig   every trade of today that has a checklist is fully ticked
 *   Review geschrieben       every closed trade of today has a review
 *   Notiz oder Check-in      today has text or a check-in (what counts on a day without trades)
 *
 * The round check button closes the day (`settings.coach.dayCloses`, synced, never deleted – "Wieder öffnen" takes it back). The
 * confirmation (toast island + optional vibration / tone, both OFF by default) comes ONLY when the required items were done at the
 * moment of closing (`dayCloseReady`). Closing with something open is recorded quietly: "Noch offen: Review." – no puff, no
 * scolding, nothing blocked. A profit, a loss, the number of trades or an order never decides anything here.
 *
 * Shown in the report of a running day or week (focus „Alles“), never on Übersicht / Cockpit. Nothing asks for an upgrade.
 */
import { useId, useMemo, useState } from "react";
import { dayClosesOf, withDayClosed } from "@/domain/coach/prefs";
import { dayCloseItems, dayCloseReady, openItemsText } from "@/domain/growth";
import { cn } from "@/lib/cn";
import { localDateKey } from "@/lib/dates";
import { processDone } from "@/motion/processFeedback";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { CloseRitual } from "./CloseRitual";
import { mondayOf, usePrepared, useWeekDots } from "./closeData";
import type { ReportPage } from "./hooks";
import "./frost.css";

export const DAY_CLOSE = {
  title: "Heute abschließen",
  note: "Ein ruhiger Schluss für den Tag: Checkliste, Review, Notiz – kein Ergebnis, kein Urteil.",
  open: "Der Tag ist noch offen.",
  closedOn: (time: string) => `Heute abgeschlossen${time ? ` um ${time} Uhr` : ""}.`,
  label: "Heute abschließen",
  hint: "Ein Tipp – fertig.",
  done: "Tag abgeschlossen",
  reopen: "Wieder öffnen",
  reopened: "Der Tag ist wieder offen.",
  recorded: "Tag abgeschlossen",
  failed: "Nicht gespeichert",
  retry: "Bitte noch einmal versuchen.",
  count: (n: number) => (n === 1 ? "Ein Tag abgeschlossen." : `${n} Tage abgeschlossen.`),
  detail: (ready: boolean) => (ready ? "Alles Nötige ist erledigt." : ""),
} as const;

/** Should the card show for this page: focus „Alles“, a day or week report whose period contains today. */
export const dayCloseVisible = (page: Pick<ReportPage, "kind" | "period" | "now">): boolean => (page.kind === "day" || page.kind === "week") && page.period.from <= page.now && page.now < page.period.to;

const timeOf = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
};

export function DayCloseCard({ page, className }: { page: ReportPage; className?: string }) {
  const { settings, now } = page;
  const saveSettings = useJournal((s) => s.saveSettings);
  const uid = useId();
  const prepared = usePrepared(page);
  const today = localDateKey(new Date(now));
  const items = useMemo(() => dayCloseItems(prepared, today), [prepared, today]);
  const ready = dayCloseReady(items);
  const stored = dayClosesOf(settings)[today];
  const closed = stored?.closed === true;
  const closedCount = useMemo(() => Object.values(dayClosesOf(settings)).filter((d) => d.closed).length, [settings]);
  const week = useWeekDots(prepared, mondayOf(now), true);
  const [busy, setBusy] = useState(false);
  const [ring, setRing] = useState(false);

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      after?.();
    } catch {
      pushToast({ kind: "error", title: DAY_CLOSE.failed, detail: DAY_CLOSE.retry });
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    // read ONCE at the moment of the tap: what was done then decides whether the confirmation comes
    const earned = ready;
    void run(
      () => saveSettings(withDayClosed(useJournal.getState().settings, today, { closed: true, ready: earned }, Date.now())),
      () => {
        setRing(earned);
        if (earned) processDone("dayClose");
        else pushToast({ kind: "info", title: DAY_CLOSE.recorded, detail: openItemsText(items) || undefined });
      },
    );
  };
  const reopen = () =>
    void run(
      () => saveSettings(withDayClosed(useJournal.getState().settings, today, { closed: false }, Date.now())),
      () => {
        setRing(false);
        pushToast({ kind: "info", title: DAY_CLOSE.reopened });
      },
    );

  return (
    <Card title={DAY_CLOSE.title} note={DAY_CLOSE.note} className={className} data-testid="day-close" data-state={closed ? "closed" : "open"} data-ready={ready ? "yes" : "no"} innerClassName="grid content-start gap-4">
      <p className="text-[13px] text-fg" data-testid="day-close-state" id={`${uid}-state`}>
        {closed ? DAY_CLOSE.closedOn(timeOf(stored?.at ?? "")) : DAY_CLOSE.open}
      </p>
      <CloseRitual
        testid="day-close"
        items={items}
        dots={week.dots}
        dotsText={week.text}
        closed={closed}
        ring={ring}
        busy={busy}
        todayKey={today}
        action={{ label: DAY_CLOSE.label, hint: DAY_CLOSE.hint, done: DAY_CLOSE.done }}
        onClose={close}
      />
      <div className={cn("flex flex-wrap items-center gap-2.5", !closed && closedCount === 0 && "hidden")}>
        {closed && (
          <Button variant="secondary" disabled={busy} onClick={reopen} data-testid="day-close-reopen">
            {DAY_CLOSE.reopen}
          </Button>
        )}
        {closedCount > 0 && (
          <span className="text-[11.5px] text-faint" data-testid="day-close-count">
            {DAY_CLOSE.count(closedCount)}
          </span>
        )}
      </div>
    </Card>
  );
}
