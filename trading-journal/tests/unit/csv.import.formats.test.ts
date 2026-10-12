/**
 * P11 CSV importers: one fixture per export (headers as of 2026-10; exports drift – the mapping assistant covers what a
 * format no longer recognises). Times are compared through `toWallClock` so the test is zone-independent.
 */
import { describe, expect, it } from "vitest";
import { deriveTrade } from "@/domain/derive";
import { normalizeTrade } from "@/domain/normalize";
import { buildTrades, detectFormat, guessMapping, loadCsv, parseWithMapping, toWallClock } from "@/exchanges/csv";

const utc = (s: string) => Date.parse(`${s}Z`);
const local = (y: number, mo: number, d: number, h: number, mi: number, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();

function run(csv: string, opts: { pair?: string } = {}) {
  const l = loadCsv(csv);
  expect(l.format, "format detected").not.toBeNull();
  const parsed = l.format!.parse(l.table);
  const trades = buildTrades(parsed, { formatId: l.format!.id, venue: l.format!.venue, account: "scalp", fallbackPair: opts.pair ?? "BTC/USDT", now: new Date("2026-10-12T08:00:00Z") });
  return { l, parsed, trades };
}

// 2026-10 – Binance USDⓈ-M Futures → Trade History export (fills)
const BINANCE = `Date(UTC),Symbol,Side,Price,Quantity,Amount,Fee,Realized Profit
2026-10-05 07:30:12,BTCUSDT,BUY,62000,0.03,1860,0.744 USDT,0
2026-10-05 07:45:00,BTCUSDT,BUY,61800,0.02,1236,0.4944 USDT,0
2026-10-05 11:02:45,BTCUSDT,SELL,63240,0.05,3162,1.2648 USDT,63.6
2026-10-06 13:15:00,ETHUSDT,SELL,2450.5,1.2,2940.6,1.17624,0
2026-10-06 16:40:31,ETHUSDT,BUY,2482.1,1.2,2978.52,1.191408,-37.92
`;

// 2026-10 – Bybit derivatives → Closed P&L export
const BYBIT = `Contracts,Closing Direction,Qty,Entry Price,Exit Price,Closed P&L,Exit Type,Trade Time(UTC+0)
SOLUSDT,Close Long,40,148.2,151.65,131.95,Trade,2026-10-08 19:22:40
ETHUSDT,Close Short,1.2,2450.5,2482.1,-39.88,Trade,2026-10-06 16:40:31
`;

// 2026-10 – OKX → Position history download
const OKX = `Instrument,Margin mode,Leverage,Direction,Opened,Closed,Avg. entry price,Avg. close price,Closed amount,PnL,PnL%,Realized PnL,Fee,Funding fee
BTC-USDT-SWAP,Cross,10,Long,2026-10-05 07:30:12,2026-10-05 11:02:45,62000,63240,0.05,62,10%,59.1829,-2.5048,-0.3123
`;

// 2026-10 – Bitunix futures → Position history export (column names per the web export)
const BITUNIX = `Futures,Side,Leverage,Margin mode,Avg. entry price,Avg. close price,Closed amount,Realized PnL,Fee,Funding fee,Open time,Close time
BTCUSDT,Long,10,Isolated,62000,63240,0.05,62,2.5048,-0.3123,2026-10-05 07:30:12,2026-10-05 11:02:45
ETHUSDT,Short,20,Cross,2450.5,2482.1,1.2,-37.92,2.3713,0.4102,2026-10-06 13:15:00,2026-10-06 16:40:31
`;

// 2026-10 – Kraken → Documents → Exports → Trades (trades.csv, quoted)
const KRAKEN = `"txid","ordertxid","pair","time","type","ordertype","price","cost","fee","vol","margin","misc","ledgers"
"T1","O1","XXBTZUSD","2026-10-05 07:30:12.1234","buy","limit","62000.0","3100.0","4.96","0.05","0.0","",""
"T2","O2","XXBTZUSD","2026-10-05 11:02:45.5678","sell","limit","63240.0","3162.0","5.0592","0.05","0.0","",""
`;

// 2026-10 – Coinbase Advanced → Fills download
const COINBASE = `portfolio,trade id,product,side,created at,size,size unit,price,fee,total,price/fee/total unit
default,cb1,BTC-USD,BUY,2026-10-05T07:30:12.000Z,0.05,BTC,62000,7.75,-3107.75,USD
default,cb2,BTC-USD,SELL,2026-10-05T11:02:45.000Z,0.05,BTC,63240,7.905,3154.095,USD
`;

// 2026-10 – MetaTrader 5 report → Positions saved as CSV (server time)
const MT5 = `Time,Position,Symbol,Type,Volume,Price,S / L,T / P,Time,Price,Commission,Swap,Profit
2026.10.05 09:30:12,50123,EURUSD,buy,1.00,1.0950,1.0920,1.1010,2026.10.05 13:02:45,1.0985,-7.00,-1.20,350.00
2026.10.06 15:15:00,50124,XAUUSD,sell,0.50,2650.40,2660.00,2630.00,2026.10.06 18:40:31,2655.10,-3.50,0.00,-235.00
`;

// 2026-10 – IBKR Flex Query, Trades section as CSV
const IBKR = `"ClientAccountID","AssetClass","Symbol","DateTime","Quantity","TradePrice","IBCommission","Buy/Sell","Multiplier","TradeID"
"U123","STK","AAPL","20261005;093012","100","226.5","-1","BUY","1","9001"
"U123","STK","AAPL","20261005;153000","-100","229.1","-1.05","SELL","1","9002"
"U123","FUT","ES","20261006;100000","-2","5800","-4.5","SELL","50","9003"
"U123","FUT","ES","20261006;140000","2","5790","-4.5","BUY","50","9004"
`;

// 2026-10 – TradingView Strategy Tester → List of trades → Export
const TV = `Trade #,Type,Signal,Date/Time,Price USDT,Contracts,Profit USDT,Profit %,Cum. Profit USDT,Cum. Profit %,Run-up USDT,Run-up %,Drawdown USDT,Drawdown %
1,Exit long,Long TP,2026-10-05 13:02,63240,0.05,62,2,62,0.62,70,2.2,-15,-0.5
1,Entry long,Long,2026-10-05 09:30,62000,0.05,62,2,62,0.62,70,2.2,-15,-0.5
2,Exit short,Open,2026-10-06 18:40,2482.1,1.2,-37.92,-1.29,24.08,0.24,5,0.2,-40,-1.6
2,Entry short,Short,2026-10-06 15:15,2450.5,1.2,-37.92,-1.29,24.08,0.24,5,0.2,-40,-1.6
`;

describe("format detection", () => {
  it.each([
    ["binance", BINANCE],
    ["bybit", BYBIT],
    ["okx", OKX],
    ["bitunix", BITUNIX],
    ["kraken", KRAKEN],
    ["coinbase", COINBASE],
    ["mt", MT5],
    ["ibkr", IBKR],
    ["tradingview", TV],
  ])("%s is recognised from its header", (id, csv) => {
    expect(detectFormat(loadCsv(csv).table.header)?.format.id).toBe(id);
  });

  it("an unknown header goes to the mapping assistant", () => {
    expect(detectFormat(["Datum", "Paar", "Richtung", "Einstieg", "Ausstieg"])).toBeNull();
  });
});

describe("venue exports → journal trades", () => {
  it("Binance fills fold into positions (DCA entry, short), P&L = price move − fees", () => {
    const { trades } = run(BINANCE);
    expect(trades).toHaveLength(2);
    const btc = trades.find((t) => t.pair === "BTC/USDT")!;
    expect(btc).toMatchObject({ side: "long", status: "closed", entry: 61920, exit: 63240, qty: 0.05, size: 3096, fees: 2.5032, pnlManual: 63.4968, exchange: "binance", origin: { kind: "csv" }, syncSource: "csv:binance", market: "perp" });
    expect(btc.date).toBe(toWallClock(utc("2026-10-05T07:30:12")));
    expect(btc.exitDate).toBe(toWallClock(utc("2026-10-05T11:02:45")));
    expect(btc.fills?.map((f) => f.kind)).toEqual(["entry", "add", "exit"]);
    const eth = trades.find((t) => t.pair === "ETH/USDT")!;
    expect(eth).toMatchObject({ side: "short", entry: 2450.5, exit: 2482.1, pnlManual: -40.287648 });
  });

  it("Bybit closed P&L: net P&L as exported, direction from the closing order", () => {
    const { trades, parsed } = run(BYBIT);
    expect(trades.map((t) => [t.pair, t.side, t.pnlManual])).toEqual([
      ["SOL/USDT", "long", 131.95],
      ["ETH/USDT", "short", -39.88],
    ]);
    expect(parsed.warnings[0]).toMatch(/Schließzeit/);
  });

  it("OKX position history: realized P&L, fees and funding", () => {
    const [t] = run(OKX).trades;
    expect(t).toMatchObject({ pair: "BTC/USDT", side: "long", entry: 62000, exit: 63240, qty: 0.05, fees: 2.5048, fundingFees: 0.3123, pnlManual: 59.1829, leverage: 10, marginMode: "cross", exchange: "okx" });
  });

  it("Bitunix position history: net = realized − fee + funding (same rule as the API sync)", () => {
    const { trades } = run(BITUNIX);
    expect(trades[0]).toMatchObject({ pair: "BTC/USDT", side: "long", pnlManual: 59.1829, fees: 2.5048, fundingFees: 0.3123, marginMode: "isolated", exchange: "bitunix" });
    expect(trades[1]).toMatchObject({ pair: "ETH/USDT", side: "short", pnlManual: -39.8811, fundingFees: -0.4102 });
  });

  it("Kraken legacy pair codes and spot fills", () => {
    const [t] = run(KRAKEN).trades;
    expect(t).toMatchObject({ pair: "BTC/USD", side: "long", market: "spot", entry: 62000, exit: 63240, pnlManual: 51.9808 });
  });

  it("Coinbase fills (spot, long only)", () => {
    const [t] = run(COINBASE).trades;
    expect(t).toMatchObject({ pair: "BTC/USD", side: "long", pnlManual: 46.345, fees: 15.655 });
  });

  it("MT5: duplicate Time / Price columns, P&L = profit + commission + swap, stop and target, local time", () => {
    const { trades } = run(MT5);
    const eur = trades.find((t) => t.pair === "EUR/USD")!;
    expect(eur).toMatchObject({ side: "long", entry: 1.095, exit: 1.0985, qty: 100000, size: 109500, stop: 1.092, target: 1.101, pnlManual: 341.8, fees: 7, fundingFees: 1.2 });
    expect(deriveTrade(normalizeTrade(eur)).r).toBeCloseTo(1.139, 3); // 341.8 / (0.003 × 100 000)
    expect(eur.date).toBe(toWallClock(local(2026, 10, 5, 9, 30, 12)));
    expect(trades.find((t) => t.pair === "XAU/USD")).toMatchObject({ side: "short", pnlManual: -238.5, qty: 50 });
  });

  it("IBKR Flex: signed quantities, commissions, futures multiplier", () => {
    const { trades } = run(IBKR);
    expect(trades.find((t) => t.pair === "AAPL")).toMatchObject({ side: "long", pnlManual: 257.95, fees: 2.05 });
    expect(trades.find((t) => t.pair === "ES")).toMatchObject({ side: "short", pnlManual: 991, size: 580000 });
  });

  it("TradingView: entry + exit rows per trade, open trade kept open, tagged as backtest, pair from the sheet", () => {
    const { trades } = run(TV, { pair: "BTC/USDT" });
    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({ pair: "BTC/USDT", side: "long", status: "closed", entry: 62000, exit: 63240, pnlManual: 62, tags: ["Backtest"] });
    expect(trades[1]).toMatchObject({ side: "short", status: "open", exit: null });
  });

  it("every importer yields records the journal loads and derives unchanged", () => {
    for (const csv of [BINANCE, BYBIT, OKX, BITUNIX, KRAKEN, COINBASE, MT5, IBKR, TV]) {
      for (const t of run(csv).trades) {
        const n = normalizeTrade(t);
        expect(n.id).toMatch(/^t_csv_/);
        if (t.status === "closed") expect(deriveTrade(n).pnl).toBe(t.pnlManual);
      }
    }
  });

  it("ids are deterministic: the same file maps to the same ids", () => {
    expect(run(BINANCE).trades.map((t) => t.id)).toEqual(run(BINANCE).trades.map((t) => t.id));
    expect(new Set(run(MT5).trades.map((t) => t.id)).size).toBe(2);
  });
});

describe("mapping assistant", () => {
  const DE = `Datum;Paar;Richtung;Einstieg;Ausstieg;Menge;Gebühren;Gewinn
05.10.2026 09:30;BTC/USDT;Long;62000;63240;0,05;2,50;59,50
06.10.2026 15:15;ETH/USDT;Short;2450,5;2482,1;1,2;2,37;-39,88
;;Notiz;;;;;
`;
  it("guesses the columns from a German journal export and parses decimal commas", () => {
    const l = loadCsv(DE);
    expect(l.format).toBeNull();
    const m = guessMapping(l.table.header);
    expect(m).toMatchObject({ date: 0, pair: 1, side: 2, entry: 3, exit: 4, qty: 5, fees: 6, pnl: 7, stop: -1 });
    const parsed = parseWithMapping(l.table, m, { assume: "local", fallbackPair: "BTC/USDT" });
    expect(parsed.skipped).toBe(1);
    expect(parsed.trades.map((t) => [t.pair, t.side, t.entry, t.qty, t.fees, t.pnl])).toEqual([
      ["BTC/USDT", "long", 62000, 0.05, 2.5, 59.5],
      ["ETH/USDT", "short", 2450.5, 1.2, 2.37, -39.88],
    ]);
    expect(parsed.trades[0]!.openedAt).toBe(local(2026, 10, 5, 9, 30));
  });

  it("a remapped column changes the result (fallback pair when no pair column)", () => {
    const l = loadCsv(DE);
    const m = { ...guessMapping(l.table.header), pair: -1 };
    const parsed = parseWithMapping(l.table, m, { assume: "utc", fallbackPair: "SOL/USDT" });
    expect(parsed.trades.every((t) => t.pair === "SOL/USDT")).toBe(true);
    expect(parsed.trades[0]!.openedAt).toBe(utc("2026-10-05T09:30:00"));
  });
});
