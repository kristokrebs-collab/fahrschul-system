/**
 * Module worker of the backtest lab (P07): steps `createLabJob` in 40 ms slices and reports progress after each
 * slice (≤ 25 messages per second). Loaded by `labRunner.ts` as an inline worker (`?worker&inline`, no extra file).
 * One worker per run: cancelling terminates it, so an aborted run stops at once. The same worker steps the extra job
 * (stress scenarios / filter comparison, F20 / F17) when asked with `kind: "extra"`.
 */
import { createExtraJob } from "../lab/extras/job";
import { createLabJob } from "./job";
import type { LabRequest, LabResponse } from "./labProtocol";

const scope = self as unknown as { onmessage: ((e: MessageEvent<LabRequest>) => void) | null; postMessage(m: LabResponse): void };
const SLICE_MS = 40;

scope.onmessage = (e) => {
  const req = e.data;
  if (req.kind !== "run" && req.kind !== "extra") return;
  try {
    const job = req.kind === "run" ? createLabJob(req.input) : createExtraJob(req.input);
    for (;;) {
      const done = job.step(performance.now() + SLICE_MS);
      if (done) break;
      scope.postMessage({ id: req.id, kind: "progress", progress: job.progress(), phase: job.phase() });
    }
    if (req.kind === "run") scope.postMessage({ id: req.id, kind: "done", result: (job as ReturnType<typeof createLabJob>).result() });
    else scope.postMessage({ id: req.id, kind: "extra-done", result: (job as ReturnType<typeof createExtraJob>).result() });
  } catch (err) {
    scope.postMessage({ id: req.id, kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
