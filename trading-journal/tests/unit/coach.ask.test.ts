// @vitest-environment node
/// <reference types="node" />
/**
 * P04 optional LLM rephrasing (`netlify/functions/coach-ask.mts`) against a fake Supabase admin client and a fake
 * Anthropic client: availability, auth, plan gate, rate limits, the request it sends (model, effort, fallbacks, only
 * the facts), the number guard, refusals and API failures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import coachAsk, { buildPrompt, DEFAULT_COACH_MODEL, numbersIn, setCoachClientForTests, verifyNumbers, type AskInput } from "../../netlify/functions/coach-ask.mts";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof coachAsk>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";

const BODY: AskInput = {
  question: "Was ist mein bestes Setup?",
  title: "Netto-P&L pro Setup",
  text: "Am stärksten nach Netto-P&L: Breakout mit +1.240 USDT (38 Trades).",
  facts: [
    { label: "Stärkste Gruppe", value: "Breakout" },
    { label: "Netto-P&L", value: "+1.240 USDT" },
    { label: "Win-Rate", value: "61 %" },
  ],
  confidence: { label: "klar", n: 38 },
};

interface State {
  claims: Record<string, unknown> | null;
  rate: number;
  plan: string;
}
let state: State;

function fakeAdmin() {
  const client = {
    auth: { getClaims: vi.fn(async () => (state.claims ? { data: { claims: state.claims }, error: null } : { data: null, error: { message: "bad" } })) },
    rpc: vi.fn(async (fn: string) => (fn === "rate_hit" ? { data: state.rate, error: null } : { data: null, error: { code: "42883" } })),
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: { plan: state.plan, plan_status: state.plan === "free" ? "none" : "active", trial_end: null }, error: null }),
      };
      return q;
    },
  };
  setSupabaseAdminForTests(client as unknown as SupabaseClient);
  return client;
}

function fakeModel(reply: Partial<Anthropic.Beta.BetaMessage> | Error) {
  const create = vi.fn(async (_params: Anthropic.Beta.MessageCreateParams) => {
    if (reply instanceof Error) throw reply;
    return { model: DEFAULT_COACH_MODEL, stop_reason: "end_turn", content: [], ...reply } as Anthropic.Beta.BetaMessage;
  });
  setCoachClientForTests({ beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">);
  return create;
}

const post = (body: unknown = BODY, auth = true) =>
  coachAsk(new Request("https://x.test/api/v1/coach/ask", { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${JWT}` } : {}) }, body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  state = { claims: { sub: U1, role: "authenticated", aal: "aal1" }, rate: 1, plan: "premium" };
  fakeAdmin();
  process.env.ANTHROPIC_API_KEY = "sk-test";
  delete process.env.COACH_MODEL;
  delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
  setSupabaseAdminForTests(null);
  setCoachClientForTests(null);
  delete process.env.ANTHROPIC_API_KEY;
  vi.restoreAllMocks();
});

describe("Verfügbarkeit", () => {
  it("GET says whether the key is set – without login", async () => {
    let res = await coachAsk(new Request("https://x.test/api/v1/coach/ask"), ctx);
    expect(await res.json()).toEqual({ enabled: true });
    delete process.env.ANTHROPIC_API_KEY;
    res = await coachAsk(new Request("https://x.test/api/v1/coach/ask"), ctx);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it("POST without a key: honest 503 in German", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatchObject({ code: "coach_ai_unavailable", message: "Die KI-Formulierung ist auf diesem Server nicht eingerichtet." });
  });

  it("needs a login", async () => {
    const res = await post(BODY, false);
    expect(res.status).toBe(401);
  });
});

describe("Formulieren", () => {
  it("sends only the computed facts with low effort and the default fallback, returns the text", async () => {
    const create = fakeModel({ content: [{ type: "text", text: "Dein bestes Setup ist Breakout: +1.240 USDT bei 61 % Win-Rate über 38 Trades – das ist klar belegt.", citations: null }] as Anthropic.Beta.BetaContentBlock[] });
    const res = await post();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.text).toContain("Breakout");
    expect(body.model).toBe(DEFAULT_COACH_MODEL);
    const params = create.mock.calls[0]![0] as Anthropic.Beta.MessageCreateParamsNonStreaming;
    expect(params).toMatchObject({ model: DEFAULT_COACH_MODEL, output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect(params.thinking).toBeUndefined();
    expect(params.messages[0]!.content).toBe(buildPrompt(BODY));
  });

  it("uses COACH_MODEL when set", async () => {
    process.env.COACH_MODEL = "claude-sonnet-5-5";
    const create = fakeModel({ content: [{ type: "text", text: "Breakout führt.", citations: null }] as Anthropic.Beta.BetaContentBlock[] });
    await post();
    expect((create.mock.calls[0]![0] as { model: string }).model).toBe("claude-sonnet-5-5");
  });

  it("drops an answer with an invented number", async () => {
    fakeModel({ content: [{ type: "text", text: "Breakout bringt dir +2.000 USDT.", citations: null }] as Anthropic.Beta.BetaContentBlock[] });
    expect(await (await post()).json()).toMatchObject({ text: null, reason: "unverified" });
  });

  it("a refusal keeps the deterministic answer", async () => {
    fakeModel({ stop_reason: "refusal", content: [] });
    expect(await (await post()).json()).toMatchObject({ text: null, reason: "refusal" });
  });

  it("maps API failures to German errors", async () => {
    fakeModel(new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "x" } }, "x", new Headers()));
    let res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("coach_ai_busy");
    fakeModel(new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "x" } }, "x", new Headers()));
    res = await post();
    expect(res.status).toBe(503);
    fakeModel(new Anthropic.InternalServerError(500, { type: "error", error: { type: "api_error", message: "x" } }, "x", new Headers()));
    res = await post();
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toContain("berechnete Antwort bleibt");
  });
});

describe("Grenzen", () => {
  it("rate-limits per user", async () => {
    fakeModel({ content: [] });
    state.rate = 11;
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("rejects oversized or malformed bodies", async () => {
    fakeModel({ content: [] });
    expect((await post({ ...BODY, facts: Array.from({ length: 13 }, () => ({ label: "a", value: "1" })) })).status).toBe(422);
    expect((await post({ title: "x" })).status).toBe(422);
  });

  it("gates on the plan once payments are set up", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_1";
    state.plan = "free";
    fakeModel({ content: [] });
    const res = await post();
    expect(res.status).toBe(402);
    delete process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  });
});

describe("Zahlen-Wächter", () => {
  it("reads German numbers", () => {
    expect(numbersIn("+1.240 USDT, 61 %, −0,35 R, 38 Trades, 2026")).toEqual(["1240", "61", "0.35", "38", "2026"]);
  });

  it("accepts the input's numbers in any sign and rejects new ones", () => {
    expect(verifyNumbers("Du hast 1.240 USDT gemacht, Konfidenz aus 38 Trades.", BODY)).toBe(true);
    expect(verifyNumbers("Du hast 1.300 USDT gemacht.", BODY)).toBe(false);
    expect(verifyNumbers("Ohne Zahlen geht es auch.", BODY)).toBe(true);
  });
});
