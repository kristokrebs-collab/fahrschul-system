/**
 * Goals (P08). Each goal is a card: a `RingGauge` with `passColor` (the arc turns win-green and flashes a halo the
 * moment it reaches the target; a limit fills with its period while it holds, red once broken), the hold milestones as
 * a `MilestoneRail` that lights up period by period, the last periods as dots, the "why" from the coach. A goal the
 * journal cannot measure (`custom`) is a self-check per period. "Trade the best": the three most urgent goals are shown,
 * the rest folds away. Reaching a goal is celebrated by the page (`useGrowthTransitions`: record burst + "Ziel
 * erreicht" wipe) – never an outcome goal.
 */
import { themePaint } from "@/lib/themePaint";
import { motion } from "motion/react";
import { useState } from "react";
import { BEHAVIOR_LABEL, type BehaviorKey } from "@/domain/coach/events";
import { periodUnit, type GoalProgress } from "@/domain/growth";
import { cn } from "@/lib/cn";
import { MilestoneRail, type Milestone } from "@/motion/pulse/MilestoneRail";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse } from "@/primitives/Expander";
import { RingGauge } from "@/primitives/RingGauge";
import { patchGoal } from "./actions";
import { useGrowthUi } from "./growthStore";
import { WACHSTUM } from "./strings";
import { pushToast } from "@/store/uiStore";

const G = WACHSTUM.goals;
const WIN = themePaint("#3ddc84");
const LOSS = themePaint("#ff4d4f");
const STATE_TEXT: Record<GoalProgress["state"], string> = { met: "erfüllt", onTrack: "auf Kurs", atRisk: "gefährdet", missed: "verfehlt", noData: "keine Daten" };
const STATE_TONE: Record<GoalProgress["state"], string> = { met: "border-win/50 text-win", onTrack: "border-white/25 text-fg", atRisk: "border-warn/50 text-warn", missed: "border-loss/50 text-loss", noData: "border-line-2 text-faint" };
const SOURCE: Record<string, string> = { coach: "Coach", mentor: "Mentor", onboarding: "Start", user: "Eigenes" };
const PERIOD_NOW: Record<string, string> = { day: "Heute", week: "Diese Woche", month: "Dieser Monat", quarter: "Dieses Quartal", year: "Dieses Jahr" };

