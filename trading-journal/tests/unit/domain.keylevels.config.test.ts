import { describe, expect, it } from "vitest";
import { DEFAULT_MARKET, defaultSettings } from "@/domain/defaults";
import { normalizeSettings } from "@/domain/normalize";
import { SettingsSchema } from "@/domain/schemas";
import {
  allKeyLevels,
  blankKeyLevel,
  DEFAULT_ALERT_SETTINGS,
  duplicateKeyLevel,
  EMPTY_KEY_LEVELS,
  inActiveHours,
  isLegacyId,
  keyLevelsCfgOf,
  legacyKeyLevels,
  normalizeKeyLevel,
  planToastOn,
  timeframeAvailability,
  withKeyLevels,
  KEY_TIMEFRAMES,
} from "@/domain/keylevels";

const own = (over: Record<string, unknown> = {}) => ({ id: "k_1", name: "BTC unter 80.000", symbol: "BTCUSDT", price: 80_000, tf: "4h", direction: "below", kind: "close", ...over });

describe("settings.keyLevels – versioned passthrough", () => {
  it("absent or garbage reads as an empty config; nothing is invented", () => {
    for (const raw of [undefined, null, 5, "x", [], {}]) {
      const c = keyLevelsCfgOf(raw);
      expect(c.levels).toEqual([]);
      expect(c.precedence).toBe("higher");
      expect(c.alerts).toEqual(DEFAULT_ALERT_SETTINGS);
      expect(c.v).toBe(1);
    }
    expect(EMPTY_KEY_LEVELS.levels).toEqual([]);
  });

  it("reads a level with sane defaults and clamps numbers", () => {
    const l = normalizeKeyLevel(own({ closes: 99, priority: -3, distance: { mode: "atr", value: "1,5" }, invalidation: "81000", since: 123, alerts: { on: true, recurring: true }, role: "bogus" }))!;
    expect(l).toMatchObject({ closes: 10, priority: 1, distance: { mode: "atr", value: 1.5 }, invalidation: 81_000, since: 123, role: "auto", enabled: true });
    expect(l.alerts).toMatchObject({ on: true, recurring: true, prepare: true });
  });

  it("an entry with an unknown timeframe or rule is kept aside untouched, never repaired to a default", () => {
    const odd = own({ id: "k_odd", tf: "15m" });
    const odd2 = own({ id: "k_odd2", kind: "magic" });
    const raw = { v: 1, future: "keep me", levels: [own(), odd, odd2, { id: "k_bad", price: -1 }] };
    const c = keyLevelsCfgOf(raw);
    expect(c.levels.map((l) => l.id)).toEqual(["k_1"]);
    expect(c.rejected).toHaveLength(3);
    const written = withKeyLevels(raw, { precedence: "wait" });
    expect(written.future).toBe("keep me");
    expect((written.levels as { id?: string }[]).map((l) => l.id)).toEqual(["k_1", "k_odd", "k_odd2", "k_bad"]);
    expect(written.precedence).toBe("wait");
  });

  it("duplicated ids keep the first entry", () => {
    expect(keyLevelsCfgOf({ levels: [own(), own({ price: 1 })] }).levels).toHaveLength(1);
  });

  it("withKeyLevels returns the same object when nothing changes", () => {
    const raw = withKeyLevels(undefined, { levels: [blankKeyLevel({ id: "a", symbol: "BTCUSDT", price: 90_000, name: "A" }, 5)] });
    expect(withKeyLevels(raw, {})).toBe(raw);
    expect(withKeyLevels(raw, { precedence: "higher" })).toBe(raw);
    expect(withKeyLevels(raw, { precedence: "lower" })).not.toBe(raw);
  });

  it("settings round-trip: normalizeSettings and the zod schema keep the key; old settings stay byte-identical", () => {
    const withKey = { ...defaultSettings(), keyLevels: { v: 1, levels: [own()], extra: true } };
    expect(normalizeSettings(withKey).keyLevels).toEqual(withKey.keyLevels);
    expect(SettingsSchema.safeParse(withKey).success).toBe(true);
    const parsed = SettingsSchema.parse(withKey) as { keyLevels?: unknown };
    expect(parsed.keyLevels).toEqual(withKey.keyLevels);
    // settings written before the key existed do not get one
    const old = normalizeSettings({ ...defaultSettings() });
    expect("keyLevels" in old).toBe(false);
  });

  it("planToast defaults on only once the user has an own enabled level", () => {
    expect(planToastOn(keyLevelsCfgOf(undefined))).toBe(false);
    expect(planToastOn(keyLevelsCfgOf({ levels: [own()] }))).toBe(true);
    expect(planToastOn(keyLevelsCfgOf({ levels: [own({ enabled: false })] }))).toBe(false);
    expect(planToastOn(keyLevelsCfgOf({ levels: [own()], planToast: false }))).toBe(false);
  });
});

