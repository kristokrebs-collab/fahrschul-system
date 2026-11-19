/**
 * Funktionsprüfung Runde 18 (account pass): two lines of the data-takeover dialog said something the takeover does not do.
 */
import { describe, expect, it } from "vitest";
import { ZERO, type TakeoverPreview, type TakeoverResult } from "@/cloud/sync/takeover";
import { effectLine, summaryLine, TAKEOVER } from "@/cloud/ui/takeoverStrings";

const result = (p: Partial<TakeoverResult>): TakeoverResult => ({ choice: "merge", pushed: 0, pulled: 0, conflicts: 0, duplicates: 0, undoUntil: null, ...p });

describe("takeover dialog: the done line and the option lines", () => {
  it("„Nur Cloud“ over an empty account: this device was replaced – not „Beide Seiten waren schon gleich.“", () => {
    expect(summaryLine(result({ choice: "cloud" }))).toBe(TAKEOVER.done.cloudOnly);
    expect(TAKEOVER.done.cloudOnly).toMatch(/Sicherung/);
    // a merge that really moved nothing keeps its line; numbers win over both
    expect(summaryLine(result({ choice: "merge" }))).toBe("Beide Seiten waren schon gleich.");
    expect(summaryLine(result({ choice: "cloud", pulled: 3 }))).toBe("3 Einträge hierher");
  });

  it("„Lokale Daten übernehmen“ names what comes to this device too (the account-only entries arrive here)", () => {
    const preview: TakeoverPreview = {
      otherOwner: false,
      local: { ...ZERO, trades: 13 },
      cloud: { ...ZERO, trades: 3 },
      same: { ...ZERO },
      localOnly: { ...ZERO, trades: 12 },
      cloudOnly: { ...ZERO, trades: 2 },
      differ: { ...ZERO, trades: 1 },
      duplicates: 0,
      settings: "same",
      cloudEmpty: false,
      allowed: ["merge", "local", "cloud", "keep"],
      recommended: "merge",
    };
    expect(effectLine("local", preview)).toBe("12 Einträge ins Konto · 1 Eintrag im Konto überschrieben · 2 Einträge hierher");
    expect(TAKEOVER.options.local.text).not.toMatch(/bleibt dort/);
    expect(TAKEOVER.options.local.text).toMatch(/kommt auf dieses Gerät dazu/);
  });
});

describe("plan limits: a limit of a paid page is never offered below the plan that opens the page (Runde 18)", () => {
  it("dashboards → Premium (the Cockpit opens from Premium), also for a Free account at „2 / 1“; other limits keep their next plan", async () => {
    const { upgradePlanForLimit, planIncludes, LIMIT_NEEDS_FEATURE } = await import("@/billing/plans");
    expect(LIMIT_NEEDS_FEATURE.dashboards).toBe("customDashboards");
    expect(planIncludes("pro", "customDashboards")).toBe(false);
    expect(upgradePlanForLimit("dashboards", "free", 2)).toBe("premium");
    expect(upgradePlanForLimit("dashboards", "pro", 3)).toBe("premium");
    expect(upgradePlanForLimit("savedViews", "free", 99)).not.toBe("free");
    expect(upgradePlanForLimit("savedViews", "free", 1)).toBe("pro");
  });
});
