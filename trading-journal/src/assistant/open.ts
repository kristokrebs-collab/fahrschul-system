/**
 * Open state of the assistant sheet – deliberately tiny (zustand only), so the header button and the shortcuts can
 * import it without pulling the assistant chunk (`AssistantHost`, lazy in `DeferredHosts`).
 */
import { create } from "zustand";

interface AssistantOpenState {
  open: boolean;
  /** text to put into the input when the sheet opens (a chip elsewhere, a shortcut) */
  prefill: string;
  /** start the microphone right after opening (the mic button of the header / dashboard card) */
  listen: boolean;
  /** bumps per open, so a repeated prefill is seen */
  seq: number;
  openAssistant(opts?: { prefill?: string; listen?: boolean }): void;
  closeAssistant(): void;
}

export const useAssistantOpen = create<AssistantOpenState>()((set, get) => ({
  open: false,
  prefill: "",
  listen: false,
  seq: 0,
  openAssistant: (opts) => set({ open: true, prefill: opts?.prefill ?? "", listen: !!opts?.listen, seq: get().seq + 1 }),
  closeAssistant: () => set({ open: false, prefill: "", listen: false }),
}));

export const openAssistant = (opts?: { prefill?: string; listen?: boolean }): void => useAssistantOpen.getState().openAssistant(opts);
export const closeAssistant = (): void => useAssistantOpen.getState().closeAssistant();
