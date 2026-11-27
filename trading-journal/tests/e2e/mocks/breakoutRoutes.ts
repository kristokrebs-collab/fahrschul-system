/**
 * Playwright: beantwortet die Abrufe des Scanners „Wer bricht aus?“ mit den Festkerzen aus `breakout.ts` – 5-Minuten-Klines OHNE
 * Startzeit für einen der zwölf Märkte (Binance direkt, sonst Bybit). Alles andere fällt an `mockMarket` durch (`route.fallback()`),
 * also NACH `seed` / `mockMarket` aufrufen. `mode`: wer gerade liefert (`offline` = niemand).
 */
import type { Page } from "@playwright/test";
import { BREAKOUT_SCENARIOS, breakoutBybitBody, breakoutKlineRows } from "./breakout";

export type BreakoutMode = "binance" | "bybit" | "offline";
const CORS = { "access-control-allow-origin": "*" };

export async function mockBreakout(page: Page, mode: () => BreakoutMode, now: () => number): Promise<{ binance: string[]; bybit: string[] }> {
  const log = { binance: [] as string[], bybit: [] as string[] };
  await page.route("https://fapi.binance.com/fapi/v1/klines?*", async (route) => {
    const u = new URL(route.request().url());
    const symbol = u.searchParams.get("symbol") ?? "";
    if (u.searchParams.get("interval") !== "5m" || u.searchParams.has("startTime") || !BREAKOUT_SCENARIOS[symbol]) return route.fallback();
    log.binance.push(symbol);
    if (mode() !== "binance") return route.abort("failed");
    return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(breakoutKlineRows(symbol, now(), Number(u.searchParams.get("limit") ?? 499))) });
  });
  await page.route("https://api.bybit.com/v5/market/kline?*", async (route) => {
    const u = new URL(route.request().url());
    const symbol = u.searchParams.get("symbol") ?? "";
    if (u.searchParams.get("interval") !== "5" || !BREAKOUT_SCENARIOS[symbol]) return route.fallback();
    log.bybit.push(symbol);
    if (mode() !== "bybit") return route.abort("failed");
    return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: JSON.stringify(breakoutBybitBody(symbol, now(), Number(u.searchParams.get("limit") ?? 499))) });
  });
  return log;
}
