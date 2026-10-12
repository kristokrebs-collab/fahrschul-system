/**
 * CSV formats of the importers (P11). Each format recognises its export by the header (`detect`, aliases for the
 * spellings seen across export versions) and parses rows into `CsvTrade`s. Header lists dated 2026-10 – exports drift;
 * whatever a format no longer recognises goes through the generic mapping assistant (`generic.ts`).
 *
 * | id | export | rows |
 * |---|---|---|
 * | bitunix | Bitunix Futures → Positionshistorie → Export | one closed position per row |
 * | binance | Binance USDⓈ-M Futures → Trade-Historie → Export | fills → positions |
 * | bybit | Bybit Derivate → Closed P&L → Export | one closed position per row (net P&L) |
 * | okx | OKX → Positionshistorie → Download | one closed position per row |
 * | kraken | Kraken → Trades-Export (trades.csv) | fills → positions (spot, margin shorts) |
 * | coinbase | Coinbase Advanced Fills / Transaktionsverlauf | fills → positions (spot) |
 * | mt | MetaTrader 4/5 Kontoauszug „Positionen" als CSV | one position per row (lots, profit + commission + swap) |
 * | ibkr | IBKR Flex Query „Trades" als CSV | fills → positions (quantity signed, multiplier) |
 * | tradingview | TradingView Strategietester → Liste der Trades → Export | entry + exit row per trade (tag „Backtest") |
 */
import { aggregateFills, type CsvFill, type CsvFormat, type CsvTrade, type ParseResult } from "./model";
import { cell, findCol, normalizePair, parseBuySell, parseNum, parseSide, parseTime, type CsvTable } from "./parse";

/** Share of `patterns` (each one header alternative) found in the header. */
function score(header: readonly string[], required: RegExp[][], bonus: RegExp[][] = []): number {
  const has = (alts: RegExp[]) => alts.some((p) => header.some((h) => p.test(h.trim())));
  const req = required.filter(has).length / required.length;
  if (req < 1) return req * 0.5;
  return Math.min(1, 0.7 + (bonus.length ? (bonus.filter(has).length / bonus.length) * 0.3 : 0.3));
}

const col = (t: CsvTable, ...p: RegExp[]) => findCol(t.header, ...p);
const dec = (t: CsvTable) => t.delimiter === ";";

/* ------------------------------------------------------------------ Bitunix */

const BX = {
  symbol: [/^(futures|symbol|contract|trading pair|pair|kontrakt)$/i, /^(futures|contract)\b/i],
  side: [/^(side|direction|position side|richtung|position)$/i],
  entry: [/(avg\.?|average)?\s*(entry|open(ing)?)\s*price/i, /^entry$/i],
  exit: [/(avg\.?|average)?\s*(close|closing|exit)\s*price/i],
  qty: [/^(closed? (amount|qty|quantity|size)|max\.? (qty|position|size)|quantity|qty|size|amount)$/i, /(position|closed) (size|amount|qty)/i],
  pnl: [/^(realized|closed|realised) ?p(n|&)l$/i, /^(pnl|p&l|profit)$/i],
  net: [/net p(n|&)l/i],
  fee: [/^(fee|fees|trading fee|transaction fee|gebühr)$/i],
  funding: [/funding/i],
  opened: [/^(open(ing|ed)? time|time opened|created|entry time|open date)$/i],
  closed: [/^(clos(e|ing|ed) time|time closed|exit time|close date|updated)$/i],
  lev: [/leverage|hebel/i],
  margin: [/margin mode|margin type/i],
  id: [/position ?id/i],
};

