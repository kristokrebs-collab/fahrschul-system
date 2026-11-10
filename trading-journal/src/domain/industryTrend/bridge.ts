/**
 * Brücke Signal-Empfänger → Papier-Portfolio (B3 → C1). Pure: it only decides WHAT a received signal means for the paper book; the
 * store (`views/aktien/branchen/signalBridge.ts`) does the work, with the rules of `paper.ts` (Zeitmaschine, risk rule, Not-Aus).
 *
 *  - Only PROCESSED signals count (the server already dropped duplicates: they are rows with status `duplicate`, never offered here) and
 *    only Branchen-Signale: the `branchen-trend/1` alert, or a `signal/1` that carries the state (`data.zustand` grün | rot).
 *  - The industry comes from the instrument: the symbol of the alert (`XLE`, `AMEX:XLE`) must be one of the ETFs of `INSTRUMENTS`;
 *    anything else is ignored with that reason (no guessing).
 *  - grün (long) → "open" (the paper rules decide: age, data, Zeitmaschine, limits); rot (flat) → "close" (cash, never short).
 *  - **Old signals are ignored**: the day the signal names is older than `MAX_SIGNAL_AGE_DAYS` → nothing happens, and it says so.
 *  - **Idempotent**: the paper `signalId` is derived from (source, strategy, industry, state, day) – the same signal gives the same id and
 *    the paper book opens ONE position for it, however often the bridge looks at it. `handledIds` skips what was settled already.
 * Paper only: nothing here (or anywhere behind it) sends an order.
 */
import { INSTRUMENTS, MAX_SIGNAL_AGE_DAYS, signalAgeDays, signalIdOf, type TrendSignal } from "./paper";

/** The part of a received signal the bridge reads (the shape of `GET /connections/tradingview` → `signals`). */
export interface ReceivedSignal {
  id: string;
  kind: "signal" | "test";
  status: "processed" | "duplicate" | "rejected";
  schemaId: "signal/1" | "branchen-trend/1" | "legacy-action" | null;
  strategy: string | null;
  symbol: string | null;
  direction: "long" | "flat" | null;
  /** ISO time the signal names */
  time: string | null;
  data: { zustand?: "gruen" | "rot"; kurs?: number } | null;
  receivedAt: string;
}

export type IgnoreCode = "not-processed" | "not-branchen" | "no-instrument" | "bad-time" | "stale";

export type BridgeVerdict = { action: "open" | "close"; signal: TrendSignal } | { action: "ignore"; code: IgnoreCode; reason: string };

/** Ticker without exchange prefix, upper case (`AMEX:xle` → `XLE`). */
export const tickerOf = (symbol: string): string => (symbol.includes(":") ? symbol.slice(symbol.lastIndexOf(":") + 1) : symbol).trim().toUpperCase();

/** The industry code whose stand-in ETF has this ticker, or null. */
export function brancheOfSymbol(symbol: string | null): string | null {
  if (!symbol) return null;
  const t = tickerOf(symbol);
  for (const [code, ins] of Object.entries(INSTRUMENTS)) if (ins.symbol === t) return code;
  return null;
}

/** Does this row belong to the bridge at all (cheap, no clock)? */
export const isBranchenSignal = (s: Pick<ReceivedSignal, "kind" | "status" | "schemaId" | "data">): boolean =>
  s.kind === "signal" && s.status === "processed" && (s.schemaId === "branchen-trend/1" || ((s.schemaId === "signal/1" || s.schemaId === null) && (s.data?.zustand === "gruen" || s.data?.zustand === "rot")));

/** `YYYYMMDD` of an ISO time (UTC), or null. */
export function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10).replace(/-/g, "") : null;
}

const ignore = (code: IgnoreCode, reason: string): BridgeVerdict => ({ action: "ignore", code, reason });

