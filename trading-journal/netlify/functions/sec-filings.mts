/**
 * /api/v1/sec/filings – the newest filings of a US-listed company from SEC EDGAR: the last ten of 10-Q, 10-K and 8-K (and
 * their amendments), the newest report, and the newest EARNINGS 8-K (item 2.02, "Results of Operations") with the link to
 * its press release (exhibit 99, found in the filing's folder listing). F68 uses it to match a quarter to its earnings release
 * and to notice a report that is newer than SEC's structured facts.
 *
 *   GET `?ticker=AAPL` (or `?cik=320193`) → `SecFilingsPayload`: `{ source, ticker, cik, entity, sourceUrl, fetchedAt, cached, stale?,
 *     filings[], report, earnings8k: { …filing, exhibitUrl } | null, earningsHistory[] }`
 *
 * Guards, set-up message and SEC limits are those of `sec-facts.mts` (`_lib/sec.ts`); 60 calls / 10 min per user.
 * The links point to sec.gov; nothing of a filing is fetched or stored except the folder listing of one 8-K.
 */
import type { Config } from "@netlify/functions";
import { requireUser } from "./_lib/auth";
import { handler, json, requireMethod } from "./_lib/http";
import { requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { loadFilings, secUserAgent } from "./_lib/sec";

export default handler(async (req) => {
  requireMethod(req, "GET");
  const user = await requireUser(req);
  secUserAgent();
  await requireFeature(user.id, "stockAnalysis");
  await enforceRateLimit(rateKey("sec-filings", user.id), 60, 600);
  const q = new URL(req.url).searchParams;
  const payload = await loadFilings({ ticker: q.get("ticker"), cik: q.get("cik") });
  return json(payload, { headers: { "cache-control": "private, max-age=300" } });
});

export const config: Config = { path: "/api/v1/sec/filings", method: ["GET"] };