export const bitunixFormat: CsvFormat = {
  id: "bitunix",
  label: "Bitunix Futures – Positionshistorie",
  venue: "bitunix",
  hint: "Bitunix → Aufträge → Futures-Verlauf → Positionshistorie → Exportieren.",
  detect: (h) => {
    const s = score(h, [BX.symbol, BX.entry, BX.exit, BX.pnl, BX.closed], [BX.funding, BX.fee, BX.side]);
    return h.some((x) => /binance|bybit|okx|instrument/i.test(x)) ? s * 0.5 : s;
  },
  parse: (t) => {
    const c = Object.fromEntries(Object.entries(BX).map(([k, v]) => [k, col(t, ...v)])) as Record<keyof typeof BX, number>;
    const out: CsvTrade[] = [];
    let skipped = 0;
    for (const r of t.rows) {
      const side = parseSide(cell(r, c.side));
      const entry = parseNum(cell(r, c.entry), dec(t));
      const exit = parseNum(cell(r, c.exit), dec(t));
      const closedAt = parseTime(cell(r, c.closed));
      const symbol = cell(r, c.symbol);
      if (!side || !entry || !symbol || closedAt === null) {
        skipped++;
        continue;
      }
      const realized = parseNum(cell(r, c.pnl), dec(t));
      const net = parseNum(cell(r, c.net), dec(t));
      const fee = Math.abs(parseNum(cell(r, c.fee), dec(t)) ?? 0);
      const funding = parseNum(cell(r, c.funding), dec(t));
      const openedAt = parseTime(cell(r, c.opened)) ?? closedAt;
      const qty = Math.abs(parseNum(cell(r, c.qty), dec(t)) ?? 0) || null;
      // Bitunix: realized P&L excludes fee and funding (API docs); funding < 0 = paid
      const pnl = net ?? (realized !== null ? realized - fee + (funding ?? 0) : null);
      const id = cell(r, c.id);
      out.push({
        key: id || `${symbol}|${openedAt}|${side}|${entry}`,
        externalId: id || undefined,
        pair: normalizePair(symbol),
        side,
        status: "closed",
        openedAt,
        closedAt,
        entry,
        exit,
        qty,
        fees: fee || null,
        funding: funding !== null ? -funding : null,
        pnl,
        leverage: parseNum(cell(r, c.lev)) ?? null,
        marginMode: /cross/i.test(cell(r, c.margin)) ? "cross" : /isol/i.test(cell(r, c.margin)) ? "isolated" : undefined,
        market: "perp",
      });
    }
    return { trades: out, skipped, warnings: [] };
  },
};

/* ------------------------------------------------------------------ Binance (fills) */

export const binanceFormat: CsvFormat = {
  id: "binance",
  label: "Binance Futures – Trade-Historie",
  venue: "binance",
  hint: "Binance → Orders → Futures-Orderverlauf → Trade-Historie → Exportieren (CSV).",
  detect: (h) => score(h, [[/^date\(utc\)$/i, /^(date|time)\b.*utc/i], [/^symbol$/i], [/^side$/i], [/^price$/i], [/^(quantity|qty)$/i]], [[/realized profit/i], [/^fee$/i]]),
  parse: (t) => {
    const ci = {
      at: col(t, /^date\(utc\)$/i, /^(date|time)/i),
      symbol: col(t, /^symbol$/i, /^pair$/i),
      side: col(t, /^side$/i),
      price: col(t, /^price$/i),
      qty: col(t, /^(quantity|qty|executed)$/i),
      fee: col(t, /^fee$/i),
      id: col(t, /trade ?id|^id$/i),
    };
    const fills: CsvFill[] = [];
    let skipped = 0;
    t.rows.forEach((r, i) => {
      const side = parseBuySell(cell(r, ci.side));
      const price = parseNum(cell(r, ci.price));
      const qty = parseNum(cell(r, ci.qty));
      const at = parseTime(cell(r, ci.at), { assume: "utc" });
      if (!side || !price || !qty || at === null) {
        skipped++;
        return;
      }
      fills.push({ id: cell(r, ci.id) || `r${i}`, symbol: cell(r, ci.symbol), side, qty: Math.abs(qty), price, fee: Math.abs(parseNum(cell(r, ci.fee)) ?? 0), at });
    });
    const agg = aggregateFills(fills, { allowShort: true, market: "perp", pairOf: normalizePair });
    const open = agg.trades.filter((x) => x.status === "open").length;
    return { trades: agg.trades, skipped: skipped + agg.skipped, warnings: open ? [`${open} Position(en) am Dateiende noch offen – als offen importiert.`] : [] };
  },
};

/* ------------------------------------------------------------------ Bybit (closed P&L) */

