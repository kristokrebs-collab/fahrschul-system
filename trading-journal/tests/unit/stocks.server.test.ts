// @vitest-environment node
/// <reference types="node" />
/**
 * The four stock functions and their helpers (F67/F68): the Nasdaq Trader directory parser against an excerpt of the
 * real files, Yahoo's chart JSON against real answers, the RSS reader, and the functions themselves with a mocked
 * `fetch` – plan gate, rate limit, cache, per-symbol failures, and an honest error when the source blocks us.
 * Fixtures: `tests/fixtures/stocks/` (fetched 2026-10-25, see its README).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { resetGuardForTests } from "../../netlify/functions/_lib/stocks/guard";
import { buildDirectory, classify, fileTimeOf, parseDirectory, DirectoryFormatError, fetchDirectory, DirectoryFetchError } from "../../netlify/functions/_lib/stocks/nasdaq";
import { cleanLink, decodeEntities, parseRss } from "../../netlify/functions/_lib/stocks/rss";
import { barsPayload, mapPool, parseChart, prevCloseOf, quotePayload, resetYahooStateForTests, toYahooSymbol, UpstreamError, upstreamWideError } from "../../netlify/functions/_lib/stocks/yahoo";
import stockBars, { barsTesting } from "../../netlify/functions/stock-bars.mts";
import stockNews, { newsTesting } from "../../netlify/functions/stock-news.mts";
import stockQuote, { quoteTesting } from "../../netlify/functions/stock-quote.mts";
import stockSymbols, { symbolsTesting } from "../../netlify/functions/stock-symbols.mts";
import { BarsResponse, NewsResponse, QuoteResponse, SymbolsResponse } from "../../src/market/stocks/wire";

const FIX = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/stocks");
const text = (n: string): string => readFileSync(join(FIX, n), "utf8");
const json = (n: string): unknown => JSON.parse(text(n));

const ctx = { ip: "203.0.113.9" } as Parameters<typeof stockBars>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": typeof body === "string" ? "application/xml" : "application/json", ...headers } });

describe("Nasdaq Trader directory", () => {
  const dir = buildDirectory({ "nasdaqlisted.txt": text("nasdaqlisted.txt"), "otherlisted.txt": text("otherlisted.txt") });
  const symbols = dir.entries.map((e) => e.symbol);

  it("keeps common stocks, class shares and ADRs", () => {
    for (const s of ["AAPL", "TSLA", "GOOGL", "GOOG", "RIVN", "PLUG", "AACI", "BRKH", "BRK.B", "BF.A", "BF.B", "CCL", "BAC", "ABEV", "CANF", "CCM", "AACG"]) expect(symbols, s).toContain(s);
  });

  it("drops ETFs, test issues, warrants, units, preferred shares and depositary shares on a preferred", () => {
    for (const s of ["AAAP", "AAA", "SPY", "ZVZZT", "ZZZTX", "BFRGW", "BRKHU", "BRKRP", "GOOGM", "C$R"]) expect(symbols, s).not.toContain(s);
    expect(dir.counts.dropped).toEqual({ ETFs: 3, "Test-Papiere": 2, Warrants: 1, Kupon: 1, "Depositary Shares auf Vorzugsaktien": 1, Units: 1, "Kein einfaches Kürzel": 1 });
  });

  it("counts every row and sorts by symbol", () => {
    expect(dir.counts.rows).toBe(32);
    expect(dir.counts.kept).toBe(dir.entries.length);
    expect(dir.counts.kept + Object.values(dir.counts.dropped).reduce((a, b) => a + b, 0)).toBe(32);
    expect([...symbols].sort()).toEqual(symbols);
  });

  it("names the exchange and keeps the financial status of Nasdaq listings", () => {
    const by = (s: string) => dir.entries.find((e) => e.symbol === s)!;
    expect(by("AAPL")).toMatchObject({ exchange: "NASDAQ", fin: "N" });
    expect(by("AACG").fin).toBe("D");
    expect(by("BRK.B")).toMatchObject({ exchange: "NYSE", fin: null });
    expect(by("CANF").exchange).toBe("NYSE American");
    expect(by("AAPL").name).toBe("Apple Inc. - Common Stock");
  });

  it("reads the creation time of the files as New York time", () => {
    // 1023202621:31 = 10/23/2026 21:31 EDT = 2026-10-24 01:31 UTC (the server's own last-modified header said 01:31:34 GMT)
    expect(dir.fileTime).toBe(Date.UTC(2026, 9, 24, 1, 31));
    expect(fileTimeOf("File Creation Time: 0105202609:05|||")).toBe(Date.UTC(2026, 0, 5, 14, 5));
    expect(fileTimeOf("File Creation Time: nonsense")).toBeNull();
    expect(fileTimeOf("File Creation Time: 1399202625:61")).toBeNull();
  });

  it("classifies by the rules of the trader-scanner skill, rule by rule", () => {
    const row = (name: string, extra: Record<string, string> = {}) => ({ Symbol: "ABCD", "Security Name": name, "Test Issue": "N", ETF: "N", ...extra });
    expect(classify(row("AMETEK, Inc."))).toBe("keep");
    expect(classify(row("Foo Corp. - Ordinary Shares"))).toBe("keep");
    expect(classify(row("Foo Trust Shares of Beneficial Interest"))).toBe("keep");
    expect(classify(row("Foo L.P. Common Units representing limited partner interests"))).toBe("keep");
    expect(classify(row("Foo Acquisition Corp. - Rights"))).toBe("Rechte");
    expect(classify(row("Foo Acquisition Corp. - Units, each consisting of one share and one right"))).toBe("Units und Rechte");
    expect(classify(row("Foo Inc. 5.5% Notes due 2030"))).toBe("Anleihen und Notes");
    expect(classify(row("Foo Inc. Series A Preferred Stock"))).toBe("Vorzugsaktien");
    expect(classify(row("Foo Inc. Common Stock", { Symbol: "ABCD.W" }))).toBe("Units, Warrants und Rechte (Kürzel)");
    expect(classify(row("Foo Inc. Common Stock", { Symbol: "ABCDEF" }))).toBe("Kein einfaches Kürzel");
    expect(classify(row("Foo Inc. Common Stock", { ETF: "Y" }))).toBe("ETFs");
    expect(classify(row("Foo Inc. Common Stock", { "Test Issue": "Y" }))).toBe("Test-Papiere");
    expect(classify(row("Foo Inc. Common Stock", { NextShares: "Y" }))).toBe("NextShares");
  });

  it("refuses something that is not a directory", () => {
    expect(() => parseDirectory("<html>blocked</html>")).toThrow(DirectoryFormatError);
    expect(() => parseDirectory("Foo|Bar\n1|2")).toThrow(DirectoryFormatError);
  });

  it("downloads both files and names a refusal", async () => {
    const f = vi.fn(async (url: string) => reply(url.endsWith("nasdaqlisted.txt") ? text("nasdaqlisted.txt") : text("otherlisted.txt")));
    expect((await fetchDirectory(f)).counts.kept).toBe(dir.counts.kept);
    expect(f).toHaveBeenCalledTimes(2);
    await expect(fetchDirectory(async () => reply("no", 403))).rejects.toMatchObject({ reason: "blocked" });
    await expect(fetchDirectory(async () => reply("no", 429))).rejects.toMatchObject({ reason: "rate-limited" });
    await expect(fetchDirectory(async () => reply("no", 500))).rejects.toBeInstanceOf(DirectoryFetchError);
    await expect(fetchDirectory(async () => Promise.reject(new TypeError("fetch failed")))).rejects.toMatchObject({ reason: "upstream" });
  });
});

describe("Yahoo chart answers", () => {
  it("reads the 5-minute session: 78 regular candles, the 16:00 closing print dropped", () => {
    const c = parseChart(json("yahoo-aapl-5m-1d.json"), "5m", "1d");
    expect(c.candles).toHaveLength(78);
    expect(c.candles[0]!.time).toBe(1792762200 * 1000); // 9:30 ET
    expect(c.candles.at(-1)!.time).toBe(1792785300 * 1000); // 15:55 ET – the 16:00 print (volume 0) is gone
    expect(c.meta).toMatchObject({ name: "Apple Inc.", currency: "USD", exchange: "NasdaqGS", price: 347.725, volume: 39539690, marketTime: 1792785601 * 1000 });
    expect(prevCloseOf(c)).toBe(348.22);
  });

  it("reads the daily candles and derives the previous close from the day before", () => {
    const c = parseChart(json("yahoo-aapl-1d-5d.json"), "1d", "5d");
    expect(c.candles).toHaveLength(5);
    expect(c.candles.map((k) => k.close)).toEqual([342.94000244140625, 339.5, 343.989990234375, 348.2200012207031, 347.7300109863281]);
    expect(prevCloseOf(c)).toBe(348.2200012207031);
    const p = barsPayload(c);
    expect(p.bars[4]![0]).toBe(1792762200000);
    expect(p.bars[4]![5]).toBe(39496500);
    expect(p.meta.prevClose).toBe(348.2200012207031);
  });

  it("turns the daily chart into a quote with change and percent", () => {
    const q = quotePayload(parseChart(json("yahoo-aapl-1d-5d.json"), "1d", "5d"));
    expect(q).toMatchObject({ ok: true, name: "Apple Inc.", price: 347.725, prevClose: 348.2200012207031, dayHigh: 351.73, dayLow: 345.75, fiftyTwoWeekHigh: 351.73, fiftyTwoWeekLow: 243.42 });
    expect(q.change).toBeCloseTo(-0.495, 3);
    expect(q.changePct).toBeCloseTo(-0.1422, 3);
  });

  it("reads a class share written the way Yahoo spells it", () => {
    expect(toYahooSymbol("brk.b")).toBe("BRK-B");
    expect(parseChart(json("yahoo-brkb-1d-5d.json"), "1d", "5d").meta.name).toBe("Berkshire Hathaway Inc.");
  });

  it("names an unknown symbol and an empty answer", () => {
    expect(() => parseChart(json("yahoo-bad-symbol.json"), "1d", "5d")).toThrowError(expect.objectContaining({ reason: "bad-symbol" }));
    expect(() => parseChart({ chart: { result: [{ meta: {}, timestamp: [], indicators: { quote: [{}] } }], error: null } }, "1d", "5d")).toThrowError(expect.objectContaining({ reason: "no-data" }));
    expect(() => parseChart({ oops: true }, "1d", "5d")).toThrowError(expect.objectContaining({ reason: "bad-response" }));
    expect(() => parseChart({ chart: { result: null, error: { code: "Internal", description: "boom" } } }, "1d", "5d")).toThrowError(expect.objectContaining({ reason: "upstream" }));
  });

  it("drops half-empty candles, the live tick off the grid and anything outside the session", () => {
    const base = 1792762200; // Fri 2026-10-23 9:30 ET
    const doc = {
      chart: {
        result: [
          {
            meta: { symbol: "X", regularMarketPrice: 10 },
            timestamp: [base - 300, base, base + 300, base + 600, base + 607, base + 900],
            indicators: { quote: [{ open: [9, 10, 10, null, 10, 11], high: [9, 11, 11, null, 11, 12], low: [9, 9, 9, null, 9, 10], close: [9, 10.5, null, null, 10, 11.5], volume: [100, 200, 300, null, 50, 400] }] },
          },
        ],
        error: null,
      },
    };
    const c = parseChart(doc, "5m", "1d");
    // base − 300 = 9:25 (pre-market), base + 300 has no close, base + 600 is empty, base + 607 is off the grid
    expect(c.candles.map((k) => k.time / 1000)).toEqual([base, base + 900]);
  });

  it("keeps one daily candle per New York day (the later one wins)", () => {
    const t = 1792762200;
    const doc = { chart: { result: [{ meta: {}, timestamp: [t, t + 3600], indicators: { quote: [{ open: [1, 2], high: [2, 3], low: [1, 2], close: [1.5, 2.5], volume: [1, 2] }] } }], error: null } };
    const c = parseChart(doc, "1d", "5d");
    expect(c.candles).toHaveLength(1);
    expect(c.candles[0]!.close).toBe(2.5);
  });

  it("runs a pool with a deadline and a late answer for what was not started", async () => {
    let t = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 1, async (n) => (t += 5, n * 2), { deadline: 12, now: () => t, onLate: (n) => -n });
    expect(out).toEqual([2, 4, 6, -4, -5]);
  });

  it("calls an upstream-wide failure by its reason and leaves mixed results alone", () => {
    const f = (reason: "blocked" | "rate-limited" | "upstream" | "bad-symbol") => ({ ok: false, reason, message: "x" });
    expect(upstreamWideError({ A: f("rate-limited"), B: f("rate-limited") })?.status).toBe(429);
    expect(upstreamWideError({ A: f("blocked") })?.status).toBe(502);
    expect(upstreamWideError({ A: f("upstream") })?.code).toBe("stock_upstream_unavailable");
    expect(upstreamWideError({ A: f("blocked"), B: { ok: true } })).toBeNull();
    expect(upstreamWideError({ A: f("bad-symbol") })).toBeNull();
    expect(upstreamWideError({ A: f("blocked"), B: f("rate-limited") })).toBeNull();
  });
});

describe("Yahoo headlines (RSS)", () => {
  const items = parseRss(text("yahoo-rss-tsla.xml"));

  it("reads the items newest first, with the publisher taken from the link", () => {
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.publishedAt)).toEqual([...items.map((i) => i.publishedAt)].sort((a, b) => b - a));
    const fool = items.find((i) => i.publisher === "fool.com")!;
    expect(fool.title).toContain("Elon Musk Became the First Person Ever");
    expect(fool.publishedAt).toBe(Date.UTC(2026, 9, 25, 20, 20));
    expect(fool.url).toBe("https://www.fool.com/investing/2026/10/25/elon-musk-became-the-first-person-ever-confirmed-w/");
    expect(items.every((i) => !i.url.includes("tsrc"))).toBe(true);
    expect(items.find((i) => i.publisher === "finance.yahoo.com")!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("decodes entities, strips tags from summaries and refuses unusable items", () => {
    expect(decodeEntities("Tom &amp; Jerry &#39;s &#x2019; &lt;b&gt; &unknown;")).toBe("Tom & Jerry 's ’ <b> &unknown;");
    const xml = `<rss><channel>
      <item><title><![CDATA[Fine & dandy]]></title><link>https://a.example/x?.tsrc=rss&amp;id=1</link><pubDate>Sun, 25 Oct 2026 17:39:49 +0000</pubDate><description>&lt;p&gt;Hello &lt;b&gt;you&lt;/b&gt;&lt;/p&gt;</description></item>
      <item><title>No date</title><link>https://a.example/y</link></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link><pubDate>Sun, 25 Oct 2026 17:39:49 +0000</pubDate></item>
      <item><link>https://a.example/z</link><pubDate>Sun, 25 Oct 2026 17:39:49 +0000</pubDate></item>
    </channel></rss>`;
    const got = parseRss(xml);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: "Fine & dandy", url: "https://a.example/x?id=1", summary: "Hello you", publisher: "a.example" });
    expect(cleanLink("ftp://x")).toBeNull();
    expect(cleanLink("not a url")).toBeNull();
  });
});

/* ------------------------------------------------------------------ the functions */

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

