// @vitest-environment node
/// <reference types="node" />
/**
 * The user's TradingView MCP connection on the server (B3) – start → TradingView sign-in → callback → read test → revoke, against the
 * in-memory Supabase fake and the MOCK of TradingView (`helpers/tvMock.ts`; NOT the real service). Checks what must hold in production:
 * without operator setup nothing starts ("Einrichtung nötig"), `state` is single use / expiring / stored hashed, the verifier and the tokens
 * are encrypted at rest and bound to user and field, the redirect target is fixed (no open redirect), tokens never leave the server or
 * reach a log, an expired access token is refreshed, a refused refresh marks the connection invalid, the read test calls one read tool only,
 * the plan error is said, two users never see each other's connection, revoke reaches TradingView (and says when it did not).
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mcpFn from "../../netlify/functions/connections-tradingview-mcp.mts";
import tvFn from "../../netlify/functions/connections-tradingview.mts";
import { decrypt } from "../../netlify/functions/_lib/crypto";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import { setTvMcpFetchForTests } from "../../netlify/functions/_lib/tvmcp/status";
import { fakeAdmin, type Row, type State } from "./helpers/connectFake";
import { CLIENT_ID, MCP_URL, REDIRECT, TvMock, type TvMockOptions } from "./helpers/tvMock";

type Ctx = Parameters<typeof mcpFn>[1];
const ctx = { ip: "203.0.113.7", params: {} } as unknown as Ctx;
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://journal.test";
const BASE = `${ORIGIN}/api/v1/connections/tradingview/mcp`;
const ORIGINAL_ENV = { ...process.env };
const NOW = Date.parse("2026-11-07T12:00:00Z");

let state: State;
let tv: TvMock;
let logs: string[];

const call = (method: string, path: string, auth = true) =>
  mcpFn(new Request(`${BASE}${path}`, { method, headers: auth ? { authorization: `Bearer ${JWT}` } : {} }), ctx);
const read = async (r: Response) => ({ status: r.status, body: (await r.json()) as Row });
const as = (user: string) => void (state.claims = { sub: user, role: "authenticated", aal: "aal1" });
const status = async () => (await read(await tvFn(new Request(`${ORIGIN}/api/v1/connections/tradingview`, { headers: { authorization: `Bearer ${JWT}` } }), ctx))).body.mcp as Row;

/** start → the user signs in at (mock) TradingView → the browser comes back to the callback */
async function connect(): Promise<{ state: string; redirect: Response }> {
  const start = await read(await call("POST", "/start"));
  expect(start.status).toBe(200);
  const grant = tv.authorize(String(start.body.url));
  const redirect = await call("GET", `/callback?code=${grant.code}&state=${grant.state}`, false);
  return { state: grant.state, redirect };
}

