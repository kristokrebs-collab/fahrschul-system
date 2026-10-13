/**
 * Personal REST API (P11, plan feature `apiAccess`).
 *
 * With a personal token (`Authorization: Bearer tj_…`):
 *   GET  /api/v1/trades[?since=<ISO | next>&limit=<1–500>]  (scope trades:read)  → `{ trades, next }`, oldest change
 *        first; `next` = the `since` of the next page (an opaque cursor over (updated_at, id), so a page boundary inside
 *        one sync chunk – all of its records share one updated_at – neither repeats nor skips trades; null once the
 *        last page is reached). Tombstones are left out.
 *   GET  /api/v1/trades/<id>                          (scope trades:read)  → `{ trade }`
 *   POST /api/v1/trades  `{ pair, side, date, … }`    (scope trades:write) → `{ id, created }` – insert-only; with
 *        `externalId` idempotent (`t_api_<externalId>`), the trader's later edits are never overwritten.
 * With the app session (Supabase JWT):
 *   GET    /api/v1/trades/tokens               → `{ tokens }` (prefix, name, scopes, last use – never the token)
 *   POST   /api/v1/trades/tokens `{ name, scopes }` → `{ token, info }` – the plain token, shown ONCE
 *   DELETE /api/v1/trades/tokens/<id>          → `{ ok }`
 * Token routes need aal2 when 2FA is on. 120 calls per 10 min per token / user.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { audit } from "./_lib/audit";
import { requireUser } from "./_lib/auth";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";
import { RestTrade, restTradeItem } from "./_lib/exchanges/inbound";
import { parseCursor, tradeDocPage, upsertSyncedTrades } from "./_lib/exchanges/store";
import { createToken, hashToken, listTokens, personalToken, resolveToken, revokeToken, TOKEN_SCOPES } from "./_lib/exchanges/tokens";

const TokenBody = z.object({
  name: z.string().trim().min(1).max(40),
  scopes: z.array(z.enum(TOKEN_SCOPES)).min(1).max(3),
});

const BASE = "/api/v1/trades";

async function tokenRoutes(req: Request, rest: string[], ip: string | null): Promise<Response> {
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("api-tokens", user.id), 60, 600);
  const method = req.method.toUpperCase();
  if (rest.length === 1 && method === "GET") return json({ tokens: await listTokens(user.id) });
  if (rest.length === 1 && method === "POST") {
    await requireFeature(user.id, "apiAccess");
    const body = await readJson(req, TokenBody, { maxBytes: 1024 });
    const out = await createToken(user.id, body.name, [...new Set(body.scopes)]);
    await audit(user.id, "api.token.create", { prefix: out.info.prefix, scopes: out.info.scopes }, ip);
    return json(out, { status: 201 });
  }
  if (rest.length === 2 && method === "DELETE") {
    if (!z.string().uuid().safeParse(rest[1]).success) throw new HttpError(404, "token_not_found", "Diesen Token gibt es nicht.");
    if (!(await revokeToken(user.id, rest[1]!))) throw new HttpError(404, "token_not_found", "Diesen Token gibt es nicht.");
    await audit(user.id, "api.token.revoke", { id: rest[1] }, ip);
    return json({ ok: true });
  }
  throw new HttpError(405, "method_not_allowed");
}

export default handler(async (req, ctx) => {
  requireMethod(req, "GET", "POST", "DELETE");
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const rest = path.startsWith(BASE) ? path.slice(BASE.length).split("/").filter(Boolean) : [];
  if (rest[0] === "tokens") return tokenRoutes(req, rest, clientIp(req, ctx));

  const token = personalToken(req);
  if (!token) throw new HttpError(401, "unauthenticated", "Bitte einen API-Token senden (Authorization: Bearer tj_…).");
  await enforceRateLimit(rateKey("api-trades", hashToken(token).slice(0, 24)), 120, 600);
  const method = req.method.toUpperCase();
  const owner = await resolveToken(token, method === "POST" ? "trades:write" : "trades:read");
  await requireFeature(owner.userId, "apiAccess");
  const sb = supabaseAdmin();

  if (method === "GET" && rest.length === 0) {
    const cursor = parseCursor(url.searchParams.get("since"));
    if (cursor === undefined) throw new HttpError(400, "invalid_since", "Ungültiger Zeitpunkt.");
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    const page = await tradeDocPage(owner.userId, cursor, limit, { what: "rest" });
    return json({ trades: page.rows.map((r) => ({ ...r.data, id: r.id })), next: page.more ? page.next : null });
  }
  if (method === "GET" && rest.length === 1) {
    const { data, error } = await sb.from("journal_docs").select("id,data,deleted").eq("user_id", owner.userId).eq("kind", "trade").eq("id", rest[0]!).maybeSingle();
    if (error) throw new HttpError(500, "db_error");
    const row = data as { id: string; data: Record<string, unknown>; deleted: boolean } | null;
    if (!row || row.deleted) throw new HttpError(404, "trade_not_found", "Diesen Trade gibt es nicht.");
    return json({ trade: { ...row.data, id: row.id } });
  }
  if (method === "POST" && rest.length === 0) {
    const body = await readJson(req, RestTrade, { maxBytes: 16 * 1024 });
    const item = restTradeItem(body, { nowMs: Date.now(), botName: owner.name });
    const res = await upsertSyncedTrades(owner.userId, [item]);
    return json({ id: item.id, created: res[item.id] === "inserted" }, { status: res[item.id] === "inserted" ? 201 : 200 });
  }
  throw new HttpError(405, "method_not_allowed");
});

export const config: Config = { path: ["/api/v1/trades", "/api/v1/trades/*"], method: ["GET", "POST", "DELETE"] };
