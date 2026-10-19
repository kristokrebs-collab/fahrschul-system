/**
 * Open state of the training (F38). A tiny store (the trade detail, the replay and the assistant import it without
 * loading the training chunk): `openTraining` opens the sheet – optionally on one trade of the journal (its setup is
 * preselected and its situation leads the session). The sheet itself is a lazy chunk (`TrainingHost`, mounted by
 * `DeferredHosts` the first time `seq > 0`).
 */
import { create } from "zustand";
import { useUi } from "@/store/uiStore";

export interface TrainingState {
  open: boolean;
  /** the journal trade whose setup is preselected and whose situation comes first */
  tradeId: string | null;
  /** a setup to preselect without a trade (the assistant, deep links) */
  setupId: string | null;
  /** Re-open the trade detail when the sheet closes. */
  backTo: string | null;
  /** bumps per open: the host mounts its chunk on the first one and resets its session on every one */
  seq: number;
  /** typed input that is not stored yet (a half-made decision, an unsaved reflection): closing asks first */
  dirty: boolean;
}

export const useTraining = create<TrainingState>()(() => ({ open: false, tradeId: null, setupId: null, backTo: null, seq: 0, dirty: false }));

export const setTrainingDirty = (dirty: boolean): void => {
  if (useTraining.getState().dirty !== dirty) useTraining.setState({ dirty });
};

export interface OpenTrainingOptions {
  tradeId?: string;
  setupId?: string;
  /** opened from the trade detail: it steps aside and returns afterwards */
  fromDetail?: boolean;
  /** the detail is already closed (the replay sheet): bring it back afterwards */
  returnToDetail?: boolean;
}

export function openTraining(opts: OpenTrainingOptions = {}): void {
  if (opts.fromDetail) useUi.getState().closeDetail();
  const backTo = (opts.fromDetail || opts.returnToDetail) && opts.tradeId ? opts.tradeId : null;
  useTraining.setState((s) => ({ open: true, tradeId: opts.tradeId ?? null, setupId: opts.setupId ?? null, backTo, seq: s.seq + 1, dirty: false }));
}

export function closeTraining(): void {
  const { backTo } = useTraining.getState();
  useTraining.setState({ open: false, tradeId: null, setupId: null, backTo: null, dirty: false });
  if (backTo) useUi.getState().openDetail(backTo, "insights");
}
