import { describe, expect, it } from "vitest";
import { scenario, evaluateTrigger, zoneWarning, livePreviewLabel, countdownLabel, checkGlyph } from "@/domain/trigger";
import { fallingKnife, knifeCardLine, knifeVerdict, explainFallingKnife, knifePointValue, readingAge, liveReading } from "@/domain/fallingKnife";
import { DEFAULT_MARKET } from "@/domain/defaults";
import type { HyblockReading } from "@/domain/types";

const m = DEFAULT_MARKET;

describe("scenario (bundle Ng) – state table", () => {
  it.each([
    [null, null],
    [undefined, null],
    [75000, "bear"],
    [75499.99, "bear"],
    [75500, "short"], // equality is not "< invalidation"
    [84499, "short"],
    [84500, "range"], // equality → range
    [85000, "range"],
    [85900, "range"], // equality → range
    [85901, "long"],
    [90000, "long"],
  ] as const)("close4h %s → %s", (close, key) => {
    const s = scenario(close, m);
    expect(s?.key ?? null).toBe(key);
  });
  it("titles, tones and details verbatim", () => {
    expect(scenario(70000, m)).toEqual({ key: "bear", tone: "loss", title: "Volles Bär-Szenario", detail: "4H-Schluss unter 75.500. Ziel 66.000–70.000." });
    expect(scenario(86000, m)).toEqual({
      key: "long",
      tone: "win",
      title: "Long-Trigger aktiv",
      detail: "4H-Schluss über 85.900. Ziel 87.200, dann 89.000–90.000. Invalidierung unter 85.300.",
    });
    expect(scenario(84000, m)).toEqual({ key: "short", tone: "loss", title: "Short-Trigger aktiv", detail: "4H-Schluss unter 84.500. Ziel 82.000–81.500, Stop über 85.300." });
    expect(scenario(85000, m)).toEqual({ key: "range", tone: "mute", title: "Range, kein Trigger", detail: "4H-Schluss zwischen 84.500 und 85.900. Abwarten." });
  });
});

describe("evaluateTrigger", () => {
  it("weekly checks, rsi bar, zone, distances", () => {
    const st = evaluateTrigger({ price: 85543, close4h: 85000, closeW: 83000, rsiW: 65.2, levels: m });
    expect(st.scenario?.key).toBe("range");
    expect(st.weekly.show).toBe(true);
    expect(st.weekly.weeklyOk).toBe(true);
    expect(st.weekly.rsiOk).toBe(true);
    expect(st.weekly.rsiBar).toBe(100);
    expect(st.weekly.rows[0]!.label).toBe("Weekly Close über 82.829");
    expect(st.weekly.rows[1]!.label).toBe("Weekly RSI über 62,09");
    expect(st.weekly.rows[1]!.value).toBe("65,2");
    expect(st.zone.inZone).toBe(false);
    expect(st.zone.warning).toBeNull();
    expect(st.distance.toLong).toBeCloseTo((85900 - 85543) / 85543, 12);
    expect(st.distance.toShort).toBeCloseTo((85543 - 84500) / 85543, 12);
    expect(st.distance.longLabel).toBe("Long-Trigger in +0,4 %");
    expect(st.distance.longInReach).toBe(false);
    expect(st.longInvalidated).toBe(false);
  });
  it("in reach, in zone, rsi below threshold", () => {
    const st = evaluateTrigger({ price: 85700, close4h: 85000, closeW: 82000, rsiW: 31.045, levels: m });
    expect(st.distance.longInReach).toBe(true);
    expect(st.distance.toLong).toBeLessThan(0.003);
    expect(st.weekly.weeklyOk).toBe(false);
    expect(st.weekly.rsiOk).toBe(false);
    expect(st.weekly.rsiBar).toBeCloseTo(50, 6);
    const zone = evaluateTrigger({ price: 82000, close4h: 82000, levels: m });
    expect(zone.zone.inZone).toBe(true);
    expect(zone.zone.warning).toBe("Preis liegt in der Makro-Long-Zone 81.500–82.200. Falling-Knife-Filter prüfen, bevor du kaufst.");
    expect(zone.weekly.show).toBe(false);
    expect(zone.weekly.weeklyOk).toBeNull();
    expect(zoneWarning(null, m)).toBeNull();
    expect(zoneWarning(81500, m)).not.toBeNull();
    expect(zoneWarning(82200.01, m)).toBeNull();
  });
  it("long invalidation and live preview", () => {
    const st = evaluateTrigger({ price: 85200, close4h: 86000, close4hLive: 84000, levels: m });
    expect(st.scenario?.key).toBe("long");
    expect(st.longInvalidated).toBe(true);
    expect(st.livePreview?.key).toBe("short");
    expect(livePreviewLabel(st.livePreview!, "12:34")).toBe("Aktuelle 4H-Kerze: würde Short-Trigger aktiv auslösen, schließt in 12:34");
    const same = evaluateTrigger({ close4h: 86000, close4hLive: 87000, levels: m });
    expect(same.livePreview).toBeNull();
    const none = evaluateTrigger({ levels: m });
    expect(none.scenario).toBeNull();
    expect(none.distance.toLong).toBeNull();
    expect(none.distance.longLabel).toBeNull();
    expect(none.distance.longAbove).toBeNull();
  });
  it("helpers", () => {
    expect(countdownLabel(754_000)).toBe("12:34");
    expect(countdownLabel(-5)).toBe("00:00");
    expect(checkGlyph(null)).toBe("·");
    expect(checkGlyph(true)).toBe("✓");
    expect(checkGlyph(false)).toBe("✕");
  });
});

