import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, readMeta, readQuarantine, validateTrades, quarantineToastTitle, MAX_MIGRATION_SNAPSHOTS } from "@/store/migrate";
import { BROKEN_TRADE, LEGACY_LOOSE_TRADE, loadV0Fixture, seedV0 } from "./store.fixture";

describe("migrate v0 → v1", () => {
  beforeEach(() => localStorage.clear());

  it("fresh install: writes meta only, no snapshot", () => {
    const r = migrate(new Date("2026-09-30T10:00:00Z"));
    expect(r).toMatchObject({ from: 0, to: 1, changed: true, quarantined: 0, snapshotTag: null });
    expect(readMeta().schemaVersion).toBe(1);
    expect(Object.keys(localStorage).filter((k) => k.startsWith("tj2-backup-"))).toEqual([]);
  });

  it("keeps unknown fields, recomputes pnl/r, snapshots before writing, quarantines broken records", () => {
    const fx = loadV0Fixture();
    fx["tj2-trades"].push(BROKEN_TRADE);
    seedV0(fx);
    const now = new Date("2026-09-30T10:00:00.000Z");
    const r = migrate(now);
    expect(r.quarantined).toBe(1);
    expect(r.snapshotTag).toBe("v0-2026-09-30T10:00:00.000Z");
    expect(quarantineToastTitle(r.quarantined)).toBe("1 Einträge konnten nicht gelesen werden");

    const snap = JSON.parse(localStorage.getItem("tj2-backup-v0-2026-09-30T10:00:00.000Z")!);
    expect(snap.trades).toHaveLength(3); // raw, including the broken one
    expect(snap.at).toBe(now.toISOString());

    const trades = JSON.parse(localStorage.getItem("tj2-trades")!) as Array<Record<string, unknown>>;
    expect(trades).toHaveLength(2);
    expect(trades[0]?.legacyExtra).toBe("keep-me");
    expect(trades[0]?.pnl).toBeCloseTo((86000 - 84000) * (1000 / 84000) - 1, 6);
    expect(trades[0]?.r).toBeCloseTo(((86000 - 84000) * (1000 / 84000) - 1) / (1000 * (1000 / 84000)), 6);
    expect(trades[1]).not.toHaveProperty("account"); // missing account stays missing

    const q = readQuarantine();
    expect(q).toHaveLength(1);
    expect(q[0]?.kind).toBe("trade");
    expect((q[0]?.raw as { marker: string }).marker).toBe("t_broken");
    expect(q[0]?.error).toMatch(/^id:/);

    const settings = JSON.parse(localStorage.getItem("tj2-settings")!);
    expect(settings.customFlag).toBe(true);
    expect(settings.capital.makro).toBe(20000);
    expect(readMeta()).toMatchObject({ schemaVersion: 1, migratedAt: now.toISOString() });

    // idempotent
    const again = migrate(new Date("2026-10-01T00:00:00Z"));
    expect(again.changed).toBe(false);
    expect(readQuarantine()).toHaveLength(1);
  });

  it("keeps at most three migration snapshots", () => {
    seedV0();
    for (let i = 0; i < 5; i++) localStorage.setItem(`tj2-backup-v0-2026-01-0${i + 1}T00:00:00.000Z`, "{}");
    migrate(new Date("2026-02-01T00:00:00.000Z"));
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("tj2-backup-v0-")).sort();
    expect(keys).toHaveLength(MAX_MIGRATION_SNAPSHOTS);
    expect(keys.at(-1)).toBe("tj2-backup-v0-2026-02-01T00:00:00.000Z");
  });

  it("finding 1: loose legacy records (entry:\"100\", notes:null) are normalised, not quarantined", () => {
    const fx = loadV0Fixture();
    fx["tj2-trades"].push(LEGACY_LOOSE_TRADE);
    seedV0(fx);
    const r = migrate(new Date("2026-09-30T10:00:00.000Z"));
    expect(r.quarantined).toBe(0);
    expect(readQuarantine()).toEqual([]);
    const trades = JSON.parse(localStorage.getItem("tj2-trades")!) as Array<Record<string, unknown>>;
    const loose = trades.find((t) => t.id === "t_loose000001")!;
    expect(loose).toMatchObject({ entry: 100, stop: 90.5, exit: 110, size: 1000, notes: "", reason: "", setups: [], checks: {} });
    expect(loose.chart).toBe(""); // finding 14: sanitizeUrl on normalise
    expect(loose.pnl).toBeCloseTo((110 - 100) * (1000 / 100), 6);
  });

  it("finding 3: an unparseable tj2-trades is quarantined as a raw blob and snapshotted verbatim, never overwritten", () => {
    seedV0();
    localStorage.setItem("tj2-trades", '[{"id":"t_1",');
    const r = migrate(new Date("2026-09-30T10:00:00.000Z"));
    expect(r.quarantined).toBe(1);
    const q = readQuarantine();
    expect(q[0]).toMatchObject({ kind: "blob", key: "tj2-trades", raw: '[{"id":"t_1",', at: "2026-09-30T10:00:00.000Z" });
    const snap = JSON.parse(localStorage.getItem("tj2-backup-v0-2026-09-30T10:00:00.000Z")!);
    expect(snap.trades).toBe('[{"id":"t_1",'); // raw string, not null
    expect(localStorage.getItem("tj2-trades")).toBe('[{"id":"t_1",'); // key untouched
    expect(readMeta().schemaVersion).toBe(1);
  });

  describe("finding 12: snapshot write failure", () => {
    afterEach(() => vi.restoreAllMocks());

    it("aborts the migration, keeps schemaVersion 0 and leaves the data untouched", () => {
      const fx = seedV0();
      const before = localStorage.getItem("tj2-trades");
      const original = Storage.prototype.setItem;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
        if (k.startsWith("tj2-backup-")) throw new Error("blocked");
        original.call(this, k, v);
      });
      const r = migrate(new Date("2026-09-30T10:00:00.000Z"));
      expect(r).toMatchObject({ from: 0, to: 0, changed: false, aborted: true, snapshotTag: null });
      expect(readMeta().schemaVersion).toBe(0);
      expect(localStorage.getItem("tj2-trades")).toBe(before);
      expect(localStorage.getItem("tj2-meta")).toBeNull();
      expect(readQuarantine()).toEqual([]);
      expect(fx["tj2-trades"]).toHaveLength(2);
    });
  });

  it("validateTrades keeps unknown keys and reports zod paths", () => {
    const v = validateTrades([{ ...loadV0Fixture()["tj2-trades"][0] as object, extra: 1 }, BROKEN_TRADE, "junk"]);
    expect(v.valid).toHaveLength(1);
    expect((v.valid[0] as unknown as { extra: number }).extra).toBe(1);
    expect(v.invalid).toHaveLength(2);
  });
});
