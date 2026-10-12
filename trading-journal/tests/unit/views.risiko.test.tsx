/**
 * Risiko page (P05, `src/views/risiko`): empty journal (honest empty states), a journal with today's losses and open
 * leveraged positions (limits incl. the pause, exposure, liquidation, scenario, streaks, risk spread), the calculator
 * (sizing, leverage over the rule, "In Trade übernehmen" → `openEditor({ draft })`), the hold override, the settings
 * writing at once into `settings.risk` / `settings.discipline`, `useRiskPreview` and the guard toast after a save.
 */
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Trade } from "@/domain/types";
import { nowLocalInput } from "@/lib/dates";
import { __resetMultiDaily } from "@/market/multiDaily";
import type { BinanceRest } from "@/market/sources/binance";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { changedTrades, guardToasts, newlyClosed, pruneMarks, RiskGuardHost, RisikoView, RISIKO_WIDGETS, useRiskGuardStore, useRiskPreview, useRiskUi, parseInput, toInput, MARKS_MAX } from "@/views/risiko";
import { mkTrade } from "./domain.fixtures";
import { bootFixtureJournal, installDomPolyfills } from "./views.overview.harness";

const MIN = 60_000;
const local = (ms: number) => nowLocalInput(new Date(ms));

function journal(now = Date.now()): Trade[] {
  const out: Trade[] = [];
  for (let i = 0; i < 14; i++) {
    const at = now - (30 - i) * 86_400_000;
    out.push(mkTrade({ id: `c${i}`, date: local(at), exitDate: local(at + 3_600_000), pair: i % 2 ? "ETH/USDT" : "BTC/USDT", entry: 100, stop: 99, size: 2000 + i * 100, exit: i % 3 ? 102 : 99, setups: ["s_bo"] }));
  }
  // two losses closed in the last half hour: 160 of 200 (scalp 5 000 × 4 %), pause
  out.push(mkTrade({ id: "l1", date: local(now - 60 * MIN), exitDate: local(now - 20 * MIN), pnlManual: -90, entry: 100, stop: 99, size: 1000 }));
  out.push(mkTrade({ id: "l2", date: local(now - 40 * MIN), exitDate: local(now - 5 * MIN), pnlManual: -70, entry: 100, stop: 99, size: 1000 }));
  out.push(mkTrade({ id: "o1", date: local(now - 120 * MIN), status: "open", exit: null, pair: "BTC/USDT", entry: 60_000, stop: 58_800, size: 3000, leverage: 5 }));
  out.push(mkTrade({ id: "o2", date: local(now - 120 * MIN), status: "open", exit: null, pair: "SOL/USDT", side: "short", account: "makro", entry: 180, stop: 189, size: 4000, leverage: 2 }));
  return out;
}

const rest = { klines: vi.fn(async () => ({ data: [], asOf: 0, receivedAt: 0, source: "binance", comparable: true })) } as unknown as BinanceRest;

function renderView() {
  return render(
    <MotionRoot>
      <MorphDialogProvider>
        <RisikoView />
        <RiskGuardHost />
      </MorphDialogProvider>
    </MotionRoot>,
  );
}

async function load(trades: Trade[] = journal()) {
  await act(async () => {
    useJournal.setState({ trades });
  });
}

