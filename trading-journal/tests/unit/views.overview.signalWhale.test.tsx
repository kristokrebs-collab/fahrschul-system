/**
 * The graded parts of the SignalCard (decisions 5 + 10): the Top-Trader-Kombi scorecard (four cells lit / unlit with
 * their values: Positionen, Konten, the Whale–Retail-Delta with its change and a 12-point sparkline, Zone), the divergence rows (what, which timeframe, where) and the
 * support / resistance meters (ATR distance, R to the next level), their points / strength, the strip's parts line and
 * the view models.
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeSignalCfg } from "@/domain/signals";
import type { SignalCheckState } from "@/market";
import { installDomPolyfills } from "./views.overview.harness";
import { divHit, gradedSnapshot, structureAt, traderReadingOf, UI_CFG, v2check } from "./views.overview.signalFixtures";

const live = vi.hoisted(() => ({ state: null as unknown as SignalCheckState, listeners: new Set<() => void>() }));

vi.mock("@/market", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/market")>();
  const { useSyncExternalStore } = await import("react");
  const subscribe = (cb: () => void) => {
    live.listeners.add(cb);
    return () => void live.listeners.delete(cb);
  };
  return { ...actual, useSignalCheck: () => useSyncExternalStore(subscribe, () => live.state, () => live.state) };
});

import { MotionRoot } from "@/motion/MotionRoot";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { SignalCard } from "@/views/overview/SignalCard";
import { SignalStrip } from "@/views/overview/SignalStrip";
import { divHitLine, partChips, partViews, srView, traderCells } from "@/views/overview/signalView";

const bottom = (barsAgo = 1) => ({ kind: "bottom" as const, barsAgo });

/** Long entry (30m + 45m), 1h zone in discount with a support 0,5 ATR below and a resistance 3 R away, a 1h divergence. */
function snap(traders = traderReadingOf(), cfg = UI_CFG) {
  const close = 81_200;
  return gradedSnapshot(
    [
      v2check("30m", { long: bottom(), rsi: 28 }),
      v2check("45m", { long: bottom(), rsi: 33 }),
      v2check("1h", { rsi: 36, pos: 0.2, div: [divHit()], structure: structureAt(close, { price: 81_000, distAtr: 0.5 }, { price: 84_200, label: "Swing-Hoch" }) }),
      v2check("4h", { rsi: 44, div: [divHit({ kind: "hidden", osc: "wt", state: "provisional" })] }),
    ],
    traders,
    cfg,
  );
}

function publish(s: Partial<SignalCheckState>): void {
  live.state = { state: "ok", snapshot: null, updatedAt: 1, message: null, ...s };
  for (const l of [...live.listeners]) l();
}
const wrap = (node: React.ReactNode) =>
  render(
    <MotionRoot>
      <MorphDialogProvider>{node}</MorphDialogProvider>
    </MotionRoot>,
  );

describe("part view models", () => {
  it("Top-Trader cells: values with the side word, the thresholds, lit flags (short mirrored)", () => {
    const s = snap();
    const p = s.long.parts!.find((x) => x.id === "traders")!;
    expect(traderCells(p, UI_CFG)).toEqual([
      { id: "pos", title: "Positionen", value: "66,0 % Long", sub: "Ziel > 64 % Long", met: true },
      { id: "acc", title: "Konten", value: "65,2 % Long", sub: "Ziel > 64 % Long", met: true },
      { id: "retail", title: "Whale–Retail", value: "−3,5 pp · 1h −2,1", sub: "Ziel rot: < 0 oder fällt ≥ 1 pp (1h)", met: true },
      { id: "zone", title: "Zone", value: "Discount · 20 %", sub: "Ziel Discount · 1h", met: true },
    ]);
    const short = s.short.parts!.find((x) => x.id === "traders")!;
    expect(traderCells(short, UI_CFG).map((c) => [c.value, c.met])).toEqual([
      ["34,0 % Short", false],
      ["34,8 % Short", false],
      ["−3,5 pp · 1h −2,1", false],
      ["Discount · 20 %", false],
    ]);
    expect(traderCells(short, UI_CFG)[2]!.sub).toBe("Ziel grün: > 0 oder steigt ≥ 1 pp (1h)");
    // no reading: every value "–", met null
    const none = snap(null as never).long.parts!.find((x) => x.id === "traders")!;
    expect(traderCells(none, UI_CFG).slice(0, 3).every((c) => c.value === "–" && c.met === null)).toBe(true);
    // the settings' thresholds and window reach the target text
    const strict = sanitizeSignalCfg({ whale: { deltaRed: -2, deltaFall: 0.5, deltaWindow: "4h" } });
    const ps = snap(traderReadingOf({ deltaWindow: "4h" }), strict).long.parts!.find((x) => x.id === "traders")!;
    expect(traderCells(ps, strict)[2]).toMatchObject({ value: "−3,5 pp · 4h −2,1", sub: "Ziel rot: < −2 oder fällt ≥ 0,5 pp (4h)", met: true });
  });

  it("views, divergence line, S/R meters and the strip chips", () => {
    const s = snap();
    const views = partViews(s.long);
    expect(views.map((v) => [v.id, v.tone])).toEqual([
      ["traders", "ok"],
      ["div", "ok"],
      ["sr", "ok"],
    ]);
    expect(views[0]!.pointsText).toBe("+10 von 10");
    const div = s.long.parts!.find((x) => x.id === "div")!;
    expect(divHitLine(div)).toBe("1h · RSI regulär: Tief 81.240 → 80.950 · RSI 28,1 → 31,4 · vor 2 Kerzen");
    const sr = srView(s.long.parts!.find((x) => x.id === "sr")!, UI_CFG);
    expect(sr.near).toMatchObject({ level: "Demand-OB 81.000", value: "0,5 ATR", met: true, band: 1, max: 2 });
    expect(sr.room).toMatchObject({ level: "Swing-Hoch 84.200", met: true, minR: 2 });
    expect(sr.room.value).toMatch(/^\d+,\d R$/);
    expect(partChips(s.long).map((c) => `${c.label} ${c.value}`)).toEqual(["Top-Trader 4/4", "Divergenz 1h", expect.stringMatching(/^S\/R \d+,\d R$/)]);
  });
});

