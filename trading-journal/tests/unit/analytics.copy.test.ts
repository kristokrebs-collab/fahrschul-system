/**
 * P03 copy (`copy.ts`): every ratio has a German label, a verdict for every sample state and an explainer with its
 * formula, sample and interval; the card explainers render for empty and filled inputs.
 */
import { describe, expect, it } from "vitest";
import {
  breakdown,
  distributionReport,
  excursionReport,
  explainBenchmark,
  explainBreakdown,
  explainCompare,
  explainCustom,
  explainDistribution,
  explainExcursion,
  explainHeatmap,
  explainMonteCarlo,
  explainRatio,
  explainRolling,
  explainRuin,
  explainStreaks,
  metricText,
  monteCarlo,
  RATIO_LABELS,
  ratioReport,
  ratioText,
  ratioVerdict,
  rollingStats,
  SIG_LABEL,
  streakReport,
  type Metric,
  type RatioKey,
} from "@/domain/analytics";
import { CTX, fixtureView } from "./analytics.fixtures";

const view = fixtureView();
const rep = ratioReport(view.closed, view);

describe("ratio copy", () => {
  it("labels, values and explainers for every ratio", () => {
    for (const key of Object.keys(RATIO_LABELS) as RatioKey[]) {
      const m = rep.metrics[key];
      const e = explainRatio(m, rep, "USDT");
      expect(e.key).toBe(`ana-${key}`);
      expect(e.title).toBe(RATIO_LABELS[key].label);
      expect(e.formula?.length).toBeGreaterThan(0);
      expect(e.rows.find((r) => r[0] === "Stichprobe")).toBeTruthy();
      expect(e.verdict.text.length).toBeGreaterThan(5);
    }
  });

  it("verdicts for missing data and for each band", () => {
    const empty: Metric = { key: "sharpe", value: null, n: 3, unit: "days", ci: null };
    expect(ratioVerdict(empty).text).toMatch(/Noch zu wenig Daten: ab 10 Tagen \(bisher 3\)/);
    expect(ratioVerdict({ ...empty, value: 2.4, n: 50 }).tone).toBe("win");
    expect(ratioVerdict({ ...empty, value: -0.4, n: 50 }).tone).toBe("loss");
    expect(ratioVerdict({ key: "kelly", value: -0.1, n: 20, unit: "trades", ci: null }).text).toMatch(/Keine Edge/);
    expect(ratioVerdict({ key: "edge", value: 0.3, n: 40, unit: "trades", ci: null, p: 0.02 }).tone).toBe("win");
    expect(ratioVerdict({ key: "edge", value: 0.3, n: 40, unit: "trades", ci: null, p: 0.15 }).tone).toBe("warn");
    expect(ratioText(Infinity)).toBe("∞");
    expect(ratioText(null)).toBe("–");
    expect(metricText({ key: "kelly", value: 0.25, n: 9, unit: "trades", ci: null })).toBe("25,0 %");
    expect(metricText({ key: "edge", value: 0.5, n: 9, unit: "trades", ci: null }, "R")).toBe("+0,50 R");
    expect(SIG_LABEL.tendenz).toBe("Tendenz");
  });
});

describe("card explainers", () => {
  it("render for filled and empty inputs", () => {
    const mc = monteCarlo(rep.rs, { runs: 100, horizon: 20 });
    expect(explainMonteCarlo(mc, "R", "USDT").rows.length).toBeGreaterThan(0);
    expect(explainMonteCarlo(null, "R", "USDT").rows).toEqual([]);
    expect(explainRuin(0.01, 0.002, 0.01, 0.5, 500).verdict.tone).toBe("win");
    expect(explainRuin(0.5, 0.2, 0.05, 0.5, 500).verdict.tone).toBe("loss");
    expect(explainBreakdown(breakdown(view.closed, "setup", CTX), "USDT").verdict.text).toMatch(/Trade the best: Breakout/);
    expect(explainExcursion(excursionReport(view.closed), "USDT").rows.length).toBeGreaterThan(3);
    expect(explainHeatmap().what.length).toBeGreaterThan(20);
    expect(explainRolling(rollingStats(view.closed, view.start, 20), "USDT").rows.length).toBe(4);
    expect(explainStreaks(streakReport(view.closed)).rows.length).toBe(6);
    expect(explainDistribution(distributionReport(view.closed), "USDT").rows.length).toBe(5);
    expect(explainBenchmark(null, null, "BTCUSDT").verdict.text).toMatch(/Ohne Tageskerzen/);
    expect(explainCompare().what).toMatch(/Welch/);
    expect(explainCustom().what).toMatch(/Backup/);
  });
});
