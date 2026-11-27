/**
 * POST /api/v1/log – client error reports (only sent with the telemetry opt-in, `src/cloud/report.ts`).
 * Login optional. Everything is scrubbed again here (`src/cloud/scrub.ts`: no e-mails, tokens, ids, IPs, query strings
 * or trade numbers), sampled by `LOG_SAMPLE_RATE` (0–1, default 1) and rate-limited per IP hash and per fingerprint.
 * Rows land in `app_errors` (service role only; purged after 30 days by `backup-nightly`).
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { errorFingerprint, scrubExtra, scrubStack, scrubText, scrubUrl } from "../../src/cloud/scrub";
import { ipRateId } from "./_lib/audit";
import { optionalUser } from "./_lib/auth";
import { envNumber } from "./_lib/env";
import { clientIp, handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

const Body = z.object({
  message: z.string().min(1).max(4000),
  stack: z.string().max(20000).nullish(),
  url: z.string().max(2000).nullish(),
  release: z.string().max(64).nullish(),
  edition: z.enum(["personal", "share"]).nullish(),
  source: z.enum(["boundary", "window", "promise", "manual"]).optional(),
  fingerprint: z.string().max(64).optional(),
  extra: z.record(z.unknown()).optional(),
});

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  let user: Awaited<ReturnType<typeof optionalUser>> = null;
  try {
    user = await optionalUser(req);
  } catch (e) {
    // an expired session must not swallow the report – it is stored without the user
    if (!(e instanceof HttpError) || e.status !== 401) throw e;
  }
  await enforceRateLimit(rateKey("log", ipRateId(clientIp(req, ctx)) ?? "anon"), 30, 600);
  const body = await readJson(req, Body, { maxBytes: 32 * 1024 });

  const message = scrubText(body.message, 2000);
  const stack = scrubStack(body.stack);
  const fingerprint = scrubText(body.fingerprint ?? errorFingerprint(message, stack), 64);
  await enforceRateLimit(rateKey("log-fp", fingerprint), 20, 3600);

  const rate = Math.min(1, Math.max(0, envNumber("LOG_SAMPLE_RATE", 1)));
  if (Math.random() >= rate) return json({ stored: false, sampled: true }, { status: 202 });

  const { error } = await supabaseAdmin()
    .from("app_errors")
    .insert({
      user_id: user?.id ?? null,
      fingerprint,
      message,
      stack,
      url: scrubUrl(body.url),
      release: body.release ? scrubText(body.release, 64) : null,
      edition: body.edition ?? null,
      ua: scrubText(req.headers.get("user-agent") ?? "", 300) || null,
      meta: { source: body.source ?? "manual", extra: scrubExtra(body.extra) },
    });
  if (error) {
    console.error("[fn] app_errors insert failed", error.code);
    throw new HttpError(503, "log_unavailable");
  }
  return json({ stored: true }, { status: 202 });
});

export const config: Config = { path: "/api/v1/log", method: ["POST"] };
