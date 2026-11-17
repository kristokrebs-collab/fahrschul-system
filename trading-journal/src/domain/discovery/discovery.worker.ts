/**
 * Module worker of the Muster-Entdecker: steps `createDiscoveryJob` in 40 ms slices and reports the progress after each slice
 * (≤ 25 messages per second). Loaded by `runner.ts` as an inline worker (`?worker&inline`, no extra file). One worker per run:
 * stopping terminates it, so an aborted search ends at once.
 */
import { createDiscoveryJob } from "./job";
import type { DiscoveryRequest, DiscoveryResponse } from "./protocol";

const scope = self as unknown as { onmessage: ((e: MessageEvent<DiscoveryRequest>) => void) | null; postMessage(m: DiscoveryResponse): void };
const SLICE_MS = 40;

scope.onmessage = (e) => {
  const req = e.data;
  try {
    const job = createDiscoveryJob(req.input);
    for (;;) {
      if (job.step(performance.now() + SLICE_MS)) break;
      scope.postMessage({ id: req.id, kind: "progress", progress: job.progress() });
    }
    scope.postMessage({ id: req.id, kind: "done", result: job.result() });
  } catch (err) {
    scope.postMessage({ id: req.id, kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
