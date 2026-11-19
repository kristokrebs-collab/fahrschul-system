/**
 * "Heute abschließen" (Paket F2) – what a day's closing looks at, and the week of dots next to it. It merges with the weekly closing
 * (`WeekCloseCard`) instead of living beside it: the same ritual, the same quiet confirmation (`processDone`), the same discipline
 * predicate the streaks use (`journalDayOk` – every closed trade reviewed, or a note / check-in) – no second definition of a "good day".
 *
 * PROCESS only. Never in here: a profit, a loss, a number of trades, an order. The three items are
 *   checklist   every trade of the day that HAS a checklist is fully ticked        (n/a without such a trade)
 *   review      every closed trade of the day has a review                           (n/a without a closed trade)
 *   reflection  the day has a note, a plan, a review text or a check-in             (the way a day without trades counts)
 * `dayCloseReady`: the closing earns its confirmation when every required item is done – checklist and review where they apply, and on a
 * day without such trades the reflection. A day closed with something still open is recorded, quietly, without the confirmation.
 *
 * The week: `weekDots` marks each day "done" (by `journalDayOk`), "today" (still open today – never a miss), "rest" (a past day without
 * trades or text – neutral, not a gap) or "later". There is no red, no "missed", no streak that falls here. Pure.
 */
import { hasCheckin, hasDayText } from "../psych/checkin";
import { reviewed } from "../coach/recommendations";
import type { Prepared } from "./context";
import { addDays } from "./habits";
import { journalDayOk } from "./streaks";

export type CloseItemId = "checklist" | "review" | "reflection";
export type CloseItemState = "done" | "open" | "na";

export interface CloseItem {
  id: CloseItemId;
  label: string;
  state: CloseItemState;
  /** one sober line: "2 von 3 Trades vollständig" */
  detail: string;
}

export const CLOSE_LABEL: Readonly<Record<CloseItemId, string>> = {
  checklist: "Checkliste vollständig",
  review: "Review geschrieben",
  reflection: "Notiz oder Check-in",
};

const trades = (n: number): string => `${n} ${n === 1 ? "Trade" : "Trades"}`;

/** The three items of a day (local key "YYYY-MM-DD"), from the real journal. */
export function dayCloseItems(p: Prepared, key: string): CloseItem[] {
  const day = p.byDay.get(key) ?? [];
  const withList = day.filter((t) => t.complete !== null);
  const listDone = withList.filter((t) => t.complete === true).length;
  const closed = day.filter((t) => t.result !== "open");
  const revDone = closed.filter(reviewed).length;
  const note = p.days[key];
  const wrote = hasDayText(note) || hasCheckin(note);
  return [
    {
      id: "checklist",
      label: CLOSE_LABEL.checklist,
      state: !withList.length ? "na" : listDone === withList.length ? "done" : "open",
      detail: !withList.length ? "Heute kein Trade mit Checkliste." : `${listDone} von ${trades(withList.length)} vollständig.`,
    },
    {
      id: "review",
      label: CLOSE_LABEL.review,
      state: !closed.length ? "na" : revDone === closed.length ? "done" : "open",
      detail: !closed.length ? "Heute kein abgeschlossener Trade." : `${revDone} von ${trades(closed.length)} mit Review.`,
    },
    { id: "reflection", label: CLOSE_LABEL.reflection, state: wrote ? "done" : "open", detail: wrote ? "Heute steht Text oder ein Check-in im Journal." : "Noch nichts für heute eingetragen." },
  ];
}

/** Every REQUIRED item is done (checklist / review where they apply; on a day without them the reflection). */
export function dayCloseReady(items: readonly CloseItem[]): boolean {
  const by = (id: CloseItemId) => items.find((i) => i.id === id)?.state ?? "na";
  const required = (["checklist", "review"] as const).filter((id) => by(id) !== "na");
  return required.length ? required.every((id) => by(id) === "done") : by("reflection") === "done";
}

/** What is still open, as a sober sentence ("Noch offen: Review, Checkliste."), `""` when nothing is. */
export function openItemsText(items: readonly CloseItem[]): string {
  const open = items.filter((i) => i.state === "open" && (i.id !== "reflection" || items.every((x) => x.id === "reflection" || x.state === "na")));
  return open.length ? `Noch offen: ${open.map((i) => i.label.replace(" vollständig", "").replace(" geschrieben", "")).join(", ")}.` : "";
}

export type DotState = "done" | "today" | "rest" | "later";

export interface WeekDot {
  key: string;
  /** "Mo" … "So" */
  short: string;
  state: DotState;
  /** the spoken form: "Montag 05.10.: Rückblick gemacht" */
  label: string;
}

const SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;
const LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;

/** The seven day keys of the week that starts on `monday` (a "YYYY-MM-DD" key). */
export const weekKeys = (monday: string): string[] => Array.from({ length: 7 }, (_, i) => addDays(monday, i));

/** The dots of one week: process days from `journalDayOk`, today open, the rest neutral. */
export function weekDots(p: Prepared, keys: readonly string[]): { dots: WeekDot[]; done: number } {
  const dots = keys.map((key, i): WeekDot => {
    const ok = journalDayOk(p, key);
    const state: DotState = ok ? "done" : key > p.todayKey ? "later" : key === p.todayKey ? "today" : "rest";
    const date = `${key.slice(8, 10)}.${key.slice(5, 7)}.`;
    const what = state === "done" ? "Rückblick gemacht" : state === "today" ? "heute noch offen" : state === "later" ? "noch nicht dran" : "kein Rückblick nötig oder nicht erfasst";
    return { key, short: SHORT[i]!, state, label: `${LONG[i]} ${date}: ${what}` };
  });
  return { dots, done: dots.filter((d) => d.state === "done").length };
}

/** "4 von 7 Tagen mit Rückblick" for a finished week, "4 Tage mit Rückblick bisher" for the running one – never a shortfall. */
export const weekDotsText = (done: number, running: boolean): string => (running ? (done === 0 ? "Noch kein Tag mit Rückblick in dieser Woche" : `${done} ${done === 1 ? "Tag" : "Tage"} mit Rückblick bisher`) : `${done} von 7 Tagen mit Rückblick`);
