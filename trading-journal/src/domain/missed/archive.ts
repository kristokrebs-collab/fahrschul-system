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

  // ── additive fields (archive version stays 1: a record without them reads as `null`) ──
  /** the signal's own entry price when the raising code knew one (Box setup); `null` = the next candle's open counts */
  price: number | null;
  /** the signal's own stop / first target when it had one (Box setup, an own level's invalidation); `null` = none */
  stop: number | null;
  target: number | null;
  /** ms: close of the candle the signal rests on (for the delay between close and alert); `null` = unknown */
  barClose: number | null;
  /** the setup's name, kind (`breakout` · `retest` · `range` …), grade (`A+` …) and CRV when the source has them (Box setup) – what „Diese Idee testen“ needs */
  name: string | null;
  setupKind: string | null;
  grade: string | null;
  rr: number | null;
  /** inbox (F28): ms the trader looked at it / left it out on purpose (with the reason) / linked a journal trade by hand */
  seenAt: number | null;
  skip: SkipReason | null;
  skipAt: number | null;
  tradeId: string | null;
}

/** Why the trader left a signal out on purpose (short list, so F32 / F36 can learn from it). */
export const SKIP_REASONS = ["limit", "context", "doubt", "time", "other"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const SKIP_LABEL: Readonly<Record<SkipReason, string>> = {
  limit: "Risiko- oder Verlustlimit",
  context: "Marktlage passt nicht",
  doubt: "Zweifel am Signal",
  time: "Keine Zeit",
  other: "Sonstiges",
};

export type SignalEventInput = Omit<SignalEvent, "id" | "watch" | "price" | "stop" | "target" | "barClose" | "name" | "setupKind" | "grade" | "rr" | "seenAt" | "skip" | "skipAt" | "tradeId"> &
  Partial<Pick<SignalEvent, "price" | "stop" | "target" | "barClose" | "name" | "setupKind" | "grade" | "rr">> & { id?: string };

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
    price: fin(o.price) && o.price > 0 ? o.price : null,
    stop: fin(o.stop) && o.stop > 0 ? o.stop : null,
    target: fin(o.target) && o.target > 0 ? o.target : null,
    barClose: fin(o.barClose) ? o.barClose : null,
    name: typeof o.name === "string" && o.name ? o.name.slice(0, 80) : null,
    setupKind: typeof o.setupKind === "string" && o.setupKind ? o.setupKind.slice(0, 16) : null,
    grade: typeof o.grade === "string" && o.grade ? o.grade.slice(0, 4) : null,
    rr: fin(o.rr) && o.rr > 0 ? o.rr : null,
    seenAt: fin(o.seenAt) ? o.seenAt : null,
    skip: SKIP_REASONS.includes(o.skip as SkipReason) ? (o.skip as SkipReason) : null,
    skipAt: fin(o.skipAt) ? o.skipAt : null,
    tradeId: typeof o.tradeId === "string" && o.tradeId ? o.tradeId.slice(0, 60) : null,
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
  const ev = eventOf({ ...input, id, watch: false, seenAt: null, skip: null, skipAt: null, tradeId: null });
  if (!ev) return items;
  return prune([ev, ...items].sort((a, b) => b.at - a.at), now);
}

/** Sets or clears the „Beobachten“ mark of one event. */
export function setSignalWatch(items: readonly SignalEvent[], id: string, watch: boolean): readonly SignalEvent[] {
  return items.some((e) => e.id === id && e.watch !== watch) ? items.map((e) => (e.id === id ? { ...e, watch } : e)) : items;
}

const patch = (items: readonly SignalEvent[], id: string, fn: (e: SignalEvent) => SignalEvent | null): readonly SignalEvent[] => {
  let changed = false;
  const next = items.map((e) => {
    if (e.id !== id) return e;
    const n = fn(e);
    if (!n) return e;
    changed = true;
    return n;
  });
  return changed ? next : items;
};

/** The trader looked at the event (first time only; a later look keeps the first). */
export function markSignalSeen(items: readonly SignalEvent[], id: string, at: number): readonly SignalEvent[] {
  return patch(items, id, (e) => (e.seenAt == null ? { ...e, seenAt: at } : null));
}

/** „Ausgelassen – Grund“: leaving a signal out on purpose (`reason` null takes the mark back). */
export function setSignalSkip(items: readonly SignalEvent[], id: string, reason: SkipReason | null, at: number): readonly SignalEvent[] {
  return patch(items, id, (e) => (e.skip === reason ? null : { ...e, skip: reason, skipAt: reason ? at : null, seenAt: e.seenAt ?? (reason ? at : null) }));
}

/** Links a journal trade to the event by hand (`tradeId` null removes the link). */
export function linkSignalTrade(items: readonly SignalEvent[], id: string, tradeId: string | null): readonly SignalEvent[] {
  return patch(items, id, (e) => (e.tradeId === tradeId ? null : { ...e, tradeId }));
}
