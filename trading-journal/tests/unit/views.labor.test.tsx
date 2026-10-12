/**
 * P07 views:
 * - Labor page (`src/views/labor`): idle set-up, a full run on REAL Binance BTCUSDT.P 4h bars served by a mocked REST
 *   client through the lab's own history loader (forward paging, closed bars only), result cards, the reference hold
 *   writing `settings.backtest`, the replay model, and the honest error without Binance.
 * - Setups additions (`src/views/setups`): the strategy sections of the editor, library filter, comparison sheet,
 *   strategy block / profile and the bulk classification.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SIGNAL_CFG } from "@/domain/signals";
import { EMPTY_AUTO, EMPTY_RISK, type StrategyExtras } from "@/domain/strategy";
import type { Trade } from "@/domain/types";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { __resetLabor, __setHistoryDeps, labReplayModel, LaborView, planOf, startLab, useLabor } from "@/views/labor";
import { SetupsView } from "@/views/setups";
import { StrategyFields } from "@/views/setups/StrategyFields";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

type Row = [number, number, number, number, number];
const H4: Row[] = (JSON.parse(readFileSync("tests/unit/fixtures/binance-btcusdt-4h.json", "utf8")) as { bars: Row[] }).bars;
const H4_MS = 14_400_000;
/** "now": one minute after the last fixture bar closed */
const NOW = H4[H4.length - 1]![0] * 1000 + H4_MS + 60_000;

/** A Binance REST double serving the fixture forward from `startTime` (what `/fapi/v1/klines` does). */
function fixtureRest(calls: { interval: string; startTime?: number; limit?: number }[]): BinanceRest {
  return {
    klines: vi.fn(async (_symbol: string, interval: string, p: { startTime?: number; limit?: number } = {}) => {
      calls.push({ interval, startTime: p.startTime, limit: p.limit });
      const rows = interval === "4h" ? H4.filter((b) => b[0] * 1000 >= (p.startTime ?? 0)).slice(0, p.limit ?? 500) : [];
      return { data: rows.map(([t, o, h, l, c]) => ({ time: t * 1000, open: o, high: h, low: l, close: c, volume: 1, closed: true })), asOf: NOW, receivedAt: NOW, source: "binance", comparable: true };
    }),
    fundingRate: vi.fn(async () => ({ data: [], asOf: NOW, receivedAt: NOW, source: "binance", comparable: true })),
  } as unknown as BinanceRest;
}

function renderLabor() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <LaborView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

beforeAll(() => {
  installDomPolyfills();
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  window.scrollTo = vi.fn() as never;
});

