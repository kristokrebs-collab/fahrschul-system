/**
 * Storage and use of the user's TradingView MCP connection (Paket B3; tables `tv_mcp_states` and `tv_mcp_connections`, migration 0013).
 *  - the pending authorisation: `state` (only its hash is stored), the PKCE verifier (AES-256-GCM, AAD `<user>:tv-mcp:verifier`), 10 minutes,
 *    SINGLE USE (`consumeState` deletes the row whether or not the exchange then works);
 *  - the connection: access and refresh token encrypted like the exchange keys (`_lib/crypto.ts`, AAD `<user>:tv-mcp:access|refresh`), so a
 *    ciphertext copied to another row or column does not decrypt; never returned to a client, never logged;
 *  - `accessTokenFor`: the access token, refreshed (and the new tokens stored) when it expires within a minute; a refresh the server refuses
 *    marks the connection `invalid` ("Verbinde neu") instead of retrying forever.
 */
import { decrypt, encrypt } from "../crypto";
import { HttpError } from "../http";
import { supabaseAdmin } from "../supabase";
import { discover, hashState, refreshTokens, STATE_TTL_MS, TvMcpError, type FetchLike, type OAuthConfig, type TokenSet } from "./oauth";

const aad = (userId: string, field: "verifier" | "access" | "refresh"): string => `${userId}:tv-mcp:${field}`;

export interface McpConnectionInfo {
  connected: boolean;
  status: "active" | "invalid" | null;
  scope: string | null;
  lastError: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  createdAt: string | null;
}

export const NO_CONNECTION: McpConnectionInfo = { connected: false, status: null, scope: null, lastError: null, lastTestAt: null, lastTestOk: null, createdAt: null };

/** Starts an authorisation: forgets this user's older pending ones and expired ones, stores the new one. */
export async function saveState(userId: string, state: string, verifier: string, nowMs: number): Promise<void> {
  const sb = supabaseAdmin();
  await sb.from("tv_mcp_states").delete().eq("user_id", userId);
  await sb.from("tv_mcp_states").delete().lt("expires_at", new Date(nowMs).toISOString());
  const { error } = await sb.from("tv_mcp_states").insert({ state_hash: hashState(state), user_id: userId, verifier_enc: encrypt(verifier, aad(userId, "verifier")), expires_at: new Date(nowMs + STATE_TTL_MS).toISOString() });
  if (error) throw new HttpError(500, "db_error");
}

/** The user and verifier behind a `state`; the row is deleted either way (single use). `null` for an unknown or expired state. */
export async function consumeState(state: string, nowMs: number): Promise<{ userId: string; verifier: string } | null> {
  const sb = supabaseAdmin();
  const key = hashState(state);
  const { data, error } = await sb.from("tv_mcp_states").select("state_hash,user_id,verifier_enc,expires_at").eq("state_hash", key).maybeSingle();
  if (error) throw new HttpError(500, "db_error");
  if (!data) return null;
  await sb.from("tv_mcp_states").delete().eq("state_hash", key);
  const r = data as { user_id: string; verifier_enc: string; expires_at: string };
  if (Date.parse(r.expires_at) < nowMs) return null;
  try {
    return { userId: r.user_id, verifier: decrypt(r.verifier_enc, aad(r.user_id, "verifier")) };
  } catch {
    return null;
  }
}

/** `renewal`: the tokens were refreshed – keep the result of the last read test and the status. */
export async function saveConnection(userId: string, cfg: OAuthConfig, resource: string, t: TokenSet, nowMs: number, renewal = false): Promise<void> {
  const row = {
    user_id: userId,
    client_id: cfg.clientId,
    scope: t.scope ?? cfg.scope,
    resource,
    access_enc: encrypt(t.accessToken, aad(userId, "access")),
    refresh_enc: t.refreshToken ? encrypt(t.refreshToken, aad(userId, "refresh")) : null,
    expires_at: t.expiresAt === null ? null : new Date(t.expiresAt).toISOString(),
    ...(renewal ? {} : { status: "active", last_error: null, last_test_at: null, last_test_ok: null }),
    updated_at: new Date(nowMs).toISOString(),
  };
  const { error } = await supabaseAdmin().from("tv_mcp_connections").upsert(row, { onConflict: "user_id" });
  if (error) throw new HttpError(500, "db_error");
}

