/**
 * Module worker of the backtest lab (P07): steps `createLabJob` in 40 ms slices and reports progress after each
 * slice (≤ 25 messages per second). Loaded by `labRunner.ts` as an inline worker (`?worker&inline`, no extra file).
 * One worker per run: cancelling terminates it, so an aborted run stops at once.
 */
import { createLabJob } from "./job";
import type { LabRequest, LabResponse } from "./labProtocol";

const scope = self as unknown as { onmessage: ((e: MessageEvent<LabRequest>) => void) | null; postMessage(m: LabResponse): void };
const SLICE_MS = 40;

scope.onmessage = (e) => {
  const req = e.data;
  if (req.kind !== "run") return;
  try {
    const job = createLabJob(req.input);
    for (;;) {
      const done = job.step(performance.now() + SLICE_MS);
      if (done) break;
      scope.postMessage({ id: req.id, kind: "progress", progress: job.progress(), phase: job.phase() });
    }
    scope.postMessage({ id: req.id, kind: "done", result: job.result() });
  } catch (err) {
    scope.postMessage({ id: req.id, kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
