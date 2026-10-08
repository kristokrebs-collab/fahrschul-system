/**
 * The user's screen of 2026-10-08 13:30 UTC rebuilt from real BINANCE:BTCUSDT.P bars (TradingView connector, fixture
 * `tests/fixtures/tv-btcusdt-p-2026-10-08.json`: closed 1h / 4h bars + 1m bars to rebuild the forming candles minute by
 * minute, exactly like the tv-check report). Proposals 1, 2, 4, 5, 6, 7 of that report:
 *
 * - intrabar memory: the 1h Kaufsignal lit 13:11–13:25 on the forming candle, gone at 13:26 — shown greyed at 13:30;
 * - turn price: the forming candle's MCB cross sits at 82 447 (1h) / 82 736 (4h) while the price was 82 415;
 * - divergences: the 1h regular bullish RSI divergence 10-07 14:00 → 10-08 04:00 (pivots 5 / 2, compared with every
 *   earlier pivot) is active from its confirmation until the 14:00 close breaks 82 150; candidates on the newest bars
 *   are provisional; the RSI trendline break.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_DIV_CFG,
  EMPTY_INTRABAR,
  checkTf,
  divGrade,
  divPart,
  divRungText,
  findDivergences,
  intrabarOf,
  noteIntrabar,
  rsi,
  rsiTrendBreak,
  sanitizeDivCfg,
  sanitizeSignalCfg,
  signalCfgKey,
  tfDivergences,
  waveTrend,
  wtTurn,
  type Bar,
  type IntrabarMemo,
  type TfCheck,
  type TrendBreak,
} from "@/domain/signals";
import tv from "../fixtures/tv-btcusdt-p-2026-10-08.json";

interface Col {
  start: number;
  step: number;
  o: number[];
  h: number[];
  l: number[];
  c: number[];
}
const TF = (tv as unknown as { tf: Record<"1h" | "4h" | "1m", Col> }).tf;
const series = (k: "1h" | "4h" | "1m"): Bar[] => TF[k].c.map((c, i) => ({ t: TF[k].start + i * TF[k].step, o: TF[k].o[i]!, h: TF[k].h[i]!, l: TF[k].l[i]!, c }));
const H1 = series("1h");
const H4 = series("4h");
const M1 = series("1m");
const SEC = { "1h": 3600, "4h": 14_400 } as const;
const CFG = sanitizeSignalCfg({});
const DIV = CFG.div!;

/** Unix seconds of 2026-10-08 hh:mm UTC (or another day). */
const T = (hhmm: string, day = "2026-10-08"): number => Date.parse(`${day}T${hhmm}:00Z`) / 1000;
const hm = (ms: number): string => new Date(ms).toISOString().slice(11, 16);

/**
 * The bars of `tf` as they stood at the END of the 1m bar `minute` (its close = the live price): the closed native bars
 * + the forming bar rebuilt from the 1m bars (from 12:00 on; earlier the finished native bar stands in for it), the
 * last 500 (the engine's window). `now` = that instant (ms).
 */
function asOf(tf: "1h" | "4h", minute: string): { bars: Bar[]; now: number; price: number } {
  const lastMin = T(minute);
  const at = lastMin + 59;
  const sec = SEC[tf];
  const native = tf === "1h" ? H1 : H4;
  const closed = native.filter((b) => b.t + sec <= at);
  const open = Math.floor(at / sec) * sec;
  const mins = M1.filter((b) => b.t >= open && b.t <= lastMin);
  const full = mins.length && mins[0]!.t === open;
  const nat = native.find((b) => b.t === open);
  expect(full || !!nat, `data for the forming ${tf} candle at ${minute}`).toBe(true);
  const forming: Bar = full ? { t: open, o: mins[0]!.o, h: Math.max(...mins.map((b) => b.h)), l: Math.min(...mins.map((b) => b.l)), c: mins.at(-1)!.c } : nat!;
  return { bars: [...closed, forming].slice(-500), now: at * 1000, price: forming.c };
}

const check = (tf: "1h" | "4h", minute: string): TfCheck => {
  const { bars, now } = asOf(tf, minute);
  return checkTf(tf, bars, CFG, now)!;
};

