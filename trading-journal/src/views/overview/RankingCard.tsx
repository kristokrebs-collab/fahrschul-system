import { animate, AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { explainSetup } from "@/domain/explain";
import { DEFAULT_RANK_KEY, RANK_KEYS, RANKING_EMPTY_TEXT, rankSetupStats, splitRanked, type RankKey } from "@/domain/rank";
import { cn } from "@/lib/cn";
import { colorClass, pct0, signed } from "@/lib/format";
import { HoverPillFor, useHoverStore, type HoverStore } from "@/motion/HoverPill";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { StaggerItem, useMorphDialog } from "@/motion/MorphDialog";
import { TextRoll } from "@/motion/TextRoll";
import { spring, stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Segmented } from "@/primitives/Segmented";
import { useAccountView, useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { Bar } from "./Bar";
import { ExplanationView } from "./explainer";

export const RANKING_TITLE = "Entscheidungsgrundlagen";
export const RANKING_TRADES_BUTTON = "Alle Trades mit dieser Grundlage →";
const HEAD = ["Grundlage", "Trades", "Win-Rate", "P&L", "Ø R"] as const;
/**
 * Phones: the name takes its own line and the figures sit in a row under it (a 34 px name column cut every name,
 * MO-01); from `sm` the five-column grid. Names wrap instead of ellipsizing; figures never wrap.
 */
const GRID = "grid-cols-[52px_minmax(90px,1.2fr)_minmax(0,0.9fr)] sm:grid-cols-[minmax(0,1.6fr)_52px_minmax(90px,1.2fr)_minmax(0,0.9fr)_56px]";

/** Pure: slot-roll direction of a rank change – a row that climbs counts down (`01` arrives from above). */
export function rankRollDirection(prev: number, next: number): "up" | "down" {
  return next < prev ? "down" : "up";
}

/**
 * Remembers the previous rank across renders (the React "adjust state while rendering" pattern, no effect) so the
 * number can roll in the direction the row travelled.
 */
function useRankMove(rank: number): { direction: "up" | "down"; moves: number } {
  const [s, setS] = useState({ rank, direction: "up" as "up" | "down", moves: 0 });
  if (s.rank !== rank) setS({ rank, direction: rankRollDirection(s.rank, rank), moves: s.moves + 1 });
  return s;
}

interface RankRowProps {
  rank: number;
  dep: string;
  /** the list's hover store: the row binds its id, its pill follows it (a hover never re-renders the list) */
  hover: HoverStore<string>;
  id: string;
  /** sort switch: `out` = rows fade in place, `in` = new order placed instantly and fading in by rank */
  phase: SortPhase;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

type SortPhase = "rest" | "out" | "in";

/** Sort switch timing: rows fade out in place (`tween.exit`), jump to their new slots unseen, then fade in by rank. */
const SORT_OUT_MS = tween.exit.duration * 1000;
const sortInDelay = (rank: number) => Math.min(rank - 1, stagger.max) * stagger.reveal;
const SORT_IN_MS = (stagger.max * stagger.reveal + tween.fade.duration) * 1000;

/**
 * One ranking row: `layout` reorder (`spring.layout`), enter/exit fade, and a soft white wash (`tween.flash`,
 * opacity only) whenever its rank changes – the eye can follow which rows moved. No flash on mount / reduced motion.
 */
function RankRow({ rank, dep, hover, id, phase, children, ref }: RankRowProps) {
  const reduced = useReducedFx();
  const wash = useRef<HTMLSpanElement>(null);
  const { moves } = useRankMove(rank);
  useEffect(() => {
    if (moves === 0 || reduced || !wash.current) return;
    const controls = animate(wash.current, { opacity: [1, 0] }, tween.flash);
    return () => controls.stop();
  }, [moves, reduced]);
  return (
    <motion.div
      ref={ref}
      layout
      layoutDependency={dep}
      // a re-sort permutes every row: FLIPping them through each other piled names and numbers into one slot (OV-08),
      // so the new order is placed while the rows are invisible; data / account changes keep the layout spring
      transition={{ layout: phase === "in" ? { duration: 0 } : spring.layout }}
      initial={{ opacity: 0, y: 6 }}
      animate={
        phase === "out"
          ? { opacity: 0, y: 0, transition: tween.exit }
          : { opacity: 1, y: 0, transition: phase === "in" ? { ...tween.fade, delay: sortInDelay(rank) } : undefined }
      }
      exit={{ opacity: 0, transition: tween.exit }}
      className="relative border-t border-line"
      {...hover.bind(id)}
    >
      <span ref={wash} aria-hidden="true" className="pointer-events-none absolute inset-x-0 inset-y-0.5 rounded-xl bg-white/[0.05] opacity-0" />
      <HoverPillFor store={hover} id={id} group="rank" className="inset-y-0.5" />
      {children}
    </motion.div>
  );
}

/** `01`, `02` … rolling (slot) in the direction the row moved. The accessible text is always the current rank. */
function RankNumber({ rank }: { rank: number }) {
  const { direction } = useRankMove(rank);
  return <TextRoll text={String(rank).padStart(2, "0")} mode="roll" direction={direction} className="num w-4 shrink-0 font-mono text-[11px] text-faint transition-colors group-hover:text-fg" />;
}

/**
 * `Entscheidungsgrundlagen` ranking (Bundle `Phe`, Plan 6.1): sort Segmented, ranking grid rows (`layout`,
 * `layoutDependency={sortKey+acc}`, `AnimatePresence popLayout`), hover pill `rank`, MorphCard
 * `setup-rank-{id}` (press feedback) → `explainSetup` + `Alle Trades mit dieser Grundlage →`, unused setups as chips.
 * On a re-sort the rows fade out in place, take their new slots unseen and fade back in by rank (no rows sliding
 * through each other); the rank numbers slot-roll and the rows that moved flash once; win-rate bars fill on first view.
 */
export function RankingCard() {
  const settings = useJournal((s) => s.settings);
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const reduced = useReducedFx();
  const [key, setKey] = useState<RankKey>(DEFAULT_RANK_KEY);
  // the order on screen follows the Segmented after the rows faded out (`shown`); `entering` while they fade back in
  const [shown, setShown] = useState<RankKey>(key);
  const [entering, setEntering] = useState(false);
  const { close } = useMorphDialog();
  const hover = useHoverStore<string>();
  const sortTo = (k: RankKey) => {
    setKey(k);
    if (reduced) setShown(k);
  };
  useEffect(() => {
    if (key === shown) return;
    const id = setTimeout(() => {
      setShown(key);
      setEntering(true);
    }, SORT_OUT_MS);
    return () => clearTimeout(id);
  }, [key, shown]);
  useEffect(() => {
    if (!entering) return;
    const id = setTimeout(() => setEntering(false), SORT_IN_MS);
    return () => clearTimeout(id);
  }, [entering]);
  const phase: SortPhase = key !== shown ? "out" : entering ? "in" : "rest";

  const { used, unused } = useMemo(() => splitRanked(rankSetupStats(view.setups, shown)), [view.setups, shown]);
  const dep = `${shown}:${acc}:${used.map((c) => c.id).join(",")}`;

  const goTrades = (id: string) => {
    close();
    navigate("trades", { setup: id });
  };

  return (
    <Card title={RANKING_TITLE} action={<Segmented<RankKey> size="sm" aria-label="Sortierung" options={RANK_KEYS} value={key} onChange={sortTo} />}>
      {used.length === 0 && <p className="mb-3 text-[13px] text-mute">{RANKING_EMPTY_TEXT}</p>}
      {used.length > 0 && (
        <div className="relative grid">
          <div className={cn("label grid gap-3 px-2 pb-2 !text-faint", GRID)}>
            <span className="max-sm:sr-only">{HEAD[0]}</span>
            <span>{HEAD[1]}</span>
            <span>{HEAD[2]}</span>
            <span className="text-right">{HEAD[3]}</span>
            <span className="hidden text-right sm:block">{HEAD[4]}</span>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            {used.map((c, i) => (
              <RankRow key={c.id} rank={i + 1} dep={dep} hover={hover} id={c.id} phase={phase}>
                <MorphCard
                  id={`setup-rank-${c.id}`}
                  title={c.setup.name}
                  body={() => (
                    <>
                      <ExplanationView bare d={explainSetup(c, view.list, settings.currency)} />
                      <StaggerItem>
                        <Button size="sm" className="mt-3" onClick={() => goTrades(c.id)}>
                          {RANKING_TRADES_BUTTON}
                        </Button>
                      </StaggerItem>
                    </>
                  )}
                  className={cn("relative z-10 grid w-full items-center gap-x-3 gap-y-1.5 px-2 py-2.5", GRID)}
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-[13px] font-medium max-sm:col-span-full">
                    <RankNumber rank={i + 1} />
                    <motion.span layoutId={`morph-dot-${c.id}`} className="size-2 shrink-0 rounded-full" style={{ background: c.setup.color, borderRadius: 9999 }} aria-hidden="true" />
                    <MorphTitle id={`setup-rank-${c.id}`} as="span" className="min-w-0 hyphens-auto break-words">
                      {c.setup.name}
                    </MorphTitle>
                  </span>
                  <span className="num font-mono text-[13px] text-mute">{c.n}</span>
                  <span className="grid gap-1">
                    <span className="flex justify-between text-xs">
                      <b className="num font-mono font-medium">{pct0(c.winRate)}</b>
                      <span className="num font-mono text-faint">
                        {c.wins}/{c.losses}
                      </span>
                    </span>
                    <Bar value={c.winRate ?? 0} index={i} track="bg-loss/25" />
                  </span>
                  <span className={cn("num whitespace-nowrap text-right font-mono text-[13px] font-medium", colorClass(c.net))}>{signed(c.net, 0)}</span>
                  <span className={cn("num hidden text-right font-mono text-[13px] sm:block", colorClass(c.avgR))}>{c.avgR == null ? "–" : signed(c.avgR)}</span>
                </MorphCard>
              </RankRow>
            ))}
          </AnimatePresence>
        </div>
      )}
      {unused.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {unused.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-faint">
              <span className="size-1.5 rounded-full" style={{ background: c.setup.color }} aria-hidden="true" />
              {c.setup.name}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
