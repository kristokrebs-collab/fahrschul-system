import { describe, expect, it } from "vitest";
import { K_ANON, MIN_TRADES, metricValue, percentileOf, quantiles, rankRows, socialStats, tradeEpoch, weekIndex, type MetricTrade } from "@/social/metrics";
import { matrixSafe, monogramOf, pseudonymFrom, PSEUDONYM_RE } from "@/social/pseudonym";
import { fmtMove, fmtPct, fmtR, metricMatrix, metricText, shareTitle } from "@/social/format";
import { inviteUrl, parseInvite, parseShareHash, shareUrl } from "@/social/links";

const NOW = Date.UTC(2026, 9, 12, 12, 0);
const day = (n: number) => new Date(NOW - n * 86_400_000).toISOString().slice(0, 16);
const t = (r: number | null, daysAgo: number, o: Partial<MetricTrade> = {}): MetricTrade => ({ status: "closed", r, date: day(daysAgo), followedPlan: true, mistakes: [], ...o });

describe("Kennzahlen (socialStats)", () => {
  it("Erwartung in R über 90 Tage, offene / alte / fremde Trades zählen nicht", () => {
    const trades = [t(2, 1), t(-1, 2), t(1, 3), t(-1, 4), t(0.5, 5), t(9, 120), t(3, 1, { status: "open" }), { status: "closed", r: "4", date: day(1) }];
    const s = socialStats(trades, NOW);
    expect(s.trades).toBe(6); // the string R still counts as a closed trade, just without R
    expect(s.rTrades).toBe(5);
    expect(s.expectancyR).toBe(0.3);
    expect(s.winRate).toBe(60);
    expect(s.eligible).toBe(false);
  });

  it("deckelt R bei ±10 – ein Ausreißer kauft keinen Rang", () => {
    const s = socialStats([t(500, 1), t(-1, 2), t(-1, 3), t(-1, 4), t(-1, 5)], NOW);
    expect(s.expectancyR).toBe(1.2);
  });

  it("Disziplin = nach Plan UND ohne Fehler-Tag, nur Trades mit Plan-Angabe", () => {
    const trades = [t(1, 1), t(1, 2, { mistakes: ["FOMO"] }), t(1, 3, { followedPlan: false }), t(1, 4), t(1, 5), t(1, 6, { followedPlan: null }), t(1, 7, { mistakes: ["  "] })];
    expect(socialStats(trades, NOW).discipline).toBe(66.7);
    expect(socialStats(trades.slice(0, 3), NOW).discipline).toBeNull(); // < 5 trades with the flag
  });

  it("Konsistenz = Anteil grüner Wochen ab 4 Wochen", () => {
    const trades = [t(1, 0), t(-2, 7), t(1, 14), t(1, 21), t(-0.5, 28)];
    const s = socialStats(trades, NOW);
    expect(s.weeks).toBe(5);
    expect(s.consistency).toBe(60);
    expect(socialStats(trades.slice(0, 3), NOW).consistency).toBeNull();
  });

  it(`ab ${MIN_TRADES} Trades mit R in der Rangliste`, () => {
    const many = Array.from({ length: MIN_TRADES }, (_, i) => t(i % 2 ? 1 : -0.5, i));
    expect(socialStats(many, NOW).eligible).toBe(true);
    expect(socialStats(many.slice(1), NOW).eligible).toBe(false);
  });

  it("Datumsformate und Wochen", () => {
    expect(tradeEpoch("2026-10-12T08:30")).toBe(Date.UTC(2026, 9, 12, 8, 30));
    expect(tradeEpoch("2026-10-12")).toBe(Date.UTC(2026, 9, 12));
    expect(tradeEpoch("gestern")).toBeNull();
    expect(weekIndex(Date.UTC(2026, 9, 12))).toBe(weekIndex(Date.UTC(2026, 9, 18, 23))); // Mon … Sun
    expect(weekIndex(Date.UTC(2026, 9, 19))).toBe(weekIndex(Date.UTC(2026, 9, 12)) + 1);
  });

  it("metricValue liest die richtige Zahl", () => {
    const s = { expectancyR: 0.4, discipline: 80, consistency: 55, winRate: 51 };
    expect([metricValue(s, "expectancy"), metricValue(s, "discipline"), metricValue(s, "consistency"), metricValue(s, "winrate")]).toEqual([0.4, 80, 55, 51]);
  });
});

