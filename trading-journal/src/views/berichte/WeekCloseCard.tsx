/**
 * "Wochenabschluss" (Paket P, docs/PSYCHOLOGIE.md) – the end of the week report: it closes on BEHAVIOUR, not on the result.
 *
 *   Verhalten dieser Woche   the discipline finding of the Wochenreview (rule breaks, patterns, discipline score) – no P&L, no verdict
 *   Eine Lektion für morgen  the trader's own sentence (optional, ≤ 200 characters, kept with the week; the IKEA effect, honestly)
 *   Rückblick abschließen    marks the review as done in `settings.coach.reviews` (synced); a quiet process confirmation follows
 *                            (`processDone("weekReview")`: toast + optional vibration / tone). "Wieder öffnen" takes it back at any time.
 *   Erinnerung               the opt-in reminder (`reviewReminder.ts`): OFF, in-app, once a week at most, quiet hours.
 *
 * Only for a finished week with trades. Nothing here asks for an upgrade, counts down or compares with other people.
 */
import { useId, useMemo, useState } from "react";
import { LESSON_MAX, weekClosesOf, withWeekClosed } from "@/domain/coach";
import { weekReview } from "@/domain/reports";
import { cn } from "@/lib/cn";
import { processDone } from "@/motion/processFeedback";
import { Switch } from "@/motion/Switch";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { inputClass, Input } from "@/primitives/Input";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import type { ReportPage } from "./hooks";
import { REMINDER_DAYS, REMINDER_STRINGS, useReminderPref } from "./reviewReminder";

export const WEEK_CLOSE = {
  title: "Wochenabschluss",
  note: "Ein ruhiger Schluss: wie du dich verhalten hast und eine Lektion für morgen – kein Ergebnis, kein Urteil.",
  open: (kw: string) => `Dein Rückblick für ${kw} ist noch offen.`,
  closedOn: (kw: string, date: string) => `Rückblick für ${kw} abgeschlossen${date ? ` am ${date}` : ""}.`,
  behaviour: "Verhalten dieser Woche",
  lesson: "Eine Lektion für morgen",
  lessonHint: "Optional – ein Satz in deinen Worten.",
  placeholder: "z. B. Erst den Stop setzen, dann auf Kaufen tippen.",
  close: "Rückblick abschließen",
  reopen: "Wieder öffnen",
  reopened: "Der Rückblick ist wieder offen.",
  failed: "Nicht gespeichert",
  retry: "Bitte noch einmal versuchen.",
  count: (n: number) => (n === 1 ? "Ein Wochenrückblick abgeschlossen." : `${n} Wochenrückblicke abgeschlossen.`),
  noBehaviour: "Für diese Woche gibt es keine Verhaltensdaten – der Abschluss ist trotzdem möglich.",
} as const;

const fmtDay = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(+d) ? "" : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number): string => `${String(h).padStart(2, "0")}:00`;

/** Should the card show for this page: a finished week report with trades, focus „Alles“. */
export const weekCloseVisible = (page: Pick<ReportPage, "kind" | "report">): boolean => page.kind === "week" && page.report.complete && !page.report.empty;

