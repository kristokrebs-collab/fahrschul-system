/**
 * The headline of the big "Top-Trader: Netto Long/Short" card on the Markt page (`netTitle`) and the sign change BEFORE the last
 * one (`previousFlip`) it is built from. Pure, no network (fapi.binance.com answers 451 from the sandbox). The sentence must say
 * "erstmals seit <Datum>" only when the loaded history really shows an earlier flip, say "im geladenen Verlauf von N Tagen
 * erstmals" when it does not, and never invent a date ("seit März").
 */
import { describe, expect, it } from "vitest";
import { buildTraderNet, netDayText, netTitle, TRADER_NET_MIN_POINTS, type NetRatioPoint, type TraderNetView } from "@/domain/signals";
import { buildFeedSpecs, deriveLiveTraderNet, initialHealth, type ProviderHealth, type RatioPoint, type Stamped } from "@/market";

const H = 3_600_000;
const STEP = 6 * H;
const T0 = Date.UTC(2026, 9, 1);
const NOW = T0 + 30 * 24 * H;

const run = (net: number, n: number): number[] => Array.from({ length: n }, () => net);
const series = (nets: number[], step = STEP): NetRatioPoint[] => nets.map((n, i) => ({ time: T0 + i * step, longPct: 50 + n / 2, shortPct: 50 - n / 2 }));
const view = (nets: number[], step = STEP): TraderNetView => buildTraderNet(series(nets, step), [], NOW, H);

describe("previousFlip: the sign change before the last one", () => {
  // 30 points short, 40 long, 30 short: two flips, B (to long) after point 29, C (to short) after point 69
  const two = view([...run(-10, 30), ...run(10, 40), ...run(-10, 30)]);

  it("is the flip that started the run the last flip ended", () => {
    expect(two.flip).toMatchObject({ from: "long", to: "short" });
    expect(two.previousFlip).toMatchObject({ from: "short", to: "long" });
    expect(two.previousFlip!.at).toBe(T0 + 29.5 * STEP);
    expect(two.flip!.at).toBe(T0 + 69.5 * STEP);
    expect(two.previousFlip!.at).toBeLessThan(two.flip!.at);
    expect(two.changes).toBe(2);
  });
  it("is null with a single flip, and null without any", () => {
    const one = view([...run(10, 8), 4, -4, ...run(-10, 12)]);
    expect(one.flip).not.toBeNull();
    expect(one.previousFlip).toBeNull();
    const none = view(run(8, 20));
    expect(none.flip).toBeNull();
    expect(none.previousFlip).toBeNull();
  });
  it("walks back through three flips: previous = the second to last", () => {
    const three = view([...run(10, 20), ...run(-10, 20), ...run(10, 20), ...run(-10, 20)]);
    expect(three.changes).toBe(3);
    expect(three.flip!.at).toBe(T0 + 59.5 * STEP);
    expect(three.previousFlip!.at).toBe(T0 + 39.5 * STEP);
  });
  it("ignores a dip into the dead band between two flips (it is not a flip of its own)", () => {
    const v = view([...run(-10, 12), ...run(10, 12), 0.5, -0.5, 0.4, ...run(10, 5), ...run(-10, 12)]);
    expect(v.changes).toBe(2);
    expect(v.previousFlip!.to).toBe("long");
    expect(v.previousFlip!.at).toBe(T0 + 11.5 * STEP);
  });
  it("carries the price at the crossing and the age like the last flip does", () => {
    const bars = Array.from({ length: 100 }, (_, i) => ({ time: T0 + i * STEP, open: 70_000 + i * 10, close: 70_005 + i * 10 }));
    const v = buildTraderNet(series([...run(-10, 30), ...run(10, 40), ...run(-10, 30)]), bars, NOW, STEP);
    expect(v.previousFlip!.priceAt).toBe(70_000 + 29 * 10);
    expect(v.previousFlip!.ageMs).toBe(NOW - (T0 + 29.5 * STEP));
    expect(v.previousFlip!.priceChangePct).not.toBeNull();
  });
});