const get = (fn: typeof stockBars, path: string, auth = false) => fn(new Request(`https://x.test/api/v1/stocks/${path}`, { headers: auth ? { authorization: `Bearer ${JWT}` } : {} }), ctx);

/** Yahoo mock: the fixture of the symbol asked for, a 404 for unknown ones. */
function yahooFetch(known: Record<string, string> = { AAPL: "yahoo-aapl-1d-5d.json", "BRK-B": "yahoo-brkb-1d-5d.json" }) {
  return vi.fn(async (url: string) => {
    const sym = decodeURIComponent(/chart\/([^?]+)/.exec(url)![1]!);
    const file = known[sym];
    return file ? reply(json(file)) : reply(json("yahoo-bad-symbol.json"), 404);
  });
}

beforeEach(() => {
  state = { claims: { sub: U1, role: "authenticated", aal: "aal1" }, rate: 1, plan: "pro" };
  fakeAdmin();
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  barsTesting.clear();
  quoteTesting.clear();
  newsTesting.clear();
  symbolsTesting.clear();
  resetYahooStateForTests();
  resetGuardForTests();
});
afterEach(() => {
  setSupabaseAdminForTests(null);
  barsTesting.deps = {};
  quoteTesting.deps = {};
  newsTesting.deps = {};
  symbolsTesting.fetch = undefined;
  vi.restoreAllMocks();
});

