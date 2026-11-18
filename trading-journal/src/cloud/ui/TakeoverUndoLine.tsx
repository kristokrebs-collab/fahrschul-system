import { useEffect, useState } from "react";
import { Button } from "@/primitives/Button";
import { pushToast } from "@/store/uiStore";
import { ensureCloud } from "../runtime";
import { setUndoUntil, useTakeover } from "../takeover";
import { leftLabel, TAKEOVER } from "./takeoverStrings";

/**
 * The open undo window of a data takeover as one line in the sync card (the dialog may be closed long ago): the time left
 * and „Rückgängig“. Renders nothing without an open window; closes itself when the window ends.
 */
export function TakeoverUndoLine() {
  const until = useTakeover((s) => s.undoUntil);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  useEffect(() => {
    if (until && Date.parse(until) <= now) setUndoUntil(null);
  }, [until, now]);
  if (!until || Date.parse(until) <= now) return null;
  async function undo() {
    setBusy(true);
    const m = await ensureCloud().catch(() => null);
    const ok = m ? await m.undoTakeover().catch(() => false) : false;
    setBusy(false);
    pushToast(ok ? { kind: "success", title: TAKEOVER.undoDone.title, detail: TAKEOVER.undoDone.detail } : { kind: "error", title: TAKEOVER.undoFailed });
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2" data-testid="takeover-undo-line">
      <span className="text-[12.5px] text-mute">{TAKEOVER.card.undoLine(leftLabel(until, now))}</span>
      <Button size="sm" disabled={busy} onClick={() => void undo()}>
        {TAKEOVER.card.undo}
      </Button>
    </div>
  );
}
