import { useId, useState } from "react";
import { compoundLabel } from "@/domain/account";
import { explain } from "@/domain/explain";
import { cn } from "@/lib/cn";
import { colorClass, n0, n1, pct } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse, Expander } from "@/primitives/Expander";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { ExplanationView } from "./explainer";

export const PROJECTION_TITLE = "Hochrechnung aufs Jahr";
export const PROJECTION_EMPTY_TITLE = "Noch nichts hochzurechnen";
export const PROJECTION_EMPTY_TEXT = "Mit dem ersten abgeschlossenen Trade rechne ich deine Rendite auf 12 Monate hoch.";
export const PROJECTION_WEAK = "Wenig Daten. Belastbar ab etwa 30 Tagen und 10 Trades.";

/** `Hochrechnung aufs Jahr` (Bundle `She`, Plan 6.1): linear `MotionNumber` %, dl rows, weak-data warning, expander → `explain("projection")`. */
export function ProjectionCard() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const p = view.proj;
  const cur = settings.currency;
  const [open, setOpen] = useState(false);
  const regionId = useId();

  const rows: [string, string, string][] = p
    ? [
        ["Rendite bisher", pct(p.r), colorClass(p.r)],
        ["Ø pro Monat", pct(p.monthly), colorClass(p.monthly)],
        ["Konto in 12 Monaten", `${n0(p.endLin)} ${cur}`, "text-fg"],
        ["Mit Zinseszins", compoundLabel(p.comp, pct), colorClass(p.comp)],
        ["Trades pro Woche", n1(p.perWeek), "text-fg"],
      ]
    : [];

  return (
    <Card title={PROJECTION_TITLE} action={<Expander open={open} onToggle={() => setOpen((o) => !o)} label="Hochrechnung" controls={regionId} />}>
      {p ? (
        <div className="flex h-full flex-col">
          <div className={cn("font-mono text-[38px] font-medium leading-none tracking-tight", colorClass(p.linear))}>
            <MotionNumber value={p.linear * 100} decimals={1} signed />
            <span className="text-xl text-mute"> %</span>
          </div>
          <div className="mt-1.5 text-xs text-mute">in 12 Monaten bei gleicher Performance, linear</div>
          <dl className="mt-4 grid text-[13px]">
            {rows.map(([l, v, cls]) => (
              <div key={l} className="flex justify-between gap-3 border-t border-line py-2">
                <dt className="text-mute">{l}</dt>
                <dd className={cn("num font-mono font-medium", cls)}>{v}</dd>
              </div>
            ))}
          </dl>
          {p.weak && <p className="mt-2 rounded-lg bg-warn/10 px-3 py-2 text-[11.5px] text-warn">{PROJECTION_WEAK}</p>}
        </div>
      ) : (
        <EmptyState title={PROJECTION_EMPTY_TITLE} text={PROJECTION_EMPTY_TEXT} />
      )}
      <Collapse open={open} id={regionId}>
        <ExplanationView d={explain("projection", view, settings)} />
      </Collapse>
    </Card>
  );
}
