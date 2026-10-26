/**
 * Open state of „Zeitmaschine für diesen Trade“. A tiny store like `whatIfStore`: the trade detail steps aside, the sheet opens
 * on that trade and the detail comes back when it closes. The sheet itself is a lazy chunk (`TradeSheet`, mounted by
 * `DeferredHosts` the first time `seq > 0`); this file stays small so the detail can import it.
 */
import { create } from "zustand";
import { useUi } from "@/store/uiStore";

export interface TmSheetState {
  id: string | null;
  /** Re-open the trade detail when the sheet closes. */
  back: boolean;
  /** bumps per open: the host mounts its chunk on the first one */
  seq: number;
}

export const useTmSheet = create<TmSheetState>()(() => ({ id: null, back: false, seq: 0 }));

export function openTimeMachine(id: string, opts: { fromDetail?: boolean } = {}): void {
  if (opts.fromDetail) useUi.getState().closeDetail();
  useTmSheet.setState((s) => ({ id, back: opts.fromDetail === true, seq: s.seq + 1 }));
}

export function closeTimeMachine(): void {
  const { id, back } = useTmSheet.getState();
  useTmSheet.setState({ id: null, back: false });
  if (back && id) useUi.getState().openDetail(id, "insights");
}