describe("stock-bars", () => {
  it("answers candles per symbol in the shared wire format, with a cache header for this browser only", async () => {
    const f = yahooFetch();
    barsTesting.deps = { fetch: f };
    const res = await get(stockBars, "bars?symbols=AAPL,BRK.B&interval=1d&range=5d");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, max-age=600");
    expect(res.headers.get("vary")).toBe("authorization");
    const body = BarsResponse.parse(await res.json());
    expect(body).toMatchObject({ source: "yahoo", interval: "1d", range: "5d" });
    expect(Object.keys(body.results)).toEqual(["AAPL", "BRK.B"]);
    expect(body.results["AAPL"]).toMatchObject({ ok: true });
    expect((body.results["AAPL"] as { bars: unknown[] }).bars).toHaveLength(5);
    expect(f.mock.calls.map((c) => c[0]).some((u) => u.includes("/chart/BRK-B?"))).toBe(true);
    expect(f.mock.calls[0]![0]).toContain("interval=1d&range=5d&includePrePost=false");
  });

  it("reports one unknown ticker on its own entry and keeps the others", async () => {
    barsTesting.deps = { fetch: yahooFetch() };
    const body = BarsResponse.parse(await (await get(stockBars, "bars?symbols=AAPL,ZZZZ&interval=1d")).json());
    expect(body.results["AAPL"]!.ok).toBe(true);
    expect(body.results["ZZZZ"]).toMatchObject({ ok: false, reason: "bad-symbol" });
  });

  it("serves the second identical request from memory (one request upstream)", async () => {
    const f = yahooFetch();
    barsTesting.deps = { fetch: f };
    await get(stockBars, "bars?symbols=AAPL&interval=1d");
    await get(stockBars, "bars?symbols=AAPL&interval=1d");
    expect(f).toHaveBeenCalledTimes(1);
    await get(stockBars, "bars?symbols=AAPL&interval=1d&range=1mo");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("answers 429 with the reason in German and stops asking Yahoo for a while", async () => {
    const f = vi.fn(async () => reply({}, 429));
    barsTesting.deps = { fetch: f };
    const res = await get(stockBars, "bars?symbols=AAPL,MSFT&interval=5m");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect((await res.json()).error).toMatchObject({ code: "stock_upstream_rate_limited", message: expect.stringContaining("Yahoo Finance begrenzt") });
    const calls = f.mock.calls.length;
    const again = await get(stockBars, "bars?symbols=NVDA&interval=5m");
    expect(again.status).toBe(429);
    expect(f.mock.calls.length).toBe(calls); // nothing new went to Yahoo
  });

  it("answers 502 when Yahoo blocks the server", async () => {
    barsTesting.deps = { fetch: vi.fn(async () => reply("Forbidden", 403)) };
    const res = await get(stockBars, "bars?symbols=AAPL&interval=1d");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "stock_upstream_blocked", message: expect.stringContaining("verweigert") });
  });

  it("falls back to the second Yahoo host on a server error", async () => {
    const f = vi.fn(async (url: string) => (url.startsWith("https://query1") ? reply("oops", 503) : reply(json("yahoo-aapl-1d-5d.json"))));
    barsTesting.deps = { fetch: f };
    const body = BarsResponse.parse(await (await get(stockBars, "bars?symbols=AAPL&interval=1d")).json());
    expect(body.results["AAPL"]!.ok).toBe(true);
    expect(f.mock.calls.map((c) => c[0].slice(0, 22))).toEqual(["https://query1.finance", "https://query2.finance"]);
  });

  it("refuses bad input before asking Yahoo", async () => {
    const f = yahooFetch();
    barsTesting.deps = { fetch: f };
    for (const [path, code] of [
      ["bars?interval=1d", "bad_symbols"],
      ["bars?symbols=AAPL&interval=2d", "bad_interval"],
      ["bars?symbols=AAPL", "bad_interval"],
      ["bars?symbols=AAPL&interval=1m&range=1y", "bad_range"],
      ["bars?symbols=AA%24PL&interval=1d", "bad_symbols"],
      ["bars?symbols=A,B,C,D,E,F,G,H,I&interval=1d", "too_many_symbols"],
    ] as const) {
      const res = await get(stockBars, path);
      expect(res.status, path).toBe(400);
      expect((await res.json()).error.code, path).toBe(code);
    }
    expect(f).not.toHaveBeenCalled();
    expect((await stockBars(new Request("https://x.test/api/v1/stocks/bars?symbols=AAPL&interval=1d", { method: "POST" }), ctx)).status).toBe(405);
  });

  it("limits requests per user, and per instance when the database is not there", async () => {
    barsTesting.deps = { fetch: yahooFetch() };
    state.rate = 241;
    expect((await get(stockBars, "bars?symbols=AAPL&interval=1d")).status).toBe(429);
    state.rate = 1;
    // no database at all: the fallback counter still stops a flood (240 per window)
    setSupabaseAdminForTests(null);
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    let last = 200;
    for (let i = 0; i < 242; i++) last = (await get(stockBars, "bars?symbols=AAPL&interval=1d")).status;
    expect(last).toBe(429);
  });
});

