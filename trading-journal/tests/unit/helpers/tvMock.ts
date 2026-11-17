// @vitest-environment node
/**
 * MOCK of the official TradingView MCP server and its authorization server (B3). It has the SHAPE of what TradingView publishes
 * (RFC 9728 protected-resource document on the MCP host, RFC 8414 server metadata with authorize / token / revoke endpoints, S256 PKCE,
 * scopes mcp:read / mcp:tools, MCP over streamable HTTP with JSON or event-stream answers) – but it is NOT TradingView: nothing here proves the
 * real service behaves the same. It checks what a correct server checks (PKCE challenge against the verifier, redirect address, client id,
 * `resource`, single-use codes, rotation of refresh tokens, Bearer on the MCP endpoint) so a wrong client fails here.
 */
import { createHash, randomBytes } from "node:crypto";

export const MCP_HOST = "https://mcp.tradingview.test";
export const MCP_URL = `${MCP_HOST}/mcp`;
export const ISSUER = "https://www.tradingview.test";
export const CLIENT_ID = "tj-app-client";
export const REDIRECT = "https://journal.test/api/v1/connections/tradingview/mcp/callback";

export interface TvMockOptions {
  /** `expires_in` of issued access tokens, seconds (default 3600) */
  expiresIn?: number;
  /** the MCP endpoint answers 403 (plan without MCP access) */
  plan403?: boolean;
  /** the MCP endpoint answers 429 */
  rate429?: boolean;
  /** MCP answers as an event stream instead of JSON */
  sse?: boolean;
  /** the authorization server offers no S256 */
  noPkce?: boolean;
  /** the metadata points the token endpoint to another host */
  foreignTokenEndpoint?: boolean;
  /** metadata `issuer` differs from the address it was fetched at */
  wrongIssuer?: boolean;
  /** protected-resource document names another resource */
  wrongResource?: boolean;
  /** no revocation endpoint */
  noRevoke?: boolean;
  /** the token endpoint refuses refresh tokens (`invalid_grant`) */
  refuseRefresh?: boolean;
  /** the revocation endpoint answers 500 */
  revokeFails?: boolean;
  /** the token endpoint answers with a tokens document of the wrong shape */
  badTokens?: boolean;
  /** how many watchlists `list_watchlists` returns */
  watchlists?: number;
}

interface CodeRec {
  challenge: string;
  clientId: string;
  redirect: string;
  resource: string;
  scope: string;
}