function boot(o: TvMockOptions = {}, env: Record<string, string | undefined> = {}) {
  tv = new TvMock(o);
  setTvMcpFetchForTests(tv.fetch);
  Object.assign(process.env, { EXCHANGE_ENC_KEY_V1: randomBytes(32).toString("base64"), SITE_ORIGIN: ORIGIN, TV_MCP_CLIENT_ID: CLIENT_ID, TV_MCP_URL: MCP_URL }, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  delete process.env.TV_MCP_SCOPES;
  delete process.env.TV_MCP_CLIENT_SECRET;
  state = { tables: { profiles: [{ id: U1, plan: "free", plan_status: "none", trial_end: null, tz: "Europe/Berlin" }] }, claims: { sub: U1, role: "authenticated", aal: "aal1" }, rpcCalls: [] };
  setSupabaseAdminForTests(fakeAdmin(state));
  logs = [];
  for (const m of ["error", "log", "warn"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  boot();
});

afterEach(() => {
  vi.useRealTimers();
  setSupabaseAdminForTests(null);
  setTvMcpFetchForTests(null);
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("operator setup", () => {
  it("without TV_MCP_CLIENT_ID every action answers 503 'Einrichtung nötig (Betreiber)' and nothing is stored or fetched", async () => {
    boot({}, { TV_MCP_CLIENT_ID: undefined });
    for (const [m, p] of [["POST", "/start"], ["POST", "/test"]] as const) {
      const r = await read(await call(m, p));
      expect(r.status, p).toBe(503);
      expect(r.body).toMatchObject({ error: { code: "tv_mcp_unconfigured", message: expect.stringContaining("Einrichtung nötig (Betreiber)") } });
    }
    expect(tv.calls).toEqual([]);
    expect(state.tables.tv_mcp_states ?? []).toEqual([]);
    expect(await status()).toMatchObject({ configured: false, connected: false, host: null });
  });

  it("without SITE_ORIGIN (no redirect address) or with a broken URL it is also 'not set up', and the status never names the missing variable", async () => {
    boot({}, { SITE_ORIGIN: undefined });
    expect((await call("POST", "/start")).status).toBe(503);
    expect(JSON.stringify(await status())).not.toMatch(/SITE_ORIGIN|TV_MCP/);
    boot({}, { TV_MCP_URL: "http://insecure.test/mcp" });
    expect((await call("POST", "/start")).status).toBe(503);
  });

  it("configured: the status says so and names the host", async () => {
    expect(await status()).toMatchObject({ configured: true, connected: false, host: "mcp.tradingview.test" });
  });

  it("the callback without setup is a 503 too (no redirect target to trust)", async () => {
    boot({}, { TV_MCP_CLIENT_ID: undefined });
    expect((await call("GET", "/callback?code=x&state=y", false)).status).toBe(503);
  });
});

describe("start", () => {
  it("returns the TradingView sign-in URL with PKCE S256 + state; the state is stored only as a hash, the verifier only encrypted", async () => {
    const r = await read(await call("POST", "/start"));
    const u = new URL(String(r.body.url));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe(REDIRECT);
    const st = u.searchParams.get("state")!;
    const rows = state.tables.tv_mcp_states!;
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(st);
    expect(rows[0]!.verifier_enc).toMatch(/^v1:/);
    expect(rows[0]!.expires_at).toBe(new Date(NOW + 10 * 60_000).toISOString());
    // the verifier is NOT in the URL the browser sees
    const verifier = decrypt(String(rows[0]!.verifier_enc), `${U1}:tv-mcp:verifier`);
    expect(r.body.url).not.toContain(verifier);
  });

  it("a second start replaces the first pending authorisation of that user", async () => {
    await call("POST", "/start");
    await call("POST", "/start");
    expect(state.tables.tv_mcp_states).toHaveLength(1);
  });

  it("needs a signed-in user; start / test / delete are 401 without a session", async () => {
    for (const [m, p] of [["POST", "/start"], ["POST", "/test"], ["DELETE", ""]] as const) expect((await call(m, p, false)).status, `${m} ${p}`).toBe(401);
  });

  it("an unreachable or mismatching TradingView is a plain 502, not a crash", async () => {
    boot({ noPkce: true });
    expect((await read(await call("POST", "/start"))).body).toMatchObject({ error: { code: "tv_mcp_unsupported_server" } });
    boot({ wrongIssuer: true });
    expect((await read(await call("POST", "/start"))).status).toBe(502);
  });
});

describe("callback", () => {
  it("success: 302 to the FIXED settings address, tokens stored encrypted and bound to user and field, status 'connected', no token anywhere else", async () => {
    const { redirect } = await connect();
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`${ORIGIN}/?tvmcp=ok#settings`);
    expect(redirect.headers.get("referrer-policy")).toBe("no-referrer");
    expect(redirect.headers.get("cache-control")).toBe("no-store");
    const row = state.tables.tv_mcp_connections![0]!;
    const at = tv.activeAccessTokens[0]!;
    const rt = tv.activeRefreshTokens[0]!;
    const dump = JSON.stringify(state.tables);
    expect(dump).not.toContain(at);
    expect(dump).not.toContain(rt);
    expect(decrypt(String(row.access_enc), `${U1}:tv-mcp:access`)).toBe(at);
    expect(decrypt(String(row.refresh_enc), `${U1}:tv-mcp:refresh`)).toBe(rt);
    // a blob moved to another user or another field does not decrypt
    expect(() => decrypt(String(row.access_enc), `${U2}:tv-mcp:access`)).toThrow();
    expect(() => decrypt(String(row.access_enc), `${U1}:tv-mcp:refresh`)).toThrow();
    expect(row).toMatchObject({ user_id: U1, client_id: CLIENT_ID, resource: MCP_URL, status: "active", scope: "mcp:read mcp:tools" });
    expect(state.tables.tv_mcp_states).toHaveLength(0); // single use: consumed
    const s = await status();
    expect(s).toMatchObject({ configured: true, connected: true, status: "active", lastTestAt: null });
    expect(JSON.stringify(s)).not.toContain(at);
    expect(JSON.stringify(s)).not.toMatch(/access_enc|refresh_enc|verifier/);
    expect(logs.join("\n")).not.toContain(at);
    expect(logs.join("\n")).not.toContain(rt);
    expect(JSON.stringify(state.tables.audit_log)).not.toContain(at);
  });

  it("the same callback URL a second time (replay) changes nothing: 'fehler', no second exchange", async () => {
    const start = await read(await call("POST", "/start"));
    const g = tv.authorize(String(start.body.url));
    const url = `/callback?code=${g.code}&state=${g.state}`;
    expect((await call("GET", url, false)).headers.get("location")).toContain("tvmcp=ok");
    const exchanges = tv.tokenRequests.length;
    expect((await call("GET", url, false)).headers.get("location")).toContain("tvmcp=fehler");
    expect(tv.tokenRequests.length).toBe(exchanges);
  });

  it("an unknown, malformed or expired state is 'fehler' and starts no exchange", async () => {
    expect((await call("GET", "/callback?code=c&state=nope", false)).headers.get("location")).toBe(`${ORIGIN}/?tvmcp=fehler#settings`);
    expect((await call("GET", `/callback?code=c&state=${"A".repeat(43)}`, false)).headers.get("location")).toContain("fehler");
    expect((await call("GET", "/callback", false)).headers.get("location")).toContain("fehler");
    const start = await read(await call("POST", "/start"));
    const g = tv.authorize(String(start.body.url));
    vi.setSystemTime(NOW + 11 * 60_000);
    expect((await call("GET", `/callback?code=${g.code}&state=${g.state}`, false)).headers.get("location")).toContain("fehler");
    expect(tv.tokenRequests).toHaveLength(0);
    expect(state.tables.tv_mcp_connections ?? []).toHaveLength(0);
  });

  it("the user says no at TradingView: 'abgebrochen', nothing stored; whatever the query says is never reflected", async () => {
    const start = await read(await call("POST", "/start"));
    const g = tv.authorize(String(start.body.url));
    const r = await call("GET", `/callback?error=access_denied&error_description=%3Cscript%3E&state=${g.state}&redirect=https://evil.test&return_to=//evil.test`, false);
    expect(r.headers.get("location")).toBe(`${ORIGIN}/?tvmcp=abgebrochen#settings`);
    expect(await r.text()).toBe("");
    expect(state.tables.tv_mcp_connections ?? []).toHaveLength(0);
  });

  it("every outcome redirects to SITE_ORIGIN only (no open redirect)", async () => {
    for (const q of ["code=c&state=x&redirect_uri=https://evil.test", "redirect=https://evil.test", "state=" + "B".repeat(43) + "&next=//evil.test"]) {
      const loc = (await call("GET", `/callback?${q}`, false)).headers.get("location") ?? "";
      expect(loc.startsWith(`${ORIGIN}/?tvmcp=`)).toBe(true);
      expect(loc).not.toContain("evil");
    }
  });

  it("the sign-in can only be completed with the verifier of that start (a callback with another state's code fails)", async () => {
    const s1 = await read(await call("POST", "/start"));
    const g1 = tv.authorize(String(s1.body.url));
    // an attacker's code that was issued for a different challenge, combined with the victim's state
    const attackerChallenge = "x".repeat(43);
    const evil = tv.authorize(`${String(s1.body.url).replace(/code_challenge=[^&]+/, `code_challenge=${attackerChallenge}`)}`);
    const r = await call("GET", `/callback?code=${evil.code}&state=${g1.state}`, false);
    expect(r.headers.get("location")).toContain("tvmcp=fehler");
    expect(state.tables.tv_mcp_connections ?? []).toHaveLength(0);
  });

  it("TradingView refusing the exchange (invalid_grant) ends in 'fehler' and logs no code", async () => {
    const start = await read(await call("POST", "/start"));
    const g = tv.authorize(String(start.body.url));
    const r = await call("GET", `/callback?code=${g.code}-tampered&state=${g.state}`, false);
    expect(r.headers.get("location")).toContain("tvmcp=fehler");
    expect(logs.join("\n")).not.toContain(g.code);
    expect(logs.join("\n")).not.toContain(g.state);
  });
});

describe("read test", () => {
  it("calls ONE read tool, reports tools and watchlists, records the test on the connection", async () => {
    await connect();
    const r = await read(await call("POST", "/test"));
    expect(r).toEqual({ status: 200, body: { ok: true, tools: 3, watchlists: 2 } });
    expect(tv.toolCalls).toEqual(["list_watchlists"]);
    expect(await status()).toMatchObject({ connected: true, lastTestOk: true, lastTestAt: new Date(NOW).toISOString(), lastError: null });
  });

  it("an access token that ends within a minute is refreshed first, the new pair is stored (rotation), the old refresh token is dead", async () => {
    boot({ expiresIn: 30 });
    await connect();
    const rt1 = tv.activeRefreshTokens[0]!;
    const r = await read(await call("POST", "/test"));
    expect(r.status).toBe(200);
    expect(tv.tokenRequests.map((p) => p.get("grant_type"))).toEqual(["authorization_code", "refresh_token"]);
    expect(tv.activeRefreshTokens).not.toContain(rt1);
    const row = state.tables.tv_mcp_connections![0]!;
    expect(decrypt(String(row.refresh_enc), `${U1}:tv-mcp:refresh`)).toBe(tv.activeRefreshTokens[0]);
    expect(JSON.stringify(state.tables)).not.toContain(tv.activeRefreshTokens[0]!);
  });

  it("a refused refresh marks the connection invalid with a plain reason; the next test says 'Verbinde neu' without calling TradingView again", async () => {
    boot({ expiresIn: 30, refuseRefresh: true });
    await connect();
    const r = await read(await call("POST", "/test"));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: { code: "tv_mcp_invalid_grant", message: expect.stringContaining("Verbinde neu") } });
    expect(await status()).toMatchObject({ connected: false, status: "invalid", lastTestOk: false, lastError: expect.stringContaining("Verbinde neu") });
    const calls = tv.calls.length;
    const again = await read(await call("POST", "/test"));
    expect(again.status).toBe(409);
    expect(tv.calls.length).toBe(calls);
  });

  it("a token TradingView no longer accepts (401) marks the connection invalid", async () => {
    await connect();
    tv.expireAccessTokens();
    const r = await read(await call("POST", "/test"));
    expect(r.status).toBe(409);
    expect(await status()).toMatchObject({ status: "invalid", connected: false });
  });

  it("a plan without MCP access: 403 with the plan hint, the connection stays active", async () => {
    boot({ plan403: true });
    await connect();
    const r = await read(await call("POST", "/test"));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ error: { code: "tv_mcp_plan_required", message: expect.stringContaining("Essential") } });
    expect(await status()).toMatchObject({ status: "active", lastTestOk: false });
  });

  it("rate limit of TradingView: 429; not connected at all: 409", async () => {
    expect((await read(await call("POST", "/test"))).status).toBe(409);
    boot({ rate429: true });
    await connect();
    expect((await read(await call("POST", "/test"))).status).toBe(429);
  });

  it("a broken key ring (tokens not decryptable) invalidates the connection instead of sending garbage", async () => {
    await connect();
    process.env.EXCHANGE_ENC_KEY_V1 = randomBytes(32).toString("base64");
    const r = await read(await call("POST", "/test"));
    expect(r.status).toBe(409);
    expect(await status()).toMatchObject({ status: "invalid" });
    expect(tv.authHeaders).toEqual([]);
  });
});

