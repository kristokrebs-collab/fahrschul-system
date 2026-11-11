/**
 * POST /api/v1/hooks/tradingview/:token (P11) – TradingView alert webhook. The personal token in the URL (scope
 * `webhook:tradingview`, created in Konto → API & Webhooks) identifies the trader; TradingView cannot send headers.
 * Body = the alert message as JSON (TradingView posts it as text/plain), templates in the UI (`TV_TEMPLATES`):
 *   open:  {"action":"open","symbol":"{{ticker}}","side":"long","price":{{close}},"qty":{{strategy.order.contracts}},
 *           "setup":"Box-Breakout","timeframe":"{{interval}}"}      (stop, target, id, note, account optional)
 *   close: {"action":"close","symbol":"{{ticker}}","price":{{close}}}  (side, id, qty optional)
 * open → a new open trade (origin webhook; the setup name is matched against the trader's setups, else a tag). A size
 *        (`qty` contracts or `size` in USDT) is required – without one no P&L can ever be computed. stop/target 0 = none.
 *        With an `id`: while a webhook trade under that key is still open the alert is a re-delivery ("exists"); once
 *        it is closed the next open under the same key (Pine's constant `{{strategy.order.id}}`, e.g. "Long") is a NEW
 *        trade (next sequence number) instead of being dropped.
 * close → by `id` the newest open webhook trade under that key (a key whose trades are all closed = re-delivery,
 *        "unchanged"); otherwise (no id, or an id never opened – the exit order of strategy.close/exit has its own id)
 *        the newest open webhook trade of the symbol, of the given side
 *        ("long"/"short", or "sell" = closes a long, "buy" = a short). A qty/size on the close fills a missing size.
 * test → `{"action":"test","symbol":"{{ticker}}"}`: the connection assistant's test signal. Creates no trade, needs no size,
 *        works in every plan; it is only recorded in `webhook_receipts` ("Empfang" in the assistant).
 * signal/1 + branchen-trend/1 → the same address also takes the signal formats of the receiver (`signals-receive.mts`, `_lib/signals`):
 *        no journal trade, no plan gate (a signal has no size and sends no order), ≤ 8 KiB, de-duplicated; every other message of this
 *        function (test, accepted open / close) is ALSO written to the signal list, best effort, so the card shows one list.
 * Re-delivered alerts change nothing. 60 per minute per token and 300 per minute per calling address; every wrong token gets the same 401; the body is read with a 16 KiB cap; plan feature `apiAccess` for open / close. Every call is
 * written to the receipt log (kind, symbol, short reason – no alert text). Always JSON, never echoes the token.
 */
import type { Config, Context } from "@netlify/functions";
import { clientIp, handler, HttpError, json, requireMethod } from "./_lib/http";
import { requireFeature } from "./_lib/plan";
import { supabaseAdmin } from "./_lib/supabase";
import { parseTvAlert, tvCloseFill, tvCloseSet, tvCloseSide, tvOpenItem, tvSymbolToPair, tvTestPing, tvTradeId, type SetupRef } from "./_lib/exchanges/inbound";
import { DEFAULT_TZ } from "./_lib/exchanges/mapping";
import { profileTz, upsertSyncedTrades } from "./_lib/exchanges/store";
import { recordReceipt } from "./_lib/connections/receipts";
import { readBodyLimited, receiveRateLimits, resolveSignalOwner } from "./_lib/signals/receive";
import { MAX_SIGNAL_BYTES, isSignalSchemaBody, parseSignalBody } from "./_lib/signals/schema";
import { ingest } from "./_lib/signals/store";

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

interface OpenRow {
  id: string;
  data: Record<string, unknown>;
  deleted: boolean;
}

/** Every webhook trade the trader created under one alert `id` (externalId), newest first. */
async function webhookTradesByKey(userId: string, key: string): Promise<OpenRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("journal_docs")
    .select("id,data,deleted,updated_at")
    .eq("user_id", userId)
    .eq("kind", "trade")
    .eq("data->>externalId", key)
    .eq("data->origin->>kind", "webhook")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw new HttpError(500, "db_error");
  return (data ?? []) as OpenRow[];
}

