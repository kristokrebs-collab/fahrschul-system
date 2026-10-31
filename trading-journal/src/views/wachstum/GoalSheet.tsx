/**
 * "Neues Ziel" (P08): process templates first (review every trade, plan followed, checklist, no rule break, no
 * revenge, daily check-in, plan before the market …), a trade count only as an upper limit ("Max. 3 Trades am Tag"),
 * or an own goal (title, measure, target, period, how often in a row). Saved through the Wave-0 path
 * `addGoalFromDraft` (sanitised, de-duplicated). Outcome measures (win rate, P&L) are deliberately not offered.
 */
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { BEHAVIOR_KEYS, BEHAVIOR_LABEL } from "@/domain/coach/events";
import { activeHabits, AUTO_HABITS, growthOf, HOLD_DEFAULT, RATE_METRICS, type GoalDraft, type GoalMetric, type GoalPeriod } from "@/domain/growth";
import { cn } from "@/lib/cn";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { addGoal } from "./actions";
import { useGrowthUi, useSheetOwner } from "./growthStore";
import { WACHSTUM } from "./strings";

const G = WACHSTUM.goals;

type Template = Omit<GoalDraft, "source" | "kind"> & { id: string; hint: string };

export const GOAL_TEMPLATES: readonly Template[] = [
  { id: "review", title: "Jeden Trade reviewen", metric: "journalRate", target: 0.9, comparator: "atLeast", period: "week", hint: "≥ 90 % der Trades mit Review" },
  { id: "plan", title: "Nach Plan traden", metric: "planAdherence", target: 0.9, comparator: "atLeast", period: "week", hint: "≥ 90 % „Plan befolgt“" },
  { id: "checklist", title: "Checkliste komplett", metric: "checklistRate", target: 0.9, comparator: "atLeast", period: "week", hint: "≥ 90 % vollständige Checklisten" },
  { id: "rules", title: "Kein Regelverstoß", metric: "ruleBreaks", target: 0, comparator: "atMost", period: "week", hint: "0 Verstöße pro Woche" },
  { id: "revenge", title: "Kein Revenge-Trade", metric: "behavior", target: 0, comparator: "atMost", period: "week", scope: { behavior: "revenge" }, hint: "0 Revenge-Muster pro Woche" },
  { id: "fomo", title: "Kein FOMO-Einstieg", metric: "behavior", target: 0, comparator: "atMost", period: "week", scope: { behavior: "fomo" }, hint: "0 FOMO-Muster pro Woche" },
  { id: "checkin", title: "Täglicher Check-in", metric: "habit", target: 0.7, comparator: "atLeast", period: "week", scope: { habit: "auto:checkin" }, hint: "an 5 von 7 Tagen" },
  { id: "premarket", title: "Plan vor dem Markt", metric: "habit", target: 0.7, comparator: "atLeast", period: "week", scope: { habit: "auto:plan" }, hint: "an 5 von 7 Tagen" },
  { id: "max3", title: "Max. 3 Trades am Tag", metric: "tradesPerDay", target: 3, comparator: "atMost", period: "week", hint: "Obergrenze – nie ein Minimum" },
  { id: "risk1", title: "Risiko pro Trade ≤ 1 %", metric: "riskPerTradePct", target: 0.01, comparator: "atMost", period: "week", hint: "Ø Risiko vom Startkapital" },
];

