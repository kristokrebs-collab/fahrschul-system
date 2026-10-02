import { motion, useTransform, type MotionValue } from "motion/react";
import { useId, useRef, useState } from "react";
import { streakLabel } from "@/domain/account";
import { explain } from "@/domain/explain";
import { pct0 } from "@/lib/format";
import { MotionNumber } from "@/motion/MotionNumber";
import { radius, spring, tween } from "@/motion/tokens";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { RingGauge } from "@/primitives/RingGauge";
import { useRevealValue } from "@/primitives/revealValue";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { ExplanationView } from "./explainer";

export const NO_STREAK = "Noch keine Serie";

const WIN = "#3ddc84";
const FG = "#f2f2f2";

/** Centre counter: the ring's own progress ×100, so the number and the arc arrive on the same frame. */
function GaugeCentre({ progress, label }: { progress: MotionValue<number>; label: string }) {
  const pct = useTransform(progress, (p) => p * 100);
  return <MotionNumber source={pct} decimals={0} aria-label={label} />;
}

/** The W/L/BE split bar wipes in left → right with the ring (clip-path on `tween.gauge`), its segments keep `layout`. */
function SplitBar({ wins, losses, be, n }: { wins: number; losses: number; be: number; n: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRevealValue(ref, 1, { transition: tween.gauge });
  const clipPath = useTransform(shown, (s) => (s >= 1 ? "none" : `inset(0 ${((1 - s) * 100).toFixed(2)}% 0 0 round 9999px)`));
  const total = n || 1;
  const seg = (basis: number, cls: string, key: string) => (
    <motion.span key={key} layout layoutDependency={`${wins}/${losses}/${be}`} transition={{ layout: spring.layout }} className={`h-full ${cls}`} style={{ flexBasis: `${basis}%`, borderRadius: radius.pill }} />
  );
  return (
    <motion.div ref={ref} className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-white/[0.06]" style={{ clipPath }} aria-hidden="true">
      {n > 0 && (
        <>
          {seg((wins / total) * 100, "bg-win", "w")}
          {seg((losses / total) * 100, "bg-loss", "l")}
          {be > 0 && seg((be / total) * 100, "bg-faint", "b")}
        </>
      )}
    </motion.div>
  );
}

/**
 * `Win-Rate` (Bundle `whe`, Plan 6.1): activity ring (148 px) that draws in on first view with a riding tip, white
 * below the backtest needle and green from the moment it passes it (halo flash on the crossing); the centre
 * counts frame-synced with the arc. Split bar (three `layout` flex segments, Plan 3.3) wipes in, legend, streak
 * line, expander → `explain("winRate")`.
 */
export function WinRateCard() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const g = view.g;
  const bt = settings.backtest.winRate;
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const streak = streakLabel(view.streak, view.streakType);
  const label = pct0(g.winRate);

  return (
    <Card title="Win-Rate" action={<Expander open={open} onToggle={() => setOpen((o) => !o)} label="Win-Rate" controls={regionId} />}>
      {/* top-anchored (no h-full / justify-between): opening the explainer below must not slide the legend up and
          back down while the stretched grid row re-balances (OV-01) */}
      <div className="flex flex-col items-center gap-4">
        <RingGauge value={g.winRate} marker={bt} color={FG} passColor={WIN} track="#222" aria-label={`Win-Rate ${label}`}>
          {(progress) => (
            <div>
              <div className="dot-num text-[34px] leading-none">
                <GaugeCentre progress={progress} label={label} />
                <span className="text-base text-mute"> %</span>
              </div>
              {/* two lines inside the ring's inner circle (one line was ~2 px wider than the circle at that height: OV-02) */}
              <div className="mx-auto mt-1 max-w-[96px] text-[11px] leading-[1.3] text-mute">
                Marke = Backtest <span className="whitespace-nowrap">{pct0(bt)}</span>
              </div>
            </div>
          )}
        </RingGauge>
        <div className="grid w-full gap-2">
          <SplitBar wins={g.wins} losses={g.losses} be={g.be} n={g.n} />
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
