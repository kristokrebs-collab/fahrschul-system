/**
 * Client calls of the billing functions (P10) – thin, typed wrappers around `apiFetch` (`@/cloud/api`: same origin,
 * bearer token, German `ApiError`). Stripe is never called from the browser; Checkout / Portal are plain redirects to
 * the URL the server returned, and only to an https `*.stripe.com` host.
 */
import { ApiError, apiFetch } from "@/cloud/api";
import type { BillingStatus, CheckoutRequest, CheckoutResponse, CodeLookup, ContractConfirmResponse, ContractDeclaration, ContractReceipt, PortalRequest, PortalResponse, ReferralCheck, ReferralInfo, SubscribeRequest, SubscribeResponse } from "./contract";

export function fetchBillingStatus(opts: { invoices?: boolean; signal?: AbortSignal } = {}): Promise<BillingStatus> {
  return apiFetch<BillingStatus>("/billing/status", { query: opts.invoices ? { invoices: 1 } : undefined, signal: opts.signal });
}

export function postCheckout(body: CheckoutRequest): Promise<CheckoutResponse> {
  return apiFetch<CheckoutResponse>("/billing/checkout", { method: "POST", body });
}

/** Paket V: the order paid in the app (Stripe Elements) – start, or (with `setupIntent`) the second step of the trial path. */
export function postSubscribe(body: SubscribeRequest): Promise<SubscribeResponse> {
  return apiFetch<SubscribeResponse>("/billing/subscribe", { method: "POST", body });
}

/** § 312k / § 356a BGB: cancel or withdraw WITHOUT a login (public route); `auth` only when signed in, so a login of that address runs it at once. */
export function postContract(body: ContractDeclaration, auth: boolean): Promise<ContractReceipt> {
  return apiFetch<ContractReceipt>("/billing/contract", { method: "POST", body, auth });
}

/** The link of the confirmation mail (public, no token needed beyond the one in the link). */
export function postContractConfirm(token: string): Promise<ContractConfirmResponse> {
  return apiFetch<ContractConfirmResponse>("/billing/contract/confirm", { method: "POST", body: { token }, auth: false });
}

export function postPortal(body: PortalRequest): Promise<PortalResponse> {
  return apiFetch<PortalResponse>("/billing/portal", { method: "POST", body });
}

export function postCode(code: string): Promise<CodeLookup> {
  return apiFetch<CodeLookup>("/billing/code", { method: "POST", body: { code } });
}

export function fetchReferral(): Promise<ReferralInfo> {
  return apiFetch<ReferralInfo>("/billing/referral");
}

export function checkReferral(code: string): Promise<ReferralCheck> {
  return apiFetch<ReferralCheck>("/billing/referral", { query: { code }, auth: false });
}

/** Only Stripe-hosted pages are followed (Checkout, Customer Portal, hosted invoices). */
export function isStripeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "stripe.com" || u.hostname.endsWith(".stripe.com"));
  } catch {
    return false;
  }
}

type Navigate = (url: string) => void;
let navigate: Navigate = (url) => window.location.assign(url);

/** Tests / the e2e harness: replace the browser navigation. */
export function setRedirectForTests(fn: Navigate | null): void {
  navigate = fn ?? ((url) => window.location.assign(url));
}

/** The Showroom (Paket S) replaces the hand-over to Stripe with its simulated hosted page – same hook, a name that says what it is for. */
export const setRedirectHandler = setRedirectForTests;

/** Leaves the app for a Stripe page; anything else is refused (a compromised answer can never redirect elsewhere). */
export function redirectToStripe(url: string): void {
  if (!isStripeUrl(url)) throw new ApiError(0, "bad_redirect", "Unerwartete Weiterleitung – abgebrochen.");
  navigate(url);
}
