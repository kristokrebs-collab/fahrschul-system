/**
 * State of the order sheet and the order itself (B4) – small zustand store + `submitOrder`, in the lazy chunk.
 *
 * - The two consent boxes are NEVER pre-ticked and are forgotten every time the sheet opens for a new order: the person
 *   ticks them for THIS order. They live in memory only; the evidence is the server's (`public.consents`).
 * - `orderId` is made once per sheet opening: the idempotency key. A double click, a retry after a lost answer and a second
 *   tab with the same sheet all carry the same key – Stripe returns the same Checkout Session, the consent rows are unique per
 *   order. The browser side also refuses a second click while `phase !== "idle"`.
 * - `submitOrder` is the ONLY place that places an order: consents + hash + order id → `POST /billing/checkout` → redirect to
 *   the `*.stripe.com` URL it returns. Before it leaves it notes the order (`lastOrder`) so the result page can say which order it
 *   is and which subscription was there before (a leftover "canceled" never reads as a failed payment).
 */
import { create } from "zustand";
import { ApiError } from "@/cloud/api";
import { consentSetHash, newOrderId } from "@/legal/consentRecord";
import { readJson, removeKey, storageKey, writeJson } from "@/store/storage";
import { pushToast } from "@/store/uiStore";
import { postCheckout, redirectToStripe } from "../api";
import { currentReturnTo, storedReferral } from "../url";
import { CLOSED_CONFIG, errorText, holdBusyForRedirect, loadBilling, persist, sessionUserId, useBilling } from "../store";
import { normalizeDraft, type OrderDraft } from "./order";
import { ORDER } from "./strings";

export type OrderPhase = "idle" | "confirming" | "redirecting";

export interface OrderFormState {
  orderId: string;
  terms: boolean;
  immediate: boolean;
  /** The person tried to order with a box open: the boxes show their message. */
  tried: boolean;
  phase: OrderPhase;
  error: string | null;
}

const FRESH = (): OrderFormState => ({ orderId: newOrderId(), terms: false, immediate: false, tried: false, phase: "idle", error: null });

export const useOrderForm = create<OrderFormState>()(() => FRESH());

/** A new order: new key, both boxes open, nothing in flight. */
export function resetOrderForm(): void {
  useOrderForm.setState(FRESH(), true);
}

export const setTerms = (v: boolean): void => useOrderForm.setState({ terms: v });
export const setImmediate = (v: boolean): void => useOrderForm.setState({ immediate: v });
export const markTried = (): void => useOrderForm.setState({ tried: true });

/* ------------------------------------------------------------------ the last order (sessionStorage, this tab) */

export interface LastOrder {
  orderId: string;
  draft: OrderDraft;
  /** The subscription that existed when the order was placed (an older, ended one), else null. */
  staleSubId: string | null;
  at: number;
}

const LAST_KEY = storageKey("last-order");
const LAST_TTL_MS = 6 * 3_600_000;

export function saveLastOrder(o: LastOrder): void {
  try {
    sessionStorage.setItem(LAST_KEY, JSON.stringify(o));
  } catch {
    writeJson(LAST_KEY, o);
  }
}

export function readLastOrder(now = Date.now()): LastOrder | null {
  let raw: unknown = null;
  try {
    const s = sessionStorage.getItem(LAST_KEY);
    raw = s ? JSON.parse(s) : readJson<unknown>(LAST_KEY, null);
  } catch {
    raw = readJson<unknown>(LAST_KEY, null);
  }
  const o = raw as Partial<LastOrder> | null;
  if (!o || typeof o !== "object" || typeof o.orderId !== "string" || typeof o.at !== "number" || now - o.at > LAST_TTL_MS || !o.draft) return null;
  const d = o.draft as Partial<OrderDraft>;
  if ((d.plan !== "pro" && d.plan !== "premium" && d.plan !== "team") || (d.interval !== "month" && d.interval !== "year")) return null;
  return { orderId: o.orderId, draft: normalizeDraft({ plan: d.plan, interval: d.interval, seats: Number(d.seats) || 1 }), staleSubId: typeof o.staleSubId === "string" ? o.staleSubId : null, at: o.at };
}

export function clearLastOrder(): void {
  try {
    sessionStorage.removeItem(LAST_KEY);
  } catch {
    /* nothing to remove */
  }
  removeKey(LAST_KEY);
}

/* ------------------------------------------------------------------ placing the order */

/**
 * Places the order of `draft` with the two ticked boxes. Never runs twice at once (`phase`), never without both boxes, never
 * signed out. Resolves when the browser is on its way to Stripe (or the order failed – then `error` says why and the button
 * is free again). Returns `"redirect"` / `"blocked"` / `"failed"` for the caller and the tests.
 */
export async function submitOrder(draft: OrderDraft): Promise<"redirect" | "blocked" | "failed"> {
  const f = useOrderForm.getState();
  if (f.phase !== "idle") return "blocked";
  if (!f.terms || !f.immediate) {
    markTried();
    return "blocked";
  }
  if (!sessionUserId()) return "blocked";
  const d = normalizeDraft(draft);
  useOrderForm.setState({ phase: "confirming", error: null });
  useBilling.setState({ busy: "checkout" });
  try {
    const hash = await consentSetHash();
    const s = useBilling.getState();
    const promo = s.promo?.valid ? s.promo.code : undefined;
    const ref = storedReferral();
    const res = await postCheckout({
      plan: d.plan,
      interval: d.interval,
      ...(d.plan === "team" ? { seats: d.seats } : {}),
      ...(promo ? { code: promo } : {}),
      ...(ref ? { ref } : {}),
      returnTo: currentReturnTo(),
      orderId: f.orderId,
      consents: { terms: true, immediateStart: true },
      consentHash: hash,
    });
    saveLastOrder({ orderId: f.orderId, draft: d, staleSubId: s.account?.subscription?.id ?? null, at: Date.now() });
    useOrderForm.setState({ phase: "redirecting" });
    holdBusyForRedirect();
    redirectToStripe(res.url);
    return "redirect";
  } catch (e) {
    useBilling.setState({ busy: null });
    const code = e instanceof ApiError ? e.code : "";
    if (code === "already_subscribed") {
      pushToast({ kind: "info", title: "Du hast schon ein Abo – im Kundenportal kannst du den Tarif wechseln." });
      useBilling.setState((st) => ({ order: { ...st.order, open: false } }));
      await loadBilling();
      useOrderForm.setState({ phase: "idle" });
      return "failed";
    }
    if (e instanceof ApiError && e.status === 503 && (code === "billing_unavailable" || code === "purchase_closed")) {
      const config = { ...CLOSED_CONFIG("stripe_missing"), ...(code === "purchase_closed" ? { enabled: true, purchaseOpen: false, purchaseBlockedBy: ["legal" as const] } : {}) };
      useBilling.setState({ config });
      persist(config, useBilling.getState().account, sessionUserId());
    }
    if (code === "invalid_code") useBilling.setState({ promo: null });
    const message = code === "consent_outdated" ? ORDER.outdated : code === "order_changed" ? ORDER.changed : e instanceof ApiError ? errorText(e) : ORDER.failed;
    // a new key for the next attempt only when the server refused THIS one for good (changed details); a lost answer keeps the key
    useOrderForm.setState({ phase: "idle", error: message, ...(code === "order_changed" ? { orderId: newOrderId() } : {}) });
    return "failed";
  }
}
