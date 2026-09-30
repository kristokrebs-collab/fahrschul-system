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
}

export async function mockMarket(page: Page, scenario: MarketScenario, opts: MockMarketOptions = {}): Promise<ScenarioFile> {
  const file = readJson<ScenarioFile>(`ws-scenarios/${scenario}.json`);
  const delta = opts.shiftToNow === false ? 0 : Math.floor(Date.now() / 300_000) * 300_000 - file.baseTime;
  const json = async (route: Route, name: string, status = 200) => {
    if (opts.latencyMs) await new Promise((r) => setTimeout(r, opts.latencyMs));
    await route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(shiftTimes(readJson(name), delta)) });
  };

  await page.route("https://fapi.binance.com/**", async (route) => {
    const u = new URL(route.request().url());
    if (file.rest.mode === "offline") return route.abort("failed");
    if (file.rest.mode === "blocked_451") return route.abort("failed"); // 451 without CORS headers surfaces as TypeError
    if (u.pathname === "/fapi/v1/klines") {
      const iv = u.searchParams.get("interval") ?? "1h";
      const limit = Number(u.searchParams.get("limit") ?? 500);
      const rows = shiftTimes(readJson<unknown[]>(`binance-klines-${iv}.json`), delta) as unknown[];
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(rows.slice(-limit)) });
    }
    const hit = BINANCE_ROUTES[u.pathname];
    if (!hit) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: -1, msg: "not mocked" }) });
    return json(route, hit);
  });

  await page.route("https://api.bybit.com/**", async (route) => {
    const u = new URL(route.request().url());
    if ((file.rest.bybit ?? file.rest.mode) === "offline") return route.abort("failed");
    const hit = BYBIT_ROUTES[u.pathname];
    if (!hit) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ retCode: 10001, retMsg: "not mocked", result: {} }) });
    return json(route, hit);
  });

  await page.route("**/api/binance/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>SPA</title>" }));
  await page.route("https://www.okx.com/**", (route) => route.abort("failed"));

  const fixtures: Record<string, unknown> = {};
  for (const step of [...file.ws.steps, ...(file.ws.reconnectSteps ?? [])]) if (step.fixture && !fixtures[step.fixture]) fixtures[step.fixture] = shiftTimes(readJson(step.fixture), delta);

  await page.addInitScript(
    ({ file, fixtures, delta }: { file: ScenarioFile; fixtures: Record<string, unknown>; delta: number }) => {
      let connections = 0;
      const applyPatch = (obj: unknown, patch?: Record<string, string | number>) => {
        const copy = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
        for (const [path, v] of Object.entries(patch ?? {})) {
          const parts = path.split(".");
          let cur: Record<string, unknown> = copy;
          for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
          cur[parts[parts.length - 1]!] = typeof v === "number" && path.endsWith("E") ? v + Date.now() - (file.baseTime + delta) : v;
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
                  const data = JSON.stringify(applyPatch(fixtures[step.fixture!], step.patch));
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
      Object.defineProperty(window, "WebSocket", { value: FakeWebSocket, configurable: true, writable: true });
      Object.defineProperty(window, "__marketScenario", { value: file.name, configurable: true });
    },
    { file, fixtures, delta },
  );

  return file;
}