describe("Rangliste und k-Anonymität", () => {
  it("rankRows: höher ist besser, Gleichstand teilt den Rang (1, 2, 2, 4)", () => {
    const r = rankRows([
      { userId: "a", value: 0.3, trades: 30 },
      { userId: "b", value: 0.5, trades: 22 },
      { userId: "c", value: 0.3, trades: 40 },
      { userId: "d", value: 0.1, trades: 25 },
    ]);
    expect(r.map((x) => [x.userId, x.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["a", 2],
      ["d", 4],
    ]);
  });

  it(`quantiles erst ab k = ${K_ANON}`, () => {
    expect(quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9])).toBeNull();
    const q = quantiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0)!;
    expect(q).toMatchObject({ n: 10, p50: 6, mean: 6 }); // 5.5 rounded
    expect(q.p10).toBeLessThanOrEqual(q.p25);
    expect(q.p75).toBeLessThanOrEqual(q.p90);
  });

  it("percentileOf: stückweise linear, 1–99", () => {
    const q = { p10: -0.4, p25: -0.1, p50: 0.15, p75: 0.4, p90: 0.8 };
    expect(percentileOf(0.15, q)).toBe(50);
    expect(percentileOf(0.4, q)).toBe(75);
    expect(percentileOf(0.275, q)).toBe(63);
    expect(percentileOf(5, q)).toBe(99);
    expect(percentileOf(-5, q)).toBe(1);
    const flat = { p10: 50, p25: 50, p50: 50, p75: 50, p90: 50 };
    expect(percentileOf(50, flat)).toBe(10);
    expect(percentileOf(60, flat)).toBe(99);
  });
});

describe("Pseudonyme", () => {
  it("passt zur Datenbank-Regel, Adjektiv passt zum Tier", () => {
    for (let i = 0; i < 400; i++) {
      const p = pseudonymFrom([i % 256, (i * 31) % 256, (i * 7) % 256, i % 256]);
      expect(p).toMatch(PSEUDONYM_RE);
      expect(p).not.toMatch(/@|\.|_/);
    }
    expect(pseudonymFrom([0, 0, 0, 0])).toBe("Stiller Falke 10");
    expect(pseudonymFrom([1, 1, 0, 0])).toBe("Ruhige Eule 10");
  });

  it("Monogramm und Matrix-Schreibweise", () => {
    expect(monogramOf("Kühner Luchs 14")).toBe("KL");
    expect(monogramOf("")).toBe("?");
    expect(matrixSafe("Kühner Möwe")).toBe("KUHNER MOWE");
  });
});

describe("Formate", () => {
  it("R, Prozent, Bewegung mit echtem Minus", () => {
    expect(fmtR(2.1)).toBe("+2,10R");
    expect(fmtR(-0.4)).toBe("−0,40R");
    expect(fmtR(null)).toBe("–");
    expect(fmtPct(64)).toBe("64 %");
    expect(fmtMove(-3.44)).toBe("−3,4 %");
    expect(metricText("expectancy", 0.42)).toBe("+0,42R");
    expect(metricText("discipline", 78)).toBe("78 %");
    expect(metricMatrix("expectancy", -0.4)).toBe("-0,40");
    expect(metricMatrix("consistency", 61.6)).toBe("62%");
  });

  it("Titel geteilter Inhalte", () => {
    expect(shareTitle({ v: 1, kind: "trade", pair: "ETHUSDT", side: "short", timeframe: null, day: null, result: "loss", r: -1, movePct: -2, rr: null, rating: null, followedPlan: null, checklist: null })).toBe("ETHUSDT Short · −1,00R");
    expect(shareTitle({ v: 1, kind: "stats", windowDays: 90, trades: 40, expectancyR: 0.3, winRate: 55, discipline: 80, consistency: 60 })).toBe("90 Tage · +0,30R");
  });
});

describe("Links", () => {
  it("Teilen-Link und Einladung als Hash-Routen", () => {
    const token = "AbCdEfGhIjKlMnOpQrStUv";
    expect(shareUrl(token)).toBe(`${location.origin}/#share/${token}`);
    expect(parseShareHash(`#share/${token}`)).toBe(token);
    expect(parseShareHash("#share/kurz")).toBeNull();
    expect(parseShareHash("#teilen/x")).toBeNull();
    expect(inviteUrl("ABCDEFGH12")).toBe(`${location.origin}/#community?invite=ABCDEFGH12`);
    expect(parseInvite("#community?invite=abcdefgh12")).toBe("ABCDEFGH12");
    expect(parseInvite("?invite=ABC")).toBeNull();
    expect(parseInvite("#community")).toBeNull();
  });
});
