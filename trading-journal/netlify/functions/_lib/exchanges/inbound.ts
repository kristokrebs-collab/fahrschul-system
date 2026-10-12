/**
 * Trades that arrive from outside (P11): TradingView alerts (`hooks-tradingview.mts`) and the personal REST API
 * (`trades-api.mts`). PURE – validation and mapping to `upsert_synced_trade` items; the functions do the I/O.
 * Both only ever CREATE records (and the webhook closes its own open trades); they never touch a trader's existing notes.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { localWallClock, round, safeTz, symbolToPair } from "./mapping";

const num = z.union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/).transform(Number)]).refine((n) => Number.isFinite(n));
const optNum = num.optional().nullable();
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

/* ------------------------------------------------------------------ shared */

/** Trader-owned defaults of a new record (same shape as a synced position's `new`). */
function freshTrade(nowIso: string, account: "makro" | "scalp"): Record<string, unknown> {
  return {
    account,
    timeframe: "",
    stop: null,
    target: null,
    exit: null,
    size: null,
    leverage: null,
    fees: null,
    pnlManual: null,
    setups: [],
    checks: {},
    conviction: null,
    followedPlan: null,
    emotion: "",
    reason: "",
    notes: "",
    chart: "",
    mistakes: [],
    pnl: null,
    r: null,
    createdAt: nowIso,
  };
}

const idPart = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
const shortHash = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);

/** TradingView `{{interval}}` → journal timeframe ("15" → "15m", "240" → "4h", "D" → "1D"); unknown → "". */
export function tvTimeframe(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase();
  const map: Record<string, string> = {
    "1": "1m", "5": "5m", "15": "15m", "30": "30m", "45": "45m", "60": "1h", "120": "2h", "240": "4h",
    D: "1D", "1D": "1D", "3D": "3D", W: "1W", "1W": "1W",
    "1M": "1m", "5M": "5m", "15M": "15m", "30M": "30m", "45M": "45m", "1H": "1h", "2H": "2h", "4H": "4h",
  };
  return map[s] ?? "";
}

/** `BINANCE:BTCUSDT.P` / `BTCUSDT.P` / `BTC/USDT` → `BTC/USDT`. */
export function tvSymbolToPair(v: string): string {
  const raw = v.includes(":") ? v.slice(v.indexOf(":") + 1) : v;
  const s = raw.replace(/\.P$/i, "").replace(/PERP$/i, "");
  return s.includes("/") ? s.toUpperCase() : symbolToPair(s);
}

/* ------------------------------------------------------------------ TradingView */

export const TvAlert = z.object({
  action: z.enum(["open", "close"]).default("open"),
  /** Your own trade key (e.g. `{{strategy.order.id}}`); links open and close. */
  id: z.string().trim().min(1).max(64).optional(),
  symbol: z.string().trim().min(2).max(40).optional(),
  ticker: z.string().trim().min(2).max(40).optional(),
  side: z.enum(["long", "short", "buy", "sell", "LONG", "SHORT", "BUY", "SELL"]).optional(),
  price: optNum,
  entry: optNum,
  exit: optNum,
  stop: optNum,
  target: optNum,
  qty: optNum,
  size: optNum,
  leverage: optNum,
  setup: z.string().trim().max(60).optional(),
  timeframe: z.union([z.string(), z.number()]).optional(),
  note: z.string().max(2000).optional(),
  account: z.enum(["makro", "scalp"]).optional(),
});
export type TvAlert = z.infer<typeof TvAlert>;

/** JSON body of a TradingView alert (sent as text/plain); German error for anything else. */
export function parseTvAlert(text: string): { ok: true; alert: TvAlert } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "Die Alarm-Nachricht ist kein JSON. Nutze die Vorlage aus Konto → API & Webhooks." };
  }
  const p = TvAlert.safeParse(raw);
  if (!p.success) return { ok: false, message: `Feld ungültig: ${p.error.issues.map((i) => i.path.join(".") || "(Nachricht)").join(", ")}.` };
  if (!p.data.symbol && !p.data.ticker && !p.data.id) return { ok: false, message: "Es fehlt das Symbol (symbol oder ticker)." };
  return { ok: true, alert: p.data };
}

export const tvSide = (s: TvAlert["side"]): "long" | "short" => (s && /^(short|sell)$/i.test(s) ? "short" : "long");

