/**
 * /api/v1/coach/ask – OPTIONAL LLM rephrasing of a coach answer (P04). The coach is fully deterministic in the app; this
 * function only rewrites the facts the app already computed into a short, natural German answer.
 *
 *   GET   → `{ enabled }` – whether `ANTHROPIC_API_KEY` is set (the app shows "Mit KI formulieren" only then).
 *   POST  `{ question?, title, text, facts: {label, value}[], confidence: {label, n}, notes?: string[] }`
 *         → `{ text: string | null, model, reason? }` – `text` null = keep the deterministic answer
 *           (`reason`: "refusal" | "unverified" | "empty").
 *
 * Guards: signed-in user, plan feature `coachAi` (Premium; not gated while payments are not set up), 10 calls / 10 min
 * and `coachAiPerDay` per day per user (rate_hit), body ≤ 8 KiB, only aggregates (facts are numbers and labels the app
 * computed; note excerpts only after the user's opt-in, ≤ 3 × 280 characters). The model may not invent numbers: every
 * number in its answer must occur in the input, else the answer is dropped ("unverified"). Nothing is stored or logged
 * except error codes. Env: `ANTHROPIC_API_KEY` (secret), optional `COACH_MODEL` (default `claude-opus-5-5`).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { limitOf } from "../../src/billing/plans";
import { requireUser } from "./_lib/auth";
import { envOptional } from "./_lib/env";
import { handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { paymentsConfigured, requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";

export const DEFAULT_COACH_MODEL = "claude-opus-5-5";
export const COACH_OFF_MESSAGE = "Die KI-Formulierung ist auf diesem Server nicht eingerichtet.";
/** Calls per user without payments (the plan limit applies once payments are set up). */
export const DEFAULT_DAILY = 50;

const Text = (max: number) => z.string().trim().max(max);
export const AskBody = z.object({
  question: Text(300).optional(),
  title: Text(200).min(1),
  text: Text(1500).min(1),
  facts: z.array(z.object({ label: Text(80).min(1), value: Text(80).min(1) })).max(12),
  confidence: z.object({ label: Text(30), n: z.number().int().min(0).max(1_000_000) }),
  notes: z.array(Text(280)).max(3).optional(),
});
export type AskInput = z.infer<typeof AskBody>;

export const SYSTEM_PROMPT = [
  "Du bist der Coach in einem Trading-Journal. Du formulierst eine bereits berechnete Antwort neu: kurz, klar, freundlich-direkt, auf Deutsch, in 2 bis 4 Sätzen.",
  "Verwende ausschließlich die Fakten aus der Nachricht. Erfinde keine Zahlen, rechne nichts neu und runde nichts um – Zahlen übernimmst du genau so, wie sie dastehen.",
  "Nenne die Konfidenz ehrlich (z. B. „noch zu wenig Daten“), gib keine Anlageberatung, keine Kursprognosen und keine medizinischen oder psychologischen Diagnosen.",
  "Antworte nur mit dem Text der Antwort – ohne Überschrift, ohne Aufzählung, ohne Anführungszeichen.",
].join(" ");

/** The user message: the computed facts, nothing else. */
export function buildPrompt(b: AskInput): string {
  const lines = [`Frage: ${b.question || b.title}`, `Berechnete Antwort: ${b.text}`, "Fakten:", ...b.facts.map((f) => `- ${f.label}: ${f.value}`), `Konfidenz: ${b.confidence.label} (Stichprobe ${b.confidence.n} Trades)`];
  if (b.notes?.length) lines.push("Notizen des Traders (Auszug, nur als Kontext):", ...b.notes.map((n) => `- ${n}`));
  return lines.join("\n");
}

/** Numbers in a German text as canonical strings ("1.234,5" → "1234.5", "−3" → "-3"); ordinal dots and percent signs ignored. */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.replace(/−/g, "-").matchAll(/-?\d[\d.,]*/g)) {
    let s = m[0].replace(/[.,]$/, "");
    if (/,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    else s = s.replace(/,/g, "");
    const n = Number(s);
    if (Number.isFinite(n)) out.push(String(Math.abs(n)));
  }
  return out;
}

