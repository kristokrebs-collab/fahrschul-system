import { themePaint } from "@/lib/themePaint";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { NumberCascade } from "@/motion/fx/NumberCascade";
import { SpotlightSweep } from "@/motion/fx/SpotlightSweep";
import { HoverPillFor, useHoverStore, type HoverStore } from "@/motion/HoverPill";
import { TextRoll } from "@/motion/TextRoll";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import type { LeaderboardRow } from "@/social/contract";
import { METRIC_HINT, METRIC_LABEL, metricText } from "@/social/format";
import { SOCIAL_METRICS, type SocialMetric } from "@/social/metrics";
import { setGroupBoard, setMetric, setOptIn, useBoard, useSocial } from "@/social/store";
import { BOARD } from "@/social/strings";
import { Monogram } from "@/social/ui/Monogram";

const dayLabel = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });

function Movement({ row }: { row: LeaderboardRow }) {
  if (row.prevRank == null) return <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint">{BOARD.newEntry}</span>;
  const d = row.prevRank - row.rank;
  if (d === 0) return <span aria-hidden="true" className="text-faint">·</span>;
  return (
    <span className={cn("num font-mono text-[11px]", d > 0 ? "text-win" : "text-loss")} title={d > 0 ? BOARD.up(d) : BOARD.down(-d)}>
      {d > 0 ? "▲" : "▼"}
      {Math.abs(d)}
    </span>
  );
}

function Value({ metric, value, className }: { metric: SocialMetric; value: number; className?: string }) {
  const isR = metric === "expectancy";
  return (
    <span className={cn("num font-mono", isR ? (value > 0 ? "text-win" : value < 0 ? "text-loss" : "text-fg") : "text-fg", className)}>
      <span className="sr-only">{metricText(metric, value)}</span>
      <span aria-hidden="true">
        <NumberCascade value={value} decimals={isR ? 2 : 0} signed={isR} suffix={isR ? "R" : " %"} />
      </span>
    </span>
  );
}

/** One of the top three: dot-matrix rank, monogram, value; #1 gets one beam lap. */
function Podium({ row, metric, place, pulse }: { row: LeaderboardRow; metric: SocialMetric; place: 1 | 2 | 3; pulse: number }) {
  const reduced = useReducedFx();
  return (
    <motion.li
      className={cn(
        "relative grid min-w-0 content-start justify-items-center gap-2 overflow-hidden rounded-2xl border px-2 pb-3 pt-3 text-center",
        place === 1 ? "border-line-2 bg-[radial-gradient(120%_80%_at_50%_0%,var(--color-ink-700)_0%,var(--color-ink-850)_70%)] sm:-mt-3 sm:pb-5" : "border-line bg-ink-950/50",
        row.me && "ring-1 ring-signal/50",
      )}
      initial={reduced ? false : { opacity: 0, y: 18, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1, transitionEnd: { transform: "none" } }}
      transition={{ default: { ...spring.pop, delay: (place === 1 ? 0 : place === 2 ? 1 : 2) * stagger.lead }, opacity: tween.fade }}
      data-testid={`podium-${place}`}
      data-me={row.me ? "" : undefined}
    >
      {place === 1 && <BorderBeam fire={pulse + 1} colorFrom={themePaint("#f2f2f2")} colorTo={themePaint("#e5202e")} />}
      {row.me && <SpotlightSweep play={pulse} />}
      <DotMatrixText text={String(row.rank)} tone={place === 1 ? "signal" : "fg"} size={place === 1 ? 4 : 3} gap={1} label={`Platz ${row.rank}`} />
      <Monogram pseudonym={row.pseudonym} size="sm" tone={row.me ? "signal" : "fg"} />
      <span className="line-clamp-2 min-h-[2.4em] text-[12px] font-medium leading-tight [overflow-wrap:anywhere]">{row.me ? `${BOARD.you} · ${row.pseudonym}` : row.pseudonym}</span>
      <Value metric={metric} value={row.value} className="text-[14px] sm:text-[15px]" />
      <span className="font-mono text-[10px] text-faint">{BOARD.trades(row.trades)}</span>
    </motion.li>
  );
}

