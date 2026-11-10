/**
 * TradingView connection assistant (Paket Verbindungen, B3) – no OAuth: the trader's own TradingView alert posts to a
 * personal webhook address (`hooks-tradingview.mts`). This function manages that address and shows what arrived.
 *
 * GET    /api/v1/connections/tradingview → `{ hasToken, token, receipts, receiptsAvailable, signals, signalsAvailable, mcp, tradeAlerts, origin }`
 *        (`token` = prefix / dates only, never the secret; `tradeAlerts.allowed` = the plan lets trade alerts write the
 *        journal; the test signal works in every plan; `signals` = the last deliveries (processed / duplicate / rejected with the
 *        reason, `_lib/signals`); `mcp` = state of the OAuth connection to the official TradingView MCP, `connections-tradingview-mcp.mts`).
 * POST   /api/v1/connections/tradingview `{ action: "create" | "rotate" }` → `{ token, path, info }` 201 – the plain
 *        token ONLY here, once; `path` = `/api/v1/hooks/tradingview/<token>`. `rotate` revokes the old address first
 *        (alerts that still use it stop working at once and show up as "rejected" nowhere – they get 401).
 * DELETE /api/v1/connections/tradingview → `{ ok }` – revokes the address (disconnect).
 *
 * One address per user for this assistant (token name `TradingView-Assistent`, scope `webhook:tradingview` only). aal2
 * when 2FA is on; 60 calls per 10 min; the token never appears in logs or the audit trail (prefix only).
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { planIncludes } from "../../src/billing/plans";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { envOptional } from "./_lib/env";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { listReceipts } from "./_lib/connections/receipts";
import { listSignals } from "./_lib/signals/store";
import { mcpStatus } from "./_lib/tvmcp/status";
import { gatesOpen, planOf } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { createToken, listTokens, revokeToken, type TokenInfo } from "./_lib/exchanges/tokens";

export const TV_TOKEN_NAME = "TradingView-Assistent";
const Body = z.object({ action: z.enum(["create", "rotate"]) });

const isAssistantToken = (t: TokenInfo): boolean => t.name === TV_TOKEN_NAME && t.scopes.length === 1 && t.scopes[0] === "webhook:tradingview";

/** Public origin for the address shown to the user (`SITE_ORIGIN`, https only); null → the client uses its own origin. */
function siteOrigin(): string | null {
  const v = envOptional("SITE_ORIGIN")?.trim().replace(/\/+$/, "");
  return v && /^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(v) ? v : null;
}

export default handler(async (req, ctx) => {
  requireMethod(req, "GET", "POST", "DELETE");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("connections-tv", user.id), 60, 600);
  const method = req.method.toUpperCase();
  const mine = (await listTokens(user.id)).filter(isAssistantToken);

  if (method === "GET") {
    const [{ receipts, available }, plan, sig, mcp] = await Promise.all([listReceipts(user.id, 10), planOf(user.id), listSignals(user.id, 20), mcpStatus(user.id)]);
    const current = mine[0] ?? null;
    return json({
      hasToken: !!current,
      token: current ? { id: current.id, prefix: current.prefix, createdAt: current.createdAt, lastUsedAt: current.lastUsedAt } : null,
      receipts,
      receiptsAvailable: available,
      signals: sig.signals,
      signalsAvailable: sig.available,
      mcp,
      tradeAlerts: { allowed: gatesOpen() || planIncludes(plan.plan, "apiAccess"), plan: plan.plan },
      origin: siteOrigin(),
    });
  }

  if (method === "DELETE") {
    let n = 0;
    for (const t of mine) if (await revokeToken(user.id, t.id)) n++;
    await audit(user.id, "connection.tv.disconnect", { revoked: n }, clientIp(req, ctx));
    return json({ ok: true });
  }

  const { action } = await readJson(req, Body, { maxBytes: 256 });
  if (action === "create" && mine.length) throw new HttpError(409, "token_exists", "Es gibt schon eine Zieladresse. Mit „Neue Adresse“ ersetzt du sie.");
  for (const t of mine) await revokeToken(user.id, t.id);
  const out = await createToken(user.id, TV_TOKEN_NAME, ["webhook:tradingview"]);
  await audit(user.id, action === "rotate" ? "connection.tv.rotate" : "connection.tv.create", { prefix: out.info.prefix }, clientIp(req, ctx));
  return json({ token: out.token, path: `/api/v1/hooks/tradingview/${out.token}`, info: out.info }, { status: 201 });
});

export const config: Config = { path: "/api/v1/connections/tradingview", method: ["GET", "POST", "DELETE"] };