describe("SignalCard parts", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(() => live.listeners.clear());

  it("lights the scorecard with its four values, the points and +1 Stärke; divergence rows and S/R meters", () => {
    live.state = { state: "ok", snapshot: snap(), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const section = screen.getByRole("region", { name: "Teil-Bedingungen" });
    expect(within(section).getByText(/^zählen anteilig · \+\d+,\d Punkte$/)).toBeInTheDocument();
    const tt = screen.getByTestId("signal-whale");
    expect(tt).toHaveAttribute("data-lit", "true");
    expect(tt).toHaveAttribute("data-state", "ok");
    expect(within(tt).getByText("Top-Trader long · Retail rot")).toBeInTheDocument();
    const cells = within(tt).getAllByTestId("signal-part-cell");
    expect(cells.map((c) => c.getAttribute("data-met"))).toEqual(["true", "true", "true", "true"]);
    expect(cells[0]).toHaveTextContent("Positionen");
    expect(cells[0]).toHaveTextContent("66,0 % Long");
    expect(cells[2]).toHaveTextContent("Whale–Retail");
    expect(cells[2]).toHaveTextContent("−3,5 pp · 1h −2,1");
    expect(cells[2]).toHaveTextContent("Ziel rot: < 0 oder fällt ≥ 1 pp (1h)");
    expect(within(cells[2]!).getByTestId("signal-delta-shares")).toHaveTextContent("Konten 65,2 % · Retail 68,7 %");
    // the last hour as a static sparkline: 12 points, the zero line (it lies near the curve), the newest point as a dot
    const spark = within(cells[2]!).getByTestId("signal-delta-spark");
    expect(spark).toHaveAttribute("data-points", "12");
    expect(spark).toHaveAccessibleName("Delta letzte Stunde: −1,6 → −3,5 pp");
    expect(spark.querySelectorAll("path")[0]!.getAttribute("d")!.match(/[ML]/g)).toHaveLength(12);
    expect(spark.querySelectorAll("line")).toHaveLength(1);
    expect(cells[3]).toHaveTextContent("Discount · 20 %");
    expect(within(tt).getByTestId("signal-part-points")).toHaveTextContent("+10 von 10+1 Stärke");
    // divergences: per rung, the 4h hit is provisional (desaturated), the line names the best hit
    const div = screen.getByTestId("signal-div");
    const rows = within(div).getAllByTestId("signal-div-row");
    expect(rows.map((r) => `${r.getAttribute("data-tf")}:${r.getAttribute("data-state")}`)).toEqual(["30m:none", "45m:none", "1h:confirmed", "4h:provisional"]);
    expect(within(div).getByTestId("signal-div-hit")).toHaveTextContent("1h · RSI regulär: Tief 81.240 → 80.950");
    // S/R: the level leaned on and the target with its R
    const sr = screen.getByTestId("signal-sr");
    expect(within(sr).getByText("0,5 ATR")).toBeInTheDocument();
    expect(within(sr).getByTestId("signal-sr-lean")).toHaveTextContent("Demand-OB 81.000");
    expect(within(sr).getByTestId("signal-sr-target")).toHaveTextContent("Swing-Hoch 84.200 · 1h");
    // the reasons carry one row per part
    const reasons = screen.getByRole("list", { name: "Bedingungen" });
    expect(within(reasons).getByText("Top-Trader long · Retail rot (4 von 4)")).toBeInTheDocument();
  });

  it("partial credit, the short mirror and keine Daten without a reading (never a fail)", () => {
    live.state = { state: "ok", snapshot: snap(traderReadingOf({ position: 60, account: 66 })), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const tt = screen.getByTestId("signal-whale");
    expect(tt).toHaveAttribute("data-state", "ok"); // 3 of 4 = bonusParts
    expect(within(tt).getAllByTestId("signal-part-cell").map((c) => c.getAttribute("data-met"))).toEqual(["false", "true", "true", "true"]);
    expect(within(tt).getByTestId("signal-part-points")).toHaveTextContent("+7,5 von 10");
    // the label keeps the room of "+10 von 10 +1 Stärke" without the bonus too: the bonus coming and going never
    // re-wraps the title (the part and the card below it jumped)
    expect(within(tt).getByTestId("signal-part-points")).toHaveClass("min-w-[18ch]", "text-right");
    fireEvent.click(screen.getByRole("radio", { name: "Short" }));
    expect(screen.getByTestId("signal-whale")).toHaveAttribute("data-state", "open");
    expect(within(screen.getByTestId("signal-whale")).getByText("Top-Trader short · Retail grün")).toBeInTheDocument();
    act(() => publish({ snapshot: snap(null as never), updatedAt: 2 }));
    const none = screen.getByTestId("signal-whale");
    expect(none).toHaveAttribute("data-state", "none");
    expect(within(none).getByTestId("signal-part-points")).toHaveTextContent("keine Daten");
    expect(within(none).queryByTestId("signal-delta-spark")).toBeNull();
    expect(within(none).queryByTestId("signal-delta-shares")).toBeNull();
    expect(within(none).getByText(/Binance-Top-Trader-Daten fehlen/)).toBeInTheDocument();
  });

  it("the sparkline follows the 5-min series (a new point redraws it); a reading without history shows the level only", () => {
    live.state = { state: "ok", snapshot: snap(), updatedAt: 1, message: null };
    wrap(<SignalCard />);
    const cell = () => within(screen.getByTestId("signal-whale")).getAllByTestId("signal-part-cell")[2]!;
    expect(within(cell()).getByTestId("signal-delta-spark")).toHaveAccessibleName("Delta letzte Stunde: −1,6 → −3,5 pp");
    const next = [...traderReadingOf().deltaSeries!.slice(1), { time: traderReadingOf().at + 300_000, delta: -4.2 }];
    act(() => publish({ snapshot: snap(traderReadingOf({ at: traderReadingOf().at + 300_000, delta: -4.2, deltaChg: -2.6, deltaSeries: next })), updatedAt: 2 }));
    expect(within(cell()).getByTestId("signal-delta-spark")).toHaveAccessibleName("Delta letzte Stunde: −1,8 → −4,2 pp");
    expect(cell()).toHaveTextContent("−4,2 pp · 1h −2,6");
    act(() => publish({ snapshot: snap(traderReadingOf({ deltaPrev: null, deltaChg: null, deltaSeries: [] })), updatedAt: 3 }));
    expect(within(cell()).queryByTestId("signal-delta-spark")).toBeNull();
    expect(cell()).toHaveTextContent("−3,5 pp");
    expect(cell()).not.toHaveTextContent("1h −");
    expect(cell()).toHaveAttribute("data-met", "true"); // negative is enough
  });

  it("switched-off parts are not shown (and the section disappears when all are off)", () => {
    const off = sanitizeSignalCfg({ whale: { on: false } });
    live.state = { state: "ok", snapshot: snap(traderReadingOf(), off), updatedAt: 1, message: null };
    const { unmount } = wrap(<SignalCard />);
    expect(screen.queryByTestId("signal-whale")).toBeNull();
    expect(screen.getByTestId("signal-div")).toBeInTheDocument();
    unmount();
    const none = sanitizeSignalCfg({ whale: { on: false }, div: { on: false }, sr: { on: false } });
    live.state = { state: "ok", snapshot: snap(traderReadingOf(), none), updatedAt: 2, message: null };
    wrap(<SignalCard />);
    expect(screen.queryByTestId("signal-parts")).toBeNull();
  });
});

describe("SignalStrip parts line", () => {
  beforeAll(() => installDomPolyfills());

  it("one slim line per part, the Top-Trader one lit, and the combo in the accessible name while it holds", () => {
    live.state = { state: "ok", snapshot: snap(), updatedAt: 1, message: null };
    wrap(<SignalStrip />);
    const strip = screen.getByTestId("signal-strip");
    const tt = within(strip).getByTestId("signal-strip-whale");
    expect(tt).toHaveAttribute("data-lit", "true");
    expect(tt).toHaveTextContent("Top-Trader4/4");
    expect(within(strip).getByTestId("signal-strip-div")).toHaveTextContent("Divergenz1h");
    expect(strip).toHaveAccessibleName(/Score \d+ von 100\. Top-Trader long · Retail rot\. Details ansehen$/);
  });

  it("keine Daten when there is no reading", () => {
    live.state = { state: "ok", snapshot: snap(null as never), updatedAt: 1, message: null };
    wrap(<SignalStrip />);
    const tt = within(screen.getByTestId("signal-strip")).getByTestId("signal-strip-whale");
    expect(tt).toHaveAttribute("data-state", "none");
    expect(tt).toHaveTextContent("Top-Trader–");
  });
});