/** Deterministic id of a webhook trade: with your `id` open and close meet; without, symbol + side + minute. */
export function tvTradeId(userId: string, a: TvAlert, nowMs: number): string {
  const key = a.id ? `id:${a.id}` : `auto:${a.symbol ?? a.ticker}:${tvSide(a.side)}:${Math.floor(nowMs / 60_000)}`;
  return `t_tv_${shortHash(`${userId}:${key}`)}`;
}

export interface SetupRef {
  id: string;
  name: string;
}

/** The `upsert_synced_trade` item of an OPEN alert (insert-only: a re-delivered alert changes nothing). */
export function tvOpenItem(a: TvAlert, ctx: { userId: string; nowMs: number; tz: string; setups: readonly SetupRef[] }): { id: string; set: Record<string, unknown>; fill: Record<string, unknown>; new: Record<string, unknown> } {
  const nowIso = new Date(ctx.nowMs).toISOString();
  const id = tvTradeId(ctx.userId, a, ctx.nowMs);
  const entry = a.entry ?? a.price ?? null;
  const qty = a.qty ?? null;
  const t = freshTrade(nowIso, a.account ?? "scalp");
  Object.assign(t, {
    side: tvSide(a.side),
    status: "open",
    date: localWallClock(ctx.nowMs, safeTz(ctx.tz)),
    pair: tvSymbolToPair(a.symbol ?? a.ticker ?? ""),
    timeframe: tvTimeframe(a.timeframe),
    entry,
    stop: a.stop ?? null,
    target: a.target ?? null,
    size: a.size ?? (qty !== null && entry !== null ? round(qty * entry) : null),
    leverage: a.leverage ?? null,
    origin: { kind: "webhook" },
    syncSource: "tradingview-webhook",
    syncedAt: nowIso,
  });
  if (qty !== null) t.qty = qty;
  if (a.note) t.notes = a.note;
  if (a.id) t.externalId = a.id;
  if (a.setup) {
    const hit = ctx.setups.find((s) => s.name.trim().toLowerCase() === a.setup!.toLowerCase());
    if (hit) t.setups = [hit.id];
    else t.tags = [a.setup];
  }
  return { id, set: {}, fill: {}, new: t };
}

/** The SET part of a CLOSE alert for an existing open webhook trade. */
export function tvCloseSet(a: TvAlert, ctx: { nowMs: number; tz: string }): Record<string, unknown> {
  const exit = a.exit ?? a.price ?? null;
  return { status: "closed", exit, exitDate: localWallClock(ctx.nowMs, safeTz(ctx.tz)), syncedAt: new Date(ctx.nowMs).toISOString() };
}

/* ------------------------------------------------------------------ REST */

export const RestTrade = z.object({
  externalId: z.string().trim().min(1).max(64).optional(),
  pair: z.string().trim().min(2).max(40),
  side: z.enum(["long", "short"]),
  status: z.enum(["open", "closed"]).default("closed"),
  date: z.string().regex(WALL),
  exitDate: z.string().regex(WALL).optional(),
  timeframe: z.string().max(8).optional(),
  account: z.enum(["makro", "scalp"]).optional(),
  entry: optNum,
  exit: optNum,
  stop: optNum,
  target: optNum,
  size: optNum,
  qty: optNum,
  leverage: optNum,
  fees: optNum,
  fundingFees: optNum,
  pnlManual: optNum,
  setups: z.array(z.string().max(64)).max(20).optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  emotion: z.string().max(40).optional(),
  reason: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
});
export type RestTrade = z.infer<typeof RestTrade>;

/** Insert-only item of a REST trade (`t_api_<externalId>` is idempotent; without one a random id). */
export function restTradeItem(t: RestTrade, ctx: { nowMs: number; botName: string }): { id: string; set: Record<string, unknown>; fill: Record<string, unknown>; new: Record<string, unknown> } {
  const nowIso = new Date(ctx.nowMs).toISOString();
  const id = `t_api_${t.externalId ? idPart(t.externalId) || shortHash(t.externalId) : randomBytes(8).toString("hex")}`;
  const rec = freshTrade(nowIso, t.account ?? "scalp");
  const { externalId, ...fields } = t;
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) rec[k] = v;
  if (t.status === "open") rec.exit = null;
  if (externalId) rec.externalId = externalId;
  if (typeof rec.pnlManual === "number") rec.pnl = rec.pnlManual;
  rec.origin = { kind: "bot", botId: ctx.botName.slice(0, 40) || "api" };
  rec.syncSource = "rest-api";
  rec.syncedAt = nowIso;
  return { id, set: {}, fill: {}, new: rec };
}
