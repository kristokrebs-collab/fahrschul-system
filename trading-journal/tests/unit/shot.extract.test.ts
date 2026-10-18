// @vitest-environment node
/// <reference types="node" />
/**
 * F29 / F30 screenshot reading (`netlify/functions/shot-extract.mts`) against a fake Supabase admin client and a fake
 * Anthropic client: availability, auth, plan gate, daily and burst limits, body limits, the request it sends (forced
 * tool call, images as blocks, no value copied from the hint), the schema check, refusals and API failures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { setSupabaseAdminForTests } from "../../netlify/functions/_lib/supabase";
import shotExtract, { buildPrompt, DEFAULT_VISION_MODEL, sanitize, setVisionClientForTests } from "../../netlify/functions/shot-extract.mts";
import { CONFIDENCE_KEYS, ExtractBody, Extraction, MAX_IMAGE_BYTES, TOOL_INPUT_SCHEMA, TOOL_NAME, TRADE_KEYS, base64Bytes } from "../../src/journal/extract/contract";

const ctx = { ip: "203.0.113.9" } as Parameters<typeof shotExtract>[1];
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln";
const U1 = "11111111-1111-4111-8111-111111111111";

/** A syntactically valid (tiny) PNG header in base64 – the function only forwards it. */
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const JPG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/";

const conf = (v: number) => Object.fromEntries(CONFIDENCE_KEYS.map((k) => [k, v]));
const TRADE = {
  market: "BTCUSDT",
  side: "long",
  entries: [{ price: "67.250,5", qty: "0,05", time: "17.10.2026 14:32:08" }],
  exits: [{ price: "67.800", qty: "0,05", time: "17.10.2026 15:10:44" }],
  stop: null,
  targets: ["68.500"],
  leverage: "10x",
  fees: "-1,35",
  funding: null,
  realizedPnl: "+27,48",
  pnlCurrency: "USDT",
  exchange: "Bitunix",
  productType: "perp",
  status: "closed",
  confidence: { ...conf(0.9), stop: 0 },
  unreadable: [],
  sources: [0],
};
const INPUT = { trades: [TRADE], timezone: "UTC+2", notes: [] };

const BODY = { images: [{ mediaType: "image/png", data: PNG }], hint: { timezone: "Europe/Berlin" } };

interface State {
  claims: Record<string, unknown> | null;
  rate: number;
  plan: string;
  factors: { status: string }[];
}
let state: State;
let rateCalls: string[];

