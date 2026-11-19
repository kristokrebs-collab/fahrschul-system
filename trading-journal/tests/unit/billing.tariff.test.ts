/**
 * Tariff contract (A1, `docs/TARIFE.md`): every point F01–F74 has its plan, the register agrees with the table, the prices
 * did not move, the new quotas read as proposed – and the server (`requireFeature`, `requireLimit`, `requireExchangeAccess`,
 * `requireAutoSync`, the cron's `autoSyncAllowed`) and the browser (`useEntitlement`, `useLimit`, `effectivePlanOf`) say the
 * same thing for every plan, because both read `src/billing/plans.ts`.
 */
import { act, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FEATURE_REGISTRY, tierOf, type FeatureEntry } from "@/app/features";
import { useEntitlement, useLimit } from "@/billing/entitlements";
import {
  autoSyncAllowed,
  catalogProblems,
  COMPARISON_GOALS,
  exchangeAccessAllowed,
  featuresOfGoal,
  GOAL_NAME,
  LIMIT_INFO,
  LIMIT_ORDER,
  limitOf,
  limitOffered,
  LIST_PRICES,
  minPlanFor,
  PAID_PLANS,
  PLAN_CATALOG,
  planIncludes,
} from "@/billing/plans";
import { resetBilling, useBilling } from "@/billing/store";
import { accessOf, fullPlanOf, FUNCTION_COUNT, FUNCTION_IDS, FUNCTION_TARIFF, startPlanOf, tariffByGoal, tariffOf, tariffSnapshot } from "@/billing/tariff";
import { FEATURES, GOAL_IDS, LIMIT_KEYS, PLAN_IDS, type Feature, type PlanId } from "@/billing/types";
import { setCloudEnabledForTests } from "@/cloud/env";
import { resetCloudSession, useCloudSession } from "@/cloud/session";
import { requireAutoSync, requireExchangeAccess, requireFeature, requireLimit, resetPaymentsReportForTests } from "../../netlify/functions/_lib/plan";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const U = "11111111-1111-4111-8111-111111111111";

/** COVERAGE.md rows: `F01 → Punkt`. */
function coverageNames(): Map<string, string> {
  const text = readFileSync(join(ROOT, "docs/COVERAGE.md"), "utf8");
  const out = new Map<string, string>();
  for (const l of text.split("\n").filter((x) => /^\| F\d\d \|/.test(x))) {
    const c = l.split("|").map((x) => x.trim());
    out.set(c[1]!, c[2]!);
  }
  return out;
}

const entriesOf = (fid: string): FeatureEntry[] => FEATURE_REGISTRY.filter((f) => f.fids.includes(fid));

