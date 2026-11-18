/**
 * F23 – forward test, domain: the catch-up calculation is IDENTICAL to one pass over all candles (property over many cut
 * points and rules), nothing is decided before the start or on an unclosed candle, pauses block only new entries, an ended
 * account is flattened at its last close, a damaged cursor is rebuilt from the candles, the stored shape survives JSON.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customStrategy, DEFAULT_FEES, runBacktest, type Bar, type EngineCfg } from "@/domain/backtest/index";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab/rules/tree";
import { defaultParams, sanitizeParams } from "@/domain/lab/rules/blocks";
import type { CustomConfig, Leaf, LeafParams } from "@/domain/lab/rules/types";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import {
  accountView,
  advanceAccount,
  cursorSig,
  endAccount,
  engineCfgOf,
  forwardCfgOf,
  isCoherent,
  lastClosedIndex,
  newAccount,
  pauseAccount,
  planOf,
  resumeAccount,
  withAccounts,
  type ForwardAccount,
} from "@/domain/forward";
import { walk } from "./lab.helpers";

const read = (n: string): Bar[] => (JSON.parse(readFileSync(`tests/unit/fixtures/${n}`, "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
const H4 = read("binance-btcusdt-4h.json");
const SEC4 = 14_400;

const leaf = (id: string, block: Leaf["block"], params: LeafParams = {}): Leaf => ({ ...newLeaf(id, block, "exec"), params: sanitizeParams(block, { ...defaultParams(block), ...params }) });
const idea = (over: Partial<CustomConfig> = {}, level = 45): CustomConfig =>
  sanitizeCustom({ ...defaultCustom(), name: "Test", interval: "4h", sides: "long", long: newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level })]), ...over });

const engineFor = (a: ForwardAccount): EngineCfg => ({ ...engineCfgOf(a, null), costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "none" } } });
const base = (config: CustomConfig, startIdx: number, bars: readonly Bar[] = H4): ForwardAccount =>
  newAccount(
    { id: "a1", name: "Test", config, signal: DEFAULT_SIGNAL_CFG, symbol: "BTCUSDT", capital: 10_000, riskPct: 1, maxLeverage: 5, exchange: "binance", slippage: { kind: "fixed", bps: 2 }, funding: "none", source: { kind: "editor", label: "Test" } },
    bars[startIdx]!.t * 1000 + 60_000,
  );
/** What the app has at time `upToIdx`: the candles that had closed by then, prepared from the fixed anchor on. */
const prepared = (a: ForwardAccount, bars: readonly Bar[], upToIdx: number) => {
  const { anchorMs } = planOf(a);
  const data = bars.slice(0, upToIdx + 1).filter((b) => b.t * 1000 >= anchorMs);
  return customStrategy.prepare({ [a.interval]: data }, { config: a.config, signal: a.signal }, a.startMs).result();
};
const closeMs = (bars: readonly Bar[], i: number, sec = SEC4): number => (bars[i]!.t + sec) * 1000;
/** the app opens at candle `i`'s close and brings the account up to date */
const step = (a: ForwardAccount, bars: readonly Bar[], i: number) => advanceAccount(a, prepared(a, bars, i), engineFor(a), closeMs(bars, i) + 5_000);

const tradeKey = (a: ForwardAccount) => a.trades.map((t) => [t.id, t.side, t.entryTime, t.exitTime, t.entry, t.exit, t.pnl, t.r, t.reason]);

