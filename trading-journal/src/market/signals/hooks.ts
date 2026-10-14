/** React access to the live check: one subscription per reader, re-renders only when the published state changes. */
import { startTransition, useEffect, useState } from "react";
import { getSignalSnapshot, subscribeSignalCheck, type SignalCheckState } from "./engine";

/**
 * `{ state: "loading" | "ok" | "stale" | "offline", snapshot, updatedAt, message }`. Stable identity: a re-render
 * happens only when the rounded result or the status changes (≤ 1/s), never per tick.
 *
 * A publish is delivered as a transition, not as a synchronous store update: the engine publishes from its own timer
 * task, and a `useSyncExternalStore` commit of the Einstiegs-Check tree (≈ 400–500 components) would run inside that
 * same task (> 8 ms, a dropped 120 Hz frame each second). As a transition React renders it in slices between frames.
 */
export function useSignalCheck(): SignalCheckState {
  const [state, setState] = useState(getSignalSnapshot);
  useEffect(() => {
    const sync = () => startTransition(() => setState(getSignalSnapshot()));
    // a publish between the first render and this subscription is picked up at once
    sync();
    return subscribeSignalCheck(sync);
  }, []);
  return state;
}
