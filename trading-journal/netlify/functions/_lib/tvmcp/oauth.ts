/**
 * OAuth 2.1 client for the OFFICIAL TradingView MCP server (Paket B3), one connection per user. Pure of storage: every network call goes
 * through an injected `fetch` (tests use a mock server), no clock besides `nowMs` arguments, no token is ever logged or put in an error.
 *
 * Where the endpoints come from (checked live on 07.11.2026, not invented – see docs/ENV.md):
 *   docs      https://www.tradingview.com/mcp/docs   → server URL, "Authentication is OAuth 2.1", plan "Essential and above" (no trials),
 *                                                      ~100 tool calls per minute and user. The page names NO endpoints and NO scopes.
 *   resource  https://mcp.tradingview.com/.well-known/oauth-protected-resource/mcp (RFC 9728) → `authorization_servers: [https://www.tradingview.com]`
 *   server    https://www.tradingview.com/.well-known/oauth-authorization-server (RFC 8414) → authorize / token / revoke / register endpoints,
 *             `code_challenge_methods_supported: ["S256"]`, `scopes_supported: ["mcp:read","mcp:tools"]`, public clients (`none`) allowed.
 * So the client DISCOVERS the endpoints at run time from the server URL (RFC 9728 → RFC 8414) instead of hard-coding them, and refuses a
 * server that offers no S256 PKCE. Discovery results are checked: https only, the metadata's `issuer` must equal the address it was fetched
 * for, every endpoint must live on the issuer's origin (a hostile metadata document cannot point the token request elsewhere).
 * `resource` (RFC 8707) is sent on the authorization and token requests, as the MCP authorization spec asks.
 */
import { createHash, randomBytes } from "node:crypto";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class TvMcpError extends Error {
  readonly code:
    | "unconfigured"
    | "discovery_failed"
    | "unsupported_server"
    | "token_failed"
    | "invalid_grant"
    | "state_invalid"
    | "token_rejected"
    | "plan_required"
    | "rate_limited"
    | "mcp_failed"
    | "tool_not_allowed";
  constructor(code: TvMcpError["code"], message: string) {
    super(message);
    this.name = "TvMcpError";
    this.code = code;
  }
}

export const DEFAULT_RESOURCE_URL = "https://mcp.tradingview.com/mcp";
/** Both scopes the server lists as supported. The app only ever calls read-only tools (`mcpClient.ts`). */
export const DEFAULT_SCOPE = "mcp:read mcp:tools";
export const STATE_TTL_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_META_BYTES = 64 * 1024;

export interface OAuthConfig {
  clientId: string;
  clientSecret: string | null;
  resourceUrl: string;
  scope: string;
  redirectUri: string;
}

export interface ServerMeta {
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string | null;
  scopes: string[];
  secretInBody: boolean;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** epoch ms, null when the server named no lifetime */
  expiresAt: number | null;
  scope: string | null;
}

/* ------------------------------------------------------------------------------------------------ PKCE and state */

const b64url = (b: Buffer): string => b.toString("base64url");

/** RFC 7636: a 256-bit verifier (43 characters) and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: challengeOf(verifier) };
}
export const challengeOf = (verifier: string): string => b64url(createHash("sha256").update(verifier, "ascii").digest());

/** An unguessable `state` (256 bit). Only its hash is stored. */
export const newState = (): string => b64url(randomBytes(32));
export const hashState = (state: string): string => createHash("sha256").update(`tj-tvmcp-state:${state}`, "utf8").digest("hex");
export const stateShapeOk = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{43}$/.test(s);

/* ------------------------------------------------------------------------------------------------ http helpers */

const isHttps = (u: string): boolean => {
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
};
const originOf = (u: string): string => new URL(u).origin;
const trimSlash = (u: string): string => u.replace(/\/+$/, "");

