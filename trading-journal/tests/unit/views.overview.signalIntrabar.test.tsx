/**
 * The tv-check additions in the Einstiegs-Check UI (2026-10-08): the MCB turn price on the rung's meter ("MCB −57,4 ·
 * dreht ab 82.447"), the intrabar memory (an event that came and went on the forming candle, greyed, never counted),
 * the small cross named "Kreuz", and the RSI trendline break in the divergence card.
 */
import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { type IntrabarMemo, type TrendBreak, type WtTurn } from "@/domain/signals";
import type { LiveSignals, SignalCheckState } from "@/market";
import { installDomPolyfills } from "./views.overview.harness";
import { gradedSnapshot, UI_CFG, v2check } from "./views.overview.signalFixtures";

const live = vi.hoisted(() => ({ state: null as unknown as SignalCheckState }));

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  return { ...actual, useSignalCheck: () => live.state };
});

import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { SignalCard } from "@/views/overview/SignalCard";
import { SignalStrip } from "@/views/overview/SignalStrip";
import { divSetupText, divTrendLine, intrabarView, partViews, rungViews, turnView } from "@/views/overview/signalView";

const MIN = 60_000;
const BAR = 1_760_000_000; // open time of every fixture rung's last bar (v2check)
const T1311 = Date.UTC(2026, 9, 8, 13, 11, 59, 999);
const T1325 = Date.UTC(2026, 9, 8, 13, 25, 59, 999);
const hm = (ms: number) => new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

const TURNS: Record<string, WtTurn | null> = {
  "30m": null,
  "45m": { price: 82_334.3, level: -57.9, above: true },
  "1h": { price: 82_447.3, level: -56.9, above: false },
  "4h": { price: 82_736.5, level: -46.0, above: false },
};
const MEMO: IntrabarMemo = { "1h": { long: { kind: "buy", bar: BAR, first: T1311, last: T1325, price: 82_466.2, lastPrice: 82_462 } } };

const trend = (o: Partial<TrendBreak> = {}): TrendBreak => ({
  osc: "rsi",
  dir: 1,
  from: { index: 400, t: BAR - 20 * 3600, price: 84_000, osc: 52 },
  to: { index: 410, t: BAR - 10 * 3600, price: 83_500, osc: 44 },
  index: 418,
  t: BAR - 2 * 3600,
  value: 41,
  line: 38,
  at: 418,
  barsAgo: 2,
  state: "confirmed",
  active: true,
  ...o,
});

/** The 13:30 screen: 30m Bottom vorläufig, 45m / 1h / 4h forming without a long event; 1h had a Kaufsignal 13:11–13:25. */
function screen1330(withTrend = false): LiveSignals {
  const closesAt = Date.now() + 30 * MIN;
  const c1h = v2check("1h", { closesAt, rsi: 34.9 });
  if (withTrend) c1h.div = { ...c1h.div!, trend: { long: trend(), short: null } };
  const snap = gradedSnapshot([v2check("30m", { long: { kind: "bottom", barsAgo: 0 }, state: "provisional", closesAt, rsi: 38.8 }), v2check("45m", { closesAt, rsi: 36.8 }), c1h, v2check("4h", { closesAt, rsi: 28.8 })]);
  return { ...snap, turns: TURNS, intrabar: MEMO, frameAt: T1325 };
}

const wrap = (node: React.ReactNode) =>
  render(
    <MotionRoot>
      <MorphDialogProvider>{node}</MorphDialogProvider>
    </MotionRoot>,
  );

beforeAll(() => installDomPolyfills());

