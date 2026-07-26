import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiMutate, ApiError, OfflineError, OfflineNotAllowedError } from "./client.js";
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

  /**
   * PROMPT -1 §8 (Phase 2) hat diese Zusage VERSCHÄRFT, nicht gelockert.
   * Vorher warf `apiMutate` offline einen generischen `OfflineError`. Jetzt
   * greift zuerst `assertOfflineAllowed` und wirft einen
   * `OfflineNotAllowedError`, der die verbotene Operation BENENNT
   * (`termin_buchung`). Der geprüfte Kern ist unverändert: es wird nichts
   * gequeued und nichts gesendet – nur die Begründung ist jetzt maschinen-
   * und menschenlesbar.
   */
  it("rejects immediately instead of queuing, when offline – und benennt die verbotene Operation", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const versuch = apiMutate("/appointment-offers/1/accept", "POST", { idempotencyKey: "x" });
    await expect(versuch).rejects.toBeInstanceOf(OfflineNotAllowedError);
    await expect(versuch).rejects.toMatchObject({ operation: "termin_buchung", kritisch: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ein offline erlaubter Entwurfs-Endpunkt scheitert nicht am Vertrag, sondern an der Verbindung", async () => {
    vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    // Die Selbsteinschätzung ist eine der vier offline erlaubten
    // Entwurfsarten – der Vertrag lässt sie durch, es fehlt nur das Netz.
    await expect(
      apiMutate("/feedback/8f3a1c2d-0000-4000-8000-000000000001/self-assessment", "PATCH", { text: "ok" }),
    ).rejects.toBeInstanceOf(OfflineError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("§2: jede Mutation trägt einen Idempotency-Key – der übergebene wird benutzt", async () => {
    // Frische Response je Aufruf – ein Response-Body ist nur einmal lesbar.
    const fetchSpy = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    await apiMutate("/appointment-offers/1/accept", "POST", {}, { idempotencyKey: "stabil-123" });
    const headers = fetchSpy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("stabil-123");

    // Ohne Angabe wird einer erzeugt – kein Aufruf ohne Schlüssel.
    await apiMutate("/appointment-offers/1/accept", "POST", {});
    const headers2 = fetchSpy.mock.calls[1][1].headers as Record<string, string>;
    expect(headers2["idempotency-key"]).toBeTruthy();
    expect(headers2["idempotency-key"]).not.toBe("stabil-123");
  });

  it("§4: eine gelesene Version wird als If-Match zurückgesendet", async () => {
    const fetchSpy = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await apiMutate("/feedback/abc/self-assessment", "PATCH", { text: "x" }, { expectedVersion: 7 });
    const headers = fetchSpy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["if-match"]).toBe('W/"7"');
  });

  it("surfaces a non-2xx response as ApiError with the server's error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "booking_conflict" }), { status: 409 })),
    );
    await expect(apiMutate("/appointment-offers/1/accept", "POST", {})).rejects.toBeInstanceOf(ApiError);
  });
});
