/**
 * Karte „Tagesplan“ (F08): range / long / short / abwarten built from the key levels (`buildDayPlan`) – for each
 * scenario its trigger, its invalidation and one line „Was den Plan ändert“. The active scenario is marked (text and
 * border, not colour alone); a scenario that rests on a vorläufig level reads „vorläufig“, one that lost to the
 * precedence rule reads „überstimmt“. The switch decides whether a change of the plan is announced (toast island).
 */
import { memo } from "react";
import { keyLevelsOfSettings, planToastOn, PRECEDENCE_LABEL, type PlanScenario, type PlanState } from "@/domain/keylevels";
import { cn } from "@/lib/cn";
import { useKeyLevels } from "@/market/keylevels";
import { Switch } from "@/motion/Switch";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { PLAN as P } from "./strings";
import { savePlanToast } from "./writes";

const TONE: Record<PlanScenario["tone"], BadgeTone> = { win: "win", loss: "loss", mute: "mute", warn: "warn" };
const STATE_WORD: Record<PlanState, string | null> = { active: P.active, armed: P.armed, blocked: P.blocked, inactive: null };
const BORDER: Record<PlanScenario["tone"], string> = { win: "border-win/45", loss: "border-loss/45", mute: "border-white/30", warn: "border-warn/45" };

function Scenario({ s }: { s: PlanScenario }) {
  const word = STATE_WORD[s.state];
  const active = s.state === "active";
  return (
    <li
      className={cn("grid content-start gap-2 rounded-xl border bg-ink-950/40 p-3 transition-colors duration-200", active ? BORDER[s.tone] : "border-line", s.state === "blocked" && "opacity-70")}
      data-testid="plan-scenario"
      data-key={s.key}
      data-state={s.state}
      aria-current={active ? "true" : undefined}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", active ? "bg-fg" : "border border-line-2")} />
        <h3 className="text-[14px] font-semibold text-fg">{s.title}</h3>
        {word && (
          <Badge tone={active ? TONE[s.tone] : s.state === "armed" ? "warn" : "mute"} className="ml-auto">
            {word}
          </Badge>
        )}
      </div>
      <dl className="grid gap-1.5 text-[12px] leading-snug">
        <div className="grid gap-0.5">
          <dt className="text-[10.5px] uppercase tracking-[0.12em] text-faint">{P.trigger}</dt>
          <dd className="text-mute">{s.trigger}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-[10.5px] uppercase tracking-[0.12em] text-faint">{P.invalidation}</dt>
          <dd className="text-mute">{s.invalidation}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-[10.5px] uppercase tracking-[0.12em] text-faint">{P.changes}</dt>
          <dd className="text-fg">{s.changes}</dd>
        </div>
      </dl>
    </li>
  );
}

export const PlanCard = memo(function PlanCard() {
  const view = useKeyLevels();
  const cfg = useJournal((s) => s.settings.keyLevels);
  const toastOn = planToastOn(keyLevelsOfSettings({ keyLevels: cfg } as { keyLevels?: unknown }));
  const pushToast = useUi((s) => s.pushToast);
  const plan = view.plan;
  const onToast = async (on: boolean) => {
    if ((await savePlanToast(on)) !== "ok") pushToast({ kind: "error", title: "Speichern fehlgeschlagen" });
  };
  return (
    <Card title={P.title} note={P.note} data-testid="plan-card" data-active={plan.active}>
      <div className="grid gap-4">
        <div className="grid gap-1" aria-live="polite">
          <p className={cn("text-[15px] font-semibold", plan.tone === "win" ? "text-win" : plan.tone === "loss" ? "text-loss" : plan.tone === "warn" ? "text-warn" : "text-fg")} data-testid="plan-headline">
            {plan.headline}
          </p>
          <p className="text-[12.5px] leading-snug text-mute">{plan.detail}</p>
          <p className="text-[11px] text-faint">
            {P.precedenceIs} {PRECEDENCE_LABEL[view.precedence]}
            {plan.precedenceNote ? " – hat hier entschieden." : "."}
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Szenarien">
          {plan.scenarios.map((s) => (
            <Scenario key={s.key} s={s} />
          ))}
        </ul>
        <div className="flex items-start justify-between gap-4 rounded-xl border border-line bg-ink-950/40 px-3 py-2.5">
          <span className="grid min-w-0 gap-0.5">
            <label htmlFor="plan-toast" className="cursor-pointer text-[13px] text-fg">
              {P.toast}
            </label>
            <span id="plan-toast-help" className="text-[11px] text-faint">
              {P.toastHelp}
            </span>
          </span>
          <Switch id="plan-toast" checked={toastOn} onCheckedChange={(v) => void onToast(v)} aria-describedby="plan-toast-help" className="touch-hit mt-0.5 shrink-0" />
        </div>
      </div>
    </Card>
  );
});
