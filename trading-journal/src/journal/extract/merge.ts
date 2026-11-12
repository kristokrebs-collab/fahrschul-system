/**
 * Several screenshots of ONE trade (a position view + an order history, a planned order + its fill) become one
 * candidate (F29 / F30 "zusammengehörige Belege verbinden") – pure.
 *
 * Two candidates belong together when nothing contradicts it (same market, same side, entries no further apart than
 * `MERGE_MINUTES`, entry prices within `MERGE_PRICE`) and something positive agrees (same market + a matching time or
 * price, or the same price and a matching time). Two trades the model listed separately for the SAME picture are never
 * merged – it saw them as different positions.
 */
import type { Candidate, Cell, Leg } from "./candidate";
import { averagePrice, firstAt, pairKey } from "./candidate";
import { minutesBetween } from "./time";

/** Entries further apart than this are two trades. */
export const MERGE_MINUTES = 15;
/** Relative distance of the entry prices that still counts as the same entry. */
export const MERGE_PRICE = 0.003;

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-12);

/** The price a candidate entered (or plans to enter) at. */
export function entryRef(c: Candidate): number | null {
  return averagePrice(c.entries) ?? c.plannedEntry.value;
}

/** Whether two candidates describe the same trade. */
export function sameTrade(a: Candidate, b: Candidate): boolean {
  if (a.sources.some((s) => b.sources.includes(s))) return false;
  const pa = pairKey(a.pair.value);
  const pb = pairKey(b.pair.value);
  const pairKnown = !!pa && !!pb;
  if (pairKnown && pa !== pb) return false;
  if (a.side.value && b.side.value && a.side.value !== b.side.value) return false;
  const ta = firstAt(a.entries);
  const tb = firstAt(b.entries);
  const timeKnown = !!ta && !!tb;
  const timeClose = timeKnown && Math.abs(minutesBetween(ta, tb)) <= MERGE_MINUTES;
  if (timeKnown && !timeClose) return false;
  const ra = entryRef(a);
  const rb = entryRef(b);
  const priceKnown = ra != null && rb != null;
  const priceClose = priceKnown && rel(ra, rb) <= MERGE_PRICE;
  if (priceKnown && !priceClose) return false;
  // positive evidence
  if (pairKnown) return timeClose || priceClose;
  return priceClose && (timeClose || !timeKnown);
}

/** The better of two readings of the same field (higher confidence); a disagreement is marked, not hidden. */
function pick<T>(a: Cell<T>, b: Cell<T>, label: string): Cell<T> {
  if (a.value == null) return b.value == null ? (a.raw != null ? a : b) : b;
  if (b.value == null) return a;
  const best = a.conf >= b.conf ? a : b;
  const same = typeof a.value === "number" && typeof b.value === "number" ? rel(a.value as number, b.value as number) < 1e-9 : a.value === b.value;
  if (same) return { ...best, conf: Math.max(a.conf, b.conf) };
  return { ...best, state: "uncertain", note: `${label}: die Bilder widersprechen sich (${String(a.value)} / ${String(b.value)}).` };
}

const sameLeg = (a: Leg, b: Leg): boolean =>
  rel(a.price, b.price) < 1e-4 && (a.qty == null || b.qty == null || rel(a.qty, b.qty) < 1e-6) && (!a.at || !b.at || Math.abs(minutesBetween(a.at, b.at)) <= 5);

function unionLegs(a: readonly Leg[], b: readonly Leg[]): Leg[] {
  const out = [...a];
  for (const l of b) {
    const i = out.findIndex((x) => sameLeg(x, l));
    if (i < 0) out.push(l);
    else {
      const x = out[i]!;
      // the same execution seen twice: keep the richer reading
      out[i] = { ...x, qty: x.qty ?? l.qty, at: x.at ?? l.at, conf: Math.max(x.conf, l.conf), uncertain: x.uncertain && l.uncertain, notes: [...new Set([...x.notes, ...l.notes])] };
    }
  }
  return out;
}

const RANK = { planned: 0, open: 1, closed: 2 } as const;
const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** Merges two candidates that `sameTrade`. */
export function mergeTwo(a: Candidate, b: Candidate): Candidate {
  const exec = RANK[a.status] >= RANK[b.status] ? a : b;
  const stop = pick(a.stop, b.stop, "Stop");
  const stopFrom = stop === a.stop ? a : b;
  const targets: Cell<number>[] = [...a.targets];
  for (const t of b.targets) if (!targets.some((x) => x.value != null && t.value != null && rel(x.value, t.value) < 1e-4)) targets.push(t);
  const merged = a.merged + b.merged;
  const notes = [...uniq([...a.notes, ...b.notes]).filter((n) => !/^Aus \d+ Screenshots zusammengeführt\.$/.test(n)), `Aus ${merged} Screenshots zusammengeführt.`];
  return {
    ...exec,
    id: a.id,
    sources: uniq([...a.sources, ...b.sources]).sort((x, y) => x - y),
    merged,
    status: exec.status,
    statusConf: exec.statusConf,
    pair: pick(a.pair, b.pair, "Markt"),
    side: pick(a.side, b.side, "Richtung"),
    kind: pick(a.kind, b.kind, "Handelsart"),
    exchange: pick(a.exchange, b.exchange, "Börse"),
    plannedEntry: pick(a.plannedEntry, b.plannedEntry, "Geplanter Einstieg"),
    entries: unionLegs(a.entries, b.entries),
    entriesConf: Math.max(a.entriesConf, b.entriesConf),
    exits: unionLegs(a.exits, b.exits),
    exitsConf: Math.max(a.exitsConf, b.exitsConf),
    stop,
    // a stop seen on a planned order is the plan, i.e. the original one
    stopOriginal: stopFrom.stopOriginal,
    targets,
    leverage: pick(a.leverage, b.leverage, "Hebel"),
    fees: pick(a.fees, b.fees, "Gebühren"),
    funding: pick(a.funding, b.funding, "Funding"),
    pnl: pick(a.pnl, b.pnl, "Ergebnis"),
    pnlCurrency: a.pnlCurrency ?? b.pnlCurrency,
    pnlMode: "auto",
    unreadable: uniq([...a.unreadable, ...b.unreadable]),
    notes,
  };
}

/** Merges everything that belongs together; the order of first appearance is kept. */
export function mergeCandidates(list: readonly Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of list) {
    const i = out.findIndex((g) => sameTrade(g, c));
    if (i < 0) out.push(c);
    else out[i] = mergeTwo(out[i]!, c);
  }
  return out;
}