export const bybitFormat: CsvFormat = {
  id: "bybit",
  label: "Bybit – Closed P&L",
  venue: "bybit",
  hint: "Bybit → Aufträge → Derivate → Closed P&L → Exportieren.",
  detect: (h) => score(h, [[/^(contracts|instrument|symbol|market)$/i], [/entry price/i], [/exit price/i], [/closed p&?l/i]], [[/closing direction|trade type|side/i], [/exit type/i]]),
  parse: (t) => {
    const ci = {
      symbol: col(t, /^contracts$/i, /^instrument$/i, /^symbol$/i, /^market$/i),
      dir: col(t, /closing direction/i, /trade type/i, /^side$/i),
      qty: col(t, /^qty$/i, /^quantity$/i, /^closed (qty|size)$/i),
      entry: col(t, /entry price/i),
      exit: col(t, /exit price/i),
      pnl: col(t, /closed p&?l/i),
      closed: col(t, /trade time/i, /^(close|closed|exit) time/i, /^time/i),
      opened: col(t, /^(open|create|created) time/i),
      id: col(t, /order ?id/i),
    };
    const out: CsvTrade[] = [];
    let skipped = 0;
    for (const r of t.rows) {
      const dir = cell(r, ci.dir);
      // the closing order: "Close Long" / "Sell" closes a long; "Close Short" / "Buy" closes a short
      const side: "long" | "short" | null = /long/i.test(dir) ? "long" : /short/i.test(dir) ? "short" : /sell/i.test(dir) ? "long" : /buy/i.test(dir) ? "short" : null;
      const entry = parseNum(cell(r, ci.entry));
      const closedAt = parseTime(cell(r, ci.closed), { assume: "utc" });
      if (!side || !entry || closedAt === null) {
        skipped++;
        continue;
      }
      const symbol = cell(r, ci.symbol);
      const id = cell(r, ci.id);
      out.push({
        key: id || `${symbol}|${closedAt}|${side}|${entry}`,
        externalId: id || undefined,
        pair: normalizePair(symbol),
        side,
        status: "closed",
        openedAt: parseTime(cell(r, ci.opened), { assume: "utc" }) ?? closedAt,
        closedAt,
        entry,
        exit: parseNum(cell(r, ci.exit)),
        qty: Math.abs(parseNum(cell(r, ci.qty)) ?? 0) || null,
        // Bybit's Closed P&L is net of trading and funding fees
        pnl: parseNum(cell(r, ci.pnl)),
        market: "perp",
      });
    }
    return { trades: out, skipped, warnings: ci.opened < 0 ? ["Bybit exportiert nur die Schließzeit – Einstieg = Ausstiegszeit."] : [] };
  },
};

/* ------------------------------------------------------------------ OKX (position history) */

export const okxFormat: CsvFormat = {
  id: "okx",
  label: "OKX – Positionshistorie",
  venue: "okx",
  hint: "OKX → Handel → Positionshistorie → Herunterladen.",
  detect: (h) => score(h, [[/^instrument$/i, /^instrument id$/i], [/(avg\.? )?(entry|open) (avg\.? )?price/i, /open avg/i], [/(avg\.? )?close (avg\.? )?price/i, /close avg/i], [/^(opened|open time|created)/i]], [[/realized p(n|&)l/i], [/funding/i], [/margin mode/i]]),
  parse: (t) => {
    const ci = {
      inst: col(t, /^instrument$/i, /^instrument id$/i),
      side: col(t, /^(direction|position side|side|pos side)$/i),
      opened: col(t, /^(opened|open time|created( time)?)$/i),
      closed: col(t, /^(closed|close time|updated( time)?)$/i),
      entry: col(t, /(avg\.? )?(entry|open) (avg\.? )?price/i, /open avg/i),
      exit: col(t, /(avg\.? )?close (avg\.? )?price/i, /close avg/i),
      qty: col(t, /^closed (amount|size|qty)/i, /^(max\.? )?(position|pos\.?) size/i, /^amount$/i),
      realized: col(t, /realized p(n|&)l/i),
      pnl: col(t, /^p(n|&)l$/i),
      fee: col(t, /^fee$/i, /trading fee/i),
      funding: col(t, /funding/i),
      lev: col(t, /leverage/i),
      margin: col(t, /margin mode/i),
      id: col(t, /position id|pos id/i),
    };
    const out: CsvTrade[] = [];
    let skipped = 0;
    for (const r of t.rows) {
      const side = parseSide(cell(r, ci.side));
      const entry = parseNum(cell(r, ci.entry), dec(t));
      const closedAt = parseTime(cell(r, ci.closed), { assume: "utc" });
      const inst = cell(r, ci.inst);
      if (!side || !entry || !inst || closedAt === null) {
        skipped++;
        continue;
      }
      const fee = parseNum(cell(r, ci.fee), dec(t));
      const funding = parseNum(cell(r, ci.funding), dec(t));
      const realized = parseNum(cell(r, ci.realized), dec(t));
      const gross = parseNum(cell(r, ci.pnl), dec(t));
      const id = cell(r, ci.id);
      // OKX: "Realized PnL" = P&L + fee + funding (fees negative); without it: gross − |fee| + funding
      const pnl = realized ?? (gross !== null ? gross - Math.abs(fee ?? 0) + (funding ?? 0) : null);
      out.push({
        key: id || `${inst}|${closedAt}|${side}|${entry}`,
        externalId: id || undefined,
        pair: normalizePair(inst),
        side,
        status: "closed",
        openedAt: parseTime(cell(r, ci.opened), { assume: "utc" }) ?? closedAt,
        closedAt,
        entry,
        exit: parseNum(cell(r, ci.exit), dec(t)),
        qty: Math.abs(parseNum(cell(r, ci.qty), dec(t)) ?? 0) || null,
        fees: fee !== null ? Math.abs(fee) : null,
        funding: funding !== null ? -funding : null,
        pnl,
        leverage: parseNum(cell(r, ci.lev)) ?? null,
        marginMode: /cross/i.test(cell(r, ci.margin)) ? "cross" : /isol/i.test(cell(r, ci.margin)) ? "isolated" : undefined,
        market: /swap|perp|futures/i.test(inst) || !/-.*-/.test(inst) ? "perp" : "spot",
      });
    }
    return { trades: out, skipped, warnings: [] };
  },
};

