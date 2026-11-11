/**
 * The replaced candle loader of the Handelsplan page tests (kept apart from the harness: the `vi.mock` factory imports this
 * file while the module it replaces is still loading, so it must not import the page).
 *
 *   vi.mock("@/market/plan/candles", async () => (await import("./views.plan.mock")).candlesMock());
 */
import { vi } from "vitest";
import type { LoadRequest, PlanCandles } from "@/market/plan/candles";
import { planCandles } from "../e2e/mocks/planCandles";

/** 25.10.2026 10:00 UTC – the session of 19.10. is over. */
export const NOW = Date.UTC(2026, 9, 25, 10, 0);

export const mockState = {
  loads: [] as LoadRequest[],
  failWith: null as string | null,
  override: null as ((req: LoadRequest) => PlanCandles) | null,
};

/** `@/market/plan/candles` with everything real except the loader. */
export async function candlesMock(): Promise<typeof import("@/market/plan/candles")> {
  const actual = await vi.importActual<typeof import("@/market/plan/candles")>("@/market/plan/candles");
  return {
    ...actual,
    loadPlanCandles: async (req: LoadRequest): Promise<PlanCandles> => {
      mockState.loads.push(req);
      if (mockState.override) return mockState.override(req);
      if (mockState.failWith) return { candles: [], source: "cache", fetchedAt: null, fromCache: true, error: mockState.failWith };
      return { candles: planCandles(req.from, req.to, 1500, NOW), source: "binance", fetchedAt: NOW, fromCache: false, error: null };
    },
  };
}
