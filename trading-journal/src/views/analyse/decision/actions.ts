/**
 * Writes of the card „Entscheidung“ (F24): the trader's own mark on a trade (`trade.decision`) – one click, one trade, from the
 * LATEST stored record (so a note typed elsewhere in the meantime is not overwritten) – and emptying the KI-Protokoll. Nothing
 * is written by the app on its own; a hint of the list („ein Signal passt zeitlich“) changes nothing until the trader taps.
 */
import { withDecision } from "@/domain/provenance";
import type { DecisionBy } from "@/domain/types";
import { clearAiLog } from "@/store/aiLog";
import { useJournal } from "@/store/journalStore";

/** Sets (or, with `null`, removes) the decision of a trade. Returns false when the trade is gone or the write failed. */
export async function setTradeDecision(tradeId: string, by: DecisionBy | null, now: Date = new Date()): Promise<boolean> {
  const { trades, saveTrade } = useJournal.getState();
  const raw = trades.find((t) => t.id === tradeId);
  if (!raw) return false;
  try {
    await saveTrade({ ...withDecision(raw, by), updatedAt: now.toISOString() });
    return true;
  } catch {
    return false;
  }
}

export const emptyAiLog = clearAiLog;