export function GoalCard({ g, index = 0 }: { g: GoalProgress; index?: number }) {
  const reduced = useReducedFx();
  const [confirm, setConfirm] = useState(false);
  const goal = g.goal;
  const limit = goal.comparator === "atMost" && goal.metric !== "custom";
  const reachedCount = g.milestones.filter((m) => m.reached).length;
  const rail: Milestone[] = g.milestones.map((m) => ({ id: `${goal.id}-${m.n}`, title: m.label, date: m.reached ? G.held : G.open, tone: m.reached ? "win" : "mute" }));
  const active = Math.min(reachedCount, rail.length - 1);
  const behavior = goal.scope?.behavior ? BEHAVIOR_LABEL[goal.scope.behavior as BehaviorKey] : null;

  const logSelf = async (held: boolean) => {
    const ok = await patchGoal(goal.id, { log: { ...(goal.log ?? {}), [g.period.key]: held } });
    if (ok) pushToast({ kind: "success", title: held ? G.selfYes : G.selfNo, detail: goal.title });
  };
  const drop = async () => {
    const ok = await patchGoal(goal.id, { status: "dropped" });
    if (ok) pushToast({ kind: "info", title: G.dropped, detail: goal.title });
  };

  return (
    <motion.article
      className="relative grid min-w-0 content-start gap-3 rounded-2xl border border-line bg-ink-950/40 p-4"
      data-testid="goal-card"
      data-goal={goal.id}
      data-state={g.state}
      data-streak={g.streak}
      initial={reduced ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={{ ...spring.enter, delay: reduced ? 0 : index * stagger.cards * 2 }}
    >
      <div className="flex items-start gap-3.5">
        <RingGauge value={limit && g.state === "missed" ? 1 : g.ratio} marker={limit ? null : 1} passColor={limit ? undefined : WIN} color={g.state === "missed" ? LOSS : themePaint("#f2f2f2")} size={86} stroke={9} aria-label={`${goal.title}: ${g.valueText} von ${g.targetText}`}>
          <span className="grid justify-items-center leading-none">
            <span className="num font-mono text-[13px] font-semibold">{g.valueText}</span>
            <span className="num mt-1 font-mono text-[9.5px] text-faint">{g.targetText}</span>
          </span>
        </RingGauge>
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full border px-2 py-px text-[10px] font-semibold uppercase tracking-wider", STATE_TONE[g.state])}>{STATE_TEXT[g.state]}</span>
            <span className="text-[10.5px] text-faint">{SOURCE[goal.source.kind] ?? ""}</span>
          </div>
          <h3 className="text-[14px] font-semibold leading-snug [overflow-wrap:anywhere]">{goal.title}</h3>
          <p className="text-[11.5px] text-mute">
            {PERIOD_NOW[goal.period]} · {g.streak}/{g.hold} {periodUnit(goal.period, g.hold)} in Folge
            {behavior ? ` · ${behavior}` : ""}
          </p>
          {!g.celebrate && <p className="text-[10.5px] text-faint">{G.outcome}</p>}
        </div>
      </div>
      {goal.why && <p className="line-clamp-2 text-[11.5px] leading-relaxed text-faint">{goal.why}</p>}
      <MilestoneRail items={rail} orientation="horizontal" active={reachedCount === 0 ? -1 : active} label={`Meilensteine: ${goal.title}`} className="-mx-1 [&>li]:!w-0 [&>li]:min-w-0 [&>li]:grow [&>li]:!pr-2" />
      {g.history.length > 0 && (
        <div className="flex items-center gap-1" aria-label="Letzte Perioden" role="img">
          {g.history.slice(-8).map((h) => (
            <span key={h.key} title={`${h.short}: ${h.met == null ? "keine Daten" : h.met ? "gehalten" : "verfehlt"}`} className={cn("h-1.5 flex-1 rounded-full", h.met == null ? "bg-white/10" : h.met ? "bg-win/80" : "bg-loss/80")} />
          ))}
        </div>
      )}
      {!g.measurable && (
        <div className="flex flex-wrap items-center gap-2" data-testid="goal-self-check">
          <span className="text-[11.5px] text-mute">{G.selfCheck}:</span>
          <Button size="sm" onClick={() => void logSelf(true)}>
            {G.selfYes}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void logSelf(false)}>
            {G.selfNo}
          </Button>
        </div>
      )}
      <div className="flex justify-end">
        {confirm ? (
          <span className="flex items-center gap-2 text-[11.5px]">
            Wirklich entfernen?
            <Button size="sm" variant="danger" onClick={() => void drop()} data-testid="goal-drop-yes">
              Ja
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirm(false)}>
              Nein
            </Button>
          </span>
        ) : (
          <button type="button" className="min-h-9 rounded-lg px-2 text-[11px] text-faint transition-colors hover:text-fg pointer-coarse:min-h-11" onClick={() => setConfirm(true)} data-testid="goal-drop">
            {G.drop}
          </button>
        )}
      </div>
    </motion.article>
  );
}

const TOP = 3;

export function GoalsCard({ goals, week, className }: { goals: readonly GoalProgress[]; week: { total: number; met: number; daysLeft: number }; className?: string }) {
  const openGoal = useGrowthUi((s) => s.openGoal);
  const [more, setMore] = useState(false);
  const top = goals.slice(0, TOP);
  const rest = goals.slice(TOP);
  return (
    <Card
      title="Aktive Ziele"
      note={week.total ? G.week(week.met, week.total, week.daysLeft) : "Was du diese Woche erreichen willst."}
      action={
        <Button size="sm" variant="primary" onClick={openGoal} data-testid="goal-add">
          {G.add}
        </Button>
      }
      className={className}
      data-testid="growth-goals"
      data-n={goals.length}
    >
      {goals.length === 0 ? (
        <EmptyState title="Noch kein Ziel" text={G.empty} line={false} />
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {top.map((g, i) => (
              <GoalCard key={g.goal.id} g={g} index={i} />
            ))}
          </div>
          {rest.length > 0 && (
            <>
              <Collapse open={more}>
                <div className="grid gap-3 pt-1 md:grid-cols-2 xl:grid-cols-3">
                  {rest.map((g, i) => (
                    <GoalCard key={g.goal.id} g={g} index={i} />
                  ))}
                </div>
              </Collapse>
              <Button variant="secondary" size="sm" onClick={() => setMore((m) => !m)} aria-expanded={more} data-testid="goal-more">
                {more ? G.less : G.more(rest.length)}
              </Button>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
