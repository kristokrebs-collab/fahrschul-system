/**
 * Importer model (P11): every CSV format parses into `CsvTrade`s (venue-neutral, epoch ms), which become journal
 * trades through `toJournalTrade` – deterministic ids (`t_csv_<format>_<hash>`), origin `csv`, the exchange fields of
 * `syncFields.ts`, empty trader fields. Fill-based exports (Binance trade history, Kraken, Coinbase, IBKR) are folded
 * into positions by `aggregateFills` (average cost; a position ends when it is flat again, a flip starts a new one).
 */
import type { Trade } from "@/domain/types";
import { fnv1a, toWallClock, type CsvTable } from "./parse";

export interface CsvFill {
  /** Venue fill id (stable across exports), else row-derived. */
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  /** Cost, positive. */
  fee: number;
  at: number;
}

export interface CsvTrade {
  /** Stable identity inside the format (venue position id or symbol + open time + …). */
  key: string;
  pair: string;
  side: "long" | "short";
  status: "closed" | "open";
  openedAt: number | null;
  closedAt: number | null;
  entry: number | null;
  exit: number | null;
  /** Quantity in base units / contracts / lots. */
  qty: number | null;
  /** Notional in quote currency; default qty × entry. */
  size?: number | null;
  /** Fees (positive = cost). */
  fees?: number | null;
  /** Funding (positive = paid). */
  funding?: number | null;
  /** Net P&L as the export states it (overrides the derived P&L). */
  pnl?: number | null;
  stop?: number | null;
  target?: number | null;
  leverage?: number | null;
  marginMode?: "isolated" | "cross";
  market?: "perp" | "spot";
  externalId?: string;
  fills?: { id: string; at: number; side: "open" | "close"; price: number; qty: number; fee: number; kind: "entry" | "add" | "partial" | "exit" }[];
  tags?: string[];
  notes?: string;
  /** Bot / strategy that placed the trade (mapping assistant column „Bot“, review F14) → origin `bot`. */
  bot?: string;
}

export interface ParseResult {
  trades: CsvTrade[];
  /** Rows that could not be read (no side / price / time …). */
  skipped: number;
  /** German hints shown in the preview. */
  warnings: string[];
}

export interface CsvFormat {
  id: string;
  /** German name shown when detected ("Binance Futures – Trade-Historie"). */
  label: string;
  /** Exchange id for `Trade.exchange` (omitted for brokers / platforms without one). */
  venue?: string;
  /** Where to find the export (one sentence). */
  hint: string;
  /** 0 … 1: how sure the header belongs to this format (≥ 0.6 counts as detected). */
  detect(header: readonly string[]): number;
  parse(table: CsvTable): ParseResult;
}

const round = (n: number, d = 8): number => {
  const f = 10 ** d;
  const v = Math.round(n * f) / f;
  return Object.is(v, -0) ? 0 : v;
};

const QTY_EPS = 1e-9;

/** Fills → positions per symbol (average cost). `allowShort` false: spot – a sell without holdings is skipped. */
export function aggregateFills(
  fills: readonly CsvFill[],
  opts: { allowShort: boolean; market: "perp" | "spot"; pairOf: (symbol: string) => string },
): { trades: CsvTrade[]; skipped: number } {
  const bySymbol = new Map<string, CsvFill[]>();
  for (const f of fills) bySymbol.set(f.symbol, [...(bySymbol.get(f.symbol) ?? []), f]);
  const trades: CsvTrade[] = [];
  let skipped = 0;
  for (const [symbol, list] of bySymbol) {
    const sorted = [...list].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    let cur: {
      side: "long" | "short";
      pos: number;
      avg: number;
      openCost: number;
      openQty: number;
      closeQty: number;
      closeValue: number;
      gross: number;
      fees: number;
      peak: number;
      fills: NonNullable<CsvTrade["fills"]>;
      first: CsvFill;
    } | null = null;
    const finish = (status: "closed" | "open") => {
      if (!cur) return;
      const entry = cur.openQty > 0 ? cur.openCost / cur.openQty : null;
      const exit = cur.closeQty > 0 ? cur.closeValue / cur.closeQty : null;
      trades.push({
        key: `${symbol}|${cur.first.at}|${cur.first.id}`,
        pair: opts.pairOf(symbol),
        side: cur.side,
        status,
        openedAt: cur.first.at,
        closedAt: status === "closed" ? (cur.fills[cur.fills.length - 1]?.at ?? null) : null,
        entry: entry === null ? null : round(entry),
        exit: status === "closed" && exit !== null ? round(exit) : null,
        qty: round(cur.peak),
        size: entry !== null ? round(cur.peak * entry) : null,
        fees: round(cur.fees),
        pnl: status === "closed" ? round(cur.gross - cur.fees) : null,
        market: opts.market,
        fills: cur.fills,
      });
      cur = null;
    };
    for (const f of sorted) {
      if (!(f.qty > 0) || !(f.price > 0)) {
        skipped++;
        continue;
      }
      let qty = f.qty;
      while (qty > QTY_EPS) {
        if (!cur) {
          const side = f.side === "buy" ? "long" : "short";
          if (side === "short" && !opts.allowShort) {
            skipped++;
            break;
          }
          cur = { side, pos: 0, avg: 0, openCost: 0, openQty: 0, closeQty: 0, closeValue: 0, gross: 0, fees: 0, peak: 0, fills: [], first: f };
        }
        const opening = (cur.side === "long") === (f.side === "buy");
        if (opening) {
          cur.avg = (cur.avg * cur.pos + f.price * qty) / (cur.pos + qty);
          cur.pos += qty;
          cur.openCost += f.price * qty;
          cur.openQty += qty;
          cur.peak = Math.max(cur.peak, cur.pos);
          cur.fees += Math.abs(f.fee) * (qty / f.qty);
          cur.fills.push({
            id: f.id,
            at: f.at,
            side: "open",
            price: f.price,
            qty: round(qty),
            fee: round(Math.abs(f.fee) * (qty / f.qty)),
            kind: cur.fills.some((x) => x.side === "open") ? "add" : "entry",
          });
          qty = 0;
        } else {
          const take = Math.min(qty, cur.pos);
          const dir = cur.side === "long" ? 1 : -1;
          cur.gross += (f.price - cur.avg) * take * dir;
          cur.closeQty += take;
          cur.closeValue += f.price * take;
          cur.pos -= take;
          cur.fees += Math.abs(f.fee) * (take / f.qty);
          const flat = cur.pos <= QTY_EPS * Math.max(1, cur.peak);
          cur.fills.push({
            id: f.id,
            at: f.at,
            side: "close",
            price: f.price,
            qty: round(take),
            fee: round(Math.abs(f.fee) * (take / f.qty)),
            kind: flat ? "exit" : "partial",
          });
          qty -= take;
          if (flat) {
            finish("closed");
            // remainder flips into a new position (perp) – or is dropped for spot
            if (qty > QTY_EPS && !opts.allowShort && f.side === "sell") {
              skipped++;
              qty = 0;
            }
          }
        }
      }
    }
    if (cur) finish("open");
  }
  return { trades, skipped };
}

