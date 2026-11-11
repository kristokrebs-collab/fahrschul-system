import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalAdapter, readLocalSnapshot } from "@/store/adapters/localAdapter";
import { readQuarantine } from "@/store/migrate";
import { StorageWriteError } from "@/store/storage";
import { createClaudeDbAdapter, probeClaudeDb, type ClaudeDb } from "@/store/adapters/claudeDbAdapter";
import type { AdapterEvent } from "@/store/adapters/StoreApi";
import { loadV0File, loadV0Fixture, seedV0 } from "./store.fixture";
import { validateReadings, validateTrades } from "@/store/migrate";

describe("localAdapter", () => {
  beforeEach(() => seedV0());

  it("round-trips the legacy fixture (normalised on read, settings defaults filled, readings sorted)", () => {
    const snap = readLocalSnapshot();
    expect(snap.trades).toHaveLength(2);
    expect(snap.trades[0]?.id).toBe("t_abc1234x9z1");
    expect((snap.trades[0] as unknown as { legacyExtra?: string }).legacyExtra).toBe("keep-me");
    expect(snap.settings.capital.makro).toBe(20000); // string → number
    expect(snap.settings.setups[0]?.account).toBe("both"); // defaulted by normaliser
    expect(snap.settings.market.longTrigger).toBe(85900); // defaults merged
    expect((snap.settings as unknown as { customFlag?: boolean }).customFlag).toBe(true);
    expect(snap.hyblock.map((r) => r.id)).toEqual(["h_1", "h_2"]); // at.localeCompare
  });

  it("upserts with filter(id≠).concat and assigns t_ ids; settings replaced whole", async () => {
    const adapter = createLocalAdapter();
    const snap = adapter.load();
    const events: AdapterEvent[] = [];
    adapter.subscribe((e) => events.push(e));

    const first = snap.trades[0]!;
    await adapter.api.saveTrade({ ...first, notes: "edited" });
    let stored = JSON.parse(localStorage.getItem("tj2-trades")!) as Array<{ id: string; notes: string }>;
    expect(stored).toHaveLength(2);
    expect(stored[1]?.id).toBe(first.id); // moved to the end (concat)
    expect(stored[1]?.notes).toBe("edited");

    const { id: _drop, ...noId } = first;
    void _drop;
    await adapter.api.saveTrade({ ...noId, notes: "new" });
    stored = JSON.parse(localStorage.getItem("tj2-trades")!);
    expect(stored).toHaveLength(3);
    expect(stored[2]?.id).toMatch(/^t_[0-9a-z]{11}$/);

    await adapter.api.deleteTrade(first.id);
    stored = JSON.parse(localStorage.getItem("tj2-trades")!);
    expect(stored.map((t) => t.id)).not.toContain(first.id);

    const settings = { ...snap.settings, currency: "EUR" };
    await adapter.api.saveSettings(settings);
    expect(JSON.parse(localStorage.getItem("tj2-settings")!)).toEqual(settings); // verbatim

    await adapter.api.saveHyblock({ at: "2026-03-01T00:00", longPct: 1, delta: 0, deltaCandles: 0, structure: false, rsi: false, note: "" });
    const hy = adapter.load().hyblock;
    expect(hy[0]?.at).toBe("2026-03-01T00:00");
    expect(hy[0]?.id).toMatch(/^h_/);
    expect(events.filter((e) => e.type === "patch")).toHaveLength(5);
  });

  it("round-trips the full legacy fixture tests/fixtures/tj2-v0.json without quarantine", () => {
    const fx = seedV0(loadV0File());
    const snap = readLocalSnapshot();
    expect(snap.trades).toHaveLength(fx["tj2-trades"].length);
    expect(snap.hyblock).toHaveLength(fx["tj2-hyblock"].length);
    expect(snap.settings.capital.makro).toBe(20000);
    expect(validateTrades(fx["tj2-trades"]).invalid).toEqual([]);
    expect(validateReadings(fx["tj2-hyblock"]).invalid).toEqual([]);
    for (let i = 1; i < snap.hyblock.length; i++) {
      expect(snap.hyblock[i - 1]!.at.localeCompare(snap.hyblock[i]!.at)).toBeLessThanOrEqual(0);
    }
    // write path is verbatim: saving the first trade back leaves the stored record identical (moved to the end)
    const adapter = createLocalAdapter();
    const first = adapter.load().trades[0]!;
    void adapter.api.saveTrade(first);
    const stored = JSON.parse(localStorage.getItem("tj2-trades")!) as Array<{ id: string }>;
    expect(stored.at(-1)).toEqual(first);
  });

  describe("finding 3: unparseable key", () => {
    afterEach(() => vi.restoreAllMocks());

    it("is quarantined on read and the raw string survives the first save", async () => {
      localStorage.setItem("tj2-trades", "{not json");
      const adapter = createLocalAdapter();
      const snap = adapter.load();
      expect(snap.trades).toEqual([]);
      expect(readQuarantine()).toHaveLength(1);
      expect(readQuarantine()[0]).toMatchObject({ kind: "blob", key: "tj2-trades", raw: "{not json" });
      await adapter.api.saveTrade(loadV0Fixture()["tj2-trades"][0] as never);
      expect(JSON.parse(localStorage.getItem("tj2-trades")!)).toHaveLength(1);
      expect(readQuarantine()).toHaveLength(1); // no duplicate, raw still preserved
      adapter.load();
      expect(readQuarantine()).toHaveLength(1);
    });

    it("refuses to overwrite the key while the raw string cannot be quarantined", async () => {
      localStorage.setItem("tj2-trades", "{not json");
      const original = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
        if (k === "tj2-quarantine") throw new Error("blocked");
        original.call(this, k, v);
      });
      const adapter = createLocalAdapter();
      expect(adapter.load().trades).toEqual([]);
      await expect(adapter.api.saveTrade(loadV0Fixture()["tj2-trades"][0] as never)).rejects.toBeInstanceOf(StorageWriteError);
      expect(localStorage.getItem("tj2-trades")).toBe("{not json");
      expect(adapter.load().trades).toEqual([]);
    });
  });

  describe("finding 5: replaceAll is atomic", () => {
    afterEach(() => vi.restoreAllMocks());

    it("rolls already written keys back when a later key fails and leaves memory untouched", async () => {
      const adapter = createLocalAdapter();
      const before = adapter.load();
      const rawTrades = localStorage.getItem("tj2-trades");
      const rawSettings = localStorage.getItem("tj2-settings");
      const rawHyblock = localStorage.getItem("tj2-hyblock");
      const events: AdapterEvent[] = [];
      adapter.subscribe((e) => events.push(e));
      const original = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
        if (k === "tj2-hyblock") throw new Error("QuotaExceededError");
        original.call(this, k, v);
      });
      await expect(adapter.replaceAll({ trades: [], settings: { ...before.settings, currency: "EUR" }, hyblock: [] })).rejects.toBeInstanceOf(StorageWriteError);
      expect(localStorage.getItem("tj2-trades")).toBe(rawTrades);
      expect(localStorage.getItem("tj2-settings")).toBe(rawSettings);
      expect(localStorage.getItem("tj2-hyblock")).toBe(rawHyblock);
      expect(adapter.load()).toEqual(before);
      expect(events).toEqual([]);
    });
  });

  it("survives blocked storage on read", () => {
    localStorage.setItem("tj2-trades", "{not json");
    localStorage.setItem("tj2-settings", "[]");
    const snap = readLocalSnapshot();
    expect(snap.trades).toEqual([]);
    expect(snap.settings.currency).toBe("USDT");
  });
});

