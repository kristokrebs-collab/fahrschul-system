/**
 * Persönlicher Signal-Posteingang (F28): the archived signal events as a calm list with a status per event and an order by
 * relevance for THIS trader. Pure, deterministic; the stored marks (seen / left out with a reason / linked trade) live on the
 * event (`archive.ts`), the journal is read, never changed.
 *
 * Status (first rule that applies):
 *   gehandelt     the journal has a trade of the same side on the same market inside the window around it (`match.ts`), or the
 *                 trader linked a trade by hand
 *   ausgelassen   the trader left it out on purpose and gave a reason
 *   abgelaufen    the window after the signal has ended and nothing of the above happened
 *   angesehen     the trader opened it
 *   neu           nothing yet
 * Only entries with a direction can be „gehandelt“ by the window rule; the other events (breakouts, targets …) are context and
 * can be seen, left out or expire.
 *
 * Relevance (the order, written out so it can be checked): status first (neu 400 · angesehen 300 · abgelaufen 100 · gehandelt 60 ·
 * ausgelassen 40), then +50 for an entry, +30 when the trader has trades on that market, +5 per strength step of the
 * entry check (1–4) and up to +20 for recency (−1 per hour). Ties: newest first. No model, no hidden weighting.
 */
import { normalizeWatchSymbol } from "../boxes/config";
import type { EnrichedTrade } from "../types";
import { tradeTime } from "@/lib/dates";
import { SKIP_LABEL, type SignalEvent } from "./archive";
import { MISSED_WINDOW_MS, tradeMatchesSignal } from "./match";

export type InboxStatus = "neu" | "angesehen" | "gehandelt" | "ausgelassen" | "abgelaufen";
export const INBOX_STATUSES: readonly InboxStatus[] = ["neu", "angesehen", "gehandelt", "ausgelassen", "abgelaufen"];
export const STATUS_LABEL: Readonly<Record<InboxStatus, string>> = { neu: "Neu", angesehen: "Angesehen", gehandelt: "Gehandelt", ausgelassen: "Bewusst ausgelassen", abgelaufen: "Abgelaufen" };
const STATUS_WEIGHT: Readonly<Record<InboxStatus, number>> = { neu: 400, angesehen: 300, abgelaufen: 100, gehandelt: 60, ausgelassen: 40 };

export interface InboxRow {
  event: SignalEvent;
  status: InboxStatus;
  /** the journal trades that make it „gehandelt“ (time order; the linked one first when linked by hand) */
  trades: EnrichedTrade[];
  /** the trader has trades on this market in the journal */
  myMarket: boolean;
  /** an entry with a direction (can be missed) – the rest is context */
  entry: boolean;
  relevance: number;
  /** the line „ausgelassen: Grund“, `null` otherwise */
  skipText: string | null;
}

export interface InboxReport {
  rows: InboxRow[];
  counts: Record<InboxStatus, number>;
  total: number;
  /** markets (normalised) the journal has trades on */
  markets: number;
}

export interface InboxFilter {
  status: InboxStatus | "alle";
  /** only markets the trader has trades on */
  mine: boolean;
  /** only entries (no breakouts / targets …) */
  entries: boolean;
}

export const DEFAULT_INBOX_FILTER: InboxFilter = { status: "alle", mine: false, entries: false };

const HOUR = 3_600_000;