interface StoredConnection {
  user_id: string;
  client_id: string;
  scope: string | null;
  resource: string;
  access_enc: string;
  refresh_enc: string | null;
  expires_at: string | null;
  status: "active" | "invalid";
  last_error: string | null;
  last_test_at: string | null;
  last_test_ok: boolean | null;
  created_at: string;
}

async function getStored(userId: string): Promise<StoredConnection | null> {
  const { data, error } = await supabaseAdmin().from("tv_mcp_connections").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new HttpError(500, "db_error");
  return (data as StoredConnection | null) ?? null;
}

export async function connectionInfo(userId: string): Promise<McpConnectionInfo> {
  try {
    const r = await getStored(userId);
    if (!r) return NO_CONNECTION;
    return { connected: r.status === "active", status: r.status, scope: r.scope, lastError: r.last_error, lastTestAt: r.last_test_at, lastTestOk: r.last_test_ok, createdAt: r.created_at };
  } catch {
    // a missing table (migration 0013 not applied) reads as "not connected"
    return NO_CONNECTION;
  }
}

export async function markConnection(userId: string, patch: { status?: "active" | "invalid"; last_error?: string | null; last_test_at?: string; last_test_ok?: boolean }): Promise<void> {
  await supabaseAdmin().from("tv_mcp_connections").update({ ...patch, updated_at: new Date().toISOString() }).eq("user_id", userId);
}

/** The stored tokens, decrypted (for the revocation at TradingView) – then `deleteConnection`. */
export async function storedTokens(userId: string): Promise<{ access: string | null; refresh: string | null } | null> {
  const r = await getStored(userId);
  if (!r) return null;
  const dec = (blob: string | null, f: "access" | "refresh"): string | null => {
    if (!blob) return null;
    try {
      return decrypt(blob, aad(userId, f));
    } catch {
      return null;
    }
  };
  return { access: dec(r.access_enc, "access"), refresh: dec(r.refresh_enc, "refresh") };
}

export async function deleteConnection(userId: string): Promise<void> {
  await supabaseAdmin().from("tv_mcp_connections").delete().eq("user_id", userId);
  await supabaseAdmin().from("tv_mcp_states").delete().eq("user_id", userId);
}

/** A usable access token (refreshed when it ends within a minute). Throws a `TvMcpError` that says what to do. */
export async function accessTokenFor(userId: string, cfg: OAuthConfig, f: FetchLike, nowMs: number): Promise<{ token: string; resource: string }> {
  const r = await getStored(userId);
  if (!r) throw new TvMcpError("token_rejected", "TradingView ist nicht verbunden.");
  if (r.status === "invalid") throw new TvMcpError("token_rejected", r.last_error ?? "Die Verbindung ist abgelaufen. Verbinde neu.");
  let access: string;
  try {
    access = decrypt(r.access_enc, aad(userId, "access"));
  } catch {
    await markConnection(userId, { status: "invalid", last_error: "Die gespeicherte Verbindung ist nicht lesbar. Verbinde neu." });
    throw new TvMcpError("token_rejected", "Die gespeicherte Verbindung ist nicht lesbar. Verbinde neu.");
  }
  const endsSoon = r.expires_at !== null && Date.parse(r.expires_at) - nowMs < 60_000;
  if (!endsSoon) return { token: access, resource: r.resource };
  let refresh: string | null;
  try {
    refresh = r.refresh_enc ? decrypt(r.refresh_enc, aad(userId, "refresh")) : null;
  } catch {
    refresh = null;
  }
  if (!refresh) {
    await markConnection(userId, { status: "invalid", last_error: "Der Zugang ist abgelaufen. Verbinde neu." });
    throw new TvMcpError("token_rejected", "Der Zugang ist abgelaufen. Verbinde neu.");
  }
  try {
    const meta = await discover(cfg.resourceUrl, f);
    const t = await refreshTokens(meta, cfg, refresh, f, nowMs);
    await saveConnection(userId, cfg, r.resource, { ...t, scope: t.scope ?? r.scope }, nowMs, true);
    return { token: t.accessToken, resource: r.resource };
  } catch (e) {
    if (e instanceof TvMcpError && e.code === "invalid_grant") {
      await markConnection(userId, { status: "invalid", last_error: e.message });
    }
    throw e;
  }
}
