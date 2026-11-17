import { Fragment, useMemo } from "react";
import { cn } from "@/lib/cn";
import { Marquee } from "@/motion/pulse/Marquee";
import { useJournal } from "@/store/journalStore";
import { FACTS, PREISE } from "./strings";

/**
 * Stats band (P10): product facts that are true by construction plus the visitor's OWN journal (number of trades in
 * this browser) – never invented user counts. Marquee drift (pauses off screen and on hover; static under reduced
 * motion), mono caps like the footer band.
 */
export function StatsMarquee({ className }: { className?: string }) {
  const trades = useJournal((s) => s.trades.length);
  const items = useMemo(
    () => (trades > 0 ? [`Dein Journal: ${trades.toLocaleString("de-DE")} ${trades === 1 ? "Trade" : "Trades"}`, ...FACTS] : [...FACTS]),
    [trades],
  );
  return (
    <div className={cn("relative overflow-hidden rounded-2xl border border-line bg-ink-950/60 py-3", className)} data-testid="stats-marquee">
      <Marquee aria-label={PREISE.marqueeLabel} gap={0} fade={56} className="font-mono text-[11.5px] font-medium uppercase tracking-[0.2em]">
        {items.map((t, i) => (
          <Fragment key={t}>
            <span className={cn("whitespace-nowrap px-6", i === 0 && trades > 0 ? "text-fg" : "text-mute")}>{t}</span>
            <span aria-hidden="true" className="text-faint">
              ✦
            </span>
          </Fragment>
        ))}
      </Marquee>
    </div>
  );
}
