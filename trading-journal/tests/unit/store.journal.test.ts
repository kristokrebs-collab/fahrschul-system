import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootJournal, getAccountView, getEnriched, MODE_LABELS, resetJournal, useJournal } from "@/store/journalStore";
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
      doc: () => ({
        set: async () => {},
        delete: async () => {},
        onSnapshot: (next: (s: unknown) => void) => {
          listeners.settings = next;
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