describe("tv-check 13:30 UTC: MCB on the forming candle (proposals 1 + 2)", () => {
  it("the reconstruction matches the app's screen: 1h wt1 −57,4 and 4h −47,6, no 1h / 4h event", () => {
    const c1 = check("1h", "13:30");
    const c4 = check("4h", "13:30");
    expect(c1.forming && c4.forming).toBe(true);
    expect(c1.wt.wt1).toBeCloseTo(-57.4, 1);
    expect(c4.wt.wt1).toBeCloseTo(-47.6, 1);
    expect([c1.conf!.long.state, c4.conf!.long.state]).toEqual(["none", "none"]);
  });

  it("turn price: the MCB cross of the forming candle sits at ≈ 82 447 (1h) and ≈ 82 736 (4h); the price was 82 415", () => {
    const h = asOf("1h", "13:30");
    const t1 = wtTurn(h.bars, CFG)!;
    const t4 = wtTurn(asOf("4h", "13:30").bars, CFG)!;
    expect(Math.round(h.price)).toBe(82_415);
    expect(t1.price).toBeCloseTo(82_447, -0.5);
    expect(t4.price).toBeCloseTo(82_736, -0.5);
    expect(t1).toMatchObject({ above: false });
    expect(t1.level).toBeCloseTo(-56.9, 1); // wt1 of the 12:00 close: the cross level (wt2 = SMA 2)
    // exact: a cent above the turn the forming candle crosses up, a cent below it does not
    const crossAt = (c: number): boolean => {
      const b = h.bars.slice();
      b[b.length - 1] = { ...b[b.length - 1]!, c, h: Math.max(b[b.length - 1]!.h, c), l: Math.min(b[b.length - 1]!.l, c) };
      const { wt1, wt2 } = waveTrend(b, CFG);
      return wt1.at(-1)! > wt2.at(-1)!;
    };
    expect(crossAt(t1.price + 0.01)).toBe(true);
    expect(crossAt(t1.price - 0.01)).toBe(false);
    // the turn price does not depend on the live price (only on the closed bars): the same at 13:31
    expect(wtTurn(asOf("1h", "13:31").bars, CFG)!.price).toBeCloseTo(t1.price, 6);
    // too short / plain wt2 → none
    expect(wtTurn(h.bars.slice(0, 2), CFG)).toBeNull();
    expect(wtTurn(h.bars, { ...CFG, wtSignal: 1 })).toBeNull();
  });

  it("intrabar memory: the 1h Kaufsignal of 13:11–13:25 (gone at 13:26) is remembered at 13:30, dropped with the close", () => {
    let memo: IntrabarMemo = EMPTY_INTRABAR;
    const seen: string[] = [];
    for (let m = T("13:00"); m <= T("14:01"); m += 60) {
      const minute = new Date(m * 1000).toISOString().slice(11, 16);
      const { bars, now, price } = asOf("1h", minute);
      const c = checkTf("1h", bars, CFG, now)!;
      const next = noteIntrabar(memo, [c], m * 1000, price);
      if (c.conf!.long.forming) seen.push(minute);
      if (!c.conf!.long.forming && next === memo) expect(next).toBe(memo); // nothing changed → same object
      memo = next;
      if (minute === "13:12") expect(intrabarOf(memo, c, "long")).toBeNull(); // lit now: the live event shows
      if (minute === "13:30") {
        const ib = intrabarOf(memo, c, "long")!;
        expect(ib).toMatchObject({ kind: "buy", bar: T("13:00") });
        expect(`${hm(ib.first)}–${hm(ib.last)}`).toBe("13:11–13:25");
        expect(Math.round(ib.price)).toBe(82_466); // the 13:11 close
        expect(intrabarOf(memo, c, "short")).toBeNull();
      }
      if (minute === "14:01") {
        expect(c.closeAt).toBe(T("14:00"));
        expect(intrabarOf(memo, c, "long")).toBeNull();
        expect(memo["1h"]).toBeUndefined(); // the 13:00 candle closed → forgotten
      }
    }
    expect(seen).toEqual(["13:11", "13:12", "13:13", "13:16", "13:17", "13:18", "13:19", "13:20", "13:21", "13:22", "13:23", "13:24", "13:25"]);
  });

  it("intrabar memory keeps the strongest kind and its first sighting; a closed last bar drops it", () => {
    const c = (forming: boolean, kind: "bull" | "buy" | null, closeAt = 100): TfCheck =>
      ({ tf: "30m", closeAt, forming, conf: { long: { state: kind ? "provisional" : "none", event: kind ? { kind, barsAgo: 0 } : null, closes: 0, held: true, closed: null, forming: kind ? { kind, barsAgo: 0 } : null }, short: { state: "none", event: null, closes: 0, held: false, closed: null, forming: null } } }) as unknown as TfCheck;
    let m = noteIntrabar(EMPTY_INTRABAR, [c(true, "bull")], 1_000, 10);
    m = noteIntrabar(m, [c(true, "buy")], 2_000, 11);
    m = noteIntrabar(m, [c(true, "bull")], 3_000, 12);
    expect(m["30m"]!.long).toEqual({ kind: "buy", bar: 100, first: 1_000, last: 3_000, price: 10, lastPrice: 12 });
    const same = noteIntrabar(m, [c(true, null)], 4_000, 13);
    expect(same).toBe(m);
    expect(intrabarOf(same, c(true, null), "long")!.kind).toBe("buy");
    expect(noteIntrabar(m, [c(true, null, 200)], 5_000, 13)["30m"]).toBeUndefined(); // next candle
    expect(noteIntrabar(m, [c(false, null)], 5_000, 13)["30m"]).toBeUndefined(); // closed
    expect(noteIntrabar(m, [], 5_000, 13)["30m"]).toBeUndefined(); // rung gone
  });
});

