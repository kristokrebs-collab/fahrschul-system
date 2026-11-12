/**
 * Two tabs (or the other journal version) on the same localStorage: every write is read-modify-write, settings are
 * three-way merged, and `storage` events keep the other tab current (dual-build.md 6.4 – the stale tab used to
 * overwrite the other tab's writes).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalAdapter } from "@/store/adapters/localAdapter";
import type { AdapterEvent, StorageAdapter } from "@/store/adapters/StoreApi";
import { merge3 } from "@/store/merge3";
import type { Settings } from "@/domain/types";
import { seedV0 } from "./store.fixture";

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

function tab(): { adapter: StorageAdapter; events: AdapterEvent[]; off: () => void } {
  const adapter = createLocalAdapter();
  adapter.load();
  const events: AdapterEvent[] = [];
  const off = adapter.subscribe((e) => events.push(e));
  return { adapter, events, off };
}

/** What the browser does in the OTHER tabs after `key` was written. */
function fireStorage(key: string | null) {
  window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage }));
}

describe("two tabs on one storage", () => {
  let a: ReturnType<typeof tab>;
  let b: ReturnType<typeof tab>;
  beforeEach(() => {
    seedV0();
    a = tab();
    b = tab();
  });
  afterEach(() => {
    a.adapter.dispose();
    b.adapter.dispose();
  });

  it("a trade saved in tab B survives a save of the stale tab A", async () => {
    const base = a.adapter.load().trades[0]!;
    await b.adapter.api.saveTrade({ ...base, id: "t_from_b", notes: "B" });
    await a.adapter.api.saveTrade({ ...base, id: "t_from_a", notes: "A" });
    const ids = (stored("tj2-trades") as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain("t_from_b");
    expect(ids).toContain("t_from_a");
  });

  it("deleting in tab A does not resurrect or drop tab B's trades", async () => {
    const [t0, t1] = a.adapter.load().trades;
    await b.adapter.api.saveTrade({ ...t0!, id: "t_new_b" });
    await a.adapter.api.deleteTrade(t1!.id);
    const ids = (stored("tj2-trades") as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toEqual([t0!.id, "t_new_b"]);
  });

  it("settings: tab B's new key and setup survive tab A's capital save (three-way merge)", async () => {
    const sb = b.adapter.load().settings;
    await b.adapter.api.saveSettings({
      ...sb,
      mistakes: [...sb.mistakes, "Neu in B"],
      signals: { ladder: ["30m", "1h"] },
      setups: [...sb.setups, { id: "s_b", name: "B-Setup", account: "both", color: "#fff", desc: "", checklist: [] }],
    } as Settings);
    // tab A still holds the pre-B settings (loaded in beforeEach, no storage event delivered) and saves the capital
    await a.adapter.api.saveSettings({ ...sb, capital: { makro: 1, scalp: 2 } });
    const s = stored("tj2-settings");
    expect(s.capital).toEqual({ makro: 1, scalp: 2 });
    expect(s.mistakes).toContain("Neu in B");
    expect(s.signals).toEqual({ ladder: ["30m", "1h"] });
    expect(s.setups.map((x: { id: string }) => x.id)).toContain("s_b");
  });

  it("settings: a setup deleted in tab A stays deleted, one edited in tab B keeps the edit", async () => {
    const sb = b.adapter.load().settings;
    const [first, second] = sb.setups;
    await b.adapter.api.saveSettings({ ...sb, setups: sb.setups.map((x) => (x.id === second!.id ? { ...x, name: "edited in B" } : x)) });
    const sa = sb; // A's memory: the same pre-B state
    await a.adapter.api.saveSettings({ ...sa, setups: sa.setups.filter((x) => x.id !== first!.id) });
    const ids = stored("tj2-settings").setups.map((x: { id: string; name: string }) => `${x.id}:${x.name}`);
    expect(ids).not.toContain(`${first!.id}:${first!.name}`);
    expect(ids).toContain(`${second!.id}:edited in B`);
  });

  it("readings and day notes are read-modify-write as well", async () => {
    await b.adapter.api.saveHyblock({ at: "2026-03-05T12:00", longPct: 50, delta: 0, deltaCandles: 0, structure: false, rsi: false, note: "B" });
    await a.adapter.api.saveHyblock({ at: "2026-03-06T12:00", longPct: 51, delta: 0, deltaCandles: 0, structure: false, rsi: false, note: "A" });
    expect((stored("tj2-hyblock") as Array<{ note: string }>).map((r) => r.note)).toEqual(expect.arrayContaining(["A", "B"]));
    await b.adapter.api.saveDay("2026-10-01", { note: "B" });
    await a.adapter.api.saveDay("2026-10-02", { note: "A" });
    expect(Object.keys(stored("tj2-days")).sort()).toEqual(["2026-10-01", "2026-10-02"]);
  });

  it("a `storage` event reloads the changed key and emits a patch (open tabs stay current)", async () => {
    const base = b.adapter.load().trades[0]!;
    await b.adapter.api.saveTrade({ ...base, id: "t_evt" });
    a.events.length = 0;
    fireStorage("tj2-trades");
    const patch = a.events.find((e) => e.type === "patch");
    expect(patch?.type === "patch" && patch.patch.trades?.map((t) => t.id)).toContain("t_evt");
    expect(patch?.type === "patch" && patch.patch.settings).toBeFalsy();

    a.events.length = 0;
    fireStorage("tj2-ui"); // not journal data
    expect(a.events).toEqual([]);
    fireStorage(null); // localStorage.clear() in another tab → reload everything
    const all = a.events.find((e) => e.type === "patch");
    expect(all?.type === "patch" && Object.keys(all.patch).sort()).toEqual(["days", "hyblock", "settings", "trades"]);
  });

  it("dispose removes the storage listener", () => {
    a.adapter.dispose();
    a.events.length = 0;
    fireStorage("tj2-trades");
    expect(a.events).toEqual([]);
  });
});

describe("merge3", () => {
  it("one side unchanged → the other side wins", () => {
    expect(merge3({ a: 1 }, { a: 1 }, { a: 2 })).toEqual({ a: 2 });
    expect(merge3({ a: 1 }, { a: 3 }, { a: 1 })).toEqual({ a: 3 });
  });
  it("both changed → per key; keys only one side has are kept; scalar conflict → mine", () => {
    expect(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 2, c: 3 })).toEqual({ a: 2, b: 2, c: 3 });
    expect(merge3({ a: 1 }, { a: 2, mine: true }, { a: 3 })).toEqual({ a: 2, mine: true });
    // the other version drops keys it does not know – they are not deleted here
    expect(merge3({ a: 1, ours: "x" }, { a: 2, ours: "x" }, { a: 1 })).toEqual({ a: 2, ours: "x" });
  });
  it("id lists: adds from both sides, deletes respected unless the other side edited the item", () => {
    const base = [{ id: "x", v: 1 }, { id: "y", v: 1 }, { id: "z", v: 1 }];
    const mine = [{ id: "x", v: 2 }, { id: "z", v: 1 }, { id: "m", v: 1 }]; // edit x, delete y, add m
    const theirs = [{ id: "x", v: 1 }, { id: "y", v: 1 }, { id: "z", v: 5 }, { id: "t", v: 1 }]; // edit z, add t
    expect(merge3(base, mine, theirs)).toEqual([{ id: "x", v: 2 }, { id: "z", v: 5 }, { id: "m", v: 1 }, { id: "t", v: 1 }]);
    // they deleted x while I edited it → my edit survives
    expect(merge3([{ id: "x", v: 1 }], [{ id: "x", v: 2 }], [])).toEqual([{ id: "x", v: 2 }]);
  });
  it("plain arrays: both changed → mine", () => {
    expect(merge3(["a"], ["a", "b"], ["a", "c"])).toEqual(["a", "b"]);
  });
});
