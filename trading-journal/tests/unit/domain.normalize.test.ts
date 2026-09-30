/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeSettings, normalizeTrade, normalizeReading, sortReadings } from "@/domain/normalize";
import { DEFAULT_SETTINGS, DEFAULT_SETUPS, DEFAULT_RULES, defaultSettings, nextSetupColor, SETUP_PALETTE } from "@/domain/defaults";
import { JsonBackupSchema, TradeSchema, HyblockReadingSchema, SettingsSchema, RawSettingsSchema } from "@/domain/schemas";
import { enrichTrades } from "@/domain/enrich";
import { accountView } from "@/domain/account";
import { toJsonBackup } from "@/domain/csv";

const FIX = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/tj2-v0.json"), "utf8")) as {
  "tj2-settings": unknown;
  "tj2-trades": unknown[];
  "tj2-hyblock": unknown[];
};

describe("normalizeSettings (bundle qM)", () => {
  it("null/undefined/garbage → full defaults", () => {
    for (const raw of [null, undefined, "x", 3, []]) {
      const s = normalizeSettings(raw);
      expect(s).toEqual(DEFAULT_SETTINGS);
      expect(s.setups.length).toBe(11);
      expect(s.rules.length).toBe(5);
    }
    // defaults are not shared by reference
    const s = normalizeSettings(null);
    s.setups.pop();
    expect(DEFAULT_SETTINGS.setups.length).toBe(11);
    expect(defaultSettings().setups.length).toBe(11);
  });
  it("partial settings: scalars, capital strings, shallow merges, unknown keys survive", () => {
    const s = normalizeSettings({
      currency: "",
      capital: { makro: "12.500,5" },
      market: { longTrigger: 90000 },
      backtest: { label: "Test" },
      hyblock: { coin: "ETH" },
      extra: { keep: true },
    });
    expect(s.currency).toBe("USDT");
    expect(s.pair).toBe("BTC/USDT");
    expect(s.startDate).toBe("");
    expect(s.capital).toEqual({ makro: 12500.5, scalp: 5000 });
    expect(s.market.longTrigger).toBe(90000);
    expect(s.market.longStop).toBe(85300);
    expect(s.backtest.label).toBe("Test");
    expect(s.backtest.winRate).toBe(0.6215);
    expect(s.hyblock.coin).toBe("ETH");
    expect(s.hyblock.exchange).toBe("binance_perp_stable");
    expect((s as unknown as { extra: unknown }).extra).toEqual({ keep: true });
  });
  it("setups: empty array stays empty, missing per-setup fields defaulted (checklist/account/desc only)", () => {
    expect(normalizeSettings({ setups: [] }).setups).toEqual([]);
    const s = normalizeSettings({ setups: [{ id: "s_x", name: "X" }], rules: [] });
    expect(s.setups[0]).toEqual({ id: "s_x", name: "X", checklist: [], account: "both", desc: "" });
    expect(s.rules).toEqual([]);
    expect(normalizeSettings({ rules: "no" }).rules).toEqual(DEFAULT_RULES);
  });
  it("defaults verbatim", () => {
    expect(DEFAULT_SETUPS.map((s) => s.id)).toEqual(["s_p1", "s_p2", "s_p3", "s_ml", "s_ladder", "s_bo", "s_short", "s_rej", "s_sweep", "s_rsi", "s_bt"]);
    expect(DEFAULT_SETUPS.find((s) => s.id === "s_bt")!.checklist.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(DEFAULT_RULES.map((r) => r.id)).toEqual(["trigger", "topdown", "spx", "stop", "lev"]);
    expect(DEFAULT_SETTINGS.backtest).toEqual({ winRate: 0.6215, avgWin: 0.1664, avgLoss: -0.0931, expectancy: 0.0682, label: "214 Signale" });
    expect(DEFAULT_SETTINGS.market).toEqual({
      symbol: "BINANCE:BTCUSDT",
      longTrigger: 85900,
      longStop: 85300,
      shortTrigger: 84500,
      lowerHigh: 82829,
      rsiWeekly: 62.09,
      invalidation: 75500,
      zoneLow: 81500,
      zoneHigh: 82200,
    });
    expect(nextSetupColor(DEFAULT_SETUPS)).toBe("#9aa9bb");
    expect(nextSetupColor([])).toBe(SETUP_PALETTE[0]);
    expect(nextSetupColor(SETUP_PALETTE.map((c) => ({ color: c })))).toBe(SETUP_PALETTE[0]);
  });
});

describe("legacy fixture tj2-v0.json", () => {
  const s = normalizeSettings(FIX["tj2-settings"]);
  const trades = FIX["tj2-trades"].map(normalizeTrade);
  const readings = sortReadings(FIX["tj2-hyblock"].map(normalizeReading));

  it("settings normalise with defaults for the missing fields", () => {
    expect(s.capital).toEqual({ makro: 20000, scalp: 5000 });
    expect(s.startDate).toBe("");
    expect(s.setups.length).toBe(7);
    expect(s.setups[6]).toEqual({ id: "s_k3f9a2x1m0", name: "Eigenes Setup ohne Extras", checklist: [], account: "both", desc: "" });
    expect(s.rules).toEqual(DEFAULT_RULES);
    expect(s.backtest.avgWin).toBe(0.1664);
    expect(s.market.longTrigger).toBe(86000);
    expect(s.market.shortTrigger).toBe(84500);
    expect(s.hyblock.longEndpoint).toBe("topTraderAccountsLongShort");
    expect(RawSettingsSchema.safeParse(FIX["tj2-settings"]).success).toBe(true);
    expect(SettingsSchema.safeParse(s).success).toBe(true);
  });
  it("trades: ≥12, both accounts, open ones, missing account stays missing", () => {
    expect(trades.length).toBeGreaterThanOrEqual(12);
    expect(trades.filter((t) => t.account === "makro").length).toBeGreaterThan(0);
    expect(trades.filter((t) => t.status === "open").length).toBe(2);
    expect("account" in trades[2]!).toBe(false);
    expect(trades.every((t) => TradeSchema.safeParse(t).success)).toBe(true);
    expect(FIX["tj2-trades"].every((t) => TradeSchema.safeParse(t).success)).toBe(true);
  });
  it("enrichment recomputes pnl/r; account view works on legacy data", () => {
    const en = enrichTrades(trades, s);
    const a = en.find((t) => t.id === "t_a1b2c3d4e5f")!;
    expect(a.pnl).toBeCloseTo(396, 10);
    expect(a.complete).toBe(true);
    const k = en.find((t) => t.id === "t_k1l2m3n4o5p")!;
    expect(k.r).toBeNull(); // no stop
    expect(k.pnl).toBeCloseTo(-27, 6);
    const v = accountView(en, s, "all", { now: () => +new Date("2026-05-01T00:00") });
    expect(v.open.length).toBe(2);
    expect(v.closed.length).toBe(11);
    expect(v.g.n).toBe(11);
    expect(v.months.length).toBe(4);
    expect(v.proj).not.toBeNull();
    const makro = accountView(en, s, "makro");
    expect(makro.closed.length).toBe(3);
    expect(makro.open.length).toBe(1);
  });
  it("hyblock readings normalise and sort", () => {
    expect(readings.length).toBe(3);
    expect(readings.map((r) => r.longPct)).toEqual([55.2, 58.4, 60.1]);
    expect(readings.every((r) => HyblockReadingSchema.safeParse(r).success)).toBe(true);
    expect(normalizeReading({ longPct: "58,4", deltaCandles: 2.6, structure: 1 })).toMatchObject({ longPct: 58.4, deltaCandles: 3, structure: true, rsi: false, note: "" });
  });
  it("normalizeTrade coerces legacy junk", () => {
    const t = normalizeTrade({ id: 7, side: "buy", status: "open", exit: 5, entry: "80.000,5", checks: { a: 1, b: 0 }, conviction: 6, setups: ["s", 3] });
    expect(t.id).toBe("7");
    expect(t.side).toBe("long");
    expect(t.exit).toBeNull();
    expect(t.entry).toBe(80000.5);
    expect(t.checks).toEqual({ a: true });
    expect(t.conviction).toBeNull();
    expect(t.setups).toEqual(["s"]);
    expect(t.account).toBeUndefined();
  });
  it("JSON backup round-trips through the schema", () => {
    const backup = toJsonBackup(enrichTrades(trades, s), s, readings, new Date("2026-05-01T00:00:00.000Z"));
    expect(backup.exportedAt).toBe("2026-05-01T00:00:00.000Z");
    expect(backup.schemaVersion).toBe(1);
    expect(backup.hyblock?.length).toBe(3);
    expect(Object.keys(backup.trades[0]!)).not.toContain("items");
    expect(Object.keys(backup.trades[0]!)).toContain("pnl");
    const parsed = JsonBackupSchema.safeParse(JSON.parse(JSON.stringify(backup)));
    expect(parsed.success).toBe(true);
    expect(JsonBackupSchema.safeParse({ exportedAt: "x", settings: {}, trades: [] }).success).toBe(true);
    expect(JsonBackupSchema.safeParse({ trades: [] }).success).toBe(false);
  });
});
