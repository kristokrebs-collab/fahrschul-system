/**
 * The order paid INSIDE the app (Paket V) as a small state machine next to `submitOrder` (the Checkout hand-over, which stays the fallback):
 *
 *   idle ──Zahlungspflichtig bestellen──► starting (our server: checks, evidence, the intent)
 *        ──► confirming (Stripe: the card, 3-D Secure in Stripe's own dialog)
 *        ──► waiting (Stripe said yes; the WEBHOOK has not told our server yet)
 *        ──► confirmed (the server reports the subscription active / trialing)  … or slow (the budget ran out: honest "wir warten")
 *   any step ──► failed (declined card, 3-D Secure cancelled, server error, the payment failed after all): the card goes back to its
 *                place, the message stands at the field, NOTHING is shown as paid.
 *
 * "Bezahlt" is NEVER the browser's own conclusion: only `billing/status` (written by the Stripe webhook) ends in `confirmed`.
 */
import { create } from "zustand";
import { ApiError } from "@/cloud/api";
import { consentSetHash, newOrderId } from "@/legal/consentRecord";
import { postSubscribe } from "../../api";
import type { SubscribeRequest, SubscribeResponse } from "../../contract";
import { errorText, loadBilling, sessionUserId, useBilling } from "../../store";
import { currentReturnTo, storedReferral } from "../../url";
import { normalizeDraft, type OrderDraft } from "../order";
import { markTried, saveLastOrder, submitOrder, useOrderForm } from "../orderState";
import { pollDelay, POLL_BUDGET_MS } from "../result";
import { ORDER } from "../strings";
import type { CardFieldKind, CardFields } from "./fields";

export type PayPhase = "idle" | "starting" | "confirming" | "waiting" | "confirmed" | "slow" | "failed";

export interface PayFlowState {
  phase: PayPhase;
  error: { message: string; field: CardFieldKind | null } | null;
  trialDays: number;
  subscriptionId: string | null;
  card: SubscribeResponse["card"];
}

const IDLE: PayFlowState = { phase: "idle", error: null, trialDays: 0, subscriptionId: null, card: null };

export const usePayFlow = create<PayFlowState>()(() => ({ ...IDLE }));

export function resetPayFlow(): void {
  usePayFlow.setState({ ...IDLE }, true);
}

/** The window shows the stage (card in the middle) in these phases. */
export const onStage = (p: PayPhase): boolean => p === "starting" || p === "confirming" || p === "waiting" || p === "confirmed" || p === "slow";

let sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Tests: replace the pause between two status reads. */
export function setPollSleepForTests(fn: ((ms: number) => Promise<void>) | null): void {
  sleep = fn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}

const LIVE = new Set(["active", "trialing"]);
const DEAD = new Set(["past_due", "unpaid", "incomplete_expired", "canceled"]);

/**
 * Waits for the server's word about `subId` (the webhook writes it): asks `billing/status` with a growing pause (`pollDelay`) until the
 * subscription is live, dead, or the budget is used up.
 */
export async function waitForServer(subId: string | null, budget = POLL_BUDGET_MS): Promise<"confirmed" | "failed" | "slow"> {
  let spent = 0;
  for (let attempt = 0; ; attempt++) {
    await loadBilling();
    const sub = useBilling.getState().account?.subscription ?? null;
    if (sub && (!subId || sub.id === subId)) {
      if (LIVE.has(sub.status)) return "confirmed";
      if (DEAD.has(sub.status)) return "failed";
    }
    const pause = pollDelay(attempt);
    if (spent + pause > budget) return "slow";
    spent += pause;
    await sleep(pause);
  }
}

function fail(message: string, field: CardFieldKind | null, newOrder = false): "failed" {
  useBilling.setState({ busy: null });
  useOrderForm.setState({ phase: "idle", error: field ? null : message, ...(newOrder ? { orderId: newOrderId() } : {}) });
  usePayFlow.setState({ phase: "failed", error: { message, field } });
  return "failed";
}

