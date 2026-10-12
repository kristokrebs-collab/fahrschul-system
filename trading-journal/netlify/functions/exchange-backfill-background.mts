/**
 * POST /api/v1/exchange/backfill `{ connectionId, from, runId, tz? }` (P11, Netlify BACKGROUND function: answers 202 at
 * once and runs up to 15 min). The first import: every closed position since `from` (≤ 366 days back), with fills and
 * TP/SL, through the same `runSync` as the manual sync. Progress and result land in `sync_runs` under the client's
 * `runId` (the client polls `GET /api/v1/exchange/sync`). 3 per hour; plan feature `exchangeSync`.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./_lib/auth";
import { handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { clientTz, requireExchangeSetup } from "./_lib/exchanges/api";
import { DEFAULT_TZ } from "./_lib/exchanges/mapping";
import { loadConnection, profileTz } from "./_lib/exchanges/store";
import { runSync } from "./_lib/exchanges/sync";

const Body = z.object({
  connectionId: z.string().uuid(),
  from: z.string().datetime({ offset: true }),
  runId: z.string().uuid(),
  tz: z.string().max(64).optional(),
});

/** Background functions stop at 15 min – leave room for the last writes. */
export const BACKFILL_BUDGET_MS = 13 * 60_000;
export const BACKFILL_FILL_BUDGET = 3_000;

export default handler(async (req) => {
  requireMethod(req, "POST");
  requireExchangeSetup();
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  await enforceRateLimit(rateKey("exchange-backfill", user.id), 3, 3600, { failClosed: true });
  const body = await readJson(req, Body, { maxBytes: 1024 });
  await requireFeature(user.id, "exchangeSync");
  const connection = await loadConnection(user.id, body.connectionId);
  if (!connection) throw new HttpError(404, "connection_not_found", "Diese Verbindung gibt es nicht (mehr).");
  const tz = clientTz(body.tz) ?? (await profileTz(user.id)) ?? DEFAULT_TZ;
  try {
    const out = await runSync({
      userId: user.id,
      connection,
      kind: "backfill",
      dryRun: false,
      tz,
      from: Date.parse(body.from),
      runId: body.runId,
      deadline: Date.now() + BACKFILL_BUDGET_MS,
      fillBudget: BACKFILL_FILL_BUDGET,
    });
    console.log("[fn] exchange backfill", JSON.stringify({ status: out.status, ...out.counts, more: out.more }));
    return json({ ok: true, runId: out.runId });
  } catch (e) {
    // already recorded in sync_runs by runSync; the 202 went out long ago
    console.error("[fn] exchange backfill failed", e instanceof HttpError ? e.code : "error");
    throw e;
  }
});

export const config: Config = { path: "/api/v1/exchange/backfill", method: ["POST"] };
