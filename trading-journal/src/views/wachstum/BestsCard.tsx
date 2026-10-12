/**
 * Personal bests and milestones (P08) – process records only (streaks, rule-keeping runs, reviewed trades, the best
 * discipline month). A record this device has not seen yet decodes itself (`TextScramble`) and bursts once
 * (`celebrateRecord`: the record kind with its red dot + a white echo); a running record carries "läuft". Milestones:
 * how many are reached, and – "trade the best" – only the next three closest ones with their progress.
 */
import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { Milestone, PersonalBest } from "@/domain/growth";
import { cn } from "@/lib/cn";
import { celebrateRecord } from "@/motion/fx";
import { TextScramble } from "@/motion/TextScramble";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { useSeenOnce } from "@/primitives/revealValue";
import { useGrowthUi } from "./growthStore";
import { WACHSTUM } from "./strings";

const P = WACHSTUM.progress;

function Progress({ m, index }: { m: Milestone; index: number }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLLIElement>(null);
  const seen = useSeenOnce(ref);
  return (
    <li ref={ref} className="grid gap-1.5" data-testid="milestone-next" data-key={m.key}>
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="truncate font-medium">{m.label}</span>
        <span className="num shrink-0 font-mono text-[11px] text-faint">
          {Math.min(m.value, m.threshold)}/{m.threshold}
        </span>
      </div>
      <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.span
          className="block h-full origin-left rounded-full bg-fg/80"
          initial={reduced ? false : { scaleX: 0 }}
          animate={seen || reduced ? { scaleX: m.progress } : { scaleX: 0 }}
          transition={{ ...spring.enter, delay: reduced ? 0 : index * stagger.reveal * 2 }}
        />
      </span>
    </li>
  );
}

export function BestsCard({ bests, next, className }: { bests: readonly PersonalBest[]; next: { reached: number; total: number; next: readonly Milestone[] }; className?: string }) {
  const reduced = useReducedFx();
  const seen = useGrowthUi((s) => s.seen);
  const markSeen = useGrowthUi((s) => s.markSeen);
  const newBests = useGrowthUi((s) => s.newBests);
  const noteNewBests = useGrowthUi((s) => s.noteNewBests);
  const refs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => {
    const values = Object.fromEntries(bests.map((b) => [b.key, b.value]));
    const changed = bests.some((b) => seen.bests[b.key] !== b.value);
    if (!changed) return;
    // only a value this device saw before can be beaten – the first look remembers silently
    const beaten = bests.filter((b) => seen.bests[b.key] != null && b.value > seen.bests[b.key]!);
    markSeen({ bests: values });
    if (beaten.length) {
      noteNewBests(beaten.map((b) => b.key));
      celebrateRecord(refs.current[beaten[0]!.key]);
    }
  }, [bests, seen, markSeen, noteNewBests]);

  return (
    <Card title={P.bests} note={`${next.reached} von ${next.total} Meilensteinen erreicht`} className={className} data-testid="growth-bests" data-n={bests.length}>
      <div className="grid gap-5">
        {bests.length === 0 ? (
          <p className="text-[12.5px] leading-relaxed text-mute">{P.noBests}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {bests.map((b, i) => {
              const fresh = newBests.includes(b.key);
              return (
                <motion.li
                  key={b.key}
                  ref={(el) => {
                    refs.current[b.key] = el;
                  }}
                  className={cn("grid gap-1 rounded-xl border px-3 py-2.5", fresh ? "border-signal/50 bg-signal/[0.06]" : "border-line")}
                  data-testid="best"
                  data-key={b.key}
                  data-new={fresh ? "1" : "0"}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
                  transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.cards * 2 }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11.5px] text-mute">{b.label}</span>
                    {fresh ? <span className="text-[9.5px] font-semibold uppercase tracking-wider text-signal">{P.newBest}</span> : b.live ? <span className="text-[9.5px] font-semibold uppercase tracking-wider text-win">{P.live}</span> : null}
                  </span>
                  {fresh ? <TextScramble text={b.valueText} className="dot-num text-[22px] leading-none" /> : <span className="dot-num text-[22px] leading-none">{b.valueText}</span>}
                </motion.li>
              );
            })}
          </ul>
        )}
        {next.next.length > 0 && (
          <div className="grid gap-2.5 border-t border-line pt-4">
            <span className="label !text-[10px]">Nächste Meilensteine</span>
            <ul className="grid gap-3">
              {next.next.map((m, i) => (
                <Progress key={m.key} m={m} index={i} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