/* ---- fake claude db ---- */
type Listener<T> = (snap: T) => void;
function fakeDb() {
  const cols: Record<string, Map<string, Record<string, unknown>>> = { trades: new Map(), hyblock: new Map() };
  const colListeners: Record<string, Set<Listener<{ docs: { id: string; data(): unknown }[] }>>> = { trades: new Set(), hyblock: new Set() };
  let settingsDoc: Record<string, unknown> | null = null;
  const docListeners = new Set<Listener<{ exists: boolean; data(): unknown }>>();
  const emitCol = (name: string) => {
    const docs = [...cols[name]!.entries()].map(([id, data]) => ({ id, data: () => data }));
    for (const l of colListeners[name]!) l({ docs });
  };
  const emitDoc = () => {
    for (const l of docListeners) l({ exists: settingsDoc !== null, data: () => settingsDoc });
  };
  let seq = 0;
  const db: ClaudeDb = {
    collection(name) {
      return {
        doc(id) {
          return {
            async set(v) {
              cols[name]!.set(id, v as Record<string, unknown>);
              emitCol(name);
            },
            async delete() {
              cols[name]!.delete(id);
              emitCol(name);
            },
            onSnapshot() {
              return () => {};
            },
          };
        },
        async add(v) {
          cols[name]!.set(`doc${++seq}`, v as Record<string, unknown>);
          emitCol(name);
        },
        onSnapshot(next) {
          colListeners[name]!.add(next);
          queueMicrotask(() => emitCol(name));
          return () => colListeners[name]!.delete(next);
        },
      };
    },
    doc() {
      return {
        async set(v) {
          settingsDoc = v as Record<string, unknown>;
          emitDoc();
        },
        async delete() {
          settingsDoc = null;
          emitDoc();
        },
        onSnapshot(next) {
          docListeners.add(next);
          queueMicrotask(emitDoc);
          return () => docListeners.delete(next);
        },
      };
    },
  };
  return { db, raw: { ...db }, cols, get settings() { return settingsDoc; } };
}