describe("fallingKnife (bundle JG)", () => {
  const s = { market: m };
  const cur: HyblockReading = { id: "h1", at: "2026-03-08T08:00", longPct: 60.1, delta: 12.5, deltaCandles: 3, structure: true, rsi: true, note: "" };
  const prev: HyblockReading = { ...cur, id: "h0", at: "2026-03-05T08:00", longPct: 58.4 };
  it("all four fulfilled", () => {
    const fk = fallingKnife(cur, prev, { price: 82000 }, s);
    expect(fk.n).toBe(4);
    expect(fk.all).toBe(true);
    expect(fk.knife).toBe(false);
    expect(fk.rising).toBe(true);
    expect(fk.pts.map((p) => p.l)).toEqual([
      "Preis in Support-/Liquiditätszone",
      "Erster Higher Low oder BOS auf 1H/4H",
      "Whale-vs-Retail-Delta positiv, 2–3 Kerzen",
      "RSI bullische Divergenz oder Trendlinienbruch",
    ]);
    expect(fk.pts[0]!.src).toBe("TradingView 82.000 · Zone 81.500–82.200");
    expect(fk.pts[2]!.src).toBe("Delta +12,5 · 3 Kerzen");
    expect(knifeCardLine(fk)).toBe("Makro-Long-Trigger valide.");
    expect(knifeVerdict(fk)).toEqual({ tone: "win", text: "Alle 4 Punkte erfüllt: Makro-Long-Trigger ist valide (T3 prüfen)." });
    expect(fallingKnife(cur, prev, { price: 82000, source: "Binance" }, s).pts[0]!.src).toBe("Binance 82.000 · Zone 81.500–82.200");
  });
  it("knife anti-pattern: rising long %, delta ≤ 0, no structure, no rsi", () => {
    const k = { ...cur, delta: -2, deltaCandles: 0, structure: false, rsi: false };
    const fk = fallingKnife(k, prev, { price: 83000 }, s);
    expect(fk.knife).toBe(true);
    expect(fk.n).toBe(0);
    expect(knifeCardLine(fk)).toBe("Anti-Muster: Messer fangen. Beobachten.");
    expect(knifeVerdict(fk).tone).toBe("loss");
    expect(knifeVerdict(fk).text).toBe("Anti-Muster: Long-% steigt, aber Delta ist nicht positiv und die Struktur dreht nicht. Messer fangen: beobachten statt handeln.");
    // not rising → no knife
    expect(fallingKnife(k, { ...prev, longPct: 61 }, { price: 83000 }, s).knife).toBe(false);
    // no prev → rising null → no knife
    expect(fallingKnife(k, null, { price: 83000 }, s).rising).toBeNull();
  });
  it("partial: n von 4, waiting for price, no reading", () => {
    const fk = fallingKnife({ ...cur, rsi: false, deltaCandles: 1 }, prev, { price: null }, s);
    expect(fk.pts[0]!.ok).toBeNull();
    expect(fk.pts[0]!.src).toBe("wartet auf Live-Kurs");
    expect(fk.pts[2]!.ok).toBe(false);
    expect(fk.n).toBe(1);
    expect(knifeVerdict(fk)).toEqual({ tone: "warn", text: "1 von 4 erfüllt. Kein Kaufsignal, weiter beobachten." });
    expect(knifeCardLine(fk)).toBe("Kein Kaufsignal. Tippen für Details.");
    const empty = fallingKnife(null, null, { price: 82000 }, s);
    expect(empty.n).toBe(1);
    expect(empty.pts[2]!.src).toBe("–");
    expect(empty.pts[1]!.ok).toBeNull();
    const ex = explainFallingKnife(fk);
    expect(ex.title).toBe("Falling-Knife-Filter");
    expect(ex.rows[0]![1]).toBe("–");
    expect(ex.rows[1]![1]).toBe("✓ erfüllt");
    expect(ex.rows[2]![1]).toBe("✕ offen");
    expect(ex.rows[1]![3]).toBe("deine Ablesung");
    expect(knifePointValue(true)).toBe("✓ erfüllt");
  });
  it("readingAge and liveReading", () => {
    const now = +new Date("2026-03-08T10:00");
    expect(readingAge("2026-03-08T09:30", now)).toEqual({ hours: 0.5, label: "vor 30 min", warn: false });
    expect(readingAge("2026-03-08T09:59:50", now).label).toBe("vor 1 min");
    expect(readingAge("2026-03-07T10:00", now)).toEqual({ hours: 24, label: "vor 24 h", warn: true });
    expect(readingAge("2026-03-01T10:00", now).label).toBe("");
    const lr = liveReading(cur, { longPct: 61, delta: null, at: now });
    expect(lr).toMatchObject({ id: "h1", longPct: 61, delta: 0, deltaCandles: 0, structure: true, rsi: true, note: "Live von Hyblock" });
    expect(liveReading(null, { longPct: 61, at: now }).structure).toBe(false);
  });
});