describe("plan gate", () => {
  const paymentsOn = () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_1";
  };
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  });

  it("is open while payments are not set up – with or without a session, even an expired one", async () => {
    barsTesting.deps = { fetch: yahooFetch() };
    expect((await get(stockBars, "bars?symbols=AAPL&interval=1d")).status).toBe(200);
    expect((await get(stockBars, "bars?symbols=AAPL&interval=1d", true)).status).toBe(200);
    state.claims = null; // expired token
    expect((await get(stockBars, "bars?symbols=AAPL&interval=1d", true)).status).toBe(200);
  });

  it("asks for a login once payments are on", async () => {
    paymentsOn();
    barsTesting.deps = { fetch: yahooFetch() };
    const res = await get(stockBars, "bars?symbols=AAPL&interval=1d");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatchObject({ code: "unauthenticated", message: "Für die Aktien-Daten bitte anmelden." });
  });

  it("answers 402 for a free plan and serves a plan that has the scanner", async () => {
    paymentsOn();
    barsTesting.deps = { fetch: yahooFetch() };
    state.plan = "free";
    const res = await get(stockBars, "bars?symbols=AAPL&interval=1d", true);
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatchObject({ code: "plan_required", details: { feature: "boxScanner" } });
    state.plan = "pro";
    expect((await get(stockBars, "bars?symbols=AAPL&interval=1d", true)).status).toBe(200);
  });
});

