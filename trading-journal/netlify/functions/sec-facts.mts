/**
 * /api/v1/sec/facts – the reported numbers of a US-listed company from SEC EDGAR (XBRL "company facts"), reduced to the
 * concepts the earnings analyst, the DCF and the thesis monitor read (F68 / F69).
 *
 *   GET `?ticker=AAPL` (or `?cik=320193`) → `SecFactsPayload`: `{ source: "sec-edgar", ticker, cik, entity, sourceUrl, fetchedAt,
 *     asOf, cached, stale?, facts: { "us-gaap:Revenues": { unit, rows: [{ start?, end, val, fy, fp, form, filed, accn }] } } }`
 *
 * The server only fetches and reduces; it computes nothing (single quarters, growth and margins are `src/domain/analyst`).
 * Guards: signed-in user, plan feature `stockAnalysis` (Pro; not gated while payments are not set up), 30 calls / 10 min per
 * user. Without `SEC_USER_AGENT` the answer is the typed 503 `sec_setup_required` ("Einrichtung nötig") and SEC is not called.
 * SEC allows 10 requests per second: see `_lib/sec.ts` (account-wide window, spacing, cache, stale copy when SEC is down).
 * Errors: `sec_setup_required` 503, `sec_unknown_ticker` 404, `sec_no_facts` 404, `sec_busy` 429, `sec_timeout` 504,
 *   `sec_upstream` 502, `sec_invalid` 502, `invalid_query` 422.
 */
import type { Config } from "@netlify/functions";
import { requireUser } from "./_lib/auth";
import { handler, json, requireMethod } from "./_lib/http";
import { requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { loadFacts, secUserAgent } from "./_lib/sec";

export default handler(async (req) => {
  requireMethod(req, "GET");
  const user = await requireUser(req);
  // the operator's set-up comes first: without it nothing below can work, and no quota is spent
  secUserAgent();
  await requireFeature(user.id, "stockAnalysis");
  await enforceRateLimit(rateKey("sec-facts", user.id), 30, 600);
  const q = new URL(req.url).searchParams;
  const payload = await loadFacts({ ticker: q.get("ticker"), cik: q.get("cik") });
  return json(payload, { headers: { "cache-control": "private, max-age=300" } });
});

export const config: Config = { path: "/api/v1/sec/facts", method: ["GET"] };
