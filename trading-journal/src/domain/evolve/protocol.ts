/**
 * The trial log ("Versuchsprotokoll"), pure parts: every tested variant with its score, time and seed – the failed ones too.
 * It is kept on this device only, per strategy, with an upper limit and a rotation:
 *
 * - at most `LOG_MAX` entries per strategy; when it grows past that, the OLDEST entries go first – except the `KEEP_TOP` best
 *   scored ones and the entries of the current version (trial 0), which stay;
 * - `total` (variants ever tested) and `dropped` (entries rotated out) are counters that never shrink, so the count that
 *   feeds the multiple-testing correction does not depend on how much of the log is still kept.
 * The same seed and data reproduce the sequence (`search.ts`): `seed` + `i` identify a variant.
 */
import type { LogEntry, MutationKind, TrialVia } from "./types";
import { isMutationKind } from "./types";

export const LOG_MAX = 400;
export const KEEP_TOP = 30;
export const LOG_FORMAT = 1 as const;
export const MAX_LOGS = 12;

export interface StoredLog {
  total: number;
  dropped: number;
  entries: LogEntry[];
}

export type LogBook = Record<string, StoredLog>;

export const EMPTY_LOG: StoredLog = Object.freeze({ total: 0, dropped: 0, entries: [] }) as StoredLog;

/** Appends entries (time stamped by the caller) and rotates. The input is not changed. */
export function appendEntries(log: StoredLog, add: readonly LogEntry[]): StoredLog {
  if (!add.length) return log;
  const total = log.total + add.filter((e) => e.via !== "baseline").length;
  let entries = [...log.entries, ...add];
  let dropped = log.dropped;
  if (entries.length > LOG_MAX) {
    const top = new Set(
      entries
        .map((e, i) => ({ e, i }))
        .filter((x) => x.e.score != null)
        .sort((a, b) => b.e.score! - a.e.score!)
        .slice(0, KEEP_TOP)
        .map((x) => x.i),
    );
    let excess = entries.length - LOG_MAX;
    const out: LogEntry[] = [];
    entries.forEach((e, i) => {
      if (excess > 0 && !top.has(i) && e.via !== "baseline") {
        excess--;
        dropped++;
      } else out.push(e);
    });
    entries = out;
  }
  return { total, dropped, entries };
}

const VIAS: readonly TrialVia[] = ["baseline", "mutation", "restart", "neighbor"];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function entryOf(raw: unknown): LogEntry | null {
  if (!isObj(raw) || typeof raw.sid !== "string" || typeof raw.key !== "string" || !fin(raw.seed) || !fin(raw.i) || !fin(raw.at)) return null;
  if (!(VIAS as readonly unknown[]).includes(raw.via)) return null;
  return {
    sid: raw.sid.slice(0, 60),
    seed: raw.seed,
    i: raw.i,
    at: raw.at,
    key: raw.key.slice(0, 20),
    parent: typeof raw.parent === "string" ? raw.parent.slice(0, 20) : null,
    via: raw.via as TrialVia,
    kinds: (Array.isArray(raw.kinds) ? raw.kinds : []).filter(isMutationKind) as MutationKind[],
    text: typeof raw.text === "string" ? raw.text.slice(0, 300) : "",
    score: fin(raw.score) ? raw.score : null,
    n: fin(raw.n) ? Math.max(0, Math.round(raw.n)) : 0,
    avgR: fin(raw.avgR) ? raw.avgR : null,
  };
}

/** The stored book (anything) → clean logs; unreadable entries are dropped, limits applied. */
export function parseBook(raw: unknown): LogBook {
  const out: LogBook = {};
  if (!isObj(raw) || raw.v !== LOG_FORMAT || !isObj(raw.logs)) return out;
  for (const [sid, v] of Object.entries(raw.logs).slice(0, MAX_LOGS * 2)) {
    if (!isObj(v) || !Array.isArray(v.entries)) continue;
    const entries = v.entries.map(entryOf).filter((e): e is LogEntry => e != null).slice(-LOG_MAX);
    out[sid] = { total: fin(v.total) ? Math.max(entries.length, Math.round(v.total)) : entries.length, dropped: fin(v.dropped) ? Math.max(0, Math.round(v.dropped)) : 0, entries };
  }
  // the logs touched last stay
  const keep = Object.entries(out).sort((a, b) => (b[1].entries.at(-1)?.at ?? 0) - (a[1].entries.at(-1)?.at ?? 0)).slice(0, MAX_LOGS);
  return Object.fromEntries(keep);
}

export const bookToJson = (book: LogBook): { v: typeof LOG_FORMAT; logs: LogBook } => ({ v: LOG_FORMAT, logs: book });
