/**
 * One rule for negative goal targets (P14 – the open issue between P08 goals and the P12 mentor contract): R-based
 * outcome metrics (`netR`, `expectancyR`) and own metrics may carry a NEGATIVE target ("Woche nicht schlechter als
 * −2 R"); every other metric is a count, rate or factor and is clamped at 0 by the goal store – and a mentor's proposal
 * with a negative target for such a metric is refused by the contract instead of silently becoming 0 on adoption.
 */
import { describe, expect, it } from "vitest";
import { sanitizeGoalDraft, SIGNED_METRICS, TARGET_ABS_MAX, type GoalDraft } from "@/domain/growth/goals";
import { goalProgress, prepare } from "@/domain/growth";
import { at, COACH_SETTINGS, ct, enrichC } from "./coach.fixtures";
import { GOAL_METRICS, GoalDraftSchema, SIGNED_GOAL_METRICS } from "@/social/contract";

const draft = (p: Partial<GoalDraft>): GoalDraft => ({ title: "Netto-R der Woche", kind: "outcome", metric: "netR", target: -2, comparator: "atLeast", period: "week", source: { kind: "mentor" }, ...p });
const mentor = (p: Record<string, unknown>) => ({ title: "Netto-R der Woche", kind: "outcome", metric: "netR", target: -2, comparator: "atLeast", period: "week", ...p });

describe("negative goal targets: one rule for P08 and P12", () => {
  it("both sides name the same signed metrics", () => {
    expect([...SIGNED_METRICS].sort()).toEqual([...SIGNED_GOAL_METRICS].sort());
    for (const m of SIGNED_GOAL_METRICS) expect(GOAL_METRICS).toContain(m);
  });

  it("the goal store keeps a negative target of an R metric and clamps every other one at 0", () => {
    expect(sanitizeGoalDraft(draft({}))!.target).toBe(-2);
    expect(sanitizeGoalDraft(draft({ metric: "expectancyR", target: -0.25 }))!.target).toBe(-0.25);
    expect(sanitizeGoalDraft(draft({ target: -5000 }))!.target).toBe(-TARGET_ABS_MAX);
    expect(sanitizeGoalDraft(draft({ metric: "ruleBreaks", kind: "limit", comparator: "atMost", target: -1 }))!.target).toBe(0);
    expect(sanitizeGoalDraft(draft({ metric: "journalRate", kind: "process", target: -0.5 }))!.target).toBe(0);
  });

  it("the mentor contract accepts what the store keeps and refuses what it would change", () => {
    expect(GoalDraftSchema.safeParse(mentor({})).success).toBe(true);
    expect(GoalDraftSchema.safeParse(mentor({ metric: "expectancyR", target: -0.3 })).success).toBe(true);
    expect(GoalDraftSchema.safeParse(mentor({ metric: "ruleBreaks", kind: "limit", comparator: "atMost", target: -1 })).success).toBe(false);
    expect(GoalDraftSchema.safeParse(mentor({ metric: "winRate", target: -0.1 })).success).toBe(false);
    expect(GoalDraftSchema.safeParse(mentor({ metric: "winRate", target: 0.55 })).success).toBe(true);
    // whatever the contract accepts survives the store unchanged
    for (const metric of GOAL_METRICS) {
      const raw = mentor({ metric, kind: metric === "ruleBreaks" || metric === "tradesPerDay" ? "limit" : "outcome", target: (SIGNED_GOAL_METRICS as readonly string[]).includes(metric) ? -1.5 : 0.5 });
      if (!GoalDraftSchema.safeParse(raw).success) continue;
      const kept = sanitizeGoalDraft({ ...raw, source: { kind: "mentor" } });
      expect(kept?.target, metric).toBe(raw.target);
    }
  });

  it("a floor below zero is met while the week stays above it, and breaks below it", () => {
    // Monday 2026-03-02 + days; NOW = Wednesday of the 6th week
    const NOW = new Date(2026, 2, 2 + 37, 12, 0).getTime();
    const goal = { ...sanitizeGoalDraft(draft({}))!, id: "g1", createdAt: new Date(2026, 2, 2, 8, 0).toISOString(), status: "active" as const };
    // this week: −1 R (above the −2 R floor) …
    const held = prepare({ list: enrichC([ct(at(35), { id: "a", p: -100, r: -1 })]), events: [], days: {}, settings: COACH_SETTINGS, now: NOW });
    const ok = goalProgress(goal, held);
    expect(ok.targetText).toMatch(/^≥ /);
    expect(ok.state).toBe("met");
    expect(ok.ratio).toBe(1);
    // … −3 R breaks it
    const broke = prepare({ list: enrichC([ct(at(35), { id: "a", p: -100, r: -1 }), ct(at(36), { id: "b", p: -200, r: -2 })]), events: [], days: {}, settings: COACH_SETTINGS, now: NOW });
    const bad = goalProgress(goal, broke);
    expect(bad.state).not.toBe("met");
    expect(bad.ratio).toBe(0);
  });
});
