/**
 * Stripe Elements as the card fields of the payment window (Paket V). Its own lazy chunk: `@stripe/stripe-js/pure` loads Stripe.js
 * (js.stripe.com) only when this module's `createStripeFields` runs – i.e. when the window opens with a publishable key – never with
 * the first screen. Three separate elements (`cardNumber`, `cardExpiry`, `cardCvc`), so each field reports its own focus (the card
 * turns when the security code gets it). Nothing we hold ever contains a card number: the elements live in Stripe's iframes; we get
 * `empty` / `complete` / `brand` / Stripe's error text, and Stripe confirms the intent itself (`confirmCardSetup` /
 * `confirmCardPayment`, with 3-D Secure in its own dialog).
 */
import { loadStripe } from "@stripe/stripe-js/pure";
import type { Stripe, StripeCardCvcElement, StripeCardExpiryElement, StripeCardNumberElement, StripeElementStyle, StripeError } from "@stripe/stripe-js";
import type { CardFieldHandlers, CardFieldKind, CardFields, CardFieldStyle, ConfirmOutcome } from "./fields";

const toStripeStyle = (s: CardFieldStyle): StripeElementStyle => ({
  base: { color: s.color, fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: "500", letterSpacing: "0.04em", "::placeholder": { color: s.placeholder }, iconColor: s.placeholder },
  invalid: { color: s.danger, iconColor: s.danger },
});

/** Which field a Stripe error belongs to (the window shows the message at that field). */
export function fieldOfError(e: Pick<StripeError, "code" | "decline_code" | "type">): CardFieldKind | null {
  const c = `${e.code ?? ""} ${e.decline_code ?? ""}`;
  if (/expir/.test(c)) return "expiry";
  if (/cvc/.test(c)) return "cvc";
  if (e.type === "card_error" || e.type === "validation_error" || /card|number|declined|funds/.test(c)) return "number";
  return null;
}

/** German words for the codes Stripe answers most (its own message is used for everything else; `locale: de`). */
export function confirmMessage(e: Pick<StripeError, "code" | "decline_code" | "message" | "type">): string {
  const c = e.decline_code ?? e.code ?? "";
  if (c === "card_declined" || c === "generic_decline" || c === "do_not_honor") return "Die Karte wurde abgelehnt. Es wurde nichts berechnet.";
  if (c === "insufficient_funds") return "Die Karte ist nicht ausreichend gedeckt. Es wurde nichts berechnet.";
  if (c === "payment_intent_authentication_failure" || c === "setup_intent_authentication_failure") return "Die Bestätigung bei deiner Bank (3-D Secure) wurde abgebrochen. Es wurde nichts berechnet.";
  if (c === "expired_card") return "Die Karte ist abgelaufen.";
  if (c === "incorrect_cvc" || c === "invalid_cvc") return "Die Prüfziffer stimmt nicht.";
  return e.message || "Die Zahlung konnte nicht abgeschlossen werden. Es wurde nichts berechnet.";
}

export async function createStripeFields(key: string): Promise<CardFields> {
  const stripe: Stripe | null = await loadStripe(key, { locale: "de" });
  if (!stripe) throw new Error("Stripe.js not available");
  const elements = stripe.elements({ locale: "de" });
  let number: StripeCardNumberElement | null = null;
  let expiry: StripeCardExpiryElement | null = null;
  let cvc: StripeCardCvcElement | null = null;
  return {
    source: "stripe",
    mount(targets: Record<CardFieldKind, HTMLElement>, on: CardFieldHandlers, style: CardFieldStyle) {
      const st = toStripeStyle(style);
      number = elements.create("cardNumber", { style: st, showIcon: false, placeholder: "1234 1234 1234 1234" });
      expiry = elements.create("cardExpiry", { style: st, placeholder: "MM / JJ" });
      cvc = elements.create("cardCvc", { style: st, placeholder: "•••" });
      number.on("change", (e) => on.change("number", { empty: e.empty, complete: e.complete, error: e.error?.message ?? null }, e.brand));
      expiry.on("change", (e) => on.change("expiry", { empty: e.empty, complete: e.complete, error: e.error?.message ?? null }));
      cvc.on("change", (e) => on.change("cvc", { empty: e.empty, complete: e.complete, error: e.error?.message ?? null }));
      number.on("focus", () => on.focus("number"));
      expiry.on("focus", () => on.focus("expiry"));
      cvc.on("focus", () => on.focus("cvc"));
      number.on("blur", () => on.blur("number"));
      expiry.on("blur", () => on.blur("expiry"));
      cvc.on("blur", () => on.blur("cvc"));
      number.mount(targets.number);
      expiry.mount(targets.expiry);
      cvc.mount(targets.cvc);
    },
    restyle(style: CardFieldStyle) {
      const st = toStripeStyle(style);
      number?.update({ style: st });
      expiry?.update({ style: st });
      cvc?.update({ style: st });
    },
    focus(kind: CardFieldKind) {
      (kind === "number" ? number : kind === "expiry" ? expiry : cvc)?.focus();
    },
    async confirm(kind, clientSecret, billing): Promise<ConfirmOutcome> {
      if (!number) return { ok: false, code: "not_ready", message: "Die Kartenfelder sind noch nicht bereit.", field: "number" };
      const payment_method = { card: number, billing_details: { name: billing.name } };
      const r = kind === "setup" ? await stripe.confirmCardSetup(clientSecret, { payment_method }) : await stripe.confirmCardPayment(clientSecret, { payment_method });
      if (r.error) return { ok: false, code: r.error.decline_code ?? r.error.code ?? r.error.type, message: confirmMessage(r.error), field: fieldOfError(r.error) };
      const id = "setupIntent" in r && r.setupIntent ? r.setupIntent.id : "paymentIntent" in r && r.paymentIntent ? r.paymentIntent.id : "";
      return { ok: true, intentId: id };
    },
    destroy() {
      number?.destroy();
      expiry?.destroy();
      cvc?.destroy();
      number = expiry = cvc = null;
    },
  };
}
