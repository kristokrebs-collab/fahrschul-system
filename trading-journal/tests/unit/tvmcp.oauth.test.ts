// @vitest-environment node
/// <reference types="node" />
/**
 * OAuth 2.1 / MCP client towards the official TradingView MCP (B3) – ALL AGAINST A MOCK (`helpers/tvMock.ts`, the shape of TradingView's
 * published metadata; nothing here talks to the real service). Pure client: PKCE, state, discovery and its safety checks, the token calls,
 * revocation, and the read-only MCP session (JSON and event-stream answers, status mapping, the write tools it refuses to call).
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { McpSession, READ_ONLY_TOOLS, parseRpc, readTest } from "../../netlify/functions/_lib/tvmcp/mcpClient";
import { buildAuthorizeUrl, challengeOf, discover, exchangeCode, hashState, newState, pkcePair, refreshTokens, revokeToken, stateShapeOk, TvMcpError, wellKnownUrl, type OAuthConfig } from "../../netlify/functions/_lib/tvmcp/oauth";
import { CLIENT_ID, ISSUER, MCP_URL, REDIRECT, TvMock, type TvMockOptions } from "./helpers/tvMock";

const cfg: OAuthConfig = { clientId: CLIENT_ID, clientSecret: null, resourceUrl: MCP_URL, scope: "mcp:read mcp:tools", redirectUri: REDIRECT };
const NOW = Date.parse("2026-11-07T12:00:00Z");
const mock = (o: TvMockOptions = {}) => new TvMock(o);

describe("PKCE and state", () => {
  it("the verifier is 256 bit of randomness (43 URL-safe characters), the challenge is its S256", () => {
    const a = pkcePair();
    const b = pkcePair();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.challenge).toBe(createHash("sha256").update(a.verifier).digest("base64url"));
    expect(challengeOf(a.verifier)).toBe(a.challenge);
    expect(a.verifier).not.toBe(b.verifier);
    // RFC 7636 appendix B test vector
    expect(challengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("state is unguessable, has a fixed shape, and only its hash is meant to be stored", () => {
    const s = newState();
    expect(stateShapeOk(s)).toBe(true);
    expect(newState()).not.toBe(s);
    expect(hashState(s)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashState(s)).not.toContain(s);
    for (const bad of ["", "x", `${s}!`, `${s}${s}`, 5, null, undefined]) expect(stateShapeOk(bad)).toBe(false);
  });
});

describe("discovery (RFC 9728 → RFC 8414) and its safety checks", () => {
  it("the well-known address puts the path AFTER the well-known segment", () => {
    expect(wellKnownUrl("https://mcp.tradingview.com/mcp", "oauth-protected-resource")).toBe("https://mcp.tradingview.com/.well-known/oauth-protected-resource/mcp");
    expect(wellKnownUrl("https://www.tradingview.com", "oauth-authorization-server")).toBe("https://www.tradingview.com/.well-known/oauth-authorization-server");
  });

  it("finds the endpoints from the server URL; every request refuses redirects", async () => {
    const m = mock();
    const meta = await discover(MCP_URL, m.fetch);
    expect(meta).toMatchObject({ resource: MCP_URL, issuer: ISSUER, authorizationEndpoint: `${ISSUER}/mcp/oauth/authorize`, tokenEndpoint: `${ISSUER}/mcp/oauth/token`, revocationEndpoint: `${ISSUER}/mcp/oauth/revoke`, scopes: ["mcp:read", "mcp:tools"] });
    expect(m.calls).toHaveLength(2);
  });

  it("refuses http, a document that belongs to another resource or issuer, a token endpoint on a foreign host, and a server without S256", async () => {
    await expect(discover("http://mcp.tradingview.test/mcp", mock().fetch)).rejects.toMatchObject({ code: "discovery_failed", message: expect.stringContaining("https") });
    await expect(discover(MCP_URL, mock({ wrongResource: true }).fetch)).rejects.toMatchObject({ code: "discovery_failed" });
    await expect(discover(MCP_URL, mock({ wrongIssuer: true }).fetch)).rejects.toMatchObject({ code: "discovery_failed" });
    await expect(discover(MCP_URL, mock({ foreignTokenEndpoint: true }).fetch)).rejects.toMatchObject({ code: "discovery_failed", message: expect.stringContaining("fremden Server") });
    await expect(discover(MCP_URL, mock({ noPkce: true }).fetch)).rejects.toMatchObject({ code: "unsupported_server", message: expect.stringContaining("PKCE") });
  });

  it("an unreachable or broken metadata document is a plain German error, not an exception from fetch", async () => {
    const down = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(discover(MCP_URL, down)).rejects.toBeInstanceOf(TvMcpError);
    const html = async () => new Response("<html>", { status: 200 });
    await expect(discover(MCP_URL, html)).rejects.toMatchObject({ code: "discovery_failed" });
    const big = async () => new Response(" ".repeat(70_000), { status: 200 });
    await expect(discover(MCP_URL, big)).rejects.toMatchObject({ code: "discovery_failed" });
  });

  it("a revocation endpoint on a foreign host is dropped, not trusted", async () => {
    const m = mock();
    const meta = await discover(MCP_URL, async (u, i) => {
      const r = await m.fetch(u, i);
      if (!u.includes("oauth-authorization-server")) return r;
      const j = (await r.json()) as Record<string, unknown>;
      return new Response(JSON.stringify({ ...j, revocation_endpoint: "https://evil.test/revoke" }), { status: 200 });
    });
    expect(meta.revocationEndpoint).toBeNull();
  });
});

describe("authorisation request and token calls", () => {
  it("the authorize URL carries PKCE S256, state, the exact redirect address, scope, client id and the resource", async () => {
    const m = mock();
    const meta = await discover(MCP_URL, m.fetch);
    const { verifier, challenge } = pkcePair();
    const state = newState();
    const u = new URL(buildAuthorizeUrl(meta, cfg, state, challenge));
    expect(`${u.origin}${u.pathname}`).toBe(`${ISSUER}/mcp/oauth/authorize`);
    expect(Object.fromEntries(u.searchParams)).toEqual({ response_type: "code", client_id: CLIENT_ID, redirect_uri: REDIRECT, scope: "mcp:read mcp:tools", state, code_challenge: challenge, code_challenge_method: "S256", resource: MCP_URL });
    expect(u.toString()).not.toContain(verifier);
  });

  it("code → tokens: the server checks the verifier against the challenge; the request names the resource and sends no secret for a public client", async () => {
    const m = mock({ expiresIn: 600 });
    const meta = await discover(MCP_URL, m.fetch);
    const { verifier, challenge } = pkcePair();
    const { code } = m.authorize(buildAuthorizeUrl(meta, cfg, newState(), challenge));
    const t = await exchangeCode(meta, cfg, code, verifier, m.fetch, NOW);
    expect(t.accessToken).toMatch(/^at-/);
    expect(t.refreshToken).toMatch(/^rt-/);
    expect(t.expiresAt).toBe(NOW + 600_000);
    expect(t.scope).toBe("mcp:read mcp:tools");
    const body = m.tokenRequests[0]!;
    expect(Object.fromEntries(body)).toEqual({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: verifier, resource: MCP_URL });
  });

  it("a wrong verifier, a replayed code and a code from another request all fail with invalid_grant", async () => {
    const m = mock();
    const meta = await discover(MCP_URL, m.fetch);
    const a = pkcePair();
    const { code } = m.authorize(buildAuthorizeUrl(meta, cfg, newState(), a.challenge));
    await expect(exchangeCode(meta, cfg, code, pkcePair().verifier, m.fetch, NOW)).rejects.toMatchObject({ code: "invalid_grant" });
    // the code was burnt by the failed attempt (single use), even with the right verifier now
    await expect(exchangeCode(meta, cfg, code, a.verifier, m.fetch, NOW)).rejects.toMatchObject({ code: "invalid_grant" });
    await expect(exchangeCode(meta, cfg, "code-unknown", a.verifier, m.fetch, NOW)).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("a tokens document of the wrong shape, or an unreachable token endpoint, is a plain error – and no error message holds a token", async () => {
    const bad = mock({ badTokens: true });
    const meta = await discover(MCP_URL, bad.fetch);
    const p = pkcePair();
    const { code } = bad.authorize(buildAuthorizeUrl(meta, cfg, newState(), p.challenge));
    await expect(exchangeCode(meta, cfg, code, p.verifier, bad.fetch, NOW)).rejects.toMatchObject({ code: "token_failed" });
    await expect(exchangeCode(meta, cfg, "c", p.verifier, async () => Promise.reject(new Error("offline")), NOW)).rejects.toMatchObject({ code: "token_failed" });
  });

  it("a confidential client sends its secret as Basic (or in the body when the server only offers client_secret_post)", async () => {
    const seen: { auth: string | null; body: string }[] = [];
    const m = mock();
    const f = async (u: string, i?: RequestInit) => {
      if (u.endsWith("/token")) seen.push({ auth: new Headers(i?.headers).get("authorization"), body: String(i?.body) });
      return m.fetch(u, i);
    };
    const meta = await discover(MCP_URL, m.fetch);
    const secretCfg = { ...cfg, clientSecret: "s3cret/+=" };
    const p = pkcePair();
    const { code } = m.authorize(buildAuthorizeUrl(meta, secretCfg, newState(), p.challenge));
    await exchangeCode(meta, secretCfg, code, p.verifier, f, NOW);
    expect(seen[0]!.auth).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${encodeURIComponent("s3cret/+=")}`).toString("base64")}`);
    expect(seen[0]!.body).not.toContain("s3cret");
    const p2 = pkcePair();
    const { code: c2 } = m.authorize(buildAuthorizeUrl(meta, secretCfg, newState(), p2.challenge));
    await exchangeCode({ ...meta, secretInBody: true }, secretCfg, c2, p2.verifier, f, NOW);
    expect(seen[1]!.auth).toBeNull();
    expect(new URLSearchParams(seen[1]!.body).get("client_secret")).toBe("s3cret/+=");
  });

  it("refresh rotates the tokens (the old refresh token is dead); a refused refresh is invalid_grant", async () => {
    const m = mock();
    const meta = await discover(MCP_URL, m.fetch);
    const p = pkcePair();
    const { code } = m.authorize(buildAuthorizeUrl(meta, cfg, newState(), p.challenge));
    const t1 = await exchangeCode(meta, cfg, code, p.verifier, m.fetch, NOW);
    const t2 = await refreshTokens(meta, cfg, t1.refreshToken!, m.fetch, NOW + 1000);
    expect(t2.accessToken).not.toBe(t1.accessToken);
    expect(t2.refreshToken).not.toBe(t1.refreshToken);
    await expect(refreshTokens(meta, cfg, t1.refreshToken!, m.fetch, NOW)).rejects.toMatchObject({ code: "invalid_grant" });
    const refusing = mock({ refuseRefresh: true });
    await expect(refreshTokens(await discover(MCP_URL, refusing.fetch), cfg, "rt-x", refusing.fetch, NOW)).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("revocation: true when the server confirms, false when it fails, is offline or offers no endpoint – never throws", async () => {
    const m = mock();
    const meta = await discover(MCP_URL, m.fetch);
    const p = pkcePair();
    const { code } = m.authorize(buildAuthorizeUrl(meta, cfg, newState(), p.challenge));
    const t = await exchangeCode(meta, cfg, code, p.verifier, m.fetch, NOW);
    expect(await revokeToken(meta, cfg, t.refreshToken!, "refresh_token", m.fetch)).toBe(true);
    expect(m.revoked).toEqual([t.refreshToken]);
    const failing = mock({ revokeFails: true });
    expect(await revokeToken(await discover(MCP_URL, failing.fetch), cfg, "x", "access_token", failing.fetch)).toBe(false);
    expect(await revokeToken(meta, cfg, "x", "access_token", async () => Promise.reject(new Error("offline")))).toBe(false);
    const none = mock({ noRevoke: true });
    expect(await revokeToken(await discover(MCP_URL, none.fetch), cfg, "x", "access_token", none.fetch)).toBe(false);
  });
});

async function connected(o: TvMockOptions = {}) {
  const m = mock(o);
  const meta = await discover(MCP_URL, m.fetch);
  const p = pkcePair();
  const { code } = m.authorize(buildAuthorizeUrl(meta, cfg, newState(), p.challenge));
  const t = await exchangeCode(meta, cfg, code, p.verifier, m.fetch, NOW);
  return { m, t };
}

describe("MCP session: read only", () => {
  it("the read test (initialize → tools/list → list_watchlists) works over JSON and over an event stream, and calls ONLY list_watchlists", async () => {
    for (const sse of [false, true]) {
      const { m, t } = await connected({ sse, watchlists: 3 });
      const r = await readTest(MCP_URL, t.accessToken, m.fetch);
      expect(r).toEqual({ tools: 3, watchlists: 3 });
      expect(m.toolCalls).toEqual(["list_watchlists"]);
      expect(new Set(m.authHeaders)).toEqual(new Set([`Bearer ${t.accessToken}`]));
    }
  });

  it("a write tool (create_alert, update_alert, delete_alert, create_watchlist …) is refused BEFORE any request is made", async () => {
    const { m, t } = await connected();
    const s = new McpSession(MCP_URL, t.accessToken, m.fetch);
    await s.initialize();
    const before = m.calls.length;
    for (const w of ["create_alert", "update_alert", "delete_alert", "stop_alerts", "restart_alerts", "create_watchlist", "delete_watchlist", "add_to_watchlist", "remove_from_watchlist", "update_watchlist", "unknown_tool"]) {
      await expect(s.callTool(w, {}), w).rejects.toMatchObject({ code: "tool_not_allowed" });
    }
    expect(m.calls.length).toBe(before);
    expect(m.toolCalls).toEqual([]);
    for (const w of READ_ONLY_TOOLS) expect(w).not.toMatch(/^(create|update|delete|stop|restart|add|remove)_/);
  });

  it("401 → token rejected, 403 → plan (Essential and above), 429 → rate limit; each in plain German", async () => {
    const { m, t } = await connected();
    m.expireAccessTokens();
    await expect(readTest(MCP_URL, t.accessToken, m.fetch)).rejects.toMatchObject({ code: "token_rejected", message: expect.stringContaining("Verbinde neu") });
    const p = await connected({ plan403: true });
    await expect(readTest(MCP_URL, p.t.accessToken, p.m.fetch)).rejects.toMatchObject({ code: "plan_required", message: expect.stringContaining("Essential") });
    const r = await connected({ rate429: true });
    await expect(readTest(MCP_URL, r.t.accessToken, r.m.fetch)).rejects.toMatchObject({ code: "rate_limited", message: expect.stringContaining("100") });
  });

  it("an unreachable server and a tool error are plain errors", async () => {
    await expect(readTest(MCP_URL, "x", async () => Promise.reject(new Error("offline")))).rejects.toMatchObject({ code: "mcp_failed" });
    const { t } = await connected();
    const iserr = async (_u: string, i?: RequestInit) => {
      const msg = JSON.parse(String(i?.body ?? "{}")) as { id?: number; method?: string };
      if (msg.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (msg.method === "tools/call") return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [] } }), { status: 200, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    await expect(readTest(MCP_URL, t.accessToken, iserr)).rejects.toMatchObject({ code: "mcp_failed" });
  });

  it("parseRpc reads JSON, batches and event streams and ignores other events", () => {
    expect(parseRpc("application/json", `{"id":3,"result":{"a":1}}`, 3)).toMatchObject({ result: { a: 1 } });
    expect(parseRpc("application/json", `[{"id":1},{"id":3,"result":1}]`, 3)).toMatchObject({ result: 1 });
    expect(parseRpc("text/event-stream", `event: ping\ndata: {"id":9}\n\nevent: message\ndata: {"id":3,"result":2}\n\n`, 3)).toMatchObject({ result: 2 });
    expect(parseRpc("text/event-stream", `data: not json\n\n`, 3)).toBeNull();
    expect(parseRpc("application/json", "x", 3)).toBeNull();
  });
});
