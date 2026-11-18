/**
 * In-process fake of the Supabase project + the P09 Netlify functions for e2e (P09). Everything the browser client
 * talks to is answered here: GoTrue (`/auth/v1/*`: password, signup, magic link, reset, refresh, user, logout, TOTP
 * factors / challenge / verify), PostgREST (`/rest/v1/journal_docs` with server-stamped `rev` / `updated_at`, upsert,
 * optimistic settings update; `profiles`; `rpc/my_sessions`), Realtime (`/realtime/v1/websocket`, Phoenix v2 frames:
 * join → postgres_changes binding, heartbeat; `emit()` pushes a change like another device would) and the functions
 * under `/api/v1/*` (export, delete, backups, audit, log).
 *
 * Build the app with `VITE_SUPABASE_URL=${SUPABASE_E2E_URL}` and `VITE_SUPABASE_PUBLISHABLE_KEY=${SUPABASE_E2E_KEY}`
 * (cloud.spec.ts does so for its dev server). State lives in the test process (`MockSupabase.rows`, `.audit`, …).
 *
 * Since Paket S this file is only the Playwright ADAPTER: the handlers live in `src/showroom/mock/supabaseCore.ts` (transport-free), the very
 * same ones the Showroom's in-app interceptor uses on Netlify deploy previews.
 */
import type { Page } from "@playwright/test";
import { parseBody, type MockReq, type MockRes } from "../../../src/showroom/mock/http";
import { createSupabaseCore, type MockSupabase, type MockSupabaseOptions } from "../../../src/showroom/mock/supabaseCore";

export { fakeQrSvg, TOTP_CODE } from "../../../src/showroom/mock/supabaseCore";
export type { MockRow, MockSupabase, MockSupabaseOptions, SupabaseCore } from "../../../src/showroom/mock/supabaseCore";

export const SUPABASE_E2E_URL = "https://e2e-mock.supabase.co";
export const SUPABASE_E2E_KEY = "sb_publishable_e2e";

type PwRequest = ReturnType<import("@playwright/test").Route["request"]>;

/** A Playwright request as the transport-free `MockReq` (headers lower-cased by Playwright already). */
function toReq(req: PwRequest): MockReq {
  return { method: req.method(), url: new URL(req.url()), headers: req.headers(), body: parseBody(req.postData()) };
}

/** `MockRes` → `route.fulfill` options. */
const fulfilled = (r: MockRes) => ({ status: r.status, ...(r.headers ? { headers: r.headers } : {}), ...(r.contentType ? { contentType: r.contentType } : {}), body: r.body ?? "" });

export async function mockSupabase(page: Page, opts: MockSupabaseOptions = {}): Promise<MockSupabase> {
  const core = createSupabaseCore(opts);

  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
    const conn = core.realtime.open({ send: (frame) => ws.send(frame) });
    ws.onMessage((raw) => conn.message(String(raw)));
    ws.onClose(() => conn.close());
  });

  await page.route(`${SUPABASE_E2E_URL}/**`, async (route) => {
    const res = core.handleSupabase(toReq(route.request()));
    // the old mock answered the preflight and the 204s without a body option
    return route.fulfill(res.status === 204 ? { status: 204, ...(res.headers ? { headers: res.headers } : {}) } : fulfilled(res));
  });

  if (opts.functions !== false) {
    await page.route(/\/api\/v1\//, async (route) => route.fulfill(fulfilled(core.handleFunctions(toReq(route.request())))));
  }

  return core;
}
