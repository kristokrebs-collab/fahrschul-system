// @vitest-environment node
/// <reference types="node" />
/**
 * Strategie-Studio · the optional server compile (`netlify/functions/strategy-compile.mts`) against a fake Supabase admin
 * client and a fake Anthropic client: availability, auth, plan gate, rate limits, the request it sends (forced tool, only
 * the strategy text), and – the point of it – that an answer is only passed on when it fits the rules schema and every
 * phrase it claims to have understood stands in the text. Nothing is repaired.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import compile, { DEFAULT_COMPILE_MODEL, setCompileClientForTests } from "../../netlify/functions/strategy-compile.mts";
import { AI_TOOL, buildSystemPrompt, buildUserPrompt, parseStrategyText, type AiOutput } from "../../src/domain/strategytext/index";
import { leavesOf } from "../../src/domain/lab/index";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof compile>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";
const TEXT = "Long wenn der RSI unter 30 fällt und der Kurs über der EMA 200 liegt, Stop 1,5 ATR";

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

const local = parseStrategyText(TEXT);
const [l1, l2] = leavesOf(local.rules.long);
const answer = (): AiOutput => ({
  rules: JSON.parse(JSON.stringify(local.rules)) as AiOutput["rules"],
  setup: { symbol: null, period: null, riskPct: null },
  understood: [
    { phrase: "RSI unter 30 fällt", ref: l1!.id },
    { phrase: "Kurs über der EMA 200 liegt", ref: l2!.id },
  ],
  unclear: [],
  questions: [],
  assumptions: ["Zeitrahmen 4h, weil keiner genannt wurde."],
});

const toolUse = (input: unknown) => ({ type: "tool_use", id: "t1", name: AI_TOOL.name, input }) as Anthropic.Beta.BetaContentBlock;

function fakeModel(reply: Partial<Anthropic.Beta.BetaMessage> | Error) {
  const create = vi.fn(async (_p: Anthropic.Beta.MessageCreateParams) => {
    if (reply instanceof Error) throw reply;
    return { model: DEFAULT_COMPILE_MODEL, stop_reason: "tool_use", content: [], ...reply } as Anthropic.Beta.BetaMessage;
  });
  setCompileClientForTests({ beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">);
  return create;
}

const post = (body: unknown = { text: TEXT }, auth = true) =>
  compile(new Request("https://x.test/api/v1/strategy/compile", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${JWT}` } : {}) }, body: JSON.stringify(body) }), ctx);

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
  setCompileClientForTests(null);
  delete process.env.ANTHROPIC_API_KEY;
  vi.restoreAllMocks();
});

describe("strategy-compile", () => {
  it("GET reports whether a key is set, without login", async () => {
    let res = await compile(new Request("https://x.test/api/v1/strategy/compile"), ctx);
    expect(await res.json()).toEqual({ enabled: true });
    delete process.env.ANTHROPIC_API_KEY;
    res = await compile(new Request("https://x.test/api/v1/strategy/compile"), ctx);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("needs a login and a key", async () => {
    expect((await post({ text: TEXT }, false)).status).toBe(401);
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("strategy_compile_unavailable");
  });

  it("returns the checked rules and sends only the strategy text with a forced tool", async () => {
    const create = fakeModel({ content: [toolUse(answer())] });
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.model).toBe(DEFAULT_COMPILE_MODEL);
    expect(body.result.rules.sides).toBe("long");
    expect(body.result.understood).toHaveLength(2);
    const p = create.mock.calls[0]![0] as unknown as Record<string, unknown> & { messages: { content: string }[] };
    expect(p.tool_choice).toEqual({ type: "tool", name: "compile_strategy" });
    expect(p.system).toBe(buildSystemPrompt());
    expect(p.messages).toHaveLength(1);
    expect(p.messages[0]!.content).toBe(buildUserPrompt(TEXT));
    expect(JSON.stringify(p.messages)).not.toMatch(/pnl|USDT|journal/i);
  });

  it("uses ROUTER_MODEL, then COACH_MODEL", async () => {
    const create = fakeModel({ content: [toolUse(answer())] });
    process.env.COACH_MODEL = "coach-x";
    await post();
    expect((create.mock.calls[0]![0] as { model: string }).model).toBe("coach-x");
    process.env.ROUTER_MODEL = "router-y";
    await post();
    expect((create.mock.calls[1]![0] as { model: string }).model).toBe("router-y");
  });

  it("drops an answer whose rules do not fit the schema – nothing is clamped or repaired", async () => {
    const bad = answer();
    leavesOf(bad.rules.long)[0]!.params.level = 500;
    fakeModel({ content: [toolUse(bad)] });
    const body = await (await post()).json();
    expect(body).toMatchObject({ result: null, reason: "invalid" });
    expect(body.detail).toMatch(/außerhalb/);
    const unknownBlock = answer();
    (leavesOf(unknownBlock.rules.long)[0] as { block: string }).block = "magic";
    fakeModel({ content: [toolUse(unknownBlock)] });
    expect(await (await post()).json()).toMatchObject({ result: null, reason: "invalid" });
  });

  it("drops an answer that claims to have understood words the text does not contain", async () => {
    const invented = answer();
    invented.understood.push({ phrase: "Volumen doppelt so hoch", ref: l1!.id });
    fakeModel({ content: [toolUse(invented)] });
    const body = await (await post()).json();
    expect(body).toMatchObject({ result: null, reason: "invalid" });
    expect(body.detail).toContain("steht nicht im Text");
  });

  it("reports `empty` for a missing tool call and `refusal` for a refusal", async () => {
    fakeModel({ content: [] });
    expect(await (await post()).json()).toMatchObject({ result: null, reason: "empty" });
    fakeModel({ stop_reason: "refusal" });
    expect(await (await post()).json()).toMatchObject({ result: null, reason: "refusal" });
  });

  it("applies the plan gate and the rate limits", async () => {
    fakeModel({ content: [toolUse(answer())] });
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
    fakeModel({ content: [toolUse(answer())] });
    expect((await post({ text: "" })).status).toBe(422);
    expect((await post({ text: "a".repeat(1501) })).status).toBe(422);
    expect((await post({})).status).toBe(422);
  });

  it("maps API failures to German errors", async () => {
    fakeModel(new Anthropic.RateLimitError(429, undefined, "rate", new Headers()));
    const res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("strategy_compile_busy");
    fakeModel(new Anthropic.AuthenticationError(401, undefined, "bad", new Headers()));
    expect((await post()).status).toBe(503);
    fakeModel(new Anthropic.InternalServerError(500, undefined, "boom", new Headers()));
    expect((await post()).status).toBe(502);
  });
});
