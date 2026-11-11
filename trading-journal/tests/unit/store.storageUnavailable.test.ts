/**
 * No usable localStorage (Android `content://` file opens, sandboxed frames, blocked site data): the journal runs on
 * a session-only store, reports `storage: "unavailable"` and the banner offers backup import/export.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const original = Object.getOwnPropertyDescriptor(window, "localStorage");

function stubLocalStorage(get: () => Storage) {
  Object.defineProperty(window, "localStorage", { configurable: true, get });
}

afterEach(() => {
  if (original) Object.defineProperty(window, "localStorage", original);
  else delete (window as unknown as { localStorage?: unknown }).localStorage;
  vi.resetModules();
});

function quotaStorage(length: number): Storage {
  const err = Object.assign(new Error("full"), { name: "QuotaExceededError" });
  return {
    length,
    clear() {},
    getItem: () => null,
    key: () => null,
    removeItem() {},
    setItem() {
      throw err;
    },
  };
}

describe("storage availability", () => {
  it("SecurityError on access → unavailable; the journal still boots and saves for the session", async () => {
    stubLocalStorage(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.resetModules();
    const { storageStatus, writeJson, readJson } = await import("@/store/storage");
    const { bootJournal, useJournal, modeLabelFor, UNSAVED_LABEL } = await import("@/store/journalStore");
    expect(storageStatus()).toBe("unavailable");
    expect(writeJson("tj2-x", { a: 1 })).toBe(true); // session store
    expect(readJson("tj2-x", null)).toEqual({ a: 1 });

    await bootJournal({ autoBackup: false });
    const s = useJournal.getState();
    expect(s.mode).toBe("local");
    expect(s.storage).toBe("unavailable");
    expect(modeLabelFor(s.mode, s.storage)).toBe(UNSAVED_LABEL);
    await s.saveTrade({ id: "t_session", side: "long", status: "open", date: "2026-10-07T10:00", pair: "BTC/USDT", timeframe: "1h", entry: 1, stop: null, target: null, exit: null, size: null, leverage: null, fees: null, pnlManual: null, setups: [], checks: {}, conviction: null, followedPlan: null, emotion: "", reason: "", notes: "", chart: "", pnl: null, r: null, createdAt: "", updatedAt: "" });
    expect(useJournal.getState().trades.map((t) => t.id)).toEqual(["t_session"]);
  });

  it("a quota error on an EMPTY store counts as unavailable (private mode), on a store with data as full", async () => {
    stubLocalStorage(() => quotaStorage(0));
    vi.resetModules();
    expect((await import("@/store/storage")).storageStatus()).toBe("unavailable");

    stubLocalStorage(() => quotaStorage(3));
    vi.resetModules();
    const full = await import("@/store/storage");
    expect(full.storageStatus()).toBe("ok");
    expect(full.writeJson("tj2-x", 1)).toBe(false); // writes fail loudly instead of silently going to memory
  });

  it("a normal localStorage is ok", async () => {
    vi.resetModules();
    const { storageStatus } = await import("@/store/storage");
    expect(storageStatus()).toBe("ok");
    expect(localStorage.getItem("tj2-probe")).toBeNull(); // the probe cleans up
  });
});
