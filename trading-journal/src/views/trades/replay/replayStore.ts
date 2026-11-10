/**
 * Open state of the trade replay (Journal v3, P06). Own tiny store (not `uiStore`): `openReplay(id)` from the trade
 * detail closes the detail and opens the replay sheet; closing the replay brings that detail back (fades in, no morph).
 */
import { create } from "zustand";
import { useUi } from "@/store/uiStore";

export interface ReplayState {
  id: string | null;
  /** Re-open the trade detail when the replay closes. */
  back: boolean;
}

export const useReplay = create<ReplayState>()(() => ({ id: null, back: false }));

/** Opens the replay of trade `id` (from the detail: the detail steps aside and returns afterwards). */
export function openReplay(id: string, opts: { fromDetail?: boolean } = {}): void {
  if (opts.fromDetail) useUi.getState().closeDetail();
  useReplay.setState({ id, back: opts.fromDetail === true });
}

export function closeReplay(): void {
  const { id, back } = useReplay.getState();
  useReplay.setState({ id: null, back: false });
  if (back && id) useUi.getState().openDetail(id, "insights");
}
