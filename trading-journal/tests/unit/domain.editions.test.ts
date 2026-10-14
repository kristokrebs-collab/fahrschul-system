/// <reference types="node" />
/**
 * Editions (personal / share), the privacy guard, and the additive domain changes for the other version's data:
 * TIMEFRAMES, mistakes, s_mtf, symbol mapping, day notes, `levelsConfigured`.
 */
import { describe, expect, it } from "vitest";
import * as personal from "@/domain/edition/personal";
import * as share from "@/domain/edition/share";
import { MTF_SETUP } from "@/domain/edition/mtf";
import { ED } from "@/domain/edition";
import { EDITION, IS_FILE_BUILD, IS_SHARE } from "@/edition";
import { DEFAULT_MISTAKES, DEFAULT_SETUPS, levelsConfigured, MTF_SETUP_ID, TIMEFRAMES, weeklyConfigured, zoneConfigured } from "@/domain/defaults";
import { isEmptyDayNote, mapToBinanceSymbol, normalizeDayNotes, normalizeSettings, normalizeTrade } from "@/domain/normalize";
import { SettingsSchema, TradeSchema } from "@/domain/schemas";
import { EXTRA_MARKERS, findLeaks, literalsOf, PERSONAL_NUMBERS, PERSONAL_STRINGS } from "../../scripts/privacyGuard.ts";

describe("editions", () => {
  it("tests (and the Netlify root build) run the personal web edition", () => {
    expect(EDITION).toBe("personal");
    expect(IS_SHARE).toBe(false);
    expect(IS_FILE_BUILD).toBe(false);
    expect(ED).toBe(personal);
  });

  it("both edition modules have the same shape", () => {
    expect(Object.keys(share).sort()).toEqual(Object.keys(personal).sort());
    expect(Object.keys(share.COPY).sort()).toEqual(Object.keys(personal.COPY).sort());
  });

  it("share: neutral setups (s_mtf + s_bt), unset levels, no personal string or number anywhere in its data", () => {
    expect(share.SETUPS.map((s) => s.id)).toEqual(["s_mtf", "s_bt"]);
    expect(share.SETUPS[0]).toBe(MTF_SETUP);
    expect(levelsConfigured({ market: share.MARKET })).toBe(false);
    expect(weeklyConfigured({ market: share.MARKET })).toBe(false);
    expect(zoneConfigured({ market: share.MARKET })).toBe(false);
    expect(findLeaks(JSON.stringify(share))).toEqual([]);
    expect(findLeaks(JSON.stringify(MTF_SETUP))).toEqual([]);
  });

  it("personal: the 11 bundle setups + s_mtf; the guard knows its strings and levels", () => {
    expect(DEFAULT_SETUPS.map((s) => s.id).at(-1)).toBe(MTF_SETUP_ID);
    expect(levelsConfigured({ market: personal.MARKET })).toBe(true);
    expect(findLeaks(JSON.stringify(personal)).length).toBeGreaterThan(20);
    expect(PERSONAL_STRINGS).toContain("Lower-High-Bruch 82.829");
    expect(PERSONAL_STRINGS).not.toContain("Trigger ausgelöst, nicht geraten"); // shared by both editions
    expect(PERSONAL_STRINGS.some((s) => s.startsWith("#") || s === "s_ladder")).toBe(false); // colours / ids are not text
    expect(PERSONAL_NUMBERS).toEqual(expect.arrayContaining([85900, 82829, 0.6215]));
    expect(PERSONAL_NUMBERS).not.toContain(20000); // round thousands appear everywhere (timeouts)
  });

  it("findLeaks sees minified spellings and escaped strings, not substrings of other numbers", () => {
    expect(findLeaks("a=859e2")).toEqual(["85900"]);
    expect(findLeaks("a=.6215,b=-.0931")).toEqual(["0.6215", "-0.0931"]);
    expect(findLeaks("a=185900,b=85900.5,c=x85900")).toEqual([]);
    expect(findLeaks(JSON.stringify("Philosophie 2: Weekly Close über 82.829 UND Weekly RSI über 62,09. Beides nötig."))).toEqual(
      expect.arrayContaining(["Philosophie", "82.829", "Philosophie 2: Weekly Close über 82.829 UND Weekly RSI über 62,09. Beides nötig."]),
    );
    expect(findLeaks('"Top-down gepr\\u00fcft (W \\u2192 3D \\u2192 D \\u2192 4H \\u2192 1H)"')).toContain("Top-down geprüft (W → 3D → D → 4H → 1H)");
    expect(EXTRA_MARKERS).toContain("MegaWhale");
  });

  it("literalsOf ignores comments and reads strings with escapes", () => {
    const lit = literalsOf('// "comment 123"\n/* 99999 */ export const A = { s: "a \\"b\\" c", n: 85900, u: "https://x.y/z" };');
    expect([...lit.strings]).toEqual(['a "b" c', "https://x.y/z"]);
    expect([...lit.numbers]).toEqual([85900]);
  });
});