/* ------------------------------------------------------------------ Kraken (trades.csv) */

export const krakenFormat: CsvFormat = {
  id: "kraken",
  label: "Kraken – Trades",
  venue: "kraken",
  hint: "Kraken → Dokumente → Exporte → Trades (CSV).",
  detect: (h) => score(h, [[/^txid$/i], [/^pair$/i], [/^time$/i], [/^type$/i], [/^price$/i], [/^vol$/i]], [[/^fee$/i], [/^margin$/i]]),
  parse: (t) => {
    const ci = { id: col(t, /^txid$/i), pair: col(t, /^pair$/i), time: col(t, /^time$/i), type: col(t, /^type$/i), price: col(t, /^price$/i), vol: col(t, /^vol$/i), fee: col(t, /^fee$/i), margin: col(t, /^margin$/i) };
    const fills: CsvFill[] = [];
    let skipped = 0;
    let margin = false;
    t.rows.forEach((r, i) => {
      const side = parseBuySell(cell(r, ci.type));
      const price = parseNum(cell(r, ci.price));
      const qty = parseNum(cell(r, ci.vol));
      const at = parseTime(cell(r, ci.time), { assume: "utc" });
      if (!side || !price || !qty || at === null) {
        skipped++;
        return;
      }
      if ((parseNum(cell(r, ci.margin)) ?? 0) > 0) margin = true;
      fills.push({ id: cell(r, ci.id) || `r${i}`, symbol: cell(r, ci.pair), side, qty: Math.abs(qty), price, fee: Math.abs(parseNum(cell(r, ci.fee)) ?? 0), at });
    });
    const agg = aggregateFills(fills, { allowShort: margin, market: margin ? "perp" : "spot", pairOf: normalizePair });
    return { trades: agg.trades, skipped: skipped + agg.skipped, warnings: [] };
  },
};

/* ------------------------------------------------------------------ Coinbase (fills / transactions) */

