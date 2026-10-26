/**
 * Client calls of the billing functions (P10) – thin, typed wrappers around `apiFetch` (`@/cloud/api`: same origin,
 * bearer token, German `ApiError`). Stripe is never called from the browser; Checkout / Portal are plain redirects to
 * the URL the server returned, and only to an https `*.stripe.com` host.
 */
import { ApiError, apiFetch } from "@/cloud/api";
import type { BillingStatus, CheckoutRequest, CheckoutResponse, CodeLookup, PortalRequest, PortalResponse, ReferralCheck, ReferralInfo } from "./contract";

export function fetchBillingStatus(opts: { invoices?: boolean; signal?: AbortSignal } = {}): Promise<BillingStatus> {
  return apiFetch<BillingStatus>("/billing/status", { query: opts.invoices ? { invoices: 1 } : undefined, signal: opts.signal });
}

export function postCheckout(body: CheckoutRequest): Promise<CheckoutResponse> {
  return apiFetch<CheckoutResponse>("/billing/checkout", { method: "POST", body });
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

/** Leaves the app for a Stripe page; anything else is refused (a compromised answer can never redirect elsewhere). */
export function redirectToStripe(url: string): void {
  if (!isStripeUrl(url)) throw new ApiError(0, "bad_redirect", "Unerwartete Weiterleitung – abgebrochen.");
  navigate(url);
}