describe("stock-quote", () => {
  it("answers price, previous close and change", async () => {
    quoteTesting.deps = { fetch: yahooFetch() };
    const res = await get(stockQuote, "quote?symbols=AAPL,ZZZZ");
    expect(res.headers.get("cache-control")).toBe("private, max-age=15");
    const body = QuoteResponse.parse(await res.json());
    expect(body.results["AAPL"]).toMatchObject({ ok: true, price: 347.725, name: "Apple Inc." });
    expect(body.results["ZZZZ"]).toMatchObject({ ok: false, reason: "bad-symbol" });
  });

  it("asks for the daily chart of five days", async () => {
    const f = yahooFetch();
    quoteTesting.deps = { fetch: f };
    await get(stockQuote, "quote?symbols=AAPL");
    expect(f.mock.calls[0]![0]).toContain("interval=1d&range=5d");
  });

  it("takes up to 20 symbols and no more", async () => {
    quoteTesting.deps = { fetch: yahooFetch() };
    const many = Array.from({ length: 21 }, (_, i) => `A${String.fromCharCode(65 + i)}`).join(",");
    expect((await get(stockQuote, `quote?symbols=${many}`)).status).toBe(400);
  });
});

describe("stock-news", () => {
  it("answers the headlines per symbol and names a failing feed", async () => {
    const f = vi.fn(async (url: string) => (url.includes("s=TSLA") ? reply(text("yahoo-rss-tsla.xml")) : reply("nope", 404)));
    newsTesting.deps = { fetch: f };
    const res = await get(stockNews, "news?symbols=TSLA,ZZZZ");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    const body = NewsResponse.parse(await res.json());
    expect(body.results["TSLA"]).toMatchObject({ ok: true });
    expect((body.results["TSLA"] as { items: unknown[] }).items).toHaveLength(4);
    expect(body.results["ZZZZ"]).toMatchObject({ ok: false, reason: "bad-symbol" });
  });

  it("says so when Yahoo answers something that is no feed", async () => {
    newsTesting.deps = { fetch: vi.fn(async () => reply("<html>hi</html>")) };
    const res = await get(stockNews, "news?symbols=TSLA");
    expect(res.status).toBe(200);
    expect(NewsResponse.parse(await res.json()).results["TSLA"]).toMatchObject({ ok: false, reason: "bad-response" });
  });

  it("answers 429 for a limit on every feed", async () => {
    newsTesting.deps = { fetch: vi.fn(async () => reply("", 429)) };
    expect((await get(stockNews, "news?symbols=TSLA,NVDA")).status).toBe(429);
  });
});

