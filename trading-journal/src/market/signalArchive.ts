/**
 * Signalarchiv (F32) – storage: the signal events the app raised (`@/domain/missed/archive`), kept in this browser only
 * (`tj2-signal-events`, versioned `{ v: 1, items }`, the newest 300 / 120 days). Written by the three places that already
 * raise the signals (Einstiegs-Check notifier, Box-zu-Box alerts, key-level alerts); read by the „Verpasste Chancen“ card.
 *
 * Browser storage can be empty or blocked (private window): the archive then lives in memory for the session. A stored
 * wrapper of a NEWER version is never overwritten (the events are kept in memory only).
 */
import { useSyncExternalStore } from "react";
import { appendSignalEvent, linkSignalTrade, markSignalSeen, parseSignalArchive, setSignalSkip, setSignalWatch, SIGNAL_ARCHIVE_VERSION, type SignalEvent, type SignalEventInput, type SkipReason } from "@/domain/missed/archive";
import { newId } from "@/lib/ids";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const SIGNAL_ARCHIVE_KEY = storageKey("signal-events");

let cache: readonly SignalEvent[] | null = null;
let foreign = false;
const listeners = new Set<() => void>();

function load(): readonly SignalEvent[] {
  if (!cache) {
    const parsed = parseSignalArchive(readJson<unknown>(SIGNAL_ARCHIVE_KEY, null), Date.now());
    cache = parsed.items;
    foreign = parsed.foreign;
  }
  return cache;
}

function publish(next: readonly SignalEvent[]): void {
  if (next === cache) return;
  cache = next;
  if (!foreign) writeJson(SIGNAL_ARCHIVE_KEY, { v: SIGNAL_ARCHIVE_VERSION, items: next });
  for (const l of [...listeners]) l();
}

export const getSignalArchive = (): readonly SignalEvent[] => load();

export function subscribeSignalArchive(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function useSignalArchive(): readonly SignalEvent[] {
  return useSyncExternalStore(subscribeSignalArchive, getSignalArchive, getSignalArchive);
}

/** Stores one signal event (the same `key` once). Never throws: a broken store must not break the alert that raised it. */
export function recordSignalEvent(input: SignalEventInput): void {
  try {
    publish(appendSignalEvent(load(), input, newId("s_"), Date.now()));
  } catch {
    /* the archive is a convenience; the alert itself has already been delivered */
  }
}

/** „Beobachten“ on / off for one event. */
export function setSignalWatched(id: string, watch: boolean): void {
  publish(setSignalWatch(load(), id, watch));
}

/** Inbox (F28): the trader looked at the event. */
export function markSeen(id: string): void {
  publish(markSignalSeen(load(), id, Date.now()));
}

/** Inbox (F28): „Ausgelassen – Grund“ (`null` takes it back). */
export function skipSignal(id: string, reason: SkipReason | null): void {
  publish(setSignalSkip(load(), id, reason, Date.now()));
}

/** Inbox (F28): links a journal trade to the event (`null` removes the link). */
export function linkTrade(id: string, tradeId: string | null): void {
  publish(linkSignalTrade(load(), id, tradeId));
}

export function clearSignalArchive(): void {
  cache = [];
  if (!foreign) writeJson(SIGNAL_ARCHIVE_KEY, { v: SIGNAL_ARCHIVE_VERSION, items: [] });
  for (const l of [...listeners]) l();
}

/** Tests: forget the in-memory copy. */
export function __resetSignalArchive(): void {
  cache = null;
  foreign = false;
  listeners.clear();
}
