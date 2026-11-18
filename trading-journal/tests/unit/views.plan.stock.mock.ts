/**
 * The replaced stock candle loader of the Handelsplan page tests (the sibling of `views.plan.mock.ts`, kept apart for the same
 * reason: the `vi.mock` factory imports this file while the module it replaces is still loading).
 *
 *   vi.mock("@/market/plan/stockCandles", async () => (await import("./views.plan.stock.mock")).stockCandlesMock());
 */
import { vi } from "vitest";
import type { LoadRequest, PlanCandles } from "@/market/plan/candles";
import { nyParts } from "@/market/stocks/session";
import { stockSessionBars } from "../e2e/mocks/planStockCandles";

export const stockState = {
  loads: [] as LoadRequest[],
  failWith: null as string | null,
  /** how many 5-minute candles of the session the source has (default: all 78) */
  count: 78,
  marketTime: null as number | null,
  override: null as ((req: LoadRequest) => PlanCandles) | null,
};

const IV = 300_000;

export function resetStockState(): void {
  stockState.loads.length = 0;
  stockState.failWith = null;
  stockState.count = 78;
  stockState.marketTime = null;
  stockState.override = null;
}

/** `@/market/plan/stockCandles` with everything real except the loader. */
export async function stockCandlesMock(): Promise<typeof import("@/market/plan/stockCandles")> {
  const actual = await vi.importActual<typeof import("@/market/plan/stockCandles")>("@/market/plan/stockCandles");
  return {
    ...actual,
    loadStockPlanCandles: async (req: LoadRequest): Promise<PlanCandles> => {
      stockState.loads.push(req);
      if (stockState.override) return stockState.override(req);
      if (stockState.failWith) return { candles: [], source: "yahoo", fetchedAt: null, fromCache: true, error: stockState.failWith, sourceLabel: actual.STOCK_SOURCE_LABEL, notes: actual.STOCK_NOTES, marketTime: null };
      const now = Date.now();
      const day = nyParts(req.to).date;
      const candles = stockSessionBars(day, stockState.count)
        .map(([t, o, h, l, c, v]) => ({ time: t!, open: o!, high: h!, low: l!, close: c!, volume: v!, closed: t! + IV <= now, closeTime: t! + IV - 1 }))
        .filter((c) => c.time >= req.from && c.time <= req.to);
      return { candles, source: "yahoo", fetchedAt: now, fromCache: false, error: null, sourceLabel: actual.STOCK_SOURCE_LABEL, notes: actual.STOCK_NOTES, marketTime: stockState.marketTime };
    },
  };
}
