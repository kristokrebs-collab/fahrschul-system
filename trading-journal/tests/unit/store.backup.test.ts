import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyBackup, autoBackup, importBackup, lastAutoBackup, listBackups, parseBackup, previewText, restoreBackup, writeSnapshot, AUTO_BACKUP_KEEP } from "@/store/backup";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import type { JsonBackup, Trade } from "@/domain/types";
import { loadV0Fixture, seedV0 } from "./store.fixture";

async function bootLocal() {
  resetJournal();
  await bootJournal({ autoBackup: false });
}

function backupOf(trades: Trade[], extra: Partial<JsonBackup> = {}): string {
  const s = useJournal.getState().settings;
  return JSON.stringify({ exportedAt: "2026-09-29T12:00:00.000Z", settings: s, trades, hyblock: [], schemaVersion: 1, ...extra });
}

describe("parseBackup", () => {
  it("rejects invalid JSON and reports the zod path", () => {
    expect(parseBackup("{")).toMatchObject({ ok: false });
    const bad = parseBackup(JSON.stringify({ exportedAt: "x", settings: {}, trades: [{ id: 1 }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.path).toBe("trades.0.id");
  });

  it("previews counts and date", () => {
    seedV0();
    const fx = loadV0Fixture();
    const text = JSON.stringify({ exportedAt: "2026-09-29T12:00:00.000Z", settings: fx["tj2-settings"], trades: fx["tj2-trades"], hyblock: fx["tj2-hyblock"] });
    const p = parseBackup(text);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.preview).toMatchObject({ trades: 2, setups: 1, readings: 2, schemaVersion: null });
      expect(previewText(p.preview)).toBe("2 Trades, 1 Grundlagen, 2 Ablesungen · exportiert am 29.09.26");
    }
  });
});

describe("applyBackup merge/replace", () => {
  beforeEach(async () => {
    seedV0();
    await bootLocal();
  });

  it("merge: upsert by id, newer updatedAt wins, ties keep current, setups merged, settings scalars untouched", () => {
    const s = useJournal.getState();
    const cur = { trades: s.trades, settings: s.settings, hyblock: s.hyblock };
    const older = { ...s.trades[0]!, notes: "older", updatedAt: "2026-01-01T00:00:00.000Z" };
    const newer = { ...s.trades[1]!, notes: "newer", updatedAt: "2027-01-01T00:00:00.000Z" };
    const tie = { ...s.trades[0]!, notes: "tie" };
    const fresh = { ...s.trades[0]!, id: "t_fresh", notes: "fresh" };
    const backup: JsonBackup = {
      exportedAt: "",
      settings: { ...s.settings, currency: "EUR", setups: [{ id: "s_bo", name: "renamed", account: "scalp", color: "#000", desc: "", checklist: [] }, { id: "s_new", name: "new", account: "both", color: "#111", desc: "", checklist: [] }] },
      trades: [older, newer, fresh],
      hyblock: [{ id: "h_2", at: "2026-03-04T12:00", longPct: 99, delta: 0, deltaCandles: 0, structure: false, rsi: false, note: "" }],
    };
    let out = applyBackup(cur, backup, "merge");
    expect(out.trades.map((t) => t.notes)).toEqual(["", "newer", "fresh"]);
    expect(out.settings.currency).toBe("USDT");
    expect(out.settings.setups.map((x) => x.name)).toEqual(["renamed", "new"]);
    expect(out.hyblock.find((r) => r.id === "h_2")?.longPct).toBe(99);
    expect(out.hyblock).toHaveLength(2);

    out = applyBackup(cur, { ...backup, trades: [tie] }, "merge");
    expect(out.trades[0]?.notes).toBe("");
  });

  it("replace: everything from the backup; readings kept when the backup has none", () => {
    const s = useJournal.getState();
    const cur = { trades: s.trades, settings: s.settings, hyblock: s.hyblock };
    const backup: JsonBackup = { exportedAt: "", settings: { ...s.settings, currency: "EUR", setups: [] }, trades: [] };
    const out = applyBackup(cur, backup, "replace");
    expect(out.trades).toEqual([]);
    expect(out.settings.currency).toBe("EUR");
    expect(out.settings.setups).toEqual([]);
    expect(out.hyblock).toHaveLength(2);
    expect(applyBackup(cur, { ...backup, hyblock: [] }, "replace").hyblock).toEqual([]);
  });
});

describe("importBackup / restoreBackup", () => {
  beforeEach(async () => {
    seedV0();
    await bootLocal();
    useUi.setState({ toasts: [] });
  });

  it("snapshots before writing, writes through the adapter, toasts", async () => {
    const t0 = useJournal.getState().trades[0]!;
    const res = await importBackup(backupOf([{ ...t0, id: "t_imported" }]), { mode: "replace", now: new Date("2026-09-30T00:00:00.000Z") });
    expect(res.ok).toBe(true);
    expect(res.snapshotTag).toBe("import-2026-09-30T00:00:00.000Z");
    expect(useJournal.getState().trades.map((t) => t.id)).toEqual(["t_imported"]);
    expect(JSON.parse(localStorage.getItem("tj2-trades")!)).toHaveLength(1);
    const snap = JSON.parse(localStorage.getItem("tj2-backup-import-2026-09-30T00:00:00.000Z")!);
    expect(snap.trades).toHaveLength(2);
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: "success", title: "Backup importiert" });

    const bad = await importBackup("{}", { mode: "merge" });
    expect(bad.ok).toBe(false);
    expect(useUi.getState().toasts.at(-1)).toMatchObject({ kind: "error", title: "Import fehlgeschlagen" });
    expect(useUi.getState().toasts.at(-1)?.detail).toContain("exportedAt");
    expect(useJournal.getState().trades).toHaveLength(1); // untouched

    const restored = await restoreBackup("import-2026-09-30T00:00:00.000Z");
    expect(restored.ok).toBe(true);
    expect(useJournal.getState().trades).toHaveLength(2);
  });

  it("accepts a File", async () => {
    const t0 = useJournal.getState().trades[0]!;
    const file = new File([backupOf([{ ...t0, id: "t_file" }])], "b.json", { type: "application/json" });
    const res = await importBackup(file, { mode: "merge", silent: true });
    expect(res.ok).toBe(true);
    expect(useJournal.getState().trades.some((t) => t.id === "t_file")).toBe(true);
  });
});

