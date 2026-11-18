/**
 * Vollständige Signalbilanz (F25): every archived entry signal, grouped by kind / setup / timeframe – how many, how many were
 * traded, left out on purpose, expired, still running – and, where an outcome was computed (`outcome.ts`), the hit rate and
 * the mean R with the sample and the uncertainty of EACH row. Pure, deterministic.
 *
 * The comparison „deine Trades gegen alle Signale“ names its own flaw: the signals the trader took are a SELECTION (which
 * signal, when, how big, where out), so a difference to the signals as a whole is not the quality of the signals and not a
 * verdict on the trader – it is the sum of selection, timing and exit. Three numbers sit side by side and none is ranked:
 *   alle Signale        the mean R the signals reached by themselves (own marks or the standard measure)
 *   davon gehandelt     the same signals' own outcome, and the R the journal booked on the trades that belong to them
 *   nicht gehandelt     the outcome of the signals left out or expired
 * Open and unusable outcomes are not counted in any rate. The basis (marks of the signal / standard measure) can be filtered
 * so the two readings are never averaged together without the reader choosing it.
 */
import { meanCI, wilson, type Interval } from "../analytics/stats";
import type { EnrichedTrade } from "../types";
import { SOURCE_LABEL, type SignalEvent } from "./archive";
import { buildInbox, type InboxRow } from "./inbox";
import { isDecided, type OutcomeBasis, type OutcomeMap } from "./outcome";
import { ruleLabel } from "./rules";

export type BalanceGroup = "type" | "setup" | "tf" | "rules";
export const BALANCE_GROUP_LABEL: Readonly<Record<BalanceGroup, string>> = { type: "Signalart", setup: "Setup", tf: "Zeiteinheit", rules: "Regelstand" };
export type BasisFilter = "all" | OutcomeBasis;
export const BASIS_FILTER_LABEL: Readonly<Record<BasisFilter, string>> = { all: "Beides", own: "Marken des Signals", standard: "Standardmaß" };

/** Sample words, like the week review: under 5 „zu wenig“, under 10 „dünn“, else „tragfähig“. */
export type SampleLevel = "keine" | "zu wenig" | "dünn" | "tragfähig";
export const sampleLevel = (n: number): SampleLevel => (n <= 0 ? "keine" : n < 5 ? "zu wenig" : n < 10 ? "dünn" : "tragfähig");

export interface BalanceRow {
  key: string;
  label: string;
  /** entry signals in the group */
  n: number;
  traded: number;
  left: number;
  expired: number;
  /** still inside the window (neu / angesehen) */
  running: number;
  /** outcomes: target first / stop first / open / not usable / not computed yet */
  target: number;
  stop: number;
  open: number;
  unusable: number;
  pending: number;
  /** decided outcomes = target + stop */
  decided: number;
  hitRate: number | null;
  hitCi: Interval | null;
  avgR: number | null;
  rCi: Interval | null;
  level: SampleLevel;
}

export interface Reading {
  /** signals / trades in the reading */
  n: number;
  avgR: number | null;
  ci: Interval | null;
}

export interface TradeComparison {
  all: Reading;
  /** the outcome the traded signals reached by themselves */
  tradedSignals: Reading;
  /** what the journal booked on the trades that belong to those signals (closed trades with an R, each trade once) */
  tradedBooked: Reading;
  notTraded: Reading;
  /** booked R of the traded signals − mean R of all signals, `null` when either side is missing */
  diff: number | null;
}

export interface Balance {
  rows: BalanceRow[];
  total: BalanceRow;
  comparison: TradeComparison;
  /** events that are no entry (context) – not part of the balance */
  context: number;
  /** archived entry signals */
  signals: number;
}

const SETUP_NONE = "Ohne Setup-Namen";

/** Group key and label of one event. */
function groupOf(e: SignalEvent, by: BalanceGroup): { key: string; label: string } {
  // the version of the rules the signal came from: the same settings are one group, a changed setting starts the next
  if (by === "rules") return e.rules ? { key: `${e.rules.kind}|${e.rules.hash}`, label: ruleLabel(e.rules) } : { key: "ohne", label: "Ohne Regelstand (vor der Aufzeichnung der Versionen)" };
  if (by === "tf") return { key: e.tf ?? "–", label: e.tf ?? "Ohne Zeiteinheit" };
  const type = e.source === "box" ? (e.kind === "scan" ? "Box-Scanner" : "Box-Setup") : e.source === "key" ? `Schlüsselmarke (${e.kind === "retest" ? "Retest" : "Bestätigung"})` : SOURCE_LABEL.entry;
  if (by === "type") return { key: type, label: type };
  const label = e.name ?? (e.source === "entry" ? SOURCE_LABEL.entry : e.source === "key" ? type : SETUP_NONE);
  return { key: label, label };
}

