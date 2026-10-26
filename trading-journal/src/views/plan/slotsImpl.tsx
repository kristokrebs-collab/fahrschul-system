/**
 * The Zeitmaschine of the Handelsplan (`Slots.tsx`): the place for "spiel den Plan an echten Kerzen durch". The panel is built by
 * another agent; until the main agent wires it in here, this placeholder is all there is – and it says so.
 */
import type { TimeMachineSlotProps } from "./types";

export function TimeMachineSlotImpl({ symbol }: TimeMachineSlotProps) {
  return (
    <div className="grid gap-1.5 rounded-xl border border-dashed border-line-2 bg-ink-950/40 p-4" data-testid="hplan-timemachine-slot" data-state="empty">
      <h3 className="label !text-mute">Zeitmaschine</h3>
      <p className="text-[13px] text-fg">Kommt gleich.</p>
      <p className="text-[12px] text-mute">Hier lässt sich der Plan für {symbol} an den echten Kerzen Schritt für Schritt durchspielen – ohne die Zukunft zu zeigen.</p>
    </div>
  );
}
