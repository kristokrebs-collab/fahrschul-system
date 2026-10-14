/**
 * Live-Daten card: per ratio feed the real source, the time of the newest point, the next poll — and while a feed
 * fails, the cause, how often in a row and when it is retried; above the table whether Binance is reachable or
 * blocked and whether the EU proxy is there.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildFeedSpecs } from "@/market/feeds";
import { initialHealth, reduceHealth } from "@/market/health";
import type { HealthEvent, ProviderHealth } from "@/market/types";
import { FEED_LABELS, LiveDataCard, SPLIT_QUERY, feedLine, feedLineText, routeLine, type FeedLineCtx } from "@/views/settings/LiveDataCard";

const disk = vi.hoisted(() => ({ on: false }));
vi.mock("@/edition", async (orig) => ({ ...(await orig<typeof import("@/edition")>()), isFileProtocol: () => disk.on }));

const specs = buildFeedSpecs("1h");
/** 12:05 UTC */
const T = Date.UTC(2026, 9, 7, 12, 5);
const run = (events: HealthEvent[], h: ProviderHealth = initialHealth(specs)) => events.reduce((a, ev) => reduceHealth(a, ev, specs), h);
const hm = (ms: number) => new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
const ctxOf = (h: ProviderHealth, transport: FeedLineCtx["transport"] = "rest"): FeedLineCtx => ({ transport, online: h.online, ws: h.ws, primary: h.primary, skewMs: h.clockSkewMs });

describe("LiveDataCard · ratio feeds", () => {
  const base = run([
    { type: "ws_message", feeds: ["aggTrade", "markPrice"], asOf: T, now: T },
    { type: "rest_ok", feed: "topAccountRatio5m", source: "binance", asOf: T, now: T + 50_000 },
    { type: "schedule", feed: "topAccountRatio5m", nextRefreshAt: T + 382_000 },
    { type: "rest_ok", feed: "topAccountRatio", source: "binance", asOf: T - 5 * 60_000, now: T + 50_000 },
    { type: "rest_fail", feed: "globalAccountRatio5m", source: "binance", kind: "network", now: T + 60_000, detail: "Netzwerk/CORS: Failed to fetch" },
    { type: "rest_fail", feed: "globalAccountRatio5m", source: "binance", kind: "network", now: T + 75_000, detail: "Netzwerk/CORS: Failed to fetch" },
    { type: "schedule", feed: "globalAccountRatio5m", nextRefreshAt: T + 105_000 },
  ]);

  it("labels the 5-min twins and lists every feed", () => {
    expect(FEED_LABELS.topAccountRatio5m).toBe("Top-Trader Konten · 5 min");
    render(<LiveDataCard health={base} />);
    for (const label of ["Top-Trader Konten · 5 min", "Top-Trader Positionen · 5 min", "Alle Konten · 5 min", "Top-Trader Konten"]) {
      expect(screen.getAllByText(label, { exact: false }).length).toBeGreaterThan(0);
    }
  });

  it("a healthy ratio feed shows its newest point and the countdown to the next data; a failing one the cause, count and retry", () => {
    const now = T + 60_000;
    expect(feedLineText(feedLine(base.feeds.topAccountRatio5m, ctxOf(base)), now)).toBe("nächste Daten in 5:22");
    expect(feedLineText(feedLine(base.feeds.topAccountRatio5m, ctxOf(base)), T + 400_000)).toBe("lädt …"); // ran out: the poll is due
    const fail5m = feedLine(base.feeds.globalAccountRatio5m, ctxOf(base));
    expect(fail5m.tone).toBe("warn");
    expect(feedLineText(fail5m, T + 75_000)).toBe("Netzwerk/CORS-Fehler (Netzwerk/CORS: Failed to fetch) · 2× in Folge · neuer Versuch in 0:30");
    // a WebSocket feed: the stream's age (exchange clock), not a poll
    const mark = feedLine(base.feeds.markPrice, ctxOf(base, "ws"));
    expect(feedLineText(mark, T + 2_000)).toBe("Stream · Daten vor 2 s");
    render(<LiveDataCard health={base} />);
    const lines = screen.getAllByText((_, el) => el?.hasAttribute("data-feed-detail") ?? false);
    const failing = lines.find((l) => l.textContent?.startsWith("Netzwerk/CORS-Fehler"))!;
    expect(failing.className).toContain("text-warn");
    const row = failing.closest("tr")!;
    expect(within(row).getByText("Binance")).toBeInTheDocument(); // still on Binance, not Bybit
  });

  it("route line: Binance reachable / blocked with the next re-probe; proxy ready or not", () => {
    expect(routeLine(base)).toEqual(["Binance erreichbar"]);
    const blocked = run([
      { type: "probe", source: "binance", ok: false, blocked: true, now: T },
      { type: "probe_scheduled", at: T + 300_000, now: T },
      { type: "probe", source: "proxy", ok: false, now: T },
    ]);
    expect(routeLine(blocked)).toEqual([`Binance blockiert (Region) · neuer Versuch ${hm(T + 300_000)}`, "EU-Proxy nicht erreichbar"]);
    const viaProxy = run([{ type: "probe", source: "proxy", ok: true, now: T }], base);
    expect(routeLine(viaProxy)).toEqual(["Binance erreichbar", "EU-Proxy bereit"]);
    render(<LiveDataCard health={blocked} />);
    const route = screen.getAllByText(/^Binance blockiert \(Region\)/).find((el) => el.hasAttribute("data-route"))!;
    expect(route).toHaveClass("text-warn");
  });

  it("tolerates a partial health snapshot (no ratio rows, no primary)", () => {
    const partial = {
      overall: "live",
      online: true,
      ws: { attempt: 0 },
      proxy: { usable: true },
      feeds: { markPrice: { feed: "markPrice", source: "binance", state: "live", lastDataAt: T } },
    } as unknown as ProviderHealth;
    render(<LiveDataCard health={partial} />);
    expect(screen.getByText("Mark-Preis")).toBeInTheDocument();
    expect(screen.getByText("EU-Proxy bereit")).toBeInTheDocument();
  });
});

