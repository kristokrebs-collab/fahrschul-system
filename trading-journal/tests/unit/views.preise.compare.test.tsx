/**
 * The comparison on the pricing page (A1): grouped by the goals of a trader (the names of the tiles on the page "Funktionen"),
 * foldable (the first group open, the others a header each), one real table for screen readers with every row folded or not,
 * and only the quotas whose function exists. It reads the SAME table as the gates (`plans.ts`).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { COMPARISON_GOALS, featuresOfGoal, LIMIT_INFO, LIMIT_ORDER, limitOffered } from "@/billing/plans";
import { useBilling } from "@/billing/store";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession } from "@/cloud/session";
import { MotionRoot } from "@/motion/MotionRoot";
import { PlanComparison, comparisonGroups } from "@/views/preise/PlanComparison";
import { installDomPolyfills } from "./views.overview.harness";

function reduceMotion() {
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduced-motion"), media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
}

const CONFIG = { enabled: true, trialDays: 14, referralTrialDays: 30, cardless: false, prices: {}, available: ["pro", "premium", "team"], coachAi: true } as never;

describe("price comparison by goal", () => {
  beforeAll(() => {
    installDomPolyfills();
    reduceMotion();
  });
  beforeEach(() => {
    localStorage.clear();
    setCloudEnabledForTests(true);
    resetCloudSession();
    useBilling.setState({ config: CONFIG });
  });
  afterEach(() => {
    setCloudEnabledForTests(null);
    resetCloudSession();
  });

  const renderIt = () =>
    render(
      <MotionRoot>
        <PlanComparison />
      </MotionRoot>,
    );

  it("groups by goal in the order of the day, under the same names as the tiles of the page 'Funktionen'", () => {
    const groups = comparisonGroups({ coachAi: true });
    const goalGroups = groups.filter((g) => g.id !== "limits");
    expect(goalGroups.map((g) => g.id)).toEqual(COMPARISON_GOALS.filter((g) => featuresOfGoal(g.goal).length).map((g) => g.goal));
    for (const g of goalGroups) expect(g.title).toBe(COMPARISON_GOALS.find((x) => x.goal === g.id)!.label);
    expect(groups.at(-1)!.id).toBe("limits");
    expect(groups.at(-1)!.title).toBe("Kontingente");
  });

  it("lists the quotas in the contract's order and leaves out those whose function is not built yet", () => {
    const rows = comparisonGroups({ coachAi: true }).at(-1)!.rows.map((r) => r.key);
    expect(rows).toEqual(LIMIT_ORDER.filter((k) => limitOffered(k, { coachAi: true })));
    for (const k of ["tvConnections", "simulationsPerDay"]) expect(rows).not.toContain(k);
    // C2: the alarms enforce the channel and call quotas now, so the price page names them
    for (const k of ["exchangeConnections", "backgroundSyncConnections", "shotExtractPerDay", "coachAiPerDay", "alertChannels", "phoneCallsPerMonth"]) expect(rows).toContain(k);
    // Free's one read-only connection is a number, the automatic sync is 'not included'
    const ex = comparisonGroups({ coachAi: true }).at(-1)!.rows.find((r) => r.key === "exchangeConnections")!;
    expect(ex.cells.map((c) => c.text)).toEqual(["1", "1", "5", "5"]);
    const bg = comparisonGroups({ coachAi: true }).at(-1)!.rows.find((r) => r.key === "backgroundSyncConnections")!;
    expect(bg.cells.map((c) => c.text)).toEqual(["Nicht enthalten", "1", "5", "5"]);
    expect(LIMIT_INFO.simulationsPerDay.state).toBe("geplant");
  });

  it("opens the first group, folds the others and keeps one real table with every row for screen readers", () => {
    renderIt();
    const groups = screen.getAllByTestId("compare-group");
    expect(groups.map((g) => g.getAttribute("data-open"))).toEqual(["1", ...groups.slice(1).map(() => "0")]);
    const table = screen.getByRole("table", { name: "Alle Funktionen im Vergleich" });
    // every group's rows are in the table although most are folded
    expect(within(table).getByRole("rowheader", { name: "Backtest-Labor" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Automatischer Börsen-Sync" })).toBeInTheDocument();
    expect(within(table).getAllByRole("rowgroup").length).toBeGreaterThan(5);
    for (const t of screen.getAllByTestId("compare-group-toggle")) expect(t).toHaveAttribute("aria-expanded");
  });

  it("a header opens and closes its group without touching the others; 'Alle aufklappen' opens all", async () => {
    renderIt();
    const toggles = screen.getAllByTestId("compare-group-toggle");
    expect(toggles[1]).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggles[1]!);
    expect(toggles[1]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(toggles[2]).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggles[0]!);
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByTestId("compare-toggle-all"));
    for (const t of screen.getAllByTestId("compare-group-toggle")) expect(t).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("compare-toggle-all")).toHaveTextContent("Alle zuklappen");
    fireEvent.click(screen.getByTestId("compare-toggle-all"));
    await waitFor(() => {
      for (const t of screen.getAllByTestId("compare-group-toggle")) expect(t).toHaveAttribute("aria-expanded", "false");
    });
  });
});
