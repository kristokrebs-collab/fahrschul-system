/**
 * Personal API tokens (P11): REST access to the journal (`/api/v1/trades`) and the TradingView webhook URL
 * (`/api/v1/hooks/tradingview/<token>`). Format `tj_<43 base64url chars>` (256 bit). Only the SHA-256 is stored; the
 * plain token is shown once at creation. Lookups compare hashes, never the token itself.
 */
import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "../http";
import { supabaseAdmin } from "../supabase";

export const TOKEN_SCOPES = ["trades:read", "trades:write", "webhook:tradingview"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];
export const MAX_TOKENS = 10;

const TOKEN_RE = /^tj_[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string): string => createHash("sha256").update(`tj-token:${token}`, "utf8").digest("hex");

export function newToken(): { token: string; hash: string; prefix: string } {
  const token = `tj_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashToken(token), prefix: token.slice(0, 8) };
}

export const isTokenShape = (s: string): boolean => TOKEN_RE.test(s);

export interface TokenInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: TokenScope[];
  lastUsedAt: string | null;
  createdAt: string;
}

export interface TokenOwner {
  tokenId: string;
  userId: string;
  name: string;
  scopes: TokenScope[];
}

const TOKEN_COLUMNS = "id,name,prefix,scopes,last_used_at,created_at,revoked_at";

const info = (r: Record<string, unknown>): TokenInfo => ({
  id: String(r.id),
  name: String(r.name ?? ""),
  prefix: String(r.prefix),
  scopes: (Array.isArray(r.scopes) ? r.scopes : []) as TokenScope[],
  lastUsedAt: (r.last_used_at as string | null) ?? null,
  createdAt: String(r.created_at),
});

export async function listTokens(userId: string): Promise<TokenInfo[]> {
  const { data, error } = await supabaseAdmin().from("api_tokens").select(TOKEN_COLUMNS).eq("user_id", userId).is("revoked_at", null).order("created_at", { ascending: false });
  if (error) throw new HttpError(500, "db_error");
  return ((data ?? []) as Record<string, unknown>[]).map(info);
}

/** Creates a token; returns the plain token ONCE together with its metadata. */
export async function createToken(userId: string, name: string, scopes: TokenScope[]): Promise<{ token: string; info: TokenInfo }> {
  const existing = await listTokens(userId);
  if (existing.length >= MAX_TOKENS) throw new HttpError(409, "too_many_tokens", `Höchstens ${MAX_TOKENS} Tokens – widerrufe zuerst einen alten.`);
  const t = newToken();
  const { data, error } = await supabaseAdmin()
    .from("api_tokens")
    .insert({ user_id: userId, name, token_hash: t.hash, prefix: t.prefix, scopes })
    .select(TOKEN_COLUMNS)
    .single();
  if (error || !data) throw new HttpError(500, "db_error");
  return { token: t.token, info: info(data as Record<string, unknown>) };
}

export async function revokeToken(userId: string, id: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("id", id)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new HttpError(500, "db_error");
  return Array.isArray(data) && data.length > 0;
}

/** Owner of a token with `scope`; 401 for unknown / revoked tokens, 403 for a missing scope. Touches `last_used_at`. */
export async function resolveToken(token: string, scope: TokenScope): Promise<TokenOwner> {
  if (!isTokenShape(token)) throw new HttpError(401, "invalid_token", "Ungültiger API-Token.");
  const { data, error } = await supabaseAdmin().from("api_tokens").select("id,user_id,name,scopes,revoked_at").eq("token_hash", hashToken(token)).maybeSingle();
  if (error) throw new HttpError(500, "db_error");
  const r = data as { id: string; user_id: string; name: string; scopes: TokenScope[]; revoked_at: string | null } | null;
  if (!r || r.revoked_at) throw new HttpError(401, "invalid_token", "Ungültiger oder widerrufener API-Token.");
  if (!r.scopes.includes(scope)) throw new HttpError(403, "scope_missing", "Dieser Token darf das nicht.");
  await supabaseAdmin().from("api_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", r.id);
  return { tokenId: r.id, userId: r.user_id, name: r.name, scopes: r.scopes };
}

/** `Authorization: Bearer tj_…` → the token, else null (a JWT is not a personal token). */
export function personalToken(req: Request): string | null {
  const m = /^Bearer\s+(tj_[A-Za-z0-9_-]+)\s*$/i.exec(req.headers.get("authorization") ?? "");
  return m ? m[1]! : null;
}