const b64u = (b: Buffer): string => b.toString("base64url");
const sha = (s: string): string => b64u(createHash("sha256").update(s, "ascii").digest());
const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export class TvMock {
  readonly opts: TvMockOptions;
  /** every request, "METHOD url" – the bodies of token requests are in `tokenRequests` */
  readonly calls: string[] = [];
  readonly tokenRequests: URLSearchParams[] = [];
  readonly revoked: string[] = [];
  readonly toolCalls: string[] = [];
  readonly authHeaders: string[] = [];
  private codes = new Map<string, CodeRec>();
  private access = new Map<string, { scope: string }>();
  private refresh = new Map<string, { scope: string }>();
  private n = 0;

  constructor(opts: TvMockOptions = {}) {
    this.opts = opts;
  }

  /** The user clicks "allow" on the sign-in page: returns what TradingView would redirect the browser to. Validates the request like a server. */
  authorize(url: string): { redirect: string; code: string; state: string } {
    const u = new URL(url);
    const p = u.searchParams;
    if (u.origin !== ISSUER || u.pathname !== "/mcp/oauth/authorize") throw new Error(`authorize endpoint wrong: ${u.origin}${u.pathname}`);
    const need = (k: string): string => {
      const v = p.get(k);
      if (!v) throw new Error(`missing ${k}`);
      return v;
    };
    if (need("response_type") !== "code") throw new Error("response_type");
    if (need("client_id") !== CLIENT_ID) throw new Error("client_id");
    if (need("code_challenge_method") !== "S256") throw new Error("code_challenge_method");
    if (need("redirect_uri") !== REDIRECT) throw new Error("redirect_uri");
    if (need("resource") !== MCP_URL) throw new Error("resource");
    const state = need("state");
    const code = `code-${++this.n}-${randomBytes(6).toString("hex")}`;
    this.codes.set(code, { challenge: need("code_challenge"), clientId: CLIENT_ID, redirect: REDIRECT, resource: MCP_URL, scope: p.get("scope") ?? "" });
    return { redirect: `${REDIRECT}?code=${code}&state=${state}`, code, state };
  }

  private issue(scope: string): Record<string, unknown> {
    const access = `at-${++this.n}-${randomBytes(8).toString("hex")}`;
    const refresh = `rt-${this.n}-${randomBytes(8).toString("hex")}`;
    this.access.set(access, { scope });
    this.refresh.set(refresh, { scope });
    return { access_token: access, token_type: "Bearer", expires_in: this.opts.expiresIn ?? 3600, refresh_token: refresh, scope };
  }

  /** Expires every access token (the next MCP call answers 401). */
  expireAccessTokens(): void {
    this.access.clear();
  }

  get activeAccessTokens(): string[] {
    return [...this.access.keys()];
  }
  get activeRefreshTokens(): string[] {
    return [...this.refresh.keys()];
  }

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = (init.method ?? "GET").toUpperCase();
    this.calls.push(`${method} ${url}`);
    if (init.redirect !== "error") throw new Error("the client must not follow redirects");
    const u = new URL(url);
    const o = this.opts;
    if (u.origin === MCP_HOST && u.pathname === "/.well-known/oauth-protected-resource/mcp") {
      return json(200, { resource: o.wrongResource ? `${MCP_HOST}/other` : MCP_URL, authorization_servers: [ISSUER], bearer_methods_supported: ["header"] });
    }
    if (u.origin === ISSUER && u.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: o.wrongIssuer ? "https://evil.test" : ISSUER,
        authorization_endpoint: `${ISSUER}/mcp/oauth/authorize`,
        token_endpoint: o.foreignTokenEndpoint ? "https://evil.test/token" : `${ISSUER}/mcp/oauth/token`,
        ...(o.noRevoke ? {} : { revocation_endpoint: `${ISSUER}/mcp/oauth/revoke` }),
        registration_endpoint: `${ISSUER}/mcp/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
        code_challenge_methods_supported: o.noPkce ? [] : ["S256"],
        scopes_supported: ["mcp:read", "mcp:tools"],
      });
    }
    if (u.origin === ISSUER && u.pathname === "/mcp/oauth/token" && method === "POST") return this.token(new URLSearchParams(String(init.body ?? "")));
    if (u.origin === ISSUER && u.pathname === "/mcp/oauth/revoke" && method === "POST") {
      if (o.revokeFails) return json(500, { error: "server_error" });
      const p = new URLSearchParams(String(init.body ?? ""));
      const t = p.get("token") ?? "";
      this.revoked.push(t);
      this.access.delete(t);
      this.refresh.delete(t);
      return new Response(null, { status: 200 });
    }
    if (u.origin === MCP_HOST && u.pathname === "/mcp") return this.mcp(method, init);
    return json(404, { detail: "Not found" });
  };

  private token(p: URLSearchParams): Response {
    this.tokenRequests.push(p);
    const grant = p.get("grant_type");
    if (p.get("client_id") !== CLIENT_ID) return json(401, { error: "invalid_client" });
    if (p.get("resource") !== MCP_URL) return json(400, { error: "invalid_target" });
    if (grant === "authorization_code") {
      const code = p.get("code") ?? "";
      const rec = this.codes.get(code);
      this.codes.delete(code); // single use
      if (!rec || rec.redirect !== p.get("redirect_uri") || sha(p.get("code_verifier") ?? "") !== rec.challenge) return json(400, { error: "invalid_grant" });
      if (this.opts.badTokens) return json(200, { access_token: 123, token_type: "mac" });
      return json(200, this.issue(rec.scope));
    }
    if (grant === "refresh_token") {
      const rt = p.get("refresh_token") ?? "";
      const rec = this.refresh.get(rt);
      if (this.opts.refuseRefresh || !rec) return json(400, { error: "invalid_grant" });
      this.refresh.delete(rt); // rotation
      return json(200, this.issue(rec.scope));
    }
    return json(400, { error: "unsupported_grant_type" });
  }

  private mcp(method: string, init: RequestInit): Response {
    const auth = new Headers(init.headers).get("authorization") ?? "";
    this.authHeaders.push(auth);
    if (method === "DELETE") return new Response(null, { status: 405 });
    const token = /^Bearer (.+)$/.exec(auth)?.[1] ?? "";
    if (!this.access.has(token)) return json(401, { detail: "This server requires OAuth authentication" }, { "www-authenticate": `Bearer resource_metadata="${MCP_HOST}/.well-known/oauth-protected-resource/mcp"` });
    if (this.opts.plan403) return json(403, { detail: "plan" });
    if (this.opts.rate429) return json(429, { detail: "slow down" });
    const msg = JSON.parse(String(init.body ?? "{}")) as { id?: number; method?: string; params?: { name?: string } };
    const reply = (result: unknown, headers: Record<string, string> = {}): Response =>
      this.opts.sse
        ? new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: msg.id, result })}\n\n`, { status: 200, headers: { "content-type": "text/event-stream", ...headers } })
        : json(200, { jsonrpc: "2.0", id: msg.id, result }, headers);
    if (msg.method === "initialize") return reply({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "0" } }, { "mcp-session-id": "sess-1" });
    if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (msg.method === "tools/list") return reply({ tools: [{ name: "list_watchlists" }, { name: "create_alert" }, { name: "get_ohlcv" }] });
    if (msg.method === "tools/call") {
      this.toolCalls.push(String(msg.params?.name));
      const n = this.opts.watchlists ?? 2;
      return reply({ content: [{ type: "text", text: JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Liste ${i + 1}` }))) }] });
    }
    return json(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "method not found" } });
  }
}
