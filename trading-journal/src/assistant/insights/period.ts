/**
 * The period a question names: „heute“, „gestern“, „diese / letzte Woche“, „diesen / letzten Monat“, a month by name
 * („im September“, optionally with a year). Local time, ISO weeks (`@/domain/reports/periods`). The LAST mention wins, so a
 * follow-up that appends „und letzte Woche?“ to the old question changes the period. A month named without a year is the
 * most recent one that has begun: asked in October, „September“ is this year's, „November“ is last year's.
 */
import { periodOf, shiftPeriod, type ReportKind, type ReportPeriod } from "@/domain/reports/periods";
import { near, tokensOf } from "../fuzzy";

const MONTHS = ["januar", "februar", "maerz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"] as const;
/** exact short forms; the long names also match with a typo */
const SHORT: Readonly<Record<string, number>> = { feb: 1, mrz: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, okt: 9, nov: 10, dez: 11 };

function monthOf(tok: string): number | null {
  if (tok in SHORT) return SHORT[tok]!;
  const i = MONTHS.findIndex((m) => (m.length <= 4 ? tok === m : near(tok, m)));
  return i >= 0 ? i : null;
}

const PAST = ["letzt", "vorig", "vergangen", "vorletzt", "zuletzt"];
const THIS = ["dies", "aktuell", "laufend"];

export interface Mention {
  period: ReportPeriod;
  /** the words that named it, for the answer ("letzte Woche") */
  said: string;
}

/** The last period named in `norm`, or `null`. */
export function periodMentioned(norm: string, now: number): Mention | null {
  const t = tokensOf(norm);
  let found: Mention | null = null;
  const kindOf = (w: string): ReportKind | null => (w.startsWith("woche") ? "week" : w.startsWith("monat") ? "month" : null);
  for (let i = 0; i < t.length; i++) {
    const w = t[i]!;
    if (w === "heute") found = { period: periodOf("day", now), said: "heute" };
    else if (w === "gestern") found = { period: shiftPeriod(periodOf("day", now), -1), said: "gestern" };
    else {
      const k = kindOf(w);
      if (k) {
        const before = t[i - 1] ?? "";
        const base = periodOf(k, now);
        if (PAST.some((p) => before.startsWith(p))) found = { period: shiftPeriod(base, before.startsWith("vorletzt") ? -2 : -1), said: `${before} ${w}` };
        else if (THIS.some((p) => before.startsWith(p))) found = { period: base, said: `${before} ${w}` };
        continue;
      }
      const m = monthOf(w);
      if (m != null) {
        const y = /^20\d\d$/.test(t[i + 1] ?? "") ? Number(t[i + 1]) : null;
        const cur = new Date(now);
        const year = y ?? (m > cur.getMonth() ? cur.getFullYear() - 1 : cur.getFullYear());
        found = { period: periodOf("month", new Date(year, m, 1)), said: y ? `${w} ${y}` : w };
      }
    }
  }
  return found;
}