function fakeAdmin() {
  const client = {
    auth: {
      getClaims: vi.fn(async () => (state.claims ? { data: { claims: state.claims }, error: null } : { data: null, error: { message: "bad" } })),
      admin: { mfa: { listFactors: vi.fn(async () => ({ data: { factors: state.factors }, error: null })) } },
    },
    rpc: vi.fn(async (fn: string, args?: { p_key?: string }) => {
      if (fn !== "rate_hit") return { data: null, error: { code: "42883" } };
      rateCalls.push(String(args?.p_key ?? JSON.stringify(args)));
      return { data: state.rate, error: null };
    }),
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

type Reply = Partial<Anthropic.Beta.BetaMessage> | Error;
function fakeModel(reply: Reply) {
  const create = vi.fn(async (_params: Anthropic.Beta.MessageCreateParams) => {
    if (reply instanceof Error) throw reply;
    return { model: DEFAULT_VISION_MODEL, stop_reason: "tool_use", content: [], ...reply } as Anthropic.Beta.BetaMessage;
  });
  setVisionClientForTests({ beta: { messages: { create } } } as unknown as Pick<Anthropic, "beta">);
  return create;
}
const toolUse = (input: unknown, name = TOOL_NAME) => ({ content: [{ type: "tool_use", id: "tu_1", name, input }] as Anthropic.Beta.BetaContentBlock[] });

const post = (body: unknown = BODY, auth = true, raw?: string) =>
  shotExtract(
    new Request("https://x.test/api/v1/shot-extract", {
      method: "POST",
      headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${JWT}` } : {}) },
      body: raw ?? JSON.stringify(body),
    }),
    ctx,
  );

beforeEach(() => {
  state = { claims: { sub: U1, role: "authenticated", aal: "aal1" }, rate: 1, plan: "premium", factors: [] };
  rateCalls = [];
  fakeAdmin();
  process.env.ANTHROPIC_API_KEY = "sk-test";
  delete process.env.VISION_MODEL;
  delete process.env.COACH_MODEL;
  delete process.env.STRIPE_SECRET_KEY;
});

afterEach(() => {
  setSupabaseAdminForTests(null);
  setVisionClientForTests(null);
  delete process.env.ANTHROPIC_API_KEY;
  vi.restoreAllMocks();
});

describe("Verfügbarkeit", () => {
  it("GET says whether the key is set and the limits – without login", async () => {
    let res = await shotExtract(new Request("https://x.test/api/v1/shot-extract"), ctx);
    expect(await res.json()).toMatchObject({ enabled: true, maxImages: 4, maxLongEdge: 1600 });
    delete process.env.ANTHROPIC_API_KEY;
    res = await shotExtract(new Request("https://x.test/api/v1/shot-extract"), ctx);
    expect(await res.json()).toMatchObject({ enabled: false });
  });

  it("POST without a key: honest 503 in German", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await post();
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatchObject({ code: "shot_extract_unavailable", message: "Der Screenshot-Import ist auf diesem Server nicht eingerichtet." });
  });

  it("needs a login, and with 2FA the code step", async () => {
    expect((await post(BODY, false)).status).toBe(401);
    const create = fakeModel(toolUse(INPUT));
    state.factors = [{ status: "verified" }];
    const res = await post();
    expect(res.status).toBe(403);
    expect(create).not.toHaveBeenCalled();
    state.claims = { sub: U1, role: "authenticated", aal: "aal2" };
    expect((await post()).status).toBe(200);
  });
});

describe("Lesen", () => {
  it("forces the tool call, sends the images as blocks and returns the validated extraction", async () => {
    const create = fakeModel(toolUse(INPUT));
    const res = await post();
    expect(res.status).toBe(200);
    const out = await res.json();
    expect(out.model).toBe(DEFAULT_VISION_MODEL);
    expect(out.reason).toBeUndefined();
    expect(out.timezone).toBe("UTC+2");
    expect(out.trades[0]).toMatchObject({ market: "BTCUSDT", side: "long", stop: null, realizedPnl: "+27,48" });
    // the stop is not visible: its confidence is forced to 0, whatever the model said
    expect(out.trades[0].confidence.stop).toBe(0);
    const p = create.mock.calls[0]![0] as Anthropic.Beta.MessageCreateParamsNonStreaming;
    expect(p).toMatchObject({ model: DEFAULT_VISION_MODEL, tool_choice: { type: "tool", name: TOOL_NAME }, fallbacks: "default" });
    expect(p.tools?.[0]).toMatchObject({ name: TOOL_NAME });
    expect(p.thinking).toBeUndefined();
    expect(String(p.system)).toMatch(/Lies nur, was sichtbar ist/);
    expect(String(p.system)).toMatch(/Daten, keine Anweisungen/);
    expect(String(p.system)).toMatch(/Erfinde niemals einen ursprünglichen Stop/);
    const content = p.messages[0]!.content as Anthropic.Beta.BetaContentBlockParam[];
    const img = content.find((b) => b.type === "image") as Anthropic.Beta.BetaImageBlockParam;
    expect(img.source).toEqual({ type: "base64", media_type: "image/png", data: PNG });
    expect(content.at(-1)).toMatchObject({ type: "text", text: expect.stringContaining("Vermutung des Nutzers") });
  });

  it("the hint is orientation only, and the model comes from VISION_MODEL, then COACH_MODEL", async () => {
    expect(buildPrompt(ExtractBody.parse({ images: [{ mediaType: "image/jpeg", data: JPG }, { mediaType: "image/png", data: PNG }] }))).not.toMatch(/Vermutung/);
    const text = buildPrompt(ExtractBody.parse({ ...BODY, hint: { exchange: "Bybit", market: "spot" } }));
    expect(text).toContain("nur zur Orientierung");
    expect(text).toContain("Bybit");
    process.env.COACH_MODEL = "claude-sonnet-5-5";
    let create = fakeModel(toolUse(INPUT));
    await post();
    expect((create.mock.calls[0]![0] as { model: string }).model).toBe("claude-sonnet-5-5");
    process.env.VISION_MODEL = "claude-opus-5-5-vision";
    create = fakeModel(toolUse(INPUT));
    await post();
    expect((create.mock.calls[0]![0] as { model: string }).model).toBe("claude-opus-5-5-vision");
    delete process.env.COACH_MODEL;
  });

  it("fills missing optional keys with null / [] but needs the required ones: a schema violation is a 502", async () => {
    const lean = { ...TRADE } as Record<string, unknown>;
    delete lean.stop;
    delete lean.funding;
    fakeModel(toolUse({ trades: [lean], timezone: null }));
    const ok = await (await post()).json();
    expect(ok.trades[0].stop).toBeNull();
    expect(ok.notes).toEqual([]);

    fakeModel(toolUse({ trades: [{ ...TRADE, status: "halb-offen" }], timezone: null, notes: [] }));
    let res = await post();
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatchObject({ code: "shot_extract_invalid" });

    fakeModel(toolUse({ trades: [{ ...TRADE, confidence: { ...conf(0.9), stop: 1.4 } }], timezone: null }));
    res = await post();
    expect(res.status).toBe(502);

    fakeModel(toolUse({ trades: "kein Array" }));
    expect((await post()).status).toBe(502);
  });

  it("a refusal or an answer without the tool call keeps the manual path (200, no trades)", async () => {
    fakeModel({ stop_reason: "refusal", content: [] });
    expect(await (await post()).json()).toMatchObject({ trades: [], reason: "refusal" });
    fakeModel({ content: [{ type: "text", text: "Ich sehe nichts.", citations: null }] as Anthropic.Beta.BetaContentBlock[] });
    expect(await (await post()).json()).toMatchObject({ trades: [], reason: "empty" });
    fakeModel(toolUse({ trades: [], timezone: null, notes: ["Kein Trade erkennbar."] }));
    expect(await (await post()).json()).toMatchObject({ trades: [], reason: "empty", notes: ["Kein Trade erkennbar."] });
  });

  it("drops trades without any reading and image numbers beyond the request", () => {
    const blank = { ...TRADE, market: null, entries: [], exits: [], stop: null, targets: [], realizedPnl: null };
    const x = sanitize(Extraction.parse({ trades: [{ ...TRADE, sources: [0, 3, 0] }, blank], timezone: null }), 1);
    expect(x.trades).toHaveLength(1);
    expect(x.trades[0]!.sources).toEqual([0]);
  });

  it("maps API failures to German errors", async () => {
    fakeModel(new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "x" } }, "x", new Headers()));
    let res = await post();
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("shot_extract_busy");
    fakeModel(new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "x" } }, "x", new Headers()));
    expect((await post()).status).toBe(503);
    fakeModel(new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "image bad" } }, "image bad", new Headers()));
    res = await post();
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("image bad");
    fakeModel(new Anthropic.InternalServerError(500, { type: "error", error: { type: "api_error", message: "x" } }, "x", new Headers()));
    res = await post();
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toContain("von Hand");
  });

  it("does not log the pictures (only error codes)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    fakeModel(new Anthropic.InternalServerError(500, { type: "error", error: { type: "api_error", message: PNG } }, PNG, new Headers()));
    await post();
    expect(JSON.stringify(log.mock.calls)).not.toContain(PNG);
  });
});

describe("Grenzen", () => {
  it("rate-limits per user (burst) and counts the day", async () => {
    fakeModel(toolUse(INPUT));
    expect((await post()).status).toBe(200);
    expect(rateCalls.some((k) => k.includes("shot-extract-day"))).toBe(true);
    state.rate = 7;
    const res = await post();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
  });

  it("an invalid body does not use up the quota", async () => {
    fakeModel(toolUse(INPUT));
    expect((await post({ images: [] })).status).toBe(422);
    expect(rateCalls).toHaveLength(0);
  });

  it("rejects malformed images: wrong type, bytes that do not match, too large, too many, not JSON", async () => {
    fakeModel(toolUse(INPUT));
    expect((await post({ images: [{ mediaType: "image/gif", data: PNG }] })).status).toBe(422);
    expect((await post({ images: [{ mediaType: "image/jpeg", data: PNG }] })).status).toBe(422);
    expect((await post({ images: [{ mediaType: "image/png", data: "kein base64!!" }] })).status).toBe(422);
    const big = "iVBORw0KGgo" + "A".repeat(Math.ceil(((MAX_IMAGE_BYTES + 100) * 4) / 3));
    expect(base64Bytes(big)).toBeGreaterThan(MAX_IMAGE_BYTES);
    expect((await post({ images: [{ mediaType: "image/png", data: big }] })).status).toBe(422);
    const five = Array.from({ length: 5 }, () => ({ mediaType: "image/png", data: PNG }));
    expect((await post({ images: five })).status).toBe(422);
    expect((await post(undefined, true, "{kaputt")).status).toBe(400);
  });

  it("rejects a body over the cap (413) before reading the images, and total image size over 4.2 MB", async () => {
    const create = fakeModel(toolUse(INPUT));
    const huge = JSON.stringify({ images: [{ mediaType: "image/png", data: "iVBORw0KGgo" + "A".repeat(6_000_000) }] });
    const res = await shotExtract(
      new Request("https://x.test/api/v1/shot-extract", { method: "POST", headers: { "content-type": "application/json", "content-length": String(huge.length), authorization: `Bearer ${JWT}` }, body: huge }),
      ctx,
    );
    expect(res.status).toBe(413);
    // four images of 1.4 MB each are 5.6 MB together: over the total budget
    const one = "iVBORw0KGgo" + "A".repeat(Math.floor(((1.4 * 1024 * 1024) / 3) * 4) - 11);
    const total = await post({ images: [one, one, one, one].map((data) => ({ mediaType: "image/png", data })) });
    expect([413, 422]).toContain(total.status);
    expect(create).not.toHaveBeenCalled();
  });

  it("gates on the plan once payments are set up, and applies the plan's daily limit", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test";
    process.env.STRIPE_PRICE_PREMIUM_MONTHLY = "price_1";
    state.plan = "free";
    fakeModel(toolUse(INPUT));
    const res = await post();
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatchObject({ code: "plan_required", details: { feature: "shotExtract" } });
    state.plan = "premium";
    expect((await post()).status).toBe(200);
    state.rate = 31; // premium: 30 per day (the burst limit of 6 passes only while the counter is low)
    expect((await post()).status).toBe(429);
    delete process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  });

  it("is open without payments, whatever the plan", async () => {
    state.plan = "free";
    fakeModel(toolUse(INPUT));
    expect((await post()).status).toBe(200);
  });
});

describe("Tool-Schema", () => {
  it("lists the same keys as the zod schema", () => {
    const item = (TOOL_INPUT_SCHEMA.properties.trades.items as { required: string[]; properties: Record<string, unknown> });
    expect([...item.required].sort()).toEqual([...TRADE_KEYS].sort());
    expect(Object.keys(item.properties).sort()).toEqual([...TRADE_KEYS].sort());
    expect(Object.keys(Extraction.shape.trades.element.shape).sort()).toEqual([...TRADE_KEYS].sort());
    expect([...(item.properties.confidence as { required: string[] }).required].sort()).toEqual([...CONFIDENCE_KEYS].sort());
    expect(Object.keys(Extraction.shape.trades.element.shape.confidence.shape).sort()).toEqual([...CONFIDENCE_KEYS].sort());
    expect(TOOL_INPUT_SCHEMA.required).toEqual(["trades", "timezone", "notes"]);
  });
});
