/**
 * Module worker of the optimiser: a thin shell around the host (`host.ts`) that does the work in slices with rests in between
 * (duty cycle chosen by the page, so a phone is never kept busy). Loaded by `runner.ts` as an inline worker
 * (`?worker&inline`, no extra file). One worker per run; `abort` and `terminate()` stop it at once.
 */
import { createEvolveHost, type EvolveRequest, type EvolveResponse } from "./host";

const scope = self as unknown as { onmessage: ((e: MessageEvent<EvolveRequest>) => void) | null; postMessage(m: EvolveResponse): void };

const host = createEvolveHost({
  post: (m) => scope.postMessage(m),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
  wall: () => Date.now(),
});

scope.onmessage = (e) => host.handle(e.data);
