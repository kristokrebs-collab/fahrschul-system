// @vitest-environment node
/// <reference types="node" />
/**
 * SEC functions (`netlify/functions/sec-facts.mts`, `sec-filings.mts`, `_lib/sec.ts`) against a fake Supabase admin client and a
 * mocked `fetch` that serves the fixtures of `tests/fixtures/sec` (SEC's real formats). Covered: the set-up gate (no
 * `SEC_USER_AGENT` → typed 503 and NOT ONE call to SEC), the contact header, auth, plan gate, rate limits (per user and the
 * account-wide window for SEC's 10 requests per second), the request spacing, the cache, the stale copy when SEC is down,
 * the typed errors, the reduction, the earnings 8-K with its press release.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { setSecForTests, SEC_SETUP_MESSAGE } from "../../netlify/functions/_lib/sec";
import secFacts from "../../netlify/functions/sec-facts.mts";
import secFilings from "../../netlify/functions/sec-filings.mts";
import { AAPL_8K_INDEX, COMPANY_TICKERS, FIXTURES } from "../fixtures/sec";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof secFacts>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const UA = "Trading Journal Test kontakt@beispiel-betreiber.de";

interface State {
  claims: Record<string, unknown> | null;
  rate: number;
  /** answer of the account-wide SEC window (`sec-upstream`) */
  upstreamRate: number;
  plan: string;
}
let state: State;
let rateKeys: string[];

function fakeAdmin() {
  const client = {
    auth: {
      getClaims: vi.fn(async () => (state.claims ? { data: { claims: state.claims }, error: null } : { data: null, error: { message: "bad" } })),
      admin: { mfa: { listFactors: vi.fn(async () => ({ data: { factors: [] }, error: null })) } },
    },
    rpc: vi.fn(async (fn: string, args: { p_key: string }) => {
      if (fn !== "rate_hit") return { data: null, error: { code: "42883" } };
      rateKeys.push(args.p_key);
      return { data: args.p_key.startsWith("sec-upstream") ? state.upstreamRate : state.rate, error: null };
    }),
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

interface Route {
  status?: number;
  body?: unknown;
  text?: string;
  throws?: Error;
}
type Routes = Record<string, Route | (() => Route)>;
interface Call {
  url: string;
  headers: Record<string, string>;
  at: number;
}
let calls: Call[];

/** a fake SEC: the URL decides the answer; every call is recorded with the headers it carried */
function fakeSec(extra: Routes = {}): Routes {
  const routes: Routes = {
    "https://www.sec.gov/files/company_tickers.json": { body: COMPANY_TICKERS },
    "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json": { body: FIXTURES.AAPL.facts },
    "https://data.sec.gov/submissions/CIK0000320193.json": { body: FIXTURES.AAPL.submissions },
    "https://www.sec.gov/Archives/edgar/data/320193/000032019300900106/index.json": { body: AAPL_8K_INDEX },
    "https://data.sec.gov/api/xbrl/companyfacts/CIK0000999001.json": { body: FIXTURES.NWIN.facts },
    ...extra,
  };
  const fake = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()), at: Date.now() });
    const r0 = routes[url];
    const r = typeof r0 === "function" ? r0() : r0;
    if (!r) return new Response("{}", { status: 404 });
    if (r.throws) throw r.throws;
    return new Response(r.text ?? JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
  setSecForTests({ fetch: fake as unknown as typeof fetch, gapMs: 0, waitCapMs: 5 });
  return routes;
}

const get = (fn: typeof secFacts, query: string, auth = true) => fn(new Request(`https://x.test/api/v1/sec/x?${query}`, { headers: auth ? { authorization: `Bearer ${JWT}` } : {} }), ctx);

beforeEach(() => {
  state = { claims: { sub: U1, role: "authenticated", aal: "aal1" }, rate: 1, upstreamRate: 1, plan: "free" };
  rateKeys = [];
  calls = [];
  fakeAdmin();
  fakeSec();
  process.env.SEC_USER_AGENT = UA;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_PRO_MONTHLY;
});

