/**
 * Client contract of the SEC functions (`src/market/sec/client.ts`): the stamp (`source`, `asOf`, `receivedAt`), the typed errors
 * with the server's German message, the small cache, and the honest "no server here" case.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearSecCache, fetchSecFacts, fetchSecFilings, SecError, toSecError, type SecErrorKind } from "@/market/sec";
import { factsPayload, filingsPayload } from "../fixtures/sec";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const err = (status: number, code: string, message: string) => json({ error: { code, message } }, status);

function fake(responder: (url: URL) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => responder(new URL(String(input), "https://x.test")));
}

beforeEach(() => clearSecCache());

describe("stamped results", () => {
  it("facts: source, asOf (the newest period), receivedAt (the server's read time), cached and stale flags", async () => {
    const f = fake(() => json(factsPayload("AAPL")));
    const r = await fetchSecFacts("aapl", { fetchImpl: f as unknown as typeof fetch });
    expect(r).toMatchObject({ source: "sec-edgar", sourceLabel: "SEC EDGAR (XBRL)", sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json", asOf: Date.UTC(2026, 5, 27), receivedAt: Date.UTC(2026, 9, 25, 12), cached: false, stale: false });
    expect(r.data.entity).toBe("Apple Inc.");
    const url = new URL(String(f.mock.calls[0]![0]), "https://x.test");
    expect(url.pathname).toBe("/api/v1/sec/facts");
    expect(url.searchParams.get("ticker")).toBe("AAPL");
  });

  it("filings: asOf is the newest filing, the stale flag is carried", async () => {
    const f = fake(() => json(filingsPayload("AAPL", { stale: true })));
    const r = await fetchSecFilings("AAPL", { fetchImpl: f as unknown as typeof fetch });
    expect(r.asOf).toBe(Date.UTC(2026, 6, 31));
    expect(r.stale).toBe(true);
    expect(r.data.earnings8k!.exhibitUrl).toContain("a8-kex991q3202606.htm");
  });

  it("asks once for the same company within five minutes, shares an in-flight call, and `fresh` asks again", async () => {
    const f = fake((u) => json(u.pathname.endsWith("filings") ? filingsPayload("AAPL") : factsPayload("AAPL")));
    const impl = f as unknown as typeof fetch;
    await Promise.all([fetchSecFacts("AAPL", { fetchImpl: impl }), fetchSecFacts("AAPL", { fetchImpl: impl })]);
    expect(f).toHaveBeenCalledTimes(1);
    await fetchSecFacts("AAPL", { fetchImpl: impl });
    expect(f).toHaveBeenCalledTimes(1);
    await fetchSecFacts("AAPL", { fetchImpl: impl, fresh: true });
    expect(f).toHaveBeenCalledTimes(2);
    await fetchSecFacts("NWIN", { fetchImpl: impl });
    expect(f).toHaveBeenCalledTimes(3);
    await fetchSecFilings("AAPL", { fetchImpl: impl });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("does not cache a failure", async () => {
    let n = 0;
    const f = fake(() => (n++ === 0 ? err(502, "sec_upstream", "Die SEC ist gerade nicht erreichbar.") : json(factsPayload("AAPL"))));
    await expect(fetchSecFacts("AAPL", { fetchImpl: f as unknown as typeof fetch })).rejects.toBeInstanceOf(SecError);
    await expect(fetchSecFacts("AAPL", { fetchImpl: f as unknown as typeof fetch })).resolves.toBeTruthy();
  });
});

describe("typed errors", () => {
  const cases: [number, string, SecErrorKind][] = [
    [503, "sec_setup_required", "setup_required"],
    [404, "sec_unknown_ticker", "unknown_ticker"],
    [404, "sec_no_facts", "no_facts"],
    [429, "sec_busy", "busy"],
    [504, "sec_timeout", "timeout"],
    [502, "sec_upstream", "upstream"],
    [502, "sec_invalid", "invalid"],
    [402, "plan_required", "plan_required"],
    [401, "unauthenticated", "unauthenticated"],
    [401, "invalid_token", "unauthenticated"],
    [429, "rate_limited", "rate_limited"],
    [422, "invalid_query", "invalid_query"],
  ];
  for (const [status, code, kind] of cases) {
    it(`${code} → ${kind}, with the server's German message`, async () => {
      const f = fake(() => err(status, code, `Meldung für ${code}`));
      const e = (await fetchSecFacts("AAPL", { fetchImpl: f as unknown as typeof fetch }).catch((x: unknown) => x)) as SecError;
      expect(e).toBeInstanceOf(SecError);
      expect(e.kind).toBe(kind);
      expect(e.status).toBe(status);
      expect(e.code).toBe(code);
      expect(e.message).toBe(`Meldung für ${code}`);
    });
  }

  it("the set-up error carries the 'Einrichtung nötig' text of the server", async () => {
    const f = fake(() => err(503, "sec_setup_required", "Einrichtung nötig: Die SEC verlangt einen Kontakt im User-Agent."));
    const e = (await fetchSecFilings("AAPL", { fetchImpl: f as unknown as typeof fetch }).catch((x: unknown) => x)) as SecError;
    expect(e.kind).toBe("setup_required");
    expect(e.message).toContain("Einrichtung nötig");
  });

  it("'unavailable' where there is no server: a network failure and the app page that a host without functions answers", async () => {
    const down = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    const a = (await fetchSecFacts("AAPL", { fetchImpl: down }).catch((x: unknown) => x)) as SecError;
    expect(a.kind).toBe("unavailable");
    const spa = (async () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const b = (await fetchSecFacts("AAPL", { fetchImpl: spa }).catch((x: unknown) => x)) as SecError;
    expect(b.kind).toBe("unavailable");
    expect(b.message).toContain("Server-Funktionen");
  });

  it("refuses an answer in the wrong shape and a ticker that cannot be one", async () => {
    const wrong = fake(() => json({ source: "other", facts: {} }));
    const a = (await fetchSecFacts("AAPL", { fetchImpl: wrong as unknown as typeof fetch }).catch((x: unknown) => x)) as SecError;
    expect(a.kind).toBe("invalid");
    // a link that does not point to sec.gov refuses the whole answer
    const evil = fake(() => json({ ...filingsPayload("AAPL"), filings: [{ ...filingsPayload("AAPL").filings[0]!, url: "javascript:alert(1)" }] }));
    const c = (await fetchSecFilings("AAPL", { fetchImpl: evil as unknown as typeof fetch }).catch((x: unknown) => x)) as SecError;
    expect(c.kind).toBe("invalid");
    const none = fake(() => json({}));
    const b = (await fetchSecFacts("../x", { fetchImpl: none as unknown as typeof fetch }).catch((x: unknown) => x)) as SecError;
    expect(b.kind).toBe("invalid_query");
    expect(none).not.toHaveBeenCalled();
  });

  it("passes an abort through untouched and wraps anything else", () => {
    const abort = new DOMException("x", "AbortError");
    expect(toSecError(abort)).toBe(abort);
    expect((toSecError("boom") as SecError).kind).toBe("unavailable");
    const own = new SecError("busy", "m");
    expect(toSecError(own)).toBe(own);
  });
});
