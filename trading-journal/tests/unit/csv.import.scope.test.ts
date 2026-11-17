/**
 * F42 – what the CSV importers refuse: Coin-M / inverse contracts and the hedge mode are NOT read as linear one-way
 * fills (that would give wrong sizes, wrong P&L and mixed Long / Short legs). Their rows are left out, counted, named in
 * the preview – and everything else of the file is imported as before. Numbers worked out by hand.
 */
import { describe, expect, it } from "vitest";
import { buildTrades, guessMapping, loadCsv, parseCsv, parseWithMapping } from "@/exchanges/csv";
import { isHedgeLeg, isInverseContract, noRejections, reject, rejectionWarnings } from "@/exchanges/csv/scope";

function run(csv: string) {
  const l = loadCsv(csv);
  expect(l.format, "format detected").not.toBeNull();
  const parsed = l.format!.parse(l.table);
  const trades = buildTrades(parsed, { formatId: l.format!.id, venue: l.format!.venue, account: "scalp", fallbackPair: "BTC/USDT", now: new Date("2026-10-12T08:00:00Z") });
  return { parsed, trades };
}

describe("contract spellings", () => {
  it("Binance: BTCUSD_PERP and dated COIN-M contracts are inverse; USDⓈ-M symbols (also the quarterly BTCUSDT_250328) are not", () => {
    for (const s of ["BTCUSD_PERP", "ETHUSD_PERP", "BTCUSD_250328", "btcusd_perp"]) expect(isInverseContract("binance", s), s).toBe(true);
    for (const s of ["BTCUSDT", "BTCUSDT_250328", "BTCUSDC", "1000PEPEUSDT", "BTCDOMUSDT"]) expect(isInverseContract("binance", s), s).toBe(false);
  });

  it("Bybit: BTCUSD / ETHUSD and inverse futures (month letter + year) are inverse; USDT, USDC and perpetual-spelled linear symbols are not", () => {
    for (const s of ["BTCUSD", "ETHUSD", "XRPUSD", "BTCUSDH25", "BTCUSDZ24"]) expect(isInverseContract("bybit", s), s).toBe(true);
    for (const s of ["BTCUSDT", "SOLUSDT", "BTCUSDC", "BTCPERP", "BTC-26DEC25", "1000PEPEUSDT"]) expect(isInverseContract("bybit", s), s).toBe(false);
  });

  it("OKX: BTC-USD-SWAP and dated BTC-USD-250328 are coin-margined; USDT / USDC swaps and spot are not", () => {
    for (const s of ["BTC-USD-SWAP", "ETH-USD-SWAP", "BTC-USD-250328"]) expect(isInverseContract("okx", s), s).toBe(true);
    for (const s of ["BTC-USDT-SWAP", "BTC-USDC-SWAP", "BTC-USDT", "BTC-USDT-250328"]) expect(isInverseContract("okx", s), s).toBe(false);
  });

  it("a file of unknown origin: only the spellings that cannot be anything else; a bare BTCUSD stays (it may be a spot or CFD pair)", () => {
    for (const s of ["BTCUSD_PERP", "BTC-USD-SWAP"]) expect(isInverseContract("any", s), s).toBe(true);
    for (const s of ["BTCUSD", "BTC/USD", "EURUSD", "BTCUSDT"]) expect(isInverseContract("any", s), s).toBe(false);
  });

  it("hedge legs: LONG and SHORT in any case, not BOTH or empty", () => {
    expect(["LONG", "short", " Long "].map(isHedgeLeg)).toEqual([true, true, true]);
    expect(["BOTH", "", "net"].map(isHedgeLeg)).toEqual([false, false, false]);
  });

  it("the warnings count the rows, name up to three symbols and say why", () => {
    const r = noRejections();
    reject(r, "inverse", "BTCUSD_PERP");
    reject(r, "inverse", "BTCUSD_PERP");
    reject(r, "inverse", "ETHUSD_PERP");
    reject(r, "hedge", "BTCUSDT");
    expect(r).toEqual({ inverse: 3, hedge: 1, examples: ["BTCUSD_PERP", "ETHUSD_PERP", "BTCUSDT"] });
    const w = rejectionWarnings(r);
    expect(w).toHaveLength(2);
    expect(w[0]).toContain("3 Zeilen mit Coin-M-/inversen Kontrakten nicht importiert");
    expect(w[0]).toContain("(BTCUSD_PERP, ETHUSD_PERP, BTCUSDT)");
    expect(w[0]).toContain("Coin-M wird nicht unterstützt");
    expect(w[1]).toContain("1 Zeile aus dem Hedge-Modus");
    expect(w[1]).toContain("Der Hedge-Modus wird nicht unterstützt");
    expect(rejectionWarnings(noRejections())).toEqual([]);
  });
});

