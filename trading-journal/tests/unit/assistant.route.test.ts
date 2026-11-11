// @vitest-environment node
/// <reference types="node" />
/**
 * F74 optional language router (`netlify/functions/assistant-route.mts`) against a fake Supabase admin client and a fake
 * Anthropic client: availability, auth, plan gate, rate limits, the request it sends (forced tool, only names and the
 * question), tool-output validation, refusals and API failures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import route, { buildPrompt, DEFAULT_ROUTER_MODEL, ROUTE_TOOL, setRouterClientForTests, type RouteInput } from "../../netlify/functions/assistant-route.mts";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof route>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const BODY: RouteInput = { question: "was lief gut diese woche", history: ["Win-Rate am Montag"], page: "overview", setups: ["Breakout", "Fade"], assets: ["BTC"] };

interface State {
  claims: Record<string, unknown> | null;
  rate: number;
  plan: string;
}
let state: State;

function fakeAdmin() {
  const client = {
    auth: {
      getClaims: vi.fn(async () => (state.claims ? { data: { claims: state.claims }, error: null } : { data: null, error: { message: "bad" } })),
      admin: { mfa: { listFactors: vi.fn(async () => ({ data: { factors: [] }, error: null })) } },
    },
    rpc: vi.fn(async (fn: string) => (fn === "rate_hit" ? { data: state.rate, error: null } : { data: null, error: { code: "42883" } })),
    from: () => {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { plan: state.plan, plan_status: state.plan === "free" ? "none" : "active", trial_end: null }, error: null }) };
      return q;
    },
  };
  setSupabaseAdminForTests(client as unknown as SupabaseClient);
  return client;
}

const toolUse = (input: unknown) => ({ type: "tool_use", id: "t1", name: ROUTE_TOOL.name, input }) as Anthropic.Beta.BetaContentBlock;

function fakeModel(reply: Partial<Anthropic.Beta.BetaMessage> | Error) {
  const create = vi.fn(async (_p: Anthropic.Beta.MessageCreateParams) => {
    if (reply instanceof Error) throw reply;
    return { model: DEFAULT_ROUTER_MODEL, stop_reason: "tool_use", content: [], ...reply } as Anthropic.Beta.BetaMessage;
  });
  setRouterClientForTests({ beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">);
  return create;
}

const post = (body: unknown = BODY, auth = true) =>
  route(new Request("https://x.test/api/v1/assistant/route", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${JWT}` } : {}) }, body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  state = { claims: { sub: U1, role: "authenticated", aal: "aal1" }, rate: 1, plan: "premium" };
  fakeAdmin();
  process.env.ANTHROPIC_API_KEY = "sk-test";
  delete process.env.ROUTER_MODEL;
  delete process.env.COACH_MODEL;
  delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
  setSupabaseAdminForTests(null);
  setRouterClientForTests(null);
  delete process.env.ANTHROPIC_API_KEY;
  vi.restoreAllMocks();
});

describe("assistant-route", () => {
  it("GET reports whether a key is set, without login", async () => {
    let res = await route(new Request("https://x.test/api/v1/assistant/route"), ctx);
    expect(await res.json()).toEqual({ enabled: true });
    delete process.env.ANTHROPIC_API_KEY;
    res = await route(new Request("https://x.test/api/v1/assistant/route"), ctx);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("needs a login and a key", async () => {
    expect((await post(BODY, false)).status).toBe(401);
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("assistant_ai_unavailable");
  });

  it("returns the canonical questions and sends only names and the question with a forced tool", async () => {
    const create = fakeModel({ content: [toolUse({ questions: ["Was ist mein bestes Setup?", "Was ist mein bestes Setup?", "Win-Rate diese Woche"], clarify: null })] });
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ questions: ["Was ist mein bestes Setup?", "Win-Rate diese Woche"], clarify: null, model: DEFAULT_ROUTER_MODEL });
    const p = create.mock.calls[0]![0] as unknown as Record<string, unknown> & { messages: { content: string }[] };
    expect(p.model).toBe(DEFAULT_ROUTER_MODEL);
    expect(p.tool_choice).toEqual({ type: "tool", name: "route" });
    expect(p.messages[0]!.content).toBe(buildPrompt(BODY));
    expect(p.messages[0]!.content).toContain("Breakout; Fade");
    expect(JSON.stringify(p)).not.toMatch(/pnl|USDT/i);
  });

  it("uses ROUTER_MODEL, then COACH_MODEL", async () => {
    const create = fakeModel({ content: [toolUse({ questions: ["Wie war letzte Woche?"] })] });
    process.env.COACH_MODEL = "coach-x";
    await post();
    expect((create.mock.calls[0]![0] as { model: string }).model).toBe("coach-x");
    process.env.ROUTER_MODEL = "router-y";
    await post();
    expect((create.mock.calls[1]![0] as { model: string }).model).toBe("router-y");
  });

  it("drops malformed tool output and reports `empty`", async () => {
    fakeModel({ content: [toolUse({ questions: "nope" })] });
    expect(await (await post()).json()).toMatchObject({ questions: [], clarify: null, reason: "empty" });
    fakeModel({ content: [] });
    expect(await (await post()).json()).toMatchObject({ reason: "empty" });
  });

  it("passes a clarification through", async () => {
    fakeModel({ content: [toolUse({ questions: [], clarify: "Meinst du diese Woche oder diesen Monat?" })] });
    expect(await (await post()).json()).toMatchObject({ questions: [], clarify: "Meinst du diese Woche oder diesen Monat?" });
  });

  it("reports a refusal", async () => {
    fakeModel({ stop_reason: "refusal" });
    expect(await (await post()).json()).toMatchObject({ reason: "refusal", questions: [] });
  });

  it("applies the plan gate and the rate limits", async () => {
    fakeModel({ content: [toolUse({ questions: ["x"] })] });
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_1";
    state.plan = "free";
    expect((await post()).status).toBe(402);
    state.plan = "premium";
    state.rate = 99;
    expect((await post()).status).toBe(429);
    delete process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  });

  it("validates the body", async () => {
    fakeModel({ content: [toolUse({ questions: ["x"] })] });
    expect((await post({ question: "" })).status).toBe(422);
    expect((await post({ question: "a".repeat(301) })).status).toBe(422);
  });

  it("maps API failures to German errors", async () => {
    fakeModel(new Anthropic.RateLimitError(429, undefined, "rate", new Headers()));
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("assistant_ai_busy");
    fakeModel(new Anthropic.AuthenticationError(401, undefined, "bad", new Headers()));
    expect((await post()).status).toBe(503);
  });
});
