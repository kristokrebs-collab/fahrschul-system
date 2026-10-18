/**
 * /api/v1/shot-extract – OPTIONAL reading of trade values from screenshots (F29 / F30). The journal works without it;
 * this function only turns pictures into a structured, uncertainty-aware PROPOSAL that the app shows in a preview – it
 * never saves anything.
 *
 *   GET   → `{ enabled, maxImages, maxLongEdge, maxImageBytes }` – whether `ANTHROPIC_API_KEY` is set (the app shows
 *           "Aus Screenshot übernehmen" only then).
 *   POST  `{ images: [{ mediaType, data(base64) }] (1–4), hint?: { market?, timezone?, exchange?, pair? } }`
 *         → `{ trades[], timezone, notes[], model, reason? }` (`src/journal/extract/contract.ts`); `trades: []` with
 *           `reason` "refusal" | "empty" = nothing usable, the trader enters the values by hand.
 *
 * The model answers through ONE forced tool call (`report_trades`) whose JSON schema is the extraction schema; the
 * input is validated again with zod here (a violation is a 502, never passed on). Numbers and times are the text the
 * picture shows – the client parses and cross-checks them.
 *
 * Guards: signed-in user, plan feature `shotExtract` (Premium; not gated while payments are not set up), 6 calls /
 * 10 min and `shotExtractPerDay` per day per user (rate_hit; 30 without payments), body ≤ 5.9 MB (images ≤ 1.5 MB each,
 * ≤ 4.2 MB together, JPEG / PNG / WebP matching their bytes, ≤ 4). Image text is data, not instructions. Pictures are
 * only forwarded to the model – never stored, never logged; only error codes are logged. Env: `ANTHROPIC_API_KEY`
 * (secret), optional `VISION_MODEL` (default `COACH_MODEL`, then `claude-opus-5-5`).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "@netlify/functions";
import { limitOf } from "../../src/billing/plans";
import {
  ExtractBody,
  Extraction,
  MAX_BODY_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  MAX_LONG_EDGE,
  SYSTEM_PROMPT,
  TOOL_INPUT_SCHEMA,
  TOOL_NAME,
  type ExtractReply,
  type ExtractedTrade,
} from "../../src/journal/extract/contract";
import { requireUser } from "./_lib/auth";
import { envOptional } from "./_lib/env";
import { handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { paymentsConfigured, requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";

export const DEFAULT_VISION_MODEL = "claude-opus-5-5";
export const VISION_OFF_MESSAGE = "Der Screenshot-Import ist auf diesem Server nicht eingerichtet.";
/** Reads per user without payments (the plan limit applies once payments are set up). */
export const DEFAULT_DAILY = 30;

type VisionClient = Pick<Anthropic, "beta">;
let clientOverride: VisionClient | null = null;
let cached: { key: string; client: VisionClient } | null = null;

/** Tests: inject a fake client (`null` restores the real one). */
export function setVisionClientForTests(c: VisionClient | null): void {
  clientOverride = c;
  cached = null;
}

function visionClient(apiKey: string): VisionClient {
  if (clientOverride) return clientOverride;
  // no retry: a second attempt would double a call that already takes seconds
  if (!cached || cached.key !== apiKey) cached = { key: apiKey, client: new Anthropic({ apiKey, maxRetries: 0, timeout: 25_000 }) };
  return cached.client;
}

/** The user message's text part: the trader's own orientation (unverified) and the picture order. */
export function buildPrompt(body: ExtractBody): string {
  const lines = [`Es folgen ${body.images.length} Screenshot${body.images.length === 1 ? "" : "s"} (Bild 0 bis ${body.images.length - 1}). Lies alle sichtbaren Trades und rufe report_trades auf.`];
  const h = body.hint;
  if (h && (h.market || h.timezone || h.exchange || h.pair)) {
    const parts = [h.exchange && `Börse: ${h.exchange}`, h.pair && `Markt: ${h.pair}`, h.market && `Handelsart: ${h.market === "spot" ? "Spot" : "Perpetual"}`, h.timezone && `Zeitzone des Nutzers: ${h.timezone}`].filter(Boolean);
    lines.push(`Vermutung des Nutzers, nur zur Orientierung und nicht als Wert zu übernehmen: ${parts.join("; ")}.`);
  }
  return lines.join("\n");
}

/** A trade that carries no reading at all (the model found nothing worth reporting). */
function isEmptyTrade(t: ExtractedTrade): boolean {
  return !t.market && !t.entries.length && !t.exits.length && !t.stop && !t.targets.length && !t.realizedPnl;
}

/**
 * Makes the answer self-consistent: a field that is not there has confidence 0, image numbers beyond the request are
 * dropped, trades without any reading disappear.
 */
