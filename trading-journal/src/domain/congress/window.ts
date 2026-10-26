/**
 * Which filings the tracker reads. The Clerk's index lists every Periodic Transaction Report of a year with its filing DATE
 * (not the trades' dates – those are only known after a report is read), so "Zeitraum" means "gemeldet in den letzten …": the
 * window is applied to the filing date and decides which PDFs are fetched. Pure; `today` is passed in (`YYYY-MM-DD`).
 */
import type { CongressFiling } from "@/market/congress/wire";
import { dayNumber, dayOfNumber } from "./delay";

export type WindowId = "7" | "30" | "90" | "year";
export const WINDOWS: readonly { id: WindowId; label: string }[] = [
  { id: "7", label: "7 Tage" },
  { id: "30", label: "30 Tage" },
  { id: "90", label: "90 Tage" },
  { id: "year", label: "Dieses Jahr" },
];
export const DEFAULT_WINDOW: WindowId = "30";
export const isWindowId = (v: unknown): v is WindowId => v === "7" || v === "30" || v === "90" || v === "year";

/** The first filing day (inclusive) of a window. */
export function windowStart(id: WindowId, today: string): string {
  const n = dayNumber(today);
  if (n === null) return "0000-00-00";
  if (id === "year") return `${today.slice(0, 4)}-01-01`;
  return dayOfNumber(n - Number(id));
}

/** The index years a window needs (newest first): a window of days may reach into the year before. */
export function windowYears(id: WindowId, today: string): number[] {
  const year = Number(today.slice(0, 4));
  if (!Number.isFinite(year)) return [];
  return windowStart(id, today).slice(0, 4) === String(year) ? [year] : [year, year - 1];
}

export const inWindow = (f: Pick<CongressFiling, "filed">, id: WindowId, today: string): boolean => f.filed !== null && f.filed >= windowStart(id, today) && f.filed <= today;

/** Names as one lower-case, accent-free string for matching. */
export const plain = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** True when every word of `query` occurs in the member's name or district ("pelosi", "nancy pelosi", "ca11"). */
export function memberMatches(f: Pick<CongressFiling, "name" | "district">, query: string): boolean {
  const q = plain(query);
  if (!q) return true;
  const hay = plain(`${f.name} ${f.district}`);
  return q.split(" ").every((w) => hay.includes(w));
}

export interface Reading {
  /** the filings to read, newest first, at most `cap` */
  filings: CongressFiling[];
  /** how many filings match window and member */
  total: number;
  capped: boolean;
}

/** The filings to read for a window and an optional member, newest first. */
export function selectFilings(filings: readonly CongressFiling[], o: { window: WindowId; today: string; member?: string; cap: number }): Reading {
  const all = filings.filter((f) => inWindow(f, o.window, o.today) && memberMatches(f, o.member ?? ""));
  all.sort((a, b) => (b.filed ?? "").localeCompare(a.filed ?? "") || b.docId.localeCompare(a.docId));
  return { filings: all.slice(0, o.cap), total: all.length, capped: all.length > o.cap };
}

export interface MemberEntry {
  name: string;
  last: string;
  district: string;
  /** reports in the list */
  count: number;
}

/** Members who filed in the list, by last name – for the suggestions of the member field. */
export function membersOf(filings: readonly CongressFiling[]): MemberEntry[] {
  const by = new Map<string, MemberEntry>();
  for (const f of filings) {
    const e = by.get(f.name);
    if (e) e.count++;
    else by.set(f.name, { name: f.name, last: f.last, district: f.district, count: 1 });
  }
  return [...by.values()].sort((a, b) => a.last.localeCompare(b.last, "en") || a.name.localeCompare(b.name, "en"));
}
