/**
 * The forward test's background host (F23), mounted by `DeferredHosts` only while an account needs it (running, paused or
 * ended but not yet wound up). It brings the accounts up to date when the app opens (everything that closed meanwhile is
 * calculated afterwards, exactly as if the app had been open), again after every candle close of the soonest interval and when
 * the tab comes back to the front. A closed app does nothing – the honest limit; there is no server-side monitoring.
 *
 * No clock jumps are assumed: the timer is re-armed after every run from the real clock, and a late timer (sleeping device)
 * simply finds more candles.
 */
import { useEffect, useMemo } from "react";
import { forwardCfgOf } from "@/domain/forward";
import { useJournal } from "@/store/journalStore";
import { catchUpAll, nextCloseMs } from "./forwardRunner";

/** Wait after a candle close before asking (the exchange needs a moment to publish the closed bar). */
export const CLOSE_GRACE_MS = 4_000;
/** No more often than this per visit of the tab. */
const MIN_GAP_MS = 15_000;
/** `setTimeout` takes at most 2^31 − 1 ms. */
const MAX_DELAY = 2_000_000_000;

export default function ForwardHost() {
  const raw = useJournal((s) => s.settings.forward);
  const accounts = useMemo(() => forwardCfgOf(raw).accounts, [raw]);
  // what must trigger a run: another set of accounts to work on, or a status that needs winding up (an ended account)
  const key = accounts.filter((a) => !a.cursor.done).map((a) => `${a.id}:${a.status}:${a.pauses.length}`).join("|");

  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    let stopped = false;
    const arm = (): void => {
      if (stopped) return;
      const list = forwardCfgOf(useJournal.getState().settings.forward).accounts;
      const next = nextCloseMs(list, Date.now());
      if (next == null) return;
      timer = setTimeout(() => void tick(), Math.min(MAX_DELAY, Math.max(1_000, next - Date.now() + CLOSE_GRACE_MS)));
    };
    const tick = async (): Promise<void> => {
      last = Date.now();
      try {
        await catchUpAll();
      } finally {
        clearTimeout(timer);
        arm();
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === "visible" && Date.now() - last > MIN_GAP_MS) {
        clearTimeout(timer);
        void tick();
      }
    };
    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);

  return null;
}
