/**
 * The paper protocol of signal changes – the same record the lab script writes to `vault/protokoll.jsonl`:
 *
 *   {"erfasst": "2026-10-30T23:38:56", "datum": "20260713", "branche": "Books", "signal": "KAUF", "strategie": "s-20-40-2.8-0.02-2.0",
 *    "modus": "DEMO/PAPIER", "gesendet": false, "hinweis": "Nur Protokoll, keine Order gesendet."}
 *
 * One line per change, written only on this device. `gesendet` is always `false`: nothing is ever sent anywhere. Pure.
 */
import type { AmpelEvent } from "./ampel";

export const PROTOKOLL_MODUS = "DEMO/PAPIER" as const;
export const PROTOKOLL_HINWEIS = "Nur Protokoll, keine Order gesendet.";
/** Entries kept on the device (the oldest go first). */
export const PROTOKOLL_MAX = 2000;
/** Longest line `parseJsonl` reads. */
const MAX_LINE = 2000;

export interface ProtokollEintrag {
  /** when the entry was written, local time without zone (`2026-10-30T23:38:56`, as Python's `isoformat(timespec="seconds")`) */
  erfasst: string;
  /** the trading day of the signal, `YYYYMMDD` */
  datum: string;
  branche: string;
  signal: "KAUF" | "VERKAUF";
  strategie: string;
  modus: typeof PROTOKOLL_MODUS;
  gesendet: false;
  hinweis: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** `2026-10-30T23:38:56` in the device's local time. */
export function erfasstText(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/** The identity of an entry: a change is logged once per day, industry, direction and strategy. */
export const entryKey = (e: Pick<ProtokollEintrag, "datum" | "branche" | "signal" | "strategie">): string => `${e.datum}|${e.branche}|${e.signal}|${e.strategie}`;

export function entriesFromEvents(events: readonly AmpelEvent[], strategie: string, now: Date): ProtokollEintrag[] {
  const erfasst = erfasstText(now);
  return events.map((e) => ({ erfasst, datum: e.datum, branche: e.branche, signal: e.signal, strategie, modus: PROTOKOLL_MODUS, gesendet: false as const, hinweis: PROTOKOLL_HINWEIS }));
}

/** Adds the entries that are not yet in the list, sorted by day and industry, the newest `max` kept. */
export function mergeEntries(existing: readonly ProtokollEintrag[], incoming: readonly ProtokollEintrag[], max: number = PROTOKOLL_MAX): { list: ProtokollEintrag[]; added: ProtokollEintrag[] } {
  const seen = new Set(existing.map(entryKey));
  const added: ProtokollEintrag[] = [];
  for (const e of incoming) {
    const k = entryKey(e);
    if (seen.has(k)) continue;
    seen.add(k);
    added.push(e);
  }
  const all = [...existing, ...added].sort((a, b) => (a.datum !== b.datum ? (a.datum < b.datum ? -1 : 1) : a.branche !== b.branche ? (a.branche < b.branche ? -1 : 1) : a.signal < b.signal ? -1 : a.signal > b.signal ? 1 : 0));
  return { list: all.length > max ? all.slice(all.length - max) : all, added };
}

/** One entry as the lab script prints it (`json.dumps(…, ensure_ascii=False)`: `", "` and `": "` as separators, this key order). */
export function lineOf(e: ProtokollEintrag): string {
  const parts: [string, unknown][] = [
    ["erfasst", e.erfasst],
    ["datum", e.datum],
    ["branche", e.branche],
    ["signal", e.signal],
    ["strategie", e.strategie],
    ["modus", e.modus],
    ["gesendet", false],
    ["hinweis", e.hinweis],
  ];
  return `{${parts.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")}}`;
}

/** The whole protocol as `.jsonl` text (one line per entry, closing newline; empty list = empty text). */
export function toJsonl(list: readonly ProtokollEintrag[]): string {
  return list.length ? `${list.map(lineOf).join("\n")}\n` : "";
}

const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{8}$/.test(v);

/** One parsed line, or `null` when it is not a protocol entry (a wrong shape is skipped, never repaired). `gesendet: true` is refused. */
export function entryOf(v: unknown): ProtokollEintrag | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const { erfasst, datum, branche, signal, strategie } = o;
  if (typeof erfasst !== "string" || erfasst.length > 40) return null;
  if (!isDay(datum)) return null;
  if (typeof branche !== "string" || !/^[A-Za-z0-9 .&-]{1,20}$/.test(branche)) return null;
  if (signal !== "KAUF" && signal !== "VERKAUF") return null;
  if (typeof strategie !== "string" || !/^s-[0-9.-]{3,40}$/.test(strategie)) return null;
  if (o.gesendet !== false) return null;
  return { erfasst, datum, branche, signal, strategie, modus: PROTOKOLL_MODUS, gesendet: false, hinweis: PROTOKOLL_HINWEIS };
}

/** Reads `.jsonl` text: the entries and the number of lines that were not entries (blank lines are not counted). */
export function parseJsonl(text: string): { entries: ProtokollEintrag[]; skipped: number } {
  const entries: ProtokollEintrag[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let e: ProtokollEintrag | null = null;
    if (line.length <= MAX_LINE) {
      try {
        e = entryOf(JSON.parse(line));
      } catch {
        e = null;
      }
    }
    if (e) entries.push(e);
    else skipped++;
  }
  return { entries, skipped };
}

/** Reads what was stored (an unknown value gives an empty list). */
export function entriesOfStored(v: unknown): ProtokollEintrag[] {
  if (!Array.isArray(v)) return [];
  const out: ProtokollEintrag[] = [];
  for (const x of v.slice(-PROTOKOLL_MAX)) {
    const e = entryOf(x);
    if (e) out.push(e);
  }
  return out;
}