describe("RisikoView", () => {
  beforeAll(() => {
    installDomPolyfills();
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  beforeEach(async () => {
    __resetMultiDaily({ rest: () => rest, proxy: () => null, kv: () => null });
    await bootFixtureJournal();
    useRiskGuardStore.setState({ marks: {}, override: null });
    useRiskUi.getState().resetCalc();
  });
  afterEach(() => useUi.setState({ acc: "all" }));

  it("empty journal: h1, sections and honest empty states", async () => {
    await load([]);
    renderView();
    expect(screen.getByRole("heading", { level: 1, name: "Risiko" })).toBeInTheDocument();
    for (const t of ["Jetzt", "Vor dem Trade", "Portfolio", "Muster", "Einstellungen"]) expect(screen.getByRole("heading", { level: 2, name: t })).toBeInTheDocument();
    expect(screen.getByTestId("risk-exposure")).toHaveTextContent("Keine offenen Positionen");
    expect(screen.getByTestId("risk-margin")).toHaveTextContent("Keine Börse verbunden");
    expect(screen.getByTestId("risk-scenario")).toHaveTextContent("Keine offenen Positionen");
    expect(screen.getByTestId("risk-corr")).toHaveAttribute("data-state", "few");
    expect(screen.getByTestId("risk-streak")).toHaveAttribute("data-status", "zu wenig");
    expect(screen.getByTestId("risk-limits")).toHaveAttribute("data-worst", "ok");
  });

  it("limits with the pause, exposure, liquidation, scenario legs, risk spread", async () => {
    await load();
    renderView();
    const limits = screen.getByTestId("risk-limits");
    expect(within(limits).getByTestId("limit-day")).toHaveAttribute("data-state", "warn");
    expect(limits).toHaveTextContent("160 USDT von 200 USDT heute");
    for (const k of ["week", "drawdown", "openRisk", "trade", "trades", "leverage"]) expect(within(limits).getByTestId(`limit-${k}`)).toBeInTheDocument();
    expect(within(limits).getByTestId("risk-cooldown")).toHaveTextContent("2 Verluste in Folge");
    expect(limits).toHaveAttribute("data-cooldown", "on");
    expect(screen.getByTestId("risk-exposure")).toHaveAttribute("data-legs", "2");
    expect(screen.getByTestId("risk-exposure")).toHaveTextContent("Nur Journal-Daten");
    expect(within(screen.getByTestId("risk-liq")).getAllByTestId("liq-row")).toHaveLength(2);
    expect(within(screen.getByTestId("risk-scenario")).getAllByTestId("scenario-leg")).toHaveLength(2);
    expect(within(screen.getByTestId("risk-spread")).getAllByTestId("spread-row").length).toBeGreaterThan(0);
    expect(screen.getByTestId("risk-streak")).toHaveAttribute("data-status");
  });

  it("override the pause: a tap asks inline, yes sets the override until the pause ends", async () => {
    await load();
    renderView();
    const limits = screen.getByTestId("risk-limits");
    const btn = within(limits).getByTestId("risk-override");
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      fireEvent.click(within(limits).getByRole("button", { name: "Ja, überschreiben" }));
    });
    const o = useRiskGuardStore.getState().override;
    expect(o).not.toBeNull();
    expect(o!.until).toBeGreaterThan(Date.now());
    expect(limits).toHaveTextContent("Überschrieben bis");
  });

  it("calculator: size from risk, leverage over the rule, adopt into the editor", async () => {
    await load([]);
    renderView();
    const calc = screen.getByTestId("risk-calc");
    await act(async () => {
      fireEvent.change(within(calc).getByLabelText("Einstieg"), { target: { value: "100" } });
      fireEvent.change(within(calc).getByLabelText("Stop"), { target: { value: "95" } });
      fireEvent.change(within(calc).getByLabelText("Ziel"), { target: { value: "110" } });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 200));
    });
    const result = within(calc).getByTestId("risk-calc-result");
    expect(result).toHaveAttribute("data-ok", "1");
    // scalp 5 000 × 1 % = 50 at a loss per unit of 5 + fees + slippage
    expect(result).toHaveTextContent("−50 USDT");
    expect(within(calc).getByTestId("risk-rr")).toHaveTextContent("1:2");
    await act(async () => {
      fireEvent.click(within(calc).getByTestId("risk-adopt"));
    });
    const ed = useUi.getState().editor;
    expect(ed.open).toBe(true);
    expect(ed.draft).toMatchObject({ account: "scalp", side: "long", status: "open", entry: 100, stop: 95, target: 110, marginMode: "isolated" });
    expect(ed.draft!.size).toBeGreaterThan(0);
    // a hairline stop at 2 % risk needs more than the rule
    await act(async () => {
      fireEvent.change(within(calc).getByLabelText("Stop"), { target: { value: "99,9" } });
      fireEvent.click(within(calc).getByTestId("risk-chip-2"));
    });
    expect(await within(calc).findByTestId("risk-calc-toobig")).toHaveTextContent("Über deiner Hebel-Regel");
  });

  it("settings write at once: the week limit into settings.risk, the day limit into settings.discipline; invalid is refused", async () => {
    await load([]);
    renderView();
    const st = screen.getByTestId("risk-settings");
    await act(async () => {
      fireEvent.change(within(st).getByTestId("rs-week"), { target: { value: "5" } });
      fireEvent.blur(within(st).getByTestId("rs-week"));
    });
    await act(async () => {
      fireEvent.change(within(st).getByTestId("rs-day"), { target: { value: "3" } });
      fireEvent.blur(within(st).getByTestId("rs-day"));
    });
    const s = useJournal.getState().settings as unknown as { risk: { maxLossWeekPct: number }; discipline: { maxLossDayPct: number } };
    expect(s.risk.maxLossWeekPct).toBeCloseTo(0.05, 10);
    expect(s.discipline.maxLossDayPct).toBeCloseTo(0.03, 10);
    await act(async () => {
      fireEvent.change(within(st).getByTestId("rs-warn"), { target: { value: "120" } });
      fireEvent.blur(within(st).getByTestId("rs-warn"));
    });
    expect(within(st).getByTestId("rs-warn")).toHaveValue("75");
  });

  it("the guard toasts what a save did to the limits (once)", async () => {
    await load(journal().filter((t) => t.id !== "l2"));
    renderView();
    const before = useUi.getState().toasts.length;
    const now = Date.now();
    await act(async () => {
      useJournal.setState({ trades: [...useJournal.getState().trades, mkTrade({ id: "l3", date: local(now - 10 * MIN), exitDate: local(now - MIN), pnlManual: -120, entry: 100, stop: 99, size: 1000 })] });
    });
    const toasts = useUi.getState().toasts;
    expect(toasts.length).toBe(before + 1);
    expect(toasts.at(-1)!.kind).toBe("error");
    // the guard needs a FRESH save to mark (mkTrade's updatedAt is old): no mark, the pause runs on exitDate
    expect(useRiskGuardStore.getState().marks.l3).toBeUndefined();
  });

  it("a bulk change (import / restore) is not a save: no toast, no marks", async () => {
    await load([]);
    renderView();
    const before = useUi.getState().toasts.length;
    const now = Date.now();
    const fresh = new Date(now).toISOString();
    await act(async () => {
      useJournal.setState({ trades: journal(now).map((t) => ({ ...t, updatedAt: fresh })) });
    });
    expect(useUi.getState().toasts.length).toBe(before);
    expect(useRiskGuardStore.getState().marks).toEqual({});
  });

  it("a fresh close without exitDate is marked now (its pause starts at the save)", async () => {
    await load(journal().filter((t) => t.id !== "l2"));
    renderView();
    const now = Date.now();
    await act(async () => {
      useJournal.setState({ trades: [...useJournal.getState().trades, mkTrade({ id: "l4", date: local(now - 3 * 3_600_000), pnlManual: -10, entry: 100, stop: 99, size: 1000, updatedAt: new Date(now).toISOString() })] });
    });
    expect(useRiskGuardStore.getState().marks.l4).toBeGreaterThanOrEqual(now);
  });

  it("widgets for the cockpit render", async () => {
    await load();
    for (const w of RISIKO_WIDGETS) {
      const C = w.component;
      const { unmount } = render(
        <MotionRoot>
          <C />
        </MotionRoot>,
      );
      unmount();
    }
    expect(RISIKO_WIDGETS.map((w) => w.id)).toEqual(["risk-limits", "risk-exposure", "risk-calc"]);
  });
});

