/**
 * GET /api/v1/congress/ptr?year=2026&docs=20035143,20034836 – up to four Periodic Transaction Reports read into rows
 * (`CongressPtrPayload`, `src/market/congress/wire.ts`): who (the filing's owner column), asset, ticker, buy or sell, option strike
 * and expiry, trade date, amount range, the link to the original PDF. Public data; only a year and document numbers go in.
 *
 * The server downloads each PDF from disclosures-clerk.house.gov, reads its text (`_lib/congress/pdf.ts`, no dependency) and turns
 * the table into rows (`src/market/congress/ptr.ts`). A row that cannot be read cleanly is an `ok: false` row with the reason, a
 * report that cannot be read as a whole (scanned paper form, changed layout, password) is `status: "unreadable"` with the reason –
 * the app shows both as "nicht lesbar" with the link to the PDF. A report that cannot be FETCHED is reported on its own entry
 * (`not-found | timeout | upstream | busy`), the others in the same request still come back. Nothing is guessed.
 * Reports are kept in memory (a posted PTR never changes). Guard and cache header: as `congress-index`.
 */
import type { Config } from "@netlify/functions";
import { handler, requireMethod } from "./_lib/http";
import { loadReports, parseDocs, parseYear } from "./_lib/congress/load";
import { stockGuard, stockJson } from "./_lib/stocks/guard";

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  await stockGuard(req, ctx, { scope: "congress-ptr", max: 240, windowSec: 600 });
  const q = new URL(req.url).searchParams;
  const year = parseYear(q.get("year"));
  const docs = parseDocs(q.get("docs"));
  const payload = await loadReports(year, docs);
  // a report that could not be fetched must not stick in the browser: only a complete answer is kept for an hour
  return stockJson(payload, Object.values(payload.results).every((r) => r.ok) ? 3600 : 0);
});

export const config: Config = { path: "/api/v1/congress/ptr", method: ["GET"] };
