import { motion } from "motion/react";
import { useId, useState } from "react";
import { streakLabel } from "@/domain/account";
import { explain } from "@/domain/explain";
import { pct0 } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { radius, spring } from "@/motion/tokens";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { RingGauge } from "@/primitives/RingGauge";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { ExplanationView } from "./explainer";

export const NO_STREAK = "Noch keine Serie";

/**
 * `Win-Rate` (Bundle `whe`, Plan 6.1): ring gauge (148 px, backtest marker, green when ≥ backtest),
 * `MotionNumber` centre, split bar (three `layout` flex segments, Plan 3.3), legend, streak line,
 * expander → `explain("winRate")`.
 */
export function WinRateCard() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const g = view.g;
  const n = g.n || 1;
  const bt = settings.backtest.winRate;
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const streak = streakLabel(view.streak, view.streakType);

  const seg = (basis: number, cls: string, key: string) => (
    <motion.span key={key} layout layoutDependency={`${g.wins}/${g.losses}/${g.be}`} transition={{ layout: spring.layout }} className={`h-full ${cls}`} style={{ flexBasis: `${basis}%`, borderRadius: radius.pill }} />
  );

  return (
    <Card title="Win-Rate" action={<Expander open={open} onToggle={() => setOpen((o) => !o)} label="Win-Rate" controls={regionId} />}>
      <div className="flex h-full flex-col items-center justify-between gap-4">
        <RingGauge value={g.winRate} marker={bt} color={g.winRate != null && g.winRate >= bt ? "#3ddc84" : "#f2f2f2"} track="#222" aria-label={`Win-Rate ${pct0(g.winRate)}`}>
          <div>
            <div className="dot-num text-[34px] leading-none">
              <MotionNumber value={g.winRate == null ? 0 : g.winRate * 100} decimals={0} />
              <span className="text-base text-mute"> %</span>
            </div>
            <div className="mt-1 text-[11px] text-mute">Marke = Backtest {pct0(bt)}</div>
          </div>
        </RingGauge>
        <div className="grid w-full gap-2">
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
            {g.n > 0 && (
              <>
                {seg((g.wins / n) * 100, "bg-win", "w")}
                {seg((g.losses / n) * 100, "bg-loss", "l")}
                {g.be > 0 && seg((g.be / n) * 100, "bg-faint", "b")}
              </>
            )}
          </div>
          <div className="flex justify-between text-xs text-mute">
            <span>
              <b className="font-mono text-win">{g.wins}</b> gut gegangen
            </span>
            <span>
              <b className="font-mono text-loss">{g.losses}</b> nicht
            </span>
          </div>
          <div className="text-center text-[11.5px] text-faint">{streak ? `Aktuelle Serie: ${streak}` : NO_STREAK}</div>
        </div>
      </div>
      <Collapse open={open} id={regionId}>
        <ExplanationView d={explain("winRate", view, settings)} />
      </Collapse>
    </Card>
  );
}
