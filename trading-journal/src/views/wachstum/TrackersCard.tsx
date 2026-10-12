/**
 * Psych trackers (P08): FOMO, Revenge, Selbstüberschätzung, Impulsivität, Verlustangst, Gewinnmitnahme – from the
 * coach's behaviour events (P04, incl. the trade editor's psyche flags of P06) and the check-in words. "Trade the
 * best": the most frequent pattern gets the headline (count in dot digits, its cost in R, one red `SpotlightSweep`
 * across the card once), the others are compact rows with 8 weekly bars that rise on first view. All quiet = said so.
 */
import { motion } from "motion/react";
import { useRef } from "react";
import { topTracker, trackerLine, type Tracker } from "@/domain/psych";
import { cn } from "@/lib/cn";
import { SpotlightSweep } from "@/motion/fx";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { useSeenOnce } from "@/primitives/revealValue";
import { WACHSTUM } from "./strings";

const P = WACHSTUM.psyche;

function Bars({ weekly, tone }: { weekly: readonly number[]; tone: "signal" | "fg" | "mute" }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useSeenOnce(ref);
  const max = Math.max(1, ...weekly);
  const fill = tone === "signal" ? "bg-signal" : tone === "fg" ? "bg-fg/70" : "bg-white/20";
  return (
    <span ref={ref} className="flex h-6 items-end gap-[3px]" role="img" aria-label={`Je Woche: ${weekly.join(", ")}`}>
      {weekly.map((n, i) => (
        <motion.span
          key={i}
          className={cn("w-[5px] origin-bottom rounded-[2px]", n ? fill : "bg-white/[0.08]")}
          style={{ height: `${Math.max(12, (n / max) * 100)}%` }}
          initial={reduced ? false : { scaleY: 0 }}
          animate={seen || reduced ? { scaleY: 1, transitionEnd: { transform: "none" } } : { scaleY: 0 }}
          transition={{ ...spring.enter, delay: reduced ? 0 : i * stagger.reveal }}
        />
      ))}
    </span>
  );
}

const costText = (r: number | null) => (r == null ? "" : `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(1).replace(".", ",")} R gg. saubere Trades`);

export function TrackersCard({ trackers, className }: { trackers: readonly Tracker[]; className?: string }) {
  const top = topTracker(trackers);
  const rest = trackers.filter((t) => t !== top);
  return (
    <Card title={P.trackers} note="Aus deinen Trades und Check-ins der letzten 30 Tage." className={className} data-testid="growth-trackers" data-top={top?.key ?? ""}>
      <div className="grid gap-4">
        {top ? (
          <div className="relative overflow-hidden rounded-2xl border border-signal/30 bg-signal/[0.06] p-4" data-testid="tracker-top">
            <SpotlightSweep tone="signal" />
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="grid gap-1">
                <span className="label !text-[10px] !text-signal">Häufigstes Muster</span>
                <span className="text-[17px] font-semibold">{top.label}</span>
                <span className="text-[12px] text-mute">{top.hint}</span>
              </div>
              <div className="flex items-end gap-3">
                <span className="dot-num text-[40px] leading-none text-signal">{top.count}×</span>
                <Bars weekly={top.weekly} tone="signal" />
              </div>
            </div>
            <p className="mt-2 text-[11.5px] text-mute">
              {trackerLine(top)}
              {top.costR != null && top.costR < 0 ? ` · ${costText(top.costR)}` : ""}
              {top.selfReported ? ` · ${P.self(top.selfReported)}` : ""}
            </p>
          </div>
        ) : (
          <p className="rounded-2xl border border-win/25 bg-win/[0.05] p-4 text-[13px] text-fg" data-testid="tracker-quiet">
            {P.quiet}
          </p>
        )}
        <ul className="grid gap-2 sm:grid-cols-2">
          {rest.map((t) => (
            <li key={t.key} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5" data-testid="tracker-row" data-key={t.key} data-count={t.count}>
              <span className="grid min-w-0 gap-0.5">
                <span className="truncate text-[12.5px] font-medium">{t.label}</span>
                <span className="truncate text-[10.5px] text-faint">
                  {trackerLine(t)}
                  {t.selfReported ? ` · ${P.self(t.selfReported)}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-end gap-2">
                <span className={cn("num font-mono text-[15px] font-semibold leading-none", t.count ? "text-fg" : "text-faint")}>{t.count}×</span>
                <Bars weekly={t.weekly} tone={t.count ? "fg" : "mute"} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
