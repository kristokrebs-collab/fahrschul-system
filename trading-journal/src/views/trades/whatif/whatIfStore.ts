/**
 * Open state of "Was wäre wenn" (F33). A tiny store like `replayStore`: the trade detail steps aside, the sheet opens
 * on that trade and the detail comes back when it closes. The sheet itself is a lazy chunk (`WhatIfHost`, mounted by
 * `DeferredHosts` the first time `seq > 0`); this file stays small so the detail can import it.
 */
import { create } from "zustand";
import { useUi } from "@/store/uiStore";

export interface WhatIfState {
  id: string | null;
  /** Re-open the trade detail when the sheet closes. */
  back: boolean;
  /** bumps per open: the host mounts its chunk on the first one */
  seq: number;
}

export const useWhatIf = create<WhatIfState>()(() => ({ id: null, back: false, seq: 0 }));

export function openWhatIf(id: string, opts: { fromDetail?: boolean } = {}): void {
  if (opts.fromDetail) useUi.getState().closeDetail();
  useWhatIf.setState((s) => ({ id, back: opts.fromDetail === true, seq: s.seq + 1 }));
}

export function closeWhatIf(): void {
  const { id, back } = useWhatIf.getState();
  useWhatIf.setState({ id: null, back: false });
  if (back && id) useUi.getState().openDetail(id, "insights");
}