describe("Binance Trade-Historie", () => {
  const HEAD = "Date(UTC),Symbol,Side,Price,Quantity,Amount,Fee,Realized Profit";
  const BTC = [
    "2026-10-05 07:30:12,BTCUSDT,BUY,62000,0.03,1860,0.744 USDT,0",
    "2026-10-05 07:45:00,BTCUSDT,BUY,61800,0.02,1236,0.4944 USDT,0",
    "2026-10-05 11:02:45,BTCUSDT,SELL,63240,0.05,3162,1.2648 USDT,63.6",
  ];
  const COINM = ["2026-10-05 08:00:00,BTCUSD_PERP,BUY,62000,100,0.0016,0.0000008 BTC,0", "2026-10-05 09:00:00,BTCUSD_PERP,SELL,63000,100,0.0016,0.0000008 BTC,0.00003"];

  it("without the new cases nothing changes: BTC long, entry 61 920 (average of 62 000 × 0,03 and 61 800 × 0,02), exit 63 240", () => {
    const { parsed, trades } = run([HEAD, ...BTC].join("\n"));
    expect(parsed.warnings).toEqual([]);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ pair: "BTC/USDT", side: "long", entry: 61920, exit: 63240, qty: 0.05 });
  });

  it("Coin-M rows are left out and counted; the USDⓈ-M trade is imported unchanged", () => {
    const { parsed, trades } = run([HEAD, ...BTC, ...COINM].join("\n"));
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ pair: "BTC/USDT", entry: 61920, exit: 63240 });
    expect(parsed.skipped).toBe(0);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("2 Zeilen mit Coin-M-/inversen Kontrakten nicht importiert (BTCUSD_PERP)");
  });

  it("a file of Coin-M rows alone gives no trade – and still says why", () => {
    const { parsed, trades } = run([HEAD, ...COINM].join("\n"));
    expect(trades).toEqual([]);
    expect(parsed.warnings[0]).toContain("Coin-M wird nicht unterstützt");
  });

  it("a „Position Side“ column with BOTH (one-way mode) changes nothing", () => {
    const rows = BTC.map((r) => `${r},BOTH`);
    const { parsed, trades } = run([`${HEAD},Position Side`, ...rows].join("\n"));
    expect(parsed.warnings).toEqual([]);
    expect(trades[0]).toMatchObject({ entry: 61920, exit: 63240 });
  });

  it("hedge-mode legs (Position Side LONG / SHORT) are not netted into one position: left out, counted, said", () => {
    // a long leg and a short leg of one symbol at the same time: netting them would turn the SELL of the short leg into the exit of the long
    const hedge = [
      "2026-10-05 07:30:00,BTCUSDT,BUY,62000,0.05,3100,1 USDT,0,LONG",
      "2026-10-05 07:31:00,BTCUSDT,SELL,62100,0.05,3105,1 USDT,0,SHORT",
      "2026-10-05 10:00:00,BTCUSDT,SELL,63000,0.05,3150,1 USDT,50,LONG",
      "2026-10-05 10:05:00,BTCUSDT,BUY,62800,0.05,3140,1 USDT,15,SHORT",
    ];
    const { parsed, trades } = run([`${HEAD},Position Side`, ...hedge].join("\n"));
    expect(trades).toEqual([]);
    expect(parsed.warnings).toHaveLength(1);
    expect(parsed.warnings[0]).toContain("4 Zeilen aus dem Hedge-Modus (Position Side LONG/SHORT) nicht importiert");
  });

  it("a file that switched modes keeps its one-way rows and leaves the hedge rows out", () => {
    const rows = [...BTC.map((r) => `${r},BOTH`), "2026-10-07 07:30:00,ETHUSDT,BUY,2400,1,2400,1 USDT,0,LONG"];
    const { parsed, trades } = run([`${HEAD},Position Side`, ...rows].join("\n"));
    expect(trades).toHaveLength(1);
    expect(parsed.warnings.join(" ")).toContain("1 Zeile aus dem Hedge-Modus");
  });
});

