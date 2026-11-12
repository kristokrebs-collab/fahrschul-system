/**
 * The share edition ("zum Teilen": Netlify `/teilen/`, share file) runs in its own storage namespace `tj2share-*`:
 * on the same origin / browser it starts empty and never reads or writes the personal `tj2-*` journal.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/edition", () => ({
  EDITION: "share",
  BUILD_TARGET: "web",
  IS_SHARE: true,
  IS_FILE_BUILD: false,
  isFileProtocol: () => false,
}));

const { KEYS, KEY_PREFIX, storageKey, DATA_KEYS } = await import("@/store/storage");
const { bootJournal, resetJournal, useJournal } = await import("@/store/journalStore");
const { autoBackup } = await import("@/store/backup");
const { DEFAULT_SETTINGS, levelsConfigured } = await import("@/domain/defaults");
const { seedV0 } = await import("./store.fixture");

const personalKeys = () => Object.keys(localStorage).filter((k) => k.startsWith("tj2-")).sort();

describe("share edition storage namespace", () => {
  it("every key is tj2share-*", () => {
    expect(KEY_PREFIX).toBe("tj2share-");
    expect(storageKey("fill-setups")).toBe("tj2share-fill-setups");
    for (const k of [...Object.values(KEYS), ...DATA_KEYS]) expect(k.startsWith("tj2share-")).toBe(true);
  });

  it("boots empty next to a personal journal and never touches tj2-*", async () => {
    seedV0();
    localStorage.setItem("tj2-meta", JSON.stringify({ schemaVersion: 2 }));
    const before = Object.fromEntries(personalKeys().map((k) => [k, localStorage.getItem(k)]));

    resetJournal();
    await bootJournal({ autoBackup: false });
    const s = useJournal.getState();
    expect(s.trades).toEqual([]);
    expect(s.hyblock).toEqual([]);
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    expect(s.settings.setups.map((x) => x.id)).toEqual(["s_mtf", "s_bt"]);
    expect(levelsConfigured(s.settings)).toBe(false);

    await s.saveTrade({ ...(JSON.parse(before["tj2-trades"]!) as Array<Record<string, unknown>>)[0], id: "t_share" } as never);
    await s.saveSettings({ ...s.settings, currency: "EUR" });
    await s.saveDay("2026-10-07", { note: "share" });
    useJournal.getState().setMode("local");
    autoBackup(new Date("2026-10-07T12:00:00"));

    expect(JSON.parse(localStorage.getItem("tj2share-trades")!).map((t: { id: string }) => t.id)).toEqual(["t_share"]);
    expect(JSON.parse(localStorage.getItem("tj2share-settings")!).currency).toBe("EUR");
    expect(localStorage.getItem("tj2share-meta")).not.toBeNull();
    expect(Object.keys(localStorage).some((k) => k.startsWith("tj2share-backup-"))).toBe(true);
    // the personal journal is byte-identical, and no new tj2-* key appeared
    expect(Object.fromEntries(personalKeys().map((k) => [k, localStorage.getItem(k)]))).toEqual(before);
  });
});