function ReminderRow() {
  const uid = useId();
  const pref = useReminderPref();
  const set = useReminderPref((s) => s.set);
  const S = REMINDER_STRINGS;
  return (
    <section className="grid gap-3 border-t border-line pt-4" aria-label={S.title} data-testid="reminder">
      <div className="flex min-h-11 items-center justify-between gap-3">
        <label htmlFor={`${uid}-on`} className="min-w-0 text-[13px]">
          {S.title}
        </label>
        <Switch id={`${uid}-on`} aria-label={S.title} checked={pref.on} onCheckedChange={(on) => set({ on })} data-testid="reminder-on" />
      </div>
      <p className="text-[11.5px] leading-relaxed text-faint">{pref.on ? S.note : S.lead}</p>
      {pref.on && (
        <div className="grid gap-2.5 sm:grid-cols-2" data-testid="reminder-options">
          <div className="grid gap-1.5">
            <label htmlFor={`${uid}-day`} className="text-[12.5px] font-medium">
              {S.day}
            </label>
            <select id={`${uid}-day`} className={cn(inputClass, "pointer-coarse:min-h-11")} value={pref.day} onChange={(e) => set({ day: Number(e.target.value) })} data-testid="reminder-day">
              {REMINDER_DAYS.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${uid}-hour`} className="text-[12.5px] font-medium">
              {S.hour}
            </label>
            <select id={`${uid}-hour`} className={cn(inputClass, "pointer-coarse:min-h-11")} value={pref.hour} onChange={(e) => set({ hour: Number(e.target.value) })} data-testid="reminder-hour">
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <span className="text-[12.5px] font-medium" id={`${uid}-quiet`}>
              {S.quiet}
            </span>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${uid}-quiet`}>
              <select aria-label={`${S.quiet} ${S.quietFrom}`} className={cn(inputClass, "w-auto pointer-coarse:min-h-11")} value={pref.quietFrom} onChange={(e) => set({ quietFrom: Number(e.target.value) })} data-testid="reminder-quiet-from">
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
              <span className="text-[12px] text-mute">{S.quietTo}</span>
              <select aria-label={`${S.quiet} ${S.quietTo}`} className={cn(inputClass, "w-auto pointer-coarse:min-h-11")} value={pref.quietTo} onChange={(e) => set({ quietTo: Number(e.target.value) })} data-testid="reminder-quiet-to">
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export function WeekCloseCard({ page, className }: { page: ReportPage; className?: string }) {
  const { report, events, settings, period } = page;
  const saveSettings = useJournal((s) => s.saveSettings);
  const uid = useId();
  const stored = weekClosesOf(settings)[period.key];
  const closed = stored?.closed === true;
  const closedCount = useMemo(() => Object.values(weekClosesOf(settings)).filter((w) => w.closed).length, [settings]);
  const behaviour = useMemo(() => weekReview({ report, events, settings }).findings.find((f) => f.id === "discipline") ?? null, [report, events, settings]);
  // the draft follows the stored sentence of THIS week (adjusting state while rendering, no effect round trip)
  const [forKey, setForKey] = useState(period.key);
  const [draft, setDraft] = useState(stored?.lesson ?? "");
  if (forKey !== period.key) {
    setForKey(period.key);
    setDraft(stored?.lesson ?? "");
  }
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      after?.();
    } catch {
      pushToast({ kind: "error", title: WEEK_CLOSE.failed, detail: WEEK_CLOSE.retry });
    } finally {
      setBusy(false);
    }
  };
  const close = () =>
    void run(
      () => saveSettings(withWeekClosed(useJournal.getState().settings, period.key, { closed: true, lesson: draft }, Date.now())),
      () => processDone("weekReview", `${period.short} – ${draft.trim() ? "mit deiner Lektion für morgen." : "eingeordnet."}`),
    );
  const reopen = () => void run(() => saveSettings(withWeekClosed(useJournal.getState().settings, period.key, { closed: false }, Date.now())), () => pushToast({ kind: "info", title: WEEK_CLOSE.reopened }));

  return (
    <Card title={WEEK_CLOSE.title} note={WEEK_CLOSE.note} className={className} data-testid="week-close" data-state={closed ? "closed" : "open"} innerClassName="grid content-start gap-4">
      <p className="text-[13px] text-fg" data-testid="week-close-state">
        {closed ? WEEK_CLOSE.closedOn(period.short, fmtDay(stored?.at ?? "")) : WEEK_CLOSE.open(period.short)}
      </p>

      <section className="grid gap-1.5 rounded-xl border border-line bg-ink-950/50 px-3 py-3" aria-label={WEEK_CLOSE.behaviour} data-testid="week-close-behaviour">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-mute">{WEEK_CLOSE.behaviour}</span>
        {behaviour && behaviour.headline !== "Keine Disziplin-Daten" ? (
          <>
            <p className="text-[13.5px] leading-snug text-fg">{behaviour.headline}</p>
            {behaviour.lines.map((l, i) => (
              <p key={i} className="text-[12px] leading-relaxed text-mute">
                {l}
              </p>
            ))}
          </>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-mute">{WEEK_CLOSE.noBehaviour}</p>
        )}
      </section>

      <div className="grid gap-1.5">
        <label htmlFor={`${uid}-lesson`} className="text-[12.5px] font-medium">
          {WEEK_CLOSE.lesson}
        </label>
        <Input
          id={`${uid}-lesson`}
          data-testid="week-close-lesson"
          value={draft}
          maxLength={LESSON_MAX}
          disabled={closed}
          placeholder={WEEK_CLOSE.placeholder}
          onChange={(e) => setDraft(e.target.value)}
        />
        <span className="text-[11.5px] text-faint">{WEEK_CLOSE.lessonHint}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {closed ? (
          <Button variant="secondary" disabled={busy} onClick={reopen} data-testid="week-close-reopen">
            {WEEK_CLOSE.reopen}
          </Button>
        ) : (
          <Button variant="primary" disabled={busy} onClick={close} data-testid="week-close-done">
            {WEEK_CLOSE.close}
          </Button>
        )}
        {closedCount > 0 && (
          <span className="text-[11.5px] text-faint" data-testid="week-close-count">
            {WEEK_CLOSE.count(closedCount)}
          </span>
        )}
      </div>

      <ReminderRow />
    </Card>
  );
}
