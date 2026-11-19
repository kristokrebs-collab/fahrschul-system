/**
 * P11 client logic (pure): the field-ownership rule of the sync (`syncFields.ts`), the local merge of pulled server
 * trades (`localMerge.planMerge`), the sync inbox (`inbox.ts`) and the broker reconciliation (`reconcile.ts`).
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Trade } from "@/domain/types";
import { gapsOf, isImported, readDismissed, syncInbox, writeDismissed } from "@/exchanges/inbox";
import { planMerge } from "@/exchanges/localMerge";
import { mergeDuplicate, pnlDeviates, reconcile } from "@/exchanges/reconcile";
import { isEmptySyncValue, isSyncedRecord, mergeSyncedTrade, splitSyncFields, stableJson, SYNC_FILL_KEYS, SYNC_SET_KEYS, syncedTradeId } from "@/exchanges/syncFields";
import type { PositionCheck } from "@/exchanges/types";
import { mkTrade } from "./domain.fixtures";

const NOW = "2026-10-12T09:00:00.000Z";

/** A trade the Bitunix sync wrote (deterministic id, exchange fields, nothing of the trader yet). */
function synced(p: Partial<Trade> & { id: string; date: string }): Trade {
  return mkTrade({
    exchange: "bitunix",
    externalId: p.id.replace("t_bx_", ""),
    syncSource: "bitunix-api",
    origin: { kind: "api" },
    market: "perp",
    timeframe: "",
    ...p,
  });
}

