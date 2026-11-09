/**
 * Galaxy Tab, Samsung Internet, 2026-10-08 13:30 UTC (commit d398816): the price stood at 82.446,4 with the red pill
 * `Kein Live-Kurs` and `Zuletzt 15:25 · veraltet` for ≥ 6 min while the ticker / funding / OI / Bid-Ask REST data kept
 * updating. Reproduced with the real provider, fake timers, the synthetic Binance of the net harness and a socket that
 * stays open but stops sending — and the ways back: the tab hidden for 6 min, the Page Lifecycle `resume`, `pageshow`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketProvider } from "@/market/provider";
import { deriveMarket, type MarketView } from "@/market/mapping";
import { FakeSocket, MIN, SEC, T0, flush, pumpWs, requests, runFor, setup } from "./market.netHarness";

const STREAM = 84_206; // the stream's trade price (84206.1)
const REST = 82_080; // what the ticker says meanwhile

const view = (p: MarketProvider): MarketView => deriveMarket(p.snapshot(), p.getHealth(), { now: Date.now() });

describe("the stream drops, the price keeps coming (Galaxy Tab 2026-10-08)", () => {
  let p: MarketProvider | null = null;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => {
    p?.stop();
    p = null;
    vi.useRealTimers();
  });

  async function startLive(o: Parameters<typeof setup>[0] = {}) {
    const env = setup(o);
    p = env.provider;
    env.provider.start();
    await flush();
    await runFor(env.net, 30 * SEC);
    expect(view(env.provider)).toMatchObject({ status: "live", price: STREAM, priceMode: "stream", pill: { text: "Live" } });
    return env;
  }

  it("open socket goes silent: the REST price is on screen within 20 s and never older than ~5 s, `Kurs per Abfrage · 5 s`, never `Kein Live-Kurs`; the socket is retried 1, 2, 4 … 30 s for good; back → Live", async () => {
    const { provider, net } = await startLive();
    net.tickerLast = () => REST;
    net.wsUp = false; // the open socket sends nothing more, new handshakes never answer
    const dropped = Date.now();
    const sockets = FakeSocket.all.length;
    const born: number[] = [];
    const pills = new Set<string>();
    let shownAt: number | undefined;
    for (let i = 0; i < 6 * 60; i++) {
      const n = FakeSocket.all.length;
      await vi.advanceTimersByTimeAsync(SEC);
      if (FakeSocket.all.length > n) born.push(Date.now() - dropped);
      const v = view(provider);
      pills.add(v.pill.text);
      if (shownAt === undefined && v.price === REST) shownAt = Date.now() - dropped;
      if (Date.now() - dropped >= 20 * SEC) {
        expect(v.price).toBe(REST);
        expect(Date.now() - v.priceSource!.asOf).toBeLessThanOrEqual(6 * SEC);
        expect(v).toMatchObject({ status: "live", priceMode: "poll", pill: { tone: "warn", text: "Kurs per Abfrage · 5 s" } });
        expect(v.message).toBeUndefined(); // no `Zuletzt … · veraltet` under a fresh price
      }
    }
    expect(shownAt).toBeLessThanOrEqual(20 * SEC); // silence detected at 10 s, the ticker answers at once
    expect([...pills]).not.toContain("Kein Live-Kurs");
    // one ticker about every 5 s (+ the 30-s ticker feed), not a tight loop
    const tickers = requests(net, "/fapi/v1/ticker/24hr", dropped + 20 * SEC).length;
    expect(tickers).toBeGreaterThanOrEqual(60);
    expect(tickers).toBeLessThanOrEqual(90);
    // the socket is retried for good: after the 15-s handshake timeout, 1 s, 2 s, 4 s … then every 30 s
    expect(FakeSocket.all.length - sockets).toBeGreaterThanOrEqual(10);
    const gaps = born.slice(1).map((t, i) => t - born[i]!);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(15 * SEC + 30 * SEC + SEC);
    expect(gaps.at(-1)).toBeGreaterThanOrEqual(15 * SEC + 30 * SEC - SEC);
    expect(born.at(-1)!).toBeGreaterThan(5 * MIN); // still trying after 5 min

    // the network is back: the next handshake streams → Live with the trade price
    net.wsUp = true;
    const n = FakeSocket.all.length;
    while (FakeSocket.all.length === n) await vi.advanceTimersByTimeAsync(SEC);
    pumpWs(net);
    await flush();
    expect(view(provider)).toMatchObject({ status: "live", price: STREAM, priceMode: "stream", pill: { text: "Live" } });
    // the REST stand-in stops once the stream delivers
    await runFor(net, 10 * SEC);
    const quiet = Date.now();
    await runFor(net, 25 * SEC);
    expect(requests(net, "/fapi/v1/ticker/24hr", quiet).length).toBeLessThanOrEqual(1);
  });

  it("hidden 6 min (socket died meanwhile) → visible: the price is asked at once and on screen in the same second; `Verbinde …` until it lands, never `Kein Live-Kurs`", async () => {
    const { provider, net, setHidden } = await startLive();
    setHidden(true);
    await runFor(net, 6 * MIN, { ws: false });
    net.tickerLast = () => REST;
    const sockets = FakeSocket.all.length;
    const back = Date.now();
    setHidden(false);
    // before the request has answered: the old price, honestly labelled
    const before = view(provider);
    expect(before.pill.text).not.toBe("Kein Live-Kurs");
    expect(before.status).not.toBe("error");
    await vi.advanceTimersByTimeAsync(50);
    expect(requests(net, "/fapi/v1/ticker/24hr", back)).toHaveLength(1);
    expect(FakeSocket.all.length).toBeGreaterThan(sockets); // the socket reconnects at once
    expect(view(provider)).toMatchObject({ status: "live", price: REST, priceMode: "poll", pill: { text: "Kurs per Abfrage · 5 s" } });
    // the handshake answers: Live again
    pumpWs(net);
    await flush();
    expect(view(provider)).toMatchObject({ status: "live", price: STREAM, priceMode: "stream", pill: { text: "Live" } });
  });

  it("Samsung Internet thaws the page (Page Lifecycle `resume`, timers frozen 6 min): reconnect + price poll at once", async () => {
    const { provider, net, doc } = await startLive();
    net.tickerLast = () => REST;
    vi.setSystemTime(Date.now() + 6 * MIN); // frozen: no timer ran, the socket is a dead TCP connection
    const thawed = Date.now();
    const sockets = FakeSocket.all.length;
    doc.fire("resume");
    await vi.advanceTimersByTimeAsync(50);
    expect(FakeSocket.all.length).toBe(sockets + 1);
    expect(requests(net, "/fapi/v1/ticker/24hr", thawed).length).toBeGreaterThanOrEqual(1);
    expect(view(provider)).toMatchObject({ status: "live", price: REST, priceMode: "poll" });
    pumpWs(net);
    await flush();
    expect(view(provider)).toMatchObject({ price: STREAM, priceMode: "stream", pill: { text: "Live" } });
  });

  it("`pageshow` (back/forward cache) and `online` do the same", async () => {
    for (const fire of ["pageshow", "online"] as const) {
      const { provider, net, win, setOnline } = await startLive();
      net.tickerLast = () => REST;
      vi.setSystemTime(Date.now() + 3 * MIN);
      const t = Date.now();
      if (fire === "online") setOnline(true);
      else win.fire("pageshow");
      await vi.advanceTimersByTimeAsync(50);
      expect(requests(net, "/fapi/v1/ticker/24hr", t).length, fire).toBeGreaterThanOrEqual(1);
      expect(view(provider), fire).toMatchObject({ price: REST, priceMode: "poll" });
      provider.stop();
    }
  });

  it("the REST stand-in fails too: `Verbinde …` while the shown price is < 2 min old, then `Kein Live-Kurs` with the time of that price", async () => {
    const dead = { on: false };
    // Binance's ticker answers 503 and the fallback exchange is down too: nothing can deliver the price
    const { provider, net } = await startLive({ fail: (u, host) => (dead.on && (host === "bybit" || u.pathname.endsWith("/ticker/24hr")) ? 503 : undefined) });
    net.wsUp = false;
    dead.on = true;
    const dropped = Date.now();
    const seen: string[] = [];
    for (let i = 0; i < 150; i++) {
      await vi.advanceTimersByTimeAsync(SEC);
      const v = view(provider);
      if (seen.at(-1) !== v.pill.text) seen.push(v.pill.text);
    }
    expect(Date.now() - dropped).toBe(150 * SEC);
    // Live (until the silence is detected) → Verbinde … (the stand-in fails) → Kein Live-Kurs (nothing for 2 min)
    expect(seen[0]).toBe("Live");
    expect(seen).toContain("Verbinde …");
    expect(seen.at(-1)).toBe("Kein Live-Kurs");
    const v = view(provider);
    expect(v.status).toBe("error");
    expect(v.message).toMatch(/^Zuletzt \d\d:\d\d · veraltet$/);
    expect(v.message).toContain(new Date(v.priceSource!.asOf).toISOString().slice(11, 16)); // the footer names the price shown
    expect(seen).not.toContain("Offline"); // the device is online
  });
});
