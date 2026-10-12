/**
 * Improvement plan (P04): the three strongest actions with evidence as a milestone rail (`MilestoneRail`: the rail
 * draws itself, the dots pop, the active step pings 3×). "Plan übernehmen" pins it (`settings.coach.plan`, synced like
 * every setting) and hands the goals to the growth module (`addGoalFromDraft`, P08: stored on the Wachstum page,
 * de-duplicated; the plan is measured in the reports' "Zielerreichung" either way). A pinned plan shows how this week is going
 * per step (measured from the journal, never ticked by hand).
 */
import { useMemo, useState } from "react";
import { addGoalFromDraft, type GoalDraft } from "@/domain/growth/goals";
import { coachPrefsOf, withCoachPlan, type BehaviorEvent, type Recommendation } from "@/domain/coach";
import { goalActual, periodOf } from "@/domain/reports";
import type { EnrichedTrade, Settings } from "@/domain/types";
import { tradeTime } from "@/lib/dates";
import { MilestoneRail, type Milestone } from "@/motion/pulse/MilestoneRail";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { VerdictBadge } from "./ui";

const RATE = new Set(["journalRate", "planAdherence", "checklistRate", "winRate"]);
const fmt = (metric: string, v: number | null): string => (v == null ? "–" : RATE.has(metric) ? `${Math.round(v * 100)} %` : `${Math.round(v * 100) / 100}`.replace(".", ","));

interface WeekStatus {
  actual: number | null;
  met: boolean | null;
}

/** This week's value of a goal (from the journal). */
export function weekStatus(g: GoalDraft, list: readonly EnrichedTrade[], events: readonly BehaviorEvent[], settings: Settings, now: number): WeekStatus {
  const p = periodOf("week", now);
  const inWeek = list.filter((t) => {
    const ms = +tradeTime(t);
    return ms >= p.from && ms < p.to;
  });
  const actual = goalActual(g.metric, g.scope, { closed: inWeek.filter((t) => t.result !== "open"), list: inWeek, events, settings });
  return { actual, met: actual == null ? null : g.comparator === "atLeast" ? actual >= g.target : actual <= g.target };
}

export function PlanCard({ plan, list, events, settings, now, className }: { plan: Recommendation[]; list: readonly EnrichedTrade[]; events: readonly BehaviorEvent[]; settings: Settings; now: number; className?: string }) {
  const saveSettings = useJournal((s) => s.saveSettings);
  const pinned = useMemo(() => coachPrefsOf(settings).plan, [settings]);
  const [busy, setBusy] = useState(false);

  const goals: GoalDraft[] = useMemo(() => (pinned ? pinned.goals : plan.map((r) => r.goal)), [pinned, plan]);
  const status = useMemo(() => goals.map((g) => weekStatus(g, list, events, settings, now)), [goals, list, events, settings, now]);
  const items: Milestone[] = goals.map((g, i) => {
    const rec = plan.find((r) => r.goal.title === g.title);
    const st = status[i]!;
    const week = pinned ? (st.met == null ? "diese Woche: noch keine Daten" : `diese Woche: ${fmt(g.metric, st.actual)} · ${st.met ? "gehalten" : "verfehlt"}`) : `Ziel ${g.comparator === "atLeast" ? "≥" : "≤"} ${fmt(g.metric, g.target)} pro ${g.period === "week" ? "Woche" : "Monat"}`;
    return { id: `${i}-${g.title}`, date: `Schritt ${i + 1} · ${week}`, title: g.title, text: g.why ?? rec?.why, tone: pinned ? (st.met === true ? "win" : st.met === false ? "loss" : "mute") : i === 0 ? "signal" : "fg" };
  });
  const firstOpen = pinned ? status.findIndex((s) => s.met !== true) : 0;
  const active = firstOpen < 0 ? items.length - 1 : firstOpen;

  const accept = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveSettings(withCoachPlan(settings, plan.map((r) => r.goal), Date.now()));
      const stored = await Promise.all(plan.map((r) => addGoalFromDraft(r.goal).catch(() => null)));
      const inGrowth = stored.filter(Boolean).length;
      pushToast({ kind: "success", title: "Plan gepinnt", detail: inGrowth ? `${inGrowth} ${inGrowth === 1 ? "Ziel" : "Ziele"} auch auf der Seite Wachstum.` : "Im Wochenbericht siehst du, wie du ihn hältst." });
    } catch {
      pushToast({ kind: "error", title: "Plan nicht gespeichert", detail: "Bitte noch einmal versuchen." });
    } finally {
      setBusy(false);
    }
  };
  const release = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await saveSettings(withCoachPlan(settings, null, Date.now()));
      pushToast({ kind: "info", title: "Plan gelöst", detail: "Der Coach schlägt dir einen neuen vor." });
    } catch {
      pushToast({ kind: "error", title: "Nicht gespeichert", detail: "Bitte noch einmal versuchen." });
    } finally {
      setBusy(false);
    }
  };

  const changed = pinned && plan.length > 0 && plan.map((r) => r.goal.title).join("|") !== pinned.goals.map((g) => g.title).join("|");
  return (
    <Card
      title={pinned ? "Dein Plan · gepinnt" : "Verbesserungsplan"}
      note={pinned ? `Seit ${new Date(pinned.acceptedAt).toLocaleDateString("de-DE", { day: "numeric", month: "long" })} · gemessen aus deinem Journal` : "Die drei stärksten Hebel – mit Belegen."}
      className={className}
      data-testid="coach-plan"
      data-pinned={pinned ? "1" : "0"}
    >
      {items.length === 0 ? (
        <EmptyState title="Noch kein Plan" text="Sobald der Coach Muster mit genug Belegen findet, schlägt er hier drei Schritte vor." line={false} />
      ) : (
        <div className="grid gap-4">
          {!pinned && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Konfidenz der Schritte">
              {plan.map((r, i) => (
                <li key={r.id} className="flex items-center gap-1.5 text-[11px] text-mute">
                  <span className="num font-mono text-faint">{i + 1}</span>
                  <VerdictBadge verdict={r.verdict} />
                </li>
              ))}
            </ul>
          )}
          <MilestoneRail key={items.map((m) => m.id).join("|") + active} items={items} active={active} label={pinned ? "Gepinnter Plan" : "Vorgeschlagener Plan"} />
          <div className="flex flex-wrap items-center gap-2">
            {!pinned && (
              <Button variant="primary" onClick={() => void accept()} disabled={busy} data-testid="coach-plan-accept">
                Plan übernehmen
              </Button>
            )}
            {changed && (
              <Button onClick={() => void accept()} disabled={busy} data-testid="coach-plan-update">
                Neuen Vorschlag übernehmen
              </Button>
            )}
            {pinned && (
              <Button variant="ghost" size="sm" onClick={() => void release()} disabled={busy} data-testid="coach-plan-release">
                Plan lösen
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
