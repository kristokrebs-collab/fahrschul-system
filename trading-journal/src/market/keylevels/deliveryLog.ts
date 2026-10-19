/**
 * Zustellprotokoll: what was sent (and what was held back, with the reason) – stored in this browser only
 * (`tj2-keylevel-log`), the newest `DELIVERY_LOG_CAP` entries. Written by the key-level host; the existing signal and box
 * alerts add their toasts as `signal` / `box` lines (log only – their own rules are unchanged).
 *
 * Browser storage can be empty or blocked (private window): the log then lives in memory for the session.
 */
import { useSyncExternalStore } from "react";
import { appendDelivery, DELIVERY_LOG_CAP, parseDeliveryLog, type DeliveryRecord } from "@/domain/keylevels/delivery";
import { newId } from "@/lib/ids";
import { readJson, storageKey, writeJson } from "@/store/storage";

export const DELIVERY_LOG_KEY = storageKey("keylevel-log");

let cache: DeliveryRecord[] | null = null;
const listeners = new Set<() => void>();

function load(): DeliveryRecord[] {
  if (!cache) cache = parseDeliveryLog(readJson<unknown>(DELIVERY_LOG_KEY, []), DELIVERY_LOG_CAP);
  return cache;
}

function publish(next: DeliveryRecord[]): void {
  cache = next;
  writeJson(DELIVERY_LOG_KEY, next);
  for (const l of [...listeners]) l();
}

export const getDeliveryLog = (): readonly DeliveryRecord[] => load();

export function subscribeDeliveryLog(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export function useDeliveryLog(): readonly DeliveryRecord[] {
  return useSyncExternalStore(subscribeDeliveryLog, getDeliveryLog, getDeliveryLog);
}

/** Appends one line (newest first, capped). Returns the stored record. */
export function recordDelivery(rec: Omit<DeliveryRecord, "id" | "at"> & { at?: number }): DeliveryRecord {
  const full: DeliveryRecord = { ...rec, id: newId("d_"), at: rec.at ?? Date.now() };
  publish(appendDelivery(load(), full));
  return full;
}

/** A toast of the signal check / box alerts, logged so the log shows everything that was sent. */
export function logExternalDelivery(source: "signal" | "box", title: string, detail: string): void {
  recordDelivery({ source, levelId: null, title, detail, stage: null, basis: null, channels: ["toast"], outcome: "sent", dedupeKey: `${source}|${title}|${detail}` });
}

export function clearDeliveryLog(): void {
  publish([]);
}

/** Tests: forget the in-memory copy. */
export function __resetDeliveryLog(): void {
  cache = null;
  listeners.clear();
}
