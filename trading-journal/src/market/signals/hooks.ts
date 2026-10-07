/** React access to the live check: one `useSyncExternalStore`, re-renders only when the published state changes. */
import { useSyncExternalStore } from "react";
import { getSignalSnapshot, subscribeSignalCheck, type SignalCheckState } from "./engine";

const SERVER: SignalCheckState = { state: "loading", snapshot: null, updatedAt: null, message: null };

/**
 * `{ state: "loading" | "ok" | "stale" | "offline", snapshot, updatedAt, message }`. Stable identity: a re-render
 * happens only when the rounded result or the status changes (≤ 1/s), never per tick.
 */
export function useSignalCheck(): SignalCheckState {
  return useSyncExternalStore(subscribeSignalCheck, getSignalSnapshot, () => SERVER);
}