describe("stock-symbols", () => {
  it("answers the filtered list with the counts, cached for the day", async () => {
    const f = vi.fn(async (url: string) => reply(url.endsWith("nasdaqlisted.txt") ? text("nasdaqlisted.txt") : text("otherlisted.txt")));
    symbolsTesting.fetch = f;
    const res = await get(stockSymbols, "symbols");
    expect(res.headers.get("cache-control")).toBe("private, max-age=21600");
    const body = SymbolsResponse.parse(await res.json());
    expect(body.source).toBe("nasdaqtrader");
    expect(body.fileTime).toBe(Date.UTC(2026, 9, 24, 1, 31));
    expect(body.counts.rows).toBe(32);
    expect(body.symbols.find((s) => s[0] === "AAPL")).toEqual(["AAPL", "Apple Inc. - Common Stock", "NASDAQ", "N"]);
    await get(stockSymbols, "symbols");
    expect(f).toHaveBeenCalledTimes(2); // both files once, not four times
  });

  it("names the failure instead of a made-up list", async () => {
    symbolsTesting.fetch = vi.fn(async () => reply("denied", 403));
    let res = await get(stockSymbols, "symbols");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "stock_upstream_blocked" });
    symbolsTesting.clear();
    symbolsTesting.fetch = vi.fn(async () => reply("slow down", 429));
    res = await get(stockSymbols, "symbols");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("300");
    symbolsTesting.clear();
    symbolsTesting.fetch = vi.fn(async () => reply("<html>maintenance</html>"));
    res = await get(stockSymbols, "symbols");
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("stock_upstream_format");
  });
});

describe("UpstreamError", () => {
  it("carries the reason and status", () => {
    const e = new UpstreamError("blocked", "x", 403);
    expect(e).toMatchObject({ reason: "blocked", status: 403, name: "UpstreamError" });
  });
});
