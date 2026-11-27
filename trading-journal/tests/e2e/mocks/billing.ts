/**
 * In-process fake of the P10 billing functions + the Stripe-hosted pages for e2e (additive to `mocks/supabase.ts`;
 * register it AFTER `mockSupabase` – Playwright runs the newest route first, other `/api/v1/*` paths fall back).
 *
 * Since Paket S this file is only the Playwright ADAPTER: the handlers and the state live in `src/showroom/mock/billingCore.ts`
 * (transport-free; the Showroom's in-app interceptor uses the same ones on Netlify deploy previews).
 *
 * - `/api/v1/billing/status|checkout|portal|code|referral` answer from `MockBilling.state` (the plan of the signed-in
 *   mock user is never taken from the client – a checkout only becomes a plan when the fake Stripe page "pays");
 * - `https://checkout.stripe.com/**` is a tiny fake Checkout page: "Jetzt abonnieren" completes the subscription (as
 *   the webhook would) and redirects to the `success_url`; "Zurück" goes to the `cancel_url`;
 * - `https://billing.stripe.com/**` is a fake Customer Portal with "Zurück zum Journal" (the `return_url`).
 */
import type { Page } from "@playwright/test";
import { parseBody } from "../../../src/showroom/mock/http";
import { createBillingCore, type MockBilling, type MockBillingOptions } from "../../../src/showroom/mock/billingCore";

export { mockSubscription, type MockBilling, type MockBillingOptions } from "../../../src/showroom/mock/billingCore";

export async function mockBilling(page: Page, opts: MockBillingOptions = {}): Promise<MockBilling> {
  const core = createBillingCore(opts);

  await page.route(/\/api\/v1\/billing\//, async (route) => {
    const req = route.request();
    const res = core.handle({ method: req.method(), url: new URL(req.url()), headers: req.headers(), body: parseBody(req.postData()) });
    return route.fulfill({ status: res.status, contentType: res.contentType ?? "application/json", body: res.body ?? "" });
  });

  // fake Stripe Checkout
  await page.route(/^https:\/\/checkout\.stripe\.com\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/__e2e/complete") {
      const done = core.completeCheckout();
      if (done) return route.fulfill({ status: 302, headers: { location: done.location } });
    }
    if (url.pathname === "/__e2e/cancel") {
      const done = core.cancelCheckout();
      if (done) return route.fulfill({ status: 302, headers: { location: done.location } });
    }
    const plan = core.pendingOrder()?.plan ?? "pro";
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Stripe Checkout (Test)</title></head><body style="background:#fff;font-family:sans-serif;padding:40px"><h1>Stripe Checkout (Test)</h1><p data-plan="${plan}">Trade Journal ${plan}</p><a href="https://checkout.stripe.com/__e2e/complete">Jetzt abonnieren</a> · <a href="https://checkout.stripe.com/__e2e/cancel">Zurück</a></body></html>`,
    });
  });

  // fake Customer Portal
  await page.route(/^https:\/\/billing\.stripe\.com\//, async (route) => {
    const url = new URL(route.request().url());
    const back = url.searchParams.get("return") ?? "/";
    return route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Stripe Kundenportal (Test)</title></head><body style="background:#fff;font-family:sans-serif;padding:40px"><h1>Kundenportal (Test)</h1><p data-flow="${url.searchParams.get("flow") ?? ""}">Flow</p><a href="${back}">Zurück zum Journal</a></body></html>`,
    });
  });

  return core;
}