describe("auto backup rotation", () => {
  beforeEach(async () => {
    seedV0();
    await bootLocal();
  });

  it("creates one snapshot per day, keeps 14, newest first in listBackups", () => {
    for (let d = 1; d <= 16; d++) {
      const r = autoBackup(new Date(2026, 8, d, 9, 0, 0));
      expect(r.created).toBe(true);
    }
    expect(autoBackup(new Date(2026, 8, 16, 18, 0, 0)).created).toBe(false); // same day
    const keys = Object.keys(localStorage).filter((k) => /^tj2-backup-\d{4}-\d{2}-\d{2}$/.test(k)).sort();
    expect(keys).toHaveLength(AUTO_BACKUP_KEEP);
    expect(keys[0]).toBe("tj2-backup-2026-09-03");
    const list = listBackups();
    const autos = list.filter((b) => b.kind === "auto");
    expect(autos[0]?.tag).toBe("2026-09-16");
    expect(autos.at(-1)?.tag).toBe("2026-09-03");
    expect(lastAutoBackup()?.tag).toBe("2026-09-16");
    expect(autos[0]?.trades).toBe(2);
    expect(list.some((b) => b.kind === "v0")).toBe(true); // migration snapshot of the seeded v0 data
  });

  it("drops the oldest auto backups on QuotaExceededError", () => {
    autoBackup(new Date(2026, 8, 1));
    autoBackup(new Date(2026, 8, 2));
    const original = Storage.prototype.setItem;
    let failures = 2;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (failures > 0 && k === "tj2-backup-2026-09-03") {
        failures--;
        const e = new DOMException("quota", "QuotaExceededError");
        throw e;
      }
      return original.call(this, k, v);
    });
    expect(writeSnapshot("2026-09-03", { settings: null, trades: [], hyblock: [], at: "x" })).toBe(true);
    spy.mockRestore();
    expect(localStorage.getItem("tj2-backup-2026-09-01")).toBeNull();
    expect(localStorage.getItem("tj2-backup-2026-09-02")).toBeNull();
    expect(localStorage.getItem("tj2-backup-2026-09-03")).not.toBeNull();
  });
});
