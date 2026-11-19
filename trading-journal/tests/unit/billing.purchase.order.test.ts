// @vitest-environment node
/**
 * The pure rules of the purchase flow (B4): the yearly saving and its rounding, the dates, the order summary (price after the
 * trial, no invented tax), when the order button may send, the order in the `returnTo` grammar, the result-page state machine
 * (the return URL confirms nothing), the poll backoff, the withdrawal period, and the consent texts (client and server hash the
 * same bytes, the order button label is exactly the statutory one).
 */
import { describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";
import { LIST_PRICES } from "../../src/billing/plans";
import { WITHDRAWAL_DAYS, withdrawalOpen } from "../../src/billing/purchase/manage";
import {
  addInterval,
  firstPaymentDate,
  formatOrderDay,
  formatOrderParam,
  normalizeDraft,
  orderReadiness,
  parseOrderParam,
  planSaving,
  savingLabel,
  seatsFor,
  summarize,
  yearlySaving,
} from "../../src/billing/purchase/order";
import { pollAttempts, pollDelay, pollTimedOut, resultStateOf, RESULT_TEXT } from "../../src/billing/purchase/result";
import {
  CONSENT_KINDS,
  CONSENT_TEXT,
  CONSENT_TEXT_VERSION,
  ORDER_ID_RE,
  TERMS_CONSENT,
  consentCanonical,
  consentSetCanonical,
  consentSetHash,
  newOrderId,
  sha256Hex,
} from "../../src/legal/consentRecord";
import { BUTTON_LABELS, IMMEDIATE_START_CONSENT, PRICE_TAX_NOTE } from "../../src/legal/consentTexts";

describe("yearly saving (computed from the shown prices, never claimed)", () => {
  it("the list prices: 2 months free for every plan, −17 %, and the cents add up", () => {
    for (const plan of ["pro", "premium", "team"] as const) {
      const s = yearlySaving(LIST_PRICES[plan].month, LIST_PRICES[plan].year);
      expect(s.cents).toBe(LIST_PRICES[plan].month * 12 - LIST_PRICES[plan].year);
      expect(s.pct).toBe(17);
      expect(s.monthsFree).toBe(2);
      expect(savingLabel(s)).toBe("−17 %");
    }
    expect(planSaving("pro").cents).toBe(2400);
    expect(planSaving("premium").cents).toBe(4800);
    expect(planSaving("team").cents).toBe(3800);
  });

  it("no saving when yearly is not cheaper: no label, no 'months free'", () => {
    const s = yearlySaving(1000, 12000);
    expect(s).toEqual({ cents: 0, pct: 0, monthsFree: null });
    expect(savingLabel(s)).toBeNull();
    expect(yearlySaving(0, 0).pct).toBe(0);
  });

  it("rounds the percentage and names whole months only when it is a whole number", () => {
    const s = yearlySaving(1000, 10500); // 12 000 vs 10 500: 1 500 saved
    expect(s.pct).toBe(13); // 12.5 → 13
    expect(s.monthsFree).toBeNull(); // 1.5 months
  });

  it("uses Stripe's real prices when the server reports them (the label follows what is charged)", () => {
    const live = { pro: { month: { amount: 1000, currency: "eur", interval: "month" as const }, year: { amount: 10000, currency: "eur", interval: "year" as const } } };
    expect(planSaving("pro", live).cents).toBe(2000);
    expect(planSaving("pro", live).pct).toBe(17);
  });
});

describe("dates", () => {
  it("adds an interval; a 31st lands on the last day of a shorter month", () => {
    expect(addInterval(new Date("2026-01-31T10:00:00Z"), "month").toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addInterval(new Date("2028-01-31T10:00:00Z"), "month").toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(addInterval(new Date("2026-12-15T10:00:00Z"), "month").toISOString()).toBe("2027-01-15T10:00:00.000Z");
    expect(addInterval(new Date("2028-02-29T10:00:00Z"), "year").toISOString()).toBe("2029-02-28T10:00:00.000Z");
  });

  it("the first payment is after the trial; a German day with the Berlin calendar", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(firstPaymentDate(now, 14).toISOString()).toBe("2026-11-21T12:00:00.000Z");
    expect(firstPaymentDate(now, 0).toISOString()).toBe(now.toISOString());
    expect(formatOrderDay(new Date("2026-11-21T23:30:00Z"))).toBe("22.11.2026"); // already the 22nd in Berlin
  });
});

describe("order summary", () => {
  const now = new Date("2026-11-07T12:00:00Z");

  it("Pro yearly with a trial: names the price AFTER the trial, the date of the first payment and the renewal", () => {
    const s = summarize({ plan: "pro", interval: "year", seats: 9 }, { trialDays: 14, now });
    expect(s.draft.seats).toBe(1); // only Team has seats
    expect(s.totalCents).toBe(12000);
    expect(s.payCents).toBe(12000);
    expect(s.firstPayment.toISOString()).toBe("2026-11-21T12:00:00.000Z");
    expect(s.renewal.toISOString()).toBe("2027-11-21T12:00:00.000Z");
    expect(s.saving.monthsFree).toBe(2);
    expect(s.live).toBe(false);
  });

  it("Team: price per seat × seats, seats clamped to 2–50", () => {
    expect(summarize({ plan: "team", interval: "month", seats: 3 }, { now }).totalCents).toBe(5700);
    expect(summarize({ plan: "team", interval: "month", seats: 1 }, { now }).draft.seats).toBe(2);
    expect(seatsFor("team", 99)).toBe(50);
    expect(normalizeDraft({ plan: "pro", interval: "month", seats: 4 }).seats).toBe(1);
  });

  it("tax is a statement, never an amount: the summary has no tax figure, Stripe Tax is carried as a flag", () => {
    const off = summarize({ plan: "pro", interval: "month", seats: 1 }, { now });
    const on = summarize({ plan: "pro", interval: "month", seats: 1 }, { now, automaticTax: true });
    expect(off.automaticTax).toBe(false);
    expect(on.automaticTax).toBe(true);
    expect(Object.keys(off)).not.toContain("taxCents");
    expect(JSON.stringify(off)).not.toMatch(/0,00/);
  });

  it("a previewed code reduces the amount of the first payment only (percent and amount, never below 0)", () => {
    expect(summarize({ plan: "pro", interval: "month", seats: 1 }, { now, coupon: { percentOff: 20 } }).payCents).toBe(960);
    expect(summarize({ plan: "pro", interval: "month", seats: 1 }, { now, coupon: { amountOff: 5000 } }).payCents).toBe(0);
  });
});

describe("when the order button may send", () => {
  const base = { open: true, signedIn: true, terms: true, immediate: true, busy: false };
  it("only with both boxes ticked, signed in, the flow open and nothing in flight", () => {
    expect(orderReadiness(base)).toMatchObject({ ok: true, blocked: null });
    expect(orderReadiness({ ...base, terms: false })).toMatchObject({ ok: false, blocked: "terms", missing: ["terms"] });
    expect(orderReadiness({ ...base, immediate: false })).toMatchObject({ ok: false, blocked: "immediate", missing: ["immediate"] });
    expect(orderReadiness({ ...base, terms: false, immediate: false }).missing).toEqual(["terms", "immediate"]);
    expect(orderReadiness({ ...base, signedIn: false })).toMatchObject({ ok: false, blocked: "signedOut" });
    expect(orderReadiness({ ...base, open: false })).toMatchObject({ ok: false, blocked: "closed" });
    expect(orderReadiness({ ...base, busy: true })).toMatchObject({ ok: false, blocked: "busy" });
  });
});

describe("the order in the returnTo grammar", () => {
  it("round-trips and refuses anything else", () => {
    const d = { plan: "team" as const, interval: "year" as const, seats: 3 };
    expect(formatOrderParam(d)).toBe("team.year.3");
    expect(parseOrderParam("team.year.3")).toEqual(d);
    expect(parseOrderParam("pro.month.7")).toEqual({ plan: "pro", interval: "month", seats: 1 });
    for (const bad of ["free.month.1", "pro.week.1", "pro.month", "https://evil.example", "pro.month.1;x", "", null, undefined]) expect(parseOrderParam(bad as string | null | undefined), String(bad)).toBeNull();
  });
});

describe("result page: the return URL confirms nothing", () => {
  it("cancel → canceled; no subscription yet → pending (never confirmed); only active / trialing confirm", () => {
    expect(resultStateOf("cancel", null)).toBe("canceled");
    expect(resultStateOf("success", null)).toBe("pending");
    expect(resultStateOf("success", { id: "sub_1", status: "active" })).toBe("confirmed");
    expect(resultStateOf("success", { id: "sub_1", status: "trialing" })).toBe("confirmed");
    expect(resultStateOf("success", { id: "sub_1", status: "incomplete" })).toBe("action");
    for (const status of ["past_due", "unpaid", "incomplete_expired", "canceled"] as const) expect(resultStateOf("success", { id: "sub_1", status })).toBe("failed");
    expect(resultStateOf("success", { id: "sub_1", status: "paused" })).toBe("pending");
  });

  it("an older, ended subscription is no answer to THIS order (a leftover 'canceled' never reads as a failed payment)", () => {
    expect(resultStateOf("success", { id: "sub_old", status: "canceled" }, "sub_old")).toBe("pending");
    expect(resultStateOf("success", { id: "sub_new", status: "active" }, "sub_old")).toBe("confirmed");
  });

  it("the honest texts: the timeout wording and no 'aktiv' while pending", () => {
    expect(RESULT_TEXT.pendingSlow.title).toBe("Wir warten noch auf die Bestätigung von Stripe");
    expect(RESULT_TEXT.pending.title).not.toMatch(/aktiv/i);
    expect(RESULT_TEXT.pending.text).not.toMatch(/aktiv|freigeschaltet/i);
    expect(RESULT_TEXT.failed.text).toMatch(/kein aktives Abo/);
  });

  it("polls with a growing pause (800 ms … 6 s) and times out after about a minute", () => {
    expect([0, 1, 2, 3].map(pollDelay)).toEqual([800, 1200, 1800, 2700]);
    expect(pollDelay(20)).toBe(6000);
    const n = pollAttempts();
    expect(n).toBeGreaterThan(8);
    expect(n).toBeLessThan(25);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += pollDelay(i);
    expect(sum).toBeLessThanOrEqual(60_000);
    expect(pollTimedOut(n - 1)).toBe(false);
    expect(pollTimedOut(n)).toBe(true);
  });
});

describe("withdrawal period", () => {
  it("14 days from the conclusion of the contract; unknown start → not offered in the sheet", () => {
    const t0 = Date.parse("2026-11-01T10:00:00Z");
    expect(WITHDRAWAL_DAYS).toBe(14);
    expect(withdrawalOpen("2026-11-01T10:00:00Z", t0 + 13 * 86_400_000)).toBe(true);
    expect(withdrawalOpen("2026-11-01T10:00:00Z", t0 + 14 * 86_400_000)).toBe(true);
    expect(withdrawalOpen("2026-11-01T10:00:00Z", t0 + 14 * 86_400_000 + 1)).toBe(false);
    expect(withdrawalOpen(null, t0)).toBe(false);
    expect(withdrawalOpen("garbage", t0)).toBe(false);
  });
});

describe("consent texts and the button label", () => {
  it("the order button label is exactly the statutory one (§ 312j Abs. 3 BGB)", () => {
    expect(BUTTON_LABELS.order).toBe("Zahlungspflichtig bestellen");
    expect(BUTTON_LABELS.cancel).toBe("Verträge hier kündigen");
    expect(BUTTON_LABELS.cancelConfirm).toBe("Jetzt kündigen");
    expect(BUTTON_LABELS.withdraw).toBe("Vertrag widerrufen");
    expect(BUTTON_LABELS.withdrawConfirm).toBe("Widerruf bestätigen");
  });

  it("the two wordings are the ones of the legal package, not re-worded", () => {
    expect(CONSENT_TEXT.immediate_start).toBe(IMMEDIATE_START_CONSENT);
    expect(TERMS_CONSENT).toBe("Ich akzeptiere die AGB des Betreibers und habe die Widerrufsbelehrung und die Datenschutzerklärung zur Kenntnis genommen.");
    expect(PRICE_TAX_NOTE).toMatch(/inklusive gesetzlicher Umsatzsteuer/);
    expect(CONSENT_KINDS).toEqual(["terms", "immediate_start"]);
  });

  it("client and server hash the same bytes (Web Crypto = node:crypto) and the hash depends on every wording", async () => {
    const { createHash } = await import("node:crypto");
    const viaNode = createHash("sha256").update(consentSetCanonical()).digest("hex");
    expect(await consentSetHash()).toBe(viaNode);
    expect(await sha256Hex("abc")).toBe(createHash("sha256").update("abc").digest("hex"));
    expect(consentCanonical("terms")).toContain(CONSENT_TEXT_VERSION);
    expect(consentCanonical("terms")).not.toBe(consentCanonical("immediate_start"));
    expect(webcrypto.subtle).toBeDefined();
  });

  it("an order id is a UUID the server accepts; two orders never share one", () => {
    const a = newOrderId();
    expect(ORDER_ID_RE.test(a)).toBe(true);
    expect(newOrderId()).not.toBe(a);
    expect(ORDER_ID_RE.test("not-a-uuid")).toBe(false);
  });
});
