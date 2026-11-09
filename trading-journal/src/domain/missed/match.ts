/**
 * Verpasste Chancen (F32): holds the stored signal events (`archive.ts`) against the journal. A signal one could have
 * entered on (rule-conform: a valid entry of the Einstiegs-Check, a Box-zu-Box setup, a confirmed own key level) is
 *
 *   gehandelt         the journal has a trade of the SAME side on the same market inside the window around it
 *   nicht gehandelt   it has not – the case the card lists as „regelgerecht, nicht gehandelt“
 *   offen             the window after the signal has not ended yet (no verdict possible)
 *
 * Window: from `MISSED_LEAD_MS` before the signal (a trade just before the signal belongs to it) to `MISSED_WINDOW_MS`
 * after it. A trade whose pair cannot be read counts as a match (the doubt goes to the trader, never into the list). Signals
 * from before the journal's first trade are left out – the journal did not exist yet.
 *
 * What this cannot say, and does not pretend to: whether the trader skipped a signal on purpose or overlooked it; and
 * whether it would have worked – the price path after a signal is not archived, so a missed signal has no result and the
 * recurring traits of the missed cases cannot be set against comparable failures. Pure, deterministic.
 */
import { normalizeWatchSymbol } from "../boxes/config";
import type { EnrichedTrade } from "../types";
import { tradeTime } from "@/lib/dates";
import type { SignalEvent } from "./archive";

export const MISSED_WINDOW_MS = 6 * 3_600_000;
export const MISSED_LEAD_MS = 30 * 60_000;

export type SignalVerdict = "gehandelt" | "nicht gehandelt" | "offen";

export interface SignalRow {
  event: SignalEvent;
  verdict: SignalVerdict;
  /** the trades that make it „gehandelt“ (time order) */
  trades: EnrichedTrade[];
}

export interface MissedReport {
  /** every entry signal inside the journal's time span, newest first */
  rows: SignalRow[];
  missed: SignalRow[];
  traded: SignalRow[];
  open: SignalRow[];
  /** archived events that are no entry (breakouts, targets …, hits without a direction) – shown nowhere as „missed“ */
  context: number;
  /** events before the journal's first trade (not judged) */
  beforeJournal: number;
  /** all events in the archive */
  total: number;
  /** oldest / newest archived event (ms), `null` when empty */
  since: number | null;
  until: number | null;
}

export interface MatchOptions {
  windowMs?: number;
  leadMs?: number;
}

/** Does `t` belong to `e`? */
export function tradeMatchesSignal(e: Pick<SignalEvent, "at" | "side" | "symbol">, t: Pick<EnrichedTrade, "side" | "date" | "pair" | "createdAt">, opts: MatchOptions = {}): boolean {
  if (!e.side || t.side !== e.side) return false;
  const at = +tradeTime(t);
  if (!Number.isFinite(at)) return false;
  if (at < e.at - (opts.leadMs ?? MISSED_LEAD_MS) || at > e.at + (opts.windowMs ?? MISSED_WINDOW_MS)) return false;
  const sym = e.symbol ? normalizeWatchSymbol(e.symbol) : null;
  const pair = t.pair ? normalizeWatchSymbol(t.pair) : null;
  return !sym || !pair || sym === pair;
}

/** The signal events against the trades of the account view (open ones included) at `now`. */
export function matchSignals(events: readonly SignalEvent[], trades: readonly EnrichedTrade[], now: number, opts: MatchOptions = {}): MissedReport {
  const windowMs = opts.windowMs ?? MISSED_WINDOW_MS;
  const times = trades.map((t) => +tradeTime(t)).filter(Number.isFinite);
  const first = times.length ? Math.min(...times) : null;
  const rows: SignalRow[] = [];
  let context = 0;
  let beforeJournal = 0;
  for (const e of [...events].sort((a, b) => b.at - a.at)) {
    if (!e.entry || !e.side) {
      context++;
      continue;
    }
    if (first == null || e.at + windowMs < first) {
      beforeJournal++;
      continue;
    }
    const hit = trades.filter((t) => tradeMatchesSignal(e, t, opts)).sort((a, b) => +tradeTime(a) - +tradeTime(b));
    const verdict: SignalVerdict = hit.length ? "gehandelt" : e.at + windowMs > now ? "offen" : "nicht gehandelt";
    rows.push({ event: e, verdict, trades: hit });
  }
  const at = events.map((e) => e.at);
  return {
    rows,
    missed: rows.filter((r) => r.verdict === "nicht gehandelt"),
    traded: rows.filter((r) => r.verdict === "gehandelt"),
    open: rows.filter((r) => r.verdict === "offen"),
    context,
    beforeJournal,
    total: events.length,
    since: at.length ? Math.min(...at) : null,
    until: at.length ? Math.max(...at) : null,
  };
}
