/**
 * Writes of the training (F38) into the synced settings (`settings.training`). The order is the point: the DECISION is
 * stored (with its time) before the future is shown – `persistRound` resolves `true` only when the write went through,
 * and the view reveals only then. A failed write keeps the trader on the decision.
 */
import { withReflection, withTrainingRound, type TrainingRound, type Verdict } from "@/domain/training";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { TRAIN } from "./strings";

async function write(next: ReturnType<typeof withTrainingRound>): Promise<boolean> {
  try {
    await useJournal.getState().saveSettings(next);
    return true;
  } catch {
    pushToast({ kind: "error", title: TRAIN.failed, detail: "Bitte noch einmal versuchen." });
    return false;
  }
}

/** Stores a new round (the decision) – before the reveal. */
export function persistRound(round: TrainingRound): Promise<boolean> {
  return write(withTrainingRound(useJournal.getState().settings, round));
}

/** Stores the trader's reflection (needs the reveal). */
export async function persistReflection(id: string, verdict: Verdict, note: string, now: number = Date.now()): Promise<boolean> {
  const s = useJournal.getState().settings;
  const next = withReflection(s, id, verdict, note, now);
  if (next === s) return false;
  return write(next);
}
