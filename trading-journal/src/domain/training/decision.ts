/**
 * The decision form of the training (F38) as pure rules: what must be filled in before the future may be shown, whether
 * the stop is placed sanely, and how the checklist and the decision fit together ("Regelbefolgung"). Deterministic – no
 * price after the decision candle enters here.
 */
import { num } from "../whatif/draft";
import type { Action, Recognition, RuleResult, TrainingDecision } from "./model";
import { TEXT_MAX } from "./model";

/** What the trader has entered so far (the stop as typed). */
export interface DecisionDraft {
  action: Action | null;
  recognition: Recognition | null;
  stop: string;
  reason: string;
  checks: Record<string, boolean>;
}

export const EMPTY_DECISION: Readonly<DecisionDraft> = Object.freeze({ action: null, recognition: null, stop: "", reason: "", checks: {} });

/** An item of the practised setup's checklist (the journal's `ChecklistEntry`). */
export interface RuleItem {
  id: string;
  text: string;
}

/** Closer than this to the price (in % of the price) is not a stop but noise – the same floor as the backtest engine. */
export const MIN_STOP_FRAC = 0.0005;

/** Stop of an entry against the last close: set, on the right side, not absurdly tight. `why` is the German gap. */
export function stopCheck(action: Action, stopText: string, lastClose: number): { ok: boolean; stop: number | null; why: string | null } {
  if (action === "wait") return { ok: true, stop: null, why: null };
  const stop = num(stopText);
  if (stop == null || !(stop > 0)) return { ok: false, stop: null, why: "Stopp-Kurs eintragen: ab wo ist die Idee falsch?" };
  const long = action === "long";
  if (long ? stop >= lastClose : stop <= lastClose) return { ok: false, stop, why: long ? "Ein Long-Stopp gehört unter den Kurs." : "Ein Short-Stopp gehört über den Kurs." };
  if (!(Math.abs(lastClose - stop) > lastClose * MIN_STOP_FRAC)) return { ok: false, stop, why: "Der Stopp liegt praktisch auf dem Kurs (unter 0,05 %)." };
  return { ok: true, stop, why: null };
}

/** Why the decision cannot be saved yet (German, one line per gap); empty = complete. */
export function decisionGaps(d: DecisionDraft, lastClose: number): string[] {
  const gaps: string[] = [];
  if (!d.recognition) gaps.push("Einordnen: Liegt dein Setup hier vor?");
  if (!d.action) gaps.push("Entscheiden: Long, Short oder Warten.");
  if (d.action && d.action !== "wait") {
    const s = stopCheck(d.action, d.stop, lastClose);
    if (s.why) gaps.push(s.why);
  }
  if (!d.reason.trim()) gaps.push("Begründung notieren – in einem Satz.");
  return gaps;
}

/** The checklist against the decision: how many rules are ticked, whether the stop is sane, whether an entry followed the rules. */
export function ruleResult(action: Action, stopText: string, lastClose: number, items: readonly RuleItem[], checks: Readonly<Record<string, boolean>>): RuleResult & { gaps: string[] } {
  const total = items.length;
  const open = items.filter((i) => !checks[i.id]);
  const checked = total - open.length;
  const gaps: string[] = [];
  if (action === "wait") {
    if (total > 0 && open.length === 0) gaps.push("Alle Regeln als erfüllt markiert und trotzdem gewartet – das ist kein Regelverstoß, aber prüf, was dich zurückgehalten hat.");
    return { checked, total, stopOk: null, followed: null, gaps };
  }
  const stop = stopCheck(action, stopText, lastClose);
  if (!stop.ok && stop.why) gaps.push(stop.why);
  for (const i of open) gaps.push(`Einstieg trotz offener Regel: ${i.text}`);
  if (total === 0) return { checked, total, stopOk: stop.ok, followed: null, gaps };
  return { checked, total, stopOk: stop.ok, followed: open.length === 0 && stop.ok, gaps };
}

/** The decision to store, or `null` while the draft has gaps. */
export function decisionOfDraft(d: DecisionDraft, lastClose: number, now: number): TrainingDecision | null {
  if (decisionGaps(d, lastClose).length || !d.action || !d.recognition) return null;
  const stop = d.action === "wait" ? null : stopCheck(d.action, d.stop, lastClose).stop;
  const checks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(d.checks)) if (v) checks[k] = true;
  return { action: d.action, recognition: d.recognition, stop, reason: d.reason.trim().slice(0, TEXT_MAX), checks, at: new Date(now).toISOString() };
}
