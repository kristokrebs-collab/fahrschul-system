/**
 * „Ähnliche Situationen“ öffnen (F19): a request, nothing more. The assistant (and anything else) asks for the card; the
 * Markt page scrolls to it and moves focus there. Deliberately tiny (zustand only) so callers can import it without the
 * card's chunk. The request is kept until the card has consumed it, so it survives the page change and the lazy load.
 */
import { create } from "zustand";

interface SimilarOpenState {
  /** a request waits for the card */
  pending: boolean;
  /** bumps per request, so a repeated one is seen by an already mounted card */
  seq: number;
  request(): void;
  consume(): void;
}

export const useSimilarOpen = create<SimilarOpenState>()((set, get) => ({
  pending: false,
  seq: 0,
  request: () => set({ pending: true, seq: get().seq + 1 }),
  consume: () => set({ pending: false }),
}));

export const openSimilar = (): void => useSimilarOpen.getState().request();
