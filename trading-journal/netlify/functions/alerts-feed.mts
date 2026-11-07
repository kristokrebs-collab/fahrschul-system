/**
 * /api/v1/alerts/feed – the Zustellprotokoll and the browser channel of the four alarms (C2).
 *
 *   GET  → `{ events, other, browser }`
 *          events   the last 40 events with every delivery (channel, status, reason code, attempts) – a delivery that ran out of retries is
 *                   `dead` (the dead letter: visible, never silent); an event the cooldown held back has `suppressed: "cooldown"` and no delivery
 *          other    the last tests (test call, test mail) and the deliveries without an event
 *          browser  browser deliveries still waiting (`queued`, not older than 6 h): the open app shows them and acknowledges them
 *   POST `{ ack: [delivery id …] }` → marks the account's own `queued` browser deliveries as `shown` (≤ 20 ids).
 *
 * Guards: signed in (aal2 if 2FA), own rows only (filtered by the verified user id), rate limit. Reason codes only – the client maps them to German.
 */
import type { Config } from "@netlify/functions";
import { z } from "zod";
import { requireUser } from "./_lib/auth";
import { handler, HttpError, json, readJson, requireMethod } from "./_lib/http";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";

const BROWSER_MAX_AGE_MS = 6 * 60 * 60_000;
const Ack = z.object({ ack: z.array(z.string().uuid()).min(1).max(20) });

type Row = Record<string, unknown>;

function deliveryOut(d: Row): Record<string, unknown> {
  return { id: d.id, channel: d.channel, status: d.status, reason: d.reason ?? null, attempts: d.attempts ?? 0, at: d.updated_at ?? d.created_at ?? null };
}

export default handler(async (req) => {
  requireMethod(req, "GET", "POST");
  const user = await requireUser(req, { aal2: "ifEnrolled" });
  const sb = supabaseAdmin();

  if (req.method.toUpperCase() === "POST") {
    await enforceRateLimit(rateKey("alerts-ack", user.id), 60, 600);
    const body = await readJson(req, Ack, { maxBytes: 2 * 1024 });
    const { error } = await sb.from("alert_deliveries").update({ status: "shown", reason: null }).in("id", body.ack).eq("user_id", user.id).eq("channel", "browser").eq("status", "queued");
    if (error) throw new HttpError(500, "internal");
    return json({ acked: body.ack.length });
  }

  await enforceRateLimit(rateKey("alerts-feed", user.id), 120, 600);
  const ev = await sb
    .from("alert_events")
    .select("id, source, market, event, value, detail, suppressed, occurred_at, alert_deliveries(id, channel, status, reason, attempts, created_at, updated_at)")
    .eq("user_id", user.id)
    .order("occurred_at", { ascending: false })
    .limit(40);
  if (ev.error) {
    if (ev.error.code && ["42P01", "PGRST205", "PGRST200"].includes(ev.error.code)) throw new HttpError(503, "alerts_unavailable", "Die Alarme sind auf diesem Server noch nicht eingerichtet (Datenbank-Migration fehlt).");
    throw new HttpError(500, "internal");
  }
  const other = await sb.from("alert_deliveries").select("id, kind, channel, status, reason, attempts, created_at, updated_at").eq("user_id", user.id).is("event_id", null).order("created_at", { ascending: false }).limit(15);

  const events = ((ev.data ?? []) as Row[]).map((e) => ({
    id: e.id,
    source: e.source,
    market: e.market,
    event: e.event,
    value: e.value ?? null,
    detail: e.detail ?? null,
    suppressed: e.suppressed ?? null,
    at: e.occurred_at,
    deliveries: ((e.alert_deliveries ?? []) as Row[]).map(deliveryOut),
  }));
  const now = Date.now();
  const browser = events.flatMap((e) => {
    const d = e.deliveries.find((x) => x.channel === "browser" && x.status === "queued");
    const at = Date.parse(String(e.at));
    return d && now - at <= BROWSER_MAX_AGE_MS ? [{ deliveryId: d.id, event: e.event, market: e.market, source: e.source, detail: e.detail, at: e.at }] : [];
  });
  return json({ events, other: ((other.data ?? []) as Row[]).map((d) => ({ ...deliveryOut(d), kind: d.kind })), browser });
});

export const config: Config = { path: "/api/v1/alerts/feed", method: ["GET", "POST"] };