describe("useRiskPreview (editor contract)", () => {
  beforeAll(() => installDomPolyfills());
  beforeEach(async () => {
    await bootFixtureJournal();
    useRiskGuardStore.setState({ marks: {}, override: null });
  });

  it("warns before the save: risk over the per-trade limit, leverage rule, the day limit", async () => {
    await load();
    const { result, rerender } = renderHook((d: Parameters<typeof useRiskPreview>[0]) => useRiskPreview(d), { initialProps: { account: "scalp", side: "long", entry: 100, stop: 99, size: 1000 } });
    expect(result.current!.riskAmount).toBeCloseTo(10, 10);
    // the running pause (two losses in the last half hour) is part of every preview
    expect(result.current!.warnings.some((w) => w.source === "cooldown")).toBe(true);
    rerender({ account: "scalp", side: "long", entry: 100, stop: 95, size: 4000, leverage: 20 });
    const keys = result.current!.warnings.map((w) => w.key);
    expect(keys).toEqual(expect.arrayContaining(["preview:trade", "preview:leverage", "preview:day"]));
    expect(result.current!.state).toBe("breach");
    rerender(null);
    expect(result.current).toBeNull();
  });
});

describe("guard helpers", () => {
  it("newly closed / changed trades, toasts only for new warnings, marks pruned", () => {
    const a = mkTrade({ id: "a", date: "2026-10-01T10:00", status: "open" });
    const b = mkTrade({ id: "b", date: "2026-10-01T11:00" });
    const a2 = { ...a, status: "closed" as const };
    expect(newlyClosed([a, b], [a2, b]).map((t) => t.id)).toEqual(["a"]);
    expect(newlyClosed([a], [a, b]).map((t) => t.id)).toEqual(["b"]);
    expect(changedTrades([a, b], [a2, b]).map((t) => t.id)).toEqual(["a"]);
    // a re-read record (new object, same content) is not a change
    expect(changedTrades([a, b], [{ ...a }, { ...b }])).toEqual([]);
    const w = (key: string, tone: "warn" | "breach") => ({ key, tone, title: key, detail: "", source: "limit" as const });
    expect(guardToasts([w("limit:day", "warn")], [w("limit:day", "breach"), w("limit:week", "warn")], new Set()).map((x) => `${x.key}|${x.tone}`)).toEqual(["limit:day|breach", "limit:week|warn"]);
    expect(guardToasts([], [w("limit:day", "warn")], new Set(["limit:day|warn"]))).toEqual([]);
    const now = Date.now();
    const marks = Object.fromEntries(Array.from({ length: MARKS_MAX + 10 }, (_, i) => [`t${i}`, now - i * 1000]));
    marks.old = now - 30 * 86_400_000;
    const kept = pruneMarks(marks, now);
    expect(Object.keys(kept)).toHaveLength(MARKS_MAX);
    expect(kept.old).toBeUndefined();
    expect(kept.t0).toBe(now);
  });

  it("German number input", () => {
    expect(parseInput("85.900,5")).toBe(85900.5);
    expect(parseInput("1,5")).toBe(1.5);
    expect(parseInput("1.5")).toBe(1.5);
    expect(parseInput("")).toBeNaN();
    expect(toInput(0.000123456)).toBe("0,000123");
    expect(toInput(85900.123)).toBe("85900,1");
  });
});
