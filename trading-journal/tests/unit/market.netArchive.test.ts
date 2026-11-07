/**
 * The stored history of the Top-Trader card (C3): the IndexedDB layer on fake-indexeddb (rows per series and symbol, the same time
 * written once, trimming, clearing), the on/off switch (default on, remembered), and the hook – it reads what is stored, stores the
 * live points on the hour grid when the switch is on, keeps the history for the next visit, drops what is older than 180 days,
 * and works without IndexedDB (status `unavailable`, no crash).
 */
import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ARCHIVE_KEEP_MS, type ArchivedNetPoint } from "@/domain/signals/netSeries";
import type { NetPoint } from "@/domain/signals";
import { NET_ARCHIVE_CFG_KEY, NetArchiveUnavailable, __resetNetArchive, getNetArchiveOn, openNetArchive, setNetArchiveOn, useNetArchive } from "@/market/netArchive";

const H = 3_600_000;
const T0 = Date.UTC(2026, 9, 1);
const row = (i: number, long = 55, price: number | null = 70_000): ArchivedNetPoint => ({ t: T0 + i * H, long, price, s: H });
const live = (from: number, n: number, long = 55, step = H): NetPoint[] => Array.from({ length: n }, (_, i) => ({ t: T0 + (from + i) * step, net: 2 * long - 100, longPct: long, price: 70_000 + i }));

beforeEach(() => {
  localStorage.clear();
  __resetNetArchive(new IDBFactory());
});
afterEach(() => {
  __resetNetArchive();
});

describe("the store", () => {
  it("rejects with NetArchiveUnavailable without IndexedDB", async () => {
    await expect(openNetArchive(null)).rejects.toBeInstanceOf(NetArchiveUnavailable);
  });

  it("keeps series and symbols apart, returns oldest first, the same time once (the later write wins)", async () => {
    const db = await openNetArchive(new IDBFactory(), "t-net");
    await db.put("position", "BTCUSDT", [row(3), row(1), row(2, 50)]);
    await db.put("account", "BTCUSDT", [row(1, 60)]);
    await db.put("position", "ETHUSDT", [row(1, 40)]);
    await db.put("position", "BTCUSDT", [row(2, 48)]);
    expect((await db.read("position", "BTCUSDT")).map((r) => [r.t - T0, r.long])).toEqual([
      [H, 55],
      [2 * H, 48],
      [3 * H, 55],
    ]);
    expect((await db.read("account", "BTCUSDT")).map((r) => r.long)).toEqual([60]);
    expect((await db.read("position", "ETHUSDT")).map((r) => r.long)).toEqual([40]);
    expect((await db.read("position", "BTCUSDT", T0 + 2 * H)).map((r) => r.t - T0)).toEqual([2 * H, 3 * H]);
    db.close();
  });

  it("trims what is older than a time and clears everything", async () => {
    const db = await openNetArchive(new IDBFactory(), "t-net2");
    await db.put("position", "BTCUSDT", [row(0), row(1), row(2), row(3)]);
    await db.put("account", "BTCUSDT", [row(0)]);
    expect(await db.trim("position", "BTCUSDT", T0 + 2 * H)).toBe(2);
    expect((await db.read("position", "BTCUSDT")).map((r) => r.t - T0)).toEqual([2 * H, 3 * H]);
    expect(await db.read("account", "BTCUSDT")).toHaveLength(1);
    expect(await db.trim("position", "BTCUSDT", T0)).toBe(0);
    expect(await db.clear()).toBe(3);
    expect(await db.read("position", "BTCUSDT")).toEqual([]);
    db.close();
  });
});

describe("the switch", () => {
  it("is on by default and remembered when turned off", () => {
    expect(getNetArchiveOn()).toBe(true);
    setNetArchiveOn(false);
    expect(getNetArchiveOn()).toBe(false);
    expect(JSON.parse(localStorage.getItem(NET_ARCHIVE_CFG_KEY)!)).toEqual({ v: 1, on: false });
    __resetNetArchive(new IDBFactory());
    expect(getNetArchiveOn()).toBe(false);
    setNetArchiveOn(true);
    expect(getNetArchiveOn()).toBe(true);
  });

  it("anything but an explicit off is on", () => {
    localStorage.setItem(NET_ARCHIVE_CFG_KEY, "garbage");
    __resetNetArchive(new IDBFactory());
    expect(getNetArchiveOn()).toBe(true);
  });
});