describe("isolation and revocation", () => {
  it("another user sees no connection and cannot test or revoke it", async () => {
    await connect();
    as(U2);
    expect(await status()).toMatchObject({ connected: false });
    expect((await read(await call("POST", "/test"))).status).toBe(409);
    await call("DELETE", "");
    as(U1);
    expect(await status()).toMatchObject({ connected: true });
  });

  it("delete: revokes refresh and access token at TradingView, deletes the rows, says revoked: true", async () => {
    await connect();
    const at = tv.activeAccessTokens[0]!;
    const rt = tv.activeRefreshTokens[0]!;
    const r = await read(await call("DELETE", ""));
    expect(r).toEqual({ status: 200, body: { ok: true, revoked: true } });
    expect(tv.revoked.sort()).toEqual([at, rt].sort());
    expect(tv.activeAccessTokens).toEqual([]);
    expect(state.tables.tv_mcp_connections).toHaveLength(0);
    expect(await status()).toMatchObject({ connected: false, status: null });
    expect((await read(await call("POST", "/test"))).status).toBe(409);
  });

  it("delete when TradingView cannot be reached or refuses: the tokens are gone HERE anyway, and the answer says revoked: false", async () => {
    boot({ revokeFails: true });
    await connect();
    const r = await read(await call("DELETE", ""));
    expect(r.body).toEqual({ ok: true, revoked: false });
    expect(state.tables.tv_mcp_connections).toHaveLength(0);
  });

  it("delete without a connection is fine (idempotent)", async () => {
    expect((await read(await call("DELETE", ""))).body).toMatchObject({ ok: true, revoked: false });
  });

  it("start / test / delete write audit rows without any token, code or state", async () => {
    const { state: st } = await connect();
    await call("POST", "/test");
    await call("DELETE", "");
    const actions = (state.tables.audit_log ?? []).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["connection.tvmcp.start", "connection.tvmcp.connect", "connection.tvmcp.disconnect"]));
    const dump = JSON.stringify(state.tables.audit_log);
    expect(dump).not.toContain(st);
    expect(dump).not.toMatch(/at-\d|rt-\d|code-\d/);
  });

  it("only the documented methods; an unknown sub-path is 404", async () => {
    expect((await call("GET", "")).status).toBe(405);
    expect((await call("PUT", "/start")).status).toBe(405);
    expect((await call("POST", "/nope")).status).toBe(404);
  });
});
