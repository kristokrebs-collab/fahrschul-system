/** P05 live limits, the pause and the pre-save preview. */
import { describe, expect, it } from "vitest";
import { closeAt, cooldownOf, limitStatus, nextMidnight, riskLimits, riskPreview, riskWarnings, stateOf, clockText, type LimitReport } from "@/domain/risk";
import type { EnrichedTrade, Settings, Trade } from "@/domain/types";
import { mkTrade } from "./domain.fixtures";
import { enrich, settingsWith } from "./insights.fixtures";

// Wednesday 2026-10-14 15:00 local
const NOW = new Date(2026, 9, 14, 15, 0).getTime();
const at = (d: number, h: number, m = 0): string => {
  const x = new Date(2026, 9, d, h, m);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}T${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
};
let seq = 0;
const closed = (date: string, pnl: number, extra: Partial<Trade> = {}): Trade => mkTrade({ id: `c${++seq}`, date, pnlManual: pnl, stop: 1, entry: 100, size: 1000, ...extra });
const open = (date: string, extra: Partial<Trade> = {}): Trade => mkTrade({ id: `o${++seq}`, date, status: "open", exit: null, entry: 100, stop: 98, size: 1000, ...extra });

// scalp capital 1000 (limits: day 4 % = 40, week 8 % = 80, open risk 3 % = 30, 5 trades/day, leverage rule ED)
const settings: Settings = settingsWith({ capital: { makro: 10_000, scalp: 1000 } });
const run = (trades: Trade[], s: Settings = settings, scope: "all" | "scalp" | "makro" = "scalp", extra: Partial<Parameters<typeof limitStatus>[0]> = {}): LimitReport =>
  limitStatus({ trades: enrich(trades, s), settings: s, scope, now: NOW, ...extra });
const row = (r: LimitReport, key: string) => r.rows.find((x) => x.key === key)!;

describe("Live-Limits", () => {
  it("state thresholds: warn from warnAt, breach at the limit (strict: above it)", () => {
    expect(stateOf(0.5, 0.75)).toBe("ok");
    expect(stateOf(0.75, 0.75)).toBe("warn");
    expect(stateOf(1, 0.75)).toBe("breach");
    expect(stateOf(1, 0.75, true)).toBe("warn");
    expect(stateOf(1.01, 0.75, true)).toBe("breach");
  });

  it("daily loss counts the trades CLOSED today (exitDate first), against settings.discipline.maxLossDayPct", () => {
    const r = run([
      closed(at(14, 9), -25),
      closed(at(13, 22), -10, { exitDate: at(14, 1) }), // entered yesterday, closed today
      closed(at(14, 8), -50, { exitDate: at(13, 23) }), // closed yesterday: not today
      closed(at(14, 10), 5),
    ]);
    const day = row(r, "day");
    expect(day.used).toBeCloseTo(30, 10);
    expect(day.limit).toBeCloseTo(40, 10);
    expect(day.state).toBe("warn");
    expect(day.detail).toContain("von 40");
    expect(r.dayPnl).toBeCloseTo(-30, 10);
    // the same discipline setting drives it
    const strict = settingsWith({ capital: { makro: 10_000, scalp: 1000 }, discipline: { maxLossDayPct: 0.02 } } as Partial<Settings>);
    expect(row(run([closed(at(14, 9), -25)], strict), "day").state).toBe("breach");
  });

  it("largest single loss of today against the per-trade limit (discipline.maxLossTradePct, strict)", () => {
    const r = run([closed(at(14, 9), -15), closed(at(14, 10), -20)]);
    expect(row(r, "trade")).toMatchObject({ used: 20, limit: 20, state: "warn" });
    expect(row(run([closed(at(14, 9), -21)]), "trade").state).toBe("breach");
    expect(row(run([closed(at(13, 9), -50)]), "trade").used).toBe(0);
  });

  it("weekly loss from Monday, drawdown from the equity peak", () => {
    const r = run([closed(at(12, 9), 200), closed(at(12, 10), -150), closed(at(11, 10), -500)]);
    // week (Mon 12th): +200 − 150 = +50 → nothing used
    expect(row(r, "week").used).toBe(0);
    const dd = row(r, "drawdown");
    // equity 1000 → 500 → 700 → 550: peak 1000 → DD 45 % (limit 15 %)
    expect(dd.used).toBeCloseTo(0.45, 10);
    expect(dd.state).toBe("breach");
  });

  it("trades per day: the limit itself is allowed (warn), more is a breach", () => {
    const five = Array.from({ length: 5 }, (_, i) => closed(at(14, 8 + i), 1));
    expect(row(run(five), "trades")).toMatchObject({ used: 5, limit: 5, state: "warn" });
    expect(row(run([...five, open(at(14, 14))]), "trades").state).toBe("breach");
  });

  it("open risk to the stops; a trade without a stop is at least a warning", () => {
    const r = run([open(at(14, 9))]); // 10 qty × 2 = 20 of 30
    expect(row(r, "openRisk")).toMatchObject({ used: 20, limit: 30, state: "ok" });
    const nostop = run([open(at(14, 9), { stop: null })]);
    expect(row(nostop, "openRisk").state).toBe("warn");
    // the gauge shows the true ratio (0 % to the stops), the warning comes from the missing stop
    expect(row(nostop, "openRisk").ratio).toBe(0);
    expect(row(nostop, "openRisk").detail).toContain("1 ohne Stop");
    expect(row(run([open(at(14, 9)), open(at(14, 10))]), "openRisk").state).toBe("breach");
  });

  it("leverage of open trades against the edition rule; venue positions count too", () => {
    const rule = riskLimits(settings).leverageRule.scalp;
    expect(row(run([open(at(14, 9), { leverage: rule })]), "leverage").state).not.toBe("breach");
    expect(row(run([open(at(14, 9), { leverage: rule + 1 })]), "leverage").state).toBe("breach");
    const pos = row(run([], settings, "scalp", { positions: [{ symbol: "BTCUSDT", leverage: rule * 3 }] }), "leverage");
    expect(pos.state).toBe("breach");
    expect(pos.detail).toContain("Börse");
    expect(row(run([]), "leverage")).toMatchObject({ used: 0, state: "ok" });
  });

  it("scope all: each account against its own limit, the worst one reported", () => {
    const r = run([closed(at(14, 9), -30, { account: "scalp" }), closed(at(14, 9), -100, { account: "makro" })], settings, "all");
    const day = row(r, "day");
    expect(day.account).toBe("scalp"); // 30/40 > 100/400
    expect(day.detail).toContain("Scalp");
    expect(r.dayPnl).toBeCloseTo(-130, 10);
    expect(r.capital).toBe(11_000);
  });
});