describe("Nachhol-Berechnung = ein Durchlauf (Eigenschaftstest)", () => {
  const rules: [string, CustomConfig][] = [
    ["RSI < 45", idea()],
    ["RSI < 50 mit Break-even + Trailing", idea({ exits: { ...defaultCustom().exits, breakEven: { on: true, trigger: "r", value: 1, to: "net" }, trail: { on: true, kind: "atr", value: 2, activateR: 1 }, maxBars: 12, exitOnOpposite: false } }, 50)],
    ["Long und Short, Teilziel", idea({ sides: "both", short: newGroup("g2", "and", [leaf("n2", "rsi", { mode: "above", level: 60 })]), exits: { ...defaultCustom().exits, partial: { on: true, atR: 1, fracPct: 50, thenBreakEven: true }, exitOnOpposite: true } })],
  ];
  const START = 300;
  const END = 1450;

  for (const [name, cfg] of rules) {
    it(`${name}: zufällige Schnittpunkte ergeben dieselben Trades wie ein Durchlauf`, () => {
      const a0 = base(cfg, START);
      const once = step(a0, H4, END).account;
      expect(once.trades.length).toBeGreaterThan(3);
      // the single pass also equals the plain lab run (minus the position still open at the end)
      const prep = prepared(a0, H4, END);
      const plain = runBacktest(prep.bars, customStrategy.build(prep, {}), engineFor(a0), { from: prep.start, to: prep.bars.length - 1, equity: false, atr: prep.atr, secLen: SEC4 });
      const closed = plain.trades.filter((t) => t.reason !== "end");
      expect(once.trades.slice(0, closed.length).map((t) => [t.entryTime, t.exitTime, t.pnl, t.reason])).toEqual(closed.map((t) => [t.entryTime, t.exitTime, t.pnl, t.reason]));

      let seed = 12345;
      const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
      let carriedOpen = 0;
      for (let rep = 0; rep < 6; rep++) {
        const cuts = [...new Set(Array.from({ length: 2 + Math.floor(rnd() * 25) }, () => START + Math.floor(rnd() * (END - START))))].sort((x, y) => x - y);
        let a = a0;
        for (const c of [...cuts, END]) {
          a = step(a, H4, c).account;
          if (a.cursor.carry?.pos || a.cursor.carry?.pending) carriedOpen++;
        }
        expect(tradeKey(a)).toEqual(tradeKey(once));
        expect(a.cursor.carry).toEqual(once.cursor.carry);
        expect(a.cursor.t).toBe(once.cursor.t);
        expect(isCoherent(a)).toBe(true);
      }
      // the cuts really fell into open positions / waiting orders (else the property would prove little)
      expect(carriedOpen).toBeGreaterThan(2);
    });
  }

  it("candle by candle (a new candle every call) gives the same trades too", () => {
    const a0 = base(idea(undefined, 50), 300);
    let a = a0;
    for (let i = 300; i <= 700; i++) a = step(a, H4, i).account;
    expect(tradeKey(a)).toEqual(tradeKey(step(a0, H4, 700).account));
  });

  it("über JSON gespeichert und wieder gelesen rechnet der Konto-Stand genauso weiter", () => {
    const a0 = base(idea(undefined, 50), 300);
    const mid = step(a0, H4, 900).account;
    const stored = withAccounts(null, [mid]);
    const back = forwardCfgOf(JSON.parse(JSON.stringify(stored))).accounts[0]!;
    expect(isCoherent(back)).toBe(true);
    const viaStore = step(back, H4, 1400);
    expect(viaStore.rebuilt).toBe(false);
    expect(tradeKey(viaStore.account)).toEqual(tradeKey(step(a0, H4, 1400).account));
  });
});

describe("kein Blick in die Zukunft", () => {
  it("vor dem Start und auf nicht geschlossenen Kerzen wird nichts entschieden", () => {
    const a0 = base(idea(undefined, 70), 600);
    // the candle that contains the start has not closed yet: nothing to do
    const early = advanceAccount(a0, prepared(a0, H4, 599), engineFor(a0), a0.createdAt);
    expect(early.processed).toBe(0);
    expect(early.account).toBe(a0);
    // the clock stops inside candle 650: only candles that closed by then count
    const nowMs = H4[650]!.t * 1000 + 3_600_000;
    const r = advanceAccount(a0, prepared(a0, H4, 650), engineFor(a0), nowMs);
    expect(r.account.cursor.t).toBe(H4[649]!.t);
    for (const t of r.account.trades) expect(t.entryTime).toBeGreaterThanOrEqual(a0.startMs);
    expect(lastClosedIndex(H4, SEC4, nowMs)).toBe(649);
  });

  it("die Facts einer Kerze hängen nicht von späteren Kerzen ab: Nachladen ändert alte Entscheidungen nicht", () => {
    const a0 = base(idea(undefined, 50), 300);
    const early = step(a0, H4, 900).account;
    const late = step(a0, H4, 1400).account;
    const shared = early.trades.filter((t) => t.exitTime <= H4[900]!.t * 1000);
    expect(late.trades.slice(0, shared.length)).toEqual(shared);
  });

  it("the first trade enters at or after the open of the first candle that counts", () => {
    const a = step(base(idea(undefined, 50), 300), H4, 1000).account;
    expect(a.trades[0]!.entryTime).toBeGreaterThan(H4[300]!.t * 1000);
  });
});

