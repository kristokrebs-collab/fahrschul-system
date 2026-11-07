/**
 * The hook for "the plan really changed" (B4). The motion packages build the tariff profiles (`data-motion-tier`); this file
 * only announces WHEN to introduce one: after the SERVER confirmed another plan than the last one this browser knew for the
 * same user (a purchase that the webhook confirmed, a cancellation that took effect, a team seat) – never on a login, never
 * from the return URL, never from a browser flag.
 *
 * Usage (the motion package): `onPlanChange(({ to }) => setMotionTier(to))` – the call is made once per confirmed change and
 * introduces the new profile briefly. Nothing is registered by default, so without that package this does nothing.
 */
import type { PlanId } from "./types";

export interface PlanChange {
  from: PlanId;
  to: PlanId;
}

type Listener = (change: PlanChange) => void;
const listeners = new Set<Listener>();

/** Registers a listener; returns the function that removes it. */
export function onPlanChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called by the billing store when a plan change is confirmed by the server. */
export function announcePlanChange(change: PlanChange): void {
  if (change.from === change.to) return;
  for (const fn of [...listeners]) {
    try {
      fn(change);
    } catch {
      /* a listener must never break the billing flow */
    }
  }
}
