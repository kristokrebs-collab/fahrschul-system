/**
 * F38 Lernmodus (`src/views/ueben`) on the real journal store with a stubbed candle loader and a recording chart:
 * the chart is only ever handed candles that closed before the entry (no future in the price range or the time axis), an
 * incomplete decision is refused and stores nothing, the decision is STORED (with its time) before the whole course is
 * handed to the chart, the reflection is stored, and the history states its sample size.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichTrade } from "@/domain/enrich";
import { trainingRoundOf, trainingRoundsOf, type TrainingRound } from "@/domain/training";
import type { Trade } from "@/domain/types";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const STEP = 3_600_000;
const T0 = Date.UTC(2026, 5, 1);
const BARS = Array.from({ length: 220 }, (_, i) => {
  const base = 100 + i * 0.1;
  return { time: T0 + i * STEP, open: base, high: base + 0.5, low: base - 0.5, close: base + 0.05, volume: 1 };
});
/** the entry falls into candle 120 */
const ENTRY_MS = BARS[120]!.time + 10 * 60_000;
const EXIT_MS = BARS[130]!.time + 10 * 60_000;
const local = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** what the (stubbed) chart was handed, per render */
const chartCalls: { bars: { time: number; high: number; low: number }[]; showTrade: boolean; lines: { label: string }[]; hasExit: boolean }[] = [];

vi.mock("@/chart/ReplayChart", () => ({
  default: (p: { bars: { time: number; high: number; low: number }[]; showTrade?: boolean; lines?: { label: string }[]; trade: { exit: number | null; exitIndex: number | null } }) => {
    chartCalls.push({ bars: p.bars, showTrade: p.showTrade ?? true, lines: p.lines ?? [], hasExit: p.trade.exit != null || p.trade.exitIndex != null });
    return <div data-testid="chart-stub" data-ready="true" />;
  },
}));
vi.mock("@/market", async (orig) => ({ ...(await orig<typeof import("@/market")>()), useProvider: () => ({ symbol: "BTCUSDT" }) }));
vi.mock("@/market/excursion", async (orig) => ({ ...(await orig<typeof import("@/market/excursion")>()), loadBars: vi.fn(async () => BARS), measurablePair: () => true }));

import { CaseView } from "@/views/ueben/CaseView";
import { HistoryCard } from "@/views/ueben/HistoryCard";

const trade: Trade = {
  id: "t_case",
  account: "scalp",
  side: "long",
  status: "closed",
  date: local(ENTRY_MS),
  exitDate: local(EXIT_MS),
  pair: "BTC/USDT",
  timeframe: "1h",
  entry: 112.1,
  stop: 111,
  target: null,
  exit: 113.5,
  size: 100,
  leverage: 1,
  fees: 0,
  pnlManual: null,
  setups: ["s_bo"],
  checks: {},
  conviction: null,
  followedPlan: null,
  emotion: "",
  reason: "",
  notes: "",
  chart: "",
  pnl: 10,
  r: 1.2,
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-01T00:00:00Z",
} as Trade;

function mount(onDone = vi.fn(), over: { positive?: boolean; blind?: boolean } = {}) {
  const settings = useJournal.getState().settings;
  const setup = settings.setups.find((s) => s.id === "s_bo")!;
  const enriched = enrichTrade(trade, settings);
  const items = enriched.items;
  render(
    <MotionRoot>
      <CaseView trade={enriched} positive={over.positive ?? true} setup={setup} setups={settings.setups} items={items} blind={over.blind ?? true} index={0} total={2} isLast={false} onDone={onDone} />
    </MotionRoot>,
  );
  return { onDone, items, setup };
}

const stored = () => trainingRoundsOf(useJournal.getState().settings);