describe("Pausieren, Beenden", () => {
  const A0 = base(idea(undefined, 50), 300);

  it("a pause blocks NEW entries from its start, an open position keeps running", () => {
    const first = step(A0, H4, 700).account;
    const paused = pauseAccount(first, closeMs(H4, 700) + 1);
    expect(paused.status).toBe("paused");
    const mid = step(paused, H4, 1100).account;
    // no entry opened after the pause began
    const after = mid.trades.filter((t) => t.entryTime > closeMs(H4, 700));
    expect(after.length).toBeLessThanOrEqual(1);
    const back = resumeAccount(mid, closeMs(H4, 1100) + 1);
    expect(back.status).toBe("running");
    expect(back.pauses.at(-1)!.to).not.toBeNull();
    const done = step(back, H4, 1450).account;
    // the whole path equals one pass with the same pause windows
    const oneShot = step({ ...A0, pauses: back.pauses }, H4, 1450).account;
    expect(tradeKey(done)).toEqual(tradeKey(oneShot));
    expect(done.trades.length).toBeGreaterThan(mid.trades.length);
  });

  it("ending flattens the open position at the last close of the end time and does not process later candles", () => {
    const run = step(A0, H4, 900).account;
    const ended = endAccount(run, closeMs(H4, 900) + 10);
    const fin = step(ended, H4, 1400).account;
    expect(fin.cursor.done).toBe(true);
    expect(fin.cursor.carry!.pos).toBeNull();
    expect(fin.cursor.carry!.pending).toBeNull();
    expect(fin.cursor.t).toBe(H4[900]!.t);
    const lastTrade = fin.trades.at(-1)!;
    expect(lastTrade.exitTime).toBeLessThanOrEqual(closeMs(H4, 900));
    // done = no more work
    expect(advanceAccount(fin, prepared(fin, H4, 1400), engineFor(fin), closeMs(H4, 1400)).account).toBe(fin);
  });

  it("ending an account that never saw a candle is finished at once", () => {
    const fresh = base(idea(), 1000);
    const ended = endAccount(fresh, fresh.createdAt + 1);
    const r = advanceAccount(ended, prepared(ended, H4, 1000), engineFor(ended), fresh.createdAt + 1);
    expect(r.account.cursor.done).toBe(true);
    expect(r.account.trades).toEqual([]);
  });
});

describe("beschädigter Stand wird aus den Kerzen neu aufgebaut", () => {
  const A0 = base(idea(undefined, 50), 300);
  const good = step(A0, H4, 1000).account;

  it("a mixed-up cursor (check value does not match) is rebuilt and ends up equal", () => {
    const broken: ForwardAccount = { ...good, cursor: { ...good.cursor, carry: { ...good.cursor.carry!, realised: good.cursor.carry!.realised + 50 } } };
    expect(isCoherent(broken)).toBe(false);
    const r = step(broken, H4, 1000);
    expect(r.rebuilt).toBe(true);
    expect(tradeKey(r.account)).toEqual(tradeKey(good));
    expect(r.account.cursor).toEqual(good.cursor);
  });

  it("trades that do not belong to the cursor (merge of two devices) → rebuild", () => {
    const extra = { ...good.trades[0]!, id: "f1" };
    const broken: ForwardAccount = { ...good, trades: [...good.trades, extra] };
    expect(isCoherent(broken)).toBe(false);
    expect(step(broken, H4, 1000).account.trades.length).toBe(good.trades.length);
  });

  it("a carry whose entry candle is not in the series is refused by the engine", () => {
    const open = [300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200].map((i) => step(A0, H4, i).account).find((a) => a.cursor.carry?.pos);
    if (!open) return;
    const wrong = { ...open.cursor.carry!, pos: { ...open.cursor.carry!.pos!, entryT: 5 } };
    const base2 = { t: open.cursor.t, c: open.cursor.c, carry: wrong, nTrades: open.cursor.nTrades, pnlSum: open.cursor.pnlSum, done: false };
    const tampered: ForwardAccount = { ...open, cursor: { ...base2, sig: cursorSig(base2) } };
    expect(() => step(tampered, H4, 1300)).toThrow(/carry/);
  });
});

describe("Konto-Ansicht", () => {
  it("equity curve, key numbers with sample size and the open position at the last close", () => {
    const a = step(base(idea(undefined, 50), 300), H4, 1200).account;
    const v = accountView(a);
    expect(v.stats.n).toBe(a.trades.length);
    expect(v.hasData).toBe(true);
    expect(v.upTo).toBe(closeMs(H4, 1200));
    expect(v.curve[0]).toBe(0);
    expect(v.equity.length).toBeGreaterThanOrEqual(a.trades.length + 1);
    const sum = a.trades.reduce((s, t) => s + t.pnl, 0);
    if (!v.open) expect(v.now).toBeCloseTo(10_000 + sum, 6);
    else expect(v.now - (10_000 + sum)).toBeCloseTo(v.open.unrealised, 6);
  });

  it("a fresh account shows an honest empty state", () => {
    const v = accountView(base(idea(), 300));
    expect(v.hasData).toBe(false);
    expect(v.upTo).toBeNull();
    expect(v.stats.n).toBe(0);
    expect(v.stats.winRate).toBeNull();
    expect(v.now).toBe(10_000);
  });
});

describe("Begrenzung", () => {
  it("a full account ends itself with the reason 'limit' and is flattened", () => {
    // a very short time stop on noisy 1h candles makes many trades
    const bars = walk(9000, 3600, 11);
    const cfg = idea({ interval: "1h", exits: { ...defaultCustom().exits, maxBars: 1 } }, 50);
    const a0 = base(cfg, 300, bars);
    const r = advanceAccount(a0, prepared(a0, bars, 8999), engineFor(a0), closeMs(bars, 8999, 3600) + 1);
    expect(r.account.trades.length).toBe(250);
    expect(r.account.status).toBe("ended");
    expect(r.account.endReason).toBe("limit");
    expect(r.account.cursor.done).toBe(true);
    expect(r.account.cursor.carry!.pos).toBeNull();
  });
});
