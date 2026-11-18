/**
 * POST /api/v1/signals/:token (Paket B3) – the signal receiver. The personal address of the trader (scope `webhook:tradingview`,
 * created in Einstellungen → Verbindungen → TradingView) identifies them; TradingView cannot send headers, so the token is in the URL.
 * Body: `signal/1`, the Branchen-Trend alert (`branchen-trend/1`) or the older `{"action":"open"|"close"}` message – see
 * `_lib/signals/schema.ts`. TradingView posts valid JSON as application/json and everything else as text/plain: both are read as text.
 * No order size exists in any of these formats, and nothing here sends an order.
 *
 * Answers: 200 `{ ok, result: "processed" | "duplicate" | "test" }` (a repeated signal answers 200, so the sender does not retry),
 * 422 `{ error: { code: "invalid_signal", message: <reason> } }` for a body the owner can fix (recorded with its reason), 413 above 8 KiB,
 * 429 over 60 / min per address (and 300 / min per caller), 401 – always the same text – for any wrong token.
 * Order of checks: rate limit → token → size → schema. The token never appears in a log, a response or the database.
 */
import type { Config, Context } from "@netlify/functions";
import { clientIp, handler, HttpError, json, requireMethod } from "./_lib/http";
import { readBodyLimited, receiveRateLimits, resolveSignalOwner } from "./_lib/signals/receive";
import { MAX_SIGNAL_BYTES } from "./_lib/signals/schema";
import { ingest } from "./_lib/signals/store";

function tokenOf(req: Request, ctx: Context | undefined): string {
  const fromParams = (ctx as { params?: Record<string, string> } | undefined)?.params?.token;
  return fromParams ?? new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
}

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const token = tokenOf(req, ctx);
  await receiveRateLimits(token, clientIp(req, ctx));
  const owner = await resolveSignalOwner(token);
  const body = await readBodyLimited(req, MAX_SIGNAL_BYTES);
  const wu = (ctx as { waitUntil?: (p: Promise<unknown>) => void } | undefined)?.waitUntil;
  const out = await ingest(owner.userId, body, Date.now(), wu ? (p) => wu.call(ctx, p) : undefined);
  if (out.http === 422) throw new HttpError(422, "invalid_signal", out.reason);
  return json({ ok: true, result: out.result, ...(out.signalId ? { signalId: out.signalId } : {}) });
});

export const config: Config = { path: "/api/v1/signals/:token", method: ["POST"] };
