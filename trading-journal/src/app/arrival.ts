/**
 * The arrival note (A4): what the finder says when it has brought you to a place that is NOT the card itself – the card appears
 * only after a test run, needs an account, needs a higher plan, or the way is a few taps long ("Trade öffnen → Replay"). It
 * replaces the toast of the first version: a toast is gone in a few seconds and has no way on; the note stays at the bottom of the
 * page (until you dismiss it, change the page or open something else), says WHY and offers the next step as a button.
 *
 * State only (a zustand store, no DOM); the view is `ArrivalNote.tsx`, mounted once in the deferred hosts.
 */
import { create } from "zustand";
import type { Page } from "@/store/uiStore";

export interface ArrivalAction {
  id: string;
  label: string;
  run: () => void;
}

export interface Arrival {
  /** counts up with every note (a new note restarts the view's timer and animation) */
  seq: number;
  /** the register id it belongs to (or `page:<page>`), for tests and the view's `data-feature` */
  featureId: string;
  /** the page the person was brought to: leaving it dismisses the note */
  page: Page;
  title: string;
  text: string;
  /** `warn` = the place is not there yet (honest reason), `info` = a way to go on */
  tone: "info" | "warn";
  actions: readonly ArrivalAction[];
  /** closes by itself after this long (ms); absent = stays until dismissed */
  autoCloseMs?: number;
}

export const useArrival = create<{ current: Arrival | null; seq: number }>(() => ({ current: null, seq: 0 }));

/** Shows a note (replaces the one on screen). Returns its `seq`, so that whoever showed it can take it away again (`dismissArrival(seq)`). */
export function showArrival(a: Omit<Arrival, "seq">): number {
  const seq = useArrival.getState().seq + 1;
  useArrival.setState({ seq, current: { ...a, seq } });
  return seq;
}

/** Closes the note (no-op without one). `seq` closes it only if it is still that very note (a timer must not close a newer one). */
export function dismissArrival(seq?: number): void {
  const cur = useArrival.getState().current;
  if (!cur || (seq !== undefined && cur.seq !== seq)) return;
  useArrival.setState({ current: null });
}