describe("LiveDataCard · honest freshness for every feed (decision 14)", () => {
  const live = run([
    { type: "ws_open", now: T },
    { type: "ws_message", feeds: ["aggTrade", "markPrice", "kline_1m", "kline_15m"], asOf: T, now: T },
    { type: "rest_ok", feed: "ticker24h", source: "binance", asOf: T, now: T },
    { type: "schedule", feed: "ticker24h", nextRefreshAt: T + 30_000 },
    { type: "rest_ok", feed: "openInterest", source: "binance", asOf: T - 20_000, now: T },
    { type: "schedule", feed: "openInterest", nextRefreshAt: T + 40_000 },
  ]);

  it("REST feeds: Stand + countdown to the next data; WS feeds: the stream's age on the Binance clock", () => {
    expect(feedLineText(feedLine(live.feeds.ticker24h, ctxOf(live)), T + 12_000)).toBe("nächste Daten in 0:18");
    expect(feedLineText(feedLine(live.feeds.openInterest, ctxOf(live)), T + 1_000)).toBe("nächste Daten in 0:39");
    expect(feedLineText(feedLine(live.feeds.kline_15m, ctxOf(live, "ws")), T + 3_000)).toBe("Stream · Daten vor 3 s");
    // device clock 3 min behind Binance: the age is still measured honestly (server − device = +180 s)
    const skewed = { ...ctxOf(live, "ws"), skewMs: 180_000 };
    expect(feedLineText(feedLine(live.feeds.kline_15m, skewed), T - 180_000 + 4_000)).toBe("Stream · Daten vor 4 s");
    expect(feedLineText(feedLine(live.feeds.kline_1m, ctxOf(live, "ws")), T + 125_000)).toBe("Stream · Daten vor 2 min");
    // long waits read in hours (funding every 8 h)
    const funding = run([{ type: "rest_ok", feed: "fundingHistory", source: "binance", asOf: T, now: T }, { type: "schedule", feed: "fundingHistory", nextRefreshAt: T + 6 * 3_600_000 }], live);
    expect(feedLineText(feedLine(funding.feeds.fundingHistory, ctxOf(funding)), T + 60_000)).toBe("nächste Daten in 5 h 59 min");
  });

  it("socket down: `Stream getrennt` with the reconnect countdown; REST fallback: polled every 10 s", () => {
    const down = run([{ type: "ws_close", code: 1006, now: T + 5_000, failedAttempts: 1 }, { type: "ws_retry", attempt: 1, nextRetryAt: T + 9_000, now: T + 5_000 }], live);
    const l = feedLine(down.feeds.markPrice, ctxOf(down, "ws"));
    expect(l.tone).toBe("warn");
    expect(feedLineText(l, T + 6_000)).toBe("Stream getrennt · neuer Versuch in 0:03");
    expect(feedLineText(l, T + 10_000)).toBe("Stream getrennt · neuer Versuch läuft …");
    const fallback = { ...down, feeds: { ...down.feeds, markPrice: { ...down.feeds.markPrice, state: "fallback" as const, nextRefreshAt: T + 17_000 } } };
    expect(feedLineText(feedLine(fallback.feeds.markPrice, ctxOf(fallback, "ws")), T + 10_000)).toBe("per REST (Stream aus) · nächste Daten in 0:07");
  });

  it("offline, parked on another source, Bid/Ask opt-in, loading", () => {
    const off = run([{ type: "online", online: false, now: T + 1_000 }], live);
    const o = feedLine(off.feeds.ticker24h, ctxOf(off));
    expect(o).toMatchObject({ tone: "error" });
    expect(feedLineText(o, T + 2_000)).toBe("Offline");
    const parked = run([{ type: "unsupported", feed: "topPositionRatio", source: "bybit", now: T }, { type: "probe_scheduled", at: T + 300_000, now: T }], live);
    expect(feedLineText(feedLine(parked.feeds.topPositionRatio, ctxOf(parked)), T + 60_000)).toMatch(/· neuer Versuch in 4:00$/);
    expect(feedLineText(feedLine(live.feeds.bookTop, ctxOf(live, "ws")), T)).toBe("Nur solange die Bid/Ask-Kachel sichtbar ist");
    const loading = run([{ type: "schedule", feed: "fundingHistory", nextRefreshAt: T + 5_000 }], live);
    expect(feedLineText(feedLine(loading.feeds.fundingHistory, ctxOf(loading)), T)).toBe("lädt … · nächste Daten in 0:05");
  });

  it("route line names a device clock that runs off; from disk a CORS failure on the futures data says what helps", () => {
    const skew = run([{ type: "clock", skewMs: -240_000, now: T }], live);
    expect(routeLine(skew)).toContain("Geräteuhr geht 4:00 min vor · Zeiten nach Binance-Uhr");
    const cors = run([{ type: "rest_fail", feed: "topAccountRatio5m", source: "binance", kind: "network", now: T }], live);
    disk.on = true;
    try {
      const lines = routeLine(cors);
      expect(lines).toContain("Kein EU-Proxy in der Datei-Version");
      expect(lines.some((t) => t.startsWith("Datei-Version: liest der Browser die Binance-Top-Trader-Daten nicht (CORS)"))).toBe(true);
      expect(routeLine(live).some((t) => t.startsWith("Datei-Version:"))).toBe(false); // only while it actually fails
    } finally {
      disk.on = false;
    }
    expect(routeLine(cors).some((t) => t.startsWith("Datei-Version:"))).toBe(false); // on the web the proxy takes over
  });

  it("renders a line under every feed; the countdown is a separate fixed-width segment on the shared clock", () => {
    const now = Date.now();
    const h = run([
      { type: "ws_open", now },
      { type: "ws_message", feeds: ["aggTrade", "markPrice"], asOf: now, now },
      { type: "rest_ok", feed: "ticker24h", source: "binance", asOf: now, now },
      { type: "schedule", feed: "ticker24h", nextRefreshAt: now + 20_000 },
    ]);
    render(<LiveDataCard health={h} />);
    const lines = screen.getAllByText((_, el) => el?.hasAttribute("data-feed-detail") ?? false);
    expect(lines.length).toBe(Object.keys(h.feeds).length);
    const ticker = within(screen.getByText("24h-Ticker").closest("tr")!).getByText((_, el) => el?.hasAttribute("data-feed-detail") ?? false);
    expect(ticker.textContent).toMatch(/^nächste Daten in 0:(19|20|21)$/);
    const digits = ticker.querySelector(".tabular-nums")!;
    expect(digits.textContent).toMatch(/^0:(19|20|21)$/);
    expect(digits.className).toContain("min-w-[4.5ch]"); // the number never re-flows the column
  });
});

describe("LiveDataCard · layout (design pass v3)", () => {
  const health = run([{ type: "ws_message", feeds: ["aggTrade", "markPrice"], asOf: T, now: T }]);
  const withMedia = (matches: (q: string) => boolean) => {
    const prev = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: matches(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    return () => void (window.matchMedia = prev);
  };

  it("xl (the card spans the page): the feeds run in two tables, every feed once; below xl one table", () => {
    const feeds = Object.keys(health.feeds).length;
    let restore = withMedia((q) => q === SPLIT_QUERY);
    const { unmount } = render(<LiveDataCard health={health} />);
    const tables = screen.getAllByRole("table");
    expect(tables).toHaveLength(2);
    const rows = tables.map((t) => within(t).getAllByRole("row").length - 1);
    expect(rows[0]! + rows[1]!).toBe(feeds);
    expect(rows[0]! - rows[1]!).toBeLessThanOrEqual(1);
    unmount();
    restore();
    restore = withMedia(() => false);
    render(<LiveDataCard health={health} />);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    restore();
  });
});