/** What a received signal means for the paper book. Never throws. */
export function verdictOf(s: ReceivedSignal, nowMs: number): BridgeVerdict {
  if (s.kind !== "signal" || s.status !== "processed") return ignore("not-processed", "Nur verarbeitete Signale zählen (kein Test, kein Doppel, keine Ablehnung).");
  if (!isBranchenSignal(s)) return ignore("not-branchen", "Das ist kein Branchen-Signal (branchen-trend/1 oder signal/1 mit Zustand grün / rot).");
  const state = s.data?.zustand ?? (s.direction === "long" ? "gruen" : s.direction === "flat" ? "rot" : null);
  const branche = brancheOfSymbol(s.symbol);
  if (!state) return ignore("not-branchen", "Dem Signal fehlt die Richtung.");
  if (!branche) return ignore("no-instrument", `Zu „${s.symbol ?? "?"}“ gibt es keine Branche in der Liste der ETFs: nichts wird eröffnet.`);
  const day = dayOf(s.time);
  if (!day) return ignore("bad-time", "Dem Signal fehlt eine lesbare Zeit.");
  const age = signalAgeDays(day, nowMs);
  if (age > MAX_SIGNAL_AGE_DAYS) {
    return ignore("stale", `Veraltet: das Signal nennt den ${day.slice(6, 8)}.${day.slice(4, 6)}.${day.slice(0, 4)} (${age.toLocaleString("de-DE", { maximumFractionDigits: 1 })} Tage alt, Grenze ${MAX_SIGNAL_AGE_DAYS}). Es wird ignoriert.`);
  }
  const strategie = s.strategy && s.strategy.length > 0 ? s.strategy : "tradingview";
  const base = { source: "tradingview" as const, strategie, branche, state, datum: day };
  return { action: state === "gruen" ? "open" : "close", signal: { ...base, asOf: day, signalId: signalIdOf(base) } };
}

/** The signals still to settle, oldest first (a green then a red of one industry must be applied in that order). */
export function pendingSignals(all: readonly ReceivedSignal[], handledIds: ReadonlySet<string>): ReceivedSignal[] {
  return all
    .filter((s) => isBranchenSignal(s) && !handledIds.has(s.id))
    .sort((a, b) => (Date.parse(a.time ?? a.receivedAt) || 0) - (Date.parse(b.time ?? b.receivedAt) || 0) || Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
}

/* ------------------------------------------------------------------------------------------------ the log of what was settled */

export type BridgeOutcome = "opened" | "duplicate" | "refused" | "closed" | "nothing-to-close" | "ignored";

export interface BridgeEntry {
  /** id of the received signal (the row of the server) */
  id: string;
  outcome: BridgeOutcome;
  /** one plain sentence */
  note: string;
  /** the paper signal id (when there is one) and what it was about */
  paperSignalId: string | null;
  symbol: string | null;
  state: "gruen" | "rot" | null;
  at: number;
}

export interface BridgeLog {
  v: 1;
  entries: BridgeEntry[];
}

export const BRIDGE_LOG_MAX = 200;
export const emptyLog = (): BridgeLog => ({ v: 1, entries: [] });

const OUTCOMES: readonly BridgeOutcome[] = ["opened", "duplicate", "refused", "closed", "nothing-to-close", "ignored"];

/** Reads what was stored (anything unreadable is dropped). */
export function logOfStored(v: unknown): BridgeLog {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  const entries: BridgeEntry[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(o.entries) ? o.entries.slice(-BRIDGE_LOG_MAX) : []) {
    if (typeof x !== "object" || x === null) continue;
    const e = x as Record<string, unknown>;
    if (typeof e.id !== "string" || e.id.length > 80 || seen.has(e.id) || !OUTCOMES.includes(e.outcome as BridgeOutcome) || typeof e.note !== "string" || typeof e.at !== "number") continue;
    seen.add(e.id);
    entries.push({
      id: e.id,
      outcome: e.outcome as BridgeOutcome,
      note: e.note.slice(0, 300),
      paperSignalId: typeof e.paperSignalId === "string" ? e.paperSignalId.slice(0, 30) : null,
      symbol: typeof e.symbol === "string" ? e.symbol.slice(0, 40) : null,
      state: e.state === "gruen" || e.state === "rot" ? e.state : null,
      at: e.at,
    });
  }
  return { v: 1, entries };
}

/** Adds an entry (a settled id is never added twice), keeps the newest `BRIDGE_LOG_MAX`. */
export function withEntry(log: BridgeLog, e: BridgeEntry): BridgeLog {
  if (log.entries.some((x) => x.id === e.id)) return log;
  return { v: 1, entries: [...log.entries, e].slice(-BRIDGE_LOG_MAX) };
}

export const handledIdsOf = (log: BridgeLog): Set<string> => new Set(log.entries.map((e) => e.id));
