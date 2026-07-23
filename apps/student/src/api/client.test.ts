import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiMutate, ApiError, OfflineError } from "./client.js";
import { clearCache, writeCache } from "./cache.js";

describe("apiGet – offline read fallback", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    clearCache();
  });

  it("caches a successful GET response for later offline reads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ hello: "world" }), { status: 200 })),
    );
    const res = await apiGet<{ hello: string }>("/hello");
    expect(res.fromCache).toBe(false);
    expect(res.data.hello).toBe("world");
  });

  it("falls back to the cache when navigator.onLine is false, without a network call", async () => {
    writeCache("/cached-path", { value: 42 });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);

    const res = await apiGet<{ value: number }>("/cached-path");
    expect(res.fromCache).toBe(true);
    expect(res.data.value).toBe(42);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws OfflineError when offline and nothing was ever cached", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    await expect(apiGet("/never-fetched")).rejects.toBeInstanceOf(OfflineError);
  });
});

describe("apiMutate – NEVER queues offline writes (non-negotiable)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects immediately with OfflineError instead of queuing, when offline", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(apiMutate("/appointment-offers/1/accept", "POST", { idempotencyKey: "x" })).rejects.toBeInstanceOf(
      OfflineError,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a non-2xx response as ApiError with the server's error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "booking_conflict" }), { status: 409 })),
    );
    await expect(apiMutate("/appointment-offers/1/accept", "POST", {})).rejects.toBeInstanceOf(ApiError);
  });
});