describe("view model: turn price, intrabar memory", () => {
  it("per rung and side: the turn only without an event and when the cross would count; the memory only while nothing is lit", () => {
    const s = screen1330();
    const r = rungViews(s, s.long, "long", UI_CFG);
    expect(r.map((x) => x.turn?.value ?? null)).toEqual([null, null, "82.447", "82.737"]);
    expect(r[2]!.turn).toMatchObject({ kind: "buy", aria: "MCB dreht ab 82.447 nach oben (Kaufsignal)" });
    expect(r[3]!.turn!.kind).toBe("bull"); // −46 > −53: the cross would be a Kreuz
    expect(r[2]!.intrabar).toEqual({ kind: "buy", text: "Kaufsignal", span: `${hm(T1311)}–${hm(T1325)}`, price: "82.466", aria: `Kaufsignal intrabar ${hm(T1311)}–${hm(T1325)} bei 82.466 · aktuell nicht gehalten (zählt nicht)` });
    expect(r.filter((x) => x.intrabar)).toHaveLength(1);
    // the 45m wt1 is already above wt2 (crossed earlier): no turn price; the short side: the crosses would not count
    expect(rungViews(s, s.short, "short", UI_CFG).every((x) => x.turn === null && x.intrabar === null)).toBe(true);
  });

  it("turnView / intrabarView guards: closed candle, lit rung, another candle", () => {
    const forming = v2check("1h", { closesAt: Date.now() + MIN });
    const t = TURNS["1h"]!;
    expect(turnView(t, forming, "long", UI_CFG)).not.toBeNull();
    expect(turnView(t, v2check("1h"), "long", UI_CFG)).toBeNull(); // closed last bar
    expect(turnView(t, v2check("1h", { closesAt: Date.now() + MIN, long: { kind: "buy", barsAgo: 0 }, state: "provisional" }), "long", UI_CFG)).toBeNull();
    expect(turnView({ ...t, level: 4 }, forming, "long", UI_CFG)).toBeNull(); // a Kreuz above zero would not count
    expect(turnView({ ...t, level: 58, above: true }, forming, "short", UI_CFG)).toMatchObject({ kind: "sell" });
    expect(intrabarView(MEMO, forming, "long")!.text).toBe("Kaufsignal");
    expect(intrabarView({ "1h": { long: { ...MEMO["1h"]!.long!, bar: BAR - 3600 } } }, forming, "long")).toBeNull();
    const one = intrabarView({ "1h": { long: { ...MEMO["1h"]!.long!, last: T1311 } } }, forming, "long")!;
    expect(one.span).toBe(hm(T1311));
  });
});

describe("SignalCard / SignalStrip", () => {
  it("the 1h tile: greyed Kaufsignal intrabar with its minutes and price, the MCB meter's turn price; never counted", () => {
    live.state = { state: "ok", snapshot: screen1330(), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const tiles = screen.getAllByTestId("signal-rung");
    const h1 = tiles[2]!;
    expect(h1).toHaveAttribute("data-state", "none");
    const ib = within(h1).getByTestId("signal-rung-intrabar");
    expect(ib).toHaveAttribute("data-kind", "buy");
    expect(ib).toHaveTextContent("Kaufsignal");
    expect(ib).toHaveTextContent("intrabar");
    expect(within(h1).getByTestId("signal-rung-intrabar-span")).toHaveTextContent(`${hm(T1311)}–${hm(T1325)}`);
    expect(within(h1).getByTestId("signal-rung-intrabar-span")).toHaveTextContent("82.466");
    expect(within(h1).getByTestId("signal-rung-turn")).toHaveTextContent("82.447");
    expect(within(h1).queryByTestId("signal-rung-state")).toBeNull();
    expect(within(tiles[3]!).getByTestId("signal-rung-turn")).toHaveTextContent("82.737");
    expect(within(tiles[0]!).queryByTestId("signal-rung-turn")).toBeNull();
    // the verdict did not count it: the 1h rung is not part of the ladder
    expect(h1).not.toHaveAttribute("data-lit");
  });

  it("the hero strip: the 1h chip shows the remembered kind greyed; a small cross reads Kreuz", () => {
    live.state = { state: "ok", snapshot: screen1330(), updatedAt: 1, message: null };
    wrap(<SignalStrip />);
    const strip = screen.getByTestId("signal-strip");
    expect(strip.querySelector("[data-intrabar=buy]")).toHaveTextContent("Kauf");
    const s = gradedSnapshot([v2check("30m", { long: { kind: "bull", barsAgo: 1 } }), v2check("45m"), v2check("1h"), v2check("4h")]);
    expect(rungViews(s, s.long, "long", UI_CFG)[0]!.text).toBe("Kreuz");
  });

  it("divergence card: the RSI trendline break as a row note and its own line; setup text names the new rules", () => {
    const s = screen1330(true);
    const div = partViews(s.long).find((p) => p.id === "div")!;
    expect(divTrendLine(div.part)).toBe("1h · RSI-Trendlinienbruch nach oben (fallende Linie) · vor 2 Kerzen");
    live.state = { state: "ok", snapshot: s, updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const card = screen.getByTestId("signal-div");
    expect(within(card).getByTestId("signal-div-trend")).toHaveTextContent("1h · RSI-Trendlinienbruch nach oben (fallende Linie) · vor 2 Kerzen");
    const row = card.querySelector('[data-testid=signal-div-row][data-tf="1h"]')!;
    expect(row).toHaveAttribute("data-trend", "1");
    expect(row).toHaveAttribute("data-state", "confirmed");
    expect(row).toHaveTextContent("RSI-Trendlinienbruch");
    expect(divSetupText(UI_CFG)).toBe("RSI + WT · regulär + versteckt · Trendlinie · Pivots 5/2 · gilt bis zum Bruch");
  });
});
