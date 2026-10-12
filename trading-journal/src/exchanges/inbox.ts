/**
 * Sync inbox (P11, pure): imported trades (exchange sync, webhook, REST, CSV) that still lack the trader's part – a
 * setup, a stop or the feeling at entry. "Trade the best": the biggest results first, because those teach the most.
 * Dismissed ids ("Passt so") live per device in `storageKey("exchange-inbox-done")`.
 */
import type { Trade } from "@/domain/types";
import { readJson, storageKey, writeJson } from "@/store/storage";

export type InboxGap = "setup" | "stop" | "emotion";

export interface InboxItem {
  trade: Trade;
  missing: InboxGap[];
  /** |net P&L| – the sort key. */
  weight: number;
}

const IMPORTED = new Set(["api", "webhook", "bot", "csv"]);
const DONE_KEY = storageKey("exchange-inbox-done");
const DONE_MAX = 3000;

export const GAP_LABEL: Readonly<Record<InboxGap, string>> = { setup: "Setup", stop: "Stop", emotion: "Gefühl" };

/** Trade written by an import (not typed by hand). */
export function isImported(t: Pick<Trade, "origin" | "syncSource">): boolean {
  return (!!t.origin && IMPORTED.has(t.origin.kind)) || (typeof t.syncSource === "string" && t.syncSource.length > 0);
}

export function gapsOf(t: Trade): InboxGap[] {
  const out: InboxGap[] = [];
  if (!t.setups?.length) out.push("setup");
  if (t.stop == null || !(t.stop > 0)) out.push("stop");
  if (!t.emotion) out.push("emotion");
  return out;
}

const pnlOf = (t: Trade): number => (typeof t.pnlManual === "number" ? t.pnlManual : typeof t.pnl === "number" ? t.pnl : 0);

/** Imported trades with a gap, not dismissed, biggest |P&L| first (ties: newest first). */
export function syncInbox(trades: readonly Trade[], dismissed: ReadonlySet<string>): InboxItem[] {
  const out: InboxItem[] = [];
  for (const t of trades) {
    if (!isImported(t) || dismissed.has(t.id)) continue;
    const missing = gapsOf(t);
    if (missing.length) out.push({ trade: t, missing, weight: Math.abs(pnlOf(t)) });
  }
  return out.sort((a, b) => b.weight - a.weight || (b.trade.exitDate ?? b.trade.date).localeCompare(a.trade.exitDate ?? a.trade.date));
}

export function readDismissed(): Set<string> {
  const list = readJson<unknown>(DONE_KEY, []);
  return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
}

export function writeDismissed(ids: ReadonlySet<string>): void {
  writeJson(DONE_KEY, [...ids].slice(-DONE_MAX));
}