describe("Lernmodus – ein Fall", () => {
  beforeAll(() => {
    installDomPolyfills();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    cleanup();
    localStorage.clear();
    chartCalls.length = 0;
    await bootFixtureJournal();
  });

  it("der Chart bekommt nur Kerzen, die vor dem Einstieg geschlossen haben – weder Ausstieg noch eigenen Trade; Name und Datum sind verdeckt", async () => {
    mount();
    await screen.findByTestId("training-form");
    expect(screen.getByTestId("training-case-head")).toHaveTextContent("Markt und Datum verdeckt");
    await waitFor(() => expect(chartCalls.length).toBeGreaterThan(0));
    for (const c of chartCalls) {
      expect(c.bars.length).toBeGreaterThan(20);
      expect(Math.max(...c.bars.map((b) => b.time)) + STEP).toBeLessThanOrEqual(ENTRY_MS);
      expect(c.showTrade).toBe(false);
      expect(c.hasExit).toBe(false);
      // not even the price range of a later candle is in what the chart gets
      expect(Math.max(...c.bars.map((b) => b.high))).toBeLessThan(BARS[120]!.high);
    }
    expect(screen.queryByTestId("training-reveal")).toBeNull();
  });

  it("eine unvollständige Entscheidung wird mit den Lücken verweigert und speichert nichts", async () => {
    mount();
    await screen.findByTestId("training-form");
    fireEvent.click(screen.getByTestId("training-commit"));
    const gaps = await screen.findByTestId("training-gaps");
    expect(gaps).toHaveTextContent("Einordnen");
    expect(gaps).toHaveTextContent("Entscheiden");
    expect(gaps).toHaveTextContent("Begründung");
    expect(stored()).toHaveLength(0);
    expect(screen.queryByTestId("training-reveal")).toBeNull();
    // a Long without a stop on the right side is refused with its reason
    fireEvent.click(screen.getByRole("radio", { name: "Ja" }));
    fireEvent.click(screen.getByRole("radio", { name: "Long" }));
    fireEvent.change(screen.getByLabelText("Begründung in einem Satz"), { target: { value: "Retest" } });
    fireEvent.change(screen.getByLabelText("Stopp-Kurs"), { target: { value: "999" } });
    fireEvent.click(screen.getByTestId("training-commit"));
    expect(await screen.findByTestId("training-gaps")).toHaveTextContent("Ein Long-Stopp gehört unter den Kurs");
    expect(stored()).toHaveLength(0);
  });

  it("die Entscheidung wird gespeichert, bevor der Verlauf erscheint; die Regelbefolgung ist eine Checkliste; die Reflexion wird gespeichert", async () => {
    const { onDone, items } = mount();
    await screen.findByTestId("training-form");
    fireEvent.click(screen.getByRole("radio", { name: "Ja" }));
    fireEvent.click(screen.getByRole("radio", { name: "Long" }));
    const lastClose = BARS[119]!.close;
    fireEvent.change(screen.getByLabelText("Stopp-Kurs"), { target: { value: String(lastClose - 1).replace(".", ",") } });
    const rules = within(screen.getByRole("group", { name: "Regeln des Setups" }));
    expect(rules.getAllByRole("checkbox")).toHaveLength(items.length);
    for (const box of rules.getAllByRole("checkbox")) fireEvent.click(box); // every rule ticked
    fireEvent.change(screen.getByLabelText("Begründung in einem Satz"), { target: { value: "Retest hält" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("training-commit"));
    });
    const reveal = await screen.findByTestId("training-reveal");
    // stored: the decision with its time, the rule result, and the reveal time not before the decision
    const [round] = stored() as [TrainingRound];
    expect(round).toMatchObject({ setupId: "s_bo", tradeId: "t_case", positive: true, blind: true, recognized: true, decision: { action: "long", recognition: "yes", reason: "Retest hält" }, rules: { followed: true, stopOk: true } });
    expect(round.decision.stop).toBeCloseTo(lastClose - 1, 10);
    expect(Date.parse(round.revealedAt!)).toBeGreaterThanOrEqual(Date.parse(round.decision.at));
    expect(round.anchorMs).toBe(BARS[119]!.time);
    // only now the chart gets the whole course (and the real trade)
    await waitFor(() => expect(chartCalls.some((c) => c.bars.length === BARS.length && c.showTrade)).toBe(true));
    expect(within(reveal).getByTestId("mark-recognition")).toHaveAttribute("data-value", "yes");
    expect(within(reveal).getByTestId("mark-rules")).toHaveAttribute("data-value", "yes");
    expect(within(reveal).getByTestId("training-then")).toHaveTextContent("Das Ergebnis dieses Trades zählt für die Auswertung nicht");
    expect(within(reveal).getByTestId("training-plan")).toHaveTextContent("Dein Plan auf den echten Kerzen");
    expect(screen.getByTestId("training-case-head")).toHaveTextContent("BTC/USDT");
    // reflection
    expect(within(reveal).getByTestId("mark-reflection")).toHaveAttribute("data-value", "none");
    fireEvent.click(screen.getByRole("radio", { name: "Anders als gedacht" }));
    fireEvent.change(screen.getByLabelText("Reflexion"), { target: { value: "  Zu früh  " } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("training-reflect-save"));
    });
    await waitFor(() => expect(within(reveal).getByTestId("mark-reflection")).toHaveAttribute("data-value", "yes"));
    expect(stored()[0]!.reflection).toMatchObject({ verdict: "surprised", note: "Zu früh" });
    fireEvent.click(screen.getByTestId("training-next"));
    expect(onDone).toHaveBeenCalledWith(round.id);
  });

  it("Warten wird nicht als Regelbefolgung gezählt; eine falsche Einordnung ist keine Regelverletzung; unsicher zählt nicht", async () => {
    mount(vi.fn(), { positive: false });
    await screen.findByTestId("training-form");
    fireEvent.click(screen.getByRole("radio", { name: "Unsicher" }));
    fireEvent.click(screen.getByRole("radio", { name: "Warten" }));
    expect(screen.queryByLabelText("Stopp-Kurs")).toBeNull();
    fireEvent.change(screen.getByLabelText("Begründung in einem Satz"), { target: { value: "kein Retest" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("training-commit"));
    });
    const reveal = await screen.findByTestId("training-reveal");
    expect(stored()[0]).toMatchObject({ positive: false, recognized: null, decision: { action: "wait", stop: null }, rules: { followed: null, stopOk: null } });
    expect(within(reveal).getByTestId("mark-recognition")).toHaveAttribute("data-value", "none");
    expect(within(reveal).getByTestId("mark-rules")).toHaveAttribute("data-value", "none");
    expect(within(reveal).getByTestId("training-plan")).toHaveTextContent("Du hast gewartet");
  });

  it("ohne Kerzen-Daten sagt der Fall warum und lässt sich überspringen", async () => {
    const { loadBars } = await import("@/market/excursion");
    vi.mocked(loadBars).mockResolvedValueOnce([]);
    const onDone = vi.fn();
    mount(onDone);
    const note = await screen.findByTestId("training-notice");
    expect(note).toHaveTextContent("keine Kerzen");
    fireEvent.click(within(note).getByRole("button", { name: "Fall überspringen" }));
    expect(onDone).toHaveBeenCalledWith(null);
  });
});

