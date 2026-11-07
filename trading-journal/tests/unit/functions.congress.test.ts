// @vitest-environment node
/// <reference types="node" />
/**
 * The two Congress functions (`congress-index`, `congress-ptr`) with a mocked `fetch` that serves the REAL files of the House Clerk
 * (`tests/fixtures/congress`): the index answer, the rows of up to four reports, the cache and the stale copy, the plan gate and
 * the rate limits, the politeness towards the Clerk (own User-Agent, nothing of the user forwarded, a slot of the account-wide
 * window) and every typed failure – a Clerk that is down, slow, blocking or has changed its file is named, never papered over.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLERK_USER_AGENT, INDEX_STALE_MS, INDEX_TTL_MS, parseDocs, parseYear, setCongressForTests } from "../../netlify/functions/_lib/congress/load";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { resetGuardForTests } from "../../netlify/functions/_lib/stocks/guard";
import congressIndex from "../../netlify/functions/congress-index.mts";
import congressPtr from "../../netlify/functions/congress-ptr.mts";
import { indexPayloadOk, ptrPayloadOk, type CongressIndexPayload, type CongressPtrPayload } from "../../src/market/congress/wire";
import { clerkMock as clerk, fixture, LAST_MODIFIED, reply, SCAN_PDF, zipOf } from "./congress.harness";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof congressIndex>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const zipReply = (): Response => reply(fixture("2026FD.zip"), 200, { "content-type": "application/x-zip-compressed", "last-modified": LAST_MODIFIED });

interface State {
  claims: Record<string, unknown> | null;
  rate: number;
  plan: string;
}
let state: State;

function fakeAdmin() {
  const client = {
    auth: {
      getClaims: vi.fn(async () => (state.claims ? { data: { claims: state.claims }, error: null } : { data: null, error: { message: "bad" } })),
      admin: { mfa: { listFactors: vi.fn(async () => ({ data: { factors: [] }, error: null })) } },
    },
    rpc: vi.fn(async (fn: string) => (fn === "rate_hit" ? { data: state.rate, error: null } : { data: null, error: { code: "42883" } })),
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { plan: state.plan, plan_status: state.plan === "free" ? "none" : "active", trial_end: null }, error: null }),
      };
      return q;
    },
  };
  setSupabaseAdminForTests(client as unknown as SupabaseClient);
  return client;
}

type Fn = typeof congressIndex;
const get = (fn: Fn, path: string, auth = false) => fn(new Request(`https://x.test/api/v1/congress/${path}`, { headers: auth ? { authorization: `Bearer ${JWT}` } : {} }), ctx);
const index = async (res: Response): Promise<CongressIndexPayload> => {
  const body: unknown = await res.json();
  expect(indexPayloadOk(body)).toBe(true);
  return body as CongressIndexPayload;
};
const ptr = async (res: Response): Promise<CongressPtrPayload> => {
  const body: unknown = await res.json();
  expect(ptrPayloadOk(body)).toBe(true);
  return body as CongressPtrPayload;
};

beforeEach(() => {
  state = { claims: { sub: U1, role: "authenticated", aal: "aal1" }, rate: 1, plan: "pro" };
  fakeAdmin();
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  setCongressForTests(null);
  resetGuardForTests();
});
afterEach(() => {
  setSupabaseAdminForTests(null);
  setCongressForTests(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("congress-index", () => {
  it("answers the PTRs of the year with the stand of the file, for this browser only", async () => {
    const f = clerk();
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    const res = await get(congressIndex, "index?year=2026");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    expect(res.headers.get("vary")).toBe("authorization");
    const body = await index(res);
    expect(body).toMatchObject({ source: "house-clerk", year: 2026, cached: false, counts: { all: 1800, ptr: 437 }, sourceUrl: "https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip", fileTime: Date.parse(LAST_MODIFIED) });
    expect(body.filings).toHaveLength(437);
    expect(body.filings[0]).toMatchObject({ docId: "20035700", name: "Darrell E. Issa", filed: "2026-10-22" });
    expect(body.stale).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("serves the second request from memory (one request to the Clerk) and keeps the original read time", async () => {
    const f = clerk();
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    const first = await index(await get(congressIndex, "index?year=2026"));
    const second = await index(await get(congressIndex, "index?year=2026"));
    expect(f).toHaveBeenCalledTimes(1);
    expect(second).toMatchObject({ cached: true, fetchedAt: first.fetchedAt });
  });

  it("sends its own User-Agent and nothing of the user to the Clerk", async () => {
    const f = clerk();
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    await get(congressIndex, "index?year=2026", true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://disclosures-clerk.house.gov/public_disc/financial-pdfs/2026FD.zip");
    const h = new Headers(init.headers);
    expect(h.get("user-agent")).toBe(CLERK_USER_AGENT);
    expect(h.get("authorization")).toBeNull();
    expect(h.get("cookie")).toBeNull();
    expect(CLERK_USER_AGENT).not.toMatch(/@/);
  });

  it("names a year without an index, a Clerk that is down, slow, limiting, blocking or sending something else", async () => {
    const cases: [string, () => Response | Promise<Response>, number, string, RegExp?][] = [
      ["no index yet", () => reply("Not found", 404), 404, "congress_no_index", /noch kein Index/],
      ["server error", () => reply("Oops", 503), 502, "congress_upstream", /503/],
      ["blocked", () => reply("Forbidden", 403), 502, "congress_upstream", /403/],
      ["limit", () => reply("Slow down", 429), 429, "congress_busy"],
      ["network", () => Promise.reject(new TypeError("fetch failed")), 502, "congress_upstream", /nicht erreichbar/],
      ["timeout", () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 504, "congress_timeout", /nicht rechtzeitig/],
      ["an HTML page instead of the ZIP", () => reply("<html>maintenance</html>"), 502, "congress_format", /Aufbau/],
      ["a ZIP whose XML has another shape", () => reply(zipOf("<html/>")), 502, "congress_format"],
    ];
    for (const [name, answer, status, code, message] of cases) {
      setCongressForTests({ fetch: (async () => answer()) as unknown as typeof fetch });
      resetGuardForTests();
      const res = await get(congressIndex, "index?year=2026");
      expect([name, res.status]).toEqual([name, status]);
      const err = (await res.json()).error;
      expect([name, err.code]).toEqual([name, code]);
      if (message) expect(err.message).toMatch(message);
      if (code === "congress_busy") expect(res.headers.get("retry-after")).toBe("30");
    }
  });

  it("serves the last good copy marked stale when the Clerk fails later – for a week, then it says so", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
    let up = true;
    const f = vi.fn(async () => (up ? zipReply() : reply("down", 503)));
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    const first = await index(await get(congressIndex, "index?year=2026"));
    up = false;
    vi.setSystemTime(Date.now() + INDEX_TTL_MS + 1000);
    const res = await get(congressIndex, "index?year=2026");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=0");
    expect(await index(res)).toMatchObject({ stale: true, cached: true, fetchedAt: first.fetchedAt });
    vi.setSystemTime(Date.now() + INDEX_STALE_MS);
    expect((await get(congressIndex, "index?year=2026")).status).toBe(502);
  });

  it("refuses a year that cannot exist and a wrong method before asking the Clerk anything", async () => {
    const f = clerk();
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    for (const q of ["", "?year=abc", "?year=2012", "?year=2099", "?year=20260", "?year=2026.5"]) expect((await get(congressIndex, `index${q}`)).status).toBe(400);
    expect((await congressIndex(new Request("https://x.test/api/v1/congress/index?year=2026", { method: "POST" }), ctx)).status).toBe(405);
    expect(f).not.toHaveBeenCalled();
    expect(parseYear("2026", Date.UTC(2026, 9, 26))).toBe(2026);
    expect(parseYear("2027", Date.UTC(2026, 9, 26))).toBe(2027);
  });
});

describe("congress-ptr", () => {
  it("reads the rows of two real reports: the skill's example and the long one with a page break", async () => {
    const f = clerk();
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    const res = await get(congressPtr, "ptr?year=2026&docs=20035143,20035408");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    const body = await ptr(res);
    expect(Object.keys(body.results)).toEqual(["20035143", "20035408"]);
    const a = body.results["20035143"]!;
    expect(a.ok && a.report).toMatchObject({ docId: "20035143", year: 2026, status: "ok", filer: "Hon. Nancy Pelosi", signed: "2026-08-21", url: "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035143.pdf" });
    expect(a.ok && a.report.rows).toHaveLength(7);
    const b = body.results["20035408"]!;
    expect(b.ok && b.report.rows).toHaveLength(78);
    expect(f.mock.calls.map((c) => String(c[0])).sort()).toEqual(["https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035143.pdf", "https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/2026/20035408.pdf"]);
  });

  it("keeps a read report in memory – a posted report never changes – and shares concurrent requests", async () => {
    const f = clerk();
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    await Promise.all([get(congressPtr, "ptr?year=2026&docs=20035143"), get(congressPtr, "ptr?year=2026&docs=20035143")]);
    await get(congressPtr, "ptr?year=2026&docs=20035143");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("reports one document that cannot be fetched on its own entry and still returns the others – without keeping the failure", async () => {
    const f = clerk();
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    const res = await get(congressPtr, "ptr?year=2026&docs=20035143,20099999");
    expect(res.headers.get("cache-control")).toBe("private, max-age=0"); // an incomplete answer must not stick in the browser
    const body = await ptr(res);
    expect(body.results["20035143"]).toMatchObject({ ok: true });
    expect(body.results["20099999"]).toEqual({ ok: false, reason: "not-found", message: "Beim House Clerk gibt es zu dieser Nummer kein Dokument." });
    await get(congressPtr, "ptr?year=2026&docs=20099999");
    expect(f.mock.calls.filter((c) => String(c[0]).includes("20099999"))).toHaveLength(2);
  });

  it("names a Clerk that times out, is down or limits per document", async () => {
    const answers: Record<string, () => Response | Promise<Response>> = {
      "20000001": () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      "20000002": () => reply("down", 503),
      "20000003": () => reply("slow down", 429),
      "20000004": () => Promise.reject(new TypeError("fetch failed")),
    };
    setCongressForTests({ fetch: (async (u: string) => answers[/(\d{8})\.pdf/.exec(u)![1]!]!()) as unknown as typeof fetch });
    const body = await ptr(await get(congressPtr, "ptr?year=2026&docs=20000001,20000002,20000003,20000004"));
    expect(Object.values(body.results).map((r) => (r.ok ? "ok" : r.reason))).toEqual(["timeout", "upstream", "busy", "upstream"]);
  });

  it("calls a scan, a page with another document number, a damaged file and an HTML error page unreadable – each with its reason", async () => {
    const f = vi.fn(async (u: string) => {
      const id = /(\d{7,8})\.pdf/.exec(u)![1]!;
      if (id === "9000001") return reply(SCAN_PDF);
      if (id === "20035144") return reply(fixture("20035143.pdf")); // the Clerk's file of another number under this one
      if (id === "20035145") return reply(fixture("20035143.pdf").subarray(0, 30_000));
      return reply("<html>Service unavailable</html>");
    });
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    const body = await ptr(await get(congressPtr, "ptr?year=2026&docs=9000001,20035144,20035145,20035146"));
    const problems = Object.fromEntries(Object.entries(body.results).map(([k, r]) => [k, r.ok ? [r.report.status, r.report.problem, r.report.rows.length] : r.reason]));
    expect(problems).toEqual({ "9000001": ["unreadable", "scan", 0], "20035144": ["unreadable", "mismatch", 0], "20035145": ["unreadable", "format", 0], "20035146": ["unreadable", "format", 0] });
    const scan = body.results["9000001"]!;
    expect(scan.ok && scan.report.message).toMatch(/Papierformular/);
    // an unreadable report is an answer (the reader says why), so it is kept like any other
    await get(congressPtr, "ptr?year=2026&docs=9000001");
    expect(f.mock.calls.filter((c) => String(c[0]).includes("9000001"))).toHaveLength(1);
  });

  it("refuses bad queries before asking the Clerk anything", async () => {
    const f = clerk();
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    for (const q of ["year=2026", "year=2026&docs=", "year=2026&docs=abc", "year=2026&docs=1,2", "year=2026&docs=../../etc", "year=2026&docs=20035143,20035143,20035143,1,2,3", "docs=20035143", "year=1999&docs=20035143"]) {
      const res = await get(congressPtr, `ptr?${q}`);
      expect([q, res.status]).toEqual([q, 400]);
      expect((await res.json()).error.code).toBe("invalid_query");
    }
    expect(f).not.toHaveBeenCalled();
    expect(() => parseDocs("20035143,20034836,20035408,20034694,20034999")).toThrow(/höchstens 4/);
    expect(parseDocs("20035143, 20035143 ,20034836")).toEqual(["20035143", "20034836"]);
  });

  it("answers 'busy' for a document when the account-wide window for the Clerk is used up", async () => {
    const f = clerk();
    setCongressForTests({ fetch: f as unknown as typeof fetch });
    state.rate = 41; // under the per-user limit (240), over the account-wide upstream window (40 per 10 s)
    const body = await ptr(await get(congressPtr, "ptr?year=2026&docs=20035143"));
    expect(body.results["20035143"]).toMatchObject({ ok: false, reason: "busy" });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("guards of both functions", () => {
  const paymentsOn = () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_1";
  };
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  });

  it("is open while payments are not set up, with or without a session", async () => {
    setCongressForTests({ fetch: clerk() as unknown as typeof fetch });
    expect((await get(congressIndex, "index?year=2026")).status).toBe(200);
    expect((await get(congressPtr, "ptr?year=2026&docs=20035143", true)).status).toBe(200);
    state.claims = null; // expired token
    expect((await get(congressPtr, "ptr?year=2026&docs=20035143", true)).status).toBe(200);
  });

  it("asks for a login once payments are on, and for a plan with the scanner", async () => {
    paymentsOn();
    setCongressForTests({ fetch: clerk() as unknown as typeof fetch });
    const anon = await get(congressIndex, "index?year=2026");
    expect(anon.status).toBe(401);
    state.plan = "free";
    const free = await get(congressPtr, "ptr?year=2026&docs=20035143", true);
    expect(free.status).toBe(402);
    expect((await free.json()).error).toMatchObject({ code: "plan_required", details: { feature: "boxScanner" } });
    state.plan = "pro";
    expect((await get(congressPtr, "ptr?year=2026&docs=20035143", true)).status).toBe(200);
  });

  it("limits requests per user and per instance when the database is not there", async () => {
    setCongressForTests({ fetch: clerk() as unknown as typeof fetch });
    state.rate = 61;
    expect((await get(congressIndex, "index?year=2026")).status).toBe(429);
    state.rate = 241;
    expect((await get(congressPtr, "ptr?year=2026&docs=20035143")).status).toBe(429);
    state.rate = 1;
    setSupabaseAdminForTests(null);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    let last = 200;
    for (let i = 0; i < 62; i++) last = (await get(congressIndex, "index?year=2026")).status;
    expect(last).toBe(429);
  });
});
