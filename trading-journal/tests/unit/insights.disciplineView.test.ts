import { describe, expect, it } from "vitest";
import { heatMap, type DisciplineDay, type RuleKey, type RuleRate } from "@/domain/insights";
import { brokenLine, dayMarks, HEAT, heatWeeks, lastTradingDays, monthLabels, scoreTone, scoreTrend, weakestRule } from "@/views/insights/disciplineView";

const day = (key: string, score: number | null, rules: { key: RuleKey; ok: boolean | null }[] = []): DisciplineDay => ({
  key,
  date: new Date(key + "T12:00"),
  trades: [],
  rules,
  met: rules.filter((r) => r.ok === true).length,
  applicable: rules.filter((r) => r.ok !== null).length,
  score,
});

describe("Disziplin view helpers (decision 12)", () => {
  it("weeks follow the measured width (14 px cells + 3 px gap), clamped to 8…53, 26 before the first measurement", () => {
    expect(heatWeeks(0)).toBe(HEAT.fallbackWeeks);
    expect(heatWeeks(Number.NaN)).toBe(26);
    expect(heatWeeks(664)).toBe(39);
    expect(heatWeeks(330)).toBe(19);
    expect(heatWeeks(60)).toBe(8);
    expect(heatWeeks(5000)).toBe(53);
  });

  it("month labels sit on the week of each month's 1st, never closer than 3 columns, and the start is named", () => {
    const today = new Date(2026, 9, 8);
    const cols = heatMap([], today, 20);
    const labels = monthLabels(cols);
    // 20 weeks: the first column is the week of 25 May, June starts in column 1 – no extra "Mai" squeezed in front
    expect(labels.map((l) => l.label)).toEqual(["Jun", "Jul", "Aug", "Sep", "Okt"]);
    // 23 weeks: the map starts on 4 May, June only in column 4 → the start is named
    expect(monthLabels(heatMap([], today, 23)).slice(0, 2)).toEqual([
      { col: 0, label: "Mai" },
      { col: 4, label: "Jun" },
    ]);
    for (let i = 1; i < labels.length; i++) expect(labels[i]!.col - labels[i - 1]!.col).toBeGreaterThanOrEqual(3);
    // the month of each label really starts in that column
    for (const l of labels.slice(1)) expect(cols[l.col]!.some((c) => c.key.endsWith("-01"))).toBe(true);
  });

  it("the 30-day trend covers every calendar day up to today, scores only on traded days", () => {
    const pts = scoreTrend([day("2026-10-06", 67), day("2026-08-01", 100)], new Date(2026, 9, 8), 30);
    expect(pts).toHaveLength(30);
    expect(pts[0]!.key).toBe("2026-09-09");
    expect(pts[29]).toMatchObject({ key: "2026-10-08", today: true, score: null });
    expect(pts.filter((p) => p.score != null).map((p) => [p.key, p.score])).toEqual([["2026-10-06", 67]]);
  });

  it("last trading days: newest first, scored days only, at most n", () => {
    const days = [day("2026-09-01", 50), day("2026-09-02", null), day("2026-09-03", 80), day("2026-09-04", 100)];
    expect(lastTradingDays(days, 2).map((d) => d.key)).toEqual(["2026-09-04", "2026-09-03"]);
    expect(lastTradingDays(days).map((d) => d.key)).toEqual(["2026-09-04", "2026-09-03", "2026-09-01"]);
  });

  it("day marks follow the fixed rule order, missing rules are not judged", () => {
    const marks = dayMarks(day("2026-10-06", 50, [{ key: "plan", ok: false }, { key: "stop", ok: true }]));
    expect(marks.slice(0, 5)).toEqual([
      { key: "stop", ok: true },
      { key: "setup", ok: null },
      { key: "checklist", ok: null },
      { key: "leverage", ok: null },
      { key: "plan", ok: false },
    ]);
    expect(marks).toHaveLength(10);
  });

  it("weakest rule: lowest rate, ties → judged on more days; none when every judged rule was kept", () => {
    const rate = (key: RuleKey, r: number | null, applicable: number): RuleRate => ({ key, label: key, rate: r, applicable, last: null });
    expect(weakestRule([rate("stop", 1, 3), rate("checklist", 0, 1), rate("plan", 0, 2), rate("signal", null, 0)])).toEqual({ key: "plan", label: "plan", rate: 0, applicable: 2, broken: 2 });
    expect(weakestRule([rate("stop", 1, 3), rate("reflect", 1 / 3, 3)])).toMatchObject({ key: "reflect", broken: 2 });
    expect(weakestRule([rate("stop", 1, 3), rate("signal", null, 0)])).toBeNull();
    expect(brokenLine({ broken: 1, applicable: 1 })).toBe("An 1 von 1 Handelstag verletzt.");
    expect(brokenLine({ broken: 2, applicable: 3 })).toBe("An 2 von 3 Handelstagen verletzt.");
  });

  it("score tone: ≥ 80 strong, < 50 weak, else mid", () => {
    expect([scoreTone(null), scoreTone(100), scoreTone(80), scoreTone(67), scoreTone(49)]).toEqual(["none", "strong", "strong", "mid", "weak"]);
  });
});