describe("Verlaufskarte", () => {
  beforeAll(() => installDomPolyfills());
  const at = "2026-06-10T10:00:00.000Z";
  const r = (id: string, over: Partial<TrainingRound> = {}): TrainingRound => ({ id, v: 1, createdAt: at, updatedAt: at, setupId: "s_bo", tradeId: "t", positive: true, interval: "1h", anchorMs: T0, blind: true, decision: { action: "long", recognition: "yes", stop: 1, reason: "x", checks: {}, at }, rules: { checked: 1, total: 1, stopOk: true, followed: true }, recognized: true, ...over });

  it("nennt die Stichprobe bei jeder Zahl und sagt bei wenigen Runden, dass es zu wenig ist", () => {
    cleanup();
    render(<HistoryCard rounds={[r("a"), r("b", { positive: false }), r("c", { rules: { checked: 0, total: 2, stopOk: true, followed: false } })].map((x) => trainingRoundOf(x)!)} setups={[]} setupId={null} />);
    const card = screen.getByTestId("training-history");
    expect(within(card).getByTestId("hist-recognition")).toHaveTextContent("2 von 3");
    expect(within(card).getByTestId("hist-recognition")).toHaveTextContent("n = 3 · zu wenig für eine Aussage");
    expect(within(card).getByTestId("hist-rules")).toHaveTextContent("2 von 3");
    expect(within(card).getByTestId("hist-reflection")).toHaveTextContent("–");
    expect(card).not.toHaveTextContent("%");
    expect(within(card).getAllByRole("listitem")).toHaveLength(3);
  });

  it("ohne Runden: ehrlicher Leerzustand; ab 10 Runden erscheint der Prozentwert", () => {
    cleanup();
    const { rerender } = render(<HistoryCard rounds={[]} setups={[]} setupId={null} />);
    expect(screen.getByTestId("training-history")).toHaveTextContent("Noch keine Runde geübt");
    rerender(<HistoryCard rounds={Array.from({ length: 10 }, (_, i) => r(`x${i}`))} setups={[]} setupId="s_bo" />);
    expect(screen.getByTestId("hist-recognition")).toHaveTextContent("10 von 10 (100 %)");
  });
});