async function getJson(f: FetchLike, url: string): Promise<unknown> {
  const res = await f(url, { method: "GET", headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_META_BYTES) throw new Error("too large");
  return JSON.parse(text) as unknown;
}

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** RFC 9728 / RFC 8414 well-known location for a URL with a path: the segment goes BEFORE the path. */
export function wellKnownUrl(base: string, name: string): string {
  const u = new URL(base);
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.origin}/.well-known/${name}${path}`;
}

/** Finds the authorization server of `resourceUrl` and its endpoints. Throws a `TvMcpError` that says what was wrong, in words. */
export async function discover(resourceUrl: string, f: FetchLike): Promise<ServerMeta> {
  const bad = (m: string): TvMcpError => new TvMcpError("discovery_failed", m);
  if (!isHttps(resourceUrl)) throw bad("Die Adresse des TradingView-MCP-Servers muss mit https beginnen.");
  let prm: Record<string, unknown> | null;
  try {
    prm = obj(await getJson(f, wellKnownUrl(resourceUrl, "oauth-protected-resource")));
  } catch {
    throw bad("Der TradingView-MCP-Server nennt seinen Anmelde-Server nicht (oauth-protected-resource nicht erreichbar).");
  }
  if (!prm || typeof prm.resource !== "string" || trimSlash(prm.resource) !== trimSlash(resourceUrl)) throw bad("Die Beschreibung des MCP-Servers gehört nicht zu dieser Adresse.");
  const issuer = strs(prm.authorization_servers)[0];
  if (!issuer || !isHttps(issuer)) throw bad("Der MCP-Server nennt keinen gültigen Anmelde-Server (https).");
  let meta: Record<string, unknown> | null;
  try {
    meta = obj(await getJson(f, wellKnownUrl(issuer, "oauth-authorization-server")));
  } catch {
    throw bad("Der Anmelde-Server von TradingView beschreibt sich nicht (oauth-authorization-server nicht erreichbar).");
  }
  if (!meta || typeof meta.issuer !== "string" || trimSlash(meta.issuer) !== trimSlash(issuer)) throw bad("Die Beschreibung des Anmelde-Servers gehört nicht zu seiner Adresse.");
  const origin = originOf(issuer);
  const endpoint = (v: unknown): string | null => (typeof v === "string" && isHttps(v) && originOf(v) === origin ? v : null);
  const authorizationEndpoint = endpoint(meta.authorization_endpoint);
  const tokenEndpoint = endpoint(meta.token_endpoint);
  if (!authorizationEndpoint || !tokenEndpoint) throw bad("Die Anmelde-Adressen von TradingView fehlen oder liegen auf einem fremden Server.");
  if (!strs(meta.code_challenge_methods_supported).includes("S256")) throw new TvMcpError("unsupported_server", "Der Anmelde-Server bietet kein PKCE (S256) an – ohne das verbindet die App nicht.");
  const methods = strs(meta.token_endpoint_auth_methods_supported);
  return {
    resource: trimSlash(prm.resource),
    issuer: trimSlash(issuer),
    authorizationEndpoint,
    tokenEndpoint,
    revocationEndpoint: endpoint(meta.revocation_endpoint),
    scopes: strs(meta.scopes_supported),
    secretInBody: methods.includes("client_secret_post") && !methods.includes("client_secret_basic"),
  };
}

/* ------------------------------------------------------------------------------------------------ the three requests */

export function buildAuthorizeUrl(meta: ServerMeta, cfg: OAuthConfig, state: string, challenge: string): string {
  const u = new URL(meta.authorizationEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("resource", meta.resource);
  return u.toString();
}

async function postForm(f: FetchLike, url: string, params: Record<string, string>, cfg: OAuthConfig, meta: ServerMeta): Promise<Response> {
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (cfg.clientSecret) {
    if (meta.secretInBody) body.set("client_secret", cfg.clientSecret);
    else headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(cfg.clientId)}:${encodeURIComponent(cfg.clientSecret)}`).toString("base64")}`;
  }
  return f(url, { method: "POST", headers, body: body.toString(), redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

function tokensOf(json: unknown, nowMs: number, keepRefresh: string | null): TokenSet {
  const o = obj(json);
  const access = o && typeof o.access_token === "string" && o.access_token.length > 0 && o.access_token.length <= 6000 ? o.access_token : null;
  const type = o && typeof o.token_type === "string" ? o.token_type.toLowerCase() : "";
  if (!o || !access || type !== "bearer") throw new TvMcpError("token_failed", "TradingView hat keinen brauchbaren Zugang geliefert.");
  const refresh = typeof o.refresh_token === "string" && o.refresh_token.length > 0 && o.refresh_token.length <= 6000 ? o.refresh_token : keepRefresh;
  const ttl = typeof o.expires_in === "number" && Number.isFinite(o.expires_in) && o.expires_in > 0 ? Math.min(o.expires_in, 30 * 86_400) : null;
  return { accessToken: access, refreshToken: refresh, expiresAt: ttl === null ? null : nowMs + ttl * 1000, scope: typeof o.scope === "string" ? o.scope.slice(0, 200) : null };
}

/** The error code of a failed token request (`error` of RFC 6749, nothing else of the body is kept). */
async function failure(res: Response): Promise<TvMcpError> {
  let code = "";
  try {
    code = String(obj(JSON.parse((await res.text()).slice(0, 4000)))?.error ?? "");
  } catch {
    /* not JSON */
  }
  if (code === "invalid_grant") return new TvMcpError("invalid_grant", "TradingView hat den Zugang abgelehnt (abgelaufen oder widerrufen). Verbinde neu.");
  return new TvMcpError("token_failed", `TradingView hat die Anmeldung nicht angenommen${res.status ? ` (Status ${res.status})` : ""}.`);
}

export async function exchangeCode(meta: ServerMeta, cfg: OAuthConfig, code: string, verifier: string, f: FetchLike, nowMs: number): Promise<TokenSet> {
  const res = await postForm(f, meta.tokenEndpoint, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, client_id: cfg.clientId, code_verifier: verifier, resource: meta.resource }, cfg, meta).catch(() => null);
  if (!res) throw new TvMcpError("token_failed", "TradingView ist für die Anmeldung gerade nicht erreichbar.");
  if (!res.ok) throw await failure(res);
  return tokensOf(await res.json().catch(() => null), nowMs, null);
}

export async function refreshTokens(meta: ServerMeta, cfg: OAuthConfig, refreshToken: string, f: FetchLike, nowMs: number): Promise<TokenSet> {
  const res = await postForm(f, meta.tokenEndpoint, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId, resource: meta.resource }, cfg, meta).catch(() => null);
  if (!res) throw new TvMcpError("token_failed", "TradingView ist für die Erneuerung gerade nicht erreichbar.");
  if (!res.ok) throw await failure(res);
  return tokensOf(await res.json().catch(() => null), nowMs, refreshToken);
}

/** RFC 7009. `true` when the server confirmed (2xx); `false` for everything else (no endpoint, error, offline) – never throws. */
export async function revokeToken(meta: ServerMeta, cfg: OAuthConfig, token: string, hint: "access_token" | "refresh_token", f: FetchLike): Promise<boolean> {
  if (!meta.revocationEndpoint) return false;
  const res = await postForm(f, meta.revocationEndpoint, { token, token_type_hint: hint, client_id: cfg.clientId }, cfg, meta).catch(() => null);
  return !!res && res.ok;
}