describe("LaborView", () => {
  beforeEach(async () => {
    await bootFixtureJournal();
    __resetLabor();
    __setHistoryDeps(null);
  });
  afterEach(() => {
    __resetLabor();
    __setHistoryDeps(null);
    vi.useRealTimers();
  });

  it("idle: h1 Labor, set-up, honest assumptions, start and estimate", () => {
    renderLabor();
    expect(screen.getByRole("heading", { level: 1, name: "Labor" })).toBeInTheDocument();
    expect(screen.getByTestId("labor-view")).toHaveAttribute("data-status", "idle");
    expect(screen.getByTestId("labor-strategy-box")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("labor-assumptions")).toHaveTextContent("Kein Blick in die Zukunft");
    expect(screen.getByTestId("labor-start")).toBeEnabled();
    expect(screen.getByTestId("labor-estimate")).toHaveTextContent(/Binance/);
    // no result yet: no robustness block, no reference
    expect(screen.queryByTestId("labor-verdict")).toBeNull();
    expect(screen.queryByTestId("labor-adopt")).toBeNull();
  });

  it("switching the strategy changes the plan (rules: 4h execution, own warm-up)", () => {
    renderLabor();
    fireEvent.click(screen.getByTestId("labor-strategy-rules"));
    expect(useLabor.getState().cfg.strategy).toBe("rules");
    expect(screen.getByTestId("labor-strategy-rules")).toHaveAttribute("aria-checked", "true");
    const plan = planOf(useLabor.getState().cfg, DEFAULT_SIGNAL_CFG);
    expect(plan.intervals).toEqual(["4h"]);
    expect(plan.warmupMs).toBeGreaterThan(0);
  });

  it("runs on real history: forward paging, KPIs, trades, robustness, reference hold → settings.backtest", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const calls: { interval: string; startTime?: number; limit?: number }[] = [];
    __setHistoryDeps({ rest: () => fixtureRest(calls), proxy: () => null, store: () => null, now: () => NOW });
    useLabor.getState().setCfg({ strategy: "rules", period: "6m", funding: "flat", rules: { interval: "4h", side: "long", conds: [{ kind: "rsiBelow", a: 40 }] } });
    renderLabor();
    await act(async () => {
      fireEvent.click(screen.getByTestId("labor-start"));
    });
    await waitFor(() => expect(screen.getByTestId("labor-run")).toHaveAttribute("data-status", "done"), { timeout: 30_000 });
    // paging: only 4h, forward, increasing startTime, Binance's page size
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.interval === "4h" && c.limit === 1500)).toBe(true);
    for (let i = 1; i < calls.length; i++) expect(calls[i]!.startTime!).toBeGreaterThan(calls[i - 1]!.startTime!);
    const st = useLabor.getState();
    expect(st.status).toBe("done");
    expect(st.result?.strategy).toBe("rules");
    expect(st.result?.trades.length).toBe(st.result?.stats.n);
    expect(st.fundingUsed).toBe("flat");
    // every bar the run used was closed at "now"
    expect(st.bars.every((b) => b.t * 1000 + H4_MS <= NOW)).toBe(true);

    expect(screen.getByTestId("labor-kpis")).toHaveTextContent("Trades");
    expect(screen.getByTestId("labor-race")).toHaveTextContent("Buy & Hold");
    expect(screen.getByTestId("labor-assumptions")).toHaveTextContent("geschlossene 4h-Kerzen BTCUSDT");
    expect(screen.getByTestId("labor-oos")).toBeInTheDocument();
    expect(screen.getByTestId("labor-wf")).toBeInTheDocument();
    expect(screen.getByTestId("labor-verdict").textContent?.trim()).not.toBe("");
    expect(within(screen.getByTestId("labor-heat")).getByRole("grid")).toBeInTheDocument();
    expect(within(screen.getByTestId("labor-compare")).getAllByTestId("labor-run-card")).toHaveLength(1);
    expect(useLabor.getState().runs).toHaveLength(1);

    // the replay model of the first trade: the run's own bars around entry/exit
    const t = st.result!.trades[0];
    if (t) {
      const m = labReplayModel(t, st.bars, H4_MS)!;
      expect(m.bars.length).toBeGreaterThan(t.exitIndex - t.entryIndex);
      expect(m.markers.map((x) => x.label)).toEqual(["Einstieg", "Ausstieg"]);
    }

    // "Als Backtest-Referenz übernehmen": activation without a pointer hold arms, the second confirms
    const adopt = screen.getByTestId("labor-adopt");
    await act(async () => {
      fireEvent.click(adopt);
    });
    await act(async () => {
      fireEvent.click(adopt);
    });
    await waitFor(() => expect(String(useJournal.getState().settings.backtest?.label ?? "")).toMatch(/^Labor · Regel-Baukasten 4h · BTCUSDT · \d+ Trades$/));
    const bt = useJournal.getState().settings.backtest!;
    expect(bt.winRate).toBeCloseTo(st.result!.stats.winRate ?? 0, 6);
    await waitFor(() => expect(screen.getByTestId("labor-reference")).toHaveTextContent("Backtest-Referenz übernommen"));
  }, 60_000);

  it("without Binance: an honest error, never a fake result", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    const down = { klines: vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))), fundingRate: vi.fn() } as unknown as BinanceRest;
    __setHistoryDeps({ rest: () => down, proxy: () => null, store: () => null, now: () => NOW });
    useLabor.getState().setCfg({ strategy: "rules", period: "3m", funding: "flat" });
    renderLabor();
    await act(async () => {
      await startLab(DEFAULT_SIGNAL_CFG, NOW);
    });
    expect(useLabor.getState().status).toBe("error");
    expect(useLabor.getState().result).toBeNull();
    expect(screen.getByTestId("labor-run")).toHaveTextContent(/Binance ist (gerade )?nicht erreichbar/);
  });
});

/* ------------------------------------------------------------------ Setups additions (P07) */

/** An untagged BTC long with a Box-zu-Box breakout A+ at entry (what the classifier recognises). */
const UNTAGGED = {
  id: "t_p07_untagged",
  account: "scalp",
  side: "long",
  status: "closed",
  date: "2026-05-04T10:00",
  pair: "BTC/USDT",
  timeframe: "4h",
  entry: 80000,
  stop: 79000,
  target: 83000,
  exit: 83000,
  size: 8000,
  leverage: 3,
  fees: 4,
  setups: [],
  checks: {},
  createdAt: "2026-05-04T10:00:00.000Z",
  updatedAt: "2026-05-04T10:00:00.000Z",
  boxSnap: { v: 1, symbol: "BTCUSDT", tf: "4h", at: 1, source: "retro", phase: "breakout", dir: 1, pos: 1.1, zone: "top", box: null, setup: { kind: "breakout", grade: "A+", score: 88, side: "long", entry: 80000, stop: 79000, rr: 3, targets: [83000] }, htf: null, rsi: null },
} as unknown as Trade;

function renderSetups() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <SetupsView />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

