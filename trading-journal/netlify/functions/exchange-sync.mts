/**
 * Exchange sync (P11).
 *
 * GET  /api/v1/exchange/sync → status: `{ configured, cron, plan, connections, runs }` (no secrets – key last 4 only).
 * GET  /api/v1/exchange/sync?since=<ISO>|&pull=1 → `{ trades: [{ id, data, updatedAt }], more, serverAt }`: trades the
 *      server wrote (sync, webhook, REST) changed after `since` – signed-in devices WITHOUT cloud sync merge them locally.
 * POST /api/v1/exchange/sync[?dryRun=1] `{ connectionId?, tz?, from? }` → one incremental sync (≈ 8 s budget; `more`
 *      = call again to continue). `dryRun=1` reads and maps without writing and returns the preview + per-position checks.
 *
 * aal2 when 2FA is on; POST 30 per 10 min; plan feature `exchangeSync` (not gated while payments are not set up).
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./_lib/auth";
import { handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { clientTz, CRON_EVERY_MIN, cronEnabled, exchangePlanState, nextCronAt, SYNC_BUDGET_MS } from "./_lib/exchanges/api";
import { DEFAULT_TZ } from "./_lib/exchanges/mapping";
import { connectionInfo, encryptionConfigured, listConnections, loadConnection, profileTz, pullSyncedTrades, recentRuns, runningRun } from "./_lib/exchanges/store";
import { runSync } from "./_lib/exchanges/sync";

const Body = z.object({
  connectionId: z.string().uuid().optional(),
  tz: z.string().max(64).optional(),
  from: z.string().datetime({ offset: true }).optional(),
});

/** A sync of the same connection that started less than this ago blocks a second one. */
const RUNNING_GUARD_MS = 2 * 60_000;

export default handler(async (req) => {
  requireMethod(req, "GET", "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  const url = new URL(req.url);

  if (req.method.toUpperCase() === "GET") {
    await enforceRateLimit(rateKey("exchange-status", user.id), 240, 600);
    const since = url.searchParams.get("since");
    if (since !== null || url.searchParams.get("pull") === "1") {
      if (since && Number.isNaN(Date.parse(since))) throw new HttpError(400, "invalid_since", "Ungültiger Zeitpunkt.");
      const serverAt = new Date().toISOString();
      const page = await pullSyncedTrades(user.id, since ? new Date(since).toISOString() : null);
      return json({ ...page, serverAt });
    }
    const [rows, runs, plan] = await Promise.all([listConnections(user.id), recentRuns(user.id, 12), exchangePlanState(user.id)]);
    return json({
      configured: encryptionConfigured(),
      cron: { enabled: cronEnabled(), everyMin: CRON_EVERY_MIN, nextAt: nextCronAt() },
      plan,
      connections: rows.map(connectionInfo),
      runs,
    });
  }

  await enforceRateLimit(rateKey("exchange-sync", user.id), 30, 600);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const body = req.headers.get("content-type")?.startsWith("application/json") ? await readJson(req, Body, { maxBytes: 1024 }) : {};
  await requireFeature(user.id, "exchangeSync");

  const rows = await listConnections(user.id);
  const meta = body.connectionId ? rows.find((r) => r.id === body.connectionId) : rows.find((r) => r.status !== "revoked");
  if (!meta) throw new HttpError(404, "connection_not_found", "Keine Börse verbunden.");
  if (await runningRun(user.id, meta.id, RUNNING_GUARD_MS)) throw new HttpError(409, "sync_running", "Ein Sync läuft gerade schon. Einen Moment …");
  const connection = await loadConnection(user.id, meta.id);
  if (!connection) throw new HttpError(404, "connection_not_found", "Keine Börse verbunden.");

  const tz = clientTz(body.tz) ?? (await profileTz(user.id)) ?? DEFAULT_TZ;
  const from = body.from ? Date.parse(body.from) : undefined;
  const out = await runSync({ userId: user.id, connection, kind: "manual", dryRun, tz, from, deadline: Date.now() + SYNC_BUDGET_MS });
  return json(out);
});

export const config: Config = { path: "/api/v1/exchange/sync", method: ["GET", "POST"] };
