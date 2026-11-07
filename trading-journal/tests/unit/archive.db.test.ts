/**
 * Archive store (F26): the IndexedDB layer on fake-indexeddb – key ranges per row, the newest N, the overview with
 * first / last / count, ring-buffer trimming from the lower end, deletion of a row and of everything, the tick log.
 */
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import type { ArchivePoint, SeriesId, TickRecord } from "@/domain/archive";
import { ArchiveUnavailable, openArchiveDb } from "@/market/archive/db";

const pt = (series: SeriesId, symbol: string, t: number, v = t): ArchivePoint => ({ series, symbol, t, d: { oi: v } });
const tick = (t: number, iv = 10): TickRecord => ({ t, iv, route: "direct", res: { BTCUSDT: "ok" }, states: false });
const fresh = () => openArchiveDb({ factory: new IDBFactory(), name: "t-archive" });

describe("archive db", () => {
  it("rejects with ArchiveUnavailable without IndexedDB", async () => {
    await expect(openArchiveDb({ factory: null })).rejects.toBeInstanceOf(ArchiveUnavailable);
  });

  it("keeps rows apart and returns ranges oldest first", async () => {
    const db = await fresh();
    await db.putPoints([pt("oi", "BTCUSDT", 300), pt("oi", "BTCUSDT", 100), pt("oi", "BTCUSDT", 200), pt("oi", "ETHUSDT", 150), pt("premium", "BTCUSDT", 120)]);
    expect((await db.range("oi", "BTCUSDT", 0, 1000)).map((p) => p.t)).toEqual([100, 200, 300]);
    expect((await db.range("oi", "BTCUSDT", 150, 250)).map((p) => p.t)).toEqual([200]);
    expect((await db.range("oi", "ETHUSDT", 0, 1000)).map((p) => p.t)).toEqual([150]);
    expect((await db.range("oi", "BTCUSDT", 0, 1000, 2)).map((p) => p.t)).toEqual([100, 200]);
    db.close();
  });

  it("writes the same time once (the later write wins)", async () => {
    const db = await fresh();
    await db.putPoints([pt("oi", "BTCUSDT", 100, 1)]);
    await db.putPoints([pt("oi", "BTCUSDT", 100, 2)]);
    const rows = await db.range("oi", "BTCUSDT", 0, 1000);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.d.oi).toBe(2);
    db.close();
  });

  it("latest returns the newest n, oldest first", async () => {
    const db = await fresh();
    await db.putPoints([100, 200, 300, 400, 500].map((t) => pt("oi", "BTCUSDT", t)));
    expect((await db.latest("oi", "BTCUSDT", 2)).map((p) => p.t)).toEqual([400, 500]);
    expect((await db.latest("oi", "BTCUSDT", 99)).map((p) => p.t)).toEqual([100, 200, 300, 400, 500]);
    expect(await db.latest("oi", "SOLUSDT", 3)).toEqual([]);
    db.close();
  });

  it("overview lists every row with count, first and last", async () => {
    const db = await fresh();
    await db.putPoints([pt("oi", "BTCUSDT", 100), pt("oi", "BTCUSDT", 300), pt("premium", "BTCUSDT", 50), pt("oi", "ETHUSDT", 70), pt("oi", "ETHUSDT", 80), pt("oi", "ETHUSDT", 90)]);
    expect(await db.overview()).toEqual([
      { series: "oi", symbol: "BTCUSDT", count: 2, first: 100, last: 300 },
      { series: "oi", symbol: "ETHUSDT", count: 3, first: 70, last: 90 },
      { series: "premium", symbol: "BTCUSDT", count: 1, first: 50, last: 50 },
    ]);
    db.close();
  });

  it("trim drops the oldest points of a row and nothing else (ring buffer)", async () => {
    const db = await fresh();
    await db.putPoints([...[1, 2, 3, 4, 5, 6].map((t) => pt("oi", "BTCUSDT", t)), ...[1, 2, 3].map((t) => pt("oi", "ETHUSDT", t))]);
    const removed = await db.trim((_s, sym) => (sym === "BTCUSDT" ? 4 : 10));
    expect(removed).toBe(2);
    expect((await db.range("oi", "BTCUSDT", 0, 99)).map((p) => p.t)).toEqual([3, 4, 5, 6]);
    expect((await db.range("oi", "ETHUSDT", 0, 99)).map((p) => p.t)).toEqual([1, 2, 3]);
    expect(await db.trim(() => 0)).toBe(7);
    expect(await db.overview()).toEqual([]);
    db.close();
  });

  it("deleteRow removes one series of one symbol, or of all symbols", async () => {
    const db = await fresh();
    await db.putPoints([pt("oi", "BTCUSDT", 1), pt("oi", "BTCUSDT", 2), pt("oi", "ETHUSDT", 1), pt("premium", "BTCUSDT", 1)]);
    expect(await db.deleteRow("oi", "BTCUSDT")).toBe(2);
    expect((await db.overview()).map((o) => `${o.series}:${o.symbol}`)).toEqual(["oi:ETHUSDT", "premium:BTCUSDT"]);
    expect(await db.deleteRow("oi")).toBe(1);
    expect(await db.deleteRow("oi")).toBe(0);
    expect((await db.overview()).map((o) => `${o.series}:${o.symbol}`)).toEqual(["premium:BTCUSDT"]);
    db.close();
  });

  it("deleteAll empties points and ticks", async () => {
    const db = await fresh();
    await db.putPoints([pt("oi", "BTCUSDT", 1)]);
    await db.putTick(tick(5));
    await db.deleteAll();
    expect(await db.overview()).toEqual([]);
    expect(await db.ticks()).toEqual([]);
    db.close();
  });

  it("keeps the tick log in order and trims it to a cap from the old end", async () => {
    const db = await fresh();
    for (const t of [30, 10, 20, 40, 50]) await db.putTick(tick(t));
    expect((await db.ticks()).map((x) => x.t)).toEqual([10, 20, 30, 40, 50]);
    expect((await db.ticks(20, 40)).map((x) => x.t)).toEqual([20, 30, 40]);
    expect(await db.trimTicks(3)).toBe(2);
    expect((await db.ticks()).map((x) => x.t)).toEqual([30, 40, 50]);
    expect(await db.trimTicks(10)).toBe(0);
    db.close();
  });
});
