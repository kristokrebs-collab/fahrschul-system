/**
 * GET /api/v1/congress/index?year=2026 – the Periodic Transaction Reports (PTR) the House Clerk lists for a year: who filed,
 * when, and the document number (`CongressIndexPayload`, `src/market/congress/wire.ts`). Public data under the STOCK Act; the
 * only things that travel are a year and (in the answer) names, dates and document numbers. The Senate has no automatic route.
 *
 * The Clerk is an agency website without any promise: it can be down, slow or change its file. That is answered honestly
 * (typed errors, `stale: true` with the original read time when an older copy is served) – never with invented filings.
 * Guard: the same as the other public-data stock functions (`stockGuard`: plan gate once payments are on, rate limit per user or
 * pseudonymised IP). Errors: `congress_no_index` 404, `congress_busy` 429, `congress_timeout` 504, `congress_upstream` 502,
 * `congress_format` 502, `invalid_query` 400. The answer is kept by the browser for 5 minutes (`private`).
 */
import type { Config } from "@netlify/functions";
import { handler, requireMethod } from "./_lib/http";
import { loadIndex, parseYear } from "./_lib/congress/load";
import { stockGuard, stockJson } from "./_lib/stocks/guard";

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  await stockGuard(req, ctx, { scope: "congress-index", max: 60, windowSec: 600 });
  const year = parseYear(new URL(req.url).searchParams.get("year"));
  const payload = await loadIndex(year);
  return stockJson(payload, payload.stale ? 0 : 300);
});

export const config: Config = { path: "/api/v1/congress/index", method: ["GET"] };