/** The inbox of `events` against the journal at `now`. */
export function buildInbox(events: readonly SignalEvent[], trades: readonly EnrichedTrade[], now: number, windowMs: number = MISSED_WINDOW_MS): InboxReport {
  const mkt = new Set<string>();
  for (const t of trades) {
    const m = t.pair ? normalizeWatchSymbol(t.pair) : null;
    if (m) mkt.add(m);
  }
  const byId = new Map(trades.map((t) => [t.id, t]));
  const counts: Record<InboxStatus, number> = { neu: 0, angesehen: 0, gehandelt: 0, ausgelassen: 0, abgelaufen: 0 };
  const rows: InboxRow[] = [];
  for (const e of events) {
    const entry = e.entry && e.side != null;
    const linked = e.tradeId ? byId.get(e.tradeId) : undefined;
    const hit = entry ? trades.filter((t) => tradeMatchesSignal(e, t)).sort((a, b) => +tradeTime(a) - +tradeTime(b)) : [];
    const matched = linked ? [linked, ...hit.filter((t) => t.id !== linked.id)] : hit;
    const status: InboxStatus = matched.length ? "gehandelt" : e.skip ? "ausgelassen" : now > e.at + windowMs ? "abgelaufen" : e.seenAt != null ? "angesehen" : "neu";
    const sym = e.symbol ? normalizeWatchSymbol(e.symbol) : null;
    const myMarket = sym != null && mkt.has(sym);
    const age = Math.max(0, now - e.at) / HOUR;
    const relevance = STATUS_WEIGHT[status] + (entry ? 50 : 0) + (myMarket ? 30 : 0) + (e.strength != null ? Math.min(4, Math.max(0, Math.round(e.strength))) * 5 : 0) + Math.max(0, 20 - Math.floor(age));
    counts[status] += 1;
    rows.push({ event: e, status, trades: matched, myMarket, entry, relevance, skipText: e.skip ? SKIP_LABEL[e.skip] : null });
  }
  rows.sort((a, b) => b.relevance - a.relevance || b.event.at - a.event.at);
  return { rows, counts, total: rows.length, markets: mkt.size };
}

/** The rows that pass the filter (order kept). */
export function filterInbox(rows: readonly InboxRow[], f: InboxFilter): InboxRow[] {
  return rows.filter((r) => (f.status === "alle" || r.status === f.status) && (!f.mine || r.myMarket) && (!f.entries || r.entry));
}

/** One sentence that states the order (shown under the list). */
export const INBOX_ORDER_NOTE = "Reihenfolge: Neues zuerst, dann Angesehenes; Einstiege vor Ereignissen, Märkte die du handelst vor anderen, stärkere vor schwächeren, frische vor alten.";

/* ------------------------------------------------------------------ labels, link candidates */

const KIND_TEXT: Readonly<Record<string, string>> = {
  entry: "Einstiegs-Check",
  setup: "Box-Setup",
  scan: "Box-Scanner",
  breakout: "Ausbruch",
  retest: "Retest",
  failed: "Fehlausbruch",
  target: "Ziel erreicht",
  confirm: "Bestätigung",
};

/** „Einstiegs-Check“, „Box-Setup“, „Schlüsselmarke · Bestätigung“ … – the kind of an event for a human. */
export function signalKindLabel(e: Pick<SignalEvent, "source" | "kind">): string {
  const k = KIND_TEXT[e.kind] ?? e.kind;
  if (e.source === "key") return `Schlüsselmarke · ${k}`;
  if (e.source === "box" && (e.kind === "breakout" || e.kind === "retest" || e.kind === "failed" || e.kind === "target")) return `Box · ${k}`;
  return k;
}

/** The „Stufe“ of an event: the strength of the entry check, the grade of a Box setup, else `null`. */
export function signalLevelLabel(e: Pick<SignalEvent, "strength" | "grade">): string | null {
  return e.strength != null ? `Stärke ${e.strength}` : e.grade ? `Note ${e.grade}` : null;
}

/** Hours either side of a signal in which a trade can be linked to it by hand. */
export const LINK_WINDOW_MS = 24 * HOUR;

/** The journal trades a signal can be linked to by hand: same market (or an unreadable pair) within ±24 h, nearest first. */
export function linkCandidates(e: Pick<SignalEvent, "at" | "symbol" | "tradeId">, trades: readonly EnrichedTrade[], max = 5): EnrichedTrade[] {
  const sym = e.symbol ? normalizeWatchSymbol(e.symbol) : null;
  return trades
    .filter((t) => {
      const at = +tradeTime(t);
      if (!Number.isFinite(at) || Math.abs(at - e.at) > LINK_WINDOW_MS || t.id === e.tradeId) return false;
      const pair = t.pair ? normalizeWatchSymbol(t.pair) : null;
      return !sym || !pair || sym === pair;
    })
    .sort((a, b) => Math.abs(+tradeTime(a) - e.at) - Math.abs(+tradeTime(b) - e.at))
    .slice(0, max);
}
