/**
 * Duplicates against the journal, beyond the import's own check (`@/journal/extract/dedupe`, entry price ± 0.05 % and
 * time ± 10 min) – PURE. A screenshot shows the exchange app's clock in a zone it does not name; a trade that the
 * Bitunix sync (or an earlier import) wrote in another zone differs by whole hours. So a trade with the SAME market,
 * side, entry, exit and quantity whose entry time differs by (almost exactly) whole hours up to ± 14 h is reported as
 * a probable duplicate too – with the reason, never silently.
 */
import type { Trade } from "@/domain/types";
import { averagePrice, firstAt, pairKey, totalQty, type Candidate } from "@/journal/extract/candidate";
import { storedEntry, storedExit } from "@/journal/extract/dedupe";
import { minutesBetween } from "@/journal/extract/time";

const near = (a: number, b: number, tol: number): boolean => b !== 0 && Math.abs(a - b) / Math.abs(b) <= tol;

export function findDuplicateLoose(c: Candidate, trades: readonly Trade[]): { text: string; trade: Trade } | null {
  const entry = averagePrice(c.entries);
  const exit = averagePrice(c.exits);
  const qty = totalQty(c.entries) ?? totalQty(c.exits);
  const at = firstAt(c.entries);
  const key = pairKey(c.pair.value);
  if (!key || !c.side.value || entry == null || exit == null || !at) return null;
  for (const t of trades) {
    if (pairKey(t.pair) !== key || t.side !== c.side.value) continue;
    const e = storedEntry(t);
    const x = storedExit(t);
    if (e == null || x == null || !near(entry, e, 0.0005) || !near(exit, x, 0.0005)) continue;
    const q = t.qty ?? (t.size && e ? t.size / e : null);
    if (qty != null && q != null && !near(qty, q, 0.005)) continue;
    const minutes = minutesBetween(t.date.length === 16 ? `${t.date}:00` : t.date, at);
    if (!Number.isFinite(minutes)) continue;
    const abs = Math.abs(minutes);
    if (abs <= 10) return { text: `Wahrscheinlich schon vorhanden: ${t.pair} ${t.side === "long" ? "Long" : "Short"} vom ${t.date.replace("T", " ")} (gleiche Preise und Menge).`, trade: t };
    const hours = Math.round(abs / 60);
    if (hours >= 1 && hours <= 14 && Math.abs(abs - hours * 60) <= 2) return { text: `Wahrscheinlich schon vorhanden: ${t.pair} ${t.side === "long" ? "Long" : "Short"} vom ${t.date.replace("T", " ")} – gleiche Preise und Menge, die Zeit weicht um genau ${hours} Stunde${hours === 1 ? "" : "n"} ab (andere Zeitzone?).`, trade: t };
  }
  return null;
}
