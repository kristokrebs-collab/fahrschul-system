/**
 * Shared harness of the Handelsplan page tests: the page, a fresh journal, an empty loader log and the fixed clock (25.10.2026
 * 10:00 UTC – the session of 19.10.2026 is over, nothing hangs on the real time). The candles come from `views.plan.mock.ts`.
 * Not a test file itself.
 *
 *   vi.mock("@/market/plan/candles", async () => (await import("./views.plan.mock")).candlesMock());
 *   setupPlanTests();
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import { DEFAULT_FORM } from "@/domain/plan";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { PlanView } from "@/views/plan/PlanView";
import { usePlanForm } from "@/views/plan/planStore";
import { PLAN_DAY } from "../e2e/mocks/planCandles";
import { mockState, NOW } from "./views.plan.mock";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

export { mockState, NOW };

export function renderPlan() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <PlanView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

export const setForm = (patch: Partial<typeof DEFAULT_FORM>): void => usePlanForm.getState().set({ day: PLAN_DAY, ...patch });
export const text = (id: string): string => screen.getByTestId(id).textContent ?? "";

/** Registers the hooks: polyfills once, a fresh journal, an empty loader log and the fixed clock before every test. */
export function setupPlanTests(): void {
  beforeAll(() => {
    installDomPolyfills();
    window.scrollTo = vi.fn() as never;
    Element.prototype.scrollIntoView = vi.fn();
  });
  beforeEach(async () => {
    await bootFixtureJournal();
    localStorage.clear();
    mockState.loads.length = 0;
    mockState.failWith = null;
    mockState.override = null;
    usePlanForm.setState({ form: { ...DEFAULT_FORM }, restored: true, planId: null });
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    setForm({});
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}
