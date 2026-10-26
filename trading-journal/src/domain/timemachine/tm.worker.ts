/**
 * Module worker of the Zeitmaschine: a thin shell around the host (`host.ts`) that works in slices with short rests (so an
 * `abort` message is heard within one slice and a phone is not kept at full load). Loaded by `tmRunner.ts` as an inline worker
 * (`?worker&inline`, no extra file). One worker per run; `abort` and `terminate()` stop it at once.
 */
import { createTmHost, type TmRequest, type TmResponse } from "./host";

const scope = self as unknown as { onmessage: ((e: MessageEvent<TmRequest>) => void) | null; postMessage(m: TmResponse): void };

const host = createTmHost({
  post: (m) => scope.postMessage(m),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
});

scope.onmessage = (e) => host.handle(e.data);