describe("Bybit Closed P&L and OKX Positionshistorie", () => {
  it("Bybit: BTCUSD (inverse, quantity in USD contracts) is left out, linear rows stay", () => {
    const csv = `Contracts,Closing Direction,Qty,Entry Price,Exit Price,Closed P&L,Exit Type,Trade Time(UTC+0)
SOLUSDT,Close Long,40,148.2,151.65,131.95,Trade,2026-10-08 19:22:40
BTCUSD,Close Long,1000,62000,63000,0.0002,Trade,2026-10-08 20:00:00
ETHUSD,Close Short,500,2450,2400,0.0004,Trade,2026-10-09 10:00:00
`;
    const { parsed, trades } = run(csv);
    expect(trades.map((t) => t.pair)).toEqual(["SOL/USDT"]);
    expect(parsed.warnings.join(" ")).toContain("2 Zeilen mit Coin-M-/inversen Kontrakten nicht importiert (BTCUSD, ETHUSD)");
  });

  it("OKX: BTC-USD-SWAP (coin-margined) is left out, BTC-USDT-SWAP stays", () => {
    const csv = `Instrument,Margin mode,Leverage,Direction,Opened,Closed,Avg. entry price,Avg. close price,Closed amount,PnL,PnL%,Realized PnL,Fee,Funding fee
BTC-USDT-SWAP,Cross,10,Long,2026-10-05 07:30:12,2026-10-05 11:02:45,62000,63240,0.05,62,10%,59.1829,-2.5048,-0.3123
BTC-USD-SWAP,Cross,10,Long,2026-10-05 07:30:12,2026-10-05 11:02:45,62000,63240,5,0.0001,10%,0.0001,-0.000001,0
`;
    const { parsed, trades } = run(csv);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ pair: "BTC/USDT", market: "perp" });
    expect(parsed.warnings.join(" ")).toContain("1 Zeile mit Coin-M-/inversen Kontrakten nicht importiert (BTC-USD-SWAP)");
  });
});

describe("mapping assistant", () => {
  it("a pair column that spells a Coin-M contract is left out, the others stay", () => {
    const table = parseCsv(`Datum,Paar,Richtung,Einstieg,Ausstieg,Menge,Gewinn
2026-10-05 07:30:00,BTCUSD_PERP,long,62000,63000,100,0.00003
2026-10-05 08:30:00,ETHUSDT,long,2400,2450,1,50
`);
    const parsed = parseWithMapping(table, guessMapping(table.header), { assume: "utc", fallbackPair: "BTC/USDT" });
    expect(parsed.trades.map((t) => t.pair)).toEqual(["ETH/USDT"]);
    expect(parsed.warnings[0]).toContain("1 Zeile mit Coin-M-/inversen Kontrakten nicht importiert (BTCUSD_PERP)");
  });
});
