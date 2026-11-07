/**
 * The user's own connection to the OFFICIAL TradingView MCP server (Paket B3): OAuth 2.1 with PKCE + state, tokens encrypted, revocable,
 * a read-only test. Built from TradingView's published metadata and tested against a MOCK server – see `_lib/tvmcp/oauth.ts` and docs/ENV.md.
 * Without `TV_MCP_CLIENT_ID` (+ `SITE_ORIGIN`) every call answers 503 `tv_mcp_unconfigured` ("Einrichtung nötig (Betreiber)").
 *
 * POST   /api/v1/connections/tradingview/mcp/start     → `{ url }` the TradingView sign-in page (the browser goes there)
 * GET    /api/v1/connections/tradingview/mcp/callback  ← TradingView sends the browser back (no session header: the single-use `state` names
 *                                                         the user); answers a 302 to `<SITE_ORIGIN>/?tvmcp=ok|abgebrochen|fehler#settings`
 *                                                         – a fixed target, never taken from the request
 * POST   /api/v1/connections/tradingview/mcp/test      → `{ ok, tools, watchlists }` the read test (initialize, tools/list, list_watchlists)
 * DELETE /api/v1/connections/tradingview/mcp           → `{ ok, revoked }` revokes at TradingView (best effort) and deletes the tokens here
 * The status of the connection is part of GET /api/v1/connections/tradingview (`mcp`). Start / test / delete: signed-in user, aal2 when 2FA
 * is on, rate limited, audited (no token, no code, no state in any log or audit row).
 */
import type { Config, Context } from "@netlify/functions";
import { audit, ipRateId } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { tvMcpConfig } from "./_lib/tvmcp/config";
import { disconnectTvMcp } from "./_lib/tvmcp/disconnect";
import { readTest } from "./_lib/tvmcp/mcpClient";
import { buildAuthorizeUrl, discover, exchangeCode, newState, pkcePair, stateShapeOk, TvMcpError } from "./_lib/tvmcp/oauth";
import { accessTokenFor, consumeState, markConnection, saveConnection, saveState } from "./_lib/tvmcp/store";
import { mcpFetch } from "./_lib/tvmcp/status";

function configured() {
  const c = tvMcpConfig();
  if (!c.ok) throw new HttpError(503, "tv_mcp_unconfigured", "Einrichtung nötig (Betreiber): Die Anbindung an den TradingView-MCP-Server ist hier noch nicht eingerichtet.");
  return c.config;
}

const toHttp = (e: unknown): never => {
  if (e instanceof TvMcpError) {
    const status = e.code === "plan_required" ? 403 : e.code === "rate_limited" ? 429 : e.code === "token_rejected" || e.code === "invalid_grant" ? 409 : 502;
    throw new HttpError(status, `tv_mcp_${e.code}`, e.message);
  }
  throw e;
};

export default handler(async (req, ctx) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const tail = path.slice(path.indexOf("/tradingview/mcp") + "/tradingview/mcp".length);

  if (tail === "/callback") return callback(req, ctx);

  requireMethod(req, "POST", "DELETE");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("tv-mcp", user.id), 30, 600);
  const ip = clientIp(req, ctx);
  const f = mcpFetch();

  if (req.method === "DELETE" && tail === "") {
    const { revoked } = await disconnectTvMcp(user.id);
    await audit(user.id, "connection.tvmcp.disconnect", { revokedAtProvider: revoked }, ip);
    return json({ ok: true, revoked });
  }

  if (req.method === "POST" && tail === "/start") {
    const cfg = configured();
    try {
      const meta = await discover(cfg.resourceUrl, f);
      const { verifier, challenge } = pkcePair();
      const state = newState();
      await saveState(user.id, state, verifier, Date.now());
      await audit(user.id, "connection.tvmcp.start", {}, ip);
      return json({ url: buildAuthorizeUrl(meta, cfg, state, challenge) });
    } catch (e) {
      return toHttp(e);
    }
  }

  if (req.method === "POST" && tail === "/test") {
    const cfg = configured();
    try {
      const { token } = await accessTokenFor(user.id, cfg, f, Date.now());
      const r = await readTest(cfg.resourceUrl, token, f);
      await markConnection(user.id, { last_test_at: new Date().toISOString(), last_test_ok: true, last_error: null });
      return json({ ok: true, tools: r.tools, watchlists: r.watchlists });
    } catch (e) {
      if (e instanceof TvMcpError) {
        const dead = e.code === "token_rejected" || e.code === "invalid_grant";
        await markConnection(user.id, { last_test_at: new Date().toISOString(), last_test_ok: false, last_error: e.message.slice(0, 200), ...(dead ? { status: "invalid" as const } : {}) }).catch(() => undefined);
      }
      return toHttp(e);
    }
  }

  throw new HttpError(404, "not_found");
});

/** TradingView sends the browser back here. Every outcome ends in a redirect to the fixed settings address – no request value is reflected. */
async function callback(req: Request, ctx: Context): Promise<Response> {
  requireMethod(req, "GET");
  const cfg = configured();
  const addr = ipRateId(clientIp(req, ctx));
  if (addr) await enforceRateLimit(rateKey("tv-mcp-cb", addr), 30, 600);
  const back = (result: "ok" | "abgebrochen" | "fehler"): Response =>
    new Response(null, { status: 302, headers: { location: `${cfg.siteOrigin}/?tvmcp=${result}#settings`, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  const q = new URL(req.url).searchParams;
  const state = q.get("state");
  if (!stateShapeOk(state)) return back("fehler");
  const pending = await consumeState(state, Date.now());
  if (!pending) return back("fehler");
  if (q.get("error")) {
    await audit(pending.userId, "connection.tvmcp.denied", {}, clientIp(req, ctx));
    return back("abgebrochen");
  }
  const code = q.get("code");
  if (!code || code.length > 2000) return back("fehler");
  try {
    const f = mcpFetch();
    const meta = await discover(cfg.resourceUrl, f);
    const tokens = await exchangeCode(meta, cfg, code, pending.verifier, f, Date.now());
    await saveConnection(pending.userId, cfg, meta.resource, tokens, Date.now());
    await audit(pending.userId, "connection.tvmcp.connect", { scope: tokens.scope }, clientIp(req, ctx));
    return back("ok");
  } catch (e) {
    console.error("[fn] tv-mcp callback failed", e instanceof TvMcpError ? e.code : e instanceof Error ? e.name : typeof e);
    return back("fehler");
  }
}

export const config: Config = { path: ["/api/v1/connections/tradingview/mcp", "/api/v1/connections/tradingview/mcp/*"], method: ["GET", "POST", "DELETE"] };