function Row({ row, metric, index, hover, pulse }: { row: LeaderboardRow; metric: SocialMetric; index: number; hover: HoverStore<string>; pulse: number }) {
  const reduced = useReducedFx();
  const id = `${row.rank}-${row.pseudonym}`;
  return (
    <motion.li
      className={cn("relative overflow-hidden rounded-xl", row.me && "bg-white/[0.04]")}
      initial={reduced ? false : { opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0, transitionEnd: { transform: "none" } }}
      transition={{ default: { ...spring.enter, delay: 0.18 + Math.min(index, stagger.max) * stagger.rows }, opacity: { ...tween.fade, delay: 0.18 + Math.min(index, stagger.max) * stagger.rows } }}
      {...hover.bind(id)}
      tabIndex={-1}
      data-me={row.me ? "" : undefined}
      data-testid="board-row"
    >
      <HoverPillFor store={hover} id={id} group="community-board" className="inset-y-0.5" />
      {row.me && <SpotlightSweep play={pulse} />}
      <div className="relative z-10 grid grid-cols-[2.4rem_1.6rem_auto_minmax(0,1fr)_auto] items-center gap-2.5 px-2 py-2">
        <span className="num text-right font-mono text-[13px] text-mute">
          <TextRoll text={`#${row.rank}`} mode="roll" direction={row.prevRank != null && row.prevRank < row.rank ? "down" : "up"} />
        </span>
        <Movement row={row} />
        <Monogram pseudonym={row.pseudonym} size="sm" tone={row.me ? "signal" : "fg"} />
        <span className="grid min-w-0">
          <span className={cn("truncate text-[13px]", row.me ? "font-semibold text-fg" : "text-fg")}>{row.me ? `${BOARD.you} · ${row.pseudonym}` : row.pseudonym}</span>
          <span className="font-mono text-[10.5px] text-faint">{BOARD.trades(row.trades)}</span>
        </span>
        <Value metric={metric} value={row.value} className="text-[13.5px]" />
      </div>
    </motion.li>
  );
}

/**
 * Rangliste (P12) – pseudonyms, R and % only. "Trade the best": the top three stand on a podium (#1 with one beam lap),
 * the rest follows as compact rows (shared hover pill, ranks roll on change, ▲/▼ against the previous night). The own
 * row gets one red sweep; outside the top it is pinned below. Global = nightly snapshot of everybody who opted in;
 * Gruppe = live ranks of the members who share their figures.
 */
export function LeaderboardCard({ className }: { className?: string }) {
  const metric = useSocial((s) => s.metric);
  const groupBoard = useSocial((s) => s.groupBoard);
  const activeGroup = useSocial((s) => s.activeGroup);
  const me = useSocial((s) => s.me);
  const pulse = useSocial((s) => s.pulse);
  const busy = useSocial((s) => s.busy);
  const board = useBoard();
  const hover = useHoverStore<string>();
  const data = board.data;
  const rows = data?.rows ?? [];
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);
  const loading = board.load === "loading" && !data;
  const action = (
    <div className="flex flex-wrap items-center gap-2">
      {activeGroup && (
        <Segmented<string> size="sm" aria-label="Bereich" options={[{ v: "all", label: BOARD.everyone }, { v: "group", label: BOARD.group }]} value={groupBoard ? "group" : "all"} onChange={(v) => setGroupBoard(v === "group")} />
      )}
    </div>
  );
  return (
    <Card title={BOARD.title} action={action} className={cn("h-full", className)} data-testid="leaderboard-card">
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Segmented<SocialMetric> aria-label="Kennzahl" options={SOCIAL_METRICS.map((m) => ({ v: m, label: METRIC_LABEL[m] }))} value={metric} onChange={setMetric} className="w-full" />
          <span className="text-[11.5px] text-faint">{METRIC_HINT[metric]}</span>
        </div>

        {!groupBoard && me && !me.optIn && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-line-2 px-3.5 py-2.5" data-testid="board-join">
            <span className="text-[12.5px] text-mute">{BOARD.joinHint}</span>
            <Button size="sm" variant="primary" onClick={() => void setOptIn(true)} disabled={busy === "optIn"}>
              {BOARD.joinCta}
            </Button>
          </div>
        )}

        {loading ? (
          <div className="grid gap-2">
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-36 rounded-2xl" />
              ))}
            </div>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-11 rounded-xl" />
            ))}
          </div>
        ) : board.error && !data ? (
          <p className="text-[13px] text-loss">{board.error.message}</p>
        ) : !rows.length ? (
          <p className="rounded-xl border border-line bg-ink-950/40 px-4 py-6 text-center text-[13px] text-mute" data-testid="board-empty">
            {groupBoard ? BOARD.emptyGroup : BOARD.empty}
          </p>
        ) : (
          <>
            <ol className="grid grid-cols-3 items-end gap-2" aria-label="Top 3">
              {/* podium order: 2 · 1 · 3 */}
              {[top[1], top[0], top[2]].map((r, i) => (r ? <Podium key={`${metric}-${r.rank}-${r.pseudonym}`} row={r} metric={metric} place={r === top[0] ? 1 : r === top[1] ? 2 : 3} pulse={pulse} /> : <li key={`empty-${i}`} aria-hidden="true" />))}
            </ol>
            {rest.length > 0 && (
              <ol className="grid gap-0.5" aria-label={BOARD.title}>
                {rest.map((r, i) => (
                  <Row key={`${metric}-${r.rank}-${r.pseudonym}`} row={r} metric={metric} index={i} hover={hover} pulse={pulse} />
                ))}
              </ol>
            )}
            {data?.mine && (
              <div className="grid gap-1" data-testid="board-mine">
                <span className="px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{BOARD.outsideTop}</span>
                <ol>
                  <Row row={data.mine} metric={metric} index={0} hover={hover} pulse={pulse} />
                </ol>
              </div>
            )}
          </>
        )}
        {data?.day && (
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-faint">
            {BOARD.asOf(dayLabel(data.day))} · {BOARD.participants(data.total)}
          </span>
        )}
      </div>
    </Card>
  );
}