describe("domain additions", () => {
  it("TIMEFRAMES keep every old value and add 30m / 45m / 2h in order", () => {
    expect(TIMEFRAMES).toEqual(["1m", "5m", "15m", "30m", "45m", "1h", "2h", "4h", "1D", "3D", "1W"]);
  });

  it("trade.mistakes defaults to [], keeps strings only; trade.signal passes through verbatim", () => {
    expect(normalizeTrade({ id: "a" }).mistakes).toEqual([]);
    expect(normalizeTrade({ id: "a", mistakes: [" Kein Stop ", 3, "", "Kein Stop", "FOMO-Einstieg"] }).mistakes).toEqual(["Kein Stop", "FOMO-Einstieg"]);
    const signal = { at: "x", tfs: [{ tf: "45m", kind: null }], extra: { deep: true } };
    const t = normalizeTrade({ id: "a", signal });
    expect(t.signal).toEqual(signal);
    expect(TradeSchema.safeParse(t).success).toBe(true);
    expect(normalizeTrade({ id: "a", signal: null }).signal).toBeNull();
  });

  it("settings.mistakes defaults to the other version's list; settings.signals is passthrough", () => {
    expect(normalizeSettings(null).mistakes).toEqual(DEFAULT_MISTAKES);
    expect(normalizeSettings({ mistakes: ["A", 1, "A"] }).mistakes).toEqual(["A"]);
    expect(normalizeSettings({ mistakes: [] }).mistakes).toEqual([]);
    const signals = { ladder: ["30m", "45m"], unknownKey: 1 };
    expect(normalizeSettings({ signals }).signals).toEqual(signals);
    expect(normalizeSettings(null).signals).toBeUndefined();
    expect(SettingsSchema.safeParse(normalizeSettings({ signals })).success).toBe(true);
  });

  it("s_mtf is appended once to settings that predate it, never when mistakes/signals exist, never to an empty list", () => {
    const legacy = normalizeSettings({ setups: [{ id: "s_bo", name: "B" }] });
    expect(legacy.setups.map((s) => s.id)).toEqual(["s_bo", "s_mtf"]);
    expect(normalizeSettings(legacy).setups.map((s) => s.id)).toEqual(["s_bo", "s_mtf"]); // idempotent
    expect(normalizeSettings({ setups: [{ id: "s_bo", name: "B" }], mistakes: [] }).setups.map((s) => s.id)).toEqual(["s_bo"]);
    expect(normalizeSettings({ setups: [{ id: "s_bo", name: "B" }], signals: {} }).setups.map((s) => s.id)).toEqual(["s_bo"]);
    expect(normalizeSettings({ setups: [] }).setups).toEqual([]);
    const theirs = normalizeSettings({ setups: [{ ...MTF_SETUP, name: "custom" }, { id: "s_bo", name: "B" }] });
    expect(theirs.setups.map((s) => `${s.id}:${s.name}`)).toEqual(["s_mtf:custom", "s_bo:B"]);
    expect(MTF_SETUP.checklist.map((c) => c.id)).toEqual(["mtf_base", "mtf_next", "mtf_third", "mtf_rsi", "mtf_zone"]);
  });

  it("maps another venue's USD symbol to the Binance USDT perp and keeps the original", () => {
    expect(mapToBinanceSymbol("BITSTAMP:BTCUSD")).toEqual({ symbol: "BINANCE:BTCUSDT", changed: true });
    expect(mapToBinanceSymbol("COINBASE:ETHUSD")).toEqual({ symbol: "BINANCE:ETHUSDT", changed: true });
    expect(mapToBinanceSymbol("KRAKEN:XBTUSD")).toEqual({ symbol: "BINANCE:BTCUSDT", changed: true });
    expect(mapToBinanceSymbol("BTCUSD")).toEqual({ symbol: "BINANCE:BTCUSDT", changed: true });
    for (const same of ["BINANCE:BTCUSDT", "BYBIT:BTCUSDT", "BINANCE:BTCUSD", "BINANCE:BTCFDUSD", "OKX:BTCBUSD", "", "BTCUSDT"]) {
      expect(mapToBinanceSymbol(same)).toEqual({ symbol: same, changed: false });
    }
    const s = normalizeSettings({ market: { symbol: "BITSTAMP:BTCUSD" } });
    expect(s.market).toMatchObject({ symbol: "BINANCE:BTCUSDT", sourceSymbol: "BITSTAMP:BTCUSD", longTrigger: 85900 });
    expect(normalizeSettings(s).market).toMatchObject({ symbol: "BINANCE:BTCUSDT", sourceSymbol: "BITSTAMP:BTCUSD" });
    expect(normalizeSettings({ market: { symbol: "COINBASE:BTCUSD", sourceSymbol: "first" } }).market).toMatchObject({ sourceSymbol: "first" });
  });

  it("levelsConfigured: false while a trigger level is 0 / unset", () => {
    const m = normalizeSettings(null).market;
    expect(levelsConfigured({ market: m })).toBe(true);
    expect(levelsConfigured({ market: { ...m, longTrigger: 0 } })).toBe(false);
    expect(levelsConfigured({ market: { ...m, shortTrigger: 0 } })).toBe(false);
    expect(zoneConfigured({ market: { ...m, zoneHigh: m.zoneLow - 1 } })).toBe(false);
  });

  it("day notes: date keys only, note always a string, mood 1–5 or null, unknown keys kept", () => {
    const d = normalizeDayNotes({
      "2026-10-07": { note: "Plan", mood: "4", extra: 1, updatedAt: "x" },
      "2026-10-08": { note: 5, mood: 9 },
      "7.10.": { note: "skip" },
      "2026-10-09": "skip",
    });
    expect(Object.keys(d)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(d["2026-10-07"]).toEqual({ note: "Plan", mood: 4, extra: 1, updatedAt: "x" });
    expect(d["2026-10-08"]).toEqual({ note: "5", mood: null, updatedAt: "" });
    expect(isEmptyDayNote({ note: " ", updatedAt: "" })).toBe(true);
    expect(isEmptyDayNote({ note: "", mood: 3, updatedAt: "" })).toBe(false);
    expect(normalizeDayNotes(null)).toEqual({});
  });
});