describe("migration of the five fixed levels", () => {
  it("maps every set level into the model without touching settings.market", () => {
    const market = { ...DEFAULT_MARKET };
    const before = JSON.stringify(market);
    const levels = legacyKeyLevels(market);
    expect(JSON.stringify(market)).toBe(before);
    expect(levels.map((l) => [l.legacy, l.price, l.direction, l.tf, l.kind, l.role])).toEqual([
      ["longTrigger", 85_900, "above", "4h", "close", "long"],
      ["longStop", 85_300, "below", "4h", "close", "stop"],
      ["shortTrigger", 84_500, "below", "4h", "close", "short"],
      ["invalidation", 75_500, "below", "4h", "close", "stop"],
      ["lowerHigh", 82_829, "above", "1W", "close", "info"],
    ]);
    expect(levels.every((l) => isLegacyId(l.id) && l.symbol === "BTCUSDT")).toBe(true);
    // the long and short trigger end at the long invalidation – what the scenario text always said
    expect(levels[0]!.invalidation).toBe(85_300);
    expect(levels[2]!.invalidation).toBe(85_300);
  });

  it("an edit in Einstellungen shows up in the model (the stored value is the single source)", () => {
    const l = legacyKeyLevels({ ...DEFAULT_MARKET, longTrigger: 86_100 }).find((x) => x.legacy === "longTrigger")!;
    expect(l.price).toBe(86_100);
  });

  it("the symbol follows settings.market.symbol", () => {
    expect(legacyKeyLevels({ ...DEFAULT_MARKET, symbol: "BINANCE:ETHUSDT.P" })[0]!.symbol).toBe("ETHUSDT");
    expect(legacyKeyLevels({ ...DEFAULT_MARKET, symbol: "BITSTAMP:BTCUSD" })[0]!.symbol).toBe("BTCUSDT");
  });

  it("allKeyLevels = fixed levels first, then the user's own; duplicate makes an own copy with alerts off", () => {
    const s = { market: DEFAULT_MARKET, keyLevels: { levels: [own()] } };
    const all = allKeyLevels(s);
    expect(all).toHaveLength(6);
    expect(all.at(-1)!.id).toBe("k_1");
    const copy = duplicateKeyLevel(all[0]!, "k_2", 999);
    expect(copy.legacy).toBeUndefined();
    expect(copy).toMatchObject({ id: "k_2", since: 999, price: 85_900, name: "Long-Trigger (Kopie)" });
    expect(copy.alerts.on).toBe(false);
  });

  it("the share edition's unset levels (0) produce nothing", () => {
    expect(allKeyLevels({ market: { ...DEFAULT_MARKET, longTrigger: 0, longStop: 0, shortTrigger: 0, lowerHigh: 0, invalidation: 0 } })).toEqual([]);
  });
});

describe("timeframes the feed can serve", () => {
  it("offers all seven when every source feed has candles", () => {
    const feeds = { kline_15m: { count: 900 }, kline_1h: { count: 500 }, kline_4h: { count: 500 }, kline_1d: { count: 900 }, kline_1w: { count: 200 } };
    const av = timeframeAvailability(feeds);
    expect(av.map((a) => a.tf)).toEqual([...KEY_TIMEFRAMES]);
    expect(av.every((a) => a.ok && a.reason === null)).toBe(true);
  });
  it("disables a timeframe with the reason – never swaps it for another one", () => {
    const av = timeframeAvailability({ kline_15m: { count: 0, unsupported: true }, kline_1h: { count: 2 }, kline_4h: { count: 500 }, kline_1d: { count: 0 }, kline_1w: { count: 5, offline: true } });
    const by = Object.fromEntries(av.map((a) => [a.tf, a]));
    expect(by["30m"]).toMatchObject({ ok: false, reason: expect.stringContaining("keine 15m-Kerzen") });
    expect(by["1h"]!.ok).toBe(true);
    expect(by["2h"]!.ok).toBe(true);
    expect(by["3h"]).toMatchObject({ ok: false }); // 2 hourly candles are not one 3h candle
    expect(by["4h"]!.ok).toBe(true);
    expect(by["1D"]).toMatchObject({ ok: false, reason: expect.stringContaining("1D-Kerzen") });
    expect(by["1W"]!.ok).toBe(true);
  });
  it("without a running market nothing is offered", () => {
    const av = timeframeAvailability(null);
    expect(av.every((a) => !a.ok && a.reason)).toBe(true);
  });
});

describe("active hours", () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 18, h, m);
  it("off = always", () => expect(inActiveHours({ on: false, from: "09:00", to: "10:00" }, at(3))).toBe(true));
  it("a normal window includes its start and excludes its end", () => {
    const h = { on: true, from: "08:00", to: "22:00" };
    expect(inActiveHours(h, at(7, 59))).toBe(false);
    expect(inActiveHours(h, at(8))).toBe(true);
    expect(inActiveHours(h, at(21, 59))).toBe(true);
    expect(inActiveHours(h, at(22))).toBe(false);
  });
  it("a window may wrap over midnight", () => {
    const h = { on: true, from: "22:00", to: "06:00" };
    expect(inActiveHours(h, at(23))).toBe(true);
    expect(inActiveHours(h, at(2))).toBe(true);
    expect(inActiveHours(h, at(6))).toBe(false);
    expect(inActiveHours(h, at(12))).toBe(false);
  });
  it("from == to means the whole day", () => expect(inActiveHours({ on: true, from: "08:00", to: "08:00" }, at(3))).toBe(true));
});