describe("tv-check: divergences read like a trader (proposals 4, 5, 6)", () => {
  const longRsi = (c: TfCheck) => c.div!.long.filter((d) => d.osc === "rsi").map((d) => `${new Date(d.from.t * 1000).toISOString().slice(5, 13)}→${new Date(d.to.t * 1000).toISOString().slice(5, 13)} ${d.kind} ${d.state}`);
  const PAIR = "10-07T14→10-08T04 regular";

  it("1h: the regular bullish RSI divergence 10-07 14:00 → 10-08 04:00 (pivots 5 / 2, every earlier pivot) is found", () => {
    const { bars, now } = asOf("1h", "13:30");
    const r = rsi(bars.map((b) => b.c), 14);
    const d = findDivergences(bars, r, "rsi", DIV, true, 2).find((x) => x.to.t === T("04:00") && x.dir === 1)!;
    expect(d).toMatchObject({ kind: "regular", from: { t: T("14:00", "2026-10-07"), price: 82_888.7 }, to: { price: 82_150 }, state: "strong", held: true, active: true });
    expect(d.from.osc).toBeCloseTo(21.1, 1);
    expect(d.to.osc).toBeCloseTo(28.7, 1);
    expect(bars[d.at]!.t).toBe(T("06:00")); // confirmed by the 06:00 candle (2 bars right), i.e. at 07:00
    // the former rules (fractal 2 / 2, previous pivot only, 5 bars) never showed it at 13:30
    expect(checkTf("1h", bars, { ...CFG, div: { ...DIV, left: 2, maxAge: 5 } }, now)!.div!.long.filter((x) => x.osc === "rsi" && x.to.t === T("04:00"))).toEqual([]);
  });

  it("active from its confirmation until the 14:00 close (82 145) breaks the pivot low 82 150", () => {
    expect(longRsi(check("1h", "06:59"))).toContain(`${PAIR} provisional`); // the confirmation candle forms
    expect(longRsi(check("1h", "07:01"))).toContain(`${PAIR} confirmed`);
    expect(longRsi(check("1h", "13:30"))).toContain(`${PAIR} strong`);
    expect(longRsi(check("1h", "13:59"))).toContain(`${PAIR} strong`);
    expect(longRsi(check("1h", "14:01")).filter((s) => s.startsWith(PAIR))).toEqual([]);
    const { bars, now } = asOf("1h", "14:01");
    const broken = checkTf("1h", bars, CFG, now)!.div!.all.find((x) => x.osc === "rsi" && x.to.t === T("04:00") && x.dir === 1)!;
    expect(broken).toMatchObject({ held: false, active: false });
  });

  it("provisional candidates on the newest bars: 12:00 at 13:30 (one bar known), the forming 13:00 candle at 13:42", () => {
    const at1330 = check("1h", "13:30").div!.long.filter((d) => d.state === "provisional");
    expect(at1330.map((d) => `${d.osc} ${d.kind} → ${new Date(d.to.t * 1000).toISOString().slice(11, 16)}`)).toEqual(["wt regular → 13:00", "rsi regular → 12:00"]);
    expect(at1330.every((d) => d.barsAgo === 0 && d.held && d.active)).toBe(true);
    const at1342 = check("1h", "13:42").div!.long.filter((d) => d.osc === "rsi" && d.state === "provisional");
    expect(at1342).toHaveLength(1);
    expect(at1342[0]).toMatchObject({ kind: "regular", to: { t: T("13:00"), price: asOf("1h", "13:42").bars.at(-1)!.l } });
    expect(at1342[0]!.to.price).toBeLessThan(81_760);
    // the part: ½ for a provisional regular one, the rung row says so
    expect(divGrade(at1342)).toBeCloseTo(0.4, 9);
    expect(divRungText(at1342)).toBe("RSI regulär · vorläufig");
    // back-dated (every bar closed): never provisional, the newest bars are no candidates
    const { bars } = asOf("1h", "13:30");
    const closed = bars.slice(0, -1);
    const r = rsi(closed.map((b) => b.c), 14);
    expect(findDivergences(closed, r, "rsi", DIV, false, 2).some((d) => d.state === "provisional" || d.to.index > closed.length - 3)).toBe(false);
  });

  it("the divergence part at 13:30: rows per rung with the 1h hit, a closed regular one holds the part", () => {
    const c = check("1h", "13:30");
    const p = divPart("long", [c], { div: DIV, ladder: ["1h"] })!;
    expect(p).toMatchObject({ ok: true, bonus: true, tf: "1h", state: "strong" });
    expect(p.items[0]!.value).toBe("RSI regulär · WT regulär");
    expect(p.grade).toBe(1);
  });
});

