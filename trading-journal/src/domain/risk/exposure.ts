/**
 * Exposure (P05), pure: the open journal trades plus the live exchange positions (P11 `useExchangePositions`) as legs,
 * gross and net per asset, venue and side, the HHI concentration, cross-venue concentration and hedge netting.
 *
 * - Without P11 (no connection) only journal data is used – the report says so (`sources`).
 * - A journal trade that IS an exchange position is counted once (the venue's numbers win): same `externalId` /
 *   `positionId` as the position id, or the same venue + symbol + side.
 * - Value: qty × mark when a mark is known (live price / venue mark), else qty × entry.
 */
import { normalizeWatchSymbol } from "../boxes/config";
import type { EnrichedTrade, MarginMode, Side } from "../types";

/** Minimal shape of a live venue position (P11 `ExchangePosition`). */
export interface VenuePosition {
  id: string;
  exchange: string;
  symbol: string;
  side: Side;
  qty: number;
  entry: number;
  mark: number | null;
  leverage: number | null;
  marginMode: MarginMode | null;
  margin: number | null;
  liqPrice: number | null;
  unrealizedPnl: number | null;
}

export interface ExposureLeg {
  id: string;
  source: "journal" | "exchange";
  /** journal trade id (journal legs) */
  tradeId: string | null;
  /** normalised symbol ("BTCUSDT"); null when the pair cannot be read */
  symbol: string | null;
  /** base asset ("BTC") – the grouping key */
  asset: string;
  /** venue ("bitunix" …) or "journal" for trades without a venue */
  venue: string;
  side: Side;
  qty: number;
  entry: number;
  mark: number | null;
  /** qty × (mark ?? entry) */
  notional: number;
  /** + long, − short */
  signed: number;
  leverage: number | null;
  marginMode: MarginMode | null;
  margin: number | null;
  liqPrice: number | null;
  stop: number | null;
  /** unrealised P&L at `mark` (null without a mark) */
  upnl: number | null;
  /** money to the stop (null without a stop) */
  risk: number | null;
  label: string;
}

export interface ExposureGroup {
  key: string;
  long: number;
  short: number;
  gross: number;
  /** long − short */
  net: number;
  /** min(long, short): the part that cancels out */
  hedged: number;
  /** share of the total gross */
  share: number;
  legs: number;
}

export interface ExposureReport {
  legs: ExposureLeg[];
  gross: number;
  net: number;
  long: number;
  short: number;
  /** net ÷ gross (−1 … 1) */
  netRatio: number;
  hedged: number;
  /** gross ÷ capital */
  leverage: number | null;
  byAsset: ExposureGroup[];
  byVenue: ExposureGroup[];
  /** Herfindahl index over the assets' gross shares (1 = everything in one asset) */
  hhi: number;
  hhiLabel: "leer" | "breit" | "mittel" | "konzentriert";
  /** assets held on more than one venue */
  crossVenue: string[];
  /** Σ known unrealised P&L */
  upnl: number;
  sources: { journal: number; exchange: number };
}

const QUOTES = /(USDT|USDC|BUSD|FDUSD|USD|EUR|PERP)$/;

/** Base asset of a pair ("BTC/USDT", "BINANCE:ETHUSDT.P", "sol" → "BTC" / "ETH" / "SOL"). */
export function assetOf(pair: string | null | undefined): string {
  if (!pair) return "–";
  let s = pair.trim().toUpperCase();
  if (s.includes(":")) s = s.split(":").pop() ?? s;
  s = s.replace(/\.P$/, "");
  const parts = s.split(/[/\-_\s]/).filter(Boolean);
  if (parts.length > 1) return parts[0]!;
  const base = s.replace(QUOTES, "");
  return base || s || "–";
}

/** Normalised venue symbol of a pair ("BTC/USDT" → "BTCUSDT"), null when unreadable. */
export const symbolOf = (pair: string | null | undefined): string | null => normalizeWatchSymbol(pair ?? "");

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Base quantity of a journal trade (`qty`, else size ÷ entry). */
export function qtyOf(t: Pick<EnrichedTrade, "size" | "entry"> & { qty?: number | null }): number | null {
  if (fin(t.qty) && t.qty > 0) return t.qty;
  if (fin(t.size) && t.size > 0 && fin(t.entry) && t.entry > 0) return t.size / t.entry;
  return null;
}

/** An open journal trade as a leg; `price` = a live mark for its symbol (or null). */
export function journalLeg(t: EnrichedTrade, price: number | null): ExposureLeg | null {
  const qty = qtyOf(t);
  if (qty == null || !fin(t.entry) || t.entry <= 0) return null;
  const mark = fin(price) && price > 0 ? price : null;
  const dir = t.side === "short" ? -1 : 1;
  const notional = qty * (mark ?? t.entry);
  const lev = fin(t.leverage) && t.leverage > 0 ? t.leverage : null;
  return {
    id: `j:${t.id}`,
    source: "journal",
    tradeId: t.id,
    symbol: symbolOf(t.pair),
    asset: assetOf(t.pair),
    venue: t.exchange || "journal",
    side: t.side,
    qty,
    entry: t.entry,
    mark,
    notional,
    signed: dir * notional,
    leverage: lev,
    marginMode: t.marginMode ?? null,
    margin: fin(t.margin) && t.margin > 0 ? t.margin : lev ? (qty * t.entry) / lev : null,
    liqPrice: fin(t.liqPrice) && t.liqPrice > 0 ? t.liqPrice : null,
    stop: fin(t.stop) && t.stop > 0 ? t.stop : null,
    upnl: mark != null ? dir * qty * (mark - t.entry) : null,
    risk: fin(t.risk) ? t.risk : null,
    label: `${t.pair || "–"} ${t.side === "short" ? "Short" : "Long"}`,
  };
}