function reading(rs: readonly number[]): Reading {
  return { n: rs.length, avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, ci: rs.length >= 3 ? meanCI(rs) : null };
}

function rowOf(key: string, label: string, rows: readonly InboxRow[], outcomes: OutcomeMap, basis: BasisFilter): BalanceRow {
  let target = 0;
  let stop = 0;
  let open = 0;
  let unusable = 0;
  let pending = 0;
  const rs: number[] = [];
  for (const r of rows) {
    const o = outcomes.get(r.event.id);
    if (!o) pending += 1;
    else if (basis !== "all" && o.basis !== basis && (o.kind === "target" || o.kind === "stop")) pending += 1; // decided on the other basis: not part of this reading
    else if (o.kind === "target") {
      target += 1;
      rs.push(o.r ?? 0);
    } else if (o.kind === "stop") {
      stop += 1;
      rs.push(o.r ?? -1);
    } else if (o.kind === "open") open += 1;
    else unusable += 1;
  }
  const decided = target + stop;
  return {
    key,
    label,
    n: rows.length,
    traded: rows.filter((r) => r.status === "gehandelt").length,
    left: rows.filter((r) => r.status === "ausgelassen").length,
    expired: rows.filter((r) => r.status === "abgelaufen").length,
    running: rows.filter((r) => r.status === "neu" || r.status === "angesehen").length,
    target,
    stop,
    open,
    unusable,
    pending,
    decided,
    hitRate: decided ? target / decided : null,
    hitCi: decided ? wilson(target, decided) : null,
    avgR: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    rCi: rs.length >= 3 ? meanCI(rs) : null,
    level: sampleLevel(decided),
  };
}

/** The balance of `events` (entries with a direction) against the journal and the computed outcomes. */
export function buildBalance(events: readonly SignalEvent[], trades: readonly EnrichedTrade[], outcomes: OutcomeMap, now: number, by: BalanceGroup = "type", basis: BasisFilter = "all"): Balance {
  const inbox = buildInbox(events, trades, now);
  const entries = inbox.rows.filter((r) => r.entry);
  const groups = new Map<string, { label: string; rows: InboxRow[] }>();
  for (const r of entries) {
    const g = groupOf(r.event, by);
    const cur = groups.get(g.key);
    if (cur) cur.rows.push(r);
    else groups.set(g.key, { label: g.label, rows: [r] });
  }
  const rows = [...groups.entries()].map(([key, g]) => rowOf(key, g.label, g.rows, outcomes, basis)).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const total = rowOf("alle", "Alle Signale", entries, outcomes, basis);

  const inBasis = (r: InboxRow): number | null => {
    const o = outcomes.get(r.event.id);
    if (!isDecided(o)) return null;
    if (basis !== "all" && o.basis !== basis) return null;
    return o.r;
  };
  const allR = entries.map(inBasis).filter((x): x is number => x != null);
  const tradedRows = entries.filter((r) => r.status === "gehandelt");
  const tradedR = tradedRows.map(inBasis).filter((x): x is number => x != null);
  const notR = entries
    .filter((r) => r.status === "ausgelassen" || r.status === "abgelaufen")
    .map(inBasis)
    .filter((x): x is number => x != null);
  const booked = new Map<string, number>();
  for (const r of tradedRows) for (const t of r.trades) if (t.result !== "open" && typeof t.r === "number" && Number.isFinite(t.r)) booked.set(t.id, t.r);
  const tradedBooked = reading([...booked.values()]);
  const all = reading(allR);
  return {
    rows,
    total,
    comparison: { all, tradedSignals: reading(tradedR), tradedBooked, notTraded: reading(notR), diff: tradedBooked.avgR != null && all.avgR != null ? tradedBooked.avgR - all.avgR : null },
    context: inbox.total - entries.length,
    signals: entries.length,
  };
}

/** The sentence under the comparison – the selection effect, named. */
export const SELECTION_NOTE =
  "Das ist keine Aussage über die Qualität der Signale und kein Urteil über dich: Deine Trades sind eine Auswahl – welches Signal, wann eingestiegen, mit welcher Größe, wo ausgestiegen. Die Differenz mischt Auswahl, Timing und Ausstieg; Gebühren und Funding stecken nur in den gebuchten Trades, nicht in den Signal-Ausgängen.";
