/**
 * Signalarchiv (F32): the signal EVENTS the app raised – a valid entry of the Einstiegs-Check, a Box-zu-Box setup, a
 * confirmed key level – as data with a time, a market and a side, so they can be held against the journal later
 * ("regelgerecht, nicht gehandelt"). Until now these events only existed as toast text in the Zustellprotokoll (no side,
 * no market, 200 lines in all); nothing structured was kept.
 *
 * Pure (no React, no I/O). The storage is `src/market/signalArchive.ts`: this device only, versioned
 * (`{ v: 1, items }`), the newest `SIGNAL_ARCHIVE_CAP` events and at most `SIGNAL_ARCHIVE_DAYS` days — like the
 * Zustellprotokoll it is NOT part of the backup or the cloud sync (nothing new goes to a server).
 *
 * What is stored is the event, not an outcome: the price path after a signal is not archived, so a signal's result is
 * unknown unless the trader traded it (then the journal trade has it).
 */
export const SIGNAL_ARCHIVE_VERSION = 1;
export const SIGNAL_ARCHIVE_CAP = 300;
export const SIGNAL_ARCHIVE_DAYS = 120;
const DAY = 86_400_000;

export type SignalSource = "entry" | "box" | "key";
export const SOURCE_LABEL: Readonly<Record<SignalSource, string>> = { entry: "Einstiegs-Check", box: "Box-zu-Box", key: "Schlüsselmarke" };

export interface SignalEvent {
  id: string;
  /** de-duplication key of the raising code (bar, box id, level + cycle + stage) */
  key: string;
  /** ms, device clock – when the app raised it */
  at: number;
  source: SignalSource;
  /** `entry` · `setup` · `scan` · `breakout` · `retest` · `confirm` … */
  kind: string;
  /** a signal one could have entered on (rule-conform entry) – the rest is context and never counts as „missed“ */
  entry: boolean;
  /** data symbol (`BTCUSDT`), `""` when the raising code did not know it */
  symbol: string;
  side: "long" | "short" | null;
  /** timeframe the signal belongs to, if the source has one */
  tf: string | null;
  /** the headline the user saw */
  label: string;
  detail: string;
  /** strength 1–4 of the Einstiegs-Check, `null` for the other sources */
  strength: number | null;
  score: number | null;
  /** level id / box id */
  ref: string | null;
  /** the trader marked it „Beobachten“ */
  watch: boolean;
}

export type SignalEventInput = Omit<SignalEvent, "id" | "watch"> & { id?: string };

const SOURCES: readonly SignalSource[] = ["entry", "box", "key"];
const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** One stored event, or null when it lacks a required field. */
function eventOf(v: unknown): SignalEvent | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.key !== "string" || !fin(o.at) || !SOURCES.includes(o.source as SignalSource)) return null;
  return {
    id: o.id.slice(0, 60),
    key: o.key.slice(0, 160),
    at: o.at,
    source: o.source as SignalSource,
    kind: text(o.kind, 24),
    entry: o.entry === true,
    symbol: text(o.symbol, 24),
    side: o.side === "long" || o.side === "short" ? o.side : null,
    tf: typeof o.tf === "string" && o.tf ? o.tf.slice(0, 8) : null,
    label: text(o.label, 160),
    detail: text(o.detail, 320),
    strength: fin(o.strength) ? o.strength : null,
    score: fin(o.score) ? o.score : null,
    ref: typeof o.ref === "string" && o.ref ? o.ref.slice(0, 80) : null,
    watch: o.watch === true,
  };
}

export interface ParsedArchive {
  items: SignalEvent[];
  /** the stored wrapper has a newer version: read nothing, and the writer must not overwrite it */
  foreign: boolean;
}

/** Tolerant read of a stored archive (newest first, pruned). */
export function parseSignalArchive(raw: unknown, now: number): ParsedArchive {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { items: [], foreign: false };
  const w = raw as { v?: unknown; items?: unknown };
  if (w.v !== SIGNAL_ARCHIVE_VERSION) return { items: [], foreign: fin(w.v) && w.v > SIGNAL_ARCHIVE_VERSION };
  const seen = new Set<string>();
  const items: SignalEvent[] = [];
  for (const it of Array.isArray(w.items) ? w.items : []) {
    const e = eventOf(it);
    if (e && !seen.has(e.key)) {
      seen.add(e.key);
      items.push(e);
    }
  }
  return { items: prune(items.sort((a, b) => b.at - a.at), now), foreign: false };
}

/** Drops events older than the age limit, then the oldest beyond the cap (events marked „Beobachten“ go last). */
export function prune(items: readonly SignalEvent[], now: number): SignalEvent[] {
  const fresh = items.filter((e) => now - e.at <= SIGNAL_ARCHIVE_DAYS * DAY || e.watch);
  if (fresh.length <= SIGNAL_ARCHIVE_CAP) return [...fresh];
  const keep = new Set<string>();
  for (const e of fresh.filter((x) => x.watch)) keep.add(e.id);
  for (const e of fresh) {
    if (keep.size >= SIGNAL_ARCHIVE_CAP) break;
    keep.add(e.id);
  }
  return fresh.filter((e) => keep.has(e.id));
}

/** Adds one event (newest first). The same `key` is stored once; the list is returned as is when it is a duplicate. */
export function appendSignalEvent(items: readonly SignalEvent[], input: SignalEventInput, id: string, now: number): readonly SignalEvent[] {
  if (items.some((e) => e.key === input.key)) return items;
  const ev = eventOf({ ...input, id, watch: false });
  if (!ev) return items;
  return prune([ev, ...items].sort((a, b) => b.at - a.at), now);
}

/** Sets or clears the „Beobachten“ mark of one event. */
export function setSignalWatch(items: readonly SignalEvent[], id: string, watch: boolean): readonly SignalEvent[] {
  return items.some((e) => e.id === id && e.watch !== watch) ? items.map((e) => (e.id === id ? { ...e, watch } : e)) : items;
}
