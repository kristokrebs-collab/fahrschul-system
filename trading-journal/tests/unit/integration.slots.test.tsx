/**
 * P14 slots: the risk preview in the trade editor (P05 `useRiskPreview`: risk %, liquidation, the limits a trade would
 * touch, a breach shakes the size field), the strategy suggestion chip (P07 `classifyTrade`, only from "mittel"), the
 * box snapshot of the save path (never waited for longer than the entry check), the CSV entry of the import dialog
 * (P11), the settings links to the feature pages and the page counts of the command navigation.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pageCounts, type ShellStats } from "@/app/shellStats";
import { withStrategy, type StrategyExtras } from "@/domain/strategy";
import { classifyTrade, historyModel } from "@/domain/strategy/classify";
import type { Setup, Trade } from "@/domain/types";
import { nowLocalInput } from "@/lib/dates";
import { MotionRoot } from "@/motion/MotionRoot";
import ClassifyChipSlot, { bestSuggestion } from "@/overlays/slots/ClassifyChipSlot";
import RiskPreviewSlot from "@/overlays/slots/RiskPreviewSlot";
import { ImportDialog } from "@/overlays/ImportDialog";
import { boxSnapAt } from "@/overlays/TradeEditor";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { MoreSettingsCard } from "@/views/settings/MoreSettingsCard";
import { useRiskGuardStore } from "@/views/risiko/guard";
import { useExchange } from "@/exchanges/store";
import { mkTrade } from "./domain.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const MIN = 60_000;
const local = (ms: number) => nowLocalInput(new Date(ms));

describe("risk preview slot (P05 in the editor)", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    useRiskGuardStore.setState({ marks: {}, override: null });
  });

  it("shows the risk %, every limit the trade breaks, and shakes the size field on a new breach", async () => {
    const now = Date.now();
    // two losses in the last half hour: the pause runs, the day limit is close
    await act(async () => {
      useJournal.setState({
        trades: [
          mkTrade({ id: "l1", date: local(now - 60 * MIN), exitDate: local(now - 20 * MIN), pnlManual: -90, entry: 100, stop: 99, size: 1000 }),
          mkTrade({ id: "l2", date: local(now - 40 * MIN), exitDate: local(now - 5 * MIN), pnlManual: -70, entry: 100, stop: 99, size: 1000 }),
        ] as Trade[],
      });
    });
    const size = document.createElement("div");
    size.id = "f-size";
    const animate = vi.fn(() => ({ finished: Promise.resolve(), cancel() {}, stop() {} }));
    (size as unknown as { animate: typeof animate }).animate = animate;
    document.body.appendChild(size);
    const base = { account: "scalp" as const, side: "long" as const, status: "open" as const, target: null, leverage: null };
    const { rerender } = render(
      <MotionRoot>
        <RiskPreviewSlot {...base} entry={100} stop={99} size={1000} />
      </MotionRoot>,
    );
    const box = await screen.findByTestId("risk-preview");
    expect(box).toHaveTextContent("Risiko vom Konto");
    rerender(
      <MotionRoot>
        <RiskPreviewSlot {...base} entry={100} stop={95} size={4000} leverage={20} />
      </MotionRoot>,
    );
    await waitFor(() => expect(screen.getByTestId("risk-preview")).toHaveAttribute("data-state", "breach"));
    const items = within(screen.getByTestId("risk-preview")).getAllByRole("listitem");
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Nur ein Hinweis – speichern geht immer.")).toBeInTheDocument();
    size.remove();
  });
});

describe("strategy suggestion chip (P07 in the editor)", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
  });

  it("bestSuggestion: only the best one, and only from 'mittel' on", () => {
    const s = (confidence: number) => ({ setupId: "x", name: "X", color: "#fff", confidence, level: "mittel" as const, probability: 0.5, reasons: [] });
    expect(bestSuggestion([])).toBeNull();
    expect(bestSuggestion([s(0.44)])).toBeNull();
    expect(bestSuggestion([s(0.45), s(0.2)])?.confidence).toBe(0.45);
  });

  it("suggests the matching setup while none is picked; Übernehmen picks it", async () => {
    // a box-breakout strategy (P07 extras: markets, timeframe, auto rule) and an unrelated range setup
    const box = withStrategy(
      { id: "s_x", name: "Box-Ausbruch", account: "both", color: "#6f9dc9", desc: "Ausbruch aus der Box mit Schlusskurs", checklist: [] },
      {
        entryCriteria: [{ id: "e1", text: "Schluss über Widerstand" }],
        exitCriteria: [{ id: "x1", text: "Ziel an der nächsten Box" }],
        riskModel: { riskPct: 1, maxLeverage: 4, minRR: 2, stop: "box" },
        tags: ["Breakout"],
        examples: [],
        markets: ["BTC/USDT"],
        tf: ["4h"],
        auto: { boxKinds: ["breakout", "retest"], minGrade: "A", minStrength: null, sessions: [], sides: ["long"] },
      } satisfies StrategyExtras,
    );
    const range: Setup = { id: "s_r", name: "Range-Support", account: "both", color: "#46a6a0", desc: "Long an der Unterkante der Box", checklist: [] };
    await act(async () => {
      useJournal.setState({ settings: { ...useJournal.getState().settings, setups: [box, range] }, trades: [] });
    });
    const boxSnap = { v: 1, symbol: "BTCUSDT", tf: "4h", at: 1, source: "live", phase: "breakout", dir: 1, pos: 1.1, zone: "top", box: null, setup: { kind: "breakout", grade: "A+", score: 80, side: "long", entry: 1, stop: 1, rr: 2, targets: [] }, htf: null, rsi: null };
    const draft = { side: "long" as const, pair: "BTC/USDT", timeframe: "4h", account: "scalp" as const, date: "2026-03-03T09:00", boxSnap };
    // the chip shows exactly what the classifier calls at least "mittel"
    expect(bestSuggestion(classifyTrade({ createdAt: "", ...draft }, [box, range], { history: historyModel([]), exclude: ["s_bt"] }))?.setupId).toBe("s_x");
    const onApply = vi.fn();
    const { rerender } = render(
      <MotionRoot>
        <ClassifyChipSlot draft={draft} picked={[]} onApply={onApply} />
      </MotionRoot>,
    );
    const chip = await screen.findByTestId("classify-chip");
    expect(chip).toHaveTextContent("Box-Ausbruch");
    fireEvent.click(within(chip).getByRole("button", { name: "Übernehmen" }));
    expect(onApply).toHaveBeenCalledWith("s_x");
    // a picked setup hides the chip
    rerender(
      <MotionRoot>
        <ClassifyChipSlot draft={draft} picked={["s_x"]} onApply={onApply} />
      </MotionRoot>,
    );
    await waitFor(() => expect(screen.queryByTestId("classify-chip")).toBeNull());
  });
});

describe("box snapshot of the save path (P02)", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves null without a provider and never waits longer than the entry check", async () => {
    vi.useFakeTimers();
    const p = boxSnapAt("2026-10-01T10:00", "long", "BTC/USDT", 50);
    await vi.advanceTimersByTimeAsync(60);
    await expect(p).resolves.toBeNull();
  });
});

describe("import dialog: CSV entry (P11)", () => {
  beforeAll(() => installDomPolyfills());

  it("closes the backup dialog and opens the CSV import sheet (works without cloud)", async () => {
    useExchange.setState({ csvOpen: false });
    const onClose = vi.fn();
    render(
      <MotionRoot>
        <ImportDialog open onClose={onClose} />
      </MotionRoot>,
    );
    fireEvent.click(await screen.findByTestId("import-csv"));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(useExchange.getState().csvOpen).toBe(true));
  });
});

describe("settings: the feature pages' settings one tap away", () => {
  beforeAll(() => installDomPolyfills());

  it("without cloud: Box- and Risiko-Einstellungen plus the honest line; a row opens its page", async () => {
    useUi.setState({ page: "settings" });
    render(
      <MotionRoot>
        <MoreSettingsCard />
      </MotionRoot>,
    );
    expect(screen.queryByTestId("settings-link-konto")).toBeNull();
    expect(screen.getByText(/Konto, Sync und Abos gibt es in dieser Version nicht/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-link-markt"));
    expect(useUi.getState().page).toBe("markt");
    fireEvent.click(screen.getByTestId("settings-link-risiko"));
    expect(useUi.getState().page).toBe("risiko");
  });
});

describe("command navigation counts (pure)", () => {
  it("one figure per page, the market symbol without its exchange prefix", () => {
    const s: ShellStats = { trades: 13, setups: 8, rules: 5, net: -12.5, winRate: 0.55, currency: "USDT", open: 2, mistakes: 3, goals: 1, symbol: "BINANCE:BTCUSDT" };
    const c = pageCounts(s, { cloud: false, signedIn: false, plan: null, labRuns: 4, boards: 2, now: new Date("2026-10-12T10:00:00Z") });
    expect(Object.keys(c)).toHaveLength(15);
    expect(c.overview.tone).toBe("text-loss");
    expect(c.markt.text).toBe("BTCUSDT");
    expect(c.analyse.text).toBe("55 %");
    expect(c.risiko).toEqual({ text: "2 offen", tone: "text-warn" });
    expect(c.berichte.text).toBe("KW 42");
    expect(c.labor.text).toBe("4");
    expect(c.cockpit.text).toBe("2");
    expect(c.konto.text).toBe("lokal");
    expect(c.preise.text).toBe("–");
    expect(pageCounts(s, { cloud: true, signedIn: true, plan: "Pro", labRuns: 0, boards: 1, now: new Date() }).preise.text).toBe("Pro");
  });
});
