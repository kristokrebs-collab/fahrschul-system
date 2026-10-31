/**
 * P10 plan catalog + entitlement matrix (`src/billing/plans.ts`), the wire validators (`contract.ts`), the money /
 * status wording (`format.ts`) and the URL state (`url.ts`: `?ref=`, Stripe return).
 */
import { afterEach, describe, expect, it } from "vitest";
import { normalizePromoCode, normalizeRefCode, safeReturnTo } from "@/billing/contract";
import { daysUntil, displayPrice, formatDay, formatMoney, nextLine, priceDigits, statusTone, withCoupon } from "@/billing/format";
import {
  bestPlan,
  catalogProblems,
  discounted,
  featuresGained,
  LIST_PRICES,
  limitOf,
  minPlanFor,
  monthlyOfYearly,
  PLAN_CATALOG,
  planIncludes,
  upgradePlanFor,
  upgradePlanForLimit,
  yearlySavingsPct,
} from "@/billing/plans";
import { FEATURES, PLAN_IDS } from "@/billing/types";
import { captureReferral, parseReturn, REF_KEY, REF_TTL_MS, storedReferral, takeReturn } from "@/billing/url";
import type { SubscriptionSummary } from "@/billing/contract";

const sub = (p: Partial<SubscriptionSummary> = {}): SubscriptionSummary => ({
  id: "sub_1",
  plan: "pro",
  status: "active",
  interval: "month",
  seats: 1,
  currentPeriodEnd: "2026-11-12T08:00:00Z",
  cancelAtPeriodEnd: false,
  cancelAt: null,
  trialEnd: null,
  pausedUntil: null,
  amount: 1200,
  currency: "eur",
  hasPaymentMethod: true,
  ...p,
});

afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("plan catalog", () => {
  it("is consistent: every feature described, every limit set, higher plans never drop a feature", () => {
    expect(catalogProblems()).toEqual([]);
  });

  it("entitlement matrix: Free < Pro < Premium < Team", () => {
    expect(planIncludes("free", "cloudSync")).toBe(true);
    expect(planIncludes("free", "csvImport")).toBe(true);
    expect(planIncludes("free", "exchangeSync")).toBe(false);
    expect(planIncludes("pro", "exchangeSync")).toBe(true);
    expect(planIncludes("pro", "monteCarlo")).toBe(true);
    expect(planIncludes("pro", "coachAi")).toBe(false);
    expect(planIncludes("premium", "coachAi")).toBe(true);
    expect(planIncludes("premium", "backtestLab")).toBe(true);
    for (const f of FEATURES) expect(planIncludes("team", f)).toBe(true);
  });

  it("the cheapest plan for a feature / a limit", () => {
    expect(minPlanFor("cloudSync")).toBe("free");
    expect(upgradePlanFor("cloudSync")).toBe("pro");
    expect(upgradePlanFor("replay")).toBe("pro");
    expect(upgradePlanFor("apiAccess")).toBe("premium");
    expect(upgradePlanForLimit("savedViews", "free", 3)).toBe("pro");
    expect(upgradePlanForLimit("savedViews", "pro", 25)).toBe("premium");
    expect(upgradePlanForLimit("exchangeConnections", "premium", 5)).toBe("premium");
  });

  it("limits and the best plan", () => {
    expect(limitOf("free", "exchangeConnections")).toBe(0);
    expect(limitOf("pro", "exchangeConnections")).toBe(1);
    expect(limitOf("premium", "savedViews")).toBe(Infinity);
    expect(bestPlan(["pro", "team", "free"])).toBe("team");
    expect(bestPlan([])).toBe("free");
    expect(featuresGained("pro", "free")).toContain("monteCarlo");
    expect(featuresGained("pro", "free")).not.toContain("cloudSync");
  });

  it("prices: yearly saves two months, coupons never go below zero", () => {
    expect(yearlySavingsPct(LIST_PRICES.pro.month, LIST_PRICES.pro.year)).toBe(17);
    expect(yearlySavingsPct(1000, 12000)).toBe(0);
    expect(monthlyOfYearly(12000)).toBe(1000);
    expect(discounted(1200, { percentOff: 20 })).toBe(960);
    expect(discounted(1200, { amountOff: 500 })).toBe(700);
    expect(discounted(300, { amountOff: 500 })).toBe(0);
    expect(PLAN_CATALOG.pro.recommended).toBe(true);
    expect(PLAN_IDS.filter((p) => PLAN_CATALOG[p].recommended)).toHaveLength(1);
  });
});