describe("syncFields – who owns which field", () => {
  it("SET and FILL lists are disjoint and leave the trader's fields alone", () => {
    const set = new Set<string>(SYNC_SET_KEYS);
    for (const k of SYNC_FILL_KEYS) expect(set.has(k)).toBe(false);
    for (const k of ["setups", "notes", "reason", "emotion", "tags", "rating", "psych", "screenshots", "account", "timeframe", "checks", "mistakes"]) {
      expect(set.has(k)).toBe(false);
      expect((SYNC_FILL_KEYS as readonly string[]).includes(k)).toBe(false);
    }
  });

  it("splitSyncFields keeps only exchange keys; empty FILL values are not offered", () => {
    const { set, fill } = splitSyncFields({ entry: 100, exit: 110, pnl: 9.5, notes: "x", stop: null, target: 120, targets: [], liqPrice: 50 });
    expect(set).toEqual({ entry: 100, exit: 110, pnl: 9.5 });
    expect(fill).toEqual({ target: 120, liqPrice: 50 });
  });

  it("mergeSyncedTrade: SET overwrites, FILL only fills, the trader's part survives", () => {
    const current = {
      id: "t_bx_1",
      entry: 100,
      exit: 105,
      pnlManual: 4,
      stop: 95,
      target: null,
      setups: ["s1"],
      notes: "mein Plan",
      emotion: "ruhig",
      updatedAt: "2026-10-01T00:00:00.000Z",
    };
    const incoming = { id: "t_bx_1", entry: 100, exit: 110, pnlManual: 9.2, stop: 90, target: 120, notes: "server", emotion: "", syncedAt: NOW };
    const merged = mergeSyncedTrade(current, incoming, NOW)!;
    expect(merged).toMatchObject({ exit: 110, pnlManual: 9.2, stop: 95, target: 120, setups: ["s1"], notes: "mein Plan", emotion: "ruhig", updatedAt: NOW });
  });

  it("mergeSyncedTrade returns null when only bookkeeping keys would change", () => {
    const current = { id: "t_bx_2", entry: 1, exit: 2, syncedAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z" };
    expect(mergeSyncedTrade(current, { entry: 1, exit: 2, syncedAt: NOW }, NOW)).toBeNull();
  });

  it("stableJson ignores key order; empty values; ids; synced records", () => {
    expect(stableJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(stableJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
    expect([null, undefined, "", []].every(isEmptySyncValue)).toBe(true);
    expect(isEmptySyncValue(0)).toBe(false);
    expect(syncedTradeId("bitunix", "12345")).toBe("t_bx_12345");
    expect(syncedTradeId("bitunix", "a/b c")).toBe("t_bx_abc");
    expect(syncedTradeId("Kraken Pro", "9")).toBe("t_kraken_9");
    expect(isSyncedRecord({ syncSource: "bitunix-api" })).toBe(true);
    expect(isSyncedRecord({ syncSource: "csv-bitunix" })).toBe(false);
  });
});

describe("localMerge.planMerge", () => {
  const local = synced({ id: "t_bx_10", date: "2026-10-01T10:00", entry: 100, exit: 110, pnlManual: 9, setups: ["s1"], notes: "gut gelaufen" });

  it("adds new trades, updates changed exchange fields, skips unchanged ones and duplicates in one pull", () => {
    const pulled = [
      { id: "t_bx_10", data: { ...local, pnlManual: 8.4, fees: 0.6, notes: "", setups: [] }, updatedAt: NOW },
      { id: "t_bx_11", data: { ...synced({ id: "t_bx_11", date: "2026-10-02T10:00", entry: 50, exit: 49, pnlManual: -1 }) }, updatedAt: NOW },
      { id: "t_bx_11", data: { pnlManual: 999 }, updatedAt: NOW },
    ];
    const plan = planMerge([local], pulled, NOW);
    expect(plan.added.map((t) => t.id)).toEqual(["t_bx_11"]);
    expect(plan.added[0]!.pnlManual).toBe(-1);
    expect(plan.updated).toHaveLength(1);
    expect(plan.updated[0]).toMatchObject({ id: "t_bx_10", pnlManual: 8.4, fees: 0.6, notes: "gut gelaufen", setups: ["s1"] });
  });

  it("a repeated pull of the same state is a no-op", () => {
    const plan = planMerge([local], [{ id: local.id, data: { ...local }, updatedAt: NOW }], NOW);
    expect(plan).toEqual({ added: [], updated: [] });
  });
});

describe("inbox", () => {
  beforeEach(() => localStorage.clear());

  it("imported = sync, webhook, REST, CSV; hand-typed trades never show up", () => {
    expect(isImported({ origin: { kind: "api" } })).toBe(true);
    expect(isImported({ origin: { kind: "csv" } })).toBe(true);
    expect(isImported({ origin: { kind: "manual" } })).toBe(false);
    expect(isImported({ syncSource: "bitunix-api" })).toBe(true);
    expect(isImported({})).toBe(false);
  });

  it("lists gaps (setup, stop, feeling) and sorts by |P&L|, dismissed ones out", () => {
    const a = synced({ id: "t_bx_a", date: "2026-10-01T10:00", pnlManual: 12 });
    const b = synced({ id: "t_bx_b", date: "2026-10-02T10:00", pnlManual: -80, setups: ["s"], stop: 1, emotion: "ruhig" });
    const c = synced({ id: "t_bx_c", date: "2026-10-03T10:00", pnlManual: -40, setups: ["s"] });
    const manual = mkTrade({ id: "m", date: "2026-10-03T10:00", pnlManual: 500 });
    expect(gapsOf(a)).toEqual(["setup", "stop", "emotion"]);
    expect(gapsOf(c)).toEqual(["stop", "emotion"]);
    const items = syncInbox([a, b, c, manual], new Set());
    expect(items.map((i) => i.trade.id)).toEqual(["t_bx_c", "t_bx_a"]);
    expect(items[0]!.weight).toBe(40);
    expect(syncInbox([a, c], new Set(["t_bx_c"])).map((i) => i.trade.id)).toEqual(["t_bx_a"]);
  });

  it("dismissed ids survive a reload of the device store", () => {
    writeDismissed(new Set(["x", "y"]));
    expect([...readDismissed()].sort()).toEqual(["x", "y"]);
  });
});

describe("reconcile", () => {
  const sync = synced({ id: "t_bx_7", date: "2026-10-05T13:02", pair: "BTC/USDT", side: "long", entry: 62000, exit: 62600, size: 6200, pnlManual: 59.18 });
  const hand = mkTrade({
    id: "m1",
    date: "2026-10-05T13:00",
    pair: "BTCUSDT",
    side: "long",
    entry: 62010,
    exit: 62600,
    size: 6201,
    pnlManual: 61,
    setups: ["s_sweep"],
    notes: "Sweep unter EQL",
    emotion: "ruhig",
    stop: 61500,
    timeframe: "15m",
    account: "makro",
  });
  const far = mkTrade({ id: "m2", date: "2026-10-05T16:00", pair: "BTC/USDT", side: "long", entry: 62000, exit: 62600, pnlManual: 59 });

  it("finds the hand-typed copy (≤ 15 min, ≤ 0.5 %) and the P&L deviation", () => {
    const r = reconcile([sync, hand, far]);
    expect(r.synced).toBe(1);
    expect(r.duplicates).toHaveLength(1);
    expect(r.duplicates[0]).toMatchObject({ key: "t_bx_7|m1", pnlDiff: 1.82 });
    expect(r.pnlDiffs).toHaveLength(1);
  });

  it("ignored pairs stay quiet; other side or price far off is no match", () => {
    expect(reconcile([sync, hand], [], new Set(["t_bx_7|m1"])).duplicates).toHaveLength(0);
    expect(reconcile([sync, { ...hand, side: "short" }]).duplicates).toHaveLength(0);
    expect(reconcile([sync, { ...hand, entry: 63000 }]).duplicates).toHaveLength(0);
  });

  it("missing = new positions of the dry run that the journal does not have", () => {
    const check = (id: string, state: PositionCheck["state"]): PositionCheck => ({
      id,
      externalId: id,
      pair: "SOL/USDT",
      side: "long",
      date: "2026-10-08T21:22",
      exitDate: "2026-10-08T23:00",
      qty: 1,
      entry: 1,
      exit: 2,
      gross: 1,
      realizedPnl: 1,
      fee: 0,
      funding: 0,
      net: 1,
      fills: 2,
      stop: null,
      target: null,
      state,
    });
    const r = reconcile([sync], [check("t_bx_7", "new"), check("t_bx_8", "new"), check("t_bx_9", "exists")]);
    expect(r.missing.map((c) => c.id)).toEqual(["t_bx_8"]);
  });

  it("pnlDeviates uses max(1, 1 %)", () => {
    expect(pnlDeviates(10.5, 10)).toBe(false);
    expect(pnlDeviates(11.2, 10)).toBe(true);
    expect(pnlDeviates(1010, 1000)).toBe(false);
    expect(pnlDeviates(null, 10)).toBe(false);
  });

  it("mergeDuplicate keeps the exchange numbers and carries the trader's part over", () => {
    const merged = mergeDuplicate({ ...sync, notes: "Bitunix-Import" }, hand, NOW);
    expect(merged).toMatchObject({
      id: "t_bx_7",
      entry: 62000,
      pnlManual: 59.18,
      setups: ["s_sweep"],
      emotion: "ruhig",
      stop: 61500,
      timeframe: "15m",
      account: "makro",
      updatedAt: NOW,
    });
    expect(merged.notes).toBe("Bitunix-Import\n\nSweep unter EQL");
  });
});
