import { describe, expect, it } from "vitest";
import { betterThanPct, K_ANON, MIN_TRADES, maxDrawdown, metricValue, ORIGIN_DOMINANT, originClassOf, originOf, percentileOf, quantiles, RANK_ORDER, rankRows, socialStats, tradeEpoch, weekIndex, type MetricTrade } from "@/social/metrics";
import { matrixSafe, monogramOf, pseudonymFrom, PSEUDONYM_RE } from "@/social/pseudonym";
import { fmtDd, fmtMove, fmtPct, fmtR, metricMatrix, metricText, shareTitle } from "@/social/format";
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

describe("Drawdown (F71)", () => {
  it("tiefster Fall der laufenden R-Summe, nicht der größte Einzelverlust", () => {
    expect(maxDrawdown([])).toBe(0);
    expect(maxDrawdown([1, 1, 1])).toBe(0);
    // Summe 2, 1, 0, 3, -1 → Höchststand 3, danach -1: Fall von 4 (der frühere Fall von 2 auf 0 ist kleiner)
    expect(maxDrawdown([2, -1, -1, 3, -4])).toBe(4);
    expect(maxDrawdown([-1, -1, 5])).toBe(2); // der Anfang zählt vom Start (0) aus
  });

  it("socialStats rechnet ihn in zeitlicher Reihenfolge, nicht in der Reihenfolge der Liste", () => {
    // gleiche Trades, durcheinander geliefert: Tag 5 bis 1 → +2, −1, −1, +3, −4 in zeitlicher Reihenfolge
    const shuffled = [t(-4, 1), t(2, 5), t(3, 2), t(-1, 3), t(-1, 4)];
    expect(socialStats(shuffled, NOW).drawdownR).toBe(4);
    expect(socialStats([...shuffled].reverse(), NOW).drawdownR).toBe(4);
  });

  it("deckelt R bei ±10 wie die übrigen Kennzahlen und braucht mindestens 5 Trades mit R", () => {
    expect(socialStats([t(-50, 1), t(1, 2), t(1, 3), t(1, 4), t(1, 5)], NOW).drawdownR).toBe(10);
    expect(socialStats([t(-1, 1), t(-1, 2), t(-1, 3), t(-1, 4)], NOW).drawdownR).toBeNull();
  });

  it("kleiner ist besser: der Rang läuft aufsteigend, Gleichstand teilt den Platz", () => {
    expect(RANK_ORDER.drawdown).toBe("low");
    expect(RANK_ORDER.expectancy).toBe("high");
    const rows = [
      { userId: "a", value: 3, trades: 30 },
      { userId: "b", value: 1, trades: 25 },
      { userId: "c", value: 1, trades: 40 },
      { userId: "d", value: 4, trades: 22 },
    ];
    expect(rankRows(rows, "low").map((r) => [r.userId, r.rank])).toEqual([["c", 1], ["b", 1], ["a", 3], ["d", 4]]);
    expect(rankRows(rows).map((r) => r.userId)).toEqual(["d", "a", "c", "b"]); // the default stays "more is better"
  });

  it("'besser als x %' kehrt sich beim Drawdown um", () => {
    const q = { p10: 1, p25: 2, p50: 3, p75: 5, p90: 8 };
    expect(betterThanPct("expectancy", 3, q)).toBe(50);
    expect(betterThanPct("drawdown", 3, q)).toBe(50);
    expect(betterThanPct("drawdown", 1, q)).toBe(90); // a tiny drop beats 90 % of the field
    expect(betterThanPct("drawdown", 8, q)).toBe(10);
    expect(betterThanPct("drawdown", 99, q)).toBe(1);
  });

  it("metricValue und Format", () => {
    expect(metricValue({ expectancyR: 1, discipline: 2, consistency: 3, winRate: 4, drawdownR: 5 }, "drawdown")).toBe(5);
    expect(metricValue({ expectancyR: 1, discipline: 2, consistency: 3, winRate: 4 }, "drawdown")).toBeNull();
    expect(fmtDd(3.44)).toBe("3,4R");
    expect(fmtDd(null)).toBe("–");
    expect(metricText("drawdown", 12)).toBe("12,0R");
    expect(metricMatrix("drawdown", 3.44)).toBe("3,4");
  });
});

describe("Herkunft der Datensätze (F50)", () => {
  it("ordnet die Marke eines Datensatzes ein; ohne Marke gilt Handeingabe", () => {
    expect(originOf({ kind: "api" })).toBe("api");
    expect(originOf({ kind: "csv" })).toBe("csv");
    expect(originOf({ kind: "bot", botId: "x" })).toBe("auto");
    expect(originOf({ kind: "webhook" })).toBe("auto");
    expect(originOf({ kind: "manual" })).toBe("manual");
    expect(originOf(undefined)).toBe("manual");
    expect(originOf("api")).toBe("api"); // the kind alone, as a server projection returns it
    expect(originOf({ kind: "etwas anderes" })).toBe("manual");
  });

  it(`eine Klasse mit mindestens ${ORIGIN_DOMINANT * 100} % benennt die Daten, sonst gemischt`, () => {
    expect(originClassOf({ api: 4, csv: 1, manual: 0, auto: 0 })).toBe("api"); // 80 % genau
    expect(originClassOf({ api: 3, csv: 2, manual: 0, auto: 0 })).toBe("mixed");
    expect(originClassOf({ api: 0, csv: 0, manual: 20, auto: 0 })).toBe("manual");
    expect(originClassOf({ api: 0, csv: 0, manual: 0, auto: 0 })).toBeNull();
  });

  it("socialStats zählt die Herkunft der Trades mit R in der Auswertungszeit", () => {
    const trades = [t(1, 1, { origin: { kind: "api" } }), t(1, 2, { origin: { kind: "api" } }), t(1, 3, { origin: { kind: "api" } }), t(1, 4, { origin: { kind: "api" } }), t(1, 5, { origin: { kind: "csv" } }), t(null, 6, { origin: { kind: "csv" } }), t(1, 200, { origin: { kind: "csv" } })];
    const s = socialStats(trades, NOW);
    expect(s.origins).toEqual({ api: 4, csv: 1, manual: 0, auto: 0 }); // no R and outside the window do not count
    expect(s.origin).toBe("api");
    expect(socialStats([t(1, 1), t(1, 2)], NOW).origin).toBe("manual");
    expect(socialStats([], NOW).origin).toBeNull();
  });
});