describe("format", () => {
  it("money in German", () => {
    expect(formatMoney(1200)).toBe("12 €");
    expect(formatMoney(999)).toBe("9,99 €");
    expect(formatMoney(120000)).toBe("1.200 €");
    expect(priceDigits(960)).toBe("9,60");
    expect(priceDigits(2400)).toBe("24");
    expect(formatDay("2026-11-12T08:00:00Z")).toBe("12.11.2026");
    expect(formatDay(null)).toBe("");
  });

  it("display price: Stripe's real price wins over the list price; yearly per month", () => {
    expect(displayPrice("pro", "month")).toMatchObject({ amount: 1200, perMonth: 1200, live: false });
    expect(displayPrice("pro", "year")).toMatchObject({ amount: 12000, perMonth: 1000 });
    const live = displayPrice("pro", "month", { pro: { month: { amount: 1490, currency: "eur", interval: "month" } } });
    expect(live).toMatchObject({ amount: 1490, live: true });
    expect(withCoupon(displayPrice("pro", "year"), { percentOff: 20 })).toMatchObject({ amount: 9600, perMonth: 800 });
    expect(withCoupon(displayPrice("pro", "year"), null).amount).toBe(12000);
  });

  it("the next line and the tone follow the subscription", () => {
    const now = Date.parse("2026-10-12T08:00:00Z");
    expect(nextLine(null)).toBe("Kostenlos – ohne Laufzeit.");
    expect(nextLine(sub(), now)).toBe("Verlängert sich am 12.11.2026.");
    expect(nextLine(sub({ status: "trialing", trialEnd: "2026-10-15T08:00:00Z" }), now)).toBe("Testphase – noch 3 Tage.");
    expect(nextLine(sub({ cancelAtPeriodEnd: true, cancelAt: "2026-11-12T08:00:00Z" }), now)).toBe("Gekündigt – läuft bis 12.11.2026.");
    expect(nextLine(sub({ status: "past_due" }), now)).toBe("Die letzte Zahlung ist fehlgeschlagen.");
    expect(nextLine(sub({ status: "paused", pausedUntil: "2026-11-12T08:00:00Z" }), now)).toBe("Pausiert bis 12.11.2026.");
    expect(statusTone(sub())).toBe("win");
    expect(statusTone(sub({ status: "past_due" }))).toBe("loss");
    expect(statusTone(sub({ cancelAtPeriodEnd: true }))).toBe("warn");
    expect(daysUntil("2026-10-14T07:00:00Z", now)).toBe(2);
    expect(daysUntil(null, now)).toBeNull();
  });
});

describe("contract validators", () => {
  it("referral and promotion codes are normalised", () => {
    expect(normalizeRefCode(" abcd2345 ")).toBe("ABCD2345");
    expect(normalizeRefCode("ab")).toBeNull();
    expect(normalizeRefCode("abc-12345")).toBeNull();
    expect(normalizeRefCode(42)).toBeNull();
    expect(normalizePromoCode("trader-20")).toBe("TRADER-20");
    expect(normalizePromoCode("x")).toBeNull();
    expect(normalizePromoCode("<script>")).toBeNull();
  });

  it("return targets stay on this origin", () => {
    expect(safeReturnTo("/#preise")).toEqual({ path: "/", hash: "#preise" });
    expect(safeReturnTo("/dev/preise.html#konto")).toEqual({ path: "/dev/preise.html", hash: "#konto" });
    expect(safeReturnTo("/teilen/")).toEqual({ path: "/teilen/", hash: "" });
    for (const bad of ["//evil.example", "https://evil.example/", "javascript:alert(1)", "/a?x=1", "/a#<x>", 7, "/".repeat(300)]) {
      expect(safeReturnTo(bad)).toEqual({ path: "/", hash: "#preise" });
    }
  });
});

describe("url state", () => {
  it("reads the Stripe return and cleans the address bar (hash route kept)", () => {
    expect(parseReturn("?billing=success&session_id=cs_test_abc123")).toEqual({ kind: "success", sessionId: "cs_test_abc123" });
    expect(parseReturn("?billing=success&session_id=<x>")).toEqual({ kind: "success", sessionId: null });
    expect(parseReturn("?billing=cancel")).toEqual({ kind: "cancel" });
    expect(parseReturn("?billing=nope")).toBeNull();
    window.history.replaceState(null, "", "/?billing=portal&keep=1#konto");
    expect(takeReturn()).toEqual({ kind: "portal" });
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#konto");
  });

  it("keeps a valid ?ref= for 30 days", () => {
    window.history.replaceState(null, "", "/?ref=friend30#preise");
    const now = Date.parse("2026-10-12T08:00:00Z");
    expect(captureReferral(now)).toBe("FRIEND30");
    expect(window.location.search).toBe("");
    expect(storedReferral(now + 1000)).toBe("FRIEND30");
    expect(storedReferral(now + REF_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem(REF_KEY)).toBeNull();
    window.history.replaceState(null, "", "/?ref=%3Cx%3E");
    expect(captureReferral(now)).toBeNull();
    expect(window.location.search).toBe("");
  });
});
