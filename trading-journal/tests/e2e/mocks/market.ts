/// <reference lib="dom" />
/**
 * Playwright helper: `mockMarket(page, scenario)` routes `fapi.binance.com` / `api.bybit.com` REST calls to
 * the JSON fixtures and replaces `window.WebSocket` with a scripted fake that replays a WS scenario from
 * `tests/fixtures/ws-scenarios/*.json`, so e2e screens run without any network.
 *
 *   import { mockMarket } from "./mocks/market";
 *   test("overview shows live price", async ({ page }) => {
 *     await mockMarket(page, "live");
 *     await page.goto("/");
 *   });
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Route } from "@playwright/test";
import { SYNTH_LIVE_PRICE, synthKlines, synthRatios, type RatioKind, type RatioScript, type SynthShape } from "./synth";

export type MarketScenario = "live" | "stale" | "blocked_451" | "offline" | "reconnect";

interface WsStep {
  t: number;
  type: "open" | "message" | "close" | "silence";
  fixture?: string;
  patch?: Record<string, string | number>;
  code?: number;
}
interface ScenarioFile {
  name: MarketScenario;
  description: string;
  baseTime: number;
  rest: { mode: "ok" | "blocked_451" | "offline"; bybit?: "ok" | "offline" };
  ws: { steps: WsStep[]; reconnect?: "ok" | "fail" | "silent"; reconnectSteps?: WsStep[] };
}

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures");
const readJson = <T = unknown>(name: string): T => JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as T;

const BINANCE_ROUTES: Record<string, string> = {
  "/fapi/v1/premiumIndex": "binance-premiumIndex.json",
  "/fapi/v1/ticker/24hr": "binance-ticker24hr.json",
  "/fapi/v1/openInterest": "binance-openInterest.json",
  "/fapi/v1/fundingRate": "binance-fundingRate.json",
  "/fapi/v1/time": "binance-time.json",
  "/futures/data/openInterestHist": "binance-openInterestHist.json",
  "/futures/data/topLongShortPositionRatio": "binance-topLongShortPositionRatio.json",
  "/futures/data/topLongShortAccountRatio": "binance-topLongShortAccountRatio.json",
  "/futures/data/globalLongShortAccountRatio": "binance-globalLongShortAccountRatio.json",
  "/futures/data/takerlongshortRatio": "binance-takerlongshortRatio.json",
};
const BYBIT_ROUTES: Record<string, string> = {
  "/v5/market/kline": "bybit-kline.json",
  "/v5/market/tickers": "bybit-tickers.json",
  "/v5/market/account-ratio": "bybit-account-ratio.json",
  "/v5/market/open-interest": "bybit-open-interest.json",
  "/v5/market/funding/history": "bybit-funding-history.json",
  "/v5/market/time": "bybit-time.json",
};

/** Shifts fixture timestamps so that the newest point is "now" (fixtures are frozen at `baseTime`). */
function shiftTimes(value: unknown, delta: number): unknown {
  if (Array.isArray(value)) return value.map((v) => shiftTimes(v, delta));
  if (typeof value === "number" && value > 1_600_000_000_000 && value < 2_000_000_000_000) return value + delta;
  if (typeof value === "string" && /^1[6-9]\d{11}$/.test(value)) return String(Number(value) + delta);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, shiftTimes(v, delta)]));
  return value;
}

