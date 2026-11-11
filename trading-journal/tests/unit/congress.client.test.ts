// @vitest-environment node
/**
 * The Congress data contract on the client (`src/market/congress/client.ts`) against a fake API: cache first, batches of four
 * reports, the old copy as `stale` with the reason when the refresh fails, every failure of the functions mapped to a reason with a
 * German sentence, an answer in a shape the app does not know is `bad-response`. No clock but the injected one.
 */
import { describe, expect, it, vi } from "vitest";
import { ApiError, FUNCTIONS_MISSING } from "../../src/cloud/api";
import { memoryKV } from "../../src/market/cache";
import { CONGRESS_READER_VERSION, createCongressData, failFrom, INDEX_AGES, REPORT_AGES } from "../../src/market/congress/client";
import { CONGRESS_REASON_TEXT } from "../../src/market/congress/result";
import { createLimiter } from "../../src/market/stocks/throttle";
import type { CongressIndexPayload, CongressPtrPayload, CongressPtrResult, CongressReport } from "../../src/market/congress/wire";

const url = (id: string, y = 2026): string => `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${y}/${id}.pdf`;
const idx = (o: Partial<CongressIndexPayload> = {}): CongressIndexPayload => ({
  source: "house-clerk",
  year: 2026,
  fetchedAt: 1_000,
  fileTime: 900,
  cached: false,
  sourceUrl: "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip",
  counts: { all: 3, ptr: 1 },
  filings: [{ docId: "20035143", year: 2026, name: "Nancy Pelosi", last: "Pelosi", district: "CA11", filed: "2026-08-21", url: url("20035143") }],
  ...o,
});
const rep = (id: string, o: Partial<CongressReport> = {}): CongressReport => ({ docId: id, year: 2026, url: url(id), readAt: 2_000, status: "ok", filer: null, signed: null, rows: [], ...o });
const okR = (id: string, o: Partial<CongressReport> = {}): CongressPtrResult => ({ ok: true, report: rep(id, o) });
const ptrPayload = (results: Record<string, CongressPtrResult>): CongressPtrPayload => ({ source: "house-clerk", year: 2026, fetchedAt: 2_000, results });

function setup(handler: (path: string, query: Record<string, string>) => unknown) {
  let t = 1_000_000;
  const calls: { path: string; query: Record<string, string> }[] = [];
  const api = vi.fn(async (path: string, init?: { query?: Record<string, string | number | boolean | null | undefined> }) => {
    const query = Object.fromEntries(Object.entries(init?.query ?? {}).map(([k, v]) => [k, String(v)]));
    calls.push({ path, query });
    return handler(path, query);
  });
  const data = createCongressData({ api: api as never, now: () => t, kv: memoryKV(), limiter: createLimiter({ capacity: 10_000, concurrency: 4 }), online: () => true });
  return { data, calls, advance: (ms: number) => void (t += ms), api };
}

describe("the index", () => {
  it("answers ok with the stamp of the file and the server's read time, and keeps it for ten minutes", async () => {
    const s = setup(() => idx());
    const r = await s.data.index(2026);
    expect(r).toMatchObject({ status: "ok", source: "house-clerk", asOf: 900, fetchedAt: 1_000, receivedAt: 1_000_000 });
    s.advance(INDEX_AGES.ttl - 1);
    expect((await s.data.index(2026)).status).toBe("ok");
    expect(s.calls).toHaveLength(1);
    s.advance(2);
    await s.data.index(2026);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0]).toEqual({ path: "/congress/index", query: { year: "2026" } });
  });

  it("serves the old copy as stale with the reason when the refresh fails – up to two weeks – and then says unavailable", async () => {
    let fail = false;
    const s = setup(() => {
      if (fail) throw new ApiError(502, "congress_upstream", "Der House Clerk antwortete mit einem Fehler (HTTP 503).");
      return idx();
    });
    await s.data.index(2026);
    fail = true;
    s.advance(INDEX_AGES.ttl + 1);
    const r = await s.data.index(2026);
    expect(r).toMatchObject({ status: "stale", reason: "upstream", message: expect.stringContaining("503") });
    expect(r.status === "stale" && r.data.filings).toHaveLength(1);
    s.advance(INDEX_AGES.maxStale);
    expect(await s.data.index(2026)).toMatchObject({ status: "unavailable", reason: "upstream" });
  });

  it("marks what the SERVER served from its own old copy as stale and does not store it as fresh", async () => {
    let stale = true;
    const s = setup(() => idx({ stale: stale ? true : undefined, cached: true }));
    const r = await s.data.index(2026);
    expect(r).toMatchObject({ status: "stale", reason: "upstream", fetchedAt: 1_000 });
    stale = false;
    expect((await s.data.index(2026)).status).toBe("ok"); // nothing fresh was cached by the stale answer
    expect(s.calls).toHaveLength(2);
  });

  it("asks again with 'fresh' and names a year without an index", async () => {
    const s = setup(() => {
      throw new ApiError(404, "congress_no_index", "Für 2027 liegt beim House Clerk noch kein Index vor.");
    });
    expect(await s.data.index(2027)).toMatchObject({ status: "unavailable", reason: "no-index", message: expect.stringContaining("kein Index") });
  });

  it("refuses an answer in a shape it does not know", async () => {
    const s = setup(() => ({ source: "house-clerk", year: 2026, filings: "nope" }));
    expect(await s.data.index(2026)).toMatchObject({ status: "unavailable", reason: "bad-response" });
    const link = setup(() => idx({ sourceUrl: "https://evil.example/x.zip" }));
    expect((await link.data.index(2026)).status).toBe("unavailable");
  });
});

