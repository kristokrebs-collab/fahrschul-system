/**
 * Cloud contract (`src/cloud`, Wave 0): availability gate, `apiFetch` against the functions' error envelope.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_BASE, ApiError, apiFetch, cloudConfig, getAccessToken, installErrorReporting, isCloudAvailable, reportError, setAccessTokenProvider, useCloudUser } from "@/cloud";

const ENV = { VITE_SUPABASE_URL: "https://abc.supabase.co/", VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };

afterEach(() => setAccessTokenProvider(null));

function reply(status: number, body?: unknown, type = "application/json"): Response {
  return new Response(body === undefined ? null : typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });
}

describe("cloud availability", () => {
  it("needs both public variables; the URL is trimmed of its trailing slash", () => {
    expect(cloudConfig(ENV)).toEqual({ url: "https://abc.supabase.co", publishableKey: "sb_publishable_x" });
    expect(isCloudAvailable(ENV)).toBe(true);
    expect(isCloudAvailable({ VITE_SUPABASE_URL: ENV.VITE_SUPABASE_URL })).toBe(false);
    expect(isCloudAvailable({ VITE_SUPABASE_URL: "abc.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "k" })).toBe(false);
  });

  it("is off in the test build (no env) and stubs stay inert", async () => {
    expect(isCloudAvailable()).toBe(false);
    expect(useCloudUser()).toBeNull();
    await expect(getAccessToken()).resolves.toBeNull();
    expect(() => reportError(new Error("x"), { source: "manual" })).not.toThrow();
    expect(typeof installErrorReporting()).toBe("function");
  });
});

describe("apiFetch", () => {
  it("calls /api/v1 with JSON body, query and the bearer token", async () => {
    setAccessTokenProvider(async () => "jwt-1");
    const fetchImpl = vi.fn(async () => reply(200, { ok: true }));
    const out = await apiFetch<{ ok: boolean }>("exchange/sync", { method: "POST", body: { dryRun: true }, query: { a: 1, skip: undefined }, fetchImpl });
    expect(out).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/exchange/sync?a=1`);
    expect(init.method).toBe("POST");
    expect(init.body).toBe('{"dryRun":true}');
    const h = new Headers(init.headers);
    expect(h.get("authorization")).toBe("Bearer jwt-1");
    expect(h.get("content-type")).toBe("application/json");
  });

  it("omits the token for auth:false and when signed out", async () => {
    const fetchImpl = vi.fn(async () => reply(204));
    await expect(apiFetch("/social/shared/abc", { auth: false, fetchImpl })).resolves.toBeUndefined();
    await apiFetch("/x", { fetchImpl });
    for (const call of fetchImpl.mock.calls as unknown as [string, RequestInit][]) expect(new Headers(call[1].headers).has("authorization")).toBe(false);
  });

  it("maps the error envelope and network failures to ApiError", async () => {
    const e1 = await apiFetch("/billing/checkout", { fetchImpl: async () => reply(402, { error: { code: "plan_required", message: "Nicht im Tarif." } }) }).catch((e: unknown) => e);
    expect(e1).toBeInstanceOf(ApiError);
    expect(e1).toMatchObject({ status: 402, code: "plan_required", message: "Nicht im Tarif." });
    const e2 = await apiFetch("/x", { fetchImpl: async () => reply(502, "<html>bad gateway</html>", "text/html") }).catch((e: unknown) => e);
    expect(e2).toMatchObject({ status: 502, code: "http_502" });
    const e3 = await apiFetch("/x", { fetchImpl: async () => Promise.reject(new TypeError("Failed to fetch")) }).catch((e: unknown) => e);
    expect(e3).toMatchObject({ status: 0, code: "unavailable" });
  });
});
