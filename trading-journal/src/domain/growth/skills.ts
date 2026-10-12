/**
 * Skill levels (P08) – six process axes, each 0–100 from the journal, never from P&L:
 *
 *   discipline  Ø discipline score of the last 30 days (`disciplineAvg`, ≥ 3 scored days)
 *   risk        risk per trade steady and within the limit – the coach's "Risiko-Konstanz" formula over the last
 *               30 closed trades (`riskSpread` of P05: 100 · consistency · (1 − over / n), ≥ 5 trades)
 *   journal     share of the last 30 trades with a review (`journalRate`, ≥ 3 trades)
 *   patience    trading days of the last 30 days within the trade limit and without overtrading / impulsive /
 *               boredom patterns (≥ 3 days)
 *   emotions    share of the last 30 closed trades that triggered no revenge / tilt / FOMO / overconfidence (≥ 5)
 *   planning    Ø of: plan followed, checklist complete (last 30 trades) and trading days with a plan or check-in
 *
 * Level 1–5 (Einstieg · Aufbau · Solide · Stark · Meister) from the value; 0 = not enough data. Pure.
 */
import type { BehaviorKey } from "../coach/events";
import { triggerOf } from "../coach/behaviors";
import { journalRate } from "../coach/recommendations";
import { disciplineAvg } from "../insights/discipline";
import { accountOf } from "../insights/shared";
import { riskSpread } from "../risk/perStrategy";
import { hasCheckin } from "../psych/checkin";
import type { Prepared } from "./context";
import { addDays } from "./habits";

export type SkillKey = "discipline" | "risk" | "journal" | "patience" | "emotions" | "planning";
export type SkillLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface SkillAxis {
  key: SkillKey;
  label: string;
  value: number | null;
  level: SkillLevel;
  /** sample behind the value ("12 Handelstage", "30 Trades") */
  sample: string;
  hint: string;
}

export interface SkillProfile {
  axes: SkillAxis[];
  /** Ø of the axes with data */
  value: number | null;
  level: SkillLevel;
  /** the axis with the most room (lowest value) */
  weakest: SkillAxis | null;
  strongest: SkillAxis | null;
}

export const SKILL_WINDOW_DAYS = 30;
export const SKILL_WINDOW_TRADES = 30;
export const LEVEL_NAMES: readonly string[] = ["Zu wenig Daten", "Einstieg", "Aufbau", "Solide", "Stark", "Meister"];
export const SKILL_LABEL: Readonly<Record<SkillKey, string>> = { discipline: "Disziplin", risk: "Risiko", journal: "Journaling", patience: "Geduld", emotions: "Emotionen", planning: "Planung" };
const HINT: Readonly<Record<SkillKey, string>> = {
  discipline: "Ø Disziplin-Score der letzten 30 Tage",
  risk: "Risiko pro Trade gleichmäßig und im Limit",
  journal: "Trades mit Review",
  patience: "Handelstage im Limit, ohne Impuls-Trades",
  emotions: "Trades ohne Revenge, Tilt, FOMO, Übermut",
  planning: "Plan befolgt, Checkliste, Plan vor dem Markt",
};

export function levelOf(v: number | null): SkillLevel {
  if (v == null) return 0;
  if (v >= 80) return 5;
  if (v >= 60) return 4;
  if (v >= 40) return 3;
  if (v >= 20) return 2;
  return 1;
}

const HOT: ReadonlySet<BehaviorKey> = new Set(["revenge", "tilt", "fomo", "overconfidence"]);
const RESTLESS: ReadonlySet<BehaviorKey> = new Set(["overtrading", "impulsive", "boredom"]);
const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function skillProfile(p: Prepared): SkillProfile {
  const fromKey = addDays(p.todayKey, -(SKILL_WINDOW_DAYS - 1));
  const recentAll = p.sorted.slice(-SKILL_WINDOW_TRADES);
  const recentClosed = p.closed.slice(-SKILL_WINDOW_TRADES);
  const days = p.tradeDays.filter((k) => k >= fromKey && k <= p.todayKey);
  const axes: SkillAxis[] = [];
  const add = (key: SkillKey, value: number | null, sample: string) => {
    const v = value == null ? null : Math.round(Math.max(0, Math.min(100, value)));
    axes.push({ key, label: SKILL_LABEL[key], value: v, level: levelOf(v), sample, hint: HINT[key] });
  };

  const scored = p.discDays.filter((d) => d.key >= fromKey && d.key <= p.todayKey && d.score != null).length;
  add("discipline", scored >= 3 ? disciplineAvg(p.discDays, fromKey, p.todayKey) : null, `${scored} Handelstage`);

  const spread = riskSpread(recentClosed, p.settings, "setup", p.limits.maxLossTradePct).overall;
  add("risk", spread && spread.n >= 5 ? 100 * spread.consistency * (1 - spread.over / spread.n) : null, `${spread?.n ?? 0} Trades mit Stop`);

  add("journal", recentAll.length >= 3 ? journalRate(recentAll) * 100 : null, `${recentAll.length} Trades`);

  const calm = days.filter((k) => {
    if ((p.eventsByDay.get(k) ?? []).some((e) => RESTLESS.has(e.key))) return false;
    const count: Record<string, number> = {};
    for (const t of p.byDay.get(k) ?? []) count[accountOf(t)] = (count[accountOf(t)] ?? 0) + 1;
    return Object.entries(count).every(([a, n]) => n <= p.limits.maxTrades[a as "makro" | "scalp"]);
  }).length;
  add("patience", days.length >= 3 ? (calm / days.length) * 100 : null, `${days.length} Handelstage`);

  const hot = new Set(p.events.filter((e) => HOT.has(e.key)).map(triggerOf));
  add("emotions", recentClosed.length >= 5 ? (recentClosed.filter((t) => !hot.has(t.id)).length / recentClosed.length) * 100 : null, `${recentClosed.length} Trades`);

  const planned = recentAll.filter((t) => t.followedPlan != null);
  const lists = recentAll.filter((t) => t.complete != null);
  const prepared = days.filter((k) => hasCheckin(p.days[k]) || (p.days[k]?.plan ?? "").trim() !== "").length;
  const parts = [planned.length >= 3 ? planned.filter((t) => t.followedPlan).length / planned.length : null, lists.length >= 3 ? lists.filter((t) => t.complete).length / lists.length : null, days.length >= 3 ? prepared / days.length : null].filter((x): x is number => x != null);
  add("planning", recentAll.length >= 5 && parts.length ? (mean(parts) ?? 0) * 100 : null, `${recentAll.length} Trades`);

  const avail = axes.filter((a) => a.value != null);
  const value = avail.length >= 3 ? Math.round(mean(avail.map((a) => a.value!))!) : null;
  const sorted = [...avail].sort((a, b) => a.value! - b.value!);
  return { axes, value, level: levelOf(value), weakest: sorted[0] ?? null, strongest: sorted[sorted.length - 1] ?? null };
}
