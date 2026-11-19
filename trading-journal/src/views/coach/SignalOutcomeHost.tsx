import { useEffect } from "react";
import { storageKey } from "@/store/storage";
import { useJournal } from "@/store/journalStore";

/** Wait after the journal has loaded before the app looks for signals without an outcome (the first paint and the other hosts go first). */
export const OUTCOME_START_WAIT_MS = 12_000;

const ARCHIVE_KEY = storageKey("signal-events");

/** Is there at least one stored entry signal? A raw look at the string, so a device without signals loads nothing at all. */
function hasStoredEntries(): boolean {
  try {
    return (localStorage.getItem(ARCHIVE_KEY) ?? "").includes('"entry":true');
  } catch {
    return false;
  }
}

/**
 * Leaf host of the automatic signal outcomes (F32): once after the app started – when the archive holds entry signals – the
 * evaluation of the ones without a final outcome is requested (`requestAutoOutcomes("start")`, `./signalAuto`). That runs in idle
 * moments, a few signals at a time, never in a background tab and not with data saving or a low battery. The module is fetched
 * only then (own chunk). Renders nothing; mounted in `DeferredHosts`, only with the Coach in the plan.
 */
export function SignalOutcomeHost() {
  const loaded = useJournal((s) => s.loaded);
  useEffect(() => {
    if (!loaded) return;
    const t = window.setTimeout(() => {
      if (!hasStoredEntries()) return;
      void import("./signalAuto").then((m) => m.requestAutoOutcomes("start")).catch(() => undefined);
    }, OUTCOME_START_WAIT_MS);
    return () => window.clearTimeout(t);
  }, [loaded]);
  return null;
}
