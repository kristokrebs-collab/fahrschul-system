import { beforeEach, describe, expect, it } from "vitest";
import { createLocalAdapter, readLocalSnapshot } from "@/store/adapters/localAdapter";
import { createClaudeDbAdapter, probeClaudeDb, type ClaudeDb } from "@/store/adapters/claudeDbAdapter";
import type { AdapterEvent } from "@/store/adapters/StoreApi";
import { loadV0File, seedV0 } from "./store.fixture";
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
  return { db, cols, get settings() { return settingsDoc; } };
}

describe("claudeDbAdapter", () => {
  it("probe is a no-op without window.claude", async () => {
    delete (window as unknown as { claude?: unknown }).claude;
    await expect(probeClaudeDb()).resolves.toBeNull();
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