const METRIC_OPTIONS: readonly { value: GoalMetric; label: string }[] = [
  { value: "journalRate", label: "Trades mit Review (%)" },
  { value: "planAdherence", label: "Plan befolgt (%)" },
  { value: "checklistRate", label: "Checkliste komplett (%)" },
  { value: "ruleBreaks", label: "Regelverstöße (höchstens)" },
  { value: "behavior", label: "Verhaltensmuster (höchstens)" },
  { value: "tradesPerDay", label: "Trades pro Tag (höchstens)" },
  { value: "riskPerTradePct", label: "Ø Risiko pro Trade (% höchstens)" },
  { value: "lossDayPct", label: "Größter Tagesverlust (% höchstens)" },
  { value: "habit", label: "Gewohnheit (% der Tage)" },
  { value: "custom", label: "Selbst-Check" },
];
const PERIODS: readonly { v: GoalPeriod; label: string }[] = [
  { v: "day", label: "Tag" },
  { v: "week", label: "Woche" },
  { v: "month", label: "Monat" },
];
const PCT = (m: GoalMetric) => RATE_METRICS.has(m);

interface Form {
  title: string;
  metric: GoalMetric;
  target: string;
  period: GoalPeriod;
  hold: string;
  behavior: string;
  habit: string;
}
const EMPTY: Form = { title: "", metric: "journalRate", target: "90", period: "week", hold: String(HOLD_DEFAULT.week), behavior: "revenge", habit: "auto:checkin" };

function formOf(t: Template): Form {
  return { title: t.title, metric: t.metric, target: PCT(t.metric) ? String(Math.round(t.target * 1000) / 10).replace(".", ",") : String(t.target), period: t.period, hold: String(HOLD_DEFAULT[t.period]), behavior: t.scope?.behavior ?? "revenge", habit: t.scope?.habit ?? "auto:checkin" };
}

const num = (s: string) => Number(s.replace(",", ".").trim());