export function sanitize(x: Extraction, imageCount: number): Extraction {
  const trades = x.trades
    .filter((t) => !isEmptyTrade(t))
    .map((t): ExtractedTrade => {
      const c = { ...t.confidence };
      if (!t.market) c.market = 0;
      if (!t.side) c.side = 0;
      if (!t.entries.length) c.entries = 0;
      if (!t.exits.length) c.exits = 0;
      if (!t.stop) c.stop = 0;
      if (!t.targets.length) c.targets = 0;
      if (!t.leverage) c.leverage = 0;
      if (!t.fees) c.fees = 0;
      if (!t.funding) c.funding = 0;
      if (!t.realizedPnl) c.realizedPnl = 0;
      if (!t.exchange) c.exchange = 0;
      if (!t.productType) c.productType = 0;
      return { ...t, confidence: c, sources: [...new Set(t.sources.filter((i) => i < imageCount))] };
    });
  return { ...x, trades };
}

/** Sends the pictures to the model and returns the validated extraction. API failures become the shared error envelope. */
export async function extract(body: ExtractBody, apiKey: string, model: string): Promise<ExtractReply> {
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await visionClient(apiKey).beta.messages.create({
      model,
      max_tokens: 8000,
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      tools: [{ name: TOOL_NAME, description: "Meldet die im Screenshot sichtbaren Trades mit Konfidenz je Feld.", input_schema: TOOL_INPUT_SCHEMA as unknown as Anthropic.Beta.BetaTool["input_schema"] }],
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [
        {
          role: "user",
          content: [
            ...body.images.flatMap((img, i): Anthropic.Beta.BetaContentBlockParam[] => [
              { type: "text", text: `Bild ${i}:` },
              { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } },
            ]),
            { type: "text", text: buildPrompt(body) },
          ],
        },
      ],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "shot_extract_busy", "Die KI ist gerade ausgelastet – bitte gleich noch einmal.", undefined, { "retry-after": "30" });
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      console.error("[fn] shot-extract auth", e.status);
      throw new HttpError(503, "shot_extract_unavailable", VISION_OFF_MESSAGE);
    }
    if (e instanceof Anthropic.BadRequestError) {
      console.error("[fn] shot-extract bad request", e.status);
      throw new HttpError(502, "shot_extract_failed", "Die KI konnte die Bilder nicht lesen. Probiere einen anderen Ausschnitt oder trage die Werte von Hand ein.");
    }
    if (e instanceof Anthropic.APIError) {
      console.error("[fn] shot-extract api", e.status ?? "network");
      throw new HttpError(502, "shot_extract_failed", "Die KI antwortet gerade nicht – du kannst die Werte von Hand eintragen.");
    }
    throw e;
  }
  const served = res.model || model;
  if (res.stop_reason === "refusal") return { trades: [], timezone: null, notes: [], model: served, reason: "refusal" };
  const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!call) return { trades: [], timezone: null, notes: [], model: served, reason: "empty" };
  const parsed = Extraction.safeParse(call.input);
  if (!parsed.success) {
    console.error("[fn] shot-extract invalid", parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}:${i.code}`).join(","));
    throw new HttpError(502, "shot_extract_invalid", "Die KI-Antwort war unvollständig. Bitte versuche es noch einmal.");
  }
  const clean = sanitize(parsed.data, body.images.length);
  if (!clean.trades.length) return { ...clean, model: served, reason: "empty" };
  return { ...clean, model: served };
}

export default handler(async (req) => {
  requireMethod(req, "GET", "POST");
  const apiKey = envOptional("ANTHROPIC_API_KEY");
  if (req.method.toUpperCase() === "GET") return json({ enabled: !!apiKey, maxImages: MAX_IMAGES, maxLongEdge: MAX_LONG_EDGE, maxImageBytes: MAX_IMAGE_BYTES });
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  if (!apiKey) throw new HttpError(503, "shot_extract_unavailable", VISION_OFF_MESSAGE);
  const plan = await requireFeature(user.id, "shotExtract");
  const daily = paymentsConfigured() ? limitOf(plan.plan, "shotExtractPerDay") : DEFAULT_DAILY;
  if (!(daily > 0)) throw new HttpError(402, "limit_reached", "Das Limit deines Tarifs ist erreicht.", { key: "shotExtractPerDay", limit: daily, plan: plan.plan });
  // the body is read (and rejected when malformed or oversized) BEFORE the limits count it
  const body = await readJson(req, ExtractBody, { maxBytes: MAX_BODY_BYTES });
  await enforceRateLimit(rateKey("shot-extract", user.id), 6, 600);
  if (Number.isFinite(daily)) await enforceRateLimit(rateKey("shot-extract-day", user.id), daily, 86_400);
  const model = envOptional("VISION_MODEL") ?? envOptional("COACH_MODEL") ?? DEFAULT_VISION_MODEL;
  return json(await extract(body, apiKey, model));
});

export const config: Config = { path: "/api/v1/shot-extract", method: ["GET", "POST"] };