/** Every number of the answer occurs in the input (sign-insensitive – "−80" may be said as "80 verloren"). */
export function verifyNumbers(answer: string, input: AskInput): boolean {
  const allowed = new Set(numbersIn([input.question ?? "", input.title, input.text, ...input.facts.flatMap((f) => [f.label, f.value]), input.confidence.label, String(input.confidence.n), ...(input.notes ?? [])].join(" \n ")));
  return numbersIn(answer).every((n) => allowed.has(n));
}

type CoachClient = Pick<Anthropic, "beta">;
let clientOverride: CoachClient | null = null;
let cached: { key: string; client: CoachClient } | null = null;

/** Tests: inject a fake client (`null` restores the real one). */
export function setCoachClientForTests(c: CoachClient | null): void {
  clientOverride = c;
  cached = null;
}

function coachClient(apiKey: string): CoachClient {
  if (clientOverride) return clientOverride;
  if (!cached || cached.key !== apiKey) cached = { key: apiKey, client: new Anthropic({ apiKey, maxRetries: 1, timeout: 25_000 }) };
  return cached.client;
}

export interface RephraseResult {
  text: string | null;
  model: string;
  reason?: "refusal" | "unverified" | "empty";
}

/** Asks the model to rephrase; maps API failures to the shared error envelope. */
export async function rephrase(input: AskInput, apiKey: string, model: string): Promise<RephraseResult> {
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await coachClient(apiKey).beta.messages.create({
      model,
      max_tokens: 4000,
      // rephrasing is light work; a refusal is re-run server-side on a fallback model chosen by category
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(input) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "coach_ai_busy", "Die KI ist gerade ausgelastet – bitte gleich noch einmal.", undefined, { "retry-after": "30" });
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error("[fn] coach-ask auth", e.status);
      throw new HttpError(503, "coach_ai_unavailable", COACH_OFF_MESSAGE);
    }
    if (e instanceof Anthropic.BadRequestError) {
      console.error("[fn] coach-ask bad request", e.status);
      throw new HttpError(502, "coach_ai_failed", "Die KI konnte die Antwort nicht formulieren.");
    }
    if (e instanceof Anthropic.APIError) {
      console.error("[fn] coach-ask api", e.status ?? "network");
      throw new HttpError(502, "coach_ai_failed", "Die KI antwortet gerade nicht – die berechnete Antwort bleibt.");
    }
    throw e;
  }
  const served = res.model || model;
  if (res.stop_reason === "refusal") return { text: null, model: served, reason: "refusal" };
  const text = res.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim()
    .replace(/^["„“]+|["“”]+$/g, "");
  if (!text) return { text: null, model: served, reason: "empty" };
  if (!verifyNumbers(text, input)) return { text: null, model: served, reason: "unverified" };
  return { text: text.slice(0, 1200), model: served };
}

export default handler(async (req) => {
  requireMethod(req, "GET", "POST");
  const apiKey = envOptional("ANTHROPIC_API_KEY");
  if (req.method.toUpperCase() === "GET") return json({ enabled: !!apiKey });
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  if (!apiKey) throw new HttpError(503, "coach_ai_unavailable", COACH_OFF_MESSAGE);
  const plan = await requireFeature(user.id, "coachAi");
  await enforceRateLimit(rateKey("coach-ask", user.id), 10, 600);
  const daily = paymentsConfigured() ? limitOf(plan.plan, "coachAiPerDay") : DEFAULT_DAILY;
  if (!(daily > 0)) throw new HttpError(402, "limit_reached", "Das Limit deines Tarifs ist erreicht.", { key: "coachAiPerDay", limit: daily, plan: plan.plan });
  if (Number.isFinite(daily)) await enforceRateLimit(rateKey("coach-ask-day", user.id), daily, 86_400);
  const body = await readJson(req, AskBody, { maxBytes: 8 * 1024 });
  const model = envOptional("COACH_MODEL") ?? DEFAULT_COACH_MODEL;
  return json(await rephrase(body, apiKey, model));
});

export const config: Config = { path: "/api/v1/coach/ask", method: ["GET", "POST"] };