afterEach(() => {
  setSupabaseAdminForTests(null);
  setSecForTests(null);
  delete process.env.SEC_USER_AGENT;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("set-up gate: no contact, no call", () => {
  for (const [name, fn, query] of [
    ["facts", secFacts, "ticker=AAPL"],
    ["filings", secFilings, "ticker=AAPL"],
  ] as const) {
    it(`${name}: without SEC_USER_AGENT the answer is the typed 503 and SEC is never called`, async () => {
      delete process.env.SEC_USER_AGENT;
      const res = await get(fn, query);
      expect(res.status).toBe(503);
      const err = (await res.json()).error;
      expect(err.code).toBe("sec_setup_required");
      expect(err.message).toBe(SEC_SETUP_MESSAGE);
      expect(err.message).toContain("Einrichtung nötig");
      expect(calls).toHaveLength(0);
    });
  }

  it("a placeholder or a value without a contact counts as not set", async () => {
    for (const v of ["you@example.com", "Firma Name", "a@b", "x@example.org lang genug"]) {
      process.env.SEC_USER_AGENT = v;
      const res = await get(secFacts, "ticker=AAPL");
      expect(res.status, v).toBe(503);
    }
    expect(calls).toHaveLength(0);
  });

  it("sends the contact in the User-Agent to SEC, never to the client", async () => {
    const res = await get(secFacts, "ticker=AAPL");
    expect(res.status).toBe(200);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c.headers["user-agent"]).toBe(UA);
    expect(JSON.stringify(await res.json())).not.toContain("kontakt@beispiel-betreiber.de");
  });
});

describe("guards", () => {
  it("needs a login and a GET", async () => {
    expect((await get(secFacts, "ticker=AAPL", false)).status).toBe(401);
    const post = await secFacts(new Request("https://x.test/api/v1/sec/facts?ticker=AAPL", { method: "POST", headers: { authorization: `Bearer ${JWT}` } }), ctx);
    expect(post.status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("the plan gate applies once payments are set up (free → 402, pro → ok), and is open before", async () => {
    expect((await get(secFacts, "ticker=AAPL")).status).toBe(200);
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_x";
    const denied = await get(secFacts, "ticker=AAPL");
    expect(denied.status).toBe(402);
    expect((await denied.json()).error).toMatchObject({ code: "plan_required", details: { feature: "stockAnalysis", required: "pro" } });
    state.plan = "pro";
    expect((await get(secFacts, "ticker=AAPL")).status).toBe(200);
  });

  it("limits calls per user (429 with Retry-After) and spends no SEC call then", async () => {
    state.rate = 31;
    const res = await get(secFacts, "ticker=AAPL");
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("rate_limited");
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(rateKeys).toContain(`sec-facts:${U1}`);
  });

  it("takes a slot of the account-wide SEC window before every upstream call; when it is full: typed 429 sec_busy", async () => {
    const ok = await get(secFacts, "ticker=AAPL");
    expect(ok.status).toBe(200);
    // one slot per upstream request (ticker list + company facts), none for the cached repeat
    expect(rateKeys.filter((k) => k === "sec-upstream")).toHaveLength(2);
    await get(secFacts, "ticker=AAPL");
    expect(rateKeys.filter((k) => k === "sec-upstream")).toHaveLength(2);
    setSecForTests(null);
    fakeSec();
    calls.length = 0;
    state.upstreamRate = 9;
    const busy = await get(secFacts, "ticker=AAPL");
    expect(busy.status).toBe(429);
    expect((await busy.json()).error.code).toBe("sec_busy");
    expect(calls.filter((c) => c.url.includes("companyfacts"))).toHaveLength(0);
  });

  it("spaces the requests of one instance (≥ 125 ms)", async () => {
    setSecForTests({ fetch: (async (u: RequestInfo | URL, i?: RequestInit) => {
      calls.push({ url: String(u), headers: Object.fromEntries(new Headers(i?.headers).entries()), at: Date.now() });
      return new Response(JSON.stringify(String(u).includes("tickers") ? COMPANY_TICKERS : FIXTURES.AAPL.facts), { status: 200 });
    }) as unknown as typeof fetch, gapMs: 125 });
    expect((await get(secFacts, "ticker=AAPL")).status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(120);
  });
});

describe("sec-facts", () => {
  it("answers the reduced company facts with source, stand and read time", async () => {
    const res = await get(secFacts, "ticker=aapl");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    const body = await res.json();
    expect(body).toMatchObject({ source: "sec-edgar", ticker: "AAPL", cik: "0000320193", entity: "Apple Inc.", asOf: "2026-06-27", cached: false, sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json" });
    expect(typeof body.fetchedAt).toBe("number");
    expect(body.facts["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"].unit).toBe("USD");
    expect(body.facts["us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"].rows.some((r: { val: number }) => r.val === 1)).toBe(false);
    expect(JSON.stringify(body).length).toBeLessThan(JSON.stringify(FIXTURES.AAPL.facts).length);
  });

  it("serves a repeat from memory with the ORIGINAL read time (no new SEC call)", async () => {
    const first = await (await get(secFacts, "ticker=AAPL")).json();
    const n = calls.length;
    const second = await (await get(secFacts, "ticker=AAPL")).json();
    expect(calls).toHaveLength(n);
    expect(second.cached).toBe(true);
    expect(second.fetchedAt).toBe(first.fetchedAt);
    // another ticker of the same list does not fetch the list again
    await get(secFacts, "ticker=NWIN");
    expect(calls.filter((c) => c.url.includes("company_tickers"))).toHaveLength(1);
  });

  it("finds a company by CIK and class shares with dot or dash", async () => {
    const res = await get(secFacts, "cik=320193");
    expect((await res.json()).ticker).toBe("");
    fakeSec({ "https://data.sec.gov/api/xbrl/companyfacts/CIK0001067983.json": { body: FIXTURES.NWIN.facts } });
    const b = await get(secFacts, "ticker=BRK.B");
    expect(b.status).toBe(200);
    expect((await b.json()).ticker).toBe("BRK-B");
  });

  it("typed errors: unknown ticker 404, bad query 422, no facts 404", async () => {
    const unknown = await get(secFacts, "ticker=ZZZZ");
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error).toMatchObject({ code: "sec_unknown_ticker" });
    expect((await get(secFacts, "")).status).toBe(422);
    expect((await get(secFacts, "ticker=%3Cscript%3E")).status).toBe(422);
    fakeSec({ "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json": { status: 404 } });
    const none = await get(secFacts, "ticker=AAPL");
    expect(none.status).toBe(404);
    expect((await none.json()).error.code).toBe("sec_no_facts");
    // a company whose facts hold none of the known concepts is also "no facts"
    fakeSec({ "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json": { body: { cik: 320193, entityName: "X", facts: { "us-gaap": {} } } } });
    expect((await (await get(secFacts, "ticker=AAPL")).json()).error.code).toBe("sec_no_facts");
  });

  it("maps SEC's own failures to typed errors", async () => {
    const url = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json";
    const cases: [Route, number, string][] = [
      [{ status: 429 }, 429, "sec_busy"],
      [{ status: 403 }, 429, "sec_busy"],
      [{ status: 500 }, 502, "sec_upstream"],
      [{ text: "<html>nope</html>" }, 502, "sec_invalid"],
      [{ throws: Object.assign(new Error("aborted"), { name: "AbortError" }) }, 504, "sec_timeout"],
      [{ throws: new TypeError("fetch failed") }, 502, "sec_upstream"],
    ];
    for (const [route, status, code] of cases) {
      fakeSec({ [url]: route });
      const res = await get(secFacts, "ticker=AAPL");
      expect(res.status, code).toBe(status);
      expect((await res.json()).error.code).toBe(code);
    }
  });

  it("stale-while-error: a copy older than the cache time is served when SEC fails, a copy older than a day is not", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T10:00:00Z"));
    const url = "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json";
    let broken = false;
    fakeSec({ [url]: () => (broken ? { status: 500 } : { body: FIXTURES.AAPL.facts }) });
    const first = await (await get(secFacts, "ticker=AAPL")).json();
    expect(first.stale).toBeUndefined();
    broken = true;
    vi.setSystemTime(new Date("2026-10-25T11:00:00Z"));
    const second = await get(secFacts, "ticker=AAPL");
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body).toMatchObject({ stale: true, cached: true, fetchedAt: first.fetchedAt });
    vi.setSystemTime(new Date("2026-10-27T11:00:00Z"));
    expect((await get(secFacts, "ticker=AAPL")).status).toBe(502);
  });

  it("two identical requests at once share one SEC call", async () => {
    const [a, b] = await Promise.all([get(secFacts, "ticker=AAPL"), get(secFacts, "ticker=AAPL")]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(calls.filter((c) => c.url.includes("companyfacts"))).toHaveLength(1);
  });
});

describe("sec-filings", () => {
  it("lists the newest filings and the earnings 8-K with the link to its press release", async () => {
    const res = await get(secFilings, "ticker=AAPL");
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b).toMatchObject({ source: "sec-edgar", ticker: "AAPL", cik: "0000320193", entity: "Apple Inc.", cached: false, sourceUrl: "https://data.sec.gov/submissions/CIK0000320193.json" });
    expect(b.filings).toHaveLength(10);
    expect(b.filings[0]).toMatchObject({ form: "10-Q", filed: "2026-07-31" });
    expect(b.report).toMatchObject({ form: "10-Q", filed: "2026-07-31", reportDate: "2026-06-27" });
    expect(b.earnings8k).toMatchObject({ form: "8-K", filed: "2026-07-30", items: ["2.02", "9.01"], exhibitUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019300900106/a8-kex991q3202606.htm" });
    expect(b.earningsHistory.length).toBeGreaterThan(5);
  });

  it("leaves the press release link out (not the whole answer) when the folder listing cannot be read, and caches what it got", async () => {
    fakeSec({ "https://www.sec.gov/Archives/edgar/data/320193/000032019300900106/index.json": { status: 500 } });
    const res = await get(secFilings, "ticker=AAPL");
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.earnings8k.exhibitUrl).toBeNull();
    expect(b.earnings8k.indexUrl).toContain("-index.htm");
    const n = calls.length;
    await get(secFilings, "ticker=AAPL");
    // the submissions are cached; only the failed folder listing is tried again
    expect(calls.length - n).toBe(1);
  });

  it("also needs the set-up, the login and the plan", async () => {
    expect((await get(secFilings, "ticker=AAPL", false)).status).toBe(401);
    state.rate = 61;
    expect((await get(secFilings, "ticker=AAPL")).status).toBe(429);
    expect(rateKeys).toContain(`sec-filings:${U1}`);
  });

  it("a company without filings is an empty list, not an error", async () => {
    fakeSec({ "https://data.sec.gov/submissions/CIK0000320193.json": { body: { cik: "0000320193", name: "Apple Inc.", filings: { recent: {} } } } });
    const b = await (await get(secFilings, "ticker=AAPL")).json();
    expect(b.filings).toEqual([]);
    expect(b.report).toBeNull();
    expect(b.earnings8k).toBeNull();
  });
});
