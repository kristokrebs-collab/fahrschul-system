/**
 * Query parsing of the stock functions: a list of tickers (upper-cased, de-duplicated, shape-checked, at most `max`).
 * Anything else a caller could put in a URL is refused with 400 before a single upstream request is made.
 */
import { STOCK_SYMBOL } from "../../../../src/market/stocks/types";
import { HttpError } from "../http";

export function parseSymbols(raw: string | null, max: number): string[] {
  const list = [...new Set((raw ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!list.length) throw new HttpError(400, "bad_symbols", "Es fehlt mindestens ein Aktienkürzel (symbols=AAPL,MSFT).");
  if (list.length > max) throw new HttpError(400, "too_many_symbols", `Pro Abruf sind höchstens ${max} Kürzel erlaubt.`);
  const bad = list.filter((s) => !STOCK_SYMBOL.test(s));
  if (bad.length) throw new HttpError(400, "bad_symbols", `Kein gültiges US-Kürzel: ${bad.slice(0, 5).join(", ")}.`);
  return list;
}