describe("useNetArchive", () => {
  const input = (over: Partial<Parameters<typeof useNetArchive>[0]> = {}) => ({ series: "position" as const, symbol: "BTCUSDT" as string | null, live: live(0, 5), stepMs: H as number | null, ...over });

  it("stores the live points on the hour grid and hands them back on the next visit", async () => {
    const first = renderHook((p) => useNetArchive(p), { initialProps: input({ live: live(0, 6) }) });
    await waitFor(() => expect(first.result.current.rows).toHaveLength(6));
    expect(first.result.current.status).toBe("ready");
    expect(first.result.current.recording).toBe(true);
    first.unmount();
    // the next visit: no live points yet (loading) – what was stored is there
    const second = renderHook((p) => useNetArchive(p), { initialProps: input({ live: [] }) });
    await waitFor(() => expect(second.result.current.rows).toHaveLength(6));
    expect(second.result.current.rows.map((r) => r.t)).toEqual(live(0, 6).map((p) => p.t));
    expect(second.result.current.rows[0]).toMatchObject({ long: 55, price: 70_000, s: H });
  });

  it("a quarter-hour period stores only the points on the hour", async () => {
    const quarter = live(0, 12, 55, 15 * 60_000);
    const r = renderHook((p) => useNetArchive(p), { initialProps: input({ live: quarter, stepMs: 15 * 60_000 }) });
    await waitFor(() => expect(r.result.current.rows).toHaveLength(3));
    expect(r.result.current.rows.every((x) => x.t % H === 0 && x.s === H)).toBe(true);
  });

  it("a new point is added to what is stored; the rows of the other series are not touched", async () => {
    const r = renderHook((p) => useNetArchive(p), { initialProps: input({ live: live(0, 4) }) });
    await waitFor(() => expect(r.result.current.rows).toHaveLength(4));
    r.rerender(input({ live: live(0, 5) }));
    await waitFor(() => expect(r.result.current.rows).toHaveLength(5));
    r.rerender(input({ series: "account", live: live(0, 3, 60) }));
    await waitFor(() => expect(r.result.current.rows).toHaveLength(3));
    expect(r.result.current.rows.every((x) => x.long === 60)).toBe(true);
    r.rerender(input({ series: "position", live: [] }));
    await waitFor(() => expect(r.result.current.rows).toHaveLength(5));
  });

  it("with the switch off nothing new is stored, but what is there is still read", async () => {
    const a = renderHook((p) => useNetArchive(p), { initialProps: input({ live: live(0, 4) }) });
    await waitFor(() => expect(a.result.current.rows).toHaveLength(4));
    a.unmount();
    act(() => setNetArchiveOn(false));
    const b = renderHook((p) => useNetArchive(p), { initialProps: input({ live: live(10, 4) }) });
    await waitFor(() => expect(b.result.current.status).toBe("ready"));
    expect(b.result.current.recording).toBe(false);
    expect(b.result.current.rows).toHaveLength(4);
    expect(b.result.current.rows.every((x) => x.t < T0 + 10 * H)).toBe(true);
  });

  it("drops what is older than 180 days when it stores", async () => {
    const factory = new IDBFactory();
    __resetNetArchive(factory);
    const db = await openNetArchive(factory);
    const stale = T0 + 2 * H - ARCHIVE_KEEP_MS - 5 * H;
    await db.put("position", "BTCUSDT", [{ t: stale - (stale % H), long: 60, price: null, s: H }]);
    const r = renderHook((p) => useNetArchive(p), { initialProps: input({ live: live(0, 3) }) });
    await waitFor(() => expect(r.result.current.rows).toHaveLength(3));
    await waitFor(async () => expect(await db.read("position", "BTCUSDT")).toHaveLength(3));
    db.close();
  });

  it("clear removes everything the card stored and the hook starts storing again", async () => {
    const r = renderHook((p) => useNetArchive(p), { initialProps: input({ live: live(0, 4) }) });
    await waitFor(() => expect(r.result.current.rows).toHaveLength(4));
    await act(async () => {
      await r.result.current.clear();
    });
    // the live series is still there: it is stored again right away (the switch is on) – the old rows are not
    await waitFor(() => expect(r.result.current.rows).toHaveLength(4));
    r.unmount();
    act(() => setNetArchiveOn(false));
    const again = renderHook((p) => useNetArchive(p), { initialProps: input({ live: live(0, 4) }) });
    await waitFor(() => expect(again.result.current.status).toBe("ready"));
    await act(async () => {
      await again.result.current.clear();
    });
    await waitFor(() => expect(again.result.current.rows).toHaveLength(0));
  });

  it("without IndexedDB the status says so and nothing breaks", async () => {
    __resetNetArchive(null);
    const r = renderHook((p) => useNetArchive(p), { initialProps: input() });
    await waitFor(() => expect(r.result.current.status).toBe("unavailable"));
    expect(r.result.current.rows).toEqual([]);
    await act(async () => {
      await r.result.current.clear();
    });
    expect(r.result.current.status).toBe("unavailable");
  });

  it("does nothing without a symbol", async () => {
    const r = renderHook((p) => useNetArchive(p), { initialProps: input({ symbol: null }) });
    await act(async () => {
      await Promise.resolve();
    });
    expect(r.result.current.rows).toEqual([]);
  });
});