export default handler(async (req, ctx) => {
  requireMethod(req, "POST");
  const token = tokenOf(req, ctx);
  // same order and same checks as `signals-receive` (Runde 11): limit per presented token AND per calling address (a flood of
  // random tokens is limited too) → token (ONE uniform 401 for every wrong token, never a 403) → body read with a cap
  await receiveRateLimits(token, clientIp(req, ctx));
  const owner = await resolveSignalOwner(token);
  const text = await readBodyLimited(req, MAX_BYTES);
  // the assistant's test signal: recorded, no trade, no plan gate (connecting must be testable before anything else)
  const ping = tvTestPing(text);
  if (ping) {
    await recordReceipt(owner.userId, { kind: "test", via: ping.via, symbol: ping.symbol });
    await mirrorToSignals(owner.userId, text);
    return json({ ok: true, result: "test" });
  }
  // the signal formats (signal/1, branchen-trend/1) belong to the signal receiver: same address, no journal trade, no plan gate
  if (isSignalSchemaBody(text)) {
    if (new TextEncoder().encode(text).length > MAX_SIGNAL_BYTES) throw new HttpError(413, "payload_too_large");
    const out = await ingest(owner.userId, text, Date.now());
    if (out.http === 422) throw new HttpError(422, "invalid_signal", out.reason);
    return json({ ok: true, result: out.result, ...(out.signalId ? { signalId: out.signalId } : {}) });
  }
  try {
    const res = await handleAlert(owner.userId, text);
    await mirrorToSignals(owner.userId, text);
    return res;
  } catch (e) {
    if (e instanceof HttpError) await recordReceipt(owner.userId, { kind: "rejected", detail: `${e.status} ${e.message}` });
    throw e;
  }
});

/** The older messages also show up in the signal list. Best effort: it never changes the answer of this function. */
async function mirrorToSignals(userId: string, text: string): Promise<void> {
  try {
    // a message the signal format cannot carry (e.g. a short entry) is not listed as "rejected": the journal alert itself was fine
    if (parseSignalBody(text, Date.now()).ok) await ingest(userId, text, Date.now());
  } catch {
    /* the signal list is an addition; the journal alert has been handled */
  }
}

async function handleAlert(userId: string, text: string): Promise<Response> {
  const owner = { userId };
  await requireFeature(owner.userId, "apiAccess");
  const parsed = parseTvAlert(text);
  if (!parsed.ok) throw new HttpError(422, "invalid_alert", parsed.message);
  const a = parsed.alert;
  const now = Date.now();
  const tz = (await profileTz(owner.userId)) ?? DEFAULT_TZ;

  const sb = supabaseAdmin();
  if (a.action === "open") {
    let seq = 0;
    if (a.id) {
      const same = await webhookTradesByKey(owner.userId, a.id);
      const open = same.find((r) => !r.deleted && r.data.status === "open");
      if (open) return received(owner.userId, "open", a, { ok: true, id: open.id, result: "exists" });
      // every trade ever created under this key (tombstones too) holds a sequence number – take the next free one
      const taken = new Set(same.map((r) => r.id));
      seq = same.length;
      while (taken.has(tvTradeId(owner.userId, a, now, seq))) seq++;
    }
    const item = tvOpenItem(a, { userId: owner.userId, nowMs: now, tz, setups: await setupsOf(owner.userId), seq });
    const res = await upsertSyncedTrades(owner.userId, [item]);
    return received(owner.userId, "open", a, { ok: true, id: item.id, result: res[item.id] === "inserted" ? "created" : "exists" });
  }

  // close: the newest open webhook trade under the id, else the newest open one of the symbol (and side)
  let target: OpenRow | null = null;
  if (a.id) {
    const same = await webhookTradesByKey(owner.userId, a.id);
    target = same.find((r) => !r.deleted && r.data.status === "open") ?? null;
    // the key is known but nothing under it is open any more: a re-delivered close – never close another trade with it
    if (!target && same.length) return received(owner.userId, "close", a, { ok: true, id: same[0]!.id, result: "unchanged" });
  }
  if (!target && (a.symbol || a.ticker)) {
    let q = sb
      .from("journal_docs")
      .select("id,data,deleted,updated_at")
      .eq("user_id", owner.userId)
      .eq("kind", "trade")
      .eq("deleted", false)
      .eq("data->>status", "open")
      .eq("data->>pair", tvSymbolToPair(a.symbol ?? a.ticker ?? ""))
      .eq("data->origin->>kind", "webhook");
    const side = tvCloseSide(a.side);
    if (side) q = q.eq("data->>side", side);
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(1);
    if (error) throw new HttpError(500, "db_error");
    target = ((data ?? [])[0] as OpenRow | undefined) ?? null;
  }
  if (!target) throw new HttpError(404, "no_open_trade", "Kein offener Webhook-Trade für dieses Symbol gefunden.");
  const id = target.id;
  const res = await upsertSyncedTrades(owner.userId, [{ id, set: tvCloseSet(a, { nowMs: now, tz }), fill: tvCloseFill(a, target.data), new: {} }]);
  return received(owner.userId, "close", a, { ok: true, id, result: res[id] === "updated" ? "closed" : "unchanged" });
}

/** Logs an accepted trade alert in the receipt list and answers. */
async function received(userId: string, kind: "open" | "close", a: { symbol?: string; ticker?: string }, body: Record<string, unknown>): Promise<Response> {
  await recordReceipt(userId, { kind, symbol: a.symbol ?? a.ticker ?? null, detail: String(body.result ?? "") });
  return json(body);
}

export const config: Config = { path: "/api/v1/hooks/tradingview/:token", method: ["POST"] };
