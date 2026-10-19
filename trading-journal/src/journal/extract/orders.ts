/**
 * The name of an order in an exchange's order history (F29) – pure.
 *
 * Bitunix („Long öffnen“, „Short schließen“), Binance / Bybit / OKX (Open Long, Close Short, „Sell / Close Long“, …) name
 * what an order DOES to a position: it opens or closes a LONG or SHORT position. The word Long / Short is the position's
 * side, never the direction of the order itself („Long schließen“ is a sell that ends a long position). The colour the
 * app paints the name in (red / green) is the order's buy / sell side and says nothing about profit, loss or the
 * position's direction – it never reaches this function.
 *
 * The client reads the displayed name deterministically, so the model's own `side` / entry-or-exit sorting is checked
 * against what the screenshot literally says.
 */
import type { Side } from "@/domain/types";

export interface OrderAction {
  /** `open` = entry into the position, `close` = exit from it. */
  action: "open" | "close";
  /** The POSITION's side the order works on. */
  side: Side;
}

// `\b` knows no umlauts: the word edges are "not next to a letter" instead
const word = (alt: string): RegExp => new RegExp(String.raw`(?<![\p{L}])(?:${alt})(?![\p{L}])`, "iu");
const OPEN = word("öffnen|oeffnen|eröffnen|eroeffnen|eröffnung|open|opening|entry");
const CLOSE = word("schließen|schliessen|schließung|glattstellen|close|closed|closing|reduce|liquidation|liquidated|exit");
const LONG = word("long");
const SHORT = word("short");

/** Reads „Long öffnen“, „Short schließen“, „Open Long“, „Close Short“, „Long Close“ … `null` when the name is not one of them. */
export function parseOrderLabel(label: string | null | undefined): OrderAction | null {
  if (!label) return null;
  const t = String(label).normalize("NFC");
  const open = OPEN.test(t);
  const close = CLOSE.test(t);
  if (open === close) return null; // neither, or both: not decidable
  const long = LONG.test(t);
  const short = SHORT.test(t);
  if (long === short) return null;
  return { action: open ? "open" : "close", side: long ? "long" : "short" };
}