describe("RSI trendline break (proposal 7)", () => {
  /** RSI-like oscillator: highs 70 (bar 10) and 60 (bar 20) → falling line, then a break at `breakAt` (65, then 58). */
  function setup(n: number, breakAt: number | null): { bars: Bar[]; x: number[] } {
    const bars = Array.from({ length: n }, (_, i) => ({ t: 1_760_000_000 + i * 1800, o: 100, h: 101, l: 99, c: 100 }));
    const x = Array.from({ length: n }, () => 40);
    Object.assign(x, { 8: 50, 9: 60, 10: 70, 11: 60, 12: 50, 18: 45, 19: 52, 20: 60, 21: 52, 22: 45 });
    if (breakAt != null) for (let k = breakAt; k < n; k++) x[k] = k === breakAt ? 65 : 58; // breaks out and holds above
    return { bars, x };
  }
  const cfg = { left: 5, right: 2, rangeMax: 60 };

  it("falling line through the last two RSI highs, broken by a close above it; known after the second high is confirmed", () => {
    const { bars, x } = setup(30, 26);
    const tb = rsiTrendBreak(bars, x, cfg, false, 1)!;
    expect(tb).toMatchObject({ dir: 1, from: { index: 10, osc: 70 }, to: { index: 20, osc: 60 }, index: 26, value: 65, at: 26, barsAgo: 3, state: "confirmed", active: true });
    expect(tb.line).toBeCloseTo(54, 9); // 60 − 1 × 6
    expect(rsiTrendBreak(bars, x, cfg, false, -1)).toBeNull(); // no rising line through lows here
  });

  it("on the forming candle: provisional; a later close back under the line or age ends it", () => {
    const live = setup(27, 26);
    expect(rsiTrendBreak(live.bars, live.x, cfg, true, 1)).toMatchObject({ index: 26, barsAgo: 0, state: "provisional", active: true });
    const failed = setup(30, 26);
    failed.x[27] = 30; // closed back under the line
    expect(rsiTrendBreak(failed.bars, failed.x, cfg, false, 1)!.active).toBe(false);
    const old = setup(40, 26);
    expect(rsiTrendBreak(old.bars, old.x, cfg, false, 1)).toMatchObject({ barsAgo: 13, active: false });
    expect(rsiTrendBreak(setup(30, null).bars, setup(30, null).x, cfg, false, 1)).toBeNull(); // no break
    // mirrored: the rising line through two lows broken downward
    const m = setup(30, 26);
    const mx = m.x.map((v) => 100 - v);
    expect(rsiTrendBreak(m.bars, mx, cfg, false, -1)).toMatchObject({ dir: -1, from: { index: 10, osc: 30 }, to: { index: 20, osc: 40 }, index: 26, state: "confirmed" });
  });

  it("graded inside the divergence part: +0,2 (provisional +0,1), alone a partial grade that never holds the part", () => {
    const tb = (o: Partial<TrendBreak> = {}): TrendBreak => ({ osc: "rsi", dir: 1, from: { index: 0, t: 0, price: 1, osc: 70 }, to: { index: 10, t: 1, price: 1, osc: 60 }, index: 15, t: 2, value: 65, line: 55, at: 15, barsAgo: 0, state: "confirmed", active: true, ...o });
    expect(divGrade([], tb())).toBeCloseTo(0.2, 9);
    expect(divGrade([], tb({ state: "provisional" }))).toBeCloseTo(0.1, 9);
    expect(divGrade([], tb({ active: false }))).toBe(0);
    expect(divRungText([], tb())).toBe("RSI-Trendlinienbruch");
    expect(divRungText([], tb({ state: "provisional" }))).toBe("RSI-Trendlinienbruch · vorläufig");
    const c = { tf: "1h", div: { all: [], long: [], short: [], trend: { long: tb(), short: null } } } as unknown as TfCheck;
    const p = divPart("long", [c], { div: DIV, ladder: ["1h"] })!;
    expect(p).toMatchObject({ grade: 0.2, ok: false, bonus: false, tf: "1h", state: "confirmed" });
    expect(p.trends).toHaveLength(1);
    expect(p.items[0]).toMatchObject({ value: "RSI-Trendlinienbruch", met: true });
  });

  it("real data, 1h at 13:30: the rising RSI line through 10-07 14:00 and 10-08 04:00 broke with the 12:00 close (short side)", () => {
    const { bars } = asOf("1h", "13:30");
    const r = rsi(bars.map((b) => b.c), 14);
    const all = tfDivergences(bars, r, waveTrend(bars, CFG).wt1, DIV, true, 2);
    expect(all.trend!.long).toBeNull();
    expect(all.trend!.short).toMatchObject({ dir: -1, from: { t: T("14:00", "2026-10-07") }, to: { t: T("04:00") }, t: T("12:00"), state: "confirmed", active: true });
    expect(tfDivergences(bars, r, waveTrend(bars, CFG).wt1, { ...DIV, trendline: false }, true, 2).trend).toBeUndefined();
  });
});

