/**
 * State of the data-takeover dialog (B1) – a light zustand store (no Supabase import, types only from `sync/takeover`).
 * The sync engine lives in the lazy cloud chunk; it calls `requestTakeover(preview)` and waits for the answer, the dialog
 * (`ui/TakeoverDialog`, lazy) reads this store and calls `answerTakeover(choice)`.
 *
 * Phases: `idle` → `choose` (numbers on screen, waiting for the choice) → `working` (snapshot, merge, upload with progress)
 * → `done` (summary, undo) or `error`. The undo window outlives the dialog: `undoUntil` feeds the line in the sync card.
 */
import { create } from "zustand";
import { closeAuthSheet, useCloudSession } from "./session";
import type { TakeoverChoice, TakeoverPreview, TakeoverResult, TakeoverStep } from "./sync/takeover";

export type TakeoverPhase = "idle" | "choose" | "working" | "done" | "error" | "undone";

export interface TakeoverState {
  phase: TakeoverPhase;
  preview: TakeoverPreview | null;
  choice: TakeoverChoice | null;
  step: TakeoverStep | null;
  result: TakeoverResult | null;
  error: string | null;
  /** The dialog was opened once: it stays mounted so its exit can run. */
  mounted: boolean;
  /** End of the open undo window (ISO) – survives closing the dialog. */
  undoUntil: string | null;
}

const IDLE: TakeoverState = { phase: "idle", preview: null, choice: null, step: null, result: null, error: null, mounted: false, undoUntil: null };

export const useTakeover = create<TakeoverState>()(() => ({ ...IDLE }));

let pending: ((c: TakeoverChoice) => void) | null = null;

/** Engine side: shows the dialog and resolves with the user's choice (`keep` when the dialog is dismissed). */
export function requestTakeover(preview: TakeoverPreview): Promise<TakeoverChoice> {
  pending?.("keep");
  // one sheet at a time: the login sheet's welcome step gives way to the question
  if (useCloudSession.getState().sheet.open) closeAuthSheet();
  return new Promise<TakeoverChoice>((resolve) => {
    pending = resolve;
    useTakeover.setState({ phase: "choose", preview, choice: null, step: null, result: null, error: null, mounted: true });
  });
}

/** Dialog side: the user chose. */
export function answerTakeover(choice: TakeoverChoice): void {
  const r = pending;
  pending = null;
  useTakeover.setState(choice === "keep" ? { phase: "idle", choice } : { phase: "working", choice, step: null, error: null });
  r?.(choice);
}

/** Engine hooks (`EngineDeps.takeover`). */
export const takeoverHooks = {
  step(step: TakeoverStep): void {
    if (useTakeover.getState().phase === "working") useTakeover.setState({ step });
  },
  done(result: TakeoverResult): void {
    useTakeover.setState({ phase: "done", result, step: "finish", undoUntil: result.undoUntil });
  },
  undone(): void {
    useTakeover.setState({ phase: "undone", undoUntil: null, result: null });
  },
  failed(message: string): void {
    if (useTakeover.getState().phase === "working") useTakeover.setState({ phase: "error", error: message });
  },
};

/** Closes the dialog (after done / error / undone). */
export function closeTakeover(): void {
  if (useTakeover.getState().phase === "choose") answerTakeover("keep");
  else useTakeover.setState({ phase: "idle", preview: null, step: null, error: null });
}

export function setUndoUntil(iso: string | null): void {
  if (useTakeover.getState().undoUntil !== iso) useTakeover.setState({ undoUntil: iso });
}

/** Tests: back to the initial state. */
export function resetTakeover(): void {
  pending = null;
  useTakeover.setState({ ...IDLE });
}