export interface MockMarketOptions {
  /** align fixture timestamps to the wall clock (default true) */
  shiftToNow?: boolean;
  /** extra latency per REST response in ms */
  latencyMs?: number;
  /**
   * Minimum number of kline rows per interval (default 500, like the real bootstrap). The fixtures hold
   * only ~30 bars; older bars are synthesised with a deterministic random walk ending at the first fixture
   * bar so the chart renders at realistic density. `0` serves the raw fixture.
   */
  klineBars?: number;
  /**
   * Generated market instead of the kline / long-short-ratio fixtures (`synth.ts`): one price path for every interval
   * (open times aligned like Binance) that yields a KNOWN Einstiegs-Check result, and ratio series per requested
   * `period`. `ratios: "whale-long"` = top traders buy while retail is red over the last 4 periods. The WS replay
   * then drops its (unaligned) `kline_1h` message, and every price the app may read as the last price — the replayed
   * trades (84.206,1 / 84.215,4 / 84.199 in the fixtures), the book mid, the tickers' last price — is the one
   * `SYNTH_LIVE_PRICE`: the signal engine keeps the price of its minute frame (whatever arrived first), the oracles
   * grade with this one. Time anchor = the moment `mockMarket` runs.
   */
  synth?: {
    ratios?: RatioScript;
    /** time anchor of the price path (default: now) – pass it to `expectedSignals` too */
    anchor?: number;
    /** price shape (`synth.ts`): `capitulation` (default, the long entry) or `divergence` */
    shape?: SynthShape;
  };
  /** called with every REST URL the page requests from Binance (request log for assertions) */
  onRequest?: (url: URL) => void;
  /**
   * "Now" of the mocked exchange (ms). Pass the page's fake clock (`pinClock` in `helpers.ts`) so klines, ratio points,
   * `/fapi/v1/time` and the fixture timestamps follow the browser's `Date.now()` (also across `forward()` jumps).
   * Default: the wall clock, fixture shift fixed when `mockMarket` runs.
   */
  clock?: () => number;
  /**
   * P02 (additive): serve REAL BTCUSDT 4h / 1D bars (`tests/unit/fixtures/binance-btcusdt-{4h,1d}.json`, 1W aggregated
   * from the days) so the Box-zu-Box engine finds real boxes: the 4h bar `cut4h` (default 1493, an A+ range long at the
   * support with a broken RSI line) becomes the forming bar of "now", the days and weeks are shifted to the same moment
   * on their own grid, and every live price of the replay (trades, book, tickers) is that bar's close.
   */
  boxes?: boolean | { cut4h?: number };
}

/** Real bars for the Box-zu-Box e2e (`boxes` option): rows per interval, shifted so `cut4h` is forming at `now`. */
export interface BoxFixture {
  /** `symbol`: BTCUSDT gets the cut as given; any other symbol (the watchlist scanner) a cut and price scale of its own */
  rows: (interval: string, q: { limit?: number; startTime?: number; endTime?: number }, symbol?: string) => KlineRow[] | null;
  live: number;
}

const BOX_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "unit", "fixtures");
const HOUR_MS = 3_600_000;

export function boxFixture(now: number, cut4h = 1493): BoxFixture {
  const btc = boxSeries(now, cut4h, 1);
  const bySymbol = new Map<string, ReturnType<typeof boxSeries>>([["BTCUSDT", btc]]);
  return {
    live: btc.live,
    rows(interval, q, symbol = "BTCUSDT") {
      let ser = bySymbol.get(symbol);
      if (!ser) {
        // another market: the same real bars at another moment and price level (deterministic per symbol)
        let h = 0x811c9dc5;
        for (let i = 0; i < symbol.length; i++) h = Math.imul(h ^ symbol.charCodeAt(i), 0x01000193) >>> 0;
        ser = boxSeries(now, cut4h - 30 - (h % 700), [0.031, 0.0021, 0.0074, 0.000029, 0.0000026, 0.00011, 0.00043, 0.0019][h % 8]!);
        bySymbol.set(symbol, ser);
      }
      return ser.rows(interval, q);
    },
  };
}

