/**
 * Streaks card (P03): longest winning / losing streak (count up on first view), the expected longest losing streak
 * for the win rate (is the bad run normal?), the run-length distribution as mirrored bars (wins up, losses down,
 * growing from the axis, staggered) and the dependence test P(win | after a win) vs. P(win | after a loss).
 */
import { motion } from "motion/react";
import { useMemo, useRef } from "react";
import { CARD_TITLES, explainStreaks, significanceOf, streakReport, STREAK_MIN_N, type StreakReport } from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import { cn } from "@/lib/cn";
import { n1, pct0 } from "@/lib/format";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { memoClosed } from "./hooks";
import { AnaCard, CountValue, SigBadge } from "./ui";

const BARS_H = 96;

function RunBars({ rep }: { rep: StreakReport }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const bars = rep.bars.slice(0, 16);
  const max = Math.max(1, ...bars.map((b) => Math.max(b.wins, b.losses)));
  const on = seen || reduced;
  return (
    <div className="grid gap-1">
      <div ref={ref} className="grid gap-[3px]" style={{ height: BARS_H, gridTemplateColumns: `repeat(${Math.max(bars.length, 4)}, minmax(0, 1fr))` }} role="img" aria-label={`Serienlängen: ${bars.map((b) => `${b.length}er: ${b.wins} Gewinn-, ${b.losses} Verlustserien`).join("; ")}`}>
        {bars.map((b, i) => (
          <div key={b.length} className="relative h-full">
            <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-line-2" />
            <motion.span
              aria-hidden="true"
              className="absolute inset-x-[12%] bottom-1/2 rounded-t-[3px] bg-win/75"
              style={{ height: `${(b.wins / max) * 48}%`, originY: 1 }}
              initial={reduced ? false : { scaleY: 0 }}
              animate={{ scaleY: on ? 1 : 0 }}
              transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.reveal }}
            />
            <motion.span
              aria-hidden="true"
              className="absolute inset-x-[12%] top-1/2 rounded-b-[3px] bg-loss/75"
              style={{ height: `${(b.losses / max) * 48}%`, originY: 0 }}
              initial={reduced ? false : { scaleY: 0 }}
              animate={{ scaleY: on ? 1 : 0 }}
              transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.reveal + stagger.lead }}
            />
          </div>
        ))}
      </div>
      <div className="grid text-center font-mono text-[9.5px] text-faint" style={{ gridTemplateColumns: `repeat(${Math.max(bars.length, 4)}, minmax(0, 1fr))` }} aria-hidden="true">
        {bars.map((b) => (
          <span key={b.length}>{b.length}</span>
        ))}
      </div>
    </div>
  );
}

function CondBar({ label, p, n, tone }: { label: string; p: number | null; n: number; tone: "win" | "loss" }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  return (
    <div ref={ref} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_3rem] items-center gap-2 text-[12px]">
      <span className="truncate text-mute">{label}</span>
      <span className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.span
          className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-full", tone === "win" ? "bg-win/70" : "bg-loss/60")}
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: seen || reduced ? (p ?? 0) : 0 }}
          transition={spring.enter}
        />
      </span>
      <span className="num text-right font-mono" title={`${n} Paare`}>
        {pct0(p)}
      </span>
    </div>
  );
}

export function StreaksCard({ view }: { view: AccountView }) {
  const rep = useMemo(() => memoClosed(view.closed, "streaks", () => streakReport(view.closed)), [view.closed]);
  const dep = rep.dependence;
  const depVerdict = significanceOf(dep?.p ?? null, null, Math.min(rep.afterWin, rep.afterLoss), 10);
  const over = rep.lossVsExpected === "laenger";
  return (
    <AnaCard title={CARD_TITLES.streaks} explain={() => explainStreaks(rep)} data-testid="ana-streaks">
      {rep.n < 3 ? (
        <EmptyState title="Noch keine Serien" text="Serien zeigen sich ab ein paar abgeschlossenen Trades." />
      ) : (
        <div className="grid gap-4">
          <span className="label -mb-2">Längste Serie</span>
          <div className="grid grid-cols-3 gap-2">
            <div className="grid gap-1 rounded-xl border border-win/20 bg-win/[0.05] px-3 py-2.5">
              <span className="label">Gewinne</span>
              <CountValue value={rep.longestWin} decimals={0} revealKey="ana-streak-win" className="dot-num text-[30px] leading-none text-win" />
            </div>
            <div className={cn("grid gap-1 rounded-xl border px-3 py-2.5", over ? "border-loss/40 bg-loss/[0.08]" : "border-loss/20 bg-loss/[0.04]")}>
              <span className="label">Verluste</span>
              <CountValue value={rep.longestLoss} decimals={0} revealKey="ana-streak-loss" className="dot-num text-[30px] leading-none text-loss" />
            </div>
            <div className="grid gap-1 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
              <span className="label">Erwartet</span>
              <span className="dot-num text-[30px] leading-none text-mute">{rep.n >= STREAK_MIN_N ? n1(rep.expectedLoss) : "–"}</span>
            </div>
          </div>
          <p className="text-[12.5px] leading-snug text-mute" data-testid="streak-verdict">
            {rep.lossVsExpected == null
              ? `Ab ${STREAK_MIN_N} Trades vergleicht das Journal deine Verlustserie mit dem Zufall.`
              : over
                ? `Deine längste Verlustserie (${rep.longestLoss}) ist länger als bei deiner Win-Rate zu erwarten (≈ ${n1(rep.expectedLoss)}). Prüfe, was du nach Verlusten anders machst.`
                : `Bei ${pct0(rep.winRate)} Win-Rate und ${rep.n} Trades sind ${Math.round(rep.expectedLoss)} Verluste in Folge normal – kein Grund, das System zu wechseln.`}
          </p>
          {rep.bars.length > 0 && <RunBars rep={rep} />}
          <div className="grid gap-2 rounded-xl border border-line bg-ink-950/50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="label">Nach Gewinn / Verlust</span>
              <SigBadge verdict={dep ? depVerdict : "wenig"} />
            </div>
            <CondBar label="Gewinn nach Gewinn" p={rep.pWinAfterWin} n={rep.afterWin} tone="win" />
            <CondBar label="Gewinn nach Verlust" p={rep.pWinAfterLoss} n={rep.afterLoss} tone="loss" />
            {rep.current.kind && (
              <p className="text-[11.5px] text-faint">
                Aktuell: {rep.current.length}× {rep.current.kind === "win" ? "Gewinn" : "Verlust"} in Folge
              </p>
            )}
          </div>
        </div>
      )}
    </AnaCard>
  );
}