/** A venue position as a leg. */
export function venueLeg(p: VenuePosition): ExposureLeg | null {
  if (!fin(p.qty) || p.qty <= 0 || !fin(p.entry) || p.entry <= 0) return null;
  const mark = fin(p.mark) && p.mark > 0 ? p.mark : null;
  const dir = p.side === "short" ? -1 : 1;
  const notional = p.qty * (mark ?? p.entry);
  return {
    id: `x:${p.exchange}:${p.id}`,
    source: "exchange",
    tradeId: null,
    symbol: symbolOf(p.symbol),
    asset: assetOf(p.symbol),
    venue: p.exchange,
    side: p.side,
    qty: p.qty,
    entry: p.entry,
    mark,
    notional,
    signed: dir * notional,
    leverage: fin(p.leverage) && p.leverage > 0 ? p.leverage : null,
    marginMode: p.marginMode,
    margin: fin(p.margin) && p.margin > 0 ? p.margin : null,
    liqPrice: fin(p.liqPrice) && p.liqPrice > 0 ? p.liqPrice : null,
    stop: null,
    upnl: fin(p.unrealizedPnl) ? p.unrealizedPnl : mark != null ? dir * p.qty * (mark - p.entry) : null,
    risk: null,
    label: `${p.symbol} ${p.side === "short" ? "Short" : "Long"} · ${p.exchange}`,
  };
}

/** Is the journal trade the same position as the venue position? */
export function samePosition(t: EnrichedTrade, p: VenuePosition): boolean {
  if (t.externalId && t.externalId === p.id) return true;
  if (t.positionId && t.positionId === p.id) return true;
  if (!t.exchange || t.exchange.toLowerCase() !== p.exchange.toLowerCase()) return false;
  return t.side === p.side && symbolOf(t.pair) != null && symbolOf(t.pair) === symbolOf(p.symbol);
}

function group(legs: readonly ExposureLeg[], keyOf: (l: ExposureLeg) => string, gross: number): ExposureGroup[] {
  const m = new Map<string, ExposureGroup>();
  for (const l of legs) {
    const k = keyOf(l);
    const g = m.get(k) ?? { key: k, long: 0, short: 0, gross: 0, net: 0, hedged: 0, share: 0, legs: 0 };
    if (l.side === "long") g.long += l.notional;
    else g.short += l.notional;
    g.legs++;
    m.set(k, g);
  }
  return [...m.values()]
    .map((g) => ({ ...g, gross: g.long + g.short, net: g.long - g.short, hedged: Math.min(g.long, g.short), share: gross > 0 ? (g.long + g.short) / gross : 0 }))
    .sort((a, b) => b.gross - a.gross);
}

export interface ExposureInput {
  /** open journal trades of the scope */
  open: readonly EnrichedTrade[];
  positions?: readonly VenuePosition[];
  /** live marks by normalised symbol ("BTCUSDT" → price) */
  prices?: Readonly<Record<string, number>>;
  capital?: number;
}

/** The exposure report (see the module comment). */
export function exposureReport(input: ExposureInput): ExposureReport {
  const positions = input.positions ?? [];
  const legs: ExposureLeg[] = [];
  for (const p of positions) {
    const l = venueLeg(p);
    if (l) legs.push(l);
  }
  let journal = 0;
  for (const t of input.open) {
    if (t.result !== "open") continue;
    if (positions.some((p) => samePosition(t, p))) continue;
    const sym = symbolOf(t.pair);
    const l = journalLeg(t, sym ? (input.prices?.[sym] ?? null) : null);
    if (l) {
      legs.push(l);
      journal++;
    }
  }
  const long = legs.filter((l) => l.side === "long").reduce((s, l) => s + l.notional, 0);
  const short = legs.filter((l) => l.side === "short").reduce((s, l) => s + l.notional, 0);
  const gross = long + short;
  const byAsset = group(legs, (l) => l.asset, gross);
  const byVenue = group(legs, (l) => l.venue, gross);
  const hhi = byAsset.reduce((s, g) => s + g.share * g.share, 0);
  const crossVenue = byAsset
    .map((g) => g.key)
    .filter((a) => new Set(legs.filter((l) => l.asset === a && l.venue !== "journal").map((l) => l.venue)).size > 1);
  const capital = fin(input.capital) && input.capital > 0 ? input.capital : null;
  return {
    legs,
    gross,
    net: long - short,
    long,
    short,
    netRatio: gross > 0 ? (long - short) / gross : 0,
    hedged: byAsset.reduce((s, g) => s + g.hedged, 0),
    leverage: capital ? gross / capital : null,
    byAsset,
    byVenue,
    hhi,
    hhiLabel: !legs.length ? "leer" : hhi >= 0.6 ? "konzentriert" : hhi >= 0.35 ? "mittel" : "breit",
    crossVenue,
    upnl: legs.reduce((s, l) => s + (l.upnl ?? 0), 0),
    sources: { journal, exchange: legs.length - journal },
  };
}
