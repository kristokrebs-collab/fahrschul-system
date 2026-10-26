/**
 * The reporting delay of a Congress trade: calendar days from the trade date to the day the report was filed. Pure, on plain
 * `YYYY-MM-DD` days (no time zone: both dates are days the filing prints / the Clerk lists).
 *
 * The STOCK Act asks for a report within 30 days of the member learning of a trade and at most 45 days after the trade, so a row
 * is old by the time anyone can read it – the number below is the app's way of saying that, row by row.
 */
import { LATE_AFTER_DAYS } from "@/market/congress/wire";

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 of a real calendar day, `null` for anything else. */
export function dayNumber(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const back = new Date(t);
  if (back.getUTCFullYear() !== Number(m[1]) || back.getUTCMonth() !== Number(m[2]) - 1 || back.getUTCDate() !== Number(m[3])) return null;
  return Math.round(t / DAY_MS);
}

/** `YYYY-MM-DD` of a day number. */
export const dayOfNumber = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

export type DelayProblem = "no-date" | "after-filing";

export interface DelayInfo {
  /** calendar days from trade to filing; `null` when it cannot be stated */
  days: number | null;
  /** more than 45 days */
  late: boolean;
  /** why `days` is `null` */
  problem: DelayProblem | null;
}

/** Trade date → filing date. A trade dated AFTER its filing (a typo in the filing) has no delay and says so. */
export function delayInfo(tradeDate: string | null | undefined, filed: string | null | undefined): DelayInfo {
  const a = dayNumber(tradeDate);
  const b = dayNumber(filed);
  if (a === null || b === null) return { days: null, late: false, problem: "no-date" };
  if (b < a) return { days: null, late: false, problem: "after-filing" };
  const days = b - a;
  return { days, late: days > LATE_AFTER_DAYS, problem: null };
}

/** "28 Tage", "1 Tag", "am selben Tag" – or the reason there is no number. */
export function delayText(d: DelayInfo): string {
  if (d.days === null) return d.problem === "after-filing" ? "nicht berechenbar (Handelsdatum nach dem Meldedatum)" : "keine Daten";
  if (d.days === 0) return "am selben Tag";
  return d.days === 1 ? "1 Tag" : `${d.days} Tage`;
}
