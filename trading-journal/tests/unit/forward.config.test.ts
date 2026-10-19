/**
 * F23 – the stored shape: `settings.forward` is read strictly per account (unreadable entries are kept aside and written back),
 * unknown keys survive, the id lists merge across devices (`merge3`) and a mixed-up merge is rebuilt from the candles; the
 * comparison with the backtest of the same rules says "too early" / "holds" / "differs" with its numbers.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { customStrategy, DEFAULT_FEES, runStats, type Bar, type EngineCfg } from "@/domain/backtest/index";
import { defaultParams, sanitizeParams } from "@/domain/lab/rules/blocks";
import { defaultCustom, newGroup, newLeaf, sanitizeCustom } from "@/domain/lab/rules/tree";
import type { CustomConfig, Leaf, LeafParams } from "@/domain/lab/rules/types";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import {
  advanceAccount,
  backtestWindow,
  COMPARE_MIN_TRADES,
  compareForward,
  engineCfgOf,
  forwardCfgOf,
  hasActiveForward,
  isCoherent,
  MAX_ACCOUNTS,
  newAccount,
  newAccountError,
  planOf,
  withAccounts,
  type ForwardAccount,
} from "@/domain/forward";
import { merge3 } from "@/store/merge3";

const H4: Bar[] = (JSON.parse(readFileSync("tests/unit/fixtures/binance-btcusdt-4h.json", "utf8")) as { bars: number[][] }).bars.map(([t, o, h, l, c]) => ({ t: t!, o: o!, h: h!, l: l!, c: c! }));
const leaf = (id: string, block: Leaf["block"], params: LeafParams = {}): Leaf => ({ ...newLeaf(id, block, "exec"), params: sanitizeParams(block, { ...defaultParams(block), ...params }) });
const idea = (level = 50): CustomConfig => sanitizeCustom({ ...defaultCustom(), name: "Test", interval: "4h", sides: "long", long: newGroup("g1", "and", [leaf("n1", "rsi", { mode: "below", level })]) });
const eng = (a: ForwardAccount): EngineCfg => ({ ...engineCfgOf(a, null), costs: { fees: DEFAULT_FEES, slippage: { kind: "fixed", bps: 2 }, funding: { kind: "none" } } });
const make = (id: string, startIdx: number): ForwardAccount =>
  newAccount({ id, name: id, config: idea(), signal: DEFAULT_SIGNAL_CFG, symbol: "BTCUSDT", capital: 10_000, riskPct: 1, maxLeverage: 5, exchange: "binance", slippage: { kind: "fixed", bps: 2 }, funding: "none", source: { kind: "draft", label: "Test", versionNo: 2 } }, H4[startIdx]!.t * 1000 + 1000);
const prep = (a: ForwardAccount, upTo: number) => customStrategy.prepare({ "4h": H4.slice(0, upTo + 1).filter((b) => b.t * 1000 >= planOf(a).anchorMs) }, { config: a.config, signal: a.signal }, a.startMs).result();
const run = (a: ForwardAccount, upTo: number) => advanceAccount(a, prep(a, upTo), eng(a), (H4[upTo]!.t + 14_400) * 1000 + 5000);

describe("settings.forward lesen und schreiben", () => {
  it("round trip through JSON gives the same accounts", () => {
    const a = run(make("a1", 300), 800).account;
    const stored = withAccounts({ v: 1, accounts: [] }, [a]);
    const back = forwardCfgOf(JSON.parse(JSON.stringify(stored)));
    expect(back.accounts).toHaveLength(1);
    expect(back.accounts[0]).toEqual(a);
    expect(isCoherent(back.accounts[0]!)).toBe(true);
  });

  it("starts empty, absent or garbage → no accounts", () => {
    for (const raw of [undefined, null, 5, "x", [], { v: 1 }, { accounts: "no" }]) expect(forwardCfgOf(raw).accounts).toEqual([]);
    expect(hasActiveForward(undefined)).toBe(false);
  });

  it("an unreadable entry is kept aside and written back, unknown root keys survive, nothing changes → the same object", () => {
    const a = make("a1", 300);
    const junk = { id: "x9", status: "running", futureField: { answer: 42 } };
    const raw = { v: 1, mystery: [1, 2, 3], accounts: [JSON.parse(JSON.stringify(a)), junk] };
    const cfg = forwardCfgOf(raw);
    expect(cfg.accounts.map((x) => x.id)).toEqual(["a1"]);
    expect(cfg.rejected).toEqual([junk]);
    const written = withAccounts(raw, cfg.accounts) as { mystery: unknown; accounts: unknown[] };
    expect(written).toBe(raw);
    const changed = withAccounts(raw, [{ ...cfg.accounts[0]!, name: "Neu" }]) as { mystery: unknown; accounts: unknown[] };
    expect(changed.mystery).toEqual([1, 2, 3]);
    expect(changed.accounts).toHaveLength(2);
    expect(changed.accounts[1]).toEqual(junk);
  });

  it("strict per account: bad numbers, ids, status, rules → rejected, a duplicate id keeps the first, the count is limited", () => {
    const ok = JSON.parse(JSON.stringify(make("a1", 300))) as Record<string, unknown>;
    const bads = [{ ...ok, id: "../x" }, { ...ok, id: "b", status: "weird" }, { ...ok, id: "c", capital: -5 }, { ...ok, id: "d", symbol: "btc" }, { ...ok, id: "e", config: { version: 2 } }, { ...ok, id: "f", slippage: { kind: "x" } }, { ...ok, id: "g", riskPct: 99 }, 5, null];
    const cfg = forwardCfgOf({ v: 1, accounts: [ok, { ...ok, name: "dup" }, ...bads] });
    expect(cfg.accounts.map((a) => a.id)).toEqual(["a1"]);
    expect(cfg.accounts[0]!.name).toBe("a1");
    expect(cfg.rejected).toHaveLength(bads.length);
    const many = Array.from({ length: MAX_ACCOUNTS + 3 }, (_, k) => ({ ...ok, id: `m${k}` }));
    expect(forwardCfgOf({ v: 1, accounts: many }).accounts).toHaveLength(MAX_ACCOUNTS);
  });

  it("hasActiveForward: running / paused / ended-but-not-flattened need the app, a finished account does not", () => {
    const a = make("a1", 300);
    const s = (status: string, done: boolean) => ({ accounts: [{ status, cursor: { done } }] });
    expect(hasActiveForward(s("running", false))).toBe(true);
    expect(hasActiveForward(s("paused", false))).toBe(true);
    expect(hasActiveForward(s("ended", false))).toBe(true);
    expect(hasActiveForward(s("ended", true))).toBe(false);
    expect(hasActiveForward({ accounts: [a] })).toBe(true);
  });

  it("newAccountError: limits and rules that cannot run", () => {
    const input = { config: idea(), symbol: "BTCUSDT", capital: 1000, riskPct: 1, maxLeverage: 3 };
    expect(newAccountError(input, [])).toBeNull();
    expect(newAccountError({ ...input, config: { ...idea(), long: newGroup("g1") } }, [])).toMatch(/Ohne mindestens eine Bedingung/);
    expect(newAccountError({ ...input, symbol: "btc" }, [])).toMatch(/Markt/);
    expect(newAccountError({ ...input, capital: 5 }, [])).toMatch(/Startkapital/);
    expect(newAccountError({ ...input, riskPct: 50 }, [])).toMatch(/Risiko/);
    expect(newAccountError({ ...input, maxLeverage: 0 }, [])).toMatch(/Hebel/);
    expect(newAccountError(input, Array.from({ length: MAX_ACCOUNTS }, (_, k) => make(`x${k}`, 300)))).toMatch(/Mehr als 8/);
  });

  it("a new account freezes a sanitised copy of the rules and starts at the candle that contains the creation time", () => {
    const a = make("a1", 300);
    expect(a.startMs).toBe(H4[300]!.t * 1000);
    expect(a.createdAt).toBe(H4[300]!.t * 1000 + 1000);
    expect(a.status).toBe("running");
    expect(a.trades).toEqual([]);
    expect(a.cursor.t).toBeNull();
    expect(a.config.version).toBe(1);
    expect(a.source).toEqual({ kind: "draft", label: "Test", versionNo: 2 });
  });
});

describe("Cloud- und Zwei-Tab-Merge", () => {
  it("accounts added on two devices are both kept (id list), a delete of an untouched account is respected", () => {
    const base = { v: 1, accounts: [JSON.parse(JSON.stringify(make("a1", 300)))] };
    const mine = { ...base, accounts: [...base.accounts, JSON.parse(JSON.stringify(make("a2", 310)))] };
    const theirs = { ...base, accounts: [...base.accounts, JSON.parse(JSON.stringify(make("a3", 320)))] };
    const merged = merge3(base, mine, theirs) as typeof base;
    expect(merged.accounts.map((a: { id: string }) => a.id).sort()).toEqual(["a1", "a2", "a3"]);
    const gone = merge3(base, { ...base, accounts: [] }, base) as typeof base;
    expect(gone.accounts).toEqual([]);
  });

  it("two devices catching up the same account to different candles: the merge is detected and rebuilt to the single-pass result", () => {
    const a0 = make("a1", 300);
    const mineA = run(a0, 900).account;
    const theirsA = run(a0, 1200).account;
    const wire = (a: ForwardAccount) => JSON.parse(JSON.stringify(withAccounts(null, [a])));
    const merged = forwardCfgOf(merge3(wire(a0), wire(mineA), wire(theirsA))).accounts[0]!;
    const final = run(merged, 1400);
    const direct = run(a0, 1400).account;
    expect(final.account.trades.map((t) => [t.id, t.pnl])).toEqual(direct.trades.map((t) => [t.id, t.pnl]));
    expect(final.account.cursor).toEqual(direct.cursor);
    expect(isCoherent(final.account)).toBe(true);
  });

  it("a changed name on one device and new trades on the other merge without losing either", () => {
    const a0 = make("a1", 300);
    const adv = run(a0, 1000).account;
    const wire = (a: ForwardAccount) => JSON.parse(JSON.stringify(withAccounts(null, [a])));
    const merged = forwardCfgOf(merge3(wire(a0), wire({ ...a0, name: "Umbenannt" }), wire(adv))).accounts[0]!;
    expect(merged.name).toBe("Umbenannt");
    expect(merged.trades.length).toBe(adv.trades.length);
    expect(isCoherent(merged)).toBe(true);
  });
});

describe("Vergleich mit dem Backtest derselben Regeln", () => {
  // forward = the candles after the start; backtest = the candles before it, same rules and costs
  const START = 800;
  const fwdAcct = run(make("f", START), 1450).account;
  const btAcct = make("b", START);
  const btPrep = customStrategy.prepare({ "4h": H4.slice(0, START + 1).filter((b) => b.t * 1000 >= btAcct.startMs - 2_000 * 14_400_000 - planOf(btAcct).warmupMs) }, { config: btAcct.config, signal: btAcct.signal }, btAcct.startMs - 2_000 * 14_400_000).result();
  const bt = backtestWindow(btAcct, btPrep, eng(btAcct));

  it("the backtest window ends where the account starts and does not see the account's candles", () => {
    expect(bt).not.toBeNull();
    expect(bt!.trades.length).toBeGreaterThan(5);
    for (const t of bt!.trades) expect(t.exitTime).toBeLessThanOrEqual(btAcct.startMs);
    expect(bt!.trades.length).toBeGreaterThan(0);
    const fwdFirst = fwdAcct.trades[0]!;
    expect(fwdFirst.entryTime).toBeGreaterThanOrEqual(btAcct.startMs);
  });

  it("too early: fewer than the minimum trades → no verdict, with the numbers", () => {
    const fwd = runStats({ trades: [], equity: [], from: 0, to: 1, capital: 10_000, skipped: 0, skippedGap: 0, skippedRisk: 0, signals: 0 });
    const c = compareForward(fwd, runStats(bt!));
    expect(c.level).toBe("thin");
    expect(c.headline).toMatch(/Zu früh für ein Urteil: Der Forward-Test hat erst 0 Trades/);
    expect(c.rows.map((r) => r.id)).toEqual(["n", "rate", "avgR", "pf", "net", "dd"]);
    expect(c.notes.join(" ")).toMatch(/nie für beides/);
  });

  it("the same stats on both sides hold; shifted forward stats differ, the headline names both averages and says 'mögliche Gründe'", () => {
    const s = runStats(bt!);
    expect(s.n).toBeGreaterThanOrEqual(COMPARE_MIN_TRADES);
    const same = compareForward(s, s);
    expect(same.level).toBe("holds");
    expect(same.rows.find((r) => r.id === "avgR")!.inside).toBe(true);
    expect(same.headline).toMatch(/Bisher im Rahmen/);
    const worse = compareForward({ ...s, avgR: (s.avgR ?? 0) - 5 }, s);
    expect(worse.level).toBe("differs");
    expect(worse.headline).toMatch(/Abweichung: Ø .* gegenüber Ø .*darunter und außerhalb/);
    expect(worse.headline).toMatch(/Mögliche Gründe, keiner davon geprüft/);
    expect(worse.rows.find((r) => r.id === "avgR")!.diff).toBe("−5,00 R");
    const better = compareForward({ ...s, avgR: (s.avgR ?? 0) + 5 }, s);
    expect(better.headline).toMatch(/darüber/);
  });

  it("the backtest with too few trades cannot carry a verdict either", () => {
    const s = runStats(bt!);
    const few = compareForward(s, { ...s, n: 3 });
    expect(few.level).toBe("thin");
    expect(few.headline).toMatch(/Der Rückblick hat selbst nur 3 Trades/);
  });
});
