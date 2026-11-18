/** Insights: results by candle-close state and the effect of the graded parts of v2 snapshots. */
import { render, screen, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { partEffects, SignalStrengthCard, stateRows } from "@/views/insights/SignalStrengthCard";
import { closedOf, enrich, qt, theirSnap, utc } from "./insights.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const traders = (ok: boolean, pos: boolean | null, data = true) => ({
  id: "traders",
  grade: 0.5,
  points: 5,
  weight: 10,
  ok,
  data,
  state: "confirmed",
  met: 2,
  items: [
    { id: "pos", met: data ? pos : null, raw: data ? 66 : null },
    { id: "acc", met: data ? false : null, raw: data ? 60 : null },
    { id: "retail", met: data ? true : null, raw: data ? -0.4 : null },
    { id: "zone", met: data ? false : null, raw: data ? 0.5 : null },
  ],
});
const div = (ok: boolean) => ({ id: "div", grade: ok ? 0.8 : 0, points: ok ? 8 : 0, weight: 10, ok, data: true, state: ok ? "confirmed" : "none", items: [] });
const v2 = (state: string, parts: unknown[]) => theirSnap("long", 2, { v: 2, state, parts });

describe("stateRows", () => {
  it("groups trades by the stored candle-close state; older snapshots are `Ohne Status`, trades without a check are left out", () => {
    const closed = closedOf(
      enrich([
        qt(utc(2026, 9, 1), { p: 100, signal: v2("strong", []) }),
        qt(utc(2026, 9, 2), { p: -50, signal: v2("confirmed", []) }),
        qt(utc(2026, 9, 3), { p: 30, signal: v2("confirmed", []) }),
        qt(utc(2026, 9, 4), { p: -40, signal: v2("provisional", []) }),
        qt(utc(2026, 9, 5), { p: 20, signal: theirSnap("long", 1) }),
        qt(utc(2026, 9, 6), { p: 10 }),
      ]),
    );
    const rows = stateRows(closed);
    expect(rows.map((r) => [r.key, r.g.n])).toEqual([
      ["strong", 1],
      ["confirmed", 2],
      ["provisional", 1],
      ["unknown", 1],
    ]);
    expect(rows[2]!.label).toBe("Vorläufig (Kerze offen)");
  });

  it("is empty while no snapshot carries a state (the section stays hidden)", () => {
    expect(stateRows(closedOf(enrich([qt(utc(2026, 9, 1), { p: 5, signal: theirSnap("long", 2) })])))).toEqual([]);
  });
});

describe("partEffects", () => {
  it("win rate with vs without each part / item among trades that stored it with data; keine Daten counted apart", () => {
    const closed = closedOf(
      enrich([
        qt(utc(2026, 9, 1), { p: 100, risk: 50, signal: v2("confirmed", [traders(true, true), div(true)]) }),
        qt(utc(2026, 9, 2), { p: 80, risk: 40, signal: v2("confirmed", [traders(true, true), div(false)]) }),
        qt(utc(2026, 9, 3), { p: -50, risk: 50, signal: v2("confirmed", [traders(false, false), div(false)]) }),
        qt(utc(2026, 9, 4), { p: -60, risk: 60, signal: v2("confirmed", [traders(false, null, false)]) }),
        qt(utc(2026, 9, 5), { p: 40, signal: theirSnap("long", 1) }), // before the parts existed
      ]),
    );
    const e = partEffects(closed);
    const by = Object.fromEntries(e.map((x) => [x.key, x]));
    expect(Object.keys(by)).toEqual(["traders", "traders-pos", "traders-acc", "traders-retail", "div"]);
    expect(by.traders).toMatchObject({ noData: 1 });
    expect(by.traders!.met.n).toBe(2);
    expect(by.traders!.missed.n).toBe(1);
    expect(by.traders!.dWin).toBeCloseTo(1, 10);
    expect(by["traders-pos"]).toMatchObject({ sub: true, noData: 1 });
    // accounts never held → no comparison possible
    expect(by["traders-acc"]!.met.n).toBe(0);
    expect(by["traders-acc"]!.dWin).toBeNull();
    expect(by.div!.met.n).toBe(1);
    expect(by.div!.missed.n).toBe(2);
    expect(by.div!.noData).toBe(0);
  });

  it("no v2 snapshots → no part rows", () => {
    expect(partEffects(closedOf(enrich([qt(utc(2026, 9, 1), { p: 5, signal: theirSnap("long", 2) })])))).toEqual([]);
  });
});

describe("SignalStrengthCard with v2 snapshots", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("shows the Kerzenschluss table and the part rows under Wirkung der Bedingungen", () => {
    const trades = useJournal.getState().trades;
    const states = ["strong", "confirmed", "provisional"];
    let i = 0;
    useJournal.setState({
      trades: trades.map((t) => {
        const k = i++;
        return { ...t, signal: theirSnap(t.side, 2, { v: 2, state: states[k % 3], parts: [traders(k % 2 === 0, k % 2 === 0), div(k % 3 === 0)] }) };
      }),
    });
    render(
      <MotionRoot>
        <SignalStrengthCard />
      </MotionRoot>,
    );
    const table = screen.getByTestId("insights-signal-state");
    expect(within(table).getByText("Kerzenschluss")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: /Stark bestätigt/ })).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: /Vorläufig \(Kerze offen\)/ })).toBeInTheDocument();
    expect(within(screen.getByTestId("insights-signal-part-traders")).getByText("Top-Trader-Kombi erfüllt")).toBeInTheDocument();
    expect(within(screen.getByTestId("insights-signal-part-traders-pos")).getByText(/^mit \d+ ·/)).toBeInTheDocument();
    expect(screen.getByTestId("insights-signal-part-div")).toHaveTextContent("Divergenz (regulär, bestätigt)");
  });
});