/**
 * Places the order of `draft` and pays it with `fields` (Stripe Elements or the demo). Same guards as `submitOrder`: never twice at once,
 * never without both boxes, never signed out. Stripe Tax on the server side (409 `embedded_unavailable`) hands over to Checkout.
 */
export async function payInApp(draft: OrderDraft, fields: CardFields, holder: string): Promise<"confirmed" | "slow" | "failed" | "blocked" | "redirect"> {
  const f = useOrderForm.getState();
  const flow = usePayFlow.getState().phase;
  if (f.phase !== "idle" || (flow !== "idle" && flow !== "failed")) return "blocked";
  if (!f.terms || !f.immediate) {
    markTried();
    return "blocked";
  }
  if (!sessionUserId()) return "blocked";
  const d = normalizeDraft(draft);
  useOrderForm.setState({ phase: "confirming", error: null });
  usePayFlow.setState({ ...IDLE, phase: "starting" });
  useBilling.setState({ busy: "checkout" });
  let body: SubscribeRequest;
  let res: SubscribeResponse;
  try {
    const hash = await consentSetHash();
    const s = useBilling.getState();
    const promo = s.promo?.valid ? s.promo.code : undefined;
    const ref = storedReferral();
    body = {
      plan: d.plan,
      interval: d.interval,
      ...(d.plan === "team" ? { seats: d.seats } : {}),
      ...(promo ? { code: promo } : {}),
      ...(ref ? { ref } : {}),
      returnTo: currentReturnTo(),
      orderId: f.orderId,
      consents: { terms: true, immediateStart: true },
      consentHash: hash,
    };
    res = await postSubscribe(body);
  } catch (e) {
    const code = e instanceof ApiError ? e.code : "";
    if (code === "embedded_unavailable") {
      // Stripe Tax needs the billing address, which only Stripe's own page asks: hand over to Checkout (same order, same key)
      useBilling.setState({ busy: null });
      useOrderForm.setState({ phase: "idle" });
      resetPayFlow();
      return (await submitOrder(d)) === "redirect" ? "redirect" : "failed";
    }
    if (code === "already_subscribed") {
      void loadBilling();
      return fail("Du hast schon ein Abo – im Kundenportal kannst du den Tarif wechseln.", null);
    }
    if (code === "invalid_code") useBilling.setState({ promo: null });
    const message = code === "consent_outdated" ? ORDER.outdated : code === "order_changed" ? ORDER.changed : e instanceof ApiError ? errorText(e) : ORDER.failed;
    return fail(message, null, code === "order_changed");
  }
  usePayFlow.setState({ phase: "confirming", trialDays: res.trialDays, subscriptionId: res.subscriptionId ?? null });
  if (!res.clientSecret) return fail(ORDER.failed, null);
  const conf = await fields.confirm(res.kind === "setup" ? "setup" : "payment", res.clientSecret, { name: holder.trim() });
  if (!conf.ok) return fail(conf.message, conf.field);
  let subId = res.subscriptionId ?? null;
  let card: SubscribeResponse["card"] = null;
  if (res.kind === "setup") {
    try {
      const done = await postSubscribe({ ...body, setupIntent: conf.intentId });
      subId = done.subscriptionId ?? null;
      card = done.card ?? null;
    } catch (e) {
      // the card IS confirmed; the webhook makes the subscription if this answer got lost – wait for the server instead of failing
      if (!(e instanceof ApiError) || e.status < 500) return fail(e instanceof ApiError ? errorText(e) : ORDER.failed, null);
    }
  }
  saveLastOrder({ orderId: f.orderId, draft: d, staleSubId: useBilling.getState().account?.subscription?.id ?? null, at: Date.now() });
  usePayFlow.setState({ phase: "waiting", subscriptionId: subId, card });
  const verdict = await waitForServer(subId);
  useBilling.setState({ busy: null });
  if (verdict === "failed") return fail("Die Zahlung hat nicht geklappt. Es ist kein aktives Abo entstanden – versuche es mit einer anderen Karte.", "number", true);
  useOrderForm.setState({ phase: "idle" });
  usePayFlow.setState({ phase: verdict });
  return verdict;
}
