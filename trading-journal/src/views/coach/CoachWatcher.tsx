/**
 * Live coach watcher (P04): after a trade is saved, the coach checks what the save added – a revenge entry 12 minutes
 * after a loss, the third trade after two losses, a sized-up trade after a winning streak … – and says it once, as a
 * toast with the advice and the suggested pause (`coachAlert`, pure, `src/domain/coach/watch.ts`). The Heute card shows
 * the same alert with a countdown; a critical one fires a red `BorderBeam` lap there.
 *
 * Only real saves count: at most `BULK_SAVE` records changed at once (an import, a restore or a sync snapshot is not
 * a save) and only records whose `updatedAt` is fresh. Hints (severity 1) are not toasted – they wait in the timeline.
 * Each event (behaviour + triggering trade) is toasted at most once per session. Never blocks anything.
 *
 * P14: mount `<CoachWatcher />` once in App.tsx as a leaf with `data-layer`, after SetupEditor, before Celebrate.
 */
import { useEffect } from "react";
import { coachAlert } from "@/domain/coach";
import type { Trade } from "@/domain/types";
import { getEnriched, useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { useCoachUi } from "./coachStore";

/** More records changed at once than this = a bulk change, not a save. */
export const BULK_SAVE = 3;
/** A record counts as "just saved" within this window of its `updatedAt`. */
export const FRESH_MS = 5 * 60_000;

/** Ids of records added or changed between two snapshots (new object with a different `updatedAt`, or new). */
export function changedIds(prev: readonly Trade[], next: readonly Trade[]): string[] {
  const before = new Map(prev.map((t) => [t.id, t]));
  return next.filter((t) => {
    const b = before.get(t.id);
    return !b || (b !== t && b.updatedAt !== t.updatedAt);
  }).map((t) => t.id);
}

/** Saved just now (not an imported / synced old record). */
export function fresh(t: Pick<Trade, "updatedAt">, now: number): boolean {
  const u = Date.parse(t.updatedAt);
  return Number.isFinite(u) && Math.abs(now - u) <= FRESH_MS;
}

/** The watcher (see the module comment). One subscription per mount; the store state at mount is the baseline. */
export function useCoachWatch(): void {
  useEffect(() => {
    const toasted = new Set<string>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let prev = useJournal.getState();
    const off = useJournal.subscribe((state) => {
      const before = prev;
      prev = state;
      if (!state.loaded || !before.loaded || state.trades === before.trades) return;
      const now = Date.now();
      const ids = changedIds(before.trades, state.trades);
      if (!ids.length || ids.length > BULK_SAVE) return;
      const byId = new Map(state.trades.map((t) => [t.id, t]));
      const freshIds = new Set(ids.filter((id) => fresh(byId.get(id)!, now)));
      if (!freshIds.size) return;
      // off the save's own task: the detectors read the whole journal twice, the save and its commit must not wait
      timers.add(
        setTimeout(() => {
          const alert = coachAlert({ before: getEnriched(before.trades, before.settings), after: getEnriched(state.trades, state.settings), changedIds: freshIds, settings: state.settings, days: state.days, now, minSeverity: 2 });
          if (!alert) return;
          const key = `${alert.key}|${alert.tradeId}`;
          if (toasted.has(key)) return;
          toasted.add(key);
          useCoachUi.getState().pushAlert(alert, now);
          const more = alert.more > 0 ? ` · +${alert.more} weitere` : "";
          pushToast({ kind: alert.severity >= 3 ? "error" : "signal", title: alert.title, detail: `${alert.detail}${more}` });
        }, 0),
      );
    });
    return () => {
      off();
      for (const t of timers) clearTimeout(t);
    };
  }, []);
}

/** Leaf host for App.tsx (P14): runs the watcher, renders nothing. */
export function CoachWatcher() {
  useCoachWatch();
  return null;
}
