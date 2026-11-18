/**
 * Ausführbarkeit (F44), the data: the REST client's `depth` and `markPriceKlines` (URL, validation, stamp) and `loadBook` – the
 * snapshot plus the 24 h turnover on the usual route (direct, then the EU proxy), failures returned with their reason.
 *
 * `tests/fixtures/binance-depth.json`: 20 real levels per side of the public BTCUSDT book (spot, data-api.binance.vision, read
 * 2026-10-26 – the futures endpoint answers 451 from the sandbox); the futures answer has the same `bids` / `asks` strings and
 * adds `E` / `T`, which the fixture carries as documented.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkExecution, touchOf } from "@/domain/execution";
import { DEPTH_LEVELS, loadBook, type BookDeps } from "@/market/execution/book";
import { binanceRest, BINANCE_REST } from "@/market/sources/binance";
import { proxyRest } from "@/market/sources/proxy";

const fixture = (name: string): unknown => JSON.parse(readFileSync(join(__dirname, "..", "fixtures", name), "utf8"));
const DEPTH = fixture("binance-depth.json");
const TICKER = fixture("binance-ticker24hr.json");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const NOW = 1_793_007_879_000;

interface Host {
  calls: string[];
  status: number;
  depthStatus?: number;
  tickerStatus?: number;
  body?: unknown;
}
const host = (h: Host, label: string) => async (input: string): Promise<Response> => {
  const u = new URL(input, "https://x.test");
  h.calls.push(`${label}:${u.pathname.replace("/api/binance", "")}?${u.searchParams.toString()}`);
  if (u.pathname.endsWith("/depth")) return h.depthStatus ?? h.status !== 200 ? json({ code: -1121, msg: "Invalid symbol." }, h.depthStatus ?? h.status) : json(h.body ?? DEPTH);
  if (u.pathname.endsWith("/ticker/24hr")) return (h.tickerStatus ?? h.status) !== 200 ? json({ code: -1 }, h.tickerStatus ?? h.status) : json(TICKER);
  return json({}, 404);
};

function deps(direct: Host, proxy: Host, over: Partial<BookDeps> = {}): BookDeps {
  return {
    rest: () => binanceRest({ base: BINANCE_REST, fetch: host(direct, "direct"), now: () => NOW }),
    proxy: () => proxyRest({ fetch: host(proxy, "proxy"), now: () => NOW }),
    now: () => NOW,
    online: () => true,
    ...over,
  };
}

describe("the REST client", () => {
  it("depth: asks for the symbol and the level count, maps the strings to numbers, stamps the exchange's transaction time", async () => {
    const h: Host = { calls: [], status: 200 };
    const r = await binanceRest({ fetch: host(h, "d"), now: () => NOW }).depth("BTCUSDT", 100);
    expect(h.calls).toEqual(["d:/fapi/v1/depth?symbol=BTCUSDT&limit=100"]);
    expect(r.data.bids).toHaveLength(20);
    expect(r.data.bids[0]).toEqual([80563.77, 7.64151]);
    expect(r.data.asks[0]).toEqual([80563.78, 5.4517]);
    expect(r.data.time).toBe(1793007878106);
    expect(r.asOf).toBe(1793007878106);
    expect(r.receivedAt).toBe(NOW);
    expect(r.source).toBe("binance");
  });

  it("depth without E / T falls back to the time of receipt; a malformed answer is an error", async () => {
    const h: Host = { calls: [], status: 200, body: { lastUpdateId: 1, bids: [["1", "2"]], asks: [["3", "4"]] } };
    const r = await binanceRest({ fetch: host(h, "d"), now: () => NOW }).depth("BTCUSDT");
    expect(r.asOf).toBe(NOW);
    const bad: Host = { calls: [], status: 200, body: { lastUpdateId: 1, bids: [["x", "2"]], asks: [] } };
    await expect(binanceRest({ fetch: host(bad, "d"), now: () => NOW }).depth("BTCUSDT")).rejects.toMatchObject({ kind: "http_5xx" });
  });

  it("markPriceKlines: the 5-minute mark-price candles by window; the same 12-field rows as klines", async () => {
    const calls: string[] = [];
    const fetch = async (input: string): Promise<Response> => {
      calls.push(input.replace(BINANCE_REST, ""));
      return json([[1792999200000, "80000.1", "80010", "79990", "80005.5", "0", 1792999499999, "0", 0, "0", "0", "0"]]);
    };
    const r = await binanceRest({ fetch, now: () => NOW }).markPriceKlines("BTCUSDT", "5m", { limit: 1500, startTime: 1, endTime: 2 });
    expect(calls).toEqual(["/fapi/v1/markPriceKlines?symbol=BTCUSDT&interval=5m&limit=1500&startTime=1&endTime=2"]);
    expect(r.data).toEqual([expect.objectContaining({ time: 1792999200000, close: 80005.5, closeTime: 1792999499999, closed: true })]);
    expect(r.source).toBe("binance");
  });
});

describe("loadBook", () => {
  it("reads the snapshot and the turnover; the book is clean and feeds the check", async () => {
    const d: Host = { calls: [], status: 200 };
    const p: Host = { calls: [], status: 200 };
    const r = await loadBook("btcusdt", deps(d, p));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(d.calls).toEqual([`direct:/fapi/v1/depth?symbol=BTCUSDT&limit=${DEPTH_LEVELS}`, "direct:/fapi/v1/ticker/24hr?symbol=BTCUSDT"]);
    expect(p.calls).toEqual([]);
    expect(r).toMatchObject({ symbol: "BTCUSDT", asOf: 1793007878106, receivedAt: NOW, route: "direct", levels: 20, quoteVolume24h: 15435678901.23, volumeNote: null });
    const t = touchOf(r.book)!;
    expect(t.bid).toBe(80563.77);
    expect(t.ask).toBe(80563.78);
    // the spread is one tick: 0,01 ÷ 80563,775 = 0,00124 bp
    expect(t.spreadBps).toBeCloseTo(0.0012413, 6);
    // 0,05 BTC walks the first ask level (5,45 BTC) alone: no impact beyond the best price
    const c = checkExecution({ book: r.book, side: "long", qty: 0.05, assumedSlippage: 0.0005, quoteVolume24h: r.quoteVolume24h });
    expect(c.entry!.impactBps).toBe(0);
    expect(c.spread!.word).toBe("eng");
    expect(c.assumption).toBe("covered");
    // 20 BTC is more than the 20 levels carry: the check says so instead of inventing a price
    const big = checkExecution({ book: r.book, side: "long", qty: 20, assumedSlippage: 0.0005, quoteVolume24h: r.quoteVolume24h });
    expect(big.entry!.complete).toBe(false);
    expect(big.tone).toBe("bad");
  });

  it("a 451 directly is retried through the EU proxy", async () => {
    const d: Host = { calls: [], status: 451 };
    const p: Host = { calls: [], status: 200 };
    const r = await loadBook("BTCUSDT", deps(d, p));
    expect(r.ok && r.route).toBe("proxy");
    expect(d.calls).toHaveLength(1);
    expect(p.calls).toHaveLength(2);
  });

  it("blocked both ways: the reason, no numbers", async () => {
    const r = await loadBook("BTCUSDT", deps({ calls: [], status: 451 }, { calls: [], status: 451 }));
    expect(r).toEqual({ ok: false, symbol: "BTCUSDT", kind: "blocked_451", at: NOW });
  });

  it("the turnover failing does not take the book away: the volume is unknown and the note says why", async () => {
    const r = await loadBook("BTCUSDT", deps({ calls: [], status: 200, tickerStatus: 500 }, { calls: [], status: 200, tickerStatus: 500 }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.quoteVolume24h).toBeNull();
    expect(r.volumeNote).toContain("Tagesumsatz");
  });

  it("an unknown symbol, an empty symbol and being offline are named", async () => {
    expect(await loadBook("NOPE", deps({ calls: [], status: 400 }, { calls: [], status: 400 }))).toMatchObject({ ok: false, kind: "bad_symbol" });
    expect(await loadBook("  ", deps({ calls: [], status: 200 }, { calls: [], status: 200 }))).toMatchObject({ ok: false, kind: "bad_symbol" });
    const d: Host = { calls: [], status: 200 };
    expect(await loadBook("BTCUSDT", deps(d, d, { online: () => false }))).toMatchObject({ ok: false, kind: "offline" });
    expect(d.calls).toEqual([]);
  });
});