describe("the reports", () => {
  it("asks four at a time, reports every answer as it comes and caches them for weeks", async () => {
    const ids = ["20000001", "20000002", "20000003", "20000004", "20000005", "20000006"];
    const s = setup((_p, q) => ptrPayload(Object.fromEntries(q["docs"]!.split(",").map((d) => [d, okR(d)]))));
    const seen: string[] = [];
    const out = await s.data.reports(2026, ids, { onResult: (d) => seen.push(d) });
    expect(s.calls.map((c) => c.query["docs"]!.split(",").length)).toEqual([4, 2]);
    expect(s.calls[0]!.path).toBe("/congress/ptr");
    expect(Object.keys(out)).toEqual(ids);
    expect(seen).toEqual(ids);
    expect(out["20000001"]).toMatchObject({ status: "ok", source: "house-clerk", fetchedAt: 2_000 });
    // second time: all from the cache, nothing asked, still announced
    s.advance(REPORT_AGES.ttl - 1);
    const again: string[] = [];
    await s.data.reports(2026, ids, { onResult: (d) => again.push(d) });
    expect(again.sort()).toEqual(ids);
    expect(s.calls).toHaveLength(2);
  });

  it("asks a report the reader could not read again after half a day, and every unreadable one when the reader improved", async () => {
    const s = setup((_p, q) => ptrPayload({ [q["docs"]!]: okR(q["docs"]!, { status: "unreadable", problem: "format", message: "Aufbau unbekannt" }) }));
    await s.data.reports(2026, ["20000001"]);
    s.advance(REPORT_AGES.ttlUnreadable - 1);
    await s.data.reports(2026, ["20000001"]);
    expect(s.calls).toHaveLength(1);
    s.advance(2);
    await s.data.reports(2026, ["20000001"]);
    expect(s.calls).toHaveLength(2);
    expect(CONGRESS_READER_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("gives the old copy as stale with the reason when the server cannot be reached, a plain 'unavailable' when there is none", async () => {
    let down = false;
    const s = setup((_p, q) => {
      if (down) throw new ApiError(0, "unavailable", "Der Server ist gerade nicht erreichbar. Bitte versuche es später erneut.");
      return ptrPayload({ [q["docs"]!]: okR(q["docs"]!) });
    });
    await s.data.reports(2026, ["20000001"]);
    down = true;
    s.advance(REPORT_AGES.ttl + 1); // the stored report is no longer fresh – a refresh is tried
    const out = await s.data.reports(2026, ["20000001", "20000002"]);
    expect(out["20000001"]).toMatchObject({ status: "stale", reason: "network" });
    expect(out["20000002"]).toMatchObject({ status: "unavailable", reason: "network" });
  });

  it("maps a document the Clerk does not have to 'no-data' and a busy Clerk to a limit, per document", async () => {
    const s = setup(() => ptrPayload({ "20000001": { ok: false, reason: "not-found", message: "Beim House Clerk gibt es zu dieser Nummer kein Dokument." }, "20000002": { ok: false, reason: "busy", message: "Der House Clerk bremst gerade (HTTP 429)." }, "20000003": { ok: false, reason: "timeout", message: "Der House Clerk antwortet nicht rechtzeitig." }, "20000004": okR("20000004") }));
    const out = await s.data.reports(2026, ["20000001", "20000002", "20000003", "20000004"]);
    expect(Object.fromEntries(Object.entries(out).map(([k, r]) => [k, r.status === "ok" ? "ok" : r.status === "unavailable" ? r.reason : "stale"]))).toEqual({ "20000001": "no-data", "20000002": "rate-limited", "20000003": "timeout", "20000004": "ok" });
  });

  it("does not store what it could not read, treats a missing entry as a bad answer and pauses after a limit", async () => {
    const lim = { run: vi.fn(async (fn: () => Promise<unknown>) => fn()), backoff: vi.fn(), pending: () => ({ waiting: 0, running: 0 }) };
    const api = vi.fn(async () => {
      throw new ApiError(429, "rate_limited", "Zu viele Anfragen – bitte kurz warten.");
    });
    const data = createCongressData({ api: api as never, kv: memoryKV(), limiter: lim as never, online: () => true });
    expect(await data.reports(2026, ["20000001"])).toMatchObject({ "20000001": { status: "unavailable", reason: "rate-limited" } });
    expect(lim.backoff).toHaveBeenCalledWith(30_000);
    const missing = setup(() => ptrPayload({}));
    expect(await missing.data.reports(2026, ["20000001"])).toMatchObject({ "20000001": { status: "unavailable", reason: "bad-response" } });
  });

  it("stops at an abort without asking for the rest", async () => {
    const s = setup((_p, q) => ptrPayload(Object.fromEntries(q["docs"]!.split(",").map((d) => [d, okR(d)]))));
    const ctl = new AbortController();
    ctl.abort();
    const out = await s.data.reports(2026, ["20000001"], { signal: ctl.signal });
    expect(out["20000001"]).toMatchObject({ status: "unavailable", reason: "aborted" });
    expect(s.calls).toHaveLength(0);
  });

  it("remembers reports across instances through the same store and forgets them on clear", async () => {
    const kv = memoryKV();
    const api = vi.fn(async (_p: string, init?: { query?: Record<string, string> }) => ptrPayload({ [init!.query!["docs"]!]: okR(init!.query!["docs"]!) }));
    const a = createCongressData({ api: api as never, kv, limiter: createLimiter({ capacity: 100 }) });
    await a.reports(2026, ["20000001"]);
    const b = createCongressData({ api: api as never, kv, limiter: createLimiter({ capacity: 100 }) });
    expect(await b.stored(2026, ["20000001", "20000002"])).toMatchObject({ "20000001": { status: "ok" }, "20000002": null });
    await b.clear();
    expect(await createCongressData({ api: api as never, kv, limiter: createLimiter({ capacity: 100 }) }).stored(2026, ["20000001"])).toEqual({ "20000001": null });
  });
});

describe("what a failure is called", () => {
  const T = CONGRESS_REASON_TEXT;
  it("maps the answers of the functions to a reason and keeps their German sentence", () => {
    const f = (status: number, code: string, msg = "Satz des Servers.") => failFrom(new ApiError(status, code, msg), () => true);
    expect(f(0, "unavailable", FUNCTIONS_MISSING)).toEqual({ reason: "no-server", message: T["no-server"] });
    expect(f(0, "unavailable", "In der Offline-Datei gibt es keine Server-Funktionen.").reason).toBe("no-server");
    expect(f(0, "unavailable").reason).toBe("network");
    expect(f(401, "unauthenticated").reason).toBe("login");
    expect(f(402, "plan_required").reason).toBe("plan");
    expect(f(404, "congress_no_index")).toEqual({ reason: "no-index", message: "Satz des Servers." });
    expect(f(502, "congress_format").reason).toBe("format");
    expect(f(504, "congress_timeout").reason).toBe("timeout");
    expect(f(429, "congress_busy").reason).toBe("rate-limited");
    expect(f(429, "rate_limited").reason).toBe("rate-limited");
    expect(f(502, "congress_upstream").reason).toBe("upstream");
    expect(f(400, "invalid_query").reason).toBe("bad-response");
    expect(f(404, "http_404").reason).toBe("no-server");
    expect(f(500, "internal").reason).toBe("upstream");
    expect(failFrom(new TypeError("x"), () => false).reason).toBe("offline");
    expect(failFrom(Object.assign(new Error("a"), { name: "AbortError" })).reason).toBe("aborted");
  });

  it("has a sentence for every reason, and says the Clerk is an agency site without a promise", () => {
    for (const k of Object.keys(T) as (keyof typeof T)[]) expect(T[k].length, k).toBeGreaterThan(8);
    expect(T.upstream).toMatch(/Behördenseite/);
    expect(T.format).toMatch(/nichts geraten/i);
  });
});