function boxSeries(now: number, cut4h: number, scale: number): { rows: (interval: string, q: { limit?: number; startTime?: number; endTime?: number }) => KlineRow[] | null; live: number } {
  const read = (n: string) => (JSON.parse(readFileSync(join(BOX_FIXTURES, n), "utf8")) as { bars: number[][] }).bars;
  const h4 = read("binance-btcusdt-4h.json");
  const d1 = read("binance-btcusdt-1d.json");
  const cut = Math.max(100, Math.min(h4.length - 1, cut4h));
  const H4 = 4 * HOUR_MS;
  const D = 24 * HOUR_MS;
  const W = 7 * D;
  const fixAt = h4[cut]![0]! * 1000; // open of the bar that is forming "now"
  const d4 = Math.floor(now / H4) * H4 - fixAt;
  const dD = Math.floor(now / D) * D - Math.floor(fixAt / D) * D;
  // prices scaled per market (6 significant digits); the volume follows the bar's range (a plausible histogram)
  const px = (v: number): string => (v * scale).toPrecision(6);
  const toRow = (t: number, o: number, h: number, l: number, c: number, iv: number): KlineRow => {
    const v = (((h - l) / c) * 40_000).toFixed(3);
    return [t, px(o), px(h), px(l), px(c), v, t + iv - 1, (Number(v) * c * scale).toFixed(2), 1000, (Number(v) / 2).toFixed(3), ((Number(v) / 2) * c * scale).toFixed(2), "0"];
  };
  const rows4h = h4.slice(0, cut + 1).map(([t, o, h, l, c]) => toRow(t! * 1000 + d4, o!, h!, l!, c!, H4));
  const fixDay = Math.floor(fixAt / D) * D;
  const days = d1.filter(([t]) => t! * 1000 <= fixDay).map(([t, o, h, l, c]) => ({ t: t! * 1000 + dD, o: o!, h: h!, l: l!, c: c! }));
  const rows1d = days.map((b) => toRow(b.t, b.o, b.h, b.l, b.c, D));
  const weeks: Array<{ t: number; o: number; h: number; l: number; c: number }> = [];
  for (const b of days) {
    const open = Math.floor((b.t - 4 * D) / W) * W + 4 * D;
    const w = weeks[weeks.length - 1];
    if (w && w.t === open) Object.assign(w, { h: Math.max(w.h, b.h), l: Math.min(w.l, b.l), c: b.c });
    else weeks.push({ t: open, o: b.o, h: b.h, l: b.l, c: b.c });
  }
  const rows1w = weeks.map((b) => toRow(b.t, b.o, b.h, b.l, b.c, W));
  const by: Record<string, KlineRow[]> = { "4h": rows4h, "1d": rows1d, "1w": rows1w };
  return {
    live: Number(px(h4[cut]![4]!)),
    rows(interval, q) {
      const all = by[interval];
      if (!all) return null;
      let out = all.filter((r) => (q.endTime == null || r[0] <= q.endTime) && (q.startTime == null || r[0] >= q.startTime));
      out = out.slice(-(q.limit ?? 500));
      return out;
    },
  };
}

const SYNTH_RATIO_KIND: Record<string, RatioKind> = {
  "/futures/data/topLongShortPositionRatio": "top-position",
  "/futures/data/topLongShortAccountRatio": "top-account",
  "/futures/data/globalLongShortAccountRatio": "global",
};
const BYBIT_INTERVAL: Record<string, string> = { "1": "1m", "15": "15m", "30": "30m", "60": "1h", "240": "4h", D: "1d", W: "1w" };
const num = (v: string | null): number | undefined => (v === null || v === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));

type KlineRow = [number, string, string, string, string, string, number, string, number, string, string, string];
const INTERVAL_MS: Record<string, number> = { "1m": 60_000, "15m": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1d": 86_400_000, "1w": 604_800_000 };

/** Prepends synthetic bars (walk backwards from the first fixture bar) until `min` rows exist. */
export function extendKlines(rows: KlineRow[], interval: string, min: number): KlineRow[] {
  const first = rows[0];
  const step = INTERVAL_MS[interval];
  if (!first || !step || rows.length >= min) return rows;
  let seed = 0x9e3779b9 ^ rows.length;
  const rand = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) ^ (seed >>> 12)) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const out: KlineRow[] = [];
  let close = Number(first[1]);
  let openTime = first[0];
  const vol = Number(first[5]) || 1000;
  for (let i = rows.length; i < min; i++) {
    openTime -= step;
    const drift = (rand() - 0.5) * close * 0.012;
    const open = close - drift;
    const hi = Math.max(open, close) + rand() * close * 0.004;
    const lo = Math.min(open, close) - rand() * close * 0.004;
    const v = vol * (0.6 + rand() * 0.8);
    out.unshift([openTime, open.toFixed(1), hi.toFixed(1), lo.toFixed(1), close.toFixed(1), v.toFixed(3), openTime + step - 1, (v * close).toFixed(2), Math.round(v * 12), (v / 2).toFixed(3), ((v / 2) * close).toFixed(2), "0"]);
    close = open;
  }
  return [...out, ...rows];
}

/**
 * Prepends synthetic `/futures/data/*` points (same period as the fixture, random walk around the first value)
 * until `min` rows exist, so ratio / OI panes cover the whole chart window like a real 500-point bootstrap.
 */
