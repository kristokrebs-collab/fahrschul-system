/** Sorting and searching the Ampel's tiles – pure, so the order is testable without a screen. */
import type { AmpelRow } from "@/domain/industryTrend";
import type { SortKey } from "./store";

/** Lower case without accents: "Rüstung" → "rustung". */
const fold = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss");

/** The same, with umlauts spelled the German way ("Rüstung" → "ruestung"), so both ways of typing find it. */
const foldDe = (s: string): string => fold(s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue"));

/** Rows whose name or code contains the typed words (every word must be found); `onlyBuy` keeps the green ones. */
export function filterRows(rows: readonly AmpelRow[], query: string, onlyBuy: boolean): AmpelRow[] {
  const words = foldDe(query).split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (onlyBuy && r.state !== "kauf") return false;
    if (!words.length) return true;
    const hay = `${fold(r.name)} ${foldDe(r.name)} ${fold(r.code)}`;
    return words.every((w) => hay.includes(w));
  });
}

const byName = (a: AmpelRow, b: AmpelRow): number => a.name.localeCompare(b.name, "de");

/**
 * signal   green first (the biggest weight first), then red, each by name
 * wechsel  the newest change first; never-changed ones last
 * gewicht  the biggest target weight first, cash at the end
 * name     A–Z
 */
export function sortRows(rows: readonly AmpelRow[], key: SortKey): AmpelRow[] {
  const list = [...rows];
  switch (key) {
    case "signal":
      return list.sort((a, b) => (a.state === b.state ? (a.state === "kauf" ? b.weight - a.weight || byName(a, b) : byName(a, b)) : a.state === "kauf" ? -1 : 1));
    case "wechsel":
      return list.sort((a, b) => (a.since === b.since ? byName(a, b) : a.since === null ? 1 : b.since === null ? -1 : b.since - a.since));
    case "gewicht":
      return list.sort((a, b) => b.weight - a.weight || byName(a, b));
    default:
      return list.sort(byName);
  }
}