export function GoalSheet() {
  const owner = useSheetOwner("goal");
  const open = useGrowthUi((s) => s.goalOpen);
  const close = useGrowthUi((s) => s.closeGoal);
  const settings = useJournal((s) => s.settings);
  const habits = useMemo(() => [...AUTO_HABITS.map((h) => ({ value: h.id, label: h.title })), ...activeHabits(growthOf(settings)).filter((h) => !h.auto).map((h) => ({ value: h.id, label: h.title }))], [settings]);
  const [f, setF] = useState<Form>(EMPTY);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invalid, setInvalid] = useState<number | null>(null);
  const reduced = useReducedFx();

  // every opening starts from the first template (state adjusted during render, React's reset-on-prop pattern)
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setF(formOf(GOAL_TEMPLATES[0]!));
      setPicked(GOAL_TEMPLATES[0]!.id);
      setInvalid(null);
    }
  }

  const pick = (t: Template) => {
    setF(formOf(t));
    setPicked(t.id);
  };
  const upd = (patch: Partial<Form>) => {
    setPicked(null);
    setF((x) => ({ ...x, ...patch }));
  };

  const draft = (): GoalDraft | null => {
    const target = f.metric === "custom" ? 0 : num(f.target);
    const hold = Math.round(num(f.hold));
    if (!f.title.trim() || !Number.isFinite(target) || target < 0 || !Number.isFinite(hold) || hold < 1) return null;
    const comparator = f.metric === "journalRate" || f.metric === "planAdherence" || f.metric === "checklistRate" || f.metric === "habit" ? "atLeast" : "atMost";
    const d: GoalDraft & { hold?: number } = {
      title: f.title.trim(),
      kind: comparator === "atMost" ? "limit" : "process",
      metric: f.metric,
      target: PCT(f.metric) ? Math.min(1, target / 100) : target,
      comparator,
      period: f.period,
      source: { kind: "user" },
    };
    if (f.metric === "behavior") d.scope = { behavior: f.behavior };
    if (f.metric === "habit") d.scope = { habit: f.habit };
    if (hold !== HOLD_DEFAULT[f.period]) d.hold = hold;
    return d;
  };

  const save = async () => {
    const d = draft();
    if (!d) {
      setInvalid(Date.now());
      return;
    }
    setBusy(true);
    const g = await addGoal(d);
    setBusy(false);
    if (g) close();
  };

  if (!owner) return null;
  return (
    <Sheet
      open={open}
      onClose={close}
      title={G.sheet}
      dismissGuard={false}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="primary" onClick={() => void save()} disabled={busy} data-testid="goal-save">
            {G.save}
          </Button>
        </>
      }
    >
      <div className="grid gap-5" data-testid="goal-sheet">
        <StaggerItem as="section" className="grid gap-2" aria-label={G.templates}>
          <span className="label !text-[10px]">{G.templates}</span>
          <div className="grid gap-1.5 sm:grid-cols-2" data-testid="goal-templates">
            {GOAL_TEMPLATES.map((t, i) => (
              <motion.button
                key={t.id}
                type="button"
                aria-pressed={picked === t.id}
                onClick={() => pick(t)}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
                transition={{ ...spring.enter, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.rows }}
                whileTap={reduced ? undefined : { scale: 0.97 }}
                className={cn("grid min-h-11 gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors", picked === t.id ? "border-white/60 bg-white/[0.07]" : "border-line hover:border-white/30")}
              >
                <span className="text-[13px] font-medium">{t.title}</span>
                <span className="text-[11px] text-faint">{t.hint}</span>
              </motion.button>
            ))}
          </div>
        </StaggerItem>
        <StaggerItem as="section" className="grid gap-3.5" aria-label={G.custom}>
          <span className="label !text-[10px]">{picked ? "Anpassen" : G.custom}</span>
          <Field label={G.titleLabel} htmlFor="goal-title" invalidKey={invalid && !f.title.trim() ? invalid : null}>
            <Input id="goal-title" value={f.title} onChange={(e) => upd({ title: e.target.value })} maxLength={120} data-testid="goal-title" />
          </Field>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label="Messgröße" htmlFor="goal-metric">
              <MorphSelect<GoalMetric> id="goal-metric" value={f.metric} onChange={(metric) => upd({ metric, target: PCT(metric) ? "90" : metric === "tradesPerDay" ? "3" : "0" })} options={METRIC_OPTIONS} className="w-full" />
            </Field>
            {f.metric === "behavior" && (
              <Field label="Muster" htmlFor="goal-behavior">
                <MorphSelect id="goal-behavior" value={f.behavior} onChange={(behavior) => upd({ behavior })} options={BEHAVIOR_KEYS.map((k) => ({ value: k, label: BEHAVIOR_LABEL[k] }))} className="w-full" />
              </Field>
            )}
            {f.metric === "habit" && (
              <Field label="Gewohnheit" htmlFor="goal-habit">
                <MorphSelect id="goal-habit" value={f.habit} onChange={(habit) => upd({ habit })} options={habits} className="w-full" />
              </Field>
            )}
            {f.metric !== "custom" && (
              <Field label={G.target} htmlFor="goal-target" suffix={PCT(f.metric) || f.metric === "riskPerTradePct" || f.metric === "lossDayPct" ? "%" : undefined} invalidKey={invalid && !(num(f.target) >= 0) ? invalid : null} help={f.metric === "tradesPerDay" ? "Obergrenze – eine Mindestzahl an Trades gibt es hier nicht." : undefined}>
                <Input id="goal-target" inputMode="decimal" value={f.target} onChange={(e) => upd({ target: e.target.value })} data-testid="goal-target" />
              </Field>
            )}
          </div>
          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field label={G.period}>
              <Segmented<GoalPeriod> aria-label={G.period} options={PERIODS} value={f.period} onChange={(period) => upd({ period, hold: String(HOLD_DEFAULT[period]) })} />
            </Field>
            <Field label={G.hold} htmlFor="goal-hold" invalidKey={invalid && !(num(f.hold) >= 1) ? invalid : null}>
              <Input id="goal-hold" inputMode="numeric" value={f.hold} onChange={(e) => upd({ hold: e.target.value })} data-testid="goal-hold" />
            </Field>
          </div>
        </StaggerItem>
      </div>
    </Sheet>
  );
}