export const coinbaseFormat: CsvFormat = {
  id: "coinbase",
  label: "Coinbase – Fills / Transaktionen",
  venue: "coinbase",
  hint: "Coinbase Advanced → Orders → Fills → Download – oder Berichte → Transaktionsverlauf (CSV).",
  detect: (h) =>
    Math.max(
      score(h, [[/^trade id$/i], [/^product$/i], [/^side$/i], [/^created at$/i], [/^size$/i], [/^price$/i]], [[/^fee$/i]]),
      score(h, [[/^timestamp$/i], [/^transaction type$/i], [/^asset$/i], [/quantity transacted/i], [/price at transaction/i]], [[/fees/i]]),
    ),
  parse: (t) => {
    const tx = col(t, /^transaction type$/i) >= 0;
    const ci = tx
      ? { id: col(t, /^id$/i), sym: col(t, /^asset$/i), quote: col(t, /price currency/i), side: col(t, /^transaction type$/i), at: col(t, /^timestamp$/i), qty: col(t, /quantity transacted/i), price: col(t, /price at transaction/i), fee: col(t, /fees/i) }
      : { id: col(t, /^trade id$/i), sym: col(t, /^product$/i), quote: -1, side: col(t, /^side$/i), at: col(t, /^created at$/i), qty: col(t, /^size$/i), price: col(t, /^price$/i), fee: col(t, /^fee$/i) };
    const fills: CsvFill[] = [];
    let skipped = 0;
    t.rows.forEach((r, i) => {
      const kind = cell(r, ci.side);
      const side = /convert|send|receive|reward|deposit|withdraw/i.test(kind) ? null : parseBuySell(kind.replace(/advanced trade /i, ""));
      const price = parseNum(cell(r, ci.price));
      const qty = parseNum(cell(r, ci.qty));
      const at = parseTime(cell(r, ci.at), { assume: "utc" });
      if (!side || !price || !qty || at === null) {
        skipped++;
        return;
      }
      const sym = tx ? `${cell(r, ci.sym)}-${cell(r, ci.quote) || "USD"}` : cell(r, ci.sym);
      fills.push({ id: cell(r, ci.id) || `r${i}`, symbol: sym, side, qty: Math.abs(qty), price, fee: Math.abs(parseNum(cell(r, ci.fee)) ?? 0), at });
    });
    const agg = aggregateFills(fills, { allowShort: false, market: "spot", pairOf: normalizePair });
    return { trades: agg.trades, skipped: skipped + agg.skipped, warnings: [] };
  },
};

/* ------------------------------------------------------------------ MetaTrader 4 / 5 */

