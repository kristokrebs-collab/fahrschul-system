/**
 * Module worker of the Monte Carlo (P03): runs `monteCarlo` / `riskOfRuin` off the main thread. Loaded by
 * `mcRunner.ts` as an inline worker (`?worker&inline`: no extra file, so the single-file builds stay one file; the
 * runner uses the idle-chunk fallback there anyway). Messages: `McRequest` in, `McResponse` out (same `id`).
 */
import { monteCarlo, riskOfRuin } from "./montecarlo";
import type { McRequest, McResponse } from "./mcProtocol";

const scope = self as unknown as { onmessage: ((e: MessageEvent<McRequest>) => void) | null; postMessage(m: McResponse): void };

scope.onmessage = (e) => {
  const req = e.data;
  try {
    if (req.kind === "mc") scope.postMessage({ id: req.id, kind: "mc", result: monteCarlo(req.sample, req.opts) });
    else scope.postMessage({ id: req.id, kind: "ror", result: riskOfRuin(req.input, req.opts) });
  } catch (err) {
    scope.postMessage({ id: req.id, kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