describe("netTitle: the headline says the flip in words, only from the loaded history", () => {
  it("an earlier flip exists: „… sind seit <Umschlag> netto Short – erstmals seit <vorheriger Umschlag>.“", () => {
    const v = view([...run(-10, 30), ...run(10, 40), ...run(-10, 30)]);
    const t = netTitle(v);
    expect(t.kind).toBe("since-previous");
    expect(t.side).toBe("short");
    expect(t.text).toBe(`Top-Trader (Binance) sind seit ${netDayText(v.flip!.at)} netto Short – erstmals seit ${netDayText(v.previousFlip!.at)}`);
    // the date's own dot is the full stop
    expect(t.text).toBe("Top-Trader (Binance) sind seit 18.10. netto Short – erstmals seit 08.10.");
    // the dates and the side are the strong parts, the segments join to the text
    expect(t.segments.filter((s) => s.strong).map((s) => s.text)).toEqual(["18.10.", "Short", "08.10."]);
    expect(t.segments.map((s) => s.text).join("")).toBe(t.text);
  });
  it("mirrors for a flip to Long", () => {
    const v = view([...run(10, 30), ...run(-10, 40), ...run(10, 30)]);
    expect(netTitle(v).text).toBe("Top-Trader (Binance) sind seit 18.10. netto Long – erstmals seit 08.10.");
  });
  it("the flip is the only one in the loaded history: it says so, with the length of the history, and no earlier date", () => {
    const v = view([...run(10, 8), 4, -4, ...run(-10, 11)]);
    const t = netTitle(v);
    expect(t.kind).toBe("first-in-history");
    expect(t.text).toBe(`Top-Trader (Binance) sind seit ${netDayText(v.flip!.at)} netto Short – im geladenen Verlauf von 5 Tagen erstmals.`);
    expect(t.text).toBe("Top-Trader (Binance) sind seit 03.10. netto Short – im geladenen Verlauf von 5 Tagen erstmals.");
    expect(t.text).not.toMatch(/März|erstmals seit/);
  });
  it("a short loaded history is named in hours", () => {
    const v = view([...run(10, 8), 4, -4, ...run(-10, 11)], H);
    expect(netTitle(v).text).toMatch(/im geladenen Verlauf von 20 Std\. erstmals\.$/);
  });
  it("never flipped: seit mindestens N, kein Umschlag", () => {
    const t = netTitle(view(run(9, 20)));
    expect(t.kind).toBe("no-flip");
    expect(t.side).toBe("long");
    // 20 points, 6 h apart: 114 h loaded
    expect(t.text).toBe("Top-Trader (Binance) sind seit mindestens 4 Tagen netto Long – kein Umschlag im geladenen Verlauf.");
    expect(netTitle(view(run(-9, 20))).text).toContain("netto Short");
  });
  it("the newest point sits in the dead band: ausgeglichen, with the last firm side when there was a flip", () => {
    const withFlip = netTitle(view([...run(12, 8), ...run(-5, 6), -0.4]));
    expect(withFlip.kind).toBe("balanced");
    expect(withFlip.side).toBeNull();
    expect(withFlip.text).toMatch(/^Top-Trader \(Binance\) sind gerade ausgeglichen – zuletzt netto Short seit \d\d\.\d\d\.$/);
    const noFlip = netTitle(view(Array.from({ length: 14 }, (_, i) => (i % 2 ? 0.5 : -0.5))));
    expect(noFlip.kind).toBe("balanced");
    expect(noFlip.text).toBe("Top-Trader (Binance) sind gerade ausgeglichen – kein Umschlag im geladenen Verlauf von 3 Tagen.");
  });
  it(`too few points (< ${TRADER_NET_MIN_POINTS}): zu wenig Verlauf, no flip claimed`, () => {
    const t = netTitle(view([5, 5, -5, -5]));
    expect(t.kind).toBe("short");
    expect(t.side).toBeNull();
    expect(t.text).toBe(`Zu wenig Verlauf: erst 4 Punkte von Binance geladen, ab ${TRADER_NET_MIN_POINTS} zeichnet die Karte den Verlauf.`);
    expect(t.text).not.toMatch(/seit|erstmals/);
  });
  it("no data at all: null, undefined, an empty series", () => {
    for (const v of [null, undefined, buildTraderNet([], [], NOW, H), buildTraderNet(null, null, NOW, H)]) {
      const t = netTitle(v);
      expect(t.kind).toBe("none");
      expect(t.text).toBe("Keine Top-Trader-Daten von Binance");
      expect(t.side).toBeNull();
    }
  });
  it("a Bybit/OKX source has no top-trader cohort: no view, the headline says no data and the card carries the reason", () => {
    const specs = buildFeedSpecs("1h");
    const h: ProviderHealth = initialHealth(specs);
    h.online = true;
    h.feeds.topPositionRatio = { ...h.feeds.topPositionRatio!, state: "fallback", source: "bybit", lastDataAt: NOW };
    const data: RatioPoint[] = Array.from({ length: 30 }, (_, i) => ({ time: T0 + i * H, longPct: 55, shortPct: 45, ratio: 1.2 }));
    const stamped: Stamped<RatioPoint[]> = { data, asOf: NOW, receivedAt: NOW, source: "bybit", comparable: true };
    for (const source of ["bybit", "okx"] as const) {
      const hh: ProviderHealth = { ...h, feeds: { ...h.feeds, topPositionRatio: { ...h.feeds.topPositionRatio!, source } } };
      const live = deriveLiveTraderNet({ ...stamped, source }, undefined, hh, NOW);
      expect(live.view).toBeNull();
      expect(live.detail).toBe("Nur mit Binance");
      expect(netTitle(live.view).text).toBe("Keine Top-Trader-Daten von Binance");
    }
  });
  it("never calls the series Wale or Glassnode", () => {
    const views = [view([...run(-10, 30), ...run(10, 40), ...run(-10, 30)]), view([...run(10, 8), 4, -4, ...run(-10, 11)]), view(run(9, 20)), view([5, -5]), null];
    for (const v of views) expect(netTitle(v).text).not.toMatch(/Wal(e|s)|Glassnode|On-Chain/i);
  });
});