describe("claudeDbAdapter", () => {
  it("probe is a no-op without window.claude", async () => {
    delete (window as unknown as { claude?: unknown }).claude;
    await expect(probeClaudeDb()).resolves.toBeNull();
  });

  it("finding 4: replaceAll upserts first and deletes leftovers last; a rejected upsert deletes nothing", async () => {
    const f = fakeDb();
    const adapter = createClaudeDbAdapter(f.db);
    adapter.subscribe(() => {});
    const base = loadV0Fixture()["tj2-trades"][0] as Record<string, unknown>;
    await adapter.api.saveTrade({ ...base, id: "old" } as never);
    await adapter.api.saveHyblock({ id: "h_old", at: "2026-01-01T00:00", longPct: 50, delta: 0, deltaCandles: 0, structure: false, rsi: false, note: "" });
    await new Promise((r) => setTimeout(r, 0));
    expect(adapter.load().trades.map((t) => t.id)).toEqual(["old"]);

    const order: string[] = [];
    const settings = adapter.load().settings;
    const spySet = vi.spyOn(f.db, "collection");
    spySet.mockImplementation((name) => {
      const col = f.raw.collection(name);
      return {
        ...col,
        doc(id) {
          const d = col.doc(id);
          return {
            ...d,
            async set(v) {
              order.push(`set:${name}/${id}`);
              if (id === "boom") throw new Error("rejected");
              await d.set(v);
            },
            async delete() {
              order.push(`delete:${name}/${id}`);
              await d.delete();
            },
          };
        },
      };
    });

    // rejected upsert → abort, nothing deleted
    await expect(adapter.replaceAll({ trades: [{ ...base, id: "boom" } as never], settings, hyblock: [] })).rejects.toThrow("rejected");
    expect(order.some((o) => o.startsWith("delete:"))).toBe(false);
    expect(f.cols.trades!.has("old")).toBe(true);
    expect(f.cols.hyblock!.has("h_old")).toBe(true);

    // success → upserts strictly before deletes
    order.length = 0;
    await adapter.replaceAll({ trades: [{ ...base, id: "new" } as never], settings, hyblock: [] });
    const firstDelete = order.findIndex((o) => o.startsWith("delete:"));
    const lastSet = order.map((o) => o.startsWith("set:")).lastIndexOf(true);
    expect(firstDelete).toBeGreaterThan(lastSet);
    expect(order).toContain("delete:trades/old");
    expect(order).toContain("delete:hyblock/h_old");
    expect([...f.cols.trades!.keys()]).toEqual(["new"]);
    adapter.dispose();
  });

  it("finding 16: invalid cloud documents are recorded in tj2-quarantine as kind cloud", async () => {
    localStorage.clear();
    const f = fakeDb();
    f.cols.trades!.set("", { side: "long" }); // empty doc id → no id after normalising
    f.cols.trades!.set("good", { ...(loadV0Fixture()["tj2-trades"][1] as Record<string, unknown>), id: undefined });
    const adapter = createClaudeDbAdapter(f.db);
    const events: AdapterEvent[] = [];
    adapter.subscribe((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 0));
    expect(events.some((e) => e.type === "quarantine" && e.count === 1)).toBe(true);
    expect(adapter.load().trades.map((t) => t.id)).toEqual(["good"]);
    const q = readQuarantine();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "cloud", collection: "trades", id: "", raw: { id: "", side: "long" } });
    // snapshot re-fires → no duplicate
    f.cols.trades!.set("good", { ...(f.cols.trades!.get("good") as object), notes: "x" });
    await new Promise((r) => setTimeout(r, 0));
    expect(readQuarantine()).toHaveLength(1);
    adapter.dispose();
  });

  it("strips id on save, uses set/add, and normalises snapshots", async () => {
    const f = fakeDb();
    const adapter = createClaudeDbAdapter(f.db);
    const events: AdapterEvent[] = [];
    adapter.subscribe((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 0));
    expect(events.some((e) => e.type === "patch" && e.patch.settings)).toBe(true); // empty doc → defaults
    expect(adapter.load().settings.currency).toBe("USDT");

    const base = {
      side: "long" as const, status: "closed" as const, date: "2026-03-02T10:15", pair: "BTC/USDT", timeframe: "", entry: 100, stop: 90,
      target: 120, exit: 110, size: 100, leverage: null, fees: 0, pnlManual: null, setups: [], checks: {}, conviction: null,
      followedPlan: null, emotion: "", reason: "", notes: "", chart: "", pnl: null, r: null, createdAt: "", updatedAt: "",
    };
    await adapter.api.saveTrade(base);
    expect([...f.cols.trades!.keys()]).toEqual(["doc1"]);
    expect(f.cols.trades!.get("doc1")).not.toHaveProperty("id");
    await adapter.api.saveTrade({ ...base, id: "doc1", notes: "x" });
    expect(f.cols.trades!.get("doc1")?.notes).toBe("x");
    expect(adapter.load().trades[0]?.id).toBe("doc1");
    expect(adapter.load().trades[0]?.pnl).toBe(10); // recomputed on read
    await adapter.api.deleteTrade("doc1");
    expect(adapter.load().trades).toEqual([]);
    adapter.dispose();
  });
});