describe("Setups · Strategie (P07)", () => {
  beforeEach(async () => {
    await bootFixtureJournal();
    useUi.setState({ page: "setups" });
  });

  it("StrategyFields: criteria, quick exit chips and tags report patches", () => {
    const value: StrategyExtras = { entryCriteria: [], exitCriteria: [], riskModel: { ...EMPTY_RISK }, tags: [], examples: [], markets: [], tf: [], auto: { ...EMPTY_AUTO } };
    const onChange = vi.fn();
    render(<StrategyFields value={value} onChange={onChange} trades={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Entry-Kriterium" }));
    expect(onChange).toHaveBeenLastCalledWith({ entryCriteria: [expect.objectContaining({ text: "" })] });
    fireEvent.click(screen.getByRole("button", { name: "+ Ziel erreicht" }));
    expect(onChange).toHaveBeenLastCalledWith({ exitCriteria: [expect.objectContaining({ text: "Ziel erreicht" })] });
    const tags = screen.getByRole("textbox", { name: "Strategie-Tags" });
    fireEvent.change(tags, { target: { value: "Breakout" } });
    fireEvent.keyDown(tags, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith({ tags: ["Breakout"] });
  });

  it("library: search hides cards, an empty filter says so, reset brings them back", async () => {
    renderSetups();
    const lib = screen.getByTestId("setup-library");
    const search = within(lib).getByLabelText("Bibliothek durchsuchen");
    fireEvent.change(search, { target: { value: "Sweep" } });
    await waitFor(() => expect(screen.queryByTestId("setup-card-s_bo")).toBeNull());
    expect(screen.getByTestId("setup-card-s_sweep")).toBeInTheDocument();
    fireEvent.change(search, { target: { value: "gibtesnicht" } });
    await waitFor(() => expect(screen.getByTestId("setup-library-empty")).toBeInTheDocument());
    fireEvent.click(within(lib).getByRole("button", { name: "Filter zurücksetzen" }));
    await waitFor(() => expect(screen.getByTestId("setup-card-s_bo")).toBeInTheDocument());
  });

  it("comparison: two preset columns with a verdict, a third by choice, at most three", async () => {
    renderSetups();
    await act(async () => {
      fireEvent.click(screen.getByTestId("setup-compare-open"));
    });
    const cmp = await screen.findByTestId("setup-compare");
    expect(within(cmp).getAllByTestId("setup-compare-column")).toHaveLength(2);
    expect(within(cmp).getByTestId("setup-compare-verdict").textContent?.trim()).not.toBe("");
    const group = within(cmp).getByRole("group", { name: "Bis zu drei Grundlagen wählen" });
    const off = within(group)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "false");
    await act(async () => {
      fireEvent.click(off[0]!);
    });
    expect(within(cmp).getAllByTestId("setup-compare-column")).toHaveLength(3);
    await act(async () => {
      fireEvent.click(off[1]!);
    });
    expect(within(group).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(3);
  });

  it("strategy block only with strategy data; bulk classification assigns the sure match without overwriting", async () => {
    const s = useJournal.getState().settings;
    await act(async () => {
      await useJournal.getState().saveSettings({
        ...s,
        setups: s.setups.map((x) => (x.id === "s_bo" ? ({ ...x, account: "scalp", entryCriteria: [{ id: "e1", text: "Schlusskurs über der Box" }], exitCriteria: [{ id: "x1", text: "Ziel erreicht" }], markets: ["BTCUSDT"], tf: ["4h"], auto: { ...EMPTY_AUTO, boxKinds: ["breakout"], sides: ["long"] } } as typeof x) : x)),
      });
      useJournal.setState({ trades: [...useJournal.getState().trades, UNTAGGED] });
    });
    renderSetups();
    expect(within(screen.getByTestId("setup-card-s_bo")).getByTestId("setup-strategy")).toBeInTheDocument();
    expect(within(screen.getByTestId("setup-card-s_sweep")).queryByTestId("setup-strategy")).toBeNull();

    const card = screen.getByTestId("setup-classify");
    expect(card).toHaveTextContent("ohne Grundlage");
    await act(async () => {
      fireEvent.click(within(card).getByTestId("setup-classify-open"));
    });
    const row = (await screen.findAllByTestId("setup-classify-row")).find((r) => r.textContent?.includes("4H-Breakout über 85.900"));
    expect(row).toBeDefined();
    expect(row).toHaveTextContent("Box-Setup beim Einstieg: Ausbruch");
    const before = useJournal.getState().trades.filter((t) => (t.setups || []).length).map((t) => [t.id, t.setups]);
    const all = screen.getByTestId("setup-classify-all");
    await act(async () => {
      fireEvent.click(all);
    });
    await act(async () => {
      fireEvent.click(all);
    });
    await waitFor(() => expect(useJournal.getState().trades.find((t) => t.id === UNTAGGED.id)?.setups).toEqual(["s_bo"]));
    // tagged trades keep their setups
    const byId = new Map(useJournal.getState().trades.map((t) => [t.id, t.setups]));
    for (const [id, setups] of before) expect(byId.get(id as string)).toEqual(setups);
  });
});
