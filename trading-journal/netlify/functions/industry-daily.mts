/**
 * GET /api/v1/industry/daily – the daily returns of the 48 US industries from Kenneth R. French's data library, packed small
 * (`IndustryDailyPayload`, `src/market/industry/wire.ts`). Public research data; nothing travels in, nothing personal comes out,
 * no secret is involved. The file is updated about once a month and ends one to two months behind – it is no real-time feed.
 *
 * The library is a university website without any promise: it can be down, slow or change its file. That is answered honestly
 * (typed errors, `stale: true` with the original read time when an older copy is served) – never with invented numbers.
 * Guard: the same as the other public-data stock functions (`stockGuard`: plan gate once payments are on, rate limit per user or
 * pseudonymised IP). Errors: `industry_timeout` 504, `industry_upstream` 502, `industry_format` 502, `rate_limited` 429.
 * The answer is kept by the browser for an hour (`private`).
 */
import type { Config } from "@netlify/functions";
import { handler, requireMethod } from "./_lib/http";
import { loadIndustries } from "./_lib/industry/load";
import { stockGuard, stockJson } from "./_lib/stocks/guard";

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  await stockGuard(req, ctx, { scope: "industry-daily", max: 20, windowSec: 600 });
  const payload = await loadIndustries();
  return stockJson(payload, payload.stale ? 0 : 3600);
});

export const config: Config = { path: "/api/v1/industry/daily", method: ["GET"] };