describe("Pause (Cooldown)", () => {
  const limits = riskLimits(settings);
  const list = (ts: Trade[]): EnrichedTrade[] => enrich(ts, settings);

  it("two losses in a row → pause of cooldownMin after the last one", () => {
    const c = cooldownOf({ closed: list([closed(at(14, 13), 10), closed(at(14, 14, 20), -5), closed(at(14, 14, 50), -5)]), now: NOW, limits, dayBreach: false });
    expect(c?.reason).toBe("losses");
    expect(c?.losses).toBe(2);
    expect(c?.endsAt).toBe(new Date(2026, 9, 14, 15, 20).getTime());
    expect(cooldownOf({ closed: list([closed(at(14, 13), -5), closed(at(14, 14, 0), -5)]), now: NOW, limits, dayBreach: false })).toBeNull();
  });

  it("the guard's close mark stands in for a missing exitDate", () => {
    const a = closed(at(14, 9), -5);
    const b = closed(at(14, 10), -5);
    expect(closeAt(b, { [b.id]: NOW - 60_000 })).toBe(NOW - 60_000);
    const c = cooldownOf({ closed: list([a, b]), now: NOW, limits, marks: { [a.id]: NOW - 120_000, [b.id]: NOW - 60_000 }, dayBreach: false });
    expect(c?.endsAt).toBe(NOW - 60_000 + 30 * 60_000);
  });

  it("a breached day pauses until midnight; the report carries it", () => {
    const r = run([closed(at(14, 9), -45)]);
    expect(row(r, "day").state).toBe("breach");
    expect(r.cooldown).toMatchObject({ reason: "day", endsAt: nextMidnight(NOW) });
    expect(r.worst).toBe("breach");
  });

  it("clock text", () => {
    expect(clockText(65_000)).toBe("1:05");
    expect(clockText(3_725_000)).toBe("1:02:05");
    expect(clockText(-5)).toBe("0:00");
  });
});

describe("Warnungen und Vorschau", () => {
  it("riskWarnings: breach first, with the pause", () => {
    const r = run([closed(at(14, 9), -45), open(at(14, 10), { stop: null })]);
    const w = riskWarnings({ report: r, now: NOW });
    expect(w[0]!.tone).toBe("breach");
    expect(w.map((x) => x.key)).toEqual(expect.arrayContaining(["limit:day", "limit:openRisk", "cooldown:day:" + new Date(2026, 9, 14, 9).getTime()]));
  });

  it("riskPreview: risk % against the per-trade limit, leverage rule, liquidation before the stop, day limit", () => {
    const report = run([closed(at(14, 9), -25)]);
    const limits = riskLimits(settings);
    const ok = riskPreview({ account: "scalp", side: "long", entry: 100, stop: 99, size: 1000 }, { limits, report, capital: 1000, now: NOW });
    expect(ok.riskAmount).toBeCloseTo(10, 10);
    expect(ok.riskPct).toBeCloseTo(0.01, 10);
    expect(ok.warnings.map((x) => x.key)).toEqual([]);
    const big = riskPreview({ account: "scalp", side: "long", entry: 100, stop: 97, size: 1000, target: 106 }, { limits, report, capital: 1000, now: NOW });
    expect(big.riskPct).toBeCloseTo(0.03, 10);
    expect(big.rr).toBeCloseTo(2, 10);
    expect(big.state).toBe("breach");
    expect(big.warnings.map((x) => x.key)).toEqual(expect.arrayContaining(["preview:trade", "preview:day"]));
    const lev = riskPreview({ account: "scalp", side: "long", entry: 100, stop: 80, size: 1000, leverage: 20 }, { limits, report, capital: 1000, now: NOW });
    expect(lev.liqPrice).toBeLessThan(100);
    expect(lev.warnings.map((x) => x.key)).toEqual(expect.arrayContaining(["preview:leverage", "preview:liq"]));
    const nostop = riskPreview({ account: "scalp", entry: 100, size: 1000 }, { limits, report, capital: 1000, now: NOW });
    expect(nostop.warnings[0]!.key).toBe("preview:nostop");
    expect(nostop.riskAmount).toBeNull();
  });
});
