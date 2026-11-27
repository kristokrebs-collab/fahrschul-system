/**
 * Scanner „Wer bricht aus?“ – die Kerzenquelle (`@/market/breakout/candles`): der Weg Binance → EU-Proxy → Bybit, wer geliefert hat,
 * was bei Sperre, Offline, unbekanntem Symbol, Abbruch und Totalausfall herauskommt (ein Grund in Worten, nie Ersatzkerzen) und das
 * eigene Budget. Ohne Netz: `fetch` ist eingespeist.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { BREAKOUT_RULES } from "@/domain/breakout";
import { BREAKOUT_BUDGET, createBreakoutLoader, loadFailText } from "@/market/breakout/candles";
import { BREAKOUT_NOW, breakoutBybitBody, breakoutCandles, breakoutKlineRows } from "../e2e/mocks/breakout";

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (): Response => new Response("<!doctype html><title>SPA</title>", { status: 200, headers: { "content-type": "text/html" } });
const symbolOf = (url: string): string => new URL(url, "https://app.invalid").searchParams.get("symbol") ?? "";

type Handler = (url: string) => Response | Promise<Response>;
function setup(h: { direct?: Handler; proxy?: Handler; bybit?: Handler }, opts: { proxy?: boolean } = {}) {
  const calls: string[] = [];
  const fetch = vi.fn(async (url: string) => {
    const kind = url.startsWith("https://fapi.binance.com") ? "direct" : url.startsWith("/api/binance") ? "proxy" : url.startsWith("https://api.bybit.com") ? "bybit" : "other";
    calls.push(`${kind}:${symbolOf(url)}`);
    const fn = kind === "direct" ? h.direct : kind === "proxy" ? h.proxy : kind === "bybit" ? h.bybit : undefined;
    if (!fn) throw new TypeError("Failed to fetch");
    return fn(url);
  });
  const sleep = vi.fn(async () => {});
  const loader = createBreakoutLoader({ fetch, proxy: () => opts.proxy ?? true, now: () => BREAKOUT_NOW, sleep });
  return { loader, calls, fetch, sleep };
}
const okDirect: Handler = (url) => json(breakoutKlineRows(symbolOf(url)));
const okBybit: Handler = (url) => json(breakoutBybitBody(symbolOf(url)));
const netFail: Handler = () => {
  throw new TypeError("Failed to fetch");
};

afterEach(() => vi.unstubAllGlobals());

describe("Kerzenquelle des Ausbruch-Scanners", () => {
  it("fragt Binance direkt nach 499 5-Minuten-Kerzen und gibt sie mit Quelle und Abrufzeit zurück", async () => {
    const { loader, fetch, calls } = setup({ direct: okDirect });
    const r = await loader.load("LTCUSDT");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("binance");
    expect(r.fetchedAt).toBe(BREAKOUT_NOW);
    expect(r.candles).toHaveLength(BREAKOUT_RULES.bars);
    const want = breakoutCandles("LTCUSDT");
    expect(r.candles[0]!.time).toBe(want[0]!.time);
    expect(r.candles[400]!.close).toBeCloseTo(want[400]!.close, 8);
    // die laufende Kerze ist als nicht geschlossen markiert, alle anderen als geschlossen
    expect(r.candles[r.candles.length - 1]!.closed).toBe(false);
    expect(r.candles.slice(0, -1).every((c) => c.closed)).toBe(true);
    expect(calls).toEqual(["direct:LTCUSDT"]);
    expect(String(fetch.mock.calls[0]![0])).toBe("https://fapi.binance.com/fapi/v1/klines?symbol=LTCUSDT&interval=5m&limit=499");
  });

  it("Binance nicht erreichbar → EU-Proxy liefert; der nächste Markt fragt Binance nicht noch einmal", async () => {
    const { loader, calls } = setup({ direct: netFail, proxy: okDirect });
    const a = await loader.load("BTCUSDT");
    expect(a).toMatchObject({ ok: true, source: "proxy" });
    const b = await loader.load("ETHUSDT");
    expect(b).toMatchObject({ ok: true, source: "proxy" });
    expect(calls).toEqual(["direct:BTCUSDT", "proxy:BTCUSDT", "proxy:ETHUSDT"]);
    expect(loader.route()).toBe("proxy");
    // ein neuer Lauf beginnt wieder vorn
    loader.reset();
    expect(loader.route()).toBe("binance");
  });

  it("Proxy antwortet mit einer HTML-Seite (kein Proxy eingerichtet) → Bybit liefert und wird als Bybit ausgewiesen, aufsteigend sortiert", async () => {
    const { loader, calls } = setup({ direct: netFail, proxy: html, bybit: okBybit });
    const r = await loader.load("SUIUSDT");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.source).toBe("bybit");
    expect(calls).toEqual(["direct:SUIUSDT", "proxy:SUIUSDT", "bybit:SUIUSDT"]);
    expect(r.candles).toHaveLength(BREAKOUT_RULES.bars);
    for (let i = 1; i < r.candles.length; i++) expect(r.candles[i]!.time).toBeGreaterThan(r.candles[i - 1]!.time);
    expect(r.candles[r.candles.length - 1]!.closed).toBe(false);
    expect(r.candles[r.candles.length - 2]!.closed).toBe(true);
    expect(r.candles[10]!.volume).toBe(100);
    // danach direkt Bybit
    await loader.load("XRPUSDT");
    expect(calls.slice(3)).toEqual(["bybit:XRPUSDT"]);
  });

  it("Einzeldatei-Version: ohne Proxy geht es von Binance gleich zu Bybit", async () => {
    const { loader, calls } = setup({ direct: netFail, bybit: okBybit }, { proxy: false });
    expect(await loader.load("BNBUSDT")).toMatchObject({ ok: true, source: "bybit" });
    expect(calls).toEqual(["direct:BNBUSDT", "bybit:BNBUSDT"]);
  });

  it("fällt alles aus, gibt es einen Grund in Worten und keine Kerzen", async () => {
    const { loader, calls } = setup({ direct: netFail, proxy: netFail, bybit: netFail });
    const r = await loader.load("BTCUSDT");
    expect(r).toEqual({ ok: false, symbol: "BTCUSDT", kind: "network", message: "Die Börse ist gerade nicht erreichbar." });
    expect(calls).toEqual(["direct:BTCUSDT", "proxy:BTCUSDT", "bybit:BTCUSDT"]);
  });

  it("gebremst (429) und gesperrt (451) schalten weiter; der Grund der letzten Quelle wird genannt", async () => {
    const { loader } = setup({ direct: () => json({ code: -1003 }, 429), proxy: () => json({}, 451), bybit: () => json({}, 451) });
    expect(await loader.load("BTCUSDT")).toMatchObject({ ok: false, kind: "blocked_451", message: "Die Börse ist von hier aus gesperrt." });
  });

  it("ein unbekanntes Symbol beendet die Kette – kein Wechsel der Börse wegen eines Tippfehlers", async () => {
    const { loader, calls } = setup({ direct: () => json({ code: -1121, msg: "Invalid symbol." }, 400), proxy: okDirect, bybit: okBybit });
    expect(await loader.load("NOPEUSDT")).toMatchObject({ ok: false, kind: "bad_symbol", message: "Die Börse kennt dieses Symbol nicht." });
    expect(calls).toEqual(["direct:NOPEUSDT"]);
    expect(loader.route()).toBe("binance");
  });

  it("offline: wird gesagt, keine weitere Quelle wird gefragt", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const { loader, calls } = setup({ direct: netFail, proxy: okDirect, bybit: okBybit });
    expect(await loader.load("BTCUSDT")).toMatchObject({ ok: false, kind: "offline", message: "Du bist offline." });
    expect(calls).toEqual(["direct:BTCUSDT"]);
  });

  it("eine leere Antwort ist kein Erfolg", async () => {
    const { loader } = setup({ direct: () => json([]), proxy: () => json([]), bybit: () => json({ retCode: 0, result: { list: [] } }) });
    expect(await loader.load("BTCUSDT")).toMatchObject({ ok: false });
  });

  it("Abbruch: schon abgebrochen startet keine Anfrage; ein Abbruch unterwegs endet als „abgebrochen“", async () => {
    const { loader, calls } = setup({ direct: okDirect });
    const dead = new AbortController();
    dead.abort();
    expect(await loader.load("BTCUSDT", dead.signal)).toMatchObject({ ok: false, kind: "aborted" });
    expect(calls).toEqual([]);
    const ctrl = new AbortController();
    const slow = setup({
      direct: () =>
        new Promise<Response>((_, reject) => {
          ctrl.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }),
      proxy: okDirect,
    });
    const p = slow.loader.load("BTCUSDT", ctrl.signal);
    await vi.waitFor(() => expect(slow.calls).toHaveLength(1));
    ctrl.abort();
    expect(await p).toMatchObject({ ok: false, kind: "aborted" });
    expect(slow.calls).toEqual(["direct:BTCUSDT"]);
  });

  it("eigenes Budget: 60 Gewicht je Minute, eine Seite wiegt 2 – der 31. Abruf wartet, statt die Börse zu überrennen", async () => {
    let t = BREAKOUT_NOW;
    const fetch = vi.fn(async (url: string) => json(breakoutKlineRows(symbolOf(url), BREAKOUT_NOW, 20)));
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    const loader = createBreakoutLoader({ fetch, proxy: () => true, now: () => t, sleep });
    for (let i = 0; i < BREAKOUT_BUDGET.capacity / 2; i++) await loader.load("BTCUSDT");
    expect(sleep).not.toHaveBeenCalled();
    await loader.load("BTCUSDT");
    expect(sleep).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(BREAKOUT_BUDGET.capacity / 2 + 1);
  });

  it("jeder Grund hat einen deutschen Satz", () => {
    for (const k of ["offline", "bad_symbol", "rate_limited", "blocked_451", "timeout", "aborted", "network", "cors", "http_5xx"] as const) expect(loadFailText(k)).toMatch(/\.$/);
  });
});