export interface ToTradeContext {
  formatId: string;
  venue?: string;
  account: "makro" | "scalp";
  nowIso: string;
}

/** Deterministic journal id of a CSV trade: same file, same id (a re-import updates instead of duplicating). */
export function csvTradeId(formatId: string, key: string): string {
  return `t_csv_${formatId.replace(/[^a-z0-9]/gi, "").slice(0, 10)}_${fnv1a(`${formatId}|${key}`)}${fnv1a(`${key}|${formatId}`)}`;
}

/** `CsvTrade` → journal trade (exchange fields + empty trader fields). */
export function toJournalTrade(t: CsvTrade, ctx: ToTradeContext): Trade {
  const size = t.size !== undefined ? t.size : t.qty != null && t.entry != null ? round(t.qty * t.entry) : null;
  const rec: Trade = {
    id: csvTradeId(ctx.formatId, t.key),
    account: ctx.account,
    side: t.side,
    status: t.status,
    date: t.openedAt != null ? toWallClock(t.openedAt) : t.closedAt != null ? toWallClock(t.closedAt) : "",
    pair: t.pair,
    timeframe: "",
    entry: t.entry,
    stop: t.stop ?? null,
    target: t.target ?? null,
    exit: t.status === "open" ? null : t.exit,
    size,
    leverage: t.leverage ?? null,
    fees: t.fees != null ? round(Math.abs(t.fees)) : null,
    pnlManual: t.pnl != null ? round(t.pnl) : null,
    setups: [],
    checks: {},
    conviction: null,
    followedPlan: null,
    emotion: "",
    reason: "",
    notes: t.notes ?? "",
    chart: "",
    pnl: t.pnl != null ? round(t.pnl) : null,
    r: null,
    createdAt: ctx.nowIso,
    updatedAt: ctx.nowIso,
    mistakes: [],
    origin: t.bot ? { kind: "bot", botId: t.bot.slice(0, 40) } : { kind: "csv" },
    syncSource: `csv:${ctx.formatId}`,
    syncedAt: ctx.nowIso,
  };
  if (t.status === "closed" && t.closedAt != null) rec.exitDate = toWallClock(t.closedAt);
  if (t.qty != null) rec.qty = t.qty;
  if (ctx.venue) rec.exchange = ctx.venue;
  if (t.externalId) rec.externalId = t.externalId;
  if (t.market) rec.market = t.market;
  if (t.marginMode) rec.marginMode = t.marginMode;
  if (t.funding != null) rec.fundingFees = round(t.funding);
  if (t.tags?.length) rec.tags = t.tags;
  if (t.fills?.length && t.fills.length <= 200) {
    rec.fills = t.fills.map((f) => ({
      id: `csv_${fnv1a(f.id)}_${f.at}`,
      at: toWallClock(f.at, true),
      side: f.side,
      price: f.price,
      qty: f.qty,
      fee: f.fee,
      kind: f.kind,
    }));
  }
  return rec;
}
