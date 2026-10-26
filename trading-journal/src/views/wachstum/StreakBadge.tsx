/**
 * Streaks (P08): journal, check-in, green days (in the limits – not in profit) and discipline as four badges. The
 * count rolls (`RollingDigits`), a running streak breathes with a radar `PulseDot` (`rings={2}`, finite), and a streak
 * that grew since this device last saw it bursts once (`celebrateStreak` – a white echo from 5 on). The first visit of
 * a device initialises silently: history is not celebrated. Process only – a P&L streak never appears here.
 */
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Streak } from "@/domain/growth";
import { cn } from "@/lib/cn";
import { celebrateStreak } from "@/motion/fx";
import { PulseDot } from "@/motion/PulseDot";
import { RollingDigits } from "@/motion/RollingDigits";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { useGrowthUi } from "./growthStore";

export interface StreakBadgeProps {
  streak: Streak;
  index?: number;
  /** a ref to the badge for the burst */
  badgeRef?: (el: HTMLDivElement | null) => void;
}

export function StreakBadge({ streak: s, index = 0, badgeRef }: StreakBadgeProps) {
  const reduced = useReducedFx();
  const live = s.current > 0;
  const record = live && s.current >= s.best && s.best >= 2;
  return (
    <motion.div
      ref={badgeRef}
      className={cn("relative grid min-w-0 content-start gap-1.5 rounded-2xl border bg-ink-950/50 p-3.5 sm:p-4", live ? "border-line-2" : "border-line")}
      initial={reduced ? false : { opacity: 0, y: 10, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1, transitionEnd: { transform: "none" } }}
      transition={{ ...spring.enter, delay: reduced ? 0 : index * stagger.cards * 2 }}
      data-testid={`streak-${s.key}`}
      data-current={s.current}
      data-best={s.best}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="label !text-[10px] truncate">{s.label}</span>
        {live ? <PulseDot tone="win" rings={2} size={6} /> : <span aria-hidden="true" className="size-1.5 rounded-full bg-white/15" />}
      </div>
      <div className="flex items-baseline gap-1.5">
        <RollingDigits value={s.current} className={cn("dot-num text-[38px] leading-none", live ? "text-fg" : "text-faint")} aria-label={`${s.label}: ${s.current} ${s.unit}`} />
        {record && <span className="rounded-full border border-signal/50 px-1.5 py-px text-[9.5px] font-semibold uppercase tracking-wider text-signal">Rekord</span>}
      </div>
      <span className="truncate text-[11px] text-mute">
        {s.unit}
        {s.pending ? " · heute offen" : ""}
      </span>
      <span className="num truncate text-[10.5px] text-faint">Bestwert {s.best}</span>
    </motion.div>
  );
}

/** The four badges + the once-per-device streak burst. */
export function StreakBoard({ streaks, className }: { streaks: readonly Streak[]; className?: string }) {
  const seen = useGrowthUi((s) => s.seen);
  const markSeen = useGrowthUi((s) => s.markSeen);
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    const cur = Object.fromEntries(streaks.map((s) => [s.key, s.current]));
    if (!seen.init) {
      markSeen({ streaks: cur });
      return;
    }
    const grown = streaks.filter((s) => s.current >= 2 && s.current > (seen.streaks[s.key] ?? 0));
    const changed = streaks.some((s) => (seen.streaks[s.key] ?? -1) !== s.current);
    if (!changed) return;
    markSeen({ streaks: cur });
    const best = grown.sort((a, b) => b.current - a.current)[0];
    if (best) celebrateStreak(refs.current[best.key], { streak: best.current });
  }, [streaks, seen, markSeen]);
  return (
    <Card title="Laufende Serien" note="Aktuelle Länge und Bestwert je Serie." className={className} data-testid="growth-streaks">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {streaks.map((s, i) => (
          <StreakBadge
            key={s.key}
            streak={s}
            index={i}
            badgeRef={(el) => {
              refs.current[s.key] = el;
            }}
          />
        ))}
      </div>
      <p className="mt-3 text-[11px] text-faint">Grüne Tage = Handelstage im Limit ohne Regelbruch – auch ein roter Tag kann grün sein.</p>
    </Card>
  );
}