describe("tariff table per function", () => {
  it("has one row for each of F01–F74, in order, named like COVERAGE.md", () => {
    expect(FUNCTION_COUNT).toBe(74);
    expect(FUNCTION_IDS).toEqual(Array.from({ length: 74 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`));
    const names = coverageNames();
    for (const t of FUNCTION_TARIFF) {
      expect(names.get(t.fid), t.fid).toBe(t.name);
      expect(GOAL_IDS as readonly string[], `${t.fid}: goal`).toContain(t.goal);
      expect(tariffOf(t.fid)).toBe(t);
    }
  });

  it("gives every F-ID a plan: where it starts, where it is complete – and both are real plans", () => {
    for (const t of FUNCTION_TARIFF) {
      expect(PLAN_IDS, `${t.fid} start`).toContain(startPlanOf(t));
      expect(PLAN_IDS, `${t.fid} full`).toContain(fullPlanOf(t));
      expect(PLAN_IDS.indexOf(fullPlanOf(t)), `${t.fid}: complete before it starts`).toBeGreaterThanOrEqual(PLAN_IDS.indexOf(startPlanOf(t)));
      // Team has everything of every function
      expect(accessOf(t, "team"), t.fid).toBe("voll");
      // what a plan below the start does not get is "nein", never "teilweise"
      for (const p of PLAN_IDS) {
        if (PLAN_IDS.indexOf(p) < PLAN_IDS.indexOf(startPlanOf(t))) expect(accessOf(t, p), `${t.fid} ${p}`).toBe("nein");
        else if (PLAN_IDS.indexOf(p) >= PLAN_IDS.indexOf(fullPlanOf(t))) expect(accessOf(t, p), `${t.fid} ${p}`).toBe("voll");
      }
      for (const k of t.limits) expect(LIMIT_KEYS as readonly string[], `${t.fid}: limit ${k}`).toContain(k);
    }
  });

  it("agrees with the register: every F-ID has register entries, core / extras follow their gates, limits and goal match", () => {
    for (const t of FUNCTION_TARIFF) {
      const ents = entriesOf(t.fid);
      expect(ents.length, `${t.fid} has no register entry`).toBeGreaterThan(0);
      // the goal is the group of the first entry that lists the F-ID (the register is in the order of the day)
      expect(ents[0]!.group, `${t.fid}: goal`).toBe(t.goal);
      const gates = Array.from(new Set(ents.map((e) => e.gate)));
      // core: free when any entry is ungated, else the lowest-plan gate (first one wins a tie); extras: every other gate
      let core: Feature | null = null;
      if (!gates.includes(undefined)) {
        const rank = (f: Feature): number => PLAN_IDS.indexOf(minPlanFor(f));
        core = (gates as Feature[]).reduce((best, g) => (rank(g) < rank(best) ? g : best));
      }
      expect(t.core, `${t.fid}: core`).toBe(core);
      const extras = (gates.filter((g): g is Feature => g !== undefined && g !== core) as Feature[]).sort();
      expect([...t.extras].sort(), `${t.fid}: extras`).toEqual(extras);
      for (const e of ents) if (e.limit) expect(t.limits, `${t.fid}: the register entry ${e.id} names the quota ${e.limit}`).toContain(e.limit);
    }
  });

  it("adds F55 'Klare mobile Oberfläche' to the register (it was the one point without an entry)", () => {
    const f55 = entriesOf("F55");
    expect(f55.map((e) => e.id)).toEqual(["mobile-oberflaeche"]);
    expect(f55[0]).toMatchObject({ name: "Klare mobile Oberfläche", group: "konto", status: "teilweise" });
    expect(tierOf(f55[0]!.gate)).toBe("frei");
  });

  it("covers every plan feature: no feature the table or the register leaves unmentioned", () => {
    const used = new Set<Feature>([...FUNCTION_TARIFF.flatMap((t) => [...(t.core ? [t.core] : []), ...t.extras]), ...FEATURE_REGISTRY.flatMap((f) => (f.gate ? [f.gate] : []))]);
    // sold but not behind any F-ID: cloud storage, dashboards (Cockpit) and the mentor mode's sibling features are named by their entries
    for (const f of FEATURES) if (!used.has(f)) expect(["cloudSync", "screenshotsCloud", "customDashboards", "reportsPdf", "coachAi"], `${f} is in no function`).toContain(f);
  });

  it("groups the table by goal in the order of the day", () => {
    const groups = tariffByGoal();
    expect(groups.map((g) => g.goal)).toEqual(GOAL_IDS.filter((g) => FUNCTION_TARIFF.some((t) => t.goal === g)));
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(74);
  });
});

describe("the contract: prices, plans, quotas", () => {
  it("is consistent (catalogProblems) and the goals have one name everywhere", () => {
    expect(catalogProblems()).toEqual([]);
    expect(COMPARISON_GOALS.map((g) => g.goal)).toEqual([...GOAL_IDS]);
    for (const g of GOAL_IDS) expect(GOAL_NAME[g], g).toBeTruthy();
    // every feature sits under exactly one goal
    expect(GOAL_IDS.flatMap((g) => featuresOfGoal(g)).sort()).toEqual([...FEATURES].sort());
  });

  it("keeps the prices: Free 0, Pro 12 / 120, Premium 24 / 240, Team 19 / 190 per seat from 2 seats", () => {
    expect(LIST_PRICES).toEqual({ pro: { month: 1200, year: 12000 }, premium: { month: 2400, year: 24000 }, team: { month: 1900, year: 19000 } });
    expect(PAID_PLANS).toEqual(["pro", "premium", "team"]);
    expect(PLAN_CATALOG.team).toMatchObject({ perSeat: true, minSeats: 2 });
  });

  it("holds the proposed quotas (docs/TARIFE.md – a proposal the operator releases)", () => {
    const q = (k: (typeof LIMIT_KEYS)[number]) => PLAN_IDS.map((p) => limitOf(p, k));
    expect(q("exchangeConnections")).toEqual([1, 1, 5, 5]);
    expect(q("backgroundSyncConnections")).toEqual([0, 1, 5, 5]);
    expect(q("tvConnections")[0]).toBe(1);
    expect(q("coachAiPerDay")).toEqual([0, 0, 50, 50]);
    expect(q("shotExtractPerDay")).toEqual([0, 0, 20, 20]);
    expect(q("simulationsPerDay")).toEqual([20, 200, Infinity, Infinity]);
    expect(q("phoneCallsPerMonth")).toEqual([0, 0, 30, 60]);
    expect(q("alertChannels")).toEqual([1, 2, 3, 3]);
  });

  it("offers on the price page only what exists: a quota of a function that is not built yet stays out", () => {
    for (const k of LIMIT_KEYS) {
      const live = LIMIT_INFO[k].state === "live";
      expect(limitOffered(k, { coachAi: true }), k).toBe(live);
    }
    // the planned ones are named, so nobody forgets to switch them on with their package (C2 switched alertChannels and phoneCallsPerMonth on: the alarms enforce them)
    expect(LIMIT_KEYS.filter((k) => LIMIT_INFO[k].state === "geplant").sort()).toEqual(["simulationsPerDay", "tvConnections"]);
    for (const k of LIMIT_KEYS) expect(LIMIT_INFO[k].enforcedBy.length, k).toBeGreaterThan(8);
    expect([...LIMIT_ORDER].sort()).toEqual([...LIMIT_KEYS].sort());
  });

  it("Free: one read-only exchange connection by hand, the automatic sync starts with Pro", () => {
    expect(exchangeAccessAllowed("free")).toBe(true);
    expect(autoSyncAllowed("free")).toBe(false);
    for (const p of ["pro", "premium", "team"] as const) expect(autoSyncAllowed(p)).toBe(true);
  });
});

/* ----------------------------------------------------------------------------------- server = client */

/** A fake admin client that answers `profiles` reads with one row. */
function fakeAdmin(row: { plan: string; plan_status: string } | null): SupabaseClient {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
  return { from: () => chain } as unknown as SupabaseClient;
}

const setEnv = (on: boolean): void => {
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PRO_MONTHLY"]) delete process.env[k];
  if (on) {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_1";
  }
};

describe("server and browser read the same table", () => {
  beforeEach(() => {
    setEnv(true);
    resetPaymentsReportForTests();
    localStorage.clear();
    setCloudEnabledForTests(true);
    resetCloudSession();
    resetBilling();
  });
  afterEach(() => {
    setSupabaseAdminForTests(null);
    setEnv(false);
    setCloudEnabledForTests(null);
    resetCloudSession();
    resetBilling();
  });

  /** The browser's view of a signed-in user on `plan` while payments are open. */
  function client(plan: PlanId) {
    act(() => useCloudSession.setState({ phase: "signedIn", user: { id: U, email: "t@example.com", aal: "aal1", mfaEnrolled: false } }));
    act(() => useBilling.setState({
      config: { enabled: true, trialDays: 14, referralTrialDays: 30, cardless: false, prices: {}, available: ["pro", "premium", "team"] },
      account: { userId: U, plan: { plan, status: plan === "free" ? "none" : "active", trialEnd: null }, subscription: null, invoices: null, hasCustomer: false, trialUsed: false, team: null },
    }));
    return renderHook(() => ({
      features: Object.fromEntries(FEATURES.map((f) => [f, useEntitlement(f)])) as Record<Feature, boolean>,
      limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, useLimit(k)])) as Record<(typeof LIMIT_KEYS)[number], number>,
    })).result.current;
  }

  for (const plan of PLAN_IDS) {
    it(`${plan}: every feature and every quota agrees between requireFeature / requireLimit and the hooks`, async () => {
      setSupabaseAdminForTests(fakeAdmin(plan === "free" ? { plan: "free", plan_status: "none" } : { plan, plan_status: "active" }));
      const c = client(plan);
      for (const f of FEATURES) {
        const server = await requireFeature(U, f).then(
          () => true,
          (e: { status?: number; code?: string }) => {
            expect(e, `${plan}/${f}`).toMatchObject({ status: 402, code: "plan_required" });
            return false;
          },
        );
        expect(server, `${plan}/${f} server`).toBe(planIncludes(plan, f));
        expect(c.features[f], `${plan}/${f} browser`).toBe(server);
      }
      for (const k of LIMIT_KEYS) {
        expect(c.limits[k], `${plan}/${k} browser`).toBe(limitOf(plan, k));
        const limit = limitOf(plan, k);
        // below the limit the server lets it through, at the limit it says limit_reached – the same number the browser shows
        if (limit > 0 && Number.isFinite(limit)) await expect(requireLimit(U, k, limit - 1)).resolves.toBe(limit);
        if (Number.isFinite(limit)) await expect(requireLimit(U, k, limit)).rejects.toMatchObject({ status: 402, code: "limit_reached" });
        else await expect(requireLimit(U, k, 10_000)).resolves.toBe(Infinity);
      }
      // the exchange gates and the cron decision come from the same two helpers
      if (exchangeAccessAllowed(plan)) await expect(requireExchangeAccess(U)).resolves.toMatchObject({ plan });
      else await expect(requireExchangeAccess(U)).rejects.toMatchObject({ status: 402, code: "plan_required" });
      if (autoSyncAllowed(plan)) await expect(requireAutoSync(U)).resolves.toMatchObject({ plan });
      else await expect(requireAutoSync(U)).rejects.toMatchObject({ status: 402, code: "plan_required" });
    });
  }

  it("builds one snapshot of the whole contract that Team, Premium, Pro and Free each read the same way", () => {
    const snap = tariffSnapshot();
    expect(Object.keys(snap.functions)).toHaveLength(74);
    for (const p of PLAN_IDS) {
      expect(snap.features[p], p).toEqual(FEATURES.filter((f) => planIncludes(p, f)));
      for (const k of LIMIT_KEYS) expect(snap.limits[p][k], `${p}/${k}`).toBe(Number.isFinite(limitOf(p, k)) ? limitOf(p, k) : "unbegrenzt");
    }
    // Free can use at least half of the 74 functions at their core
    expect(Object.values(snap.functions).filter((f) => f.start === "free").length).toBeGreaterThan(37);
  });
});
