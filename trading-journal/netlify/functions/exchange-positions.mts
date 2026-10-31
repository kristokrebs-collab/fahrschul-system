/**
 * GET /api/v1/exchange/positions → `{ positions, errors, at }` (P11; consumer: P05 exposure / margin / liquidation via
 * `useExchangePositions()`). Open positions of every active connection, read-only, with the mark price from the
 * public tickers (fallback: derived from the unrealized P&L). One failing venue does not hide the others – it is listed
 * in `errors` with a German message. 120 calls per 10 min; plan feature `exchangeSync`.
 */
import type { Config } from "@netlify/functions";
import { requireUser } from "./_lib/auth";
import { handler, json, requireMethod } from "./_lib/http";
import { requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { mapOpenPosition, type LivePosition } from "./_lib/exchanges/mapping";
import { adapterFor } from "./_lib/exchanges/registry";
import { credentialsOf, listConnections, loadConnection, rotateIfNeeded } from "./_lib/exchanges/store";
import { syncErrorMessage } from "./_lib/exchanges/sync";

export default handler(async (req) => {
  requireMethod(req, "GET");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("exchange-positions", user.id), 120, 600);
  await requireFeature(user.id, "exchangeSync");
  const positions: LivePosition[] = [];
  const errors: { connectionId: string; code: string; message: string }[] = [];
  for (const meta of await listConnections(user.id)) {
    if (meta.status !== "active") continue;
    try {
      const row = await loadConnection(user.id, meta.id);
      if (!row) continue;
      const creds = credentialsOf(row);
      const adapter = adapterFor(row.exchange, creds);
      const open = await adapter.fetchOpenPositions();
      await rotateIfNeeded(row, creds); // review KEY-01: the key worked → newest key version
      const tickers = open.length ? await adapter.fetchTickers(open.map((p) => p.symbol)).catch(() => []) : [];
      const now = Date.now();
      for (const p of open) positions.push(mapOpenPosition(p, row.exchange, tickers.find((t) => t.symbol === p.symbol), now, row.label || undefined));
    } catch (e) {
      const err = syncErrorMessage(e);
      errors.push({ connectionId: meta.id, code: err.code, message: err.message });
    }
  }
  return json({ positions, errors, at: new Date().toISOString() });
});

export const config: Config = { path: "/api/v1/exchange/positions", method: ["GET"] };
