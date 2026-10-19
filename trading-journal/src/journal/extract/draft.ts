/**
 * Candidate → `TradeDraft` for `openEditor({ draft })` (F29) – pure. The draft only PRE-FILLS the editor; nothing is
 * saved until the trader presses „Speichern“.
 *
 * Rules the mapping keeps:
 *  - a planned order becomes an open trade with `plannedEntry` as its entry and NO fills, exit or result;
 *  - executions become `fills` only when there are partial entries / exits and every quantity is known, else plain
 *    entry / exit / size;
 *  - the original stop is never invented: a stop seen on a running or finished position goes into the notes unless the
 *    trader says it was the original (a planned order's stop is the plan);
 *  - the result is the screenshot's (`pnlManual`) when the prices disagree with it, otherwise it is computed;
 *  - the pictures the trade was read from stay attached (`screenshots`).
 */
import type { ScreenshotRef, TradeTarget } from "@/domain/types";
import type { TradeDraft } from "@/store/uiStore";
import { averagePrice, fillsOf, firstAt, lastAt, totalQty, type Candidate } from "./candidate";
import { resolvedPnlMode } from "./checks";
import { fmtPrice } from "./rows";

/** Tag every imported trade carries, so the origin stays visible and filterable. */
export const IMPORT_TAG = "Screenshot-Import";

const clean = (n: number): number => Number(n.toPrecision(12));

export function toDraft(c: Candidate, screenshots: readonly ScreenshotRef[]): TradeDraft {
  const d: TradeDraft = { tags: [IMPORT_TAG] };
  const notes: string[] = [];
  if (c.pair.value) d.pair = c.pair.value;
  if (c.side.value) d.side = c.side.value;
  if (c.kind.value) d.market = c.kind.value;
  if (c.exchange.value) d.exchange = c.exchange.value;
  if (c.leverage.value != null) d.leverage = clean(c.leverage.value);
  if (screenshots.length) d.screenshots = [...screenshots];

  const planned = c.status === "planned";
  const entry = planned ? (c.plannedEntry.value ?? averagePrice(c.entries)) : averagePrice(c.entries);
  if (entry != null) d.entry = clean(entry);
  if (c.plannedEntry.value != null) d.plannedEntry = clean(c.plannedEntry.value);
  if (c.stop.value != null) {
    if (c.stopOriginal) d.stop = clean(c.stop.value);
    else notes.push(`Stop laut Screenshot: ${fmtPrice(clean(c.stop.value))} (Stand im Screenshot – ursprünglicher Stop unbekannt).`);
  }
  const targets = c.targets.map((t) => t.value).filter((v): v is number => v != null);
  if (targets.length) {
    d.target = clean(targets[0]!);
    if (targets.length > 1) d.targets = targets.map((price): TradeTarget => ({ price: clean(price) }));
  }

  if (planned) {
    d.status = "open";
    notes.push("Geplante Order aus dem Screenshot – noch nicht ausgeführt.");
  } else {
    d.status = c.status === "closed" ? "closed" : "open";
    const at = firstAt(c.entries);
    if (at) d.date = at.slice(0, 16);
    const out = averagePrice(c.exits);
    if (out != null) d.exit = clean(out);
    const exitAt = lastAt(c.exits);
    if (exitAt) d.exitDate = exitAt;
    const qty = totalQty(c.entries);
    if (qty != null) {
      d.qty = clean(qty);
      if (entry != null) d.size = clean(entry * qty);
    }
    const fills = fillsOf(c);
    if (fills && (c.entries.length > 1 || c.exits.length > 1)) d.fills = fills;
    if (c.fees.value != null) d.fees = clean(c.fees.value);
    if (c.funding.value != null) d.fundingFees = clean(c.funding.value);
    if (c.status === "closed" && c.pnl.value != null && resolvedPnlMode(c) === "shot") d.pnlManual = clean(c.pnl.value);
  }
  if (notes.length) d.notes = notes.join("\n");
  return d;
}

/** The screenshots (of `all`, by index) a candidate was read from; all of them when it names none. */
export function shotsFor(c: Pick<Candidate, "sources">, all: readonly ScreenshotRef[]): ScreenshotRef[] {
  const picked = c.sources.map((i) => all[i]).filter((r): r is ScreenshotRef => !!r);
  return picked.length ? picked : [...all];
}

/**
 * The pictures of each confirmed draft. A trade keeps the pictures it was read from; pictures of the editor that no
 * confirmed trade claims (a chart, a duplicate the trader skipped) ride along with the FIRST draft, so nothing the
 * trader attached is lost when the editor is re-seeded. At most `max` pictures per draft.
 */
export function assignShots(selected: readonly Pick<Candidate, "sources">[], sent: readonly ScreenshotRef[], all: readonly ScreenshotRef[], max = 12): ScreenshotRef[][] {
  const own = selected.map((c) => shotsFor(c, sent));
  const claimed = new Set(own.flat().map((r) => r.id));
  const extras = all.filter((r) => !claimed.has(r.id));
  return own.map((list, i) => (i === 0 ? [...list, ...extras] : list).slice(0, max));
}