export function extendFuturesData(rows: Record<string, string>[], min: number): Record<string, string>[] {
  const first = rows[0];
  const second = rows[1];
  if (!first || !second || rows.length >= min) return rows;
  const step = Number(second.timestamp) - Number(first.timestamp);
  if (!(step > 0)) return rows;
  let seed = 0x7f4a7c15 ^ rows.length;
  const rand = () => {
    seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) ^ (seed >>> 12)) >>> 0;
    return seed / 0x1_0000_0000;
  };
  const numeric = Object.keys(first).filter((k) => k !== "timestamp" && k !== "symbol" && /^-?\d+(\.\d+)?$/.test(first[k] ?? ""));
  const out: Record<string, string>[] = [];
  let cur = { ...first };
  let ts = Number(first.timestamp);
  for (let i = rows.length; i < min; i++) {
    ts -= step;
    const next: Record<string, string> = { ...cur, timestamp: String(ts) };
    for (const k of numeric) {
      const v = Number(cur[k]);
      const decimals = (cur[k]?.split(".")[1] ?? "").length;
      const walk = v * (1 + (rand() - 0.5) * 0.02);
      next[k] = walk.toFixed(decimals);
    }
    if ("longAccount" in next && "shortAccount" in next) {
      const l = Math.min(0.95, Math.max(0.05, Number(next.longAccount)));
      next.longAccount = l.toFixed(4);
      next.shortAccount = (1 - l).toFixed(4);
      next.longShortRatio = (l / (1 - l)).toFixed(4);
    }
    if ("buySellRatio" in next) {
      const b = Math.max(0.3, Number(next.buySellRatio));
      next.buySellRatio = b.toFixed(4);
    }
    out.unshift(next);
    cur = next;
  }
  return [...out, ...rows];
}

