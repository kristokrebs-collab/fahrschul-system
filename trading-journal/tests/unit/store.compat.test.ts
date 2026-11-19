/**
 * Interop with the OTHER journal version (zero data loss): its localStorage data, its JSON backup in both import
 * modes, bare-array / `{ trades }` backups, symbol mapping, the v1 → v2 migration, and the day journal in
 * backup / restore.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyBackup, exportJson, importBackup, listBackups, parseBackup, restoreBackup } from "@/store/backup";
import { bootJournal, resetJournal, useJournal } from "@/store/journalStore";
import { migrate, readMeta, SCHEMA_VERSION } from "@/store/migrate";
import { DEFAULT_MISTAKES } from "@/domain/defaults";
import { useUi } from "@/store/uiStore";
import type { JsonBackup, Trade } from "@/domain/types";
import { OTHER_MISTAKES, OTHER_SIGNAL_CFG, OTHER_SIGNAL_SNAP, otherBackup, otherSettings, otherTrades, seedOtherVersion } from "./otherVersion.fixture";
import { seedV0 } from "./store.fixture";

async function bootLocal() {
  resetJournal();
  await bootJournal({ autoBackup: false });
}

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

describe("the other version's localStorage data (shared file:// storage)", () => {
  beforeEach(async () => {
    seedOtherVersion();
    await bootLocal();
  });

  it("boots with every field kept: trade.signal / trade.mistakes / settings.signals / settings.mistakes, 45m/2h", () => {
    const s = useJournal.getState();
    expect(s.trades).toHaveLength(2);
    const t1 = s.trades.find((t) => t.id === "t_other_1")!;
    expect(t1.signal).toEqual(OTHER_SIGNAL_SNAP);
    expect(t1.mistakes).toEqual(["Zu früh raus"]);
    expect(t1.timeframe).toBe("45m");
    expect(t1.checks).toEqual({ "s_mtf:mtf_base": true, "s_mtf:mtf_next": true, "g:trigger": true });
    expect(s.trades.find((t) => t.id === "t_other_2")?.timeframe).toBe("2h");
    expect(s.settings.signals).toEqual({ ...OTHER_SIGNAL_CFG, rsiNear: 12 });
    expect(s.settings.mistakes).toEqual(OTHER_MISTAKES);
    // s_mtf exists once (theirs, first) – never duplicated
    expect(s.settings.setups.map((x) => x.id)).toEqual(["s_mtf", "s_bo"]);
    expect(s.hyblock).toHaveLength(1);
  });

  it("maps the Bitstamp chart symbol to the Binance perp and keeps the original (persisted by the migration)", () => {
    expect(useJournal.getState().settings.market.symbol).toBe("BINANCE:BTCUSDT");
    const raw = stored("tj2-settings");
    expect(raw.market.symbol).toBe("BINANCE:BTCUSDT");
    expect(raw.market.sourceSymbol).toBe("BITSTAMP:BTCUSD");
    expect(raw.signals).toEqual({ ...OTHER_SIGNAL_CFG, rsiNear: 12 });
    expect(stored("tj2-trades")[0].signal).toEqual(OTHER_SIGNAL_SNAP);
    expect(readMeta().schemaVersion).toBe(SCHEMA_VERSION);
    // v0 snapshot of their raw data before anything was rewritten
    const v0 = listBackups().find((b) => b.kind === "v0")!;
    expect(stored(v0.key).settings.market.symbol).toBe("BITSTAMP:BTCUSD");
  });

  it("saving a trade and the settings keeps their extra fields", async () => {
    const t1 = useJournal.getState().trades.find((t) => t.id === "t_other_1")!;
    await useJournal.getState().saveTrade({ ...t1, notes: "edited here" });
    const raw = stored("tj2-trades").find((t: Trade) => t.id === "t_other_1");
    expect(raw).toMatchObject({ notes: "edited here", signal: OTHER_SIGNAL_SNAP, mistakes: ["Zu früh raus"] });
    await useJournal.getState().saveSettings({ ...useJournal.getState().settings, capital: { makro: 1, scalp: 2 } });
    expect(stored("tj2-settings")).toMatchObject({ capital: { makro: 1, scalp: 2 }, signals: { rsiNear: 12 }, mistakes: OTHER_MISTAKES });
  });
});

describe("the other version's JSON backup `{ exportedAt, settings, trades }`", () => {
  beforeEach(async () => {
    seedV0();
    await bootLocal();
    useUi.setState({ toasts: [] });
  });

  it("parses: no hyblock / schemaVersion, signal + mistakes kept, preview counts the file's setups", () => {
    const p = parseBackup(JSON.stringify(otherBackup()));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.preview).toMatchObject({ trades: 2, setups: 2, readings: 0, days: 0, schemaVersion: null, invalid: 0 });
    expect(p.parts).toMatchObject({ settings: true, trades: true, hyblock: false, days: false });
    expect(p.backup.trades[0]).toMatchObject({ signal: OTHER_SIGNAL_SNAP, mistakes: ["Zu früh raus"] });
    expect(p.backup.settings.market).toMatchObject({ symbol: "BINANCE:BTCUSDT", sourceSymbol: "BITSTAMP:BTCUSD" });
  });

  it("merge: trades added with their fields, signals adopted, mistake tags united, own scalars/symbol/readings kept", async () => {
    const before = useJournal.getState();
    const res = await importBackup(JSON.stringify(otherBackup()), { mode: "merge", now: new Date("2026-10-07T10:00:00.000Z") });
    expect(res.ok).toBe(true);
    const s = useJournal.getState();
    expect(s.trades).toHaveLength(before.trades.length + 2);
    expect(s.trades.find((t) => t.id === "t_other_1")).toMatchObject({ signal: OTHER_SIGNAL_SNAP, mistakes: ["Zu früh raus"], timeframe: "45m" });
    expect(s.settings.signals).toEqual({ ...OTHER_SIGNAL_CFG, rsiNear: 12 });
    expect(s.settings.mistakes).toEqual([...DEFAULT_MISTAKES, "Eigener Tag"]);
    expect(s.settings.currency).toBe(before.settings.currency);
    expect(s.settings.market.symbol).toBe("BINANCE:BTCUSDT");
    expect(s.settings.setups.filter((x) => x.id === "s_mtf")).toHaveLength(1);
    expect(s.hyblock).toHaveLength(before.hyblock.length); // the file has no readings – ours stay
    expect(stored("tj2-settings").signals.rsiNear).toBe(12);
  });

  it("replace: everything from the file; readings and day notes it lacks stay; the market keeps working", async () => {
    await useJournal.getState().saveDay("2026-10-01", { note: "ruhiger Tag" });
    const readings = useJournal.getState().hyblock.length;
    const res = await importBackup(JSON.stringify(otherBackup()), { mode: "replace", now: new Date("2026-10-07T10:00:00.000Z") });
    expect(res.ok).toBe(true);
    const s = useJournal.getState();
    expect(s.trades.map((t) => t.id)).toEqual(["t_other_1", "t_other_2"]);
    expect(s.settings.market.symbol).toBe("BINANCE:BTCUSDT"); // never BTCUSD (unknown to Binance USD-M)
    expect(s.settings.signals).toMatchObject({ rsiNear: 12 });
    expect(s.hyblock).toHaveLength(readings);
    expect(s.days["2026-10-01"]?.note).toBe("ruhiger Tag");
  });

  it("a bare trade array and `{ trades }` import too; replace with them never wipes the settings", async () => {
    const before = useJournal.getState();
    const bare = parseBackup(JSON.stringify(otherTrades()));
    expect(bare.ok && bare.preview).toMatchObject({ trades: 2, setups: 0 });
    expect((await importBackup(JSON.stringify({ trades: otherTrades() }), { mode: "merge" })).ok).toBe(true);
    expect(useJournal.getState().trades).toHaveLength(before.trades.length + 2);
    expect(useJournal.getState().settings).toEqual(before.settings);

    expect((await importBackup(JSON.stringify(otherTrades()), { mode: "replace" })).ok).toBe(true);
    const s = useJournal.getState();
    expect(s.trades.map((t) => t.id)).toEqual(["t_other_1", "t_other_2"]);
    expect(s.settings).toEqual(before.settings);
    expect(s.hyblock).toEqual(before.hyblock);
  });
});

describe("merge rules (pure)", () => {
  beforeEach(async () => {
    seedV0();
    await bootLocal();
  });

  const cur = () => {
    const s = useJournal.getState();
    return { trades: s.trades, settings: s.settings, hyblock: s.hyblock, days: s.days };
  };

  it("an old backup (before s_mtf / mistakes) never brings back a deleted s_mtf or mistake tag", () => {
    const c = cur();
    const mine = { ...c, settings: { ...c.settings, setups: c.settings.setups.filter((x) => x.id !== "s_mtf"), mistakes: ["Nur meiner"] } };
    const legacy = { exportedAt: "x", settings: { currency: "EUR", setups: [{ id: "s_old", name: "Alt", checklist: [] }] }, trades: [] };
    const p = parseBackup(JSON.stringify(legacy));
    if (!p.ok) throw new Error(p.error);
    expect(p.backup.settings.setups.map((x) => x.id)).toEqual(["s_old", "s_mtf"]); // normalised (replace would keep it)
    const out = applyBackup(mine, p.backup, "merge", p.parts);
    expect(out.settings.setups.map((x) => x.id)).not.toContain("s_mtf");
    expect(out.settings.setups.map((x) => x.id)).toContain("s_old");
    expect(out.settings.mistakes).toEqual(["Nur meiner"]);
    expect(out.settings.currency).toBe(c.settings.currency);
  });

  it("trades: a pure duplicate under another id is skipped, a copy with any new value is kept", () => {
    const c = cur();
    const t0 = c.trades[0]!;
    const backup: JsonBackup = { exportedAt: "", settings: c.settings, trades: [{ ...t0, id: "t_dupe" }, { ...t0, id: "t_more", notes: "mit Notiz" }] };
    const out = applyBackup(c, backup, "merge");
    expect(out.trades.map((t) => t.id)).toEqual([...c.trades.map((t) => t.id), "t_more"]);
  });

  it("trades: the newer record wins by id and keeps keys only the older one had", () => {
    const c = cur();
    const t0 = { ...c.trades[0]!, ourExtra: "keep" } as Trade;
    const inc = { ...c.trades[0]!, notes: "neu", updatedAt: "2099-01-01T00:00:00.000Z" };
    const out = applyBackup({ ...c, trades: [t0, ...c.trades.slice(1)] }, { exportedAt: "", settings: c.settings, trades: [inc] }, "merge");
    expect(out.trades[0]).toMatchObject({ notes: "neu", ourExtra: "keep" });
  });

  it("day notes: merge per date (newer wins), replace takes the file's, absent keeps ours", () => {
    const c = { ...cur(), days: { "2026-10-01": { note: "alt", updatedAt: "2026-10-01T20:00:00.000Z" }, "2026-10-02": { note: "nur hier", updatedAt: "2026-10-02T20:00:00.000Z" } } };
    const file = { "2026-10-01": { note: "neu", mood: 4 as const, updatedAt: "2026-10-03T08:00:00.000Z" }, "2026-10-05": { note: "neuer Tag", updatedAt: "2026-10-05T08:00:00.000Z" } };
    const backup: JsonBackup = { exportedAt: "", settings: c.settings, trades: [], days: file };
    const merged = applyBackup(c, backup, "merge", { settings: false, trades: false, hyblock: false, days: true });
    expect(merged.days).toEqual({ "2026-10-01": file["2026-10-01"], "2026-10-02": c.days["2026-10-02"], "2026-10-05": file["2026-10-05"] });
    expect(merged.trades).toBe(c.trades);
    expect(applyBackup(c, backup, "replace", { settings: false, trades: false, hyblock: false, days: true }).days).toEqual(file);
    expect(applyBackup(c, { ...backup, days: undefined }, "replace", { settings: true, trades: true, hyblock: false, days: false }).days).toEqual(c.days);
  });
});

describe("day journal in export / snapshot / restore", () => {
  beforeEach(async () => {
    seedV0();
    await bootLocal();
  });

  it("saveDay / deleteDay persist under tj2-days; empty entries are removed; unknown keys survive", async () => {
    localStorage.setItem("tj2-days", JSON.stringify({ meta: { keep: true } }));
    await useJournal.getState().saveDay("2026-10-07", { note: "Plan: nur A-Setups", mood: 4 });
    expect(useJournal.getState().days["2026-10-07"]).toMatchObject({ note: "Plan: nur A-Setups", mood: 4 });
    await useJournal.getState().saveDay("2026-10-07", { review: "diszipliniert" });
    expect(stored("tj2-days")["2026-10-07"]).toMatchObject({ note: "Plan: nur A-Setups", review: "diszipliniert", mood: 4 });
    expect(stored("tj2-days").meta).toEqual({ keep: true });
    await useJournal.getState().saveDay("2026-10-07", { note: "", review: "", mood: null });
    expect(stored("tj2-days")["2026-10-07"]).toBeUndefined();
    await useJournal.getState().saveDay("2026-10-08", { note: "x" });
    await useJournal.getState().deleteDay("2026-10-08");
    expect(useJournal.getState().days).toEqual({});
    await expect(useJournal.getState().saveDay("7.10.2026", { note: "x" })).rejects.toThrow();
  });

  it("the JSON export carries `days`; an import snapshot keeps them so restore brings them back", async () => {
    await useJournal.getState().saveDay("2026-10-06", { note: "Notiz" });
    let exported = "";
    const orig = URL.createObjectURL;
    URL.createObjectURL = ((b: Blob) => {
      void b.text().then((t) => (exported = t));
      return "blob:x";
    }) as typeof URL.createObjectURL;
    try {
      expect(await exportJson(new Date("2026-10-07T00:00:00.000Z"))).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      URL.createObjectURL = orig;
    }
    expect(JSON.parse(exported).days["2026-10-06"].note).toBe("Notiz");

    const res = await importBackup(JSON.stringify({ exportedAt: "x", trades: [], days: {} }), { mode: "replace", now: new Date("2026-10-07T01:00:00.000Z") });
    expect(res.ok).toBe(true);
    expect(useJournal.getState().days).toEqual({});
    await restoreBackup(res.snapshotTag!);
    expect(useJournal.getState().days["2026-10-06"]?.note).toBe("Notiz");
  });
});

describe("v1 → v2 migration (additive, idempotent)", () => {
  beforeEach(() => localStorage.clear());

  it("appends s_mtf + mistakes, maps a non-Binance symbol, keeps signals and unknown keys verbatim", () => {
    localStorage.setItem("tj2-meta", JSON.stringify({ schemaVersion: 1 }));
    const raw = { ...otherSettings(), customFlag: 1 } as Record<string, unknown>;
    delete raw.mistakes;
    delete raw.signals;
    raw.setups = [{ id: "s_bo", name: "Breakout", checklist: [] }];
    localStorage.setItem("tj2-settings", JSON.stringify(raw));
    localStorage.setItem("tj2-trades", JSON.stringify(otherTrades()));
    const tradesBefore = localStorage.getItem("tj2-trades");
    const r = migrate(new Date("2026-10-07T00:00:00.000Z"));
    expect(r).toMatchObject({ from: 1, to: 2, changed: true, quarantined: 0, snapshotTag: null });
    const s = stored("tj2-settings");
    expect(s.setups.map((x: { id: string }) => x.id)).toEqual(["s_bo", "s_mtf"]);
    expect(s.mistakes).toEqual(DEFAULT_MISTAKES);
    expect(s.market).toMatchObject({ symbol: "BINANCE:BTCUSDT", sourceSymbol: "BITSTAMP:BTCUSD" });
    expect(s.customFlag).toBe(1);
    expect(localStorage.getItem("tj2-trades")).toBe(tradesBefore); // trades untouched
    expect(migrate().changed).toBe(false);

    // a user who deletes s_mtf afterwards keeps it deleted (mistakes is persisted → the guard is off)
    localStorage.setItem("tj2-settings", JSON.stringify({ ...s, setups: s.setups.filter((x: { id: string }) => x.id !== "s_mtf") }));
    resetJournal();
    void bootJournal({ autoBackup: false });
    expect(useJournal.getState().settings.setups.map((x) => x.id)).toEqual(["s_bo"]);
  });
});
