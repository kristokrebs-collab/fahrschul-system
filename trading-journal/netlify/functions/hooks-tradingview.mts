/**
 * POST /api/v1/hooks/tradingview/:token (P11) – TradingView alert webhook. The personal token in the URL (scope
 * `webhook:tradingview`, created in Konto → API & Webhooks) identifies the trader; TradingView cannot send headers.
 * Body = the alert message as JSON (TradingView posts it as text/plain), template in the UI:
 *   open:  {"action":"open","id":"{{strategy.order.id}}","symbol":"{{ticker}}","side":"long","price":{{close}},
 *           "stop":0,"target":0,"setup":"Box-Breakout","timeframe":"{{interval}}"}
 *   close: {"action":"close","id":"{{strategy.order.id}}","symbol":"{{ticker}}","price":{{close}}}
 * open → a new open trade (origin webhook; the setup name is matched against the trader's setups, else a tag);
 * close → closes that open webhook trade (by id, else the newest open one of the symbol). Re-delivered alerts change
 * nothing. 60 per minute per token; plan feature `apiAccess`. Always JSON, never echoes the token.
 */
import type { Config, Context } from "@netlify/functions";
import { handler, HttpError, json, requireMethod } from "./_lib/http";
import { requireFeature } from "./_lib/plan";
import { enforceRateLimit, rateKey } from "./_lib/rateLimit";
import { supabaseAdmin } from "./_lib/supabase";
import { parseTvAlert, tvCloseSet, tvOpenItem, tvSymbolToPair, tvTradeId, type SetupRef } from "./_lib/exchanges/inbound";
import { DEFAULT_TZ } from "./_lib/exchanges/mapping";
import { profileTz, upsertSyncedTrades } from "./_lib/exchanges/store";
import { hashToken, resolveToken } from "./_lib/exchanges/tokens";

const MAX_BYTES = 16 * 1024;

function tokenOf(req: Request, ctx: Context | undefined): string {
  const fromParams = (ctx as { params?: Record<string, string> } | undefined)?.params?.token;
  return fromParams ?? new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
}

async function setupsOf(userId: string): Promise<SetupRef[]> {
  const { data } = await supabaseAdmin().from("journal_docs").select("data").eq("user_id", userId).eq("kind", "settings").eq("id", "settings").maybeSingle();
  const list = (data as { data?: { setups?: unknown } } | null)?.data?.setups;
  return Array.isArray(list) ? list.filter((s): s is SetupRef => typeof s?.id === "string" && typeof s?.name === "string") : [];
}

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const token = tokenOf(req, ctx);
  await enforceRateLimit(rateKey("hook-tv", hashToken(token).slice(0, 24)), 60, 60);
  const owner = await resolveToken(token, "webhook:tradingview");
  await requireFeature(owner.userId, "apiAccess");
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new HttpError(413, "payload_too_large");
  const parsed = parseTvAlert(text);
  if (!parsed.ok) throw new HttpError(422, "invalid_alert", parsed.message);
  const a = parsed.alert;
  const now = Date.now();
  const tz = (await profileTz(owner.userId)) ?? DEFAULT_TZ;

  if (a.action === "open") {
    const item = tvOpenItem(a, { userId: owner.userId, nowMs: now, tz, setups: await setupsOf(owner.userId) });
    const res = await upsertSyncedTrades(owner.userId, [item]);
    return json({ ok: true, id: item.id, result: res[item.id] === "inserted" ? "created" : "exists" });
  }

  // close: by id, else the newest open webhook trade of the symbol
  let id: string | null = a.id ? tvTradeId(owner.userId, a, now) : null;
  const sb = supabaseAdmin();
  if (id) {
    const { data } = await sb.from("journal_docs").select("id,data,deleted").eq("user_id", owner.userId).eq("kind", "trade").eq("id", id).maybeSingle();
    const row = data as { data: Record<string, unknown>; deleted: boolean } | null;
    if (!row || row.deleted || row.data.status !== "open") id = null;
  } else if (a.symbol || a.ticker) {
    const { data } = await sb
      .from("journal_docs")
      .select("id,updated_at")
      .eq("user_id", owner.userId)
      .eq("kind", "trade")
      .eq("deleted", false)
      .eq("data->>status", "open")
      .eq("data->>pair", tvSymbolToPair(a.symbol ?? a.ticker ?? ""))
      .eq("data->origin->>kind", "webhook")
      .order("updated_at", { ascending: false })
      .limit(1);
    id = ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
  }
  if (!id) throw new HttpError(404, "no_open_trade", "Kein offener Webhook-Trade für dieses Symbol gefunden.");
  const res = await upsertSyncedTrades(owner.userId, [{ id, set: tvCloseSet(a, { nowMs: now, tz }), fill: {}, new: {} }]);
  return json({ ok: true, id, result: res[id] === "updated" ? "closed" : "unchanged" });
});

export const config: Config = { path: "/api/v1/hooks/tradingview/:token", method: ["POST"] };
