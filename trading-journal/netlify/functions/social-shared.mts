/**
 * GET /api/v1/social/shared/:token (P12) – the PUBLIC read of one share link (`/#share/<token>`): no login, no cookie.
 * Only a valid token (not revoked, not expired) returns its redacted payload; every read counts a view
 * (`shared_payload()`, service role). 60 reads / 10 min per IP hash. The payload is re-validated before it is served
 * (strict schema – an old or tampered row is a 404, never raw JSON). `x-robots-tag: noindex` keeps links out of search.
 */
import type { Config, Context } from "@netlify/functions";
import { parseSharePayload, type SharedResponse } from "../../src/social/contract";
import { hashIp } from "./_lib/audit";
import { clientIp, handler, HttpError, json, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

const NOT_FOUND = () => new HttpError(404, "share_not_found", "Dieser Link ist abgelaufen oder wurde zurückgezogen.", undefined, { "x-robots-tag": "noindex" });

function tokenOf(req: Request, ctx: Context | undefined): string {
  const fromParams = (ctx as { params?: Record<string, string> } | undefined)?.params?.token;
  return fromParams ?? new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
}

interface SharedRow {
  kind: string;
  payload: unknown;
  created_at: string;
  expires_at: string | null;
  views: number;
}

export default handler(async (req, ctx) => {
  requireMethod(req, "GET");
  await enforceRateLimit(rateKey("social-shared", hashIp(clientIp(req, ctx)) ?? "anon"), 60, 600);
  const token = tokenOf(req, ctx);
  if (!/^[A-Za-z0-9_-]{22}$/.test(token)) throw NOT_FOUND();
  const { data, error } = await supabaseAdmin().rpc("shared_payload", { p_token: token });
  if (error) {
    console.error("[fn] shared_payload failed", error.code ?? "");
    throw new HttpError(502, "db_unavailable", "Die Datenbank antwortet gerade nicht.");
  }
  const row = ((Array.isArray(data) ? data : data ? [data] : []) as SharedRow[])[0];
  const payload = row ? parseSharePayload(row.payload) : null;
  if (!row || !payload) throw NOT_FOUND();
  const body: SharedResponse = { kind: payload.kind, payload, createdAt: row.created_at, expiresAt: row.expires_at, views: row.views };
  return json(body, { headers: { "x-robots-tag": "noindex" } });
});

export const config: Config = { path: "/api/v1/social/shared/:token", method: ["GET"] };
