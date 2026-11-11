import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bootJournal, getAccountView, getEnriched, MODE_LABELS, PROBE_TIMEOUT_MS, resetJournal, saveTradeNow, useJournal } from "@/store/journalStore";
import { readMeta } from "@/store/migrate";
import { useUi } from "@/store/uiStore";
import { BROKEN_TRADE, loadV0Fixture, seedV0 } from "./store.fixture";

const setClaude = (v: unknown) => {
  (window as unknown as { claude?: unknown }).claude = v;
};

describe("bootJournal", () => {
  beforeEach(() => {
    resetJournal();
    useUi.setState({ toasts: [] });
    seedV0();
  });
  afterEach(() => {
    delete (window as unknown as { claude?: unknown }).claude;
    resetJournal();
  });

  it("Fall A: hydrates synchronously, local + loaded in the first microtask, toasts quarantine", async () => {
    const fx = loadV0Fixture();
    fx["tj2-trades"].push(BROKEN_TRADE);
    seedV0(fx);
    const p = bootJournal({ autoBackup: false });
    const s = useJournal.getState();
    expect(s.trades).toHaveLength(2);
    expect(s.mode).toBe("connecting");
    expect(s.loaded).toBe(false);
    expect(s.quarantined).toBe(1);
    expect(useUi.getState().toasts[0]?.title).toBe("1 Einträge konnten nicht gelesen werden");
    await p;
    expect(useJournal.getState().mode).toBe("local");
    expect(useJournal.getState().loaded).toBe(true);
    expect(MODE_LABELS.local.text).toBe("Nur dieser Browser");

    await useJournal.getState().saveTrade({ ...s.trades[0]!, notes: "z" });
    expect(useJournal.getState().trades.at(-1)?.notes).toBe("z");
    expect(JSON.parse(localStorage.getItem("tj2-trades")!).at(-1).notes).toBe("z");
    expect(bootJournal()).toBe(p); // idempotent
  });

  it("saveTradeNow: a local save is persisted and shown when the call returns; a failing write reports nothing persisted", async () => {
    await bootJournal({ autoBackup: false });
    const first = useJournal.getState().trades[0]!;
    const ok = saveTradeNow({ ...first, notes: "sofort" });
    expect(ok.persisted).toBe(true);
    // synchronously: the store and localStorage already hold it
    expect(useJournal.getState().trades.find((t) => t.id === first.id)?.notes).toBe("sofort");
    expect(JSON.parse(localStorage.getItem("tj2-trades")!).find((t: { id: string }) => t.id === first.id).notes).toBe("sofort");
    await ok.done;

    const before = useJournal.getState().trades;
    const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    try {
      const failed = saveTradeNow({ ...first, notes: "voll" });
      expect(failed.persisted).toBe(false);
      expect(useJournal.getState().trades).toBe(before);
      await expect(failed.done).rejects.toThrow();
    } finally {
      quota.mockRestore();
    }
  });

  it("Fall B with use('db') → null: stays connecting until resolved, then local", async () => {
    let resolve!: (v: unknown) => void;
    setClaude({ use: () => new Promise((r) => (resolve = r)) });
    const p = bootJournal({ autoBackup: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(useJournal.getState().mode).toBe("connecting");
    expect(useJournal.getState().loaded).toBe(false);
    resolve(null);
    await p;
    expect(useJournal.getState().mode).toBe("local");
    expect(useJournal.getState().loaded).toBe(true);
  });

  it("finding 9: a probe that never settles falls back to local after PROBE_TIMEOUT_MS", async () => {
    vi.useFakeTimers();
    try {
      setClaude({ use: () => new Promise(() => {}) });
      const p = bootJournal({ autoBackup: false });
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
      expect(useJournal.getState().mode).toBe("connecting");
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(useJournal.getState().mode).toBe("local");
      expect(useJournal.getState().loaded).toBe(true);
      expect(PROBE_TIMEOUT_MS).toBe(8000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finding 12: an aborted migration toasts and keeps schemaVersion 0", async () => {
    const original = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith("tj2-backup-")) throw new Error("blocked");
      original.call(this, k, v);
    });
    try {
      await bootJournal({ autoBackup: false });
      expect(readMeta().schemaVersion).toBe(0);
      expect(useUi.getState().toasts[0]).toMatchObject({ kind: "error", title: "Snapshot konnte nicht angelegt werden" });
      expect(useJournal.getState().trades).toHaveLength(2); // still readable
    } finally {
      spy.mockRestore();
    }
  });

  it("Fall B with a db handle: cloud snapshot REPLACES local state, loaded after trades AND settings", async () => {
    const listeners: Record<string, (s: unknown) => void> = {};
    const db = {
      collection: (name: string) => ({
        onSnapshot: (next: (s: unknown) => void) => {
          listeners[name] = next;
          return () => {};
        },
        doc: () => ({ set: async () => {}, delete: async () => {}, onSnapshot: () => () => {} }),
        add: async () => {},
      }),
      doc: (path: string) => ({
        set: async () => {},
        delete: async () => {},
        onSnapshot: (next: (s: unknown) => void) => {
          listeners[path === "config/settings" ? "settings" : path] = next; // also `config/days` (day journal)
          return () => {};
        },
      }),
    };
    setClaude({ use: async (n: string) => (n === "db" ? db : null) });
    await bootJournal({ autoBackup: false });
    expect(useJournal.getState().mode).toBe("cloud");
    expect(useJournal.getState().loaded).toBe(false);
    expect(useJournal.getState().trades).toEqual([]); // local data not shown in cloud mode

    listeners.trades!({ docs: [{ id: "cloud1", data: () => ({ ...loadV0Fixture()["tj2-trades"][0] as object, id: undefined }) }] });
    expect(useJournal.getState().trades[0]?.id).toBe("cloud1");
    expect(useJournal.getState().loaded).toBe(false);
    listeners.settings!({ exists: true, data: () => ({ currency: "EUR" }) });
    expect(useJournal.getState().settings.currency).toBe("EUR");
    expect(useJournal.getState().loaded).toBe(true);
    expect(useJournal.getState().mode).toBe("cloud");
    expect(MODE_LABELS.cloud.text).toBe("Synchronisiert");
  });
});

describe("memoised selectors", () => {
  it("getEnriched / getAccountView reuse results for identical inputs", async () => {
    resetJournal();
    seedV0();
    await bootJournal({ autoBackup: false });
    const { trades, settings } = useJournal.getState();
    const a = getEnriched(trades, settings);
    expect(a).toBe(getEnriched(trades, settings));
    expect(a).not.toBe(getEnriched([...trades], settings));
    const v = getAccountView(a, settings, "scalp");
    expect(v).toBe(getAccountView(a, settings, "scalp"));
    expect(v).not.toBe(getAccountView(a, settings, "all"));
    expect(v.start).toBe(5000);
    resetJournal();
  });
});