export async function mockMarket(page: Page, scenario: MarketScenario, opts: MockMarketOptions = {}): Promise<ScenarioFile> {
  const file = readJson<ScenarioFile>(`ws-scenarios/${scenario}.json`);
  // Exact shift (no 5-min flooring): the REST `asOf` stamps must read as fresh, otherwise the legacy panel flips
  // to `Zuletzt HH:mm · veraltet` whenever the wall clock is > 2 min past a 5-min boundary.
  const clock = opts.clock ?? Date.now;
  const delta0 = opts.shiftToNow === false ? 0 : clock() - file.baseTime;
  /** fixture shift per response: follows a pinned clock (jumps included), else fixed at setup */
  const delta = (): number => (opts.clock && opts.shiftToNow !== false ? clock() - file.baseTime : delta0);
  const synth = opts.synth;
  const anchor = synth?.anchor ?? clock();
  const boxFix = opts.boxes ? boxFixture(clock(), typeof opts.boxes === "object" ? opts.boxes.cut4h : undefined) : null;
  const live = (boxFix ? boxFix.live : SYNTH_LIVE_PRICE).toFixed(2);
  if (synth || boxFix) {
    // one live price: the trades and the book mid of the replay at SYNTH_LIVE_PRICE
    const mid = Number(live);
    const PRICE_PATCH: Record<string, Record<string, string>> = {
      "binance-ws-aggTrade.json": { "data.p": live },
      "binance-ws-bookTicker.json": { "data.b": (mid - 0.1).toFixed(2), "data.a": (mid + 0.1).toFixed(2) },
    };
    const adapt = (steps: WsStep[] | undefined) =>
      steps?.filter((st) => st.fixture !== "binance-ws-kline.json").map((st) => (st.fixture && PRICE_PATCH[st.fixture] ? { ...st, patch: { ...st.patch, ...PRICE_PATCH[st.fixture] } } : st));
    file.ws = { ...file.ws, steps: adapt(file.ws.steps) ?? [], reconnectSteps: adapt(file.ws.reconnectSteps) };
  }
  /** synthetic market: the tickers' last price is the live price too (Binance `lastPrice`, Bybit `list[].lastPrice`) */
  const livePatch = (name: string, body: unknown): unknown => {
    if (!synth && !boxFix) return body;
    if (name === "binance-ticker24hr.json") return { ...(body as Record<string, unknown>), lastPrice: live };
    if (name === "bybit-tickers.json") {
      const b = body as { result: { list: Record<string, unknown>[] } };
      return { ...b, result: { ...b.result, list: b.result.list.map((x) => ({ ...x, lastPrice: live })) } };
    }
    return body;
  };
  const json = async (route: Route, name: string, status = 200) => {
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    await route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(livePatch(name, shiftTimes(readJson(name), delta()))) });
  };

  await page.route("https://fapi.binance.com/**", async (route) => {
    const u = new URL(route.request().url());
    if (file.rest.mode === "offline") return route.abort("failed");
    if (file.rest.mode === "blocked_451") return route.abort("failed"); // 451 without CORS headers surfaces as TypeError
    opts.onRequest?.(u);
    const q = { limit: num(u.searchParams.get("limit")), startTime: num(u.searchParams.get("startTime")), endTime: num(u.searchParams.get("endTime")) };
    if (synth && u.pathname === "/fapi/v1/klines") {
      const rows = synthKlines(u.searchParams.get("interval") ?? "1h", q, anchor, clock(), synth.shape);
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows) });
    }
    const boxRows = boxFix && u.pathname === "/fapi/v1/klines" ? boxFix.rows(u.searchParams.get("interval") ?? "1h", q, u.searchParams.get("symbol") ?? "BTCUSDT") : null;
    if (boxRows) return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(boxRows) });
    const ratioKind = SYNTH_RATIO_KIND[u.pathname];
    if (synth && ratioKind) {
      const rows = synthRatios(ratioKind, u.searchParams.get("period") ?? "1h", q, synth.ratios ?? "flat", clock());
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows) });
    }
    if (u.pathname === "/fapi/v1/klines") {
      const iv = u.searchParams.get("interval") ?? "1h";
      const limit = Number(u.searchParams.get("limit") ?? 500);
      // daily bars keep the exchange's 00:00 UTC grid: the fixture's day of `baseTime` (its forming bar) becomes the
      // mocked "today" – a bar off the grid reads to the Lage as a missing daily close (1ba7f81)
      const D = INTERVAL_MS["1d"];
      const shift = iv === "1d" ? (Math.floor((file.baseTime + delta()) / D) - Math.floor(file.baseTime / D)) * D : delta();
      const rows = extendKlines(shiftTimes(readJson<KlineRow[]>(`binance-klines-${iv}.json`), shift) as KlineRow[], iv, opts.klineBars ?? 500);
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows.slice(-limit)) });
    }
    if (u.pathname.startsWith("/futures/data/")) {
      const name = BINANCE_ROUTES[u.pathname];
      if (!name) return route.fulfill({ status: 404, body: "{}" });
      const limit = Number(u.searchParams.get("limit") ?? 30);
      const rows = extendFuturesData(shiftTimes(readJson<Record<string, string>[]>(name), delta()) as Record<string, string>[], opts.klineBars ?? 500);
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows.slice(-limit)) });
    }
    const hit = BINANCE_ROUTES[u.pathname];
    if (!hit) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: -1, msg: "not mocked" }) });
    return json(route, hit);
  });

  await page.route("https://api.bybit.com/**", async (route) => {
    const u = new URL(route.request().url());
    if ((file.rest.bybit ?? file.rest.mode) === "offline") return route.abort("failed");
    if (synth && u.pathname === "/v5/market/kline") {
      // Bybit: interval codes, `start` / `end`, newest row first, strings
      const iv = BYBIT_INTERVAL[u.searchParams.get("interval") ?? "60"] ?? "1h";
      const rows = synthKlines(iv, { limit: num(u.searchParams.get("limit")) ?? 200, startTime: num(u.searchParams.get("start")), endTime: num(u.searchParams.get("end")) }, anchor, clock(), synth.shape);
      const list = rows.map((r) => [String(r[0]), r[1], r[2], r[3], r[4], r[5], r[7]]).reverse();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ retCode: 0, retMsg: "OK", result: { category: "linear", symbol: "BTCUSDT", list }, time: clock() }) });
    }
    const hit = BYBIT_ROUTES[u.pathname];
    if (!hit) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ retCode: 10001, retMsg: "not mocked", result: {} }) });
    return json(route, hit);
  });

  await page.route("**/api/binance/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>SPA</title>" }));
  await page.route("https://www.okx.com/**", (route) => route.abort("failed"));

  const fixtures: Record<string, unknown> = {};
  for (const step of [...file.ws.steps, ...(file.ws.reconnectSteps ?? [])]) if (step.fixture && !fixtures[step.fixture]) fixtures[step.fixture] = shiftTimes(readJson(step.fixture), delta0);

  await page.addInitScript(
    ({ file, fixtures }: { file: ScenarioFile; fixtures: Record<string, unknown> }) => {
      let connections = 0;
      // Numeric `data.E` patches are OFFSETS in ms from the moment the socket was created (the scenario's own
      // clock), never absolute timestamps: the provider derives `asOf` from the event time.
      const applyPatch = (obj: unknown, patch: Record<string, string | number> | undefined, t0: number) => {
        const copy = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
        // A real stream stamps every event with the wall clock: align the event time (and the trade time of
        // aggTrade) to "now" unless the scenario patches them explicitly. Kline open times / funding times stay.
        const data = copy.data as Record<string, unknown> | undefined;
        if (data && typeof data.E === "number" && !(patch && "data.E" in patch)) data.E = Date.now();
        if (data && data.e === "aggTrade" && typeof data.T === "number" && !(patch && "data.T" in patch)) data.T = Date.now();
        for (const [path, v] of Object.entries(patch ?? {})) {
          const parts = path.split(".");
          let cur: Record<string, unknown> = copy;
          for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
          cur[parts[parts.length - 1]!] = typeof v === "number" && path.endsWith("E") ? v + t0 : v;
        }
        return copy;
      };
      class FakeWebSocket extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = 0;
        url: string;
        onopen: ((ev: Event) => void) | null = null;
        onmessage: ((ev: MessageEvent) => void) | null = null;
        onclose: ((ev: CloseEvent) => void) | null = null;
        onerror: ((ev: Event) => void) | null = null;
        private timers: number[] = [];
        constructor(url: string) {
          super();
          this.url = url;
          const n = connections++;
          const t0 = Date.now();
          const mode = n === 0 ? "first" : file.ws.reconnect ?? "ok";
          const steps = n === 0 ? file.ws.steps : mode === "ok" ? file.ws.reconnectSteps ?? file.ws.steps : mode === "fail" ? [{ t: 50, type: "close", code: 1006 } as WsStep] : file.ws.steps;
          for (const step of steps) {
            this.timers.push(
              window.setTimeout(() => {
                if (this.readyState === 3) return;
                if (step.type === "open") {
                  this.readyState = 1;
                  const ev = new Event("open");
                  this.onopen?.(ev);
                  this.dispatchEvent(ev);
                } else if (step.type === "message") {
                  const data = JSON.stringify(applyPatch(fixtures[step.fixture!], step.patch, t0));
                  const ev = new MessageEvent("message", { data });
                  this.onmessage?.(ev);
                  this.dispatchEvent(ev);
                } else if (step.type === "close") {
                  this.readyState = 3;
                  const ev = new CloseEvent("close", { code: step.code ?? 1006 });
                  this.onclose?.(ev);
                  this.dispatchEvent(ev);
                }
                // "silence": nothing happens; the client must detect it
              }, step.t),
            );
          }
        }
        send(): void {
          /* the client never sends */
        }
        close(code = 1000): void {
          if (this.readyState === 3) return;
          this.readyState = 3;
          for (const t of this.timers) window.clearTimeout(t);
          const ev = new CloseEvent("close", { code });
          this.onclose?.(ev);
          this.dispatchEvent(ev);
        }
      }
      // P09 (additive): Supabase Realtime keeps the browser's WebSocket – `mocks/supabase.ts` answers it via
      // `page.routeWebSocket`; every market socket stays scripted as before
      const NativeWebSocket = window.WebSocket;
      const SelectWebSocket = function (this: unknown, url: string | URL, protocols?: string | string[]) {
        return /\.supabase\.co\//.test(String(url)) ? new NativeWebSocket(url, protocols) : new FakeWebSocket(String(url));
      } as unknown as typeof FakeWebSocket;
      Object.assign(SelectWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
      SelectWebSocket.prototype = FakeWebSocket.prototype;
      Object.defineProperty(window, "WebSocket", { value: SelectWebSocket, configurable: true, writable: true });
      Object.defineProperty(window, "__marketScenario", { value: file.name, configurable: true });
    },
    { file, fixtures },
  );

  return file;
}
