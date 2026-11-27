/**
 * P09 store seam: `switchAdapter` (sync adapter after login, local after sign-out, never over the claude.ai adapter)
 * and the boot hint (a stored login keeps "Verbinde …" instead of flashing the local banner, then settles local).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCloudEnabledForTests } from "@/cloud/env";
import { normalizeSettings } from "@/domain/normalize";
import type { AdapterEvent, StorageAdapter } from "@/store/adapters/StoreApi";
import { createLocalAdapter } from "@/store/adapters/localAdapter";
import { bootJournal, CLOUD_HANDOFF_MS, resetJournal, switchAdapter, useJournal } from "@/store/journalStore";
import { KEYS } from "@/store/storage";
import { mkTrade } from "./domain.fixtures";

function fakeAdapter(mode: "local" | "cloud" = "cloud") {
  let listener: ((e: AdapterEvent) => void) | null = null;
  const disposed = { value: false };
  const snap = { trades: [mkTrade({ id: "t_cloud", date: "2026-10-01T10:00" })], settings: normalizeSettings(null), hyblock: [], days: {} };
  const adapter: StorageAdapter = {
    mode,
    load: () => snap,
    fresh: () => snap,
    api: { saveTrade: async () => undefined, deleteTrade: async () => undefined, saveSettings: async () => undefined, saveHyblock: async () => undefined, deleteHyblock: async () => undefined, saveDay: async () => undefined, deleteDay: async () => undefined },
    subscribe(l) {
      listener = l;
      return () => (listener = null);
    },
    replaceAll: async () => undefined,
    dispose: () => void (disposed.value = true),
  };
  return { adapter, emit: (e: AdapterEvent) => listener?.(e), disposed };
}

beforeEach(() => {
  localStorage.clear();
  resetJournal();
});
afterEach(() => {
  setCloudEnabledForTests(null);
  vi.useRealTimers();
  delete (window as unknown as { claude?: unknown }).claude;
  resetJournal();
});

describe("switchAdapter", () => {
  it("takes over state and API; status events drive the mode; a local adapter brings back local mode", async () => {
    await bootJournal({ autoBackup: false });
    expect(useJournal.getState().mode).toBe("local");
    const f = fakeAdapter();
    expect(await switchAdapter(f.adapter)).toBe(true);
    expect(useJournal.getState()).toMatchObject({ mode: "connecting", loaded: true });
    expect(useJournal.getState().trades.map((t) => t.id)).toEqual(["t_cloud"]);
    expect(useJournal.getState().api).toBe(f.adapter.api);
    f.emit({ type: "status", mode: "cloud" });
    expect(useJournal.getState().mode).toBe("cloud");
    f.emit({ type: "error", error: new Error("offline") });
    expect(useJournal.getState().mode).toBe("error");
    f.emit({ type: "patch", patch: { trades: [] } });
    expect(useJournal.getState().trades).toEqual([]);
    await switchAdapter(createLocalAdapter(), { mode: "local" });
    expect(f.disposed.value).toBe(true);
    expect(useJournal.getState().mode).toBe("local");
  });

  it("never replaces the claude.ai adapter", async () => {
    const db = {
      collection: () => ({ doc: () => ({ set: async () => undefined, delete: async () => undefined, onSnapshot: () => () => undefined }), add: async () => undefined, onSnapshot: () => () => undefined }),
      doc: () => ({ set: async () => undefined, delete: async () => undefined, onSnapshot: () => () => undefined }),
    };
    (window as unknown as { claude: unknown }).claude = { use: async () => db };
    await bootJournal({ autoBackup: false });
    expect(useJournal.getState().mode).toBe("cloud");
    const f = fakeAdapter();
    expect(await switchAdapter(f.adapter)).toBe(false);
    expect(f.disposed.value).toBe(true);
    expect(useJournal.getState().trades.map((t) => t.id)).not.toContain("t_cloud");
  });
});

describe("boot with a stored cloud login", () => {
  it("keeps 'connecting' (data already there), settles local when no sync takes over", async () => {
    vi.useFakeTimers();
    setCloudEnabledForTests(true);
    localStorage.setItem(KEYS.cloudAuth, "{}");
    localStorage.setItem(KEYS.trades, JSON.stringify([mkTrade({ id: "t_local", date: "2026-10-01T10:00" })]));
    await bootJournal({ autoBackup: false });
    expect(useJournal.getState()).toMatchObject({ mode: "connecting", loaded: true });
    expect(useJournal.getState().trades.map((t) => t.id)).toEqual(["t_local"]);
    vi.advanceTimersByTime(CLOUD_HANDOFF_MS + 10);
    expect(useJournal.getState().mode).toBe("local");
  });

  it("without cloud config the boot is unchanged (local at once)", async () => {
    localStorage.setItem(KEYS.cloudAuth, "{}");
    await bootJournal({ autoBackup: false });
    expect(useJournal.getState().mode).toBe("local");
  });
});