const FX = new Set(["EUR", "USD", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD", "SEK", "NOK", "DKK", "PLN", "HUF", "CZK", "TRY", "ZAR", "MXN", "SGD", "HKD", "CNH"]);

/** Units per lot: FX 100 000, gold 100 oz, silver 5 000 oz; unknown (indices, CFDs) → null (no notional, no R). */
export function contractSize(symbol: string): number | null {
  const s = symbol.toUpperCase().replace(/[^A-Z]/g, "");
  if (/^XAU/.test(s)) return 100;
  if (/^XAG/.test(s)) return 5000;
  if (s.length === 6 && FX.has(s.slice(0, 3)) && FX.has(s.slice(3))) return 100_000;
  return null;
}

export const mtFormat: CsvFormat = {
  id: "mt",
  label: "MetaTrader 4/5 – Positionen",
  hint: "MT4/5 → Kontoauszug / Bericht → Positionen als CSV speichern (Zeiten in Serverzeit).",
  detect: (h) =>
    Math.max(
      score(h, [[/^time$/i], [/^position$/i], [/^symbol$/i], [/^type$/i], [/^volume$/i], [/^price$/i], [/^time_2$/i], [/^profit$/i]], [[/^swap$/i], [/^commission$/i]]),
      score(h, [[/^ticket$/i], [/^open time$/i], [/^type$/i], [/^size$/i], [/^item$/i], [/^close time$/i], [/^profit$/i]], [[/^swap$/i]]),
    ),
  parse: (t) => {
    const mt4 = col(t, /^ticket$/i) >= 0;
    const ci = {
      id: col(t, /^position$/i, /^ticket$/i),
      sym: col(t, /^symbol$/i, /^item$/i),
      type: col(t, /^type$/i),
      vol: col(t, /^volume$/i, /^size$/i),
      opened: mt4 ? col(t, /^open time$/i) : col(t, /^time$/i),
      closed: mt4 ? col(t, /^close time$/i) : col(t, /^time_2$/i),
      entry: col(t, /^price$/i),
      exit: col(t, /^price_2$/i),
      sl: col(t, /^s ?\/ ?l$/i),
      tp: col(t, /^t ?\/ ?p$/i),
      comm: col(t, /^commission$/i),
      swap: col(t, /^swap$/i),
      taxes: col(t, /^taxes$/i),
      profit: col(t, /^profit$/i),
    };
    const out: CsvTrade[] = [];
    let skipped = 0;
    for (const r of t.rows) {
      const side = parseSide(cell(r, ci.type));
      const entry = parseNum(cell(r, ci.entry), dec(t));
      const closedAt = parseTime(cell(r, ci.closed), { assume: "local" });
      if (!side || !entry || closedAt === null) {
        skipped++;
        continue;
      }
      const n = (i: number) => parseNum(cell(r, i), dec(t)) ?? 0;
      const fees = Math.abs(n(ci.comm)) + Math.abs(n(ci.taxes));
      const swap = n(ci.swap);
      const id = cell(r, ci.id);
      out.push({
        key: id || `${cell(r, ci.sym)}|${closedAt}|${side}|${entry}`,
        externalId: id || undefined,
        pair: normalizePair(cell(r, ci.sym)),
        side,
        status: "closed",
        openedAt: parseTime(cell(r, ci.opened), { assume: "local" }) ?? closedAt,
        closedAt,
        entry,
        exit: parseNum(cell(r, ci.exit), dec(t)),
        // lots × contract size (FX / metals); unknown symbols get no quantity – no fake notional, no fake R
        ...((): Pick<CsvTrade, "qty" | "size"> => {
          const lots = parseNum(cell(r, ci.vol), dec(t));
          const cs = contractSize(cell(r, ci.sym));
          return lots !== null && cs !== null ? { qty: lots * cs } : { qty: null, size: null };
        })(),
        fees: fees || null,
        funding: swap ? -swap : null,
        pnl: n(ci.profit) + n(ci.comm) + n(ci.taxes) + swap,
        stop: parseNum(cell(r, ci.sl), dec(t)) || null,
        target: parseNum(cell(r, ci.tp), dec(t)) || null,
      });
    }
    return { trades: out, skipped, warnings: ["MetaTrader-Zeiten sind Serverzeit und werden als Ortszeit übernommen. Lots → Einheiten: FX 100.000, Gold 100, Silber 5.000."] };
  },
};

/* ------------------------------------------------------------------ IBKR Flex (trades) */

export const ibkrFormat: CsvFormat = {
  id: "ibkr",
  label: "Interactive Brokers – Flex Query Trades",
  hint: "IBKR Client Portal → Berichte → Flex Queries → Trades (CSV, Felder Symbol, DateTime, Quantity, TradePrice, IBCommission).",
  detect: (h) => score(h, [[/^symbol$/i], [/^(datetime|date\/time|tradedate)$/i], [/^quantity$/i], [/^tradeprice$/i, /^t\. price$/i]], [[/^ibcommission$/i, /^comm\/fee$/i], [/^buy\/sell$/i], [/^multiplier$/i]]),
  parse: (t) => {
    const ci = {
      sym: col(t, /^symbol$/i),
      at: col(t, /^datetime$/i, /^date\/time$/i),
      date: col(t, /^tradedate$/i),
      time: col(t, /^tradetime$/i),
      qty: col(t, /^quantity$/i),
      price: col(t, /^tradeprice$/i, /^t\. price$/i),
      comm: col(t, /^ibcommission$/i, /^comm\/fee$/i),
      bs: col(t, /^buy\/sell$/i),
      mult: col(t, /^multiplier$/i),
      id: col(t, /^tradeid$/i, /^ibexecid$/i),
      asset: col(t, /^assetclass$/i),
    };
    const fills: CsvFill[] = [];
    let skipped = 0;
    const mult = new Map<string, number>();
    t.rows.forEach((r, i) => {
      if (/^(header|total|subtotal)/i.test(r[0] ?? "")) return;
      const q = parseNum(cell(r, ci.qty));
      const price = parseNum(cell(r, ci.price));
      const at = parseTime(ci.at >= 0 ? cell(r, ci.at) : `${cell(r, ci.date)} ${cell(r, ci.time)}`, { assume: "local" });
      const side = parseBuySell(cell(r, ci.bs)) ?? (q !== null ? (q > 0 ? "buy" : "sell") : null);
      if (!q || !price || at === null || !side) {
        skipped++;
        return;
      }
      const sym = cell(r, ci.sym);
      mult.set(sym, parseNum(cell(r, ci.mult)) || 1);
      fills.push({ id: cell(r, ci.id) || `r${i}`, symbol: sym, side, qty: Math.abs(q), price, fee: Math.abs(parseNum(cell(r, ci.comm)) ?? 0), at });
    });
    const agg = aggregateFills(fills, { allowShort: true, market: "spot", pairOf: (s) => s });
    for (const tr of agg.trades) {
      const m = mult.get(tr.key.split("|")[0]!) ?? 1;
      if (m !== 1) {
        if (tr.size != null) tr.size *= m;
        if (tr.pnl != null) tr.pnl = (tr.pnl + (tr.fees ?? 0)) * m - (tr.fees ?? 0);
      }
    }
    return { trades: agg.trades, skipped: skipped + agg.skipped, warnings: ["IBKR-Zeiten werden als Ortszeit übernommen."] };
  },
};

/* ------------------------------------------------------------------ TradingView Strategy Tester */

export const tradingViewFormat: CsvFormat = {
  id: "tradingview",
  label: "TradingView – Strategietester",
  hint: "TradingView → Strategietester → Liste der Trades → Exportieren (CSV). Wird als Backtest markiert.",
  detect: (h) => score(h, [[/^trade ?#$/i], [/^type$/i], [/^date\/time$/i, /^date and time$/i], [/^price\b/i]], [[/^(contracts|position size \(qty\)|quantity)/i], [/^(profit|net p&l)\b/i]]),
  parse: (t) => {
    const ci = {
      n: col(t, /^trade ?#$/i),
      type: col(t, /^type$/i),
      at: col(t, /^date\/time$/i, /^date and time$/i),
      price: col(t, /^price\b/i),
      qty: col(t, /^contracts\b/i, /^position size \(qty\)/i, /^quantity/i),
      pnl: col(t, /^(profit|net p&l)(?! ?%)( [a-z]{3,5})?$/i, /^net p&l (?!%)/i),
      signal: col(t, /^signal$/i),
    };
    const groups = new Map<string, string[][]>();
    let skipped = 0;
    for (const r of t.rows) {
      const n = cell(r, ci.n);
      if (!n) {
        skipped++;
        continue;
      }
      groups.set(n, [...(groups.get(n) ?? []), r]);
    }
    const out: CsvTrade[] = [];
    for (const [n, rows] of groups) {
      const entryRow = rows.find((r) => /entry/i.test(cell(r, ci.type)));
      const exitRow = rows.find((r) => /exit/i.test(cell(r, ci.type)));
      const side = parseSide(cell(entryRow ?? exitRow ?? [], ci.type));
      const entry = entryRow ? parseNum(cell(entryRow, ci.price)) : null;
      const openedAt = entryRow ? parseTime(cell(entryRow, ci.at), { assume: "local" }) : null;
      if (!side || !entry || openedAt === null) {
        skipped += rows.length;
        continue;
      }
      const open = !exitRow || /^open$/i.test(cell(exitRow, ci.signal));
      out.push({
        key: `${n}|${openedAt}`,
        pair: "",
        side,
        status: open ? "open" : "closed",
        openedAt,
        closedAt: exitRow && !open ? parseTime(cell(exitRow, ci.at), { assume: "local" }) : null,
        entry,
        exit: exitRow && !open ? parseNum(cell(exitRow, ci.price)) : null,
        qty: parseNum(cell(entryRow ?? exitRow!, ci.qty)),
        pnl: exitRow && !open ? parseNum(cell(exitRow, ci.pnl)) : null,
        tags: ["Backtest"],
        notes: "Aus dem TradingView-Strategietester.",
      });
    }
    return { trades: out, skipped, warnings: ["Backtest-Trades: markiert mit dem Tag „Backtest“. Das Paar wählst du in der Vorschau."] };
  },
};

export const FORMATS: readonly CsvFormat[] = [bitunixFormat, binanceFormat, bybitFormat, okxFormat, krakenFormat, coinbaseFormat, mtFormat, ibkrFormat, tradingViewFormat];

/** Best format for a header (≥ 0.6), or null → mapping assistant. */
export function detectFormat(header: readonly string[]): { format: CsvFormat; score: number } | null {
  let best: { format: CsvFormat; score: number } | null = null;
  for (const f of FORMATS) {
    const s = f.detect(header);
    if (!best || s > best.score) best = { format: f, score: s };
  }
  return best && best.score >= 0.6 ? best : null;
}

export type { ParseResult };