describe("divergence settings: new defaults and the migration of stored values", () => {
  it("defaults: pivots 5 / 2, valid until broken (maxAge 0 = rangeMax), trendline on", () => {
    expect(DEFAULT_DIV_CFG).toMatchObject({ left: 5, right: 2, maxAge: 0, rangeMax: 60, trendline: true, midline: true, hidden: true });
  });

  it("an unversioned stored object with the former defaults reads as today's; versioned or other values stay", () => {
    expect(sanitizeDivCfg({ on: true, left: 2, right: 2, maxAge: 5, weight: 10 })).toMatchObject({ left: 5, right: 2, maxAge: 0, trendline: true });
    expect(sanitizeDivCfg({ left: 3, maxAge: 8 })).toMatchObject({ left: 3, maxAge: 8 });
    expect(sanitizeDivCfg({ v: 2, left: 2, maxAge: 5, trendline: false })).toMatchObject({ v: 2, left: 2, maxAge: 5, trendline: false });
    expect(sanitizeDivCfg({ left: 2, maxAge: 5, extra: "kept" })).toMatchObject({ extra: "kept" });
  });

  it("the trendline switch is part of the evaluation key", () => {
    expect(signalCfgKey(sanitizeSignalCfg({ div: { trendline: false } }))).not.toBe(signalCfgKey(sanitizeSignalCfg({})));
  });
});
