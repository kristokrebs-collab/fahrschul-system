import { useCallback, useEffect, useRef, useState } from "react";
import { dwell } from "@/motion/tokens";
import type { ButtonStatus } from "@/primitives/Button";

export interface ActionStatus {
  /** Hand it to `<Button status={status}>`. */
  status: ButtonStatus;
  /**
   * Runs `fn`: `loading` while it works, then `success` (it returned, not `false`) or `error` (it threw or returned `false`),
   * and back to `idle` after `hold` ms. A new run cancels the wait of the last one. Resolves with `fn`'s result (`undefined`
   * when it threw – the error is NOT rethrown: the button shows it, the caller reports the details).
   */
  run: <T>(fn: () => Promise<T> | T) => Promise<T | undefined>;
  /** Sets the state by hand (`success` / `error` fall back to `idle` after `hold` ms as well). */
  set: (next: ButtonStatus) => void;
}

/**
 * The three button states without the timer boilerplate: `const { status, run } = useActionStatus();`
 * `<Button status={status} onClick={() => void run(save)}>Speichern</Button>` – the spinner while `save` works, the ✓ drawing
 * itself when it is done (kept `dwell.done`), a short shake when it failed. Timers are cleared on unmount.
 */
export function useActionStatus(hold: number = dwell.done * 1000): ActionStatus {
  const [status, setStatus] = useState<ButtonStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  const set = useCallback(
    (next: ButtonStatus) => {
      clearTimeout(timer.current);
      if (!alive.current) return;
      setStatus(next);
      if (next === "success" || next === "error") timer.current = setTimeout(() => alive.current && setStatus("idle"), hold);
    },
    [hold],
  );

  const run = useCallback(
    async <T,>(fn: () => Promise<T> | T): Promise<T | undefined> => {
      set("loading");
      try {
        const result = await fn();
        set(result === false ? "error" : "success");
        return result;
      } catch {
        set("error");
        return undefined;
      }
    },
    [set],
  );

  return { status, run, set };
}
