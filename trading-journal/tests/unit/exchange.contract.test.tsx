/**
 * Exchange positions contract (`src/exchanges/positions.ts`, Wave 0): without a connection there is nothing, and the
 * empty list is referentially stable (consumers memoise on it).
 */
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useExchangePositions, useHasExchangeConnection } from "@/exchanges/positions";

describe("exchange positions", () => {
  it("no connection → no positions, stable between renders", () => {
    const { result, rerender } = renderHook(() => useExchangePositions());
    const first = result.current;
    rerender();
    expect(result.current).toEqual([]);
    expect(result.current).toBe(first);
    expect(renderHook(() => useHasExchangeConnection()).result.current).toBe(false);
  });
});
