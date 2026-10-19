/**
 * Billing contract (`src/billing`, Wave 0): plan vocabulary and the gate API.
 */
import { describe, expect, it } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import { FEATURES, FREE_PLAN, Gate, grantsPlan, isFeature, isPlanId, isPlanStatus, PLAN_IDS, useEntitlement, useLimit, usePlan } from "@/billing/entitlements";

describe("plan vocabulary", () => {
  it("ids and guards", () => {
    expect(PLAN_IDS).toEqual(["free", "pro", "premium", "team"]);
    expect(isPlanId("pro")).toBe(true);
    expect(isPlanId("gold")).toBe(false);
    expect(isPlanStatus("trialing")).toBe(true);
    expect(isFeature("monteCarlo")).toBe(true);
    expect(new Set(FEATURES).size).toBe(FEATURES.length);
    expect(grantsPlan("past_due")).toBe(true);
    expect(grantsPlan("canceled")).toBe(false);
    expect(FREE_PLAN).toEqual({ plan: "free", status: "none", trialEnd: null });
  });
});

describe("gate API", () => {
  it("hooks answer with the documented types", () => {
    expect(typeof renderHook(() => useEntitlement("exchangeSync")).result.current).toBe("boolean");
    expect(typeof renderHook(() => useLimit("exchangeConnections")).result.current).toBe("number");
    expect(isPlanId(renderHook(() => usePlan()).result.current.plan)).toBe(true);
  });

  it("<Gate> renders its children when entitled", () => {
    render(
      <Gate feature="analyticsPro" fallback={<p>Upgrade</p>}>
        <p>Inhalt</p>
      </Gate>,
    );
    expect(screen.getByText("Inhalt")).toBeInTheDocument();
  });
});
