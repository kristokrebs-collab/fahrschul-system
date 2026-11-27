/**
 * „Passt zu dir?“ (F49) in the Labor: the card appears under a finished run, lists frictions and agreements with both
 * figures, names its samples, has no score, and says honestly when the journal is too small. A stub run (the card reads only
 * trades, period, drawdown and the risk setting) against a hand-built journal (`fit.fixtures.ts`).
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MotionRoot } from "@/motion/MotionRoot";
import type { LabResult } from "@/domain/backtest/job";
import { idea, journalRaw } from "./fit.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const { FitCard } = await import("@/views/labor/FitCard");
const { useLabor, __resetLabor } = await import("@/views/labor");
const { useJournal } = await import("@/store/journalStore");

function stubRun(trades = idea().trades, extra: { interval?: string; strategy?: string; cfg?: Record<string, unknown> } = {}): void {
  const run = idea();
  const result = {
    strategy: extra.strategy ?? "custom",
    name: "Test-Idee",
    from: run.from,
    to: run.to,
    interval: extra.interval,
    stats: { maxDD: run.maxDD },
    trades: trades.map((t, i) => ({ id: `b${i}`, ...t })),
  } as unknown as LabResult;
  useLabor.setState({ result, runCfg: { riskPct: run.riskPct, ...extra.cfg } as never, status: "done" });
}

const wrap = () =>
  render(
    <MotionRoot>
      <FitCard />
    </MotionRoot>,
  );

beforeAll(() => installDomPolyfills());
beforeEach(async () => {
  localStorage.clear();
  await bootFixtureJournal();
  __resetLabor();
});
afterEach(() => __resetLabor());

describe("FitCard", () => {
  it("renders nothing before a result", () => {
    wrap();
    expect(screen.queryByTestId("labor-fit")).toBeNull();
  });

  it("frictions and agreements with both figures, the samples named, no score", async () => {
    useJournal.setState({ trades: journalRaw() });
    stubRun();
    wrap();
    const card = await screen.findByTestId("labor-fit");
    expect(card).toHaveAttribute("data-status", "ok");
    expect(screen.getByTestId("fit-sample").textContent).toContain("Idee „Test-Idee“: 10 Trades im Test");
    expect(screen.getByTestId("fit-sample").textContent).toContain("Dein Journal: 24 abgeschlossene Trades");
    const frictions = screen.getByTestId("fit-group-friction");
    const ids = within(frictions).getAllByTestId("fit-item").map((i) => i.getAttribute("data-id"));
    // risk and discipline depend on the fixture journal's own settings (capital) and the coach's detectors – not asserted here
    expect(ids.slice(0, 5)).toEqual(["hold", "streak", "drawdown", "frequency", "window"]);
    const streak = within(frictions).getAllByTestId("fit-item").find((i) => i.getAttribute("data-id") === "streak")!;
    expect(streak.textContent).toContain("Die Idee verlangt im Test bis zu 3 Verlusttrades in Folge auszuhalten; deine längste Serie waren 1.");
    expect(within(streak).getByText("Reibung")).toBeInTheDocument();
    // agreements are listed apart (the win rates overlap)
    const matches = screen.getByTestId("fit-group-match");
    expect(within(matches).getAllByTestId("fit-item")[0]).toHaveAttribute("data-id", "winRate");
    // no total score, no recommendation
    expect(card.textContent).not.toMatch(/\bscore\b|\bnote \d|\bpunkte\b|empfehle|geeignet/i);
    expect(screen.getByTestId("fit-caveat").textContent).toMatch(/sagt nicht, ob du die Idee handeln solltest/);
  });

  it("a journal with too few trades is an honest empty state with the number", async () => {
    useJournal.setState({ trades: journalRaw().slice(0, 7) });
    stubRun();
    wrap();
    const empty = await screen.findByTestId("fit-empty");
    expect(empty.textContent).toContain("7 Trades abgeschlossen");
    expect(screen.getByTestId("labor-fit")).toHaveAttribute("data-status", "journalFew");
    expect(screen.queryByTestId("fit-items")).toBeNull();
  });

  it("an empty journal says so", async () => {
    useJournal.setState({ trades: [] });
    stubRun();
    wrap();
    await waitFor(() => expect(screen.getByTestId("labor-fit")).toHaveAttribute("data-status", "journalNone"));
    expect(screen.getByTestId("fit-empty").textContent).toMatch(/noch keinen abgeschlossenen Trade/);
  });

  it("a run with fewer than 10 trades is not compared", async () => {
    useJournal.setState({ trades: journalRaw() });
    stubRun(idea().trades.slice(0, 6));
    wrap();
    await waitFor(() => expect(screen.getByTestId("labor-fit")).toHaveAttribute("data-status", "strategyFew"));
    expect(screen.getByTestId("fit-empty").textContent).toContain("6 Trades");
  });

  it("the unknowns are listed apart with their reason (no exit times in the journal)", async () => {
    useJournal.setState({ trades: journalRaw({ exits: false }) });
    stubRun();
    wrap();
    const unknown = await screen.findByTestId("fit-group-unknown");
    // the stub run names no candle and no rule list: the three effort statements say so, next to the hold time
    expect(within(unknown).getAllByTestId("fit-item").map((i) => i.getAttribute("data-id"))).toEqual(["hold", "cadence", "ruleload", "timebudget"]);
    expect(unknown.textContent).toContain("Nicht beurteilbar");
    expect(unknown.textContent).toContain("Der Lauf nennt keine Kerzengröße");
  });

  it("Prüftakt: a 15-minute idea against 4-hour trades is a friction with both rhythms; the rule parts are counted for the lab rules", async () => {
    useJournal.setState({ trades: journalRaw() });
    stubRun(idea().trades, { interval: "15m", strategy: "rules", cfg: { rules: { interval: "15m", side: "long", conds: [{ kind: "rsiBelow", a: 30 }, { kind: "closeAboveEma", a: 200 }] } } });
    wrap();
    const frictions = await screen.findByTestId("fit-group-friction");
    const cadence = within(frictions).getAllByTestId("fit-item").find((i) => i.getAttribute("data-id") === "cadence")!;
    expect(cadence.textContent).toContain("auf jeder 15 Min-Kerze (96-mal am Tag)");
    expect(cadence.textContent).toContain("4 Std-Kerzen (6-mal am Tag)");
    // the rule list of the lab rules: two conditions, no further exit rules – compared with the journal's checklists (or said to be missing)
    const all = screen.getAllByTestId("fit-item");
    const load = all.find((i) => i.getAttribute("data-id") === "ruleload")!;
    expect(load.textContent).toContain("2 Regelteile (2 Bedingungen + 0 Ausstiegsregeln)");
    expect(load.textContent).toContain("Punkte je Checkliste");
  });

  it("a fixed template has no rule list to count", async () => {
    useJournal.setState({ trades: journalRaw() });
    stubRun(idea().trades, { interval: "4h", strategy: "box" });
    wrap();
    await screen.findByTestId("fit-items");
    const load = screen.getAllByTestId("fit-item").find((i) => i.getAttribute("data-id") === "ruleload")!;
    expect(load.getAttribute("data-kind")).toBe("unknown");
    expect(load.textContent).toContain("feste Logik");
  });
});
