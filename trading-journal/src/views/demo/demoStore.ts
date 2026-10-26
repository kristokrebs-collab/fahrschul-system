/**
 * Open state of the demo (F58). A tiny store (the settings card and the function register import it without loading the demo):
 * `openDemo` opens the sheet, `seq` mounts its chunk (`DeferredHosts` → `DemoMount`) on the first open and starts a fresh,
 * empty session on every open. Nothing of the demo is persisted – closing it discards the whole session.
 */
import { create } from "zustand";

export interface DemoState {
  open: boolean;
  /** bumps per open: the host mounts its chunk on the first one and starts a new session on every one */
  seq: number;
}

export const useDemo = create<DemoState>()(() => ({ open: false, seq: 0 }));

export const openDemo = (): void => useDemo.setState((s) => ({ open: true, seq: s.seq + 1 }));
export const closeDemo = (): void => useDemo.setState({ open: false });
