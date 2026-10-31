/**
 * /api/v1/strategy/compile – OPTIONAL language help of the Strategie-Studio. The studio reads a strategy text on the device
 * (`src/domain/strategytext`); when the trader asks for it because something stays unclear, this function lets a language
 * model translate the SAME text into the lab's rule schema. The model has one job – text → structured rules – and no way
 * to compute or claim anything:
 *
 *   GET   → `{ enabled }` – whether `ANTHROPIC_API_KEY` is set.
 *   POST  `{ text }` (≤ 1500 characters)
 *         → `{ result: AiOutput | null, model, reason?, detail? }` – `result` is the answer AFTER it passed the strict rules
 *           schema (`RulesSchema`, the check the local parser's output passes too) and the grounding check (every phrase it
 *           claims to have understood stands in the text); `null` = nothing usable (`reason`: "refusal" | "invalid" | "empty",
 *           `detail` names the first violation). The app checks the answer again before it shows it.
 *
 * Guards (as `assistant-route` / `coach-ask`): signed-in user (aal2 if enrolled), plan feature `coachAi` (Premium; open while
 * payments are not set up), 10 calls / 10 min per user and the plan's `coachAiPerDay` shared with the coach wording, body
 * ≤ 8 KiB. Only the strategy text is sent – no trades, no journal, no account data. The text is data, never an instruction.
 * Nothing is stored or logged except error codes. Env: `ANTHROPIC_API_KEY` (the operator's secret, never in the client),
 * optional `ROUTER_MODEL` (the language-help model of the assistant; default `COACH_MODEL`, then `claude-opus-5-5`).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { limitOf } from "../../src/billing/plans";
import { AI_TEXT_MAX, AI_TOOL, buildSystemPrompt, buildUserPrompt, parseAiOutput } from "../../src/domain/strategytext/ai";
import type { AiOutput } from "../../src/domain/strategytext/schema";
import { requireUser } from "./_lib/auth";
import { envOptional } from "./_lib/env";
import { handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { paymentsConfigured, requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";

export const DEFAULT_COMPILE_MODEL = "claude-opus-5-5";
export const COMPILE_OFF_MESSAGE = "Die KI-Hilfe fürs Strategie-Studio ist auf diesem Server nicht eingerichtet.";
export const DEFAULT_DAILY = 50;

export const CompileBody = z.object({ text: z.string().trim().min(1).max(AI_TEXT_MAX) });
export type CompileInput = z.infer<typeof CompileBody>;

type CompileClient = Pick<Anthropic, "beta">;
let clientOverride: CompileClient | null = null;
let cached: { key: string; client: CompileClient } | null = null;

/** Tests: inject a fake client (`null` restores the real one). */
export function setCompileClientForTests(c: CompileClient | null): void {
  clientOverride = c;
  cached = null;
}

function compileClient(apiKey: string): CompileClient {
  if (clientOverride) return clientOverride;
  if (!cached || cached.key !== apiKey) cached = { key: apiKey, client: new Anthropic({ apiKey, maxRetries: 1, timeout: 45_000 }) };
  return cached.client;
}

export interface CompileResult {
  result: AiOutput | null;
  model: string;
  reason?: "refusal" | "invalid" | "empty";
  detail?: string;
}

/** Asks the model for the rules; maps API failures to the shared error envelope. */
export async function compileStrategy(input: CompileInput, apiKey: string, model: string): Promise<CompileResult> {
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await compileClient(apiKey).beta.messages.create({
      model,
      max_tokens: 6000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: buildSystemPrompt(),
      tools: [AI_TOOL as unknown as Anthropic.Beta.BetaTool],
      tool_choice: { type: "tool", name: AI_TOOL.name },
      messages: [{ role: "user", content: buildUserPrompt(input.text) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "strategy_compile_busy", "Die KI ist gerade ausgelastet – bitte gleich noch einmal.", undefined, { "retry-after": "30" });
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error("[fn] strategy-compile auth", e.status);
      throw new HttpError(503, "strategy_compile_unavailable", COMPILE_OFF_MESSAGE);
    }
    if (e instanceof Anthropic.APIError) {
      console.error("[fn] strategy-compile api", e.status ?? "network");
      throw new HttpError(502, "strategy_compile_failed", "Die KI antwortet gerade nicht.");
    }
    throw e;
  }
  const served = res.model || model;
  if (res.stop_reason === "refusal") return { result: null, model: served, reason: "refusal" };
  const block = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === AI_TOOL.name);
  if (!block) return { result: null, model: served, reason: "empty" };
  // rules schema + grounding: whatever does not fit is dropped, never repaired
  const checked = parseAiOutput(block.input, input.text);
  if (!checked.ok) return { result: null, model: served, reason: "invalid", detail: checked.reason.slice(0, 240) };
  return { result: checked.out, model: served };
}

export default handler(async (req) => {
  requireMethod(req, "GET", "POST");
  const apiKey = envOptional("ANTHROPIC_API_KEY");
  if (req.method.toUpperCase() === "GET") return json({ enabled: !!apiKey });
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  if (!apiKey) throw new HttpError(503, "strategy_compile_unavailable", COMPILE_OFF_MESSAGE);
  const plan = await requireFeature(user.id, "coachAi");
  await enforceRateLimit(rateKey("strategy-compile", user.id), 10, 600);
  const daily = paymentsConfigured() ? limitOf(plan.plan, "coachAiPerDay") : DEFAULT_DAILY;
  if (!(daily > 0)) throw new HttpError(402, "limit_reached", "Das Limit deines Tarifs ist erreicht.", { key: "coachAiPerDay", limit: daily, plan: plan.plan });
  // shares the day counter with the coach wording and the assistant router: the plan's AI allowance covers all three
  if (Number.isFinite(daily)) await enforceRateLimit(rateKey("coach-ask-day", user.id), daily, 86_400);
  const body = await readJson(req, CompileBody, { maxBytes: 8 * 1024 });
  const model = envOptional("ROUTER_MODEL") ?? envOptional("COACH_MODEL") ?? DEFAULT_COMPILE_MODEL;
  return json(await compileStrategy(body, apiKey, model));
});

export const config: Config = { path: "/api/v1/strategy/compile", method: ["GET", "POST"] };
