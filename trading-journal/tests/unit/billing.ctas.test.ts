/**
 * Paket B: what the bottom of a plan card says and does (`planCta`), and the order of the yearly amounts the cards show.
 * One pure function decides the words of the Auftrag ("Kostenlos starten", "Premium auswählen", "Weiter zur Zahlung",
 * "Dein aktueller Tarif", "Zu Premium wechseln" / "Tarif ändern"); an own plan is a status, never a button that looks clickable.
 */
import { describe, expect, it } from "vitest";
import { CTA, orderStepLabel, planCta, type PlanCtaInput } from "@/billing/ctas";
import { summarize } from "@/billing/purchase/order";
import { displayPrice } from "@/billing/format";

const base: PlanCtaInput = { plan: "premium", signedIn: false, currentPlan: "free", hasSubscription: false, mode: "open", purchaseOpen: true, available: true };
const cta = (o: Partial<PlanCtaInput>) => planCta({ ...base, ...o });

describe("planCta – the words of the Auftrag", () => {
  it("Free: 'Kostenlos starten' signed out, a status for the own plan, an honest line after a paid plan", () => {
    expect(cta({ plan: "free" })).toEqual({ kind: "free-start", label: "Kostenlos starten", clickable: true });
    expect(cta({ plan: "free", signedIn: true })).toMatchObject({ kind: "current", label: "Dein aktueller Tarif", clickable: false });
    expect(cta({ plan: "free", signedIn: true, currentPlan: "pro", hasSubscription: true })).toMatchObject({ kind: "after-cancel", clickable: false });
  });

  it("a paid plan, signed out: '<Plan> auswählen'; signed in without a subscription: 'Weiter zur Zahlung'", () => {
    expect(cta({ plan: "premium" })).toEqual({ kind: "select", label: "Premium auswählen", clickable: true });
    expect(cta({ plan: "pro" }).label).toBe("Pro auswählen");
    expect(cta({ plan: "team" }).label).toBe("Team auswählen");
    expect(cta({ plan: "premium", signedIn: true })).toEqual({ kind: "to-payment", label: "Weiter zur Zahlung", clickable: true });
  });

  it("the own plan is 'Dein aktueller Tarif' and NOT clickable – with or without a subscription", () => {
    expect(cta({ plan: "premium", signedIn: true, currentPlan: "premium", hasSubscription: true })).toEqual({ kind: "current", label: "Dein aktueller Tarif", clickable: false });
    expect(cta({ plan: "pro", signedIn: true, currentPlan: "pro" })).toMatchObject({ kind: "current", clickable: false });
  });

  it("another plan while a subscription runs: 'Zu <Plan> wechseln' upwards, 'Tarif ändern' downwards", () => {
    const own = { signedIn: true, hasSubscription: true };
    expect(cta({ ...own, plan: "premium", currentPlan: "pro" })).toEqual({ kind: "switch", label: "Zu Premium wechseln", clickable: true });
    expect(cta({ ...own, plan: "team", currentPlan: "premium" }).label).toBe("Zu Team wechseln");
    expect(cta({ ...own, plan: "pro", currentPlan: "premium" })).toEqual({ kind: "switch", label: "Tarif ändern", clickable: true });
  });

  it("closed or locked purchase: an honest line, never a button; a plan without a price is 'Noch nicht buchbar'", () => {
    expect(cta({ mode: "off" })).toMatchObject({ kind: "soon", clickable: false });
    expect(cta({ mode: "closed", plan: "free" })).toMatchObject({ kind: "closed", label: "Alles freigeschaltet", clickable: false });
    expect(cta({ purchaseOpen: false })).toMatchObject({ kind: "locked", label: "Noch nicht bestellbar", clickable: false });
    expect(cta({ available: false, signedIn: true })).toMatchObject({ kind: "soon", clickable: false });
    // a running subscription may still switch while the NEW purchase flow is locked (the portal does it, not the order)
    expect(cta({ purchaseOpen: false, signedIn: true, hasSubscription: true, currentPlan: "pro" })).toMatchObject({ kind: "switch", clickable: true });
  });

  it("the detail and upgrade sheets use the same two words as the cards", () => {
    expect(orderStepLabel(false, "premium")).toBe("Premium auswählen");
    expect(orderStepLabel(true, "premium")).toBe(CTA.toPayment);
  });

  it("no CTA ever carries the legally fixed order wording or a trial promise (§ 312j Abs. 3 BGB belongs to the order button only)", () => {
    const all = [cta({}), cta({ signedIn: true }), cta({ plan: "free" }), cta({ signedIn: true, hasSubscription: true, currentPlan: "pro" })].map((c) => c.label).join(" ");
    expect(all).not.toMatch(/zahlungspflichtig|bestellen|gratis|testen|abonnieren/i);
  });
});

describe("the amounts the cards must show (the yearly price is the amount DUE)", () => {
  it("Pro 120 €, Premium 240 €, Team 190 € per seat and year – the monthly value is only a comparison", () => {
    expect(displayPrice("pro", "year").amount).toBe(12_000);
    expect(displayPrice("premium", "year").amount).toBe(24_000);
    expect(displayPrice("team", "year").amount).toBe(19_000);
    expect(displayPrice("pro", "year").perMonth).toBe(1_000);
    expect(displayPrice("pro", "month").amount).toBe(1_200);
  });

  it("Team: at least two seats, 2 × 190 € = 380 € per year (the order summary says the same)", () => {
    const one = summarize({ plan: "team", interval: "year", seats: 1 });
    expect(one.draft.seats).toBe(2);
    expect(one.totalCents).toBe(38_000);
    expect(summarize({ plan: "team", interval: "month", seats: 2 }).totalCents).toBe(3_800);
    expect(summarize({ plan: "team", interval: "year", seats: 5 }).totalCents).toBe(95_000);
    expect(summarize({ plan: "premium", interval: "year", seats: 9 }).totalCents).toBe(24_000); // seats count only for Team
  });
});
